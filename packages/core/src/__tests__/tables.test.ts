import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  deleteBackward,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  insertTable,
  insertTableColumn,
  insertTableRow,
  insertText,
  moveToNextCell,
  moveToPrevCell,
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
    setSelection: (s) => {
      selection = s;
    },
  };
  return {
    doc,
    ctx,
    get selection() {
      return selection;
    },
  };
}

describe("tables — model + insertion", () => {
  it("insertTable creates a rows×cols table and lands the caret in cell 0", () => {
    const h = harness();
    insertTable(h.ctx, 2, 3);

    // [paragraph, table]
    expect(h.doc.blockCount()).toBe(2);
    expect(h.doc.getBlockType(1)).toBe("table");

    const { rows, cols } = h.doc.getTableSize(1);
    expect(rows).toBe(2);
    expect(cols).toBe(3);

    const cells = h.doc.getCells(1);
    expect(cells?.length).toBe(6);

    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
  });

  it("typing inside a cell only mutates that cell's Y.Text", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    insertText(h.ctx, "hi");

    expect(h.doc.getCellText(1, 0)?.toString()).toBe("hi");
    expect(h.doc.getCellText(1, 1)?.toString()).toBe("");
    expect(h.doc.getCellText(1, 2)?.toString()).toBe("");
    expect(h.doc.getCellText(1, 3)?.toString()).toBe("");
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 2 });
  });

  it("backspace at offset 0 of a cell is a no-op (cannot escape table)", () => {
    const h = harness();
    insertTable(h.ctx, 1, 2);
    // caret at cell 0, offset 0
    deleteBackward(h.ctx);
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
    expect(h.doc.blockCount()).toBe(2);
  });
});

describe("tables — Tab navigation", () => {
  it("moveToNextCell advances within a row, wraps to next row at end of row", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    // (0,0) → (0,1)
    expect(moveToNextCell(h.ctx)).toBe(true);
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 1, offset: 0 });
    // (0,1) → (1,0)
    moveToNextCell(h.ctx);
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 2, offset: 0 });
  });

  it("Tab at the last cell of a table appends a new row and lands there", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    // Walk to last cell (cellIndex 3)
    moveToNextCell(h.ctx);
    moveToNextCell(h.ctx);
    moveToNextCell(h.ctx);
    expect(h.selection.focus.cellIndex).toBe(3);
    moveToNextCell(h.ctx);
    const { rows } = h.doc.getTableSize(1);
    expect(rows).toBe(3);
    // First cell of the new row
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 4, offset: 0 });
  });

  it("moveToPrevCell walks back; no-op at (0,0)", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    moveToNextCell(h.ctx); // (0,0) → (0,1)
    moveToPrevCell(h.ctx); // (0,1) → (0,0), caret at end of empty cell 0 → offset 0
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
    expect(moveToPrevCell(h.ctx)).toBe(true); // returns true even when no-op
  });
});

describe("tables — row/col mutations", () => {
  it("insertTableRow before/after grows rows and preserves the cells of other rows", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    insertText(h.ctx, "A"); // cell (0,0)

    insertTableRow(h.ctx, 1, 0, "after");
    const { rows, cols } = h.doc.getTableSize(1);
    expect(rows).toBe(3);
    expect(cols).toBe(2);
    expect(h.doc.getCells(1)?.length).toBe(6);
    // (0,0) is still "A"; the freshly inserted row sits as cells 2–3 (empty).
    expect(h.doc.getCellText(1, 0)?.toString()).toBe("A");
    expect(h.doc.getCellText(1, 2)?.toString()).toBe("");
    expect(h.doc.getCellText(1, 3)?.toString()).toBe("");
    // Caret jumps into the new row's first cell.
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 2, offset: 0 });
  });

  it("insertTableColumn at right inserts one cell per row", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    // Caret at (0,0)
    insertTableColumn(h.ctx, 1, 0, "after");
    const { rows, cols } = h.doc.getTableSize(1);
    expect(rows).toBe(2);
    expect(cols).toBe(3);
    expect(h.doc.getCells(1)?.length).toBe(6);
  });

  it("deleteTableRow drops a row; deleting the last row deletes the table", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);

    deleteTableRow(h.ctx, 1, 0);
    expect(h.doc.getTableSize(1).rows).toBe(1);

    // Now only one row left; deleting it must remove the whole table.
    deleteTableRow(h.ctx, 1, 0);
    expect(h.doc.blockCount()).toBe(1);
    expect(h.doc.getBlockType(0)).toBe("paragraph");
  });

  it("deleteTableColumn drops a column; deleting the last column deletes the table", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);

    deleteTableColumn(h.ctx, 1, 0);
    expect(h.doc.getTableSize(1).cols).toBe(1);

    deleteTableColumn(h.ctx, 1, 0);
    expect(h.doc.blockCount()).toBe(1);
    expect(h.doc.getBlockType(0)).toBe("paragraph");
  });

  it("deleteTable replaces the table with a paragraph when it was the only block", () => {
    const h = harness();
    // Remove the default empty paragraph first to simulate "only a table".
    insertTable(h.ctx, 1, 1);
    h.doc.blocks.delete(0, 1); // drop the original paragraph
    expect(h.doc.blockCount()).toBe(1);
    expect(h.doc.getBlockType(0)).toBe("table");

    deleteTable(h.ctx, 0);
    expect(h.doc.blockCount()).toBe(1);
    expect(h.doc.getBlockType(0)).toBe("paragraph");
  });
});

describe("tables — location helper", () => {
  it("tableLocationOf returns null outside tables and (row,col) inside", () => {
    const h = harness();
    expect(tableLocationOf(h.doc, h.selection.focus)).toBeNull();

    insertTable(h.ctx, 3, 4);
    // cell 7 in a 3x4 table → row 1, col 3
    const pos = { blockIndex: 1, cellIndex: 7, offset: 0 };
    expect(tableLocationOf(h.doc, pos)).toEqual({ blockIndex: 1, row: 1, col: 3 });
  });
});
