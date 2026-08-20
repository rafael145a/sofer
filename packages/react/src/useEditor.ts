import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_INSERT_WIDTH } from "./imageConstraints";
import { usePageSettings } from "./usePageSettings";
import {
  EditorDocument,
  EditorHistory,
  collapsedSelection,
  dedentList as cmdDedentList,
  deleteTable as cmdDeleteTable,
  deleteTableColumn as cmdDeleteColumn,
  deleteTableRow as cmdDeleteRow,
  insertImage as cmdInsertImage,
  mergeDown as cmdMergeDown,
  mergeRight as cmdMergeRight,
  mergeSelection as cmdMergeSelection,
  moveEmbedAnchor as cmdMoveEmbedAnchor,
  setBlockAttrAtIndex as cmdSetBlockAttrAtIndex,
  setColumnWidth as cmdSetColumnWidth,
  setImageAttrs as cmdSetImageAttrs,
  splitCell as cmdSplitCell,
  tableRectSelection,
  getMarksInRange,
  indentList as cmdIndentList,
  insertAnswerLines as cmdInsertAnswerLines,
  insertTable as cmdInsertTable,
  insertTableColumn as cmdInsertColumn,
  insertTableRow as cmdInsertRow,
  isImageEmbed,
  isMarkUniformInRange,
  moveToNextCell as cmdMoveNextCell,
  moveToPrevCell as cmdMovePrevCell,
  orderedRange,
  removeMark as cmdRemoveMark,
  setBlockAttr as cmdSetBlockAttr,
  setCellAttr as cmdSetCellAttr,
  setBlockType as cmdSetBlockType,
  setMark as cmdSetMark,
  splitListItem as cmdSplitListItem,
  tableLocationOf,
  toggleList as cmdToggleList,
  toggleMark as cmdToggleMark,
  type AlignValue,
  type BlockAttrs,
  type AnswerLineSpacing,
  type BlockType,
  type TableBorderPreset,
  type CommandContext,
  type DeltaOp,
  type EmbedLoc,
  type ImageEmbed,
  type ListKind,
  type MarkAttrs,
  type MarkName,
  type PageSettings,
  type SerializedDocument,
  type Selection,
  type TableLocation,
  type TableRect,
} from "@sofereditor/core";

export interface UseEditorOptions {
  document?: EditorDocument;
  /**
   * Quando definido, `insertImageFromFile` chama esta função pra obter a URL
   * final em vez de embutir o arquivo como data URL base64 no Y.Doc.
   *
   * Use isto quando o app tem storage externo (S3, Azure Blob, etc.) e não quer
   * inflar o documento com imagens base64. O componente `<Editor>` propaga o
   * mesmo upload para paste/drop/file picker.
   */
  uploadImage?: (file: File) => Promise<string>;
}

export type PendingMarks = Partial<Record<MarkName, MarkAttrs[MarkName] | null>>;

export interface LinkRequest {
  initialHref: string;
  resolve: (href: string | null) => void;
  /** Model selection captured when the link was requested (bug #6). */
  selection: Selection;
}

export interface PageConfigRequest {
  initial: PageSettings;
  resolve: (applied: boolean) => void;
}

export type CaptionAlign = "left" | "center" | "right";

export interface ImageCaptionResult {
  caption: string;
  align: CaptionAlign;
}

export interface ImageCaptionRequest {
  initialCaption: string;
  initialAlign: CaptionAlign;
  /**
   * Resolves with the new caption + alignment, or null on cancel. An empty
   * `caption` string means "remove caption" (align is ignored in that case).
   */
  resolve: (result: ImageCaptionResult | null) => void;
}

export interface FormulaResult {
  latex: string;
  display: boolean;
}

export interface FormulaRequest {
  initialLatex: string;
  initialDisplay: boolean;
  /** Resolve com a fórmula, ou null no cancelamento. */
  resolve: (result: FormulaResult | null) => void;
}

export interface UseEditorResult {
  doc: EditorDocument;
  history: EditorHistory;
  /** Snapshot of the model, re-computed on every Y.js update. */
  snapshot: SerializedDocument;
  /** Current model selection. Use `setSelection` to move the caret. */
  selection: Selection;
  setSelection: (sel: Selection) => void;
  /** Stable getter — commands read this to know where the caret is. */
  getSelection: () => Selection;

  // ---- Mark API (added in Sub-phase 2.1) ----
  isMarkActive: (name: MarkName, value?: MarkAttrs[MarkName]) => boolean;
  getActiveMarks: () => Partial<Record<MarkName, MarkAttrs[MarkName] | "mixed">>;
  toggleMark: (name: MarkName, value?: MarkAttrs[MarkName]) => void;
  setMark: (name: MarkName, value: MarkAttrs[MarkName]) => void;
  removeMark: (name: MarkName) => void;

  // ---- Block API (added in Sub-phase 2.2) ----
  /** Returns the type of the focus block (or "mixed" when the selection covers heterogeneous blocks). */
  getBlockType: () => BlockType | "mixed";
  /** Returns one block attribute at the focus block, or "mixed" when not uniform across the selection. */
  getBlockAttr: <K extends keyof BlockAttrs>(key: K) => BlockAttrs[K] | "mixed" | undefined;
  setBlockType: (type: BlockType, attrs?: BlockAttrs) => void;
  setBlockAttr: <K extends keyof BlockAttrs>(key: K, value: BlockAttrs[K] | null) => void;
  setAlign: (value: AlignValue) => void;
  getAlign: () => AlignValue | "mixed" | undefined;
  /** Cor de fundo das células selecionadas (rect) ou da célula focada. `null` remove. No-op fora de tabela. */
  setCellBackground: (color: string | null) => void;
  /** Cor de fundo da célula focada; undefined fora de tabela ou sem cor. */
  getCellBackground: () => string | undefined;
  /** Onde as linhas da grade da tabela focada aparecem. No-op fora de tabela. */
  setTableBorderPreset: (preset: TableBorderPreset) => void;
  /** Preset da tabela focada; "all" fora de tabela ou quando ausente. */
  getTableBorderPreset: () => TableBorderPreset;
  /** Cor das linhas da grade da tabela focada. `null` restaura o padrão. No-op fora de tabela. */
  setTableBorderColor: (color: string | null) => void;
  /** Cor da tabela focada; undefined fora de tabela ou quando usa o padrão. */
  getTableBorderColor: () => string | undefined;

  // ---- List API (added in Sub-phase 2.3) ----
  isListActive: (kind: ListKind) => boolean;
  toggleList: (kind: ListKind) => void;
  indentList: () => void;
  dedentList: () => void;
  /** Returns true when handled (current block is a listItem); false to fall back to insertParagraph. */
  splitListItem: () => boolean;

  /** Marks queued for the next `insertText` (e.g. user pressed Cmd+B with a collapsed caret). */
  pendingMarks: PendingMarks;
  /** Consumed by the input layer right before calling `insertText`. */
  consumePendingMarks: () => PendingMarks | undefined;

  // ---- Link dialog (Polish iteration) ----
  linkRequest: LinkRequest | null;
  /** Open the link dialog; resolves with the entered href, empty string to remove, or null on cancel. */
  requestLink: (initialHref?: string) => Promise<string | null>;
  /** Called by the LinkDialog itself when the user submits or cancels. */
  resolveLinkRequest: (href: string | null) => void;

  // ---- Page settings (Fase 9.6) ----
  /** Reactive page settings snapshot (re-renders when the Y.Doc docSettings changes). */
  pageSettings: PageSettings;
  /** Merge a partial PageSettings into the Y.Doc. Not undoable. */
  setPageSettings: (partial: Partial<PageSettings>) => void;
  /** Page-config dialog request (null when closed). */
  pageConfigRequest: PageConfigRequest | null;
  /** Open the page-config dialog; resolves true on apply, false on cancel. */
  requestPageConfig: () => Promise<boolean>;
  /** Resolver called by `<PageConfigDialog>` on apply/cancel. */
  resolvePageConfigRequest: (applied: boolean) => void;

  // ---- Image caption (Fase 9.6+) ----
  imageCaptionRequest: ImageCaptionRequest | null;
  /** Open the image-caption dialog with the current caption + alignment pre-filled. */
  requestImageCaption: (
    initialCaption?: string,
    initialAlign?: CaptionAlign,
  ) => Promise<ImageCaptionResult | null>;
  /** Resolver called by `<ImageCaptionDialog>` on apply/cancel. */
  resolveImageCaptionRequest: (result: ImageCaptionResult | null) => void;

  // ---- Fórmula matemática ----
  formulaRequest: FormulaRequest | null;
  requestFormula: (
    initialLatex?: string,
    initialDisplay?: boolean,
  ) => Promise<FormulaResult | null>;
  resolveFormulaRequest: (result: FormulaResult | null) => void;
  /** Renderiza o LaTeX, gera SVG + PNG e insere como embed na seleção. */
  insertFormula: (latex: string, display: boolean) => Promise<void>;

  // ---- Tables (Phase 4) ----
  /** True iff the focus position lies inside a table cell. */
  isInTable: () => boolean;
  /** Returns `{blockIndex, row, col}` for the focus position, or null when outside a table. */
  getTableLocation: () => TableLocation | null;
  /** Insere `count` linhas de resposta pautadas depois do bloco focado. */
  insertAnswerLines: (count: number, spacing: AnswerLineSpacing) => void;
  insertTable: (rows: number, cols: number) => void;
  /** Removes the table at `blockIndex`. Defaults to the current focus table. */
  deleteTable: (blockIndex?: number) => void;
  insertRowAbove: () => void;
  insertRowBelow: () => void;
  deleteCurrentRow: () => void;
  insertColumnLeft: () => void;
  insertColumnRight: () => void;
  deleteCurrentColumn: () => void;
  moveToNextCell: () => void;
  moveToPrevCell: () => void;
  mergeRight: () => boolean;
  mergeDown: () => boolean;
  splitCell: () => boolean;
  setColumnWidth: (blockIndex: number, col: number, widthPx: number) => void;
  /** Returns the table rectangle if the current selection is a multi-cell range, else null. */
  getTableRect: () => TableRect | null;
  /** True when there's a rectangular table-cell selection. */
  hasTableRectSelection: () => boolean;
  /** Merge every cell in the rectangular selection. Returns true on success. */
  mergeSelection: () => boolean;

  // ---- Inline images (Fase 5) ----
  insertImage: (embed: ImageEmbed) => void;
  setImageAttrs: (
    blockIndex: number,
    offset: number,
    partial: Partial<ImageEmbed>,
    cellIndex?: number,
    newOffset?: number,
  ) => void;
  /**
   * Move a floating image embed from one anchor to another (re-anchor across
   * blocks/pages) in a single transaction. No-op for inline embeds.
   */
  moveEmbedAnchor: (
    from: EmbedLoc,
    to: EmbedLoc,
    newOffsetX: number,
    newOffsetY: number,
  ) => void;
  /** Read a File (image) and insert it inline at the caret as a data-URL embed. */
  insertImageFromFile: (file: File) => Promise<void>;
  /**
   * Returns the embed currently selected (single 1-char range over an image),
   * or null when no embed is solely selected.
   */
  getSelectedEmbed: () =>
    | { blockIndex: number; offset: number; cellIndex?: number; embed: ImageEmbed }
    | null;
  /**
   * Passthrough of `UseEditorOptions.uploadImage` — `undefined` when not
   * configured. Exposed so callers with the editor instance but not the
   * original options (the `<Editor>` component's paste handler, notably) can
   * upload an image without going through `insertImageFromFile` (which also
   * inserts it — not always what's wanted, e.g. resolving `data:` embeds
   * already inside a pasted slice before `insertSlice`).
   */
  uploadImage?: (file: File) => Promise<string>;
}

export function useEditor(opts: UseEditorOptions = {}): UseEditorResult {
  const doc = useMemo(() => opts.document ?? new EditorDocument(), [opts.document]);
  const history = useMemo(() => new EditorHistory(doc), [doc]);

  const [snapshot, setSnapshot] = useState<SerializedDocument>(() => doc.toJSON());
  const [selection, setSelectionState] = useState<Selection>(() =>
    collapsedSelection({ blockIndex: 0, offset: 0 }),
  );
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // pendingMarks lives on a ref so the beforeinput handler reads the latest value
  // without re-binding listeners on every render. The state copy exists so the
  // Toolbar can render a "pressed" hint when a mark is armed at a collapsed caret.
  const pendingMarksRef = useRef<PendingMarks>({});
  const [pendingMarks, setPendingMarksState] = useState<PendingMarks>({});

  const setPendingMarks = useCallback((next: PendingMarks) => {
    pendingMarksRef.current = next;
    setPendingMarksState(next);
  }, []);

  useEffect(() => {
    // Coalesce snapshot recomputation: `afterTransaction` fires per Y.js
    // transaction, which means once per keystroke for normal typing — but on
    // paste / multi-op commands it can fire N times in a microtask burst.
    // `toJSON()` is expensive for docs with embedded images (each call deep-
    // clones every block's delta, including base64 image src). Coalescing
    // into rAF guarantees at most one recompute per animation frame regardless
    // of how many transactions fire underneath. A pending flag avoids
    // scheduling multiple rAFs.
    let scheduled = false;
    let cancelled = false;
    let frame = 0 as number | ReturnType<typeof requestAnimationFrame>;
    const flush = () => {
      scheduled = false;
      if (cancelled) return;
      setSnapshot(doc.toJSON());
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      // Use rAF when available (browser), fall back to microtask in jsdom/Node.
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(flush);
      } else {
        queueMicrotask(flush);
      }
    };
    doc.ydoc.on("afterTransaction", schedule);
    return () => {
      cancelled = true;
      if (
        scheduled &&
        typeof requestAnimationFrame === "function" &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(frame as number);
      }
      doc.ydoc.off("afterTransaction", schedule);
    };
  }, [doc]);

  const getSelection = useCallback(() => selectionRef.current, []);
  const setSelection = useCallback(
    (sel: Selection) => {
      const prev = selectionRef.current;
      selectionRef.current = sel;
      setSelectionState(sel);
      // Any caret movement that isn't a direct typing follow-up clears the queue.
      if (
        Object.keys(pendingMarksRef.current).length > 0 &&
        (prev.focus.blockIndex !== sel.focus.blockIndex || prev.focus.offset !== sel.focus.offset)
      ) {
        // Heuristic: typing advances the caret by exactly 1; everything else clears.
        const advancedByOne =
          prev.focus.blockIndex === sel.focus.blockIndex &&
          sel.focus.offset === prev.focus.offset + 1;
        if (!advancedByOne) {
          pendingMarksRef.current = {};
          setPendingMarksState({});
        }
      }
    },
    [],
  );

  const ctxRef = useRef<CommandContext>({ doc, getSelection, setSelection });
  ctxRef.current = { doc, getSelection, setSelection };

  const consumePendingMarks = useCallback((): PendingMarks | undefined => {
    const current = pendingMarksRef.current;
    if (Object.keys(current).length === 0) return undefined;
    pendingMarksRef.current = {};
    setPendingMarksState({});
    return current;
  }, []);

  const isMarkActive = useCallback(
    (name: MarkName, value?: MarkAttrs[MarkName]): boolean => {
      const sel = selectionRef.current;
      const { start, end } = orderedRange(sel);
      if (start.blockIndex === end.blockIndex && start.offset === end.offset) {
        // Collapsed: union of pending and ambient (mark of the char immediately before caret).
        const pending = pendingMarksRef.current[name];
        if (pending !== undefined) {
          if (pending === null) return false;
          return value === undefined ? true : sameValue(pending, value);
        }
        const yText = doc.getBlockText(start.blockIndex);
        if (!yText || start.offset === 0) return false;
        return isMarkUniformInRange(yText, start.offset - 1, start.offset, name, value);
      }
      if (start.blockIndex !== end.blockIndex) {
        // Multi-block: active only if uniformly active on every covered slice.
        for (let i = start.blockIndex; i <= end.blockIndex; i++) {
          const yText = doc.getBlockText(i);
          if (!yText) return false;
          const s = i === start.blockIndex ? start.offset : 0;
          const e = i === end.blockIndex ? end.offset : yText.length;
          if (s >= e) continue;
          if (!isMarkUniformInRange(yText, s, e, name, value)) return false;
        }
        return true;
      }
      const yText = doc.getBlockText(start.blockIndex);
      if (!yText) return false;
      return isMarkUniformInRange(yText, start.offset, end.offset, name, value);
    },
    [doc],
  );

  const getActiveMarks = useCallback(() => {
    const sel = selectionRef.current;
    const { start, end } = orderedRange(sel);
    if (start.blockIndex !== end.blockIndex) {
      // For Sub-phase 2.1 we conservatively report empty across multi-block selections.
      return {};
    }
    const yText = doc.getBlockText(start.blockIndex);
    if (!yText) return {};
    if (start.offset === end.offset) {
      if (start.offset === 0) return {};
      return getMarksInRange(yText, start.offset - 1, start.offset);
    }
    return getMarksInRange(yText, start.offset, end.offset);
  }, [doc]);

  const toggleMark = useCallback(
    (name: MarkName, value?: MarkAttrs[MarkName]) => {
      const sel = selectionRef.current;
      const { start, end } = orderedRange(sel);
      const isCollapsed = start.blockIndex === end.blockIndex && start.offset === end.offset;
      if (isCollapsed) {
        // Queue for next insert.
        const next: PendingMarks = { ...pendingMarksRef.current };
        const currentlyActive = isMarkActive(name, value);
        if (currentlyActive) {
          next[name] = null;
        } else {
          next[name] = value ?? (booleanMarks.has(name) ? true : null);
        }
        setPendingMarks(next);
        return;
      }
      cmdToggleMark(ctxRef.current, name, value);
    },
    [isMarkActive, setPendingMarks],
  );

  const setMark = useCallback(
    (name: MarkName, value: MarkAttrs[MarkName]) => {
      const sel = selectionRef.current;
      const { start, end } = orderedRange(sel);
      const isCollapsed = start.blockIndex === end.blockIndex && start.offset === end.offset;
      if (isCollapsed) {
        setPendingMarks({ ...pendingMarksRef.current, [name]: value });
        return;
      }
      cmdSetMark(ctxRef.current, name, value);
    },
    [setPendingMarks],
  );

  const removeMark = useCallback(
    (name: MarkName) => {
      const sel = selectionRef.current;
      const { start, end } = orderedRange(sel);
      const isCollapsed = start.blockIndex === end.blockIndex && start.offset === end.offset;
      if (isCollapsed) {
        setPendingMarks({ ...pendingMarksRef.current, [name]: null });
        return;
      }
      cmdRemoveMark(ctxRef.current, name);
    },
    [setPendingMarks],
  );

  const getBlockType = useCallback((): BlockType | "mixed" => {
    const sel = selectionRef.current;
    const { start, end } = orderedRange(sel);
    const first = doc.getBlockType(start.blockIndex);
    if (first === undefined) return "paragraph";
    for (let i = start.blockIndex + 1; i <= end.blockIndex; i++) {
      if (doc.getBlockType(i) !== first) return "mixed";
    }
    return first;
  }, [doc]);

  const getBlockAttr = useCallback(
    <K extends keyof BlockAttrs>(key: K): BlockAttrs[K] | "mixed" | undefined => {
      const sel = selectionRef.current;
      const { start, end } = orderedRange(sel);
      const first = doc.getBlockAttrs(start.blockIndex)[key];
      for (let i = start.blockIndex + 1; i <= end.blockIndex; i++) {
        const next = doc.getBlockAttrs(i)[key];
        if (next !== first) return "mixed";
      }
      return first;
    },
    [doc],
  );

  const setBlockType = useCallback((type: BlockType, attrs?: BlockAttrs) => {
    cmdSetBlockType(ctxRef.current, type, attrs);
  }, []);

  const setBlockAttr = useCallback(
    <K extends keyof BlockAttrs>(key: K, value: BlockAttrs[K] | null) => {
      cmdSetBlockAttr(ctxRef.current, key, value);
    },
    [],
  );

  const setAlign = useCallback((value: AlignValue) => {
    const sel = selectionRef.current;
    // Route on focus only: setCellAttr keys off sel.focus.cellIndex internally
    // and returns early unless the focus position is inside a table cell.
    const inCell = sel.focus.cellIndex != null;
    if (inCell) cmdSetCellAttr(ctxRef.current, "align", value);
    else cmdSetBlockAttr(ctxRef.current, "align", value);
  }, []);

  const getAlign = useCallback((): AlignValue | "mixed" | undefined => {
    const sel = selectionRef.current;
    if (sel.focus.cellIndex != null && doc.isTable(sel.focus.blockIndex)) {
      // Cell path: single focused-cell read (multi-cell mixed-state is out of scope).
      return doc.getCellAttrs(sel.focus.blockIndex, sel.focus.cellIndex).align;
    }
    // Block path: delegate to getBlockAttr so multi-block selections return "mixed".
    return getBlockAttr("align");
  }, [doc, getBlockAttr]);

  const setCellBackground = useCallback((color: string | null) => {
    // setCellAttr keys off sel.focus.cellIndex internally: applies to the
    // rect selection (or the focused cell) and no-ops outside a table.
    cmdSetCellAttr(ctxRef.current, "bgColor", color);
  }, []);

  const getCellBackground = useCallback((): string | undefined => {
    const sel = selectionRef.current;
    if (sel.focus.cellIndex == null || !doc.isTable(sel.focus.blockIndex)) return undefined;
    // Single focused-cell read, like getAlign (multi-cell mixed-state out of scope).
    return doc.getCellAttrs(sel.focus.blockIndex, sel.focus.cellIndex).bgColor;
  }, [doc]);

  const setTableBorderPreset = useCallback((preset: TableBorderPreset) => {
    const sel = selectionRef.current;
    if (!doc.isTable(sel.focus.blockIndex)) return;
    // setBlockAttr é inerte com o caret dentro de uma célula — que é sempre o
    // caso aqui. Por isso a escrita é por índice de bloco.
    cmdSetBlockAttrAtIndex(ctxRef.current, sel.focus.blockIndex, "borderPreset", preset);
  }, [doc]);

  const getTableBorderPreset = useCallback((): TableBorderPreset => {
    const sel = selectionRef.current;
    if (!doc.isTable(sel.focus.blockIndex)) return "all";
    return doc.getBlockAttrs(sel.focus.blockIndex).borderPreset ?? "all";
  }, [doc]);

  const setTableBorderColor = useCallback((color: string | null) => {
    const sel = selectionRef.current;
    if (!doc.isTable(sel.focus.blockIndex)) return;
    cmdSetBlockAttrAtIndex(ctxRef.current, sel.focus.blockIndex, "borderColor", color);
  }, [doc]);

  const getTableBorderColor = useCallback((): string | undefined => {
    const sel = selectionRef.current;
    if (!doc.isTable(sel.focus.blockIndex)) return undefined;
    return doc.getBlockAttrs(sel.focus.blockIndex).borderColor;
  }, [doc]);

  const isListActive = useCallback(
    (kind: ListKind): boolean => {
      const sel = selectionRef.current;
      const { start, end } = orderedRange(sel);
      for (let i = start.blockIndex; i <= end.blockIndex; i++) {
        if (doc.getBlockType(i) !== "listItem") return false;
        if (doc.getBlockAttrs(i).listKind !== kind) return false;
      }
      return true;
    },
    [doc],
  );

  const toggleList = useCallback((kind: ListKind) => {
    cmdToggleList(ctxRef.current, kind);
  }, []);
  const indentList = useCallback(() => {
    cmdIndentList(ctxRef.current);
  }, []);
  const dedentList = useCallback(() => {
    cmdDedentList(ctxRef.current);
  }, []);
  const splitListItem = useCallback((): boolean => {
    return cmdSplitListItem(ctxRef.current);
  }, []);

  // ---- Tables ----
  const isInTable = useCallback((): boolean => {
    return selectionRef.current.focus.cellIndex != null;
  }, []);
  const getTableLocation = useCallback((): TableLocation | null => {
    return tableLocationOf(doc, selectionRef.current.focus);
  }, [doc]);
  const insertTable = useCallback((rows: number, cols: number) => {
    cmdInsertTable(ctxRef.current, rows, cols);
  }, []);
  const insertAnswerLines = useCallback((count: number, spacing: AnswerLineSpacing) => {
    cmdInsertAnswerLines(ctxRef.current, count, spacing);
  }, []);
  const deleteTable = useCallback((blockIndex?: number) => {
    const idx = blockIndex ?? selectionRef.current.focus.blockIndex;
    cmdDeleteTable(ctxRef.current, idx);
  }, []);
  const insertRowAbove = useCallback(() => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return;
    cmdInsertRow(ctxRef.current, loc.blockIndex, loc.row, "before");
  }, [doc]);
  const insertRowBelow = useCallback(() => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return;
    cmdInsertRow(ctxRef.current, loc.blockIndex, loc.row, "after");
  }, [doc]);
  const deleteCurrentRow = useCallback(() => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return;
    cmdDeleteRow(ctxRef.current, loc.blockIndex, loc.row);
  }, [doc]);
  const insertColumnLeft = useCallback(() => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return;
    cmdInsertColumn(ctxRef.current, loc.blockIndex, loc.col, "before");
  }, [doc]);
  const insertColumnRight = useCallback(() => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return;
    cmdInsertColumn(ctxRef.current, loc.blockIndex, loc.col, "after");
  }, [doc]);
  const deleteCurrentColumn = useCallback(() => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return;
    cmdDeleteColumn(ctxRef.current, loc.blockIndex, loc.col);
  }, [doc]);
  const moveToNextCell = useCallback(() => {
    cmdMoveNextCell(ctxRef.current);
  }, []);
  const moveToPrevCell = useCallback(() => {
    cmdMovePrevCell(ctxRef.current);
  }, []);
  const mergeRight = useCallback((): boolean => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return false;
    return cmdMergeRight(ctxRef.current, loc.blockIndex, loc.row, loc.col);
  }, [doc]);
  const mergeDown = useCallback((): boolean => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return false;
    return cmdMergeDown(ctxRef.current, loc.blockIndex, loc.row, loc.col);
  }, [doc]);
  const splitCell = useCallback((): boolean => {
    const loc = tableLocationOf(doc, selectionRef.current.focus);
    if (!loc) return false;
    return cmdSplitCell(ctxRef.current, loc.blockIndex, loc.row, loc.col);
  }, [doc]);
  const setColumnWidth = useCallback(
    (blockIndex: number, col: number, widthPx: number) => {
      cmdSetColumnWidth(ctxRef.current, blockIndex, col, widthPx);
    },
    [],
  );
  const getTableRect = useCallback(
    () => tableRectSelection(doc, selectionRef.current),
    [doc],
  );
  const hasTableRectSelection = useCallback((): boolean => {
    return tableRectSelection(doc, selectionRef.current) !== null;
  }, [doc]);
  const mergeSelection = useCallback((): boolean => {
    return cmdMergeSelection(ctxRef.current);
  }, []);

  // ---- Inline images ----
  const insertImage = useCallback((embed: ImageEmbed) => {
    cmdInsertImage(ctxRef.current, embed);
  }, []);
  const setImageAttrs = useCallback(
    (
      blockIndex: number,
      offset: number,
      partial: Partial<ImageEmbed>,
      cellIndex?: number,
      newOffset?: number,
    ) => {
      cmdSetImageAttrs(ctxRef.current, blockIndex, offset, partial, cellIndex, newOffset);
    },
    [],
  );
  const moveEmbedAnchor = useCallback(
    (from: EmbedLoc, to: EmbedLoc, newOffsetX: number, newOffsetY: number) => {
      cmdMoveEmbedAnchor(ctxRef.current, from, to, newOffsetX, newOffsetY);
    },
    [],
  );
  const uploadImageRef = useRef(opts.uploadImage);
  uploadImageRef.current = opts.uploadImage;
  const insertImageFromFile = useCallback(async (file: File): Promise<void> => {
    if (!file.type.startsWith("image/")) return;
    // Lê dimensões a partir de um dataUrl temporário em ambos os caminhos
    // (lê o arquivo só uma vez; o uploadImage decide se persiste essa data
    // ou faz upload pra um storage externo).
    const dataUrl = await readAsDataURL(file);
    const dims = await readImageDimensions(dataUrl);
    let w = dims.width;
    let h = dims.height;
    if (w > MAX_INSERT_WIDTH) {
      h = Math.round((h * MAX_INSERT_WIDTH) / w);
      w = MAX_INSERT_WIDTH;
    }
    const upload = uploadImageRef.current;
    const src = upload ? await upload(file) : dataUrl;
    cmdInsertImage(ctxRef.current, { type: "image", src, width: w, height: h });
  }, []);
  const getSelectedEmbed = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.anchor.blockIndex !== sel.focus.blockIndex) return null;
    if ((sel.anchor.cellIndex ?? -1) !== (sel.focus.cellIndex ?? -1)) return null;
    const a = sel.anchor.offset;
    const b = sel.focus.offset;
    if (Math.abs(a - b) !== 1) return null;
    const start = Math.min(a, b);
    const yText = doc.textAt(sel.anchor.blockIndex, sel.anchor.cellIndex);
    if (!yText) return null;
    const delta = yText.toDelta() as DeltaOp[];
    let cursor = 0;
    for (const op of delta) {
      if (typeof op.insert === "string") {
        cursor += op.insert.length;
        continue;
      }
      if (cursor === start && isImageEmbed(op.insert)) {
        return {
          blockIndex: sel.anchor.blockIndex,
          cellIndex: sel.anchor.cellIndex,
          offset: start,
          embed: op.insert,
        };
      }
      cursor += 1;
    }
    return null;
  }, [doc]);

  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const linkRequestRef = useRef<LinkRequest | null>(null);
  const requestLink = useCallback((initialHref = ""): Promise<string | null> => {
    return new Promise((resolve) => {
      // Capture the model selection NOW (bug #6): the modal round-trip can
      // collapse it (the editor refocuses on close → selectionchange overwrites
      // the model), and the consumer applies the link mark AFTER the modal —
      // a no-op on a collapsed selection. We restore it on resolve.
      const req: LinkRequest = { initialHref, resolve, selection: selectionRef.current };
      linkRequestRef.current = req;
      setLinkRequest(req);
    });
  }, []);
  const resolveLinkRequest = useCallback(
    (href: string | null) => {
      const req = linkRequestRef.current;
      linkRequestRef.current = null;
      setLinkRequest(null);
      if (req) {
        // Restore the captured selection so the consumer's setMark applies to
        // the originally-selected text even if the modal collapsed it.
        setSelection(req.selection);
        req.resolve(href);
      }
    },
    [setSelection],
  );

  // ---- Page settings ----
  const pageSettings = usePageSettings(doc);
  const setPageSettings = useCallback(
    (partial: Partial<PageSettings>) => {
      doc.setPageSettings(partial);
    },
    [doc],
  );
  const [pageConfigRequest, setPageConfigRequest] = useState<PageConfigRequest | null>(null);
  const requestPageConfig = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      setPageConfigRequest({ initial: doc.getPageSettings(), resolve });
    });
  }, [doc]);
  const resolvePageConfigRequest = useCallback((applied: boolean) => {
    setPageConfigRequest((prev) => {
      if (prev) prev.resolve(applied);
      return null;
    });
  }, []);

  // ---- Image caption ----
  const [imageCaptionRequest, setImageCaptionRequest] =
    useState<ImageCaptionRequest | null>(null);
  const requestImageCaption = useCallback(
    (initialCaption = "", initialAlign: CaptionAlign = "center"): Promise<ImageCaptionResult | null> => {
      return new Promise((resolve) => {
        setImageCaptionRequest({ initialCaption, initialAlign, resolve });
      });
    },
    [],
  );
  const resolveImageCaptionRequest = useCallback((result: ImageCaptionResult | null) => {
    setImageCaptionRequest((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  // ---- Fórmula ----
  const [formulaRequest, setFormulaRequest] = useState<FormulaRequest | null>(null);
  const requestFormula = useCallback(
    (initialLatex = "", initialDisplay = false): Promise<FormulaResult | null> => {
      return new Promise((resolve) => {
        setFormulaRequest({ initialLatex, initialDisplay, resolve });
      });
    },
    [],
  );
  const resolveFormulaRequest = useCallback((result: FormulaResult | null) => {
    setFormulaRequest((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  const insertFormula = useCallback(
    async (latex: string, display: boolean): Promise<void> => {
      // Import DINÂMICO, pelo mesmo motivo do modal: manter o mathjax-full
      // fora do bundle principal. Como esta função já é async, não custa nada.
      let mathModule: typeof import("@sofereditor/math");
      try {
        mathModule = await import("@sofereditor/math");
      } catch {
        // Chunk falhou ao carregar (ex.: deploy do portal trocou o hash dos
        // assets enquanto a aba estava aberta). Sair em silêncio é certo
        // aqui: quem chama `insertFormula` só chega depois de já ter visto
        // o preview funcionar no modal (mesmo import, resolvido lá) — o
        // feedback de erro é responsabilidade do `FormulaDialog`, não desta
        // função.
        return;
      }
      const { renderLatexToSvg, measureExInPx, svgToDataUrl, svgToPngDataUrl } = mathModule;
      const r = renderLatexToSvg(latex, display);
      if (!r.ok) return; // o modal já barra isto; aqui é cinto de segurança
      // `useEditor` não tem ref do elemento raiz — conferido. `.ed-root` é o
      // mesmo seletor que TableFloatingToolbar usa para achar a raiz do editor.
      // Medir no <body> daria o font-size do documento HTML, não o do editor.
      const root = document.querySelector<HTMLElement>(".ed-root");
      const exPx = root ? measureExInPx(root) : 8;
      let w = Math.round(r.widthEx * exPx);
      let h = Math.round(r.heightEx * exPx);
      if (w > MAX_INSERT_WIDTH) {
        h = Math.round((h * MAX_INSERT_WIDTH) / w);
        w = MAX_INSERT_WIDTH;
      }
      const src = svgToDataUrl(r.svg);
      let svgFallback: string | undefined;
      try {
        svgFallback = await svgToPngDataUrl(r.svg, w, h);
      } catch {
        // Sem PNG a fórmula ainda entra no documento e sai no PDF; só o DOCX
        // vai pular esse embed, contando em `skipped`. Melhor que não inserir.
        svgFallback = undefined;
      }
      cmdInsertImage(ctxRef.current, {
        type: "image",
        src,
        width: w,
        height: h,
        ...(display ? { align: "center" as const } : {}),
        formula: {
          latex,
          display,
          ...(display ? {} : { vAlign: `${r.vAlignEx}ex` }),
        },
        ...(svgFallback ? { svgFallback } : {}),
      });
    },
    [],
  );

  return {
    doc,
    history,
    snapshot,
    selection,
    setSelection,
    getSelection,
    isMarkActive,
    getActiveMarks,
    toggleMark,
    setMark,
    removeMark,
    pendingMarks,
    consumePendingMarks,
    getBlockType,
    getBlockAttr,
    setBlockType,
    setBlockAttr,
    setAlign,
    getAlign,
    setCellBackground,
    getCellBackground,
    setTableBorderPreset,
    getTableBorderPreset,
    setTableBorderColor,
    getTableBorderColor,
    isListActive,
    toggleList,
    indentList,
    dedentList,
    splitListItem,
    linkRequest,
    requestLink,
    resolveLinkRequest,
    isInTable,
    getTableLocation,
    insertAnswerLines,
    insertTable,
    deleteTable,
    insertRowAbove,
    insertRowBelow,
    deleteCurrentRow,
    insertColumnLeft,
    insertColumnRight,
    deleteCurrentColumn,
    moveToNextCell,
    moveToPrevCell,
    mergeRight,
    mergeDown,
    splitCell,
    setColumnWidth,
    getTableRect,
    hasTableRectSelection,
    mergeSelection,
    insertImage,
    setImageAttrs,
    moveEmbedAnchor,
    insertImageFromFile,
    getSelectedEmbed,
    pageSettings,
    setPageSettings,
    pageConfigRequest,
    requestPageConfig,
    resolvePageConfigRequest,
    imageCaptionRequest,
    requestImageCaption,
    resolveImageCaptionRequest,
    formulaRequest,
    requestFormula,
    resolveFormulaRequest,
    insertFormula,
    uploadImage: opts.uploadImage,
  };
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("image load failed"));
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = src;
  });
}

const booleanMarks: Set<MarkName> = new Set(["bold", "italic", "underline", "strike"]);

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "object" && a && b && typeof b === "object") {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
  }
  return false;
}
