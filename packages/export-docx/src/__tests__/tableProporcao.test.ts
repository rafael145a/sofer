import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { convertMillimetersToTwip } from "docx";
import { DEFAULT_PAGE_SETTINGS, pxToMm, type SerializedDocument } from "@sofereditor/core";
import { documentToDocxBuffer } from "../docx";

/** Atalho para não repetir `convertMillimetersToTwip` em todo `expect`. */
function mmToTwip(mm: number): number {
  return convertMillimetersToTwip(mm);
}

/** Devolve o `word/document.xml` cru do docx gerado. */
async function xmlDe(doc: SerializedDocument): Promise<string> {
  const { buffer } = await documentToDocxBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

/** Alias semântico: mesma coisa que `xmlDe`, para ler melhor nos testes de largura. */
const gerar = xmlDe;

/** Soma os `w:w` de todo `<w:gridCol>` do XML — a largura total da tabela em twips. */
function somaColunas(xml: string): number {
  const matches = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)];
  return matches.reduce((soma, m) => soma + Number(m[1]), 0);
}

/**
 * Monta um `SerializedDocument` com uma única tabela 1×N (N = `colWidths.length`),
 * ou R×N quando `rowHeights` é dado (uma linha por altura). `pageSettings`
 * fica ausente de propósito nos dois primeiros testes: ausente = A4 + margens
 * de 25.4mm (`DEFAULT_PAGE_SETTINGS`), que é exatamente o cenário do norte do
 * projeto — 513px de modelo antigo vs. 600px vistos na tela/PDF numa A4 padrão.
 */
function docComTabela(
  colWidths: number[],
  tableWidth?: number,
  rowHeights?: number[],
): SerializedDocument {
  const cols = colWidths.length;
  const rows = rowHeights?.length ?? 1;
  const cells = Array.from({ length: rows * cols }, () => ({
    text: "x",
    delta: [{ insert: "x" }],
    attrs: {},
  }));
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: {
          rows,
          cols,
          colWidths,
          ...(tableWidth !== undefined ? { tableWidth } : {}),
          ...(rowHeights ? { rowHeights } : {}),
        },
        cells,
      },
    ],
  };
}

// Largura útil calculada a partir do MESMO `PageSettings` que o export usa —
// não de "210mm de A4" hardcoded. O preset A4 grava 794px @ 96dpi, que
// arredonda para ~210.18mm (não os 210mm exatos do papel físico); calcular a
// partir de mm literais bate a poucos twips do valor real, mas erra o
// suficiente para estourar uma tolerância apertada. Buscar do settings é
// exatamente a regra #3 do brief ("a largura útil tem que sair do
// pageSettings real, não de constante cravada") aplicada também ao teste.
const settings = DEFAULT_PAGE_SETTINGS;
const larguraUtilTwipsA4 = mmToTwip(
  pxToMm(settings.width - settings.marginLeft - settings.marginRight),
);

describe("a tabela no Word tem a MESMA largura do editor", () => {
  it("proporção vira twips contra a largura útil da página", async () => {
    // Este é o item que o norte do projeto cobra: hoje o DOCX fixa a soma
    // dos px do modelo (513 px) enquanto o professor vê 600 px na tela e no
    // PDF. Com proporção contra a largura útil, os três passam a bater.
    const xml = await gerar(docComTabela([25, 25, 25, 25]));
    expect(somaColunas(xml)).toBeCloseTo(larguraUtilTwipsA4, -1);
  });

  it("tableWidth reduz a largura total proporcionalmente", async () => {
    const xml = await gerar(docComTabela([25, 25, 25, 25], 50));
    expect(somaColunas(xml)).toBeCloseTo(larguraUtilTwipsA4 / 2, -1);
  });

  it("rowHeights vira w:trHeight com hRule=atLeast", async () => {
    // `atLeast` e não `exact`: é a MESMA semântica de mínimo do editor.
    // Com `exact` o Word cortaria o conteúdo, e texto sumindo da prova é o
    // pior desfecho possível.
    const xml = await xmlDe(docComTabela([25, 25], undefined, [40, 80]));
    expect(xml).toContain('w:hRule="atLeast"');
    expect(xml).not.toContain('w:hRule="exact"');
  });
});
