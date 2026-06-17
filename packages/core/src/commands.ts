import * as Y from "yjs";
import { EditorDocument, createBlock, createCell, createTableBlock, spanOf } from "./document";
import { deltaLength, isMarkUniformInRange, sliceDelta } from "./marks";
import { sliceToInlineDelta, type ClipboardSlice } from "./clipboard";
import { defaultAttrsFor } from "./schema";
import { collapsedSelection, isCollapsed, orderedRange, sameTextRun } from "./selection";
import type {
  BlockAttrs,
  BlockType,
  CellAttrs,
  DeltaOp,
  ImageEmbed,
  ListKind,
  MarkAttrs,
  MarkName,
  Position,
  Selection,
} from "./types";
import { isImageEmbed, MAX_LIST_LEVEL } from "./types";

export const COMMAND_ORIGIN: unique symbol = Symbol("editor-command");

export interface CommandContext {
  doc: EditorDocument;
  getSelection: () => Selection;
  setSelection: (sel: Selection) => void;
}

function transact(doc: EditorDocument, fn: () => void): void {
  doc.ydoc.transact(fn, COMMAND_ORIGIN);
}

/**
 * Insert text at the current selection.
 *
 * `marks` is an explicit override map applied to the freshly inserted range.
 * - Entry value: apply that mark value.
 * - Entry value `null`: clear that mark (used when the UI just toggled it off
 *   with a collapsed caret and the next typed char must NOT inherit the
 *   surrounding run's attribute).
 * - When `marks` is undefined, Y.Text's default inheritance applies (good for
 *   normal typing inside a marked run).
 */
export function insertText(
  ctx: CommandContext,
  text: string,
  marks?: Partial<Record<MarkName, MarkAttrs[MarkName] | null>>,
): void {
  if (text.length === 0) return;
  // Rectangular cell selection: clear all selected cells, collapse to top-left,
  // then insert into the owner like a normal call.
  const collapsedFromRect = clearRectCells(ctx);
  transact(ctx.doc, () => {
    const sel = collapsedFromRect ?? ctx.getSelection();
    let cursor = sel;
    if (!isCollapsed(sel)) {
      cursor = deleteRange(ctx.doc, sel);
    }
    const pos = cursor.focus;
    const yText = ctx.doc.textAt(pos.blockIndex, pos.cellIndex);
    if (!yText) return;
    yText.insert(pos.offset, text);
    if (marks && Object.keys(marks).length > 0) {
      yText.format(pos.offset, text.length, marks as Record<string, unknown>);
    }
    const newPos: Position = {
      blockIndex: pos.blockIndex,
      cellIndex: pos.cellIndex,
      offset: pos.offset + text.length,
    };
    ctx.setSelection(collapsedSelection(newPos));
  });
}

export function insertParagraph(ctx: CommandContext): void {
  // Rectangular selection: collapse + clear first.
  clearRectCells(ctx);
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    let cursor = sel;
    if (!isCollapsed(sel)) {
      cursor = deleteRange(ctx.doc, sel);
    }
    const pos = cursor.focus;
    // Inside a table cell, Enter inserts a literal newline rather than splitting
    // the cell into two paragraphs. Cells in 4.1 are single-text containers; we
    // rely on `white-space: pre-wrap` in CSS to render the line break visibly.
    if (pos.cellIndex != null) {
      const yText = ctx.doc.getCellText(pos.blockIndex, pos.cellIndex);
      if (!yText) return;
      yText.insert(pos.offset, "\n");
      ctx.setSelection(
        collapsedSelection({
          blockIndex: pos.blockIndex,
          cellIndex: pos.cellIndex,
          offset: pos.offset + 1,
        }),
      );
      return;
    }
    const yText = ctx.doc.getBlockText(pos.blockIndex);
    if (!yText) return;

    const totalLen = yText.length;
    // Read the tail's delta (preserves marks) before mutating yText.
    const tailDelta = totalLen > pos.offset
      ? sliceDelta(yText.toDelta() as DeltaOp[], pos.offset, totalLen)
      : [];

    if (totalLen > pos.offset) {
      yText.delete(pos.offset, totalLen - pos.offset);
    }

    const newBlock = createBlock("paragraph");
    ctx.doc.blocks.insert(pos.blockIndex + 1, [newBlock]);
    if (tailDelta.length > 0) {
      const newYText = newBlock.get("text") as Y.Text;
      writeDeltaInto(newYText, 0, tailDelta);
    }

    const newPos: Position = { blockIndex: pos.blockIndex + 1, offset: 0 };
    ctx.setSelection(collapsedSelection(newPos));
  });
}

export function deleteBackward(ctx: CommandContext): void {
  // Rectangular selection: clear text of every selected cell and collapse to
  // the rect's top-left, then return — no further character delete needed.
  if (clearRectCells(ctx)) return;
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    if (!isCollapsed(sel)) {
      const cursor = deleteRange(ctx.doc, sel);
      ctx.setSelection(cursor);
      return;
    }
    const pos = sel.focus;
    if (pos.offset > 0) {
      const yText = ctx.doc.textAt(pos.blockIndex, pos.cellIndex);
      if (!yText) return;
      yText.delete(pos.offset - 1, 1);
      ctx.setSelection(
        collapsedSelection({
          blockIndex: pos.blockIndex,
          cellIndex: pos.cellIndex,
          offset: pos.offset - 1,
        }),
      );
      return;
    }
    // offset === 0
    // Inside a table cell, backspace at the cell start is a no-op — the user
    // cannot escape the table by pressing backspace.
    if (pos.cellIndex != null) return;
    // At offset 0: if it's a listItem, dedent (or convert to paragraph at level 0)
    // before falling back to merging with the previous block.
    const blockType = ctx.doc.getBlockType(pos.blockIndex);
    if (blockType === "listItem") {
      const block = ctx.doc.getBlock(pos.blockIndex);
      const attrsMap = block?.get("attrs") as Y.Map<unknown> | undefined;
      const rawLevel = attrsMap?.get("listLevel") as number | undefined;
      const level = typeof rawLevel === "number" && Number.isFinite(rawLevel)
        ? Math.max(0, Math.min(MAX_LIST_LEVEL, Math.trunc(rawLevel)))
        : 0;
      if (level > 0) {
        attrsMap!.set("listLevel", level - 1);
        ctx.setSelection(collapsedSelection(pos));
        return;
      }
      // Level 0 listItem → convert to paragraph (escape the list).
      setBlockTypeAtIndex(ctx.doc, pos.blockIndex, "paragraph", {});
      ctx.setSelection(collapsedSelection(pos));
      return;
    }
    if (pos.blockIndex > 0) {
      const prevType = ctx.doc.getBlockType(pos.blockIndex - 1);
      if (prevType === "table") {
        // Can't merge with a table; move caret to the table's last cell instead.
        const tableIdx = pos.blockIndex - 1;
        const { rows, cols } = ctx.doc.getTableSize(tableIdx);
        const lastCell = rows * cols - 1;
        const cellText = ctx.doc.getCellText(tableIdx, lastCell);
        const off = cellText?.length ?? 0;
        ctx.setSelection(
          collapsedSelection({ blockIndex: tableIdx, cellIndex: lastCell, offset: off }),
        );
        return;
      }
      mergeWithPrevious(ctx, pos.blockIndex);
    }
  });
}

export function deleteForward(ctx: CommandContext): void {
  if (clearRectCells(ctx)) return;
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    if (!isCollapsed(sel)) {
      const cursor = deleteRange(ctx.doc, sel);
      ctx.setSelection(cursor);
      return;
    }
    const pos = sel.focus;
    const yText = ctx.doc.textAt(pos.blockIndex, pos.cellIndex);
    if (!yText) return;
    if (pos.offset < yText.length) {
      yText.delete(pos.offset, 1);
      ctx.setSelection(collapsedSelection(pos));
      return;
    }
    // at end of editable run
    // Inside a table cell, forward-delete at the cell end is a no-op.
    if (pos.cellIndex != null) return;
    // at end of block: merge next into current (but tables are atomic)
    if (pos.blockIndex + 1 < ctx.doc.blockCount()) {
      const nextType = ctx.doc.getBlockType(pos.blockIndex + 1);
      if (nextType === "table") {
        // Jump caret into the table's first cell.
        const tableIdx = pos.blockIndex + 1;
        ctx.setSelection(collapsedSelection({ blockIndex: tableIdx, cellIndex: 0, offset: 0 }));
        return;
      }
      const nextText = ctx.doc.getBlockText(pos.blockIndex + 1);
      if (!nextText) return;
      const tail = nextText.toString();
      if (tail.length > 0) yText.insert(yText.length, tail);
      ctx.doc.blocks.delete(pos.blockIndex + 1, 1);
      ctx.setSelection(collapsedSelection(pos));
    }
  });
}

// ---------- Marks ----------

const booleanMarks: Set<MarkName> = new Set(["bold", "italic", "underline", "strike"]);

/**
 * Toggle a mark across the current selection.
 * - If the selection is collapsed: no-op (the UI layer handles pendingMarks).
 * - Boolean marks (bold/italic/underline/strike): if every character already has
 *   the mark, remove it; otherwise apply.
 * - Parametric marks (color, fontFamily, fontSize, link): require `value` to apply;
 *   when uniform with that value across the range, remove instead (acts like toggle).
 */
export function toggleMark(
  ctx: CommandContext,
  name: MarkName,
  value?: MarkAttrs[MarkName],
): void {
  const sel = ctx.getSelection();
  if (isCollapsed(sel)) return;
  transact(ctx.doc, () => {
    const { start, end } = orderedRange(sel);
    forEachBlockTextInRange(ctx.doc, start, end, (yText, localStart, localEnd) => {
      const uniform = isMarkUniformInRange(yText, localStart, localEnd, name, value);
      const attrs: Record<string, unknown> = {};
      if (uniform) {
        attrs[name] = null;
      } else {
        attrs[name] = value ?? (booleanMarks.has(name) ? true : null);
      }
      if (attrs[name] === null && !uniform) return;
      yText.format(localStart, localEnd - localStart, attrs);
    });
    ctx.setSelection(sel);
  });
}

export function setMark(
  ctx: CommandContext,
  name: MarkName,
  value: MarkAttrs[MarkName],
): void {
  const sel = ctx.getSelection();
  if (isCollapsed(sel)) return;
  transact(ctx.doc, () => {
    const { start, end } = orderedRange(sel);
    forEachBlockTextInRange(ctx.doc, start, end, (yText, localStart, localEnd) => {
      yText.format(localStart, localEnd - localStart, { [name]: value });
    });
    ctx.setSelection(sel);
  });
}

export function removeMark(ctx: CommandContext, name: MarkName): void {
  const sel = ctx.getSelection();
  if (isCollapsed(sel)) return;
  transact(ctx.doc, () => {
    const { start, end } = orderedRange(sel);
    forEachBlockTextInRange(ctx.doc, start, end, (yText, localStart, localEnd) => {
      yText.format(localStart, localEnd - localStart, { [name]: null });
    });
    ctx.setSelection(sel);
  });
}

// ---------- Block-level commands (Sub-phase 2.2) ----------

/**
 * Change the type of every block covered by the current selection.
 * When `attrs` is provided, merges those on top of the new type's defaults.
 * Preserves `Y.Text` content (and therefore all inline marks) and the selection.
 */
export function setBlockType(
  ctx: CommandContext,
  type: BlockType,
  attrs?: BlockAttrs,
): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    // Inert when the caret is inside a cell — block-level operations only
    // apply to top-level blocks (the table itself), and changing a table's
    // block type is not exposed in 4.1.
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
    const indices = selectedBlockIndices(sel, ctx.doc.blockCount());
    for (const i of indices) {
      const block = ctx.doc.getBlock(i);
      if (!block) continue;
      block.set("type", type);
      const attrsMap = (block.get("attrs") as Y.Map<unknown> | undefined) ?? new Y.Map<unknown>();
      if (!block.get("attrs")) block.set("attrs", attrsMap);
      // Reset attrs to the new type's defaults, then layer caller overrides.
      // Strategy: clear keys that aren't in either map, then write new ones.
      const next = { ...defaultAttrsFor(type), ...(attrs ?? {}) };
      const keep = new Set(Object.keys(next));
      for (const k of Array.from(attrsMap.keys())) {
        if (!keep.has(k)) attrsMap.delete(k);
      }
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined) continue;
        if (attrsMap.get(k) !== v) attrsMap.set(k, v);
      }
    }
    ctx.setSelection(sel);
  });
}

/**
 * Set a single attribute on every block covered by the selection.
 * Passing `value === null` deletes the key.
 */
export function setBlockAttr<K extends keyof BlockAttrs>(
  ctx: CommandContext,
  key: K,
  value: BlockAttrs[K] | null,
): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
    const indices = selectedBlockIndices(sel, ctx.doc.blockCount());
    for (const i of indices) {
      const block = ctx.doc.getBlock(i);
      if (!block) continue;
      const attrsMap = (block.get("attrs") as Y.Map<unknown> | undefined) ?? new Y.Map<unknown>();
      if (!block.get("attrs")) block.set("attrs", attrsMap);
      if (value === null || value === undefined) {
        attrsMap.delete(key as string);
      } else {
        attrsMap.set(key as string, value);
      }
    }
    ctx.setSelection(sel);
  });
}

/**
 * Set a single attribute on the table cell(s) under the selection.
 * - Caret numa única célula → essa célula (tableRectSelection retorna null
 *   para seleção colapsada (ou âncora/foco no mesmo owner), então usamos
 *   a célula focada (redirecionada ao owner real).
 * - Seleção retangular de várias células → todas as células reais do rect.
 * Células `covered` são puladas. `value === null` apaga a key.
 * No-op se a seleção não estiver dentro de uma tabela.
 */
export function setCellAttr<K extends keyof CellAttrs>(
  ctx: CommandContext,
  key: K,
  value: CellAttrs[K] | null,
): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    const { blockIndex, cellIndex } = sel.focus;
    if (cellIndex == null || !ctx.doc.isTable(blockIndex)) return;
    const { cols } = ctx.doc.getTableSize(blockIndex);
    if (cols <= 0) return;
    const rect = tableRectSelection(ctx.doc, sel);
    const targets: number[] = [];
    if (rect) {
      for (let r = rect.top; r <= rect.bottom; r++)
        for (let c = rect.left; c <= rect.right; c++) targets.push(r * cols + c);
    } else {
      const real = ctx.doc.realCellIndex(blockIndex, cellIndex);
      if (real != null) targets.push(real);
    }
    for (const flat of targets) {
      if (ctx.doc.getCellAttrs(blockIndex, flat).covered) continue;
      const m = ctx.doc.getCellAttrsMap(blockIndex, flat);
      if (!m) continue;
      if (value === null || value === undefined) m.delete(key as string);
      else m.set(key as string, value);
    }
    ctx.setSelection(sel);
  });
}

/** Delete the current selection range and collapse the caret. Used by cut. */
export function deleteSelection(ctx: CommandContext): void {
  transact(ctx.doc, () => {
    const s = deleteRange(ctx.doc, ctx.getSelection());
    ctx.setSelection(s);
  });
}

/**
 * Replace the current selection with a clipboard slice (A1).
 * - Single-block slice → inline splice (Dhead + S0 + Dtail), target keeps its type.
 * - Multi-block slice → openStart merges S0 inline; middle/last blocks inserted
 *   discretely; openEnd appends the post-caret tail onto the last pasted block.
 * - Target inside a table cell → slice flattened to inline (no block structure).
 */
export function insertSlice(ctx: CommandContext, slice: ClipboardSlice): void {
  if (!slice.blocks || slice.blocks.length === 0) return;
  transact(ctx.doc, () => {
    let sel = ctx.getSelection();
    if (!isCollapsed(sel)) sel = deleteRange(ctx.doc, sel);
    const { blockIndex, cellIndex, offset } = sel.focus;

    if (cellIndex != null) {
      const cellText = ctx.doc.textAt(blockIndex, cellIndex);
      if (!cellText) return;
      const after = writeDeltaInto(cellText, offset, sliceToInlineDelta(slice));
      ctx.setSelection(collapsedSelection({ blockIndex, cellIndex, offset: after }));
      return;
    }

    const targetText = ctx.doc.getBlockText(blockIndex);
    if (!targetText) return;

    const full = targetText.toDelta() as DeltaOp[];
    const tailDelta = sliceDelta(full, offset, deltaLength(full));
    targetText.delete(offset, targetText.length - offset);

    const blocks = slice.blocks;

    if (blocks.length === 1) {
      const afterS0 = writeDeltaInto(targetText, offset, blocks[0].delta);
      writeDeltaInto(targetText, afterS0, tailDelta);
      ctx.setSelection(collapsedSelection({ blockIndex, offset: afterS0 }));
      return;
    }

    // Multi-block. Capture the target's original type/attrs BEFORE any mutation,
    // for the !openEnd tail block.
    const originalType = ctx.doc.getBlockType(blockIndex);
    const originalAttrs = ctx.doc.getBlockAttrs(blockIndex);
    let insertAt = blockIndex;

    // First block.
    if (slice.openStart) {
      // Partial fragment → merge S0 inline into the target (Dhead already present);
      // target keeps its own type.
      writeDeltaInto(targetText, offset, blocks[0].delta);
    } else if (offset === 0) {
      // Whole-block fragment pasted into an empty Dhead → reuse the empty target
      // AS S0 in place (adopt S0's type/attrs), avoiding a stray leading block.
      const blk = ctx.doc.blocks.get(blockIndex) as Y.Map<unknown>;
      blk.set("type", blocks[0].type);
      const am = blk.get("attrs") as Y.Map<unknown>;
      am.clear();
      for (const [k, v] of Object.entries(blocks[0].attrs)) {
        if (v !== undefined) am.set(k, v);
      }
      writeDeltaInto(targetText, 0, blocks[0].delta);
    } else {
      // Whole-block fragment after a non-empty Dhead → S0 as its own block.
      const b = createBlock(blocks[0].type, "", blocks[0].attrs);
      ctx.doc.blocks.insert(++insertAt, [b]);
      writeDeltaInto(b.get("text") as Y.Text, 0, blocks[0].delta);
    }

    // Middle blocks (whole).
    for (let i = 1; i < blocks.length - 1; i++) {
      const b = createBlock(blocks[i].type, "", blocks[i].attrs);
      ctx.doc.blocks.insert(++insertAt, [b]);
      writeDeltaInto(b.get("text") as Y.Text, 0, blocks[i].delta);
    }

    // Last block.
    const last = blocks[blocks.length - 1];
    if (slice.openEnd) {
      const b = createBlock(last.type, "", last.attrs);
      ctx.doc.blocks.insert(++insertAt, [b]);
      const t = b.get("text") as Y.Text;
      const caretPos = writeDeltaInto(t, 0, last.delta);
      writeDeltaInto(t, caretPos, tailDelta);
      ctx.setSelection(collapsedSelection({ blockIndex: insertAt, offset: caretPos }));
    } else {
      const b = createBlock(last.type, "", last.attrs);
      ctx.doc.blocks.insert(++insertAt, [b]);
      const lastLen = writeDeltaInto(b.get("text") as Y.Text, 0, last.delta);
      const lastIdx = insertAt;
      // Only materialize the tail block when there's actually a tail (avoids a
      // stray empty block when pasting at end-of-line).
      if (tailDelta.length > 0) {
        const tb = createBlock(originalType ?? "paragraph", "", originalAttrs);
        ctx.doc.blocks.insert(++insertAt, [tb]);
        writeDeltaInto(tb.get("text") as Y.Text, 0, tailDelta);
      }
      ctx.setSelection(collapsedSelection({ blockIndex: lastIdx, offset: lastLen }));
    }
  });
}

function selectedBlockIndices(sel: Selection, blockCount: number): number[] {
  const { start, end } = orderedRange(sel);
  const out: number[] = [];
  const last = Math.min(end.blockIndex, blockCount - 1);
  for (let i = Math.max(start.blockIndex, 0); i <= last; i++) out.push(i);
  return out;
}

function forEachBlockTextInRange(
  doc: EditorDocument,
  start: Position,
  end: Position,
  visit: (yText: Y.Text, localStart: number, localEnd: number) => void,
): void {
  // Same text-run (block or cell): straightforward.
  if (sameTextRun(start, end)) {
    const yText = doc.textAt(start.blockIndex, start.cellIndex);
    if (!yText) return;
    if (start.offset < end.offset) visit(yText, start.offset, end.offset);
    return;
  }
  // Cross-run selections involving a cell are currently treated as inert for
  // mark application; the UI surfaces them as "no-op" rather than partially
  // applying marks across mismatched runs.
  if (start.cellIndex != null || end.cellIndex != null) return;

  for (let i = start.blockIndex; i <= end.blockIndex; i++) {
    const yText = doc.getBlockText(i);
    if (!yText) continue;
    const localStart = i === start.blockIndex ? start.offset : 0;
    const localEnd = i === end.blockIndex ? end.offset : yText.length;
    if (localStart < localEnd) visit(yText, localStart, localEnd);
  }
}

/**
 * Deletes the content of a non-collapsed selection.
 * Returns the new collapsed selection at the deletion point.
 * Must be called inside a Y.Doc transaction.
 *
 * Selections that span DIFFERENT text-runs (different blocks, or two cells of
 * the same table) are bridged conservatively:
 * - Same text-run (block+cell): delete the range normally.
 * - Different runs but both outside tables (i.e. cellIndex undefined on both):
 *   delete and merge blocks as before.
 * - Otherwise (one endpoint is in a table cell): no destructive cross-cell
 *   delete in 4.1; collapse to `start` instead.
 */
function deleteRange(doc: EditorDocument, sel: Selection): Selection {
  const { start, end } = orderedRange(sel);

  if (sameTextRun(start, end)) {
    const yText = doc.textAt(start.blockIndex, start.cellIndex);
    if (yText) yText.delete(start.offset, end.offset - start.offset);
    return collapsedSelection(start);
  }

  // Reject cross-cell / cross-table-to-paragraph multi-run deletions for now.
  if (start.cellIndex != null || end.cellIndex != null) {
    return collapsedSelection(start);
  }

  const startText = doc.getBlockText(start.blockIndex);
  const endText = doc.getBlockText(end.blockIndex);
  if (!startText || !endText) return collapsedSelection(start);

  // Trim tail of start block
  startText.delete(start.offset, startText.length - start.offset);
  // Read remaining tail from end block, after the deleted prefix
  const remainingTail = endText.toString().slice(end.offset);
  if (remainingTail.length > 0) {
    startText.insert(startText.length, remainingTail);
  }
  // Remove all blocks between start (exclusive) and end (inclusive)
  doc.blocks.delete(start.blockIndex + 1, end.blockIndex - start.blockIndex);
  return collapsedSelection(start);
}

function mergeWithPrevious(ctx: CommandContext, blockIndex: number): void {
  const prevText = ctx.doc.getBlockText(blockIndex - 1);
  const currText = ctx.doc.getBlockText(blockIndex);
  if (!prevText || !currText) return;
  const prevLen = prevText.length;
  const tail = currText.toString();
  if (tail.length > 0) prevText.insert(prevLen, tail);
  ctx.doc.blocks.delete(blockIndex, 1);
  ctx.setSelection(collapsedSelection({ blockIndex: blockIndex - 1, offset: prevLen }));
}

// ---------- List commands (Sub-phase 2.3) ----------

/**
 * Convert every block in the selection to/from a `listItem` of `kind`.
 * If every covered block is already a `listItem` of `kind` → convert them all to paragraphs.
 * Otherwise → convert them all to `listItem` (keeping existing `listLevel` when already
 * a listItem, defaulting to 0 otherwise).
 */
export function toggleList(ctx: CommandContext, kind: ListKind): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
    const indices = selectedBlockIndices(sel, ctx.doc.blockCount());
    const allMatching = indices.every((i) => {
      const block = ctx.doc.getBlock(i);
      if (!block) return false;
      if (block.get("type") !== "listItem") return false;
      const attrs = ctx.doc.getBlockAttrs(i);
      return attrs.listKind === kind;
    });
    for (const i of indices) {
      if (allMatching) {
        // Strip list → paragraph (defaults reset).
        setBlockTypeAtIndex(ctx.doc, i, "paragraph", {});
      } else {
        const prev = ctx.doc.getBlockAttrs(i);
        const level = clampLevel(prev.listLevel);
        setBlockTypeAtIndex(ctx.doc, i, "listItem", { listKind: kind, listLevel: level });
      }
    }
    ctx.setSelection(sel);
  });
}

/** Increase nesting of every listItem in the selection (clamped to MAX_LIST_LEVEL). */
export function indentList(ctx: CommandContext): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
    const indices = selectedBlockIndices(sel, ctx.doc.blockCount());
    for (const i of indices) {
      const block = ctx.doc.getBlock(i);
      if (!block || block.get("type") !== "listItem") continue;
      const attrsMap = block.get("attrs") as Y.Map<unknown>;
      const current = clampLevel((attrsMap.get("listLevel") as number | undefined) ?? 0);
      const next = Math.min(current + 1, MAX_LIST_LEVEL);
      if (next !== current) attrsMap.set("listLevel", next);
    }
    ctx.setSelection(sel);
  });
}

/**
 * Decrease nesting of every listItem in the selection.
 * When level was 0, demote to paragraph (escape from the list).
 */
export function dedentList(ctx: CommandContext): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
    const indices = selectedBlockIndices(sel, ctx.doc.blockCount());
    for (const i of indices) {
      const block = ctx.doc.getBlock(i);
      if (!block || block.get("type") !== "listItem") continue;
      const attrsMap = block.get("attrs") as Y.Map<unknown>;
      const current = clampLevel((attrsMap.get("listLevel") as number | undefined) ?? 0);
      if (current > 0) {
        attrsMap.set("listLevel", current - 1);
      } else {
        // Escape from the list at level 0.
        setBlockTypeAtIndex(ctx.doc, i, "paragraph", {});
      }
    }
    ctx.setSelection(sel);
  });
}

/**
 * Enter behavior inside a listItem.
 * - Empty listItem at level > 0 → dedent (stays a listItem, one level out).
 * - Empty listItem at level 0   → convert to paragraph (exit the list).
 * - Non-empty                   → split: tail moves to a new listItem with same kind/level.
 *
 * Returns `true` when it handled the event; `false` to let the default `insertParagraph` run.
 */
export function splitListItem(ctx: CommandContext): boolean {
  const sel = ctx.getSelection();
  if (!isCollapsed(sel)) return false;
  const pos = sel.focus;
  // Inside a table cell, Enter is handled by insertParagraph (newline within cell).
  if (pos.cellIndex != null) return false;
  const block = ctx.doc.getBlock(pos.blockIndex);
  if (!block || block.get("type") !== "listItem") return false;
  const yText = ctx.doc.getBlockText(pos.blockIndex);
  if (!yText) return false;

  const attrs = ctx.doc.getBlockAttrs(pos.blockIndex);
  const kind = (attrs.listKind ?? "bullet") as ListKind;
  const level = clampLevel(attrs.listLevel ?? 0);

  transact(ctx.doc, () => {
    if (yText.length === 0) {
      if (level > 0) {
        const m = block.get("attrs") as Y.Map<unknown>;
        m.set("listLevel", level - 1);
      } else {
        setBlockTypeAtIndex(ctx.doc, pos.blockIndex, "paragraph", {});
      }
      ctx.setSelection(collapsedSelection({ blockIndex: pos.blockIndex, offset: 0 }));
      return;
    }
    const tail = yText.toString().slice(pos.offset);
    if (tail.length > 0) yText.delete(pos.offset, tail.length);
    ctx.doc.blocks.insert(pos.blockIndex + 1, [
      createBlock("listItem", tail, { listKind: kind, listLevel: level }),
    ]);
    ctx.setSelection(collapsedSelection({ blockIndex: pos.blockIndex + 1, offset: 0 }));
  });
  return true;
}

/**
 * Internal: reset a single block's type + attrs (used by list commands).
 * Same merge rules as the public `setBlockType` but scoped to one block and
 * intended to run already inside a transaction.
 */
function setBlockTypeAtIndex(
  doc: EditorDocument,
  index: number,
  type: BlockType,
  attrs: BlockAttrs,
): void {
  const block = doc.getBlock(index);
  if (!block) return;
  block.set("type", type);
  const attrsMap = (block.get("attrs") as Y.Map<unknown> | undefined) ?? new Y.Map<unknown>();
  if (!block.get("attrs")) block.set("attrs", attrsMap);
  const next = { ...defaultAttrsFor(type), ...attrs };
  const keep = new Set(Object.keys(next));
  for (const k of Array.from(attrsMap.keys())) {
    if (!keep.has(k)) attrsMap.delete(k);
  }
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (attrsMap.get(k) !== v) attrsMap.set(k, v);
  }
}

function clampLevel(l: number | undefined): number {
  if (typeof l !== "number" || !Number.isFinite(l)) return 0;
  return Math.max(0, Math.min(MAX_LIST_LEVEL, Math.trunc(l)));
}

// ---------- Table commands (Sub-phase 4.1 / 4.2) ----------

/**
 * Insert a fresh `rows × cols` table after the block currently holding the
 * caret (or at the end of the document if the selection is somehow invalid),
 * and place the caret in the table's first cell.
 *
 * Sub-phase 4.1 doesn't try to be clever: it does NOT replace an empty
 * preceding paragraph. Callers can clean that up themselves; an extra empty
 * paragraph above a table is a small price for predictable behavior.
 */
export function insertTable(ctx: CommandContext, rows: number, cols: number): void {
  const r = Math.max(1, Math.trunc(rows));
  const c = Math.max(1, Math.trunc(cols));
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    // Anchor point: the block holding the focus. If focus is inside a cell of
    // an existing table, insert AFTER that table.
    const focusBlock = Math.max(0, Math.min(sel.focus.blockIndex, ctx.doc.blockCount() - 1));
    const insertAt = focusBlock + 1;
    ctx.doc.blocks.insert(insertAt, [createTableBlock(r, c)]);
    // Invariante: documento nunca termina em tabela — o caret precisa de um
    // destino editável abaixo dela. Só acrescenta quando a tabela virou o último bloco.
    if (insertAt === ctx.doc.blockCount() - 1) {
      ctx.doc.blocks.insert(insertAt + 1, [createBlock("paragraph")]);
    }
    ctx.setSelection(
      collapsedSelection({ blockIndex: insertAt, cellIndex: 0, offset: 0 }),
    );
  });
}

/** Remove the entire table at `blockIndex` and place the caret at the start of the next block (or the previous one if removal would leave the doc empty). */
export function deleteTable(ctx: CommandContext, blockIndex: number): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  transact(ctx.doc, () => {
    ctx.doc.blocks.delete(blockIndex, 1);
    if (ctx.doc.blocks.length === 0) {
      ctx.doc.blocks.push([createBlock("paragraph")]);
      ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
      return;
    }
    const targetIdx = Math.max(0, Math.min(blockIndex, ctx.doc.blockCount() - 1));
    const targetType = ctx.doc.getBlockType(targetIdx);
    if (targetType === "table") {
      ctx.setSelection(collapsedSelection({ blockIndex: targetIdx, cellIndex: 0, offset: 0 }));
    } else {
      ctx.setSelection(collapsedSelection({ blockIndex: targetIdx, offset: 0 }));
    }
  });
}

/**
 * Sub-phase 4.1 has no rowspan/colspan, so row/col operations are pure splice
 * on the flat `cells` array. The flat index of `(r, c)` is `r * cols + c`.
 */

export interface TableLocation {
  blockIndex: number;
  row: number;
  col: number;
}

/**
 * Derive `{row, col}` from a position inside a table — always pointing at the
 * owner of the targeted cell (covered cells redirect to their owner). Returns
 * null when the position isn't inside a table cell.
 */
export function tableLocationOf(
  doc: EditorDocument,
  pos: Position,
): TableLocation | null {
  if (pos.cellIndex == null) return null;
  if (!doc.isTable(pos.blockIndex)) return null;
  const { cols } = doc.getTableSize(pos.blockIndex);
  if (cols <= 0) return null;
  const real = doc.realCellIndex(pos.blockIndex, pos.cellIndex);
  if (real == null) return null;
  const row = Math.floor(real / cols);
  const col = real - row * cols;
  return { blockIndex: pos.blockIndex, row, col };
}

/**
 * Insert a fresh row above (`where === "before"`) or below (`"after"`) the
 * given row. Spans that previously crossed the insertion boundary are extended
 * by 1; the corresponding columns of the new row become `covered: true`.
 */
export function insertTableRow(
  ctx: CommandContext,
  blockIndex: number,
  row: number,
  where: "before" | "after",
): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (rows <= 0 || cols <= 0) return;
  const targetRow = Math.max(0, Math.min(row, rows - 1));
  const P = where === "before" ? targetRow : targetRow + 1;
  transact(ctx.doc, () => {
    const cells = ctx.doc.getCells(blockIndex);
    const attrs = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!cells || !attrs) return;

    // Snapshot: for each column, does a span crossing the [P-1, P] boundary
    // cover this column at row P? Compute BEFORE mutating spans.
    const newRowCovered: boolean[] = new Array(cols).fill(false);
    if (P > 0 && P < rows) {
      // Walk row P-1 to find spans crossing into row P (i.e., or < P and or+rs > P).
      for (let r = 0; r < P; r++) {
        for (let c = 0; c < cols; c++) {
          const a = ctx.doc.getCellAttrs(blockIndex, r * cols + c);
          if (a.covered === true) continue;
          const rs = spanOf(a.rowspan);
          const cs = spanOf(a.colspan);
          if (r < P && r + rs > P) {
            for (let cc = c; cc < c + cs && cc < cols; cc++) newRowCovered[cc] = true;
          }
        }
      }
      // Now extend those spans' rowspan by 1.
      for (let r = 0; r < P; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const a = ctx.doc.getCellAttrs(blockIndex, idx);
          if (a.covered === true) continue;
          const rs = spanOf(a.rowspan);
          if (r < P && r + rs > P) {
            const m = ctx.doc.getCellAttrsMap(blockIndex, idx);
            m?.set("rowspan", rs + 1);
          }
        }
      }
    }

    const fresh: Y.Map<unknown>[] = [];
    for (let c = 0; c < cols; c++) {
      fresh.push(createCell(newRowCovered[c] ? { covered: true } : undefined));
    }
    cells.insert(P * cols, fresh);
    attrs.set("rows", rows + 1);
    // Caret on the first non-covered cell of the new row (falls back to flat-0
    // if every column is covered — pathologically possible only with bad data).
    const firstReal = newRowCovered.findIndex((v) => !v);
    const targetCellIdx = P * cols + (firstReal < 0 ? 0 : firstReal);
    ctx.setSelection(
      collapsedSelection({ blockIndex, cellIndex: targetCellIdx, offset: 0 }),
    );
  });
}

/**
 * Remove `row` from the table. Spans that pass through the row are shortened
 * by one; spans that START at the row are removed AND the cell at row R+1 (in
 * each affected column) is promoted to be the new owner with `rowspan - 1`.
 * When it was the last row, deletes the whole table.
 */
export function deleteTableRow(ctx: CommandContext, blockIndex: number, row: number): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (rows <= 0 || cols <= 0) return;
  if (rows === 1) {
    deleteTable(ctx, blockIndex);
    return;
  }
  const R = Math.max(0, Math.min(row, rows - 1));
  transact(ctx.doc, () => {
    const cells = ctx.doc.getCells(blockIndex);
    const attrs = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!cells || !attrs) return;

    // Phase 1: spans crossing R (started above, end at or after R): shorten by 1.
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const a = ctx.doc.getCellAttrs(blockIndex, idx);
        if (a.covered === true) continue;
        const rs = spanOf(a.rowspan);
        if (r < R && r + rs > R) {
          const m = ctx.doc.getCellAttrsMap(blockIndex, idx);
          m?.set("rowspan", rs - 1);
          if (rs - 1 === 1) m?.delete("rowspan");
        }
      }
    }

    // Phase 2: spans starting AT row R with rowspan > 1: promote the cell at
    // (R+1, c) to be the new owner. Capture the promotion list FIRST so we
    // can apply changes after the row delete (since indices shift).
    interface Promotion {
      // Flat index AFTER the row delete.
      flatNew: number;
      rowspan: number;
      colspan: number;
    }
    const promotions: Promotion[] = [];
    for (let c = 0; c < cols; c++) {
      const a = ctx.doc.getCellAttrs(blockIndex, R * cols + c);
      if (a.covered === true) continue;
      const rs = spanOf(a.rowspan);
      const cs = spanOf(a.colspan);
      if (rs > 1 && R + 1 < rows) {
        // After delete, what was (R+1, c) becomes (R, c).
        promotions.push({ flatNew: R * cols + c, rowspan: rs - 1, colspan: cs });
      }
    }

    cells.delete(R * cols, cols);
    attrs.set("rows", rows - 1);

    for (const p of promotions) {
      const m = ctx.doc.getCellAttrsMap(blockIndex, p.flatNew);
      if (!m) continue;
      m.delete("covered");
      if (p.rowspan > 1) m.set("rowspan", p.rowspan); else m.delete("rowspan");
      if (p.colspan > 1) m.set("colspan", p.colspan); else m.delete("colspan");
    }

    const newRow = Math.min(R, rows - 2);
    const target = findNextRealCell(ctx.doc, blockIndex, newRow * cols, (rows - 1) * cols) ?? 0;
    ctx.setSelection(
      collapsedSelection({ blockIndex, cellIndex: target, offset: 0 }),
    );
  });
}

/**
 * Insert a fresh column to the left (`"before"`) or right (`"after"`) of `col`.
 * Spans crossing the insertion column have `colspan += 1`; the new column's
 * cells in covered rows are themselves `covered: true`.
 *
 * Also resizes `colWidths` (if defined) by inserting a default width.
 */
export function insertTableColumn(
  ctx: CommandContext,
  blockIndex: number,
  col: number,
  where: "before" | "after",
): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (rows <= 0 || cols <= 0) return;
  const targetCol = Math.max(0, Math.min(col, cols - 1));
  const C = where === "before" ? targetCol : targetCol + 1;
  transact(ctx.doc, () => {
    const cells = ctx.doc.getCells(blockIndex);
    const attrs = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!cells || !attrs) return;

    // Snapshot covered rows BEFORE mutating spans.
    const newColCovered: boolean[] = new Array(rows).fill(false);
    if (C > 0 && C < cols) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < C; c++) {
          const a = ctx.doc.getCellAttrs(blockIndex, r * cols + c);
          if (a.covered === true) continue;
          const rs = spanOf(a.rowspan);
          const cs = spanOf(a.colspan);
          if (c < C && c + cs > C) {
            for (let rr = r; rr < r + rs && rr < rows; rr++) newColCovered[rr] = true;
          }
        }
      }
      // Extend colspans.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < C; c++) {
          const idx = r * cols + c;
          const a = ctx.doc.getCellAttrs(blockIndex, idx);
          if (a.covered === true) continue;
          const cs = spanOf(a.colspan);
          if (c < C && c + cs > C) {
            const m = ctx.doc.getCellAttrsMap(blockIndex, idx);
            m?.set("colspan", cs + 1);
          }
        }
      }
    }

    // Walk rows LAST→FIRST so insert indices stay correct.
    for (let r = rows - 1; r >= 0; r--) {
      const at = r * cols + C;
      cells.insert(at, [createCell(newColCovered[r] ? { covered: true } : undefined)]);
    }
    attrs.set("cols", cols + 1);

    // Resize colWidths if present — insert a 100px placeholder for the new col.
    const widths = attrs.get("colWidths") as number[] | undefined;
    if (Array.isArray(widths) && widths.length === cols) {
      const next = widths.slice();
      next.splice(C, 0, 100);
      attrs.set("colWidths", next);
    }

    const newCols = cols + 1;
    const focusRow = 0;
    const firstReal = newColCovered.findIndex((_, r) => r === focusRow && !newColCovered[r]);
    ctx.setSelection(
      collapsedSelection({
        blockIndex,
        cellIndex: focusRow * newCols + C + (firstReal < 0 ? 0 : 0),
        offset: 0,
      }),
    );
  });
}

/**
 * Remove `col` from the table. Spans that pass through the column are
 * shortened by one; spans that START at the column with `colspan > 1` get
 * their owner promoted from (r, C+1) to take over with `colspan - 1`.
 *
 * Also shrinks `colWidths` (if defined). When it was the last column, deletes
 * the whole table.
 */
export function deleteTableColumn(ctx: CommandContext, blockIndex: number, col: number): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (rows <= 0 || cols <= 0) return;
  if (cols === 1) {
    deleteTable(ctx, blockIndex);
    return;
  }
  const C = Math.max(0, Math.min(col, cols - 1));
  transact(ctx.doc, () => {
    const cells = ctx.doc.getCells(blockIndex);
    const attrs = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!cells || !attrs) return;

    // Phase 1: spans crossing C — colspan -= 1.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < C; c++) {
        const idx = r * cols + c;
        const a = ctx.doc.getCellAttrs(blockIndex, idx);
        if (a.covered === true) continue;
        const cs = spanOf(a.colspan);
        if (c < C && c + cs > C) {
          const m = ctx.doc.getCellAttrsMap(blockIndex, idx);
          m?.set("colspan", cs - 1);
          if (cs - 1 === 1) m?.delete("colspan");
        }
      }
    }

    // Phase 2: capture promotions for spans starting at column C with colspan > 1.
    // After deletion, what was (r, C+1) becomes (r, C). Capture both the
    // FUTURE flat index in the post-delete (rows x (cols-1)) grid and the
    // attrs to apply.
    interface Promotion {
      flatNew: number;
      rowspan: number;
      colspan: number;
    }
    const promotions: Promotion[] = [];
    const newCols = cols - 1;
    for (let r = 0; r < rows; r++) {
      const a = ctx.doc.getCellAttrs(blockIndex, r * cols + C);
      if (a.covered === true) continue;
      const rs = spanOf(a.rowspan);
      const cs = spanOf(a.colspan);
      if (cs > 1 && C + 1 < cols) {
        promotions.push({
          flatNew: r * newCols + C,
          rowspan: rs,
          colspan: cs - 1,
        });
      }
    }

    // Walk rows LAST→FIRST so deletions don't perturb indices we still need.
    for (let r = rows - 1; r >= 0; r--) {
      const at = r * cols + C;
      cells.delete(at, 1);
    }
    attrs.set("cols", newCols);

    for (const p of promotions) {
      const m = ctx.doc.getCellAttrsMap(blockIndex, p.flatNew);
      if (!m) continue;
      m.delete("covered");
      if (p.rowspan > 1) m.set("rowspan", p.rowspan); else m.delete("rowspan");
      if (p.colspan > 1) m.set("colspan", p.colspan); else m.delete("colspan");
    }

    // Trim colWidths.
    const widths = attrs.get("colWidths") as number[] | undefined;
    if (Array.isArray(widths) && widths.length === cols) {
      const next = widths.slice();
      next.splice(C, 1);
      attrs.set("colWidths", next);
    }

    const newCol = Math.min(C, newCols - 1);
    const target = findNextRealCell(ctx.doc, blockIndex, newCol, rows * newCols) ?? 0;
    ctx.setSelection(
      collapsedSelection({ blockIndex, cellIndex: target, offset: 0 }),
    );
  });
}

// ---------- Rectangular cell selection (Sub-phase 4.5) ----------

export interface TableRect {
  blockIndex: number;
  /** Inclusive bounds in OWNER coordinates. */
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Interpret a `Selection` as a rectangular cell range when:
 * - Both endpoints carry `cellIndex`.
 * - They live in the same table block.
 * - They point to DIFFERENT owner cells.
 *
 * The naive bounds are then EXPANDED until every span fully fits inside —
 * essential so that operations like `mergeSelection` can never produce a
 * non-rectangular shape, and so visual highlights always cover whole spans.
 */
export function tableRectSelection(
  doc: EditorDocument,
  sel: Selection,
): TableRect | null {
  if (sel.anchor.blockIndex !== sel.focus.blockIndex) return null;
  if (sel.anchor.cellIndex == null || sel.focus.cellIndex == null) return null;
  const blockIndex = sel.anchor.blockIndex;
  if (!doc.isTable(blockIndex)) return null;
  const aLoc = tableLocationOf(doc, sel.anchor);
  const fLoc = tableLocationOf(doc, sel.focus);
  if (!aLoc || !fLoc) return null;
  // After redirection to owners, anchor and focus may collapse to the same
  // owner cell (e.g. anchor in an owner, focus in one of its covered cells).
  if (aLoc.row === fLoc.row && aLoc.col === fLoc.col) return null;
  return expandTableRect(
    doc,
    blockIndex,
    Math.min(aLoc.row, fLoc.row),
    Math.min(aLoc.col, fLoc.col),
    Math.max(aLoc.row, fLoc.row),
    Math.max(aLoc.col, fLoc.col),
  );
}

/**
 * Grow a candidate rect until every owner whose span starts within the rect
 * fits entirely, and every covered cell inside it has its owner inside too.
 * Converges in O(rows × cols) iterations in the worst case (each pass either
 * grows a bound or terminates).
 */
export function expandTableRect(
  doc: EditorDocument,
  blockIndex: number,
  initTop: number,
  initLeft: number,
  initBottom: number,
  initRight: number,
): TableRect {
  const { rows, cols } = doc.getTableSize(blockIndex);
  let top = Math.max(0, initTop);
  let left = Math.max(0, initLeft);
  let bottom = Math.min(rows - 1, initBottom);
  let right = Math.min(cols - 1, initRight);

  let changed = true;
  let guard = rows * cols + 1;
  while (changed && guard-- > 0) {
    changed = false;
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const idx = r * cols + c;
        const a = doc.getCellAttrs(blockIndex, idx);
        if (a.covered === true) {
          const owner = doc.realCellIndex(blockIndex, idx);
          if (owner == null) continue;
          const oRow = Math.floor(owner / cols);
          const oCol = owner - oRow * cols;
          if (oRow < top) { top = oRow; changed = true; }
          if (oCol < left) { left = oCol; changed = true; }
          // Owner's far edge:
          const oAttrs = doc.getCellAttrs(blockIndex, owner);
          const oRs = spanOf(oAttrs.rowspan);
          const oCs = spanOf(oAttrs.colspan);
          if (oRow + oRs - 1 > bottom) { bottom = oRow + oRs - 1; changed = true; }
          if (oCol + oCs - 1 > right) { right = oCol + oCs - 1; changed = true; }
        } else {
          const rs = spanOf(a.rowspan);
          const cs = spanOf(a.colspan);
          if (r + rs - 1 > bottom) { bottom = r + rs - 1; changed = true; }
          if (c + cs - 1 > right) { right = c + cs - 1; changed = true; }
        }
      }
    }
  }
  return { blockIndex, top, left, bottom, right };
}

/** Enumerate every cell-index (real or covered) contained in `rect`. */
export function cellsInRect(doc: EditorDocument, rect: TableRect): number[] {
  const { cols } = doc.getTableSize(rect.blockIndex);
  const out: number[] = [];
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) out.push(r * cols + c);
  }
  return out;
}

/**
 * Merge every cell in the current rectangular selection into one owner at the
 * rect's top-left. The owner's text is the concatenation of all non-empty
 * inner texts (space-separated, mark-preserving). Returns true on success, false
 * when there is no rect selection.
 */
export function mergeSelection(ctx: CommandContext): boolean {
  const sel = ctx.getSelection();
  const rect = tableRectSelection(ctx.doc, sel);
  if (!rect) return false;
  const { blockIndex, top, left, bottom, right } = rect;
  const { cols } = ctx.doc.getTableSize(blockIndex);
  const ownerIdx = top * cols + left;

  transact(ctx.doc, () => {
    const ownerText = ctx.doc.getCellText(blockIndex, ownerIdx);
    if (!ownerText) return;

    // Walk every cell in the rect (skip the owner itself). For real cells with
    // non-empty text, append to owner.
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const idx = r * cols + c;
        if (idx === ownerIdx) continue;
        const a = ctx.doc.getCellAttrs(blockIndex, idx);
        if (a.covered !== true) {
          const t = ctx.doc.getCellText(blockIndex, idx);
          if (t && t.length > 0) {
            const sep = ownerText.length > 0 ? " " : "";
            const delta = t.toDelta() as DeltaOp[];
            let pos = ownerText.length;
            if (sep) {
              ownerText.insert(pos, sep);
              pos += 1;
            }
            writeDeltaInto(ownerText, pos, delta);
            t.delete(0, t.length);
          }
        }
        // Reset attrs to "covered" — drops any prior rowspan/colspan.
        const m = ctx.doc.getCellAttrsMap(blockIndex, idx);
        if (m) {
          m.delete("rowspan");
          m.delete("colspan");
          m.set("covered", true);
        }
      }
    }
    // Update owner spans.
    const oMap = ctx.doc.getCellAttrsMap(blockIndex, ownerIdx);
    if (oMap) {
      const newRs = bottom - top + 1;
      const newCs = right - left + 1;
      if (newRs > 1) oMap.set("rowspan", newRs); else oMap.delete("rowspan");
      if (newCs > 1) oMap.set("colspan", newCs); else oMap.delete("colspan");
      oMap.delete("covered");
    }
    ctx.setSelection(
      collapsedSelection({ blockIndex, cellIndex: ownerIdx, offset: 0 }),
    );
  });
  return true;
}

/**
 * Clears the text of every cell in the current rectangular selection (no
 * structural mutation — spans stay intact). Returns the collapsed selection
 * at the rect's top-left when something was cleared, otherwise null.
 */
export function clearRectCells(ctx: CommandContext): Selection | null {
  const sel = ctx.getSelection();
  const rect = tableRectSelection(ctx.doc, sel);
  if (!rect) return null;
  const { blockIndex, top, left, bottom, right } = rect;
  const { cols } = ctx.doc.getTableSize(blockIndex);
  const ownerIdx = top * cols + left;
  let result: Selection | null = null;
  transact(ctx.doc, () => {
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const idx = r * cols + c;
        const a = ctx.doc.getCellAttrs(blockIndex, idx);
        if (a.covered === true) continue;
        const t = ctx.doc.getCellText(blockIndex, idx);
        if (t && t.length > 0) t.delete(0, t.length);
      }
    }
    result = collapsedSelection({ blockIndex, cellIndex: ownerIdx, offset: 0 });
    ctx.setSelection(result);
  });
  return result;
}

// ---------- Merge / split ----------

/**
 * Merge the cell at `(row, col)` with its immediate right neighbor. The right
 * neighbor must be a real cell with matching `rowspan` (otherwise the merge
 * would form a non-rectangle). Returns true on success, false on shape
 * mismatch or when there is no neighbor.
 *
 * After: the owner's `colspan` grows by the neighbor's `colspan`; the
 * neighbor and all its formerly-covered cells in the merged rectangle are
 * marked `covered: true`. The neighbor's text is appended to the owner with a
 * single space delimiter (when both sides had content).
 */
export function mergeRight(ctx: CommandContext, blockIndex: number, row: number, col: number): boolean {
  if (!ctx.doc.isTable(blockIndex)) return false;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  const ownerIdx = row * cols + col;
  const ownerAttrs = ctx.doc.getCellAttrs(blockIndex, ownerIdx);
  if (ownerAttrs.covered === true) return false;
  const ownerRs = spanOf(ownerAttrs.rowspan);
  const ownerCs = spanOf(ownerAttrs.colspan);
  const nbCol = col + ownerCs;
  if (nbCol >= cols) return false;
  const nbIdx = row * cols + nbCol;
  const nbAttrs = ctx.doc.getCellAttrs(blockIndex, nbIdx);
  if (nbAttrs.covered === true) return false;
  const nbRs = spanOf(nbAttrs.rowspan);
  const nbCs = spanOf(nbAttrs.colspan);
  if (nbRs !== ownerRs) return false;

  transact(ctx.doc, () => {
    // Append neighbor's text into the owner.
    const ownerText = ctx.doc.getCellText(blockIndex, ownerIdx);
    const nbText = ctx.doc.getCellText(blockIndex, nbIdx);
    if (ownerText && nbText && nbText.length > 0) {
      const sep = ownerText.length > 0 ? " " : "";
      // Re-apply delta with marks and embeds preserved.
      const delta = nbText.toDelta() as DeltaOp[];
      let pos = ownerText.length;
      if (sep) {
        ownerText.insert(pos, sep);
        pos += 1;
      }
      writeDeltaInto(ownerText, pos, delta);
    }
    // Clear neighbor text.
    if (nbText && nbText.length > 0) nbText.delete(0, nbText.length);

    // Owner gets the widened colspan.
    const ownerMap = ctx.doc.getCellAttrsMap(blockIndex, ownerIdx);
    if (ownerMap) ownerMap.set("colspan", ownerCs + nbCs);

    // Mark all cells in the neighbor's old rectangle as covered (in case nbCs > 1,
    // they were already covered — flag still applies).
    for (let r = row; r < row + ownerRs; r++) {
      for (let c = nbCol; c < nbCol + nbCs; c++) {
        const m = ctx.doc.getCellAttrsMap(blockIndex, r * cols + c);
        if (!m) continue;
        m.delete("rowspan");
        m.delete("colspan");
        m.set("covered", true);
      }
    }
    ctx.setSelection(collapsedSelection({ blockIndex, cellIndex: ownerIdx, offset: 0 }));
  });
  return true;
}

/** Merge with the immediate bottom neighbor. Mirror of `mergeRight`. */
export function mergeDown(ctx: CommandContext, blockIndex: number, row: number, col: number): boolean {
  if (!ctx.doc.isTable(blockIndex)) return false;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  const ownerIdx = row * cols + col;
  const ownerAttrs = ctx.doc.getCellAttrs(blockIndex, ownerIdx);
  if (ownerAttrs.covered === true) return false;
  const ownerRs = spanOf(ownerAttrs.rowspan);
  const ownerCs = spanOf(ownerAttrs.colspan);
  const nbRow = row + ownerRs;
  if (nbRow >= rows) return false;
  const nbIdx = nbRow * cols + col;
  const nbAttrs = ctx.doc.getCellAttrs(blockIndex, nbIdx);
  if (nbAttrs.covered === true) return false;
  const nbRs = spanOf(nbAttrs.rowspan);
  const nbCs = spanOf(nbAttrs.colspan);
  if (nbCs !== ownerCs) return false;

  transact(ctx.doc, () => {
    const ownerText = ctx.doc.getCellText(blockIndex, ownerIdx);
    const nbText = ctx.doc.getCellText(blockIndex, nbIdx);
    if (ownerText && nbText && nbText.length > 0) {
      const sep = ownerText.length > 0 ? " " : "";
      const delta = nbText.toDelta() as DeltaOp[];
      let pos = ownerText.length;
      if (sep) {
        ownerText.insert(pos, sep);
        pos += 1;
      }
      writeDeltaInto(ownerText, pos, delta);
    }
    if (nbText && nbText.length > 0) nbText.delete(0, nbText.length);

    const ownerMap = ctx.doc.getCellAttrsMap(blockIndex, ownerIdx);
    if (ownerMap) ownerMap.set("rowspan", ownerRs + nbRs);

    for (let r = nbRow; r < nbRow + nbRs; r++) {
      for (let c = col; c < col + ownerCs; c++) {
        const m = ctx.doc.getCellAttrsMap(blockIndex, r * cols + c);
        if (!m) continue;
        m.delete("rowspan");
        m.delete("colspan");
        m.set("covered", true);
      }
    }
    ctx.setSelection(collapsedSelection({ blockIndex, cellIndex: ownerIdx, offset: 0 }));
  });
  return true;
}

/**
 * Split a merged cell back into a `rowspan × colspan` grid of independent real
 * cells. Each formerly-covered cell becomes empty and real. Returns true when
 * something was split. No-op (returns false) on a cell with no spans.
 */
export function splitCell(ctx: CommandContext, blockIndex: number, row: number, col: number): boolean {
  if (!ctx.doc.isTable(blockIndex)) return false;
  const { rows, cols } = ctx.doc.getTableSize(blockIndex);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  const idx = row * cols + col;
  const attrs = ctx.doc.getCellAttrs(blockIndex, idx);
  if (attrs.covered === true) return false;
  const rs = spanOf(attrs.rowspan);
  const cs = spanOf(attrs.colspan);
  if (rs === 1 && cs === 1) return false;

  transact(ctx.doc, () => {
    const ownerMap = ctx.doc.getCellAttrsMap(blockIndex, idx);
    if (ownerMap) {
      ownerMap.delete("rowspan");
      ownerMap.delete("colspan");
    }
    for (let r = row; r < row + rs; r++) {
      for (let c = col; c < col + cs; c++) {
        if (r === row && c === col) continue;
        const m = ctx.doc.getCellAttrsMap(blockIndex, r * cols + c);
        if (!m) continue;
        m.delete("covered");
        m.delete("rowspan");
        m.delete("colspan");
      }
    }
    ctx.setSelection(collapsedSelection({ blockIndex, cellIndex: idx, offset: 0 }));
  });
  return true;
}

// ---------- Column widths (Sub-phase 4.4) ----------

/** Set the width (in CSS px) of a specific column. Auto-initializes `colWidths`. */
export function setColumnWidth(
  ctx: CommandContext,
  blockIndex: number,
  col: number,
  widthPx: number,
): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { cols } = ctx.doc.getTableSize(blockIndex);
  if (col < 0 || col >= cols) return;
  const w = Math.max(20, Math.round(widthPx));
  transact(ctx.doc, () => {
    const attrsMap = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!attrsMap) return;
    const current = attrsMap.get("colWidths") as number[] | undefined;
    const next = Array.isArray(current) && current.length === cols
      ? current.slice()
      : new Array<number>(cols).fill(120);
    next[col] = w;
    attrsMap.set("colWidths", next);
  });
}

/**
 * Move the caret to the next cell of the same table (Tab). At the last cell of
 * the last row, creates a new row and lands in its first cell. Returns true
 * when handled. Caret must be inside a table for this to act.
 */
export function moveToNextCell(ctx: CommandContext): boolean {
  const sel = ctx.getSelection();
  const loc = tableLocationOf(ctx.doc, sel.focus);
  if (!loc) return false;
  const { rows, cols } = ctx.doc.getTableSize(loc.blockIndex);
  if (rows <= 0 || cols <= 0) return false;

  // Walk forward starting at the cell immediately following the owner's bottom-right.
  // For a non-spanning cell that's `flat + 1`; for a span, it's `(loc.row, loc.col + colspan)`
  // — but conceptually the owner's "next" sibling is simply the next real cell in row-major
  // order after the owner's flat index, since covered cells get skipped by the loop below.
  const startFlat = loc.row * cols + loc.col + 1;
  const next = findNextRealCell(ctx.doc, loc.blockIndex, startFlat, rows * cols);
  if (next == null) {
    // No more cells in the table — append a new row and land in its first cell.
    insertTableRow(ctx, loc.blockIndex, rows - 1, "after");
    return true;
  }
  ctx.setSelection(
    collapsedSelection({ blockIndex: loc.blockIndex, cellIndex: next, offset: 0 }),
  );
  return true;
}

/** Move the caret to the previous cell (Shift+Tab). At the first cell, no-op (returns true). */
export function moveToPrevCell(ctx: CommandContext): boolean {
  const sel = ctx.getSelection();
  const loc = tableLocationOf(ctx.doc, sel.focus);
  if (!loc) return false;
  const { rows, cols } = ctx.doc.getTableSize(loc.blockIndex);
  if (rows <= 0 || cols <= 0) return false;
  const startFlat = loc.row * cols + loc.col - 1;
  if (startFlat < 0) return true; // at (0,0) — handled but no-op
  const prev = findPrevRealCell(ctx.doc, loc.blockIndex, startFlat);
  if (prev == null) return true;
  const cellText = ctx.doc.getCellText(loc.blockIndex, prev);
  const off = cellText?.length ?? 0;
  ctx.setSelection(
    collapsedSelection({ blockIndex: loc.blockIndex, cellIndex: prev, offset: off }),
  );
  return true;
}

function findNextRealCell(
  doc: EditorDocument,
  blockIndex: number,
  startFlat: number,
  total: number,
): number | null {
  for (let i = startFlat; i < total; i++) {
    if (doc.getCellAttrs(blockIndex, i).covered !== true) return i;
  }
  return null;
}

function findPrevRealCell(
  doc: EditorDocument,
  blockIndex: number,
  startFlat: number,
): number | null {
  for (let i = startFlat; i >= 0; i--) {
    if (doc.getCellAttrs(blockIndex, i).covered !== true) return i;
  }
  return null;
}

/**
 * Append/write a delta's ops into `yText` starting at `pos`, preserving marks
 * AND image embeds. Returns the position right after the last write.
 */
function writeDeltaInto(yText: Y.Text, pos: number, delta: DeltaOp[]): number {
  let cursor = pos;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      if (op.insert.length === 0) continue;
      if (op.attributes && Object.keys(op.attributes).length > 0) {
        yText.insert(cursor, op.insert, op.attributes as Record<string, unknown>);
      } else {
        yText.insert(cursor, op.insert);
      }
      cursor += op.insert.length;
    } else if (op.insert != null) {
      // Embed (e.g. ImageEmbed). Y.Text accepts arbitrary JSON-serializable
      // objects as length-1 inserts.
      if (op.attributes && Object.keys(op.attributes).length > 0) {
        yText.insert(
          cursor,
          op.insert as unknown as string,
          op.attributes as Record<string, unknown>,
        );
      } else {
        yText.insert(cursor, op.insert as unknown as string);
      }
      cursor += 1;
    }
  }
  return cursor;
}

// ---------- Inline embeds (Fase 5: imagens) ----------

/**
 * Insert an inline image embed at the current selection. Embeds occupy 1 char
 * in offset arithmetic (Y.Text treats them as length-1 inserts).
 */
export function insertImage(ctx: CommandContext, embed: ImageEmbed): void {
  clearRectCells(ctx);
  transact(ctx.doc, () => {
    const sel0 = ctx.getSelection();
    let cursor = sel0;
    if (!isCollapsed(sel0)) cursor = deleteRange(ctx.doc, sel0);
    const pos = cursor.focus;
    const yText = ctx.doc.textAt(pos.blockIndex, pos.cellIndex);
    if (!yText) return;
    // Y.Text accepts non-string inserts natively.
    yText.insert(pos.offset, embed as unknown as string);
    const newPos: Position = {
      blockIndex: pos.blockIndex,
      cellIndex: pos.cellIndex,
      offset: pos.offset + 1,
    };
    ctx.setSelection(collapsedSelection(newPos));
  });
}

/**
 * Update attributes of an existing image embed at `(blockIndex, embedOffset)`.
 * Implementation: delete the 1-char slot and re-insert the merged embed in the
 * SAME transaction — Y.UndoManager coalesces delete+insert in one transact, so
 * undo treats it as a single step.
 *
 * If `newOffset` is provided and differs from `embedOffset`, the embed is moved
 * to that offset within the same block/cell. Used by wrap-left/wrap-right
 * layouts which must anchor the image at the block start so floated text wraps
 * around it (CSS float only flows text that comes AFTER the float in DOM order).
 */
export function setImageAttrs(
  ctx: CommandContext,
  blockIndex: number,
  embedOffset: number,
  partial: Partial<ImageEmbed>,
  cellIndex?: number,
  newOffset?: number,
): void {
  transact(ctx.doc, () => {
    const yText = ctx.doc.textAt(blockIndex, cellIndex);
    if (!yText) return;
    const delta = yText.toDelta() as DeltaOp[];
    let cursor = 0;
    let prev: ImageEmbed | null = null;
    for (const op of delta) {
      if (typeof op.insert === "string") {
        cursor += op.insert.length;
        continue;
      }
      if (cursor === embedOffset && isImageEmbed(op.insert)) {
        prev = op.insert;
        break;
      }
      cursor += 1;
    }
    if (!prev) return;
    const merged: ImageEmbed = { ...prev, ...partial };
    yText.delete(embedOffset, 1);
    const insertAt =
      newOffset != null && newOffset !== embedOffset
        ? Math.max(0, Math.min(newOffset, yText.length))
        : embedOffset;
    yText.insert(insertAt, merged as unknown as string);
  });
}

// Expose the Y origin so consumers (e.g. UndoManager) can filter on it.
export function isCommandOrigin(origin: unknown): boolean {
  return origin === COMMAND_ORIGIN;
}

// Allow Y.UndoManager.trackedOrigins to include the symbol.
export const TRACKED_ORIGINS: Set<unknown> = new Set([COMMAND_ORIGIN]);

// Re-export Y for downstream type checks if needed.
export { Y };
