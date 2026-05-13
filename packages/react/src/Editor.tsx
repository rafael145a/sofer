import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  deleteBackward,
  deleteForward,
  insertParagraph,
  insertText,
  type CommandContext,
  type ListKind,
  type MarkName,
  type SerializedBlock,
} from "@editor/core";
import { applyDomSelection, readDomSelection, selectionsEqual } from "./dom-bridge";
import { EditorProvider } from "./EditorContext";
import { ImageResizeOverlay } from "./ImageResizeOverlay";
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
}

const defaultFooter: PageRenderProp = ({ pageNumber, pageCount }) =>
  `${pageNumber} / ${pageCount}`;

export function Editor({
  editor: providedEditor,
  className,
  pageGeometry,
  renderPageHeader,
  renderPageFooter = defaultFooter,
}: EditorProps): JSX.Element {
  const internal = useEditor();
  const editor = providedEditor ?? internal;
  const { doc, history, snapshot, getSelection, setSelection } = editor;

  const rootRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const suppressSelectionSyncRef = useRef(false);

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
    suppressSelectionSyncRef.current = true;
    applyDomSelection(root, editor.selection);
    queueMicrotask(() => {
      suppressSelectionSyncRef.current = false;
    });
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handler = () => {
      if (suppressSelectionSyncRef.current) return;
      if (isComposingRef.current) return;
      if (document.activeElement !== root) return;
      const modelSel = readDomSelection(root);
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
        case "insertParagraph":
        case "insertLineBreak": {
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
          e.preventDefault();
          const images = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (images.length > 0) {
            void (async () => {
              for (const f of images) await editorRef.current.insertImageFromFile(f);
            })();
            return;
          }
          const text = e.dataTransfer?.getData("text/plain") ?? "";
          if (text.length === 0) return;
          const lines = text.split(/\r\n|\r|\n/);
          lines.forEach((line, i) => {
            if (i > 0) insertParagraph(ctx);
            if (line.length > 0) insertText(ctx, line);
          });
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

  const layout = usePageLayout(
    rootRef as RefObject<HTMLElement>,
    geom,
    topLevels.length,
    [topLevels, pageGeometry],
  );

  const effectiveLayout: PageLayout = paginated ? layout : defaultPageLayout(topLevels.length);

  const pageStyle = paginated
    ? ({
        "--ed-page-width": `${geom.width}px`,
        "--ed-page-height": `${geom.height}px`,
        "--ed-page-margin-top": `${geom.marginTop}px`,
        "--ed-page-margin-bottom": `${geom.marginBottom}px`,
        "--ed-page-margin-left": `${geom.marginLeft}px`,
        "--ed-page-margin-right": `${geom.marginRight}px`,
      } as React.CSSProperties)
    : undefined;

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
            return (
              <div
                key={`page-${pi}`}
                className="ed-page"
                data-page-number={ctx.pageNumber}
                data-page-total={ctx.pageCount}
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
  | { kind: "list"; items: ListEntry[]; listKind: ListKind; key: number };

function groupTopLevels(snapshot: SerializedBlock[]): TopLevel[] {
  const out: TopLevel[] = [];
  let i = 0;
  while (i < snapshot.length) {
    const block = snapshot[i];
    if (block.type === "listItem") {
      const groupStart = i;
      const items: ListEntry[] = [];
      const kind: ListKind = block.attrs.listKind === "ordered" ? "ordered" : "bullet";
      while (
        i < snapshot.length &&
        snapshot[i].type === "listItem" &&
        (snapshot[i].attrs.listKind ?? "bullet") === kind
      ) {
        items.push({ block: snapshot[i], index: i });
        i++;
      }
      out.push({ kind: "list", items, listKind: kind, key: groupStart });
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
  return renderTopLevel(top);
}

function renderTopLevel(top: TopLevel): JSX.Element {
  if (top.kind === "list") {
    const tree = buildListTree(top.items);
    return renderListTree(tree, top.listKind, `list-${top.key}`);
  }
  return <NodeView key={top.key} block={top.block} index={top.blockIndex} />;
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

function renderListTree(tree: ListNode[], kind: ListKind, key: string): JSX.Element {
  const Tag = kind === "ordered" ? "ol" : "ul";
  return (
    <Tag key={key} className={`ed-list ed-list-${kind}`} data-list-kind={kind}>
      {tree.map((node) => (
        <NodeView key={node.entry.index} block={node.entry.block} index={node.entry.index}>
          {node.children.length > 0
            ? renderListTree(node.children, kind, `nested-${node.entry.index}`)
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
