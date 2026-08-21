import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument } from "@sofereditor/core";
import { documentToHtmlFragment } from "../html";

function docComTabela(rows: number, cols: number, rowHeights?: number[]): LegacySerializedDocument {
  return [
    {
      type: "table",
      text: "",
      delta: [],
      attrs: {
        rows,
        cols,
        ...(rowHeights != null ? { rowHeights } : {}),
      },
      cells: Array.from({ length: rows * cols }, () => ({ text: "", delta: [], attrs: {} })),
    },
  ];
}

describe("rowHeights no HTML de servidor (export-pdf)", () => {
  it("cada <tr> sai com o height declarado, em px", () => {
    const html = documentToHtmlFragment(docComTabela(3, 2, [40, 16, 99]));
    const trs = [...html.matchAll(/<tr[^>]*>/g)].map((m) => m[0]);
    expect(trs).toHaveLength(3);
    expect(trs[0]).toBe('<tr style="height:40px">');
    expect(trs[1]).toBe('<tr style="height:16px">');
    expect(trs[2]).toBe('<tr style="height:99px">');
  });

  it("sem rowHeights, o <tr> sai sem estilo nenhum — comportamento de hoje", () => {
    const html = documentToHtmlFragment(docComTabela(2, 2));
    const trs = [...html.matchAll(/<tr[^>]*>/g)].map((m) => m[0]);
    expect(trs).toHaveLength(2);
    for (const tr of trs) expect(tr).toBe("<tr>");
  });
});
