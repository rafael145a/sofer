import type { BlockAttrs, CellAttrs, DeltaOp, SerializedBlock, SerializedCell } from "@sofer/core";
import {
  attr,
  childrenOf,
  findChild,
  findChildren,
  tagOf,
  type OoxmlNode,
} from "./parse-xml";
import { paragraphChildrenToDelta, type RunContext } from "./runs";
import { parseIntAttr } from "./units";

/**
 * Map a `<w:tbl>` element to a SerializedBlock(table). The output `cells` array
 * is row-major with `rows * cols` entries — covered slots are filled with
 * `{attrs: {covered: true}}` placeholders so it matches the invariant required
 * by `@sofer/core`'s `EditorDocument`.
 */
export function tableToBlock(tbl: OoxmlNode, ctx: RunContext): SerializedBlock {
  const tblGrid = findChild(tbl, "w:tblGrid");
  const gridCols = tblGrid ? findChildren(tblGrid, "w:gridCol") : [];
  const trs = findChildren(tbl, "w:tr");

  // The docx writer (and Word itself) may emit fewer `<w:gridCol>` entries than
  // the table's logical column count when a row has merged cells. Take the max
  // of (declared gridCols, widest row's total gridSpan) to stay robust.
  let cols = gridCols.length;
  for (const tr of trs) {
    const tcs = findChildren(tr, "w:tc");
    let count = 0;
    for (const tc of tcs) count += gridSpanOf(tc);
    if (count > cols) cols = count;
  }
  if (cols < 1) cols = 1;
  const rows = trs.length;

  // Build a row-major grid of slots. Each slot is either a real cell or marked
  // as covered. We track which (row, col) is the anchor for vMerge groups.
  const slots: Array<SerializedCell | null> = new Array(rows * cols).fill(null);
  // Anchor of the active vMerge per column index; resets when a non-merge cell
  // is placed in the same column.
  const vMergeAnchorByCol = new Map<number, { row: number; col: number }>();

  for (let r = 0; r < rows; r++) {
    const tr = trs[r];
    let cursor = 0;
    for (const tc of findChildren(tr, "w:tc")) {
      // Advance the cursor past already-occupied (covered-from-above) slots.
      while (cursor < cols && slots[r * cols + cursor] !== null) cursor++;
      if (cursor >= cols) break;

      const tcPr = findChild(tc, "w:tcPr");
      const gridSpan = gridSpanOf(tc);
      const vMergeNode = tcPr ? findChild(tcPr, "w:vMerge") : undefined;
      const vMergeVal = vMergeNode ? (attr(vMergeNode, "w:val") ?? "continue") : null;

      if (vMergeNode && vMergeVal !== "restart") {
        // Continuation of a vertical merge. Cover this row, and bump the anchor's
        // rowspan if we can find it.
        const anchor = vMergeAnchorByCol.get(cursor);
        if (anchor) {
          const anchorIdx = anchor.row * cols + anchor.col;
          const a = slots[anchorIdx];
          if (a) {
            a.attrs = { ...(a.attrs ?? {}), rowspan: (a.attrs?.rowspan ?? 1) + 1 };
          }
        }
        for (let c = 0; c < gridSpan && cursor + c < cols; c++) {
          slots[r * cols + cursor + c] = coveredCell();
        }
        cursor += gridSpan;
        continue;
      }

      // Real cell: build its delta + attrs.
      const delta = cellChildrenToDelta(tc, ctx);
      const text = textOfDelta(delta);
      const cellAttrs: CellAttrs = {};
      if (gridSpan > 1) cellAttrs.colspan = gridSpan;
      // rowspan starts at 1 — vMerge continuations bump it.

      const realCell: SerializedCell = { text, delta, attrs: cellAttrs };
      slots[r * cols + cursor] = realCell;

      // Mark horizontally-covered slots from gridSpan.
      for (let c = 1; c < gridSpan && cursor + c < cols; c++) {
        slots[r * cols + cursor + c] = coveredCell();
      }

      if (vMergeVal === "restart") {
        vMergeAnchorByCol.set(cursor, { row: r, col: cursor });
      } else {
        vMergeAnchorByCol.delete(cursor);
      }
      cursor += gridSpan;
    }

    // Fill any trailing un-touched slots in this row with empty placeholders so
    // the row-major invariant holds (length = rows * cols).
    for (let c = 0; c < cols; c++) {
      if (slots[r * cols + c] === null) {
        slots[r * cols + c] = emptyCell();
      }
    }
  }

  const cells: SerializedCell[] = slots.map((s) => s ?? emptyCell());

  const attrs: BlockAttrs = { rows, cols };
  return { type: "table", text: "", delta: [], attrs, cells };
}

function gridSpanOf(tc: OoxmlNode): number {
  const tcPr = findChild(tc, "w:tcPr");
  if (!tcPr) return 1;
  const gs = findChild(tcPr, "w:gridSpan");
  if (!gs) return 1;
  const n = parseIntAttr(attr(gs, "w:val"), 1);
  return Math.max(1, n);
}

function cellChildrenToDelta(tc: OoxmlNode, ctx: RunContext): DeltaOp[] {
  // A cell can contain multiple paragraphs; we concat their deltas with a
  // newline between adjacent ones to preserve visual separation. The cell
  // model in @sofer/core is a single Y.Text, so we flatten.
  const out: DeltaOp[] = [];
  let first = true;
  for (const child of childrenOf(tc)) {
    if (tagOf(child) !== "w:p") continue;
    if (!first) out.push({ insert: "\n" });
    first = false;
    out.push(...paragraphChildrenToDelta(childrenOf(child), ctx));
  }
  return out;
}

function textOfDelta(delta: DeltaOp[]): string {
  let out = "";
  for (const op of delta) {
    if (typeof op.insert === "string") out += op.insert;
  }
  return out;
}

function coveredCell(): SerializedCell {
  return { text: "", delta: [], attrs: { covered: true } };
}

function emptyCell(): SerializedCell {
  return { text: "", delta: [], attrs: {} };
}
