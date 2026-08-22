import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";
import { MIN_TABELA_PCT, MAX_TABELA_PCT } from "@sofereditor/core";

async function docxFromBody(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const CELULA = "<w:tc><w:p/></w:tc>";
const LINHA = `<w:tr>${CELULA}${CELULA}</w:tr>`;
const tabelaComLargura = (tblW: string) =>
  `<w:tbl><w:tblPr>${tblW}</w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>${LINHA}</w:tbl>`;

async function larguraImportada(tblW: string): Promise<number | undefined> {
  const doc = await docxBlobToDocument(await docxFromBody(tabelaComLargura(tblW)));
  const tabela = doc.blocks.find((b) => b.type === "table");
  expect(tabela).toBeDefined();
  return tabela!.attrs.tableWidth;
}

/**
 * O Word aceita tabela mais larga que a página; o editor não.
 *
 * Medido no navegador com a geometria real (794px de página, 96px de margem,
 * `overflow: hidden`): a 113% a tabela invade 80 dos 96px de margem e para a
 * 17px da borda do papel — dentro da faixa que impressora não imprime. A 150%
 * ela é CORTADA e a última coluna some da tela e do papel.
 *
 * O clamp usa a mesma faixa de `setTableWidth`, importada do core: duas
 * travas separadas divergiriam com o tempo.
 */
describe("largura de tabela importada fica dentro da faixa do modelo", () => {
  it("pct acima do teto vira o teto", async () => {
    // 7500 quinquagésimos = 150%.
    expect(await larguraImportada('<w:tblW w:w="7500" w:type="pct"/>')).toBe(MAX_TABELA_PCT);
  });

  it("dxa maior que a largura útil vira o teto", async () => {
    // Largura útil desta página: 11906 - 1440*2 = 9026 twips.
    expect(await larguraImportada('<w:tblW w:w="9639" w:type="dxa"/>')).toBe(MAX_TABELA_PCT);
  });

  it("dxa minúsculo vira o piso, não some", async () => {
    expect(await larguraImportada('<w:tblW w:w="500" w:type="dxa"/>')).toBe(MIN_TABELA_PCT);
  });

  it("valor dentro da faixa passa sem alteração", async () => {
    // Metade da largura útil.
    expect(await larguraImportada('<w:tblW w:w="4513" w:type="dxa"/>')).toBeCloseTo(50, 1);
  });

  it("sufixo % do ST_MeasurementOrPercent não é descartado", async () => {
    // `Number("60%")` é NaN. Sem tratar, a largura sumia calada e a tabela
    // voltava com 100% — o professor via estreita e o reimport devolvia larga.
    expect(await larguraImportada('<w:tblW w:w="60%" w:type="pct"/>')).toBeCloseTo(60, 1);
  });
});
