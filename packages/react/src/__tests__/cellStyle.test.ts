import { describe, it, expect } from "vitest";
import { cellStyle } from "../NodeView";
import type { CellAttrs } from "@sofereditor/core";

// Inline style applied to a table <td>. Kept as a pure helper so the visual
// cell attrs (align, bgColor) can be pinned without rendering TableView,
// which requires a full EditorProvider context.
describe("cellStyle", () => {
  it("returns undefined when the cell has no visual attrs", () => {
    expect(cellStyle({})).toBeUndefined();
    expect(cellStyle(undefined)).toBeUndefined();
    // structural attrs alone don't produce a style
    expect(cellStyle({ rowspan: 2, colspan: 3 } as CellAttrs)).toBeUndefined();
  });

  it("maps align to textAlign", () => {
    expect(cellStyle({ align: "center" } as CellAttrs)).toEqual({ textAlign: "center" });
  });

  it("maps bgColor to backgroundColor", () => {
    expect(cellStyle({ bgColor: "#ffe58f" } as CellAttrs)).toEqual({
      backgroundColor: "#ffe58f",
    });
  });

  it("combines align and bgColor", () => {
    expect(cellStyle({ align: "right", bgColor: "#d9f7be" } as CellAttrs)).toEqual({
      textAlign: "right",
      backgroundColor: "#d9f7be",
    });
  });
});
