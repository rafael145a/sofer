import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument } from "@sofereditor/core";
import { documentToHtml, documentToHtmlFragment } from "../html";

function docComTabela(colWidths: number[], tableWidth?: number): LegacySerializedDocument {
  const cols = colWidths.length;
  return [
    {
      type: "table",
      text: "",
      delta: [],
      attrs: {
        rows: 1,
        cols,
        colWidths,
        ...(tableWidth != null ? { tableWidth } : {}),
      },
      cells: Array.from({ length: cols }, () => ({ text: "", delta: [], attrs: {} })),
    },
  ];
}

describe("editor e PDF emitem a MESMA proporção", () => {
  it("colgroup sai em % nos dois", () => {
    // Fragmento puro (sem a folha de estilo base) para o `not.toContain("px")`
    // testar só o colgroup — a folha base tem "px" legítimo alhures (bordas,
    // padding, embeds de imagem) que não tem nada a ver com colWidths.
    const html = documentToHtmlFragment(docComTabela([23.392, 29.825, 23.392, 23.392]));
    expect(html).toContain('<col style="width:23.392%">');
    expect(html).not.toContain("px");
  });

  it("tableWidth vai por estilo INLINE, não por CSS", () => {
    // A folha tem `.ed-table { width: 100% }` e ela NÃO muda — o inline é
    // que ganha. Se alguém "consertar" isso mexendo no CSS, quebra as
    // outras três cópias que existem nos apps.
    const html = documentToHtml(docComTabela([25, 25, 25, 25], 80));
    expect(html).toMatch(/<table[^>]*style="[^"]*width:\s*80%/);
    expect(html).toContain(".ed-table { width: 100%");
  });

  it("tableWidth ausente não emite estilo nenhum", () => {
    const html = documentToHtml(docComTabela([25, 25, 25, 25]));
    expect(html).not.toMatch(/<table[^>]*style="[^"]*width/);
  });
});
