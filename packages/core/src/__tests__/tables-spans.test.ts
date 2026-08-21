import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  deleteTableColumn,
  deleteTableRow,
  insertTable,
  insertTableColumn,
  insertTableRow,
  insertText,
  mergeDown,
  mergeRight,
  moveToNextCell,
  setColumnBoundary,
  splitCell,
  tableLocationOf,
  type CommandContext,
  type Selection,
} from "../index";

function harness() {
  const doc = new EditorDocument();
  let selection: Selection = collapsedSelection({ blockIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => { selection = s; },
  };
  return {
    doc,
    ctx,
    get selection() { return selection; },
  };
}

describe("tables — mergeRight / mergeDown / splitCell", () => {
  it("mergeRight combines two adjacent cells; right cell becomes covered", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    // Type into (0,0) and (0,1) so we can verify text merging.
    insertText(h.ctx, "A");
    moveToNextCell(h.ctx);
    insertText(h.ctx, "B");

    const merged = mergeRight(h.ctx, 1, 0, 0);
    expect(merged).toBe(true);

    expect(h.doc.getCellText(1, 0)?.toString()).toBe("A B");
    expect(h.doc.getCellAttrs(1, 0).colspan).toBe(2);
    expect(h.doc.getCellAttrs(1, 1).covered).toBe(true);
    // Untouched cells.
    expect(h.doc.getCellAttrs(1, 2).covered).toBeUndefined();
    expect(h.doc.getCellAttrs(1, 3).covered).toBeUndefined();
  });

  it("mergeRight fails when row-extents differ (would form non-rectangle)", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    // Make (0,0) span 2 rows; (0,1) is unchanged (1 row). mergeRight should fail.
    mergeDown(h.ctx, 1, 0, 0);
    expect(h.doc.getCellAttrs(1, 0).rowspan).toBe(2);
    expect(mergeRight(h.ctx, 1, 0, 0)).toBe(false);
  });

  it("mergeDown combines a cell with the one immediately below", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    const merged = mergeDown(h.ctx, 1, 0, 0);
    expect(merged).toBe(true);
    expect(h.doc.getCellAttrs(1, 0).rowspan).toBe(2);
    expect(h.doc.getCellAttrs(1, 2).covered).toBe(true);
  });

  it("splitCell reverses a previous merge", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    mergeRight(h.ctx, 1, 0, 0);
    expect(splitCell(h.ctx, 1, 0, 0)).toBe(true);
    expect(h.doc.getCellAttrs(1, 0).colspan).toBeUndefined();
    expect(h.doc.getCellAttrs(1, 1).covered).toBeUndefined();
  });

  it("Tab navigation skips covered cells", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    mergeRight(h.ctx, 1, 0, 0); // cells (0,0)-(0,1) → one cell; (0,1) covered
    // Caret at cellIndex 0; Tab should skip cellIndex 1 (covered) and land at 2.
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, cellIndex: 0, offset: 0 }));
    moveToNextCell(h.ctx);
    expect(h.selection.focus.cellIndex).toBe(2);
  });

  it("tableLocationOf redirects from a covered position to its owner", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    mergeRight(h.ctx, 1, 0, 0);
    const loc = tableLocationOf(h.doc, { blockIndex: 1, cellIndex: 1, offset: 0 });
    expect(loc).toEqual({ blockIndex: 1, row: 0, col: 0 });
  });
});

describe("tables — span-aware row/col insertion", () => {
  it("insertTableRow extends rowspan of spans that cross the boundary", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    // Make (0,0) span rows 0 and 1.
    mergeDown(h.ctx, 1, 0, 0);
    expect(h.doc.getCellAttrs(1, 0).rowspan).toBe(2);
    // Insert a row in the middle of the span (between row 0 and row 1).
    insertTableRow(h.ctx, 1, 0, "after");
    // The span should now cover 3 rows; the new row's cell at col 0 is covered.
    expect(h.doc.getCellAttrs(1, 0).rowspan).toBe(3);
    const { cols } = h.doc.getTableSize(1);
    expect(h.doc.getCellAttrs(1, 1 * cols + 0).covered).toBe(true);
  });

  it("insertTableColumn extends colspan of spans that cross the boundary", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    mergeRight(h.ctx, 1, 0, 0);
    expect(h.doc.getCellAttrs(1, 0).colspan).toBe(2);
    insertTableColumn(h.ctx, 1, 0, "after");
    expect(h.doc.getCellAttrs(1, 0).colspan).toBe(3);
    // The new column's cell on the spanning row is covered.
    const { cols } = h.doc.getTableSize(1);
    expect(cols).toBe(3);
    expect(h.doc.getCellAttrs(1, 1).covered).toBe(true);
  });
});

describe("tables — span-aware row/col deletion", () => {
  it("deleteTableRow promotes the next row's cell when the row contains a span owner", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    // (0,0) spans rows 0 and 1.
    mergeDown(h.ctx, 1, 0, 0);
    // Delete row 0 (the owner row).
    deleteTableRow(h.ctx, 1, 0);
    // Now the cell at (0,0) (in new indices) should be the new owner with rowspan=1.
    expect(h.doc.getCellAttrs(1, 0).covered).toBeUndefined();
    expect(h.doc.getCellAttrs(1, 0).rowspan).toBeUndefined();
  });

  it("deleteTableColumn shortens spans that cross the column boundary", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    // Two consecutive mergeRights grow (0,0)'s span to cover cols 0..2.
    mergeRight(h.ctx, 1, 0, 0);
    mergeRight(h.ctx, 1, 0, 0);
    expect(h.doc.getCellAttrs(1, 0).colspan).toBe(3);
    // Delete column 1 (strictly inside the span).
    deleteTableColumn(h.ctx, 1, 1);
    expect(h.doc.getCellAttrs(1, 0).colspan).toBe(2);
  });
});

describe("tables — column widths (proportion)", () => {
  // `setColumnWidth` (absolute px) was replaced by `setColumnBoundary`
  // (moves the divide between two adjacent columns by a delta, in
  // percentage points — see packages/core/src/commands.ts). These tests
  // are rewritten for the new function but protect the same guarantees the
  // old ones did: colWidths gets populated on first use, and there is a
  // floor a column can't be pushed past.
  it("setColumnBoundary populates colWidths from equal defaults on first drag", () => {
    const h = harness();
    insertTable(h.ctx, 1, 3);
    expect(h.doc.getBlockAttrs(1).colWidths).toBeUndefined();
    setColumnBoundary(h.ctx, 1, 0, 10);
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(3);
    expect(w[0]).toBeCloseTo(43.333, 3);
    expect(w[1]).toBeCloseTo(23.333, 3);
    expect(w[2]).toBeCloseTo(33.333, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it("setColumnBoundary clamps the delta so neither side crosses the minimum (3pp)", () => {
    const h = harness();
    insertTable(h.ctx, 1, 3);
    // Explicit base so the numbers are exact, not compounded across calls.
    setColumnBoundary(h.ctx, 1, 0, -1000, [50, 25, 25]);
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(3);
    expect(w[0]).toBeCloseTo(3, 3); // floored — never goes below the minimum
    expect(w[1]).toBeCloseTo(72, 3); // 25 + everything col0 gave up (47)
    expect(w[2]).toBeCloseTo(25, 3); // untouched — not part of this boundary
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it("insertTableColumn keeps colWidths proportional and in sync", () => {
    const h = harness();
    insertTable(h.ctx, 1, 2);
    // Start from an uneven 1:2 split (was [100, 200] px in the old test).
    setColumnBoundary(h.ctx, 1, 0, -100 / 6);
    insertTableColumn(h.ctx, 1, 0, "after");
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(3);
    // Sum stays 100 — the invariant px never had to protect, because px
    // never summed to anything meaningful.
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    // The original two columns (now at indices 0 and 2 — the new column
    // was inserted between them) keep their 1:2 ratio to each other.
    expect(w[2] / w[0]).toBeCloseTo(2, 3);
  });

  it("deleteTableColumn trims colWidths and renormalizes to 100", () => {
    const h = harness();
    insertTable(h.ctx, 1, 3);
    setColumnBoundary(h.ctx, 1, 0, 0, [25, 35, 40]);
    deleteTableColumn(h.ctx, 1, 1);
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(2);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    // Remaining columns (25 and 40) keep their relative ratio — not an
    // arbitrary split.
    expect(w[1] / w[0]).toBeCloseTo(40 / 25, 2);
  });
});
