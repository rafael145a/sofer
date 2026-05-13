import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  cellsInRect,
  collapsedSelection,
  deleteBackward,
  expandTableRect,
  insertTable,
  insertText,
  mergeRight,
  mergeSelection,
  tableRectSelection,
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
    doc, ctx,
    get selection() { return selection; },
    setSel(s: Selection) { selection = s; },
  };
}

describe("tables — rectangular selection helper", () => {
  it("tableRectSelection returns null for collapsed or non-table selections", () => {
    const h = harness();
    expect(tableRectSelection(h.doc, h.selection)).toBeNull();

    insertTable(h.ctx, 2, 3);
    // Collapsed inside a cell — not a rect.
    h.setSel(collapsedSelection({ blockIndex: 1, cellIndex: 0, offset: 0 }));
    expect(tableRectSelection(h.doc, h.selection)).toBeNull();
  });

  it("tableRectSelection orders endpoints into a min/max rect", () => {
    const h = harness();
    insertTable(h.ctx, 3, 3);
    // anchor at (2,2), focus at (0,0) — expect rect (0,0)–(2,2)
    h.setSel({
      anchor: { blockIndex: 1, cellIndex: 8, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 0, offset: 0 },
    });
    const r = tableRectSelection(h.doc, h.selection);
    expect(r).toEqual({ blockIndex: 1, top: 0, left: 0, bottom: 2, right: 2 });
  });

  it("expandTableRect grows the rect to include spans that protrude outside", () => {
    const h = harness();
    insertTable(h.ctx, 3, 3);
    // (0,0) spans cols 0..1. mergeDown isn't valid here (colspan mismatch),
    // so we test column-span expansion alone.
    mergeRight(h.ctx, 1, 0, 0);
    const r = expandTableRect(h.doc, 1, 0, 0, 0, 0);
    expect(r).toEqual({ blockIndex: 1, top: 0, left: 0, bottom: 0, right: 1 });
  });

  it("expandTableRect pulls in covered cells' owners when only a covered cell is selected", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    mergeRight(h.ctx, 1, 0, 0); // (0,0) owns (0,0)-(0,1); (0,1) covered
    // Select just the covered cell — rect should be expanded back to the owner.
    const r = expandTableRect(h.doc, 1, 0, 1, 0, 1);
    expect(r).toEqual({ blockIndex: 1, top: 0, left: 0, bottom: 0, right: 1 });
  });

  it("cellsInRect enumerates every flat index inside the rect", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    const rect = { blockIndex: 1, top: 0, left: 1, bottom: 1, right: 2 };
    expect(cellsInRect(h.doc, rect)).toEqual([1, 2, 4, 5]);
  });
});

describe("tables — mergeSelection", () => {
  it("merges every cell in a rectangular selection into one owner at top-left", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);
    // Put text in two cells.
    insertText(h.ctx, "A");
    h.setSel(collapsedSelection({ blockIndex: 1, cellIndex: 4, offset: 0 }));
    insertText(h.ctx, "B");
    // Select the whole table rect.
    h.setSel({
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 5, offset: 0 },
    });
    const merged = mergeSelection(h.ctx);
    expect(merged).toBe(true);
    expect(h.doc.getCellAttrs(1, 0).rowspan).toBe(2);
    expect(h.doc.getCellAttrs(1, 0).colspan).toBe(3);
    expect(h.doc.getCellText(1, 0)?.toString()).toBe("A B");
    for (let i = 1; i < 6; i++) {
      expect(h.doc.getCellAttrs(1, i).covered).toBe(true);
    }
  });

  it("returns false when there is no rectangular selection", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    expect(mergeSelection(h.ctx)).toBe(false);
  });
});

describe("tables — rect-aware editing", () => {
  it("typing into a rect selection clears all cells and inserts at top-left", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    insertText(h.ctx, "A");
    h.setSel(collapsedSelection({ blockIndex: 1, cellIndex: 3, offset: 0 }));
    insertText(h.ctx, "D");
    h.setSel({
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 3, offset: 0 },
    });
    insertText(h.ctx, "X");
    expect(h.doc.getCellText(1, 0)?.toString()).toBe("X");
    expect(h.doc.getCellText(1, 1)?.toString()).toBe("");
    expect(h.doc.getCellText(1, 2)?.toString()).toBe("");
    expect(h.doc.getCellText(1, 3)?.toString()).toBe("");
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 1 });
  });

  it("backspace on a rect selection clears the cells and collapses to top-left", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    insertText(h.ctx, "A");
    h.setSel(collapsedSelection({ blockIndex: 1, cellIndex: 3, offset: 0 }));
    insertText(h.ctx, "D");
    h.setSel({
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 3, offset: 0 },
    });
    deleteBackward(h.ctx);
    expect(h.doc.getCellText(1, 0)?.toString()).toBe("");
    expect(h.doc.getCellText(1, 3)?.toString()).toBe("");
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
  });
});
