import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";

async function docxFromBody(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** Um `<w:p>` com o `pPr` dado e, opcionalmente, texto. */
function para(pPrXml: string, text = ""): string {
  const run = text ? `<w:r><w:t>${text}</w:t></w:r>` : "";
  return `<w:p><w:pPr>${pPrXml}</w:pPr>${run}</w:p>`;
}

const BOTTOM_BORDER = '<w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr>';

async function firstBlock(bodyXml: string) {
  const doc = await docxBlobToDocument(await docxFromBody(bodyXml));
  return doc.blocks[0];
}

describe("import de linhas de resposta", () => {
  it("parágrafo vazio com pBdr inferior vira linha de resposta", async () => {
    const b = await firstBlock(para(BOTTOM_BORDER));
    expect(b.type).toBe("paragraph");
    expect(b.attrs.answerLine).toBe(true);
  });

  it("lê a entrelinha em buckets de 240 twips", async () => {
    const casos: Array<[string, number]> = [
      ['<w:spacing w:line="240" w:lineRule="auto"/>', 1],
      ['<w:spacing w:line="360" w:lineRule="auto"/>', 1.5],
      ['<w:spacing w:line="480" w:lineRule="auto"/>', 2],
    ];
    for (const [spacingXml, esperado] of casos) {
      const b = await firstBlock(para(BOTTOM_BORDER + spacingXml));
      expect(b.attrs.answerLineSpacing).toBe(esperado);
    }
  });

  it("arredonda entrelinha fora dos buckets para o mais próximo", async () => {
    const b = await firstBlock(
      para(BOTTOM_BORDER + '<w:spacing w:line="350" w:lineRule="auto"/>'),
    );
    expect(b.attrs.answerLineSpacing).toBe(1.5);
  });

  it("sem w:spacing, entrelinha vale 1", async () => {
    const b = await firstBlock(para(BOTTOM_BORDER));
    expect(b.attrs.answerLineSpacing).toBe(1);
  });

  it("ignora pBdr inferior com val none", async () => {
    const b = await firstBlock(para('<w:pBdr><w:bottom w:val="none"/></w:pBdr>'));
    expect(b.attrs.answerLine).toBeUndefined();
  });

  it("parágrafo COM texto e pBdr NÃO vira linha de resposta", async () => {
    // É um título com régua — converter destruiria a semântica do conteúdo.
    const b = await firstBlock(para(BOTTOM_BORDER, "Capítulo 1"));
    expect(b.attrs.answerLine).toBeUndefined();
    expect(b.text).toBe("Capítulo 1");
  });

  it("blockquote (borda ESQUERDA) continua blockquote", async () => {
    const b = await firstBlock(para('<w:pBdr><w:left w:val="single" w:sz="12"/></w:pBdr>', "cit"));
    expect(b.type).toBe("blockquote");
    expect(b.attrs.answerLine).toBeUndefined();
  });

  it("parágrafo comum não ganha answerLine", async () => {
    const b = await firstBlock("<w:p><w:r><w:t>oi</w:t></w:r></w:p>");
    expect(b.attrs.answerLine).toBeUndefined();
  });

  it("várias linhas de resposta seguidas viram vários blocos", async () => {
    const doc = await docxBlobToDocument(
      await docxFromBody(para(BOTTOM_BORDER).repeat(4)),
    );
    expect(doc.blocks).toHaveLength(4);
    for (const b of doc.blocks) expect(b.attrs.answerLine).toBe(true);
  });
});
