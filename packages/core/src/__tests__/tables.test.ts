import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  createBlock,
  deleteBackward,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  insertTable,
  insertTableColumn,
  insertTableRow,
  insertText,
  mergeRight,
  moveToNextCell,
  moveToPrevCell,
  setCellAttr,
  setBlockAttr,
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

    // [paragraph, table, paragraph]
    expect(h.doc.blockCount()).toBe(3);
    expect(h.doc.getBlockType(2)).toBe("paragraph");
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
    expect(h.doc.blockCount()).toBe(3);
  });

  it("insertTable at end of doc appends a trailing empty paragraph", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    expect(h.doc.blockCount()).toBe(3); // [paragraph, table, paragraph]
    expect(h.doc.getBlockType(1)).toBe("table");
    expect(h.doc.getBlockType(2)).toBe("paragraph");
    expect(h.doc.getBlockText(2)?.toString()).toBe("");
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
  });

  it("insertTable in the middle does NOT add an extra paragraph", () => {
    const h = harness();
    h.doc.blocks.insert(1, [createBlock("paragraph")]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    const before = h.doc.blockCount(); // 2
    insertTable(h.ctx, 1, 1);
    expect(h.doc.blockCount()).toBe(before + 1); // [p, table, p]
    expect(h.doc.getBlockType(1)).toBe("table");
    expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
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
    expect(h.doc.blockCount()).toBe(2);
    expect(h.doc.getBlockType(0)).toBe("paragraph");
    expect(h.doc.getBlockType(1)).toBe("paragraph");
  });

  it("deleteTableColumn drops a column; deleting the last column deletes the table", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);

    deleteTableColumn(h.ctx, 1, 0);
    expect(h.doc.getTableSize(1).cols).toBe(1);

    deleteTableColumn(h.ctx, 1, 0);
    expect(h.doc.blockCount()).toBe(2);
    expect(h.doc.getBlockType(0)).toBe("paragraph");
    expect(h.doc.getBlockType(1)).toBe("paragraph");
  });

  it("deleteTable replaces the table with a paragraph when it was the only block", () => {
    const h = harness();
    insertTable(h.ctx, 1, 1); // [p, table, p]
    h.doc.blocks.delete(2, 1); // drop trailing paragraph → [p, table]
    h.doc.blocks.delete(0, 1); // drop leading paragraph → [table]
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

describe("tables — cell alignment (setCellAttr)", () => {
  it("writes align on the focused single cell", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2); // caret em {block:1, cell:0}
    setCellAttr(h.ctx, "align", "center");
    expect(h.doc.getCellAttrs(1, 0).align).toBe("center");
    expect(h.doc.getCellAttrs(1, 1).align).toBeUndefined();
    expect(h.doc.getCellAttrs(1, 3).align).toBeUndefined();
  });

  it("applies align to all real cells of a rectangular multi-cell selection", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    h.ctx.setSelection({
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 3, offset: 0 },
    });
    setCellAttr(h.ctx, "align", "right");
    expect(h.doc.getCellAttrs(1, 0).align).toBe("right");
    expect(h.doc.getCellAttrs(1, 1).align).toBe("right");
    expect(h.doc.getCellAttrs(1, 2).align).toBe("right");
    expect(h.doc.getCellAttrs(1, 3).align).toBe("right");
  });

  it("value null removes the align key", () => {
    const h = harness();
    insertTable(h.ctx, 1, 1);
    setCellAttr(h.ctx, "align", "justify");
    expect(h.doc.getCellAttrs(1, 0).align).toBe("justify");
    setCellAttr(h.ctx, "align", null);
    expect(h.doc.getCellAttrs(1, 0).align).toBeUndefined();
  });

  it("is a no-op when the caret is not inside a table; setBlockAttr stays no-op in a cell", () => {
    const h = harness();
    expect(() => setCellAttr(h.ctx, "align", "center")).not.toThrow();
    insertTable(h.ctx, 1, 1);
    setBlockAttr(h.ctx, "align", "center");
    expect(h.doc.getBlockAttrs(1).align).toBeUndefined();
  });

  it("redirects a covered cell to its owner", () => {
    const h = harness();
    insertTable(h.ctx, 1, 2); // table at block 1: cells 0 and 1
    mergeRight(h.ctx, 1, 0, 0); // cell 0 is now owner (colspan 2); cell 1 is covered
    // Place caret on covered cellIndex 1.
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, cellIndex: 1, offset: 0 }));
    setCellAttr(h.ctx, "align", "center");
    // Attribute must land on the owner (cell 0), not be a no-op.
    expect(h.doc.getCellAttrs(1, 0).align).toBe("center");
  });
});

describe("tables — cell background (setCellAttr bgColor)", () => {
  it("paints a rectangular selection and survives toJSON serialization", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    h.ctx.setSelection({
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 1, offset: 0 },
    });
    setCellAttr(h.ctx, "bgColor", "#ffe58f");
    // top row painted, bottom row untouched
    expect(h.doc.getCellAttrs(1, 0).bgColor).toBe("#ffe58f");
    expect(h.doc.getCellAttrs(1, 1).bgColor).toBe("#ffe58f");
    expect(h.doc.getCellAttrs(1, 2).bgColor).toBeUndefined();
    // serializeCell must pass the key through (guards against attr whitelisting)
    const table = h.doc.toJSON().blocks[1];
    expect(table.cells?.[0]?.attrs.bgColor).toBe("#ffe58f");
    expect(table.cells?.[2]?.attrs.bgColor).toBeUndefined();
    // null clears
    setCellAttr(h.ctx, "bgColor", null);
    expect(h.doc.getCellAttrs(1, 0).bgColor).toBeUndefined();
  });
});
