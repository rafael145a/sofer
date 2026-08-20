import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  deleteBackward,
  deleteForward,
  deleteSelection,
  encodeSelection,
  insertParagraph,
  insertSlice,
  insertText,
  isEmbedAdjacentToCaret,
  serializeSelection,
  sliceToText,
  SOFER_MIME,
  type CommandContext,
  type ListKind,
  type MarkName,
  type SerializedBlock,
} from "@sofereditor/core";
import { applyDomSelection, isTableRectSelection, readDomSelection, selectionsEqual } from "./dom-bridge";
import { planPaste } from "./pastePlan";
import { resolvePastedImageUploads, sliceHasDataImageEmbeds } from "./resolvePastedImages";
import { BehindImageSelectAffordance } from "./BehindImageSelectAffordance";
import { LinkHoverTooltip } from "./LinkHoverTooltip";
import { EditorProvider } from "./EditorContext";
import { ImageResizeOverlay } from "./ImageResizeOverlay";
import {
  RemoteCursorsOverlay,
  type AwarenessLike,
} from "./RemoteCursorsOverlay";
import { NodeView, type NodeViewFragment } from "./NodeView";
import {
  A4_PAGE,
  defaultPageLayout,
  usePageLayout,
  type PageGeometry,
  type PageLayout,
  type PageSlot,
} from "./usePagination";
import { useEditor, type UseEditorResult } from "./useEditor";
import { usePageSettings } from "./usePageSettings";

export interface PageRenderContext {
  pageNumber: number;
  pageCount: number;
}

export type PageRenderProp = (ctx: PageRenderContext) => ReactNode;

export interface EditorProps {
  editor?: UseEditorResult;
  className?: string;
  /**
   * Page geometry override. When **omitted**, the editor reads page settings
   * from `editor.doc` (the `docSettings` Y.Map populated via `setPageSettings`
   * or `import-docx`). When **set**, this value wins for rendering — but is
   * NOT written back to the Y.Doc (view-only override; useful when the host
   * app must pin a size regardless of doc state, e.g. a prova generator).
   * Pass **null** to disable pagination entirely (flat flow).
   */
  pageGeometry?: PageGeometry | null;
  /**
   * Custom page header. Receives `{ pageNumber, pageCount }` and renders inside
   * the top margin of every page (above the content area). Pass `null` to omit.
   */
  renderPageHeader?: PageRenderProp | null;
  /**
   * Custom page footer. Receives `{ pageNumber, pageCount }`. Defaults to
   * `"<n> / <total>"` centered. Pass `null` to omit.
   */
  renderPageFooter?: PageRenderProp | null;
  /**
   * Awareness do Yjs (de `useCollab().binding.awareness`). Quando presente,
   * o editor publica a seleção local e desenha os cursores/seleções dos outros
   * usuários (presença colaborativa). Omitir = sem cursores remotos.
   */
  awareness?: AwarenessLike;
}

const defaultFooter: PageRenderProp = ({ pageNumber, pageCount }) =>
  `${pageNumber} / ${pageCount}`;

export function Editor({
  editor: providedEditor,
  className,
  pageGeometry,
  renderPageHeader,
  renderPageFooter = defaultFooter,
  awareness,
}: EditorProps): JSX.Element {
  const internal = useEditor();
  const editor = providedEditor ?? internal;
  const { doc, history, snapshot, getSelection, setSelection } = editor;

  const rootRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  // The `behind` image the pointer is currently hovering (by geometry), so we
  // can show a click affordance to select it through the text on top of it.
  const [hoveredBehind, setHoveredBehind] = useState<{
    blockIndex: number;
    offset: number;
    cellIndex?: number;
  } | null>(null);
  const hoveredBehindRef = useRef<typeof hoveredBehind>(null);
  // The link the pointer is hovering — drives the URL tooltip (rect in viewport
  // coords). Tracked by element identity to avoid re-render churn on every move.
  const [hoveredLink, setHoveredLink] = useState<{
    href: string;
    rect: { top: number; left: number; bottom: number; width: number };
  } | null>(null);
  const hoveredLinkElRef = useRef<HTMLAnchorElement | null>(null);
  const suppressSelectionSyncRef = useRef(false);

  // Presença colaborativa: publica a seleção local no awareness (throttle por
  // rAF). Outros editores desenham nosso caret via RemoteCursorsOverlay.
  useEffect(() => {
    if (!awareness) return;
    const root = rootRef.current;
    if (!root) return;
    let raf: number | null = null;
    const publish = () => {
      raf = null;
      const sel = readDomSelection(root);
      awareness.setLocalStateField(
        "cursor",
        sel ? encodeSelection(doc, sel) ?? null : null,
      );
    };
    const onSelChange = () => {
      const s = document.getSelection();
      if (!s || s.rangeCount === 0) return;
      // Só publica quando a seleção está dentro do nosso editor.
      if (s.anchorNode && !root.contains(s.anchorNode)) return;
      if (raf != null) return;
      raf = requestAnimationFrame(publish);
    };
    const onBlur = () => awareness.setLocalStateField("cursor", null);
    document.addEventListener("selectionchange", onSelChange);
    root.addEventListener("blur", onBlur, true);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      root.removeEventListener("blur", onBlur, true);
      if (raf != null) cancelAnimationFrame(raf);
      awareness.setLocalStateField("cursor", null);
    };
  }, [awareness, doc]);

  const ctxRef = useRef<CommandContext>({ doc, getSelection, setSelection });
  ctxRef.current = { doc, getSelection, setSelection };
  const historyRef = useRef(history);
  historyRef.current = history;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Run after every render — not just when selection or snapshot change — so
  // we re-apply the caret after pagination's two-phase render cycle (which
  // mutates `layout` state without touching `editor.selection` or `snapshot`,
  // and tears down/rebuilds the text nodes the prior DOM selection was attached
  // to). The early-return when DOM already matches the model keeps this cheap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (isComposingRef.current) return;
    if (document.activeElement !== root) return;
    const current = readDomSelection(root);
    if (current && selectionsEqual(current, editor.selection)) return;
    if (isTableRectSelection(editor.selection)) {
      // Cross-cell (rectangular) table selection: the native DOM selection is
      // intentionally empty — TableView paints the highlight via CSS classes.
      // Keep it empty but do NOT arm the suppress guard. The guard exists to
      // ignore render-collapsed carets while TYPING; for a rect selection the
      // empty native selection is the steady state, so arming it would make the
      // selectionchange handler ignore a genuine click-away — the rect would
      // stick in the model and the next keystroke would overwrite the selected
      // cells instead of writing at the clicked caret.
      applyDomSelection(root, editor.selection);
      suppressSelectionSyncRef.current = false;
      return;
    }
    // DOM caret diverged from the model — typically a re-render replaced the
    // text node and collapsed the native caret to offset 0. Suppress the
    // selectionchange handler until the DOM settles back to the model; otherwise
    // a render-induced selectionchange writes the collapsed caret over a newer
    // keystroke's selection and the caret jumps backward when typing fast.
    // Cleared deterministically in the selectionchange handler once the DOM
    // settles to the live model — NOT on a timer, because timers race the event.
    suppressSelectionSyncRef.current = true;
    applyDomSelection(root, editor.selection);
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handler = () => {
      if (isComposingRef.current) return;
      if (document.activeElement !== root) {
        // Focus left the editor — nothing to capture here. Release any pending
        // suppression so a stuck flag can't swallow the next genuine change.
        suppressSelectionSyncRef.current = false;
        return;
      }
      const modelSel = readDomSelection(root);
      if (suppressSelectionSyncRef.current) {
        // Mid-reconciliation: a render moved the caret. Resume capturing user
        // selection only once the DOM caret has settled to match the LIVE model
        // (our applyDomSelection landed). Transient render-collapsed carets
        // (DOM != model) are ignored — those are the spurious events that used
        // to clobber the model selection and make the caret jump back.
        if (modelSel && selectionsEqual(modelSel, editorRef.current.getSelection())) {
          suppressSelectionSyncRef.current = false;
        }
        return;
      }
      if (modelSel) setSelection(modelSel);
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [setSelection]);

  // ---------- Sub-phase 4.5: rectangular table-cell drag ----------
  //
  // mousedown captures the anchor cell. mousemove flips into "rect mode" the
  // moment the pointer enters a DIFFERENT cell of the same table, at which
  // point we suppress the native cross-cell selection and write a rectangular
  // selection to the model. The visual highlight is drawn by TableView via
  // CSS classes (see isTableRectSelection in dom-bridge).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    interface DragState {
      blockIndex: number;
      anchorCellIndex: number;
      anchorTableEl: HTMLTableElement;
      rectActive: boolean;
    }
    let drag: DragState | null = null;

    function cellFromTarget(target: EventTarget | null): {
      blockIndex: number;
      cellIndex: number;
      tableEl: HTMLTableElement;
    } | null {
      if (!(target instanceof Node)) return null;
      let n: Node | null = target;
      let cellEl: HTMLElement | null = null;
      let tableEl: HTMLTableElement | null = null;
      while (n && n !== root) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          const e = n as HTMLElement;
          if (!cellEl && e.dataset.cellIndex != null) cellEl = e;
          if (e.tagName === "TABLE" && e.dataset.blockIndex != null) {
            tableEl = e as HTMLTableElement;
            break;
          }
        }
        n = n.parentNode;
      }
      if (!cellEl || !tableEl) return null;
      const cellIndex = Number.parseInt(cellEl.dataset.cellIndex!, 10);
      const blockIndex = Number.parseInt(tableEl.dataset.blockIndex!, 10);
      return { blockIndex, cellIndex, tableEl };
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = cellFromTarget(e.target);
      if (!hit) {
        drag = null;
        return;
      }
      drag = {
        blockIndex: hit.blockIndex,
        anchorCellIndex: hit.cellIndex,
        anchorTableEl: hit.tableEl,
        rectActive: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return;
      // Only treat as drag when the primary button is still pressed.
      if ((e.buttons & 1) === 0) {
        drag = null;
        return;
      }
      const hit = cellFromTarget(e.target);
      if (!hit) return;
      if (hit.blockIndex !== drag.blockIndex) return; // never cross tables
      if (hit.cellIndex === drag.anchorCellIndex && !drag.rectActive) return;

      if (!drag.rectActive) {
        drag.rectActive = true;
        // Kill any in-progress native cross-cell selection.
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      ctxRef.current.setSelection({
        anchor: { blockIndex: drag.blockIndex, cellIndex: drag.anchorCellIndex, offset: 0 },
        focus: { blockIndex: drag.blockIndex, cellIndex: hit.cellIndex, offset: 0 },
      });
    };

    const onPointerUp = () => {
      drag = null;
    };

    root.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // ---------- Fase 5: drag-drop de imagens ----------
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const hasFiles = Array.from(e.dataTransfer.items ?? []).some(
        (i) => i.kind === "file",
      );
      if (!hasFiles) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const images = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (images.length === 0) return;
      e.preventDefault();
      // Position the caret at the drop point so the insertion lands there.
      const range = caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        const dom = window.getSelection();
        dom?.removeAllRanges();
        dom?.addRange(range);
        const sel = readDomSelection(root);
        if (sel) ctxRef.current.setSelection(sel);
      }
      void (async () => {
        for (const f of images) await editorRef.current.insertImageFromFile(f);
      })();
    };
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
    };
  }, []);

  // ---------- Fase 5: clique numa imagem seleciona o embed ----------
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const img = target.closest('img[data-embed="image"]') as HTMLElement | null;
      if (!img) return;
      const blockEl = img.closest("[data-block-index]") as HTMLElement | null;
      if (!blockEl) return;
      const blockIndex = Number.parseInt(blockEl.dataset.blockIndex!, 10);
      const offsetAttr = img.dataset.embedOffset;
      if (offsetAttr == null) return;
      const localOffset = Number.parseInt(offsetAttr, 10);
      const fragmentStart = Number.parseInt(blockEl.dataset.fragmentStart ?? "0", 10) || 0;
      const cellEl = img.closest("[data-cell-index]") as HTMLElement | null;
      const cellIndex = cellEl
        ? Number.parseInt(cellEl.dataset.cellIndex!, 10)
        : undefined;
      const offset = fragmentStart + localOffset;
      e.preventDefault();
      ctxRef.current.setSelection({
        anchor: { blockIndex, cellIndex, offset },
        focus: { blockIndex, cellIndex, offset: offset + 1 },
      });
    };
    root.addEventListener("pointerdown", onPointerDown);
    return () => root.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Hover detection for `behind` images: they sit at z-index:-1, so the text on
  // top intercepts clicks and the image can't be selected by clicking there. On
  // pointer move we find — BY GEOMETRY — the behind image under the pointer and
  // expose a select affordance (rendered below). Throttled to one check/frame.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const same = (
      a: typeof hoveredBehind,
      b: typeof hoveredBehind,
    ): boolean =>
      a === b ||
      (!!a &&
        !!b &&
        a.blockIndex === b.blockIndex &&
        a.offset === b.offset &&
        (a.cellIndex ?? -1) === (b.cellIndex ?? -1));
    const set = (next: typeof hoveredBehind) => {
      if (same(next, hoveredBehindRef.current)) return;
      hoveredBehindRef.current = next;
      setHoveredBehind(next);
    };
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      const x = e.clientX;
      const y = e.clientY;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const imgs = root.querySelectorAll<HTMLImageElement>(
          'img[data-embed="image"][data-embed-layout="behind"]',
        );
        let hit: HTMLImageElement | null = null;
        for (const img of imgs) {
          const r = img.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            hit = img;
            break;
          }
        }
        if (!hit) {
          set(null);
          return;
        }
        const blockEl = hit.closest<HTMLElement>("[data-block-index]");
        const offsetAttr = hit.dataset.embedOffset;
        if (!blockEl || offsetAttr == null) {
          set(null);
          return;
        }
        const blockIndex = Number.parseInt(blockEl.dataset.blockIndex!, 10);
        const fragmentStart = Number.parseInt(blockEl.dataset.fragmentStart ?? "0", 10) || 0;
        const cellEl = hit.closest<HTMLElement>("[data-cell-index]");
        const cellIndex = cellEl
          ? Number.parseInt(cellEl.dataset.cellIndex!, 10)
          : undefined;
        set({ blockIndex, offset: fragmentStart + Number.parseInt(offsetAttr, 10), cellIndex });
      });
    };
    const onLeave = () => set(null);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Link hover tooltip: show the URL while the pointer is over a link. Uses
  // `mouseover` delegation (fires on element enter, far cheaper than mousemove)
  // and tracks the hovered <a> by identity to avoid re-render churn. Cleared on
  // leave/scroll (the cached viewport rect would otherwise go stale).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const clear = () => {
      if (hoveredLinkElRef.current) {
        hoveredLinkElRef.current = null;
        setHoveredLink(null);
      }
    };
    const onOver = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && root.contains(a)) {
        if (hoveredLinkElRef.current === a) return;
        hoveredLinkElRef.current = a;
        const r = a.getBoundingClientRect();
        setHoveredLink({
          href: a.getAttribute("href") ?? "",
          rect: { top: r.top, left: r.left, bottom: r.bottom, width: r.width },
        });
      } else {
        clear();
      }
    };
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", clear);
    root.addEventListener("scroll", clear, true);
    window.addEventListener("scroll", clear, true);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", clear);
      root.removeEventListener("scroll", clear, true);
      window.removeEventListener("scroll", clear, true);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handler = (e: InputEvent) => {
      const ctx = ctxRef.current;
      const hist = historyRef.current;
      const ed = editorRef.current;
      const type = e.inputType;

      if (isComposingRef.current && type === "insertCompositionText") return;

      switch (type) {
        case "insertText": {
          const data = e.data ?? "";
          if (data.length > 0) {
            e.preventDefault();
            insertText(ctx, data, ed.consumePendingMarks());
          }
          return;
        }
        case "insertLineBreak": {
          // Shift+Enter inside a listItem inserts a soft line break (`\n`)
          // INSIDE the item instead of splitting it into a new numbered entry
          // — useful for spacing between question lines without bumping the
          // numbering. Other blocks fall through to the regular paragraph
          // split (= same as Enter), because TipTap-style "soft break" inside
          // a paragraph isn't part of this model.
          e.preventDefault();
          if (ed.getBlockType() === "listItem") {
            insertText(ctx, "\n", ed.consumePendingMarks());
            return;
          }
          // Fall through to the same path as insertParagraph.
          const selEmbed = ed.getSelectedEmbed();
          if (selEmbed) {
            const off = selEmbed.offset + 1;
            ctx.setSelection({
              anchor: {
                blockIndex: selEmbed.blockIndex,
                cellIndex: selEmbed.cellIndex,
                offset: off,
              },
              focus: {
                blockIndex: selEmbed.blockIndex,
                cellIndex: selEmbed.cellIndex,
                offset: off,
              },
            });
          }
          if (ed.splitListItem()) return;
          insertParagraph(ctx);
          return;
        }
        case "insertParagraph": {
          e.preventDefault();
          // If an embed is the entire selection, drop the caret RIGHT AFTER it
          // before splitting — otherwise the default "delete range then insert
          // paragraph" path would remove the image.
          const selectedEmbed = ed.getSelectedEmbed();
          if (selectedEmbed) {
            const off = selectedEmbed.offset + 1;
            ctx.setSelection({
              anchor: {
                blockIndex: selectedEmbed.blockIndex,
                cellIndex: selectedEmbed.cellIndex,
                offset: off,
              },
              focus: {
                blockIndex: selectedEmbed.blockIndex,
                cellIndex: selectedEmbed.cellIndex,
                offset: off,
              },
            });
          }
          if (ed.splitListItem()) return;
          insertParagraph(ctx);
          return;
        }
        case "insertReplacementText": {
          const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
          if (text.length > 0) {
            e.preventDefault();
            insertText(ctx, text, ed.consumePendingMarks());
          }
          return;
        }
        case "insertFromPaste": {
          // Paste é tratado pelo handler `paste` (useEffect de clipboard). Quando
          // ele NÃO faz preventDefault (ex.: clipboard só com text/html, ou sem
          // clipboardData), o browser cai aqui — este no-op bloqueia a inserção
          // crua no DOM em vez de corromper o documento virtual.
          e.preventDefault();
          return;
        }
        case "deleteContentBackward":
        case "deleteWordBackward":
        case "deleteSoftLineBackward":
        case "deleteHardLineBackward": {
          e.preventDefault();
          deleteBackward(ctx);
          return;
        }
        case "deleteContentForward":
        case "deleteWordForward":
        case "deleteSoftLineForward":
        case "deleteHardLineForward": {
          e.preventDefault();
          deleteForward(ctx);
          return;
        }
        case "historyUndo": {
          e.preventDefault();
          hist.undo();
          return;
        }
        case "historyRedo": {
          e.preventDefault();
          hist.redo();
          return;
        }
        default: {
          e.preventDefault();
          return;
        }
      }
    };

    root.addEventListener("beforeinput", handler);
    return () => root.removeEventListener("beforeinput", handler);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const writeSlice = (e: ClipboardEvent): boolean => {
      const ctx = ctxRef.current;
      const slice = serializeSelection(ctx.doc, ctx.getSelection());
      if (!slice || !e.clipboardData) return false;
      e.clipboardData.setData(SOFER_MIME, JSON.stringify(slice));
      e.clipboardData.setData("text/plain", sliceToText(slice));
      return true;
    };

    const onCopy = (e: ClipboardEvent) => {
      if (writeSlice(e)) e.preventDefault();
    };

    const onCut = (e: ClipboardEvent) => {
      // Always block the native cut: it mutates the contenteditable DOM directly
      // and would write its own clipboard serialization. When we have a slice we
      // delete via the model; an unsupported selection (writeSlice false) becomes
      // a clean no-op instead of a "cut that doesn't delete".
      e.preventDefault();
      if (writeSlice(e)) deleteSelection(ctxRef.current);
    };

    const onPaste = (e: ClipboardEvent) => {
      const ctx = ctxRef.current;
      const cd = e.clipboardData;
      if (!cd) return;
      // A escolha do ramo (e sobretudo a ORDEM deles) vive em `planPaste`, para
      // ser testável sem montar o editor. Ver o comentário lá sobre por que o
      // HTML precisa vir antes dos arquivos de imagem.
      const plan = planPaste(cd);
      if (plan.kind === "none") return;
      e.preventDefault();
      switch (plan.kind) {
        case "sofer":
          insertSlice(ctx, plan.slice);
          return;
        case "html": {
          if (!sliceHasDataImageEmbeds(plan.slice)) {
            insertSlice(ctx, plan.slice);
            return;
          }
          // Slice tem embed(s) `data:` (Google Docs) — sobe pro storage
          // configurado (`uploadImage`) ANTES de inserir, pra não gravar
          // ~300KB de base64 direto no Y.Doc. `htmlToSlice` continua pura: só
          // emite o `data:`, a subida é feita aqui (ver `resolvePastedImages.ts`).
          const capturedSelection = ctx.getSelection();
          void (async () => {
            const resolved = await resolvePastedImageUploads(plan.slice, editorRef.current.uploadImage);
            // A subida é assíncrona — o caret pode ter se movido nesse meio
            // tempo. Restaura a posição capturada NO MOMENTO da colagem antes
            // de inserir, senão o slice cai onde o caret está agora, não onde
            // o professor colou.
            //
            // Limitação conhecida: é uma posição ABSOLUTA ({blockIndex,
            // offset}), não uma `Y.RelativePosition`. Cobre o caso comum (o
            // professor clica em outro lugar enquanto espera o upload) mas
            // não o caso raro de ele continuar DIGITANDO nessa mesma posição
            // durante a espera — os offsets teriam avançado e a restauração
            // cairia num ponto levemente errado. Migrar pra RelativePosition
            // fecharia isso; fora de escopo aqui.
            ctxRef.current.setSelection(capturedSelection);
            insertSlice(ctxRef.current, resolved);
          })();
          return;
        }
        case "images":
          void (async () => {
            for (const f of plan.files) await editorRef.current.insertImageFromFile(f);
          })();
          return;
        case "text": {
          const lines = plan.text.split(/\r\n|\r|\n/);
          lines.forEach((line, i) => {
            if (i > 0) insertParagraph(ctx);
            if (line.length > 0) insertText(ctx, line);
          });
          return;
        }
      }
    };

    root.addEventListener("copy", onCopy);
    root.addEventListener("cut", onCut);
    root.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("copy", onCopy);
      root.removeEventListener("cut", onCut);
      root.removeEventListener("paste", onPaste);
    };
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const ed = editorRef.current;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Tab") {
      e.preventDefault();
      // Inside a table, Tab/Shift+Tab navigates between cells; at the last
      // cell Tab appends a new row.
      if (ed.isInTable()) {
        if (e.shiftKey) ed.moveToPrevCell();
        else ed.moveToNextCell();
        return;
      }
      if (e.shiftKey) ed.dedentList();
      else ed.indentList();
      return;
    }

    // Home/End: move the caret to the visual start/end of the current line.
    // The default contenteditable behavior is inconsistent with paginated
    // fragments — Chrome occasionally jumps to the start/end of the block
    // element instead of the visual line. We explicitly use the native
    // `Selection.modify("lineboundary")` API (Chrome/Edge/Safari) which
    // respects visual line wrapping inside any contenteditable.
    //
    // `Cmd/Ctrl+Home/End` keep the default browser behavior (document scroll).
    if (!mod && (e.key === "Home" || e.key === "End")) {
      const root = rootRef.current;
      const sel = window.getSelection();
      const sm = (sel as unknown as { modify?: (alter: string, direction: string, granularity: string) => void })?.modify;
      if (root && sel && sel.rangeCount > 0 && typeof sm === "function") {
        e.preventDefault();
        const alter = e.shiftKey ? "extend" : "move";
        const direction = e.key === "Home" ? "left" : "right";
        sm.call(sel, alter, direction, "lineboundary");
        const modelSel = readDomSelection(root);
        if (modelSel) ctxRef.current.setSelection(modelSel);
      }
      return;
    }

    // Backspace/Delete quando um embed (imagem) está selecionado ou
    // adjacente ao caret colapsado. O `<figure>` do embed é
    // `contenteditable=false`; quando a seleção do DOM pousa nele — o que
    // acontece depois de inserir ou clicar numa imagem — o navegador NUNCA
    // dispara `beforeinput`, então o caminho normal de delete (tratado em
    // `beforeinput`, no outro useEffect) fica mudo pra esse caso. Decidido
    // pelo MODELO (`getSelectedEmbed`/`isEmbedAdjacentToCaret`), não pela
    // seleção do DOM — determinístico e não depende de onde cada navegador
    // decide pousar o caret ao redor de um elemento não-editável.
    //
    // Não intercepta o caso normal (cursor em texto, sem embed adjacente):
    // aí as duas funções devolvem false/null e o handler cai no `return`
    // sem `preventDefault`, deixando `beforeinput` cuidar disso como sempre
    // (ver o teste "não intercepta" em `Editor.keydown.test.ts`).
    if (!mod && (e.key === "Backspace" || e.key === "Delete")) {
      // Composição ativa (ex.: acento morto `´` no layout ABC-Extended dispara
      // `compositionstart`) — o modelo ainda não recebeu o texto em
      // composição, só o DOM sabe. Decidir por `getSelectedEmbed`/
      // `isEmbedAdjacentToCaret` aqui enxergaria o embed adjacente do MODELO
      // (que não avançou) e apagaria a imagem em vez de deixar o Backspace
      // corrigir a composição — e ainda travaria a composição no meio, porque
      // `preventDefault` interrompe o IME. Mesma guarda que as linhas 173,
      // 205 e 520 já usam pros outros caminhos de input.
      if (isComposingRef.current) return;
      const direction = e.key === "Backspace" ? "backward" : "forward";
      const shouldIntercept =
        ed.getSelectedEmbed() != null || isEmbedAdjacentToCaret(ctxRef.current, direction);
      if (shouldIntercept) {
        e.preventDefault();
        if (direction === "backward") deleteBackward(ctxRef.current);
        else deleteForward(ctxRef.current);
      }
      return;
    }

    if (!mod) return;
    const key = e.key.toLowerCase();

    if (!e.shiftKey && !e.altKey && key === "z") {
      e.preventDefault();
      historyRef.current.undo();
      return;
    }
    if (!e.altKey && (key === "y" || (e.shiftKey && key === "z"))) {
      e.preventDefault();
      historyRef.current.redo();
      return;
    }

    if (e.altKey && !e.shiftKey && /^[0-6]$/.test(key)) {
      e.preventDefault();
      const n = Number(key);
      if (n === 0) ed.setBlockType("paragraph");
      else ed.setBlockType("heading", { level: n as 1 | 2 | 3 | 4 | 5 | 6 });
      return;
    }

    if (e.shiftKey && !e.altKey && (key === "7" || key === "8")) {
      e.preventDefault();
      ed.toggleList(key === "7" ? "ordered" : "bullet");
      return;
    }

    const markToggle = !e.shiftKey && !e.altKey
      ? (BOOLEAN_SHORTCUTS[key] as MarkName | undefined)
      : undefined;
    if (markToggle) {
      e.preventDefault();
      ed.toggleMark(markToggle);
      return;
    }
    if (e.shiftKey && !e.altKey && key === "x") {
      e.preventDefault();
      ed.toggleMark("strike");
      return;
    }

    if (!e.altKey && !e.shiftKey && key === "k") {
      e.preventDefault();
      const active = ed.getActiveMarks();
      const currentHref =
        active.link && typeof active.link === "object" && "href" in active.link
          ? (active.link.href as string)
          : "";
      void ed.requestLink(currentHref).then((href) => {
        if (href === null) return;
        if (href === "") ed.removeMark("link");
        else ed.setMark("link", { href });
      });
    }
  }, []);

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback((e: React.CompositionEvent<HTMLDivElement>) => {
    isComposingRef.current = false;
    if (e.data && e.data.length > 0) {
      insertText(ctxRef.current, e.data);
    }
  }, []);

  const topLevels = useMemo(() => groupTopLevels(snapshot.blocks), [snapshot]);
  // Chave estrutural dos topLevels: muda só quando a SHAPE muda (tipos,
  // contagem de itens em lists, list kind/style/start), não quando o texto
  // dentro de um block é editado. Usada como dep do `usePageLayout` em
  // lugar do array `topLevels` (cuja referência muda a cada keystroke), o
  // que cortava repaginações desnecessárias — antes 1.3M DOM mutations
  // por ~10 teclas viraram zero. O array `topLevels` em si continua fresh
  // pra `renderSlot` ler o texto atualizado de cada block.
  const topLevelsStructuralKey = useMemo(
    () =>
      topLevels
        .map((t) =>
          t.kind === "list"
            ? `L:${t.listKind}:${t.items.length}:${t.ordinalStart}`
            : `B:${t.block.type}:${t.block.attrs.level ?? ""}`,
        )
        .join("|"),
    [topLevels],
  );
  // Page geometry sources, in precedence order:
  //  1. `pageGeometry` prop when explicitly set (view-only override — does NOT
  //     write back to the Y.Doc; useful for apps that force a fixed size, e.g.
  //     prova generator pinned to A4).
  //  2. `editor.doc` page settings (Y.Doc-backed, sync-aware).
  //  3. `A4_PAGE` fallback when both unavailable.
  // `pageGeometry={null}` continues to disable pagination entirely.
  const docSettings = usePageSettings(editor.doc);
  const propIsSet = pageGeometry !== undefined;
  const geom: PageGeometry = propIsSet ? (pageGeometry ?? A4_PAGE) : docSettings;
  const paginated = pageGeometry !== null;
  // Reads from snapshot + selection; recomputed on every render.
  const selectedEmbed = editor.getSelectedEmbed();

  const { layout, phase: paginationPhase } = usePageLayout(
    rootRef as RefObject<HTMLElement>,
    geom,
    topLevels.length,
    // Usar a chave estrutural (string) em vez do array `topLevels` direto:
    // o array reference muda a cada keystroke, mas a chave só muda quando
    // a SHAPE dos top-levels muda. `usePageLayout` compara deps via
    // `shallowArrayEqual` — string equality cobre isso.
    [topLevelsStructuralKey, pageGeometry],
  );

  const effectiveLayout: PageLayout = paginated ? layout : defaultPageLayout(topLevels.length);

  // pageStyle memoizado: CSS custom properties são HERDADAS, então qualquer
  // toggle de `style` no `.ed-root` invalidava estilos em todos os
  // descendentes (~165k elementos no caso do bug histórico) e alimentava
  // style recalc pesado a cada keystroke. Memo aqui mantém a mesma
  // referência enquanto width/height/margens não mudam.
  const pageStyle = useMemo(
    () =>
      paginated
        ? ({
            "--ed-page-width": `${geom.width}px`,
            "--ed-page-height": `${geom.height}px`,
            "--ed-page-margin-top": `${geom.marginTop}px`,
            "--ed-page-margin-bottom": `${geom.marginBottom}px`,
            "--ed-page-margin-left": `${geom.marginLeft}px`,
            "--ed-page-margin-right": `${geom.marginRight}px`,
          } as React.CSSProperties)
        : undefined,
    [
      paginated,
      geom.width,
      geom.height,
      geom.marginTop,
      geom.marginBottom,
      geom.marginLeft,
      geom.marginRight,
    ],
  );

  const body = (
    <div
      ref={rootRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      autoCorrect="off"
      autoCapitalize="off"
      role="textbox"
      aria-multiline="true"
      className={
        (className ?? "ed-root") + (paginated ? " ed-root--paged" : " ed-root--flat")
      }
      data-pagination-phase={paginated ? paginationPhase : undefined}
      style={pageStyle}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
    >
      {paginated
        ? effectiveLayout.pages.map((page, pi) => {
            const ctx: PageRenderContext = {
              pageNumber: pi + 1,
              pageCount: effectiveLayout.pages.length,
            };
            // Apenas a pág 1 recebe o `firstPageExtraTop` adicional. Inline
            // style sobrescreve a CSS var herdada do `.ed-root` (que vale para
            // as páginas seguintes).
            const pageInlineStyle =
              pi === 0 && geom.firstPageExtraTop
                ? ({
                    "--ed-page-margin-top": `${geom.marginTop + geom.firstPageExtraTop}px`,
                  } as React.CSSProperties)
                : undefined;
            return (
              <div
                key={`page-${pi}`}
                className="ed-page"
                data-page-number={ctx.pageNumber}
                data-page-total={ctx.pageCount}
                style={pageInlineStyle}
              >
                {renderPageHeader && (
                  <div className="ed-page-header" contentEditable={false}>
                    {renderPageHeader(ctx)}
                  </div>
                )}
                <div className="ed-page-content">
                  {page.slots.map((slot) => renderSlot(slot, topLevels))}
                </div>
                {renderPageFooter && (
                  <div className="ed-page-footer" contentEditable={false}>
                    {renderPageFooter(ctx)}
                  </div>
                )}
              </div>
            );
          })
        : topLevels.map((t) => renderTopLevel(t))}
      {selectedEmbed && (
        <ImageResizeOverlay
          rootRef={rootRef}
          blockIndex={selectedEmbed.blockIndex}
          offset={selectedEmbed.offset}
          cellIndex={selectedEmbed.cellIndex}
          embed={selectedEmbed.embed}
          onCommit={(w, h) =>
            editor.setImageAttrs(
              selectedEmbed.blockIndex,
              selectedEmbed.offset,
              { width: w, height: h },
              selectedEmbed.cellIndex,
            )
          }
          onCommitMove={(ox, oy) =>
            editor.setImageAttrs(
              selectedEmbed.blockIndex,
              selectedEmbed.offset,
              { offsetX: ox, offsetY: oy },
              selectedEmbed.cellIndex,
            )
          }
          onReanchor={(to, ox, oy) =>
            editor.moveEmbedAnchor(
              {
                blockIndex: selectedEmbed.blockIndex,
                offset: selectedEmbed.offset,
                cellIndex: selectedEmbed.cellIndex,
              },
              to,
              ox,
              oy,
            )
          }
        />
      )}
      {hoveredBehind &&
        !(
          selectedEmbed &&
          selectedEmbed.blockIndex === hoveredBehind.blockIndex &&
          selectedEmbed.offset === hoveredBehind.offset &&
          (selectedEmbed.cellIndex ?? -1) === (hoveredBehind.cellIndex ?? -1)
        ) && (
          <BehindImageSelectAffordance
            rootRef={rootRef}
            blockIndex={hoveredBehind.blockIndex}
            offset={hoveredBehind.offset}
            cellIndex={hoveredBehind.cellIndex}
            onSelect={() =>
              setSelection({
                anchor: {
                  blockIndex: hoveredBehind.blockIndex,
                  cellIndex: hoveredBehind.cellIndex,
                  offset: hoveredBehind.offset,
                },
                focus: {
                  blockIndex: hoveredBehind.blockIndex,
                  cellIndex: hoveredBehind.cellIndex,
                  offset: hoveredBehind.offset + 1,
                },
              })
            }
          />
        )}
      {hoveredLink && hoveredLink.href && (
        <LinkHoverTooltip href={hoveredLink.href} rect={hoveredLink.rect} />
      )}
      {awareness && (
        <RemoteCursorsOverlay
          rootRef={rootRef}
          doc={doc}
          awareness={awareness}
          revision={snapshot}
        />
      )}
    </div>
  );

  return <EditorProvider editor={editor}>{body}</EditorProvider>;
}

// ---------- Top-level grouping (data, not JSX) ----------

interface ListEntry {
  block: SerializedBlock;
  index: number;
}

type TopLevel =
  | { kind: "block"; block: SerializedBlock; blockIndex: number; key: number }
  | {
      kind: "list";
      items: ListEntry[];
      listKind: ListKind;
      /**
       * Number to seed the `<ol>` `start` attribute. Pulled from the first
       * item's `listStart` attr, defaulting to 1. Only meaningful for
       * `listKind === "ordered"`.
       */
      ordinalStart: number;
      /**
       * Optional CSS `list-style-type` override for this group. Pulled from
       * the first item's `listStyle` attr. Undefined means "use the cascade
       * cycle from sofer-editor.css".
       */
      listStyle?: string;
      key: number;
    };

export function groupTopLevels(snapshot: SerializedBlock[]): TopLevel[] {
  const out: TopLevel[] = [];
  let i = 0;
  while (i < snapshot.length) {
    const block = snapshot[i];
    if (block.type === "listItem") {
      const groupStart = i;
      const items: ListEntry[] = [];
      const kind: ListKind = block.attrs.listKind === "ordered" ? "ordered" : "bullet";
      const leaderLevel = clampListLevel(block.attrs.listLevel);
      const groupStyle = block.attrs.listStyle as string | undefined;
      // A `listStart` on the FIRST item of the group seeds the `<ol start>`.
      // A `listStart` or `listStyle` on a LATER item breaks the group at that
      // item — its first item becomes the seed of the next group.
      while (i < snapshot.length) {
        const b = snapshot[i];
        if (b.type !== "listItem") break;
        // A type change breaks the group whenever the item sits AT OR ABOVE
        // the group leader's level — that's a genuine sibling list of a
        // different type (or a return to a shallower level, which
        // `buildListTree`'s stack treats as a new root, same as the leader).
        // Only a type change STRICTLY DEEPER than the leader stays in the
        // group: that's a sublist (e.g. a bullet sub-list under a numbered
        // item pasted from Word), and `buildListTree` nests it under its
        // parent instead of making it a root.
        const bLevel = clampListLevel(b.attrs.listLevel);
        if (bLevel <= leaderLevel && (b.attrs.listKind ?? "bullet") !== kind) {
          break;
        }
        if (i > groupStart) {
          // Continuation: break the group ONLY when this item EXPLICITLY
          // declares a renumbering. An undefined `listStart` / `listStyle`
          // means "inherit from the current group leader" — that's the
          // common case (user only tags the first item of the new sequence).
          if (typeof b.attrs.listStart === "number") break;
          const itemStyle = b.attrs.listStyle as string | undefined;
          if (itemStyle !== undefined && itemStyle !== groupStyle) break;
        }
        items.push({ block: b, index: i });
        i++;
      }
      const firstAttrs = items[0].block.attrs;
      const ordinalStart =
        typeof firstAttrs.listStart === "number" && firstAttrs.listStart > 0
          ? firstAttrs.listStart
          : 1;
      out.push({
        kind: "list",
        items,
        listKind: kind,
        ordinalStart,
        listStyle: groupStyle,
        key: groupStart,
      });
      continue;
    }
    out.push({ kind: "block", block, blockIndex: i, key: i });
    i++;
  }
  return out;
}

function renderSlot(slot: PageSlot, topLevels: TopLevel[]): JSX.Element | null {
  const top = topLevels[slot.topLevelIndex];
  if (!top) return null;
  if (slot.fragment && top.kind === "block") {
    const f: NodeViewFragment = {
      index: slot.fragment.index,
      start: slot.fragment.start,
      end: slot.fragment.end,
    };
    return (
      <NodeView
        key={`${top.key}-f${f.index}`}
        block={top.block}
        index={top.blockIndex}
        fragment={f}
      />
    );
  }
  if (slot.tableFragment && top.kind === "block" && top.block.type === "table") {
    return (
      <NodeView
        key={`${top.key}-tf${slot.tableFragment.index}`}
        block={top.block}
        index={top.blockIndex}
        tableFragment={slot.tableFragment}
      />
    );
  }
  if (slot.listFragment && top.kind === "list") {
    return renderListFragment(top, slot.listFragment);
  }
  return renderTopLevel(top);
}

export function renderTopLevel(top: TopLevel): JSX.Element {
  if (top.kind === "list") {
    const tree = buildListTree(top.items);
    return renderListTree(tree, top, top.ordinalStart, `list-${top.key}`);
  }
  return <NodeView key={top.key} block={top.block} index={top.blockIndex} />;
}

/**
 * Render a sub-range of a list group's top-level items, as produced by
 * `placeFragmentedList`. The continuation `<ol>` carries an adjusted `start`
 * so numbering remains contiguous across the page break.
 */
export function renderListFragment(top: TopLevel & { kind: "list" }, frag: { index: number; itemStart: number; itemEnd: number }): JSX.Element {
  const ranges = topLevelItemRanges(top.items);
  const startRange = ranges[frag.itemStart];
  const endRange = ranges[frag.itemEnd - 1];
  if (!startRange || !endRange) return renderTopLevel(top);
  const sliced = top.items.slice(startRange[0], endRange[1]);
  // Continuation start = group's seed + count of top-level items already on prior pages.
  const ordinalStart = top.ordinalStart + frag.itemStart;
  const key = `list-${top.key}-f${frag.index}`;
  const slicedTop: TopLevel & { kind: "list" } = { ...top, items: sliced };
  const tree = buildListTree(sliced);
  return renderListTree(tree, slicedTop, ordinalStart, key);
}

/**
 * Index ranges within a flat `ListEntry[]` corresponding to each top-level
 * (level-0) item plus its nested descendants. Used by `renderListFragment` to
 * slice the flat list on a top-level boundary that matches what the paginator
 * measured against direct `<li>` children.
 */
export function topLevelItemRanges(items: ListEntry[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let currentStart = -1;
  items.forEach((it, idx) => {
    const level = clampListLevel(it.block.attrs.listLevel);
    if (level === 0) {
      if (currentStart >= 0) out.push([currentStart, idx]);
      currentStart = idx;
    }
  });
  if (currentStart >= 0) out.push([currentStart, items.length]);
  return out;
}

interface ListNode {
  entry: ListEntry;
  children: ListNode[];
}

function buildListTree(items: ListEntry[]): ListNode[] {
  const roots: ListNode[] = [];
  const stack: { children: ListNode[]; level: number }[] = [{ children: roots, level: -1 }];
  for (const it of items) {
    const level = clampListLevel(it.block.attrs.listLevel);
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node: ListNode = { entry: it, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ children: node.children, level });
  }
  return roots;
}

function renderListTree(
  tree: ListNode[],
  top: TopLevel & { kind: "list" },
  start: number,
  key: string,
): JSX.Element {
  const className = `ed-list ed-list-${top.listKind}`;
  const style: React.CSSProperties | undefined = top.listStyle
    ? { listStyleType: top.listStyle }
    : undefined;
  const items = tree.map((node) => (
    <NodeView key={node.entry.index} block={node.entry.block} index={node.entry.index}>
      {node.children.length > 0
        ? renderNestedListTree(node.children, `nested-${node.entry.index}`)
        : null}
    </NodeView>
  ));
  if (top.listKind === "ordered") {
    return (
      <ol
        key={key}
        className={className}
        data-list-kind="ordered"
        start={start > 1 ? start : undefined}
        style={style}
      >
        {items}
      </ol>
    );
  }
  return (
    <ul key={key} className={className} data-list-kind="bullet" style={style}>
      {items}
    </ul>
  );
}

/**
 * Nested sub-lists never carry an explicit `start`/`listStyle` from a parent
 * item: the cascade in `sofer-editor.css` handles the per-level style cycle
 * (decimal → lower-alpha → lower-roman). Only the TOP-level `<ol>` for a
 * group needs an explicit `start`/`listStyleType`.
 *
 * The sublist's own `listKind` comes from ITS first item, never from the
 * parent/ancestor group. A numbered item pasted from Word can have a bullet
 * sub-list underneath (or vice-versa) — `groupTopLevels` now keeps those
 * together in one group since the type change happens below the group's
 * level-0 leader, so this function must not impose the ancestor's kind on
 * every descendant level.
 */
function renderNestedListTree(tree: ListNode[], key: string): JSX.Element {
  const kind: ListKind = tree[0]?.entry.block.attrs.listKind === "ordered" ? "ordered" : "bullet";
  const Tag = kind === "ordered" ? "ol" : "ul";
  return (
    <Tag key={key} className={`ed-list ed-list-${kind}`} data-list-kind={kind}>
      {tree.map((node) => (
        <NodeView key={node.entry.index} block={node.entry.block} index={node.entry.index}>
          {node.children.length > 0
            ? renderNestedListTree(node.children, `nested-${node.entry.index}`)
            : null}
        </NodeView>
      ))}
    </Tag>
  );
}

function clampListLevel(l: unknown): number {
  if (typeof l !== "number" || !Number.isFinite(l)) return 0;
  return Math.max(0, Math.min(5, Math.trunc(l)));
}

const BOOLEAN_SHORTCUTS: Record<string, MarkName> = {
  b: "bold",
  i: "italic",
  u: "underline",
};

interface CaretRangeFromPoint {
  caretRangeFromPoint(x: number, y: number): Range | null;
}
interface CaretPositionFromPoint {
  caretPositionFromPoint(
    x: number,
    y: number,
  ): { offsetNode: Node; offset: number } | null;
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as unknown as Partial<CaretRangeFromPoint & CaretPositionFromPoint>;
  if (typeof doc.caretRangeFromPoint === "function") {
    return doc.caretRangeFromPoint(x, y);
  }
  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}
