import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";

/**
 * O Word emite um `w:pBdr` COMPLETO com todos os lados `w:val="none"` — uma
 * declaração no-op. O importador tratava a mera presença de `<w:left>` como
 * "tem borda esquerda" e convertia o parágrafo em blockquote, que renderiza
 * cinza (#6b7280) e itálico. Resultado: trechos pretos do documento original
 * chegavam com cor diferente.
 */
async function docxFromBody(bodyXml: string) {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return docxBlobToDocument(await zip.generateAsync({ type: "uint8array" }));
}

const para = (pPrXml: string, texto = "conteúdo") =>
  `<w:p><w:pPr>${pPrXml}</w:pPr><w:r><w:t>${texto}</w:t></w:r></w:p>`;

/** pBdr no-op, exatamente como o Word grava. */
const PBDR_NONE =
  '<w:pBdr>' +
  '<w:top w:color="000000" w:space="0" w:sz="0" w:val="none"/>' +
  '<w:left w:color="000000" w:space="0" w:sz="0" w:val="none"/>' +
  '<w:bottom w:color="000000" w:space="0" w:sz="0" w:val="none"/>' +
  '<w:right w:color="000000" w:space="0" w:sz="0" w:val="none"/>' +
  '<w:between w:color="000000" w:space="0" w:sz="0" w:val="none"/>' +
  '</w:pBdr>';

const tipoDe = async (pPr: string) => (await docxFromBody(para(pPr))).blocks[0].type;

describe("bordas de parágrafo no import", () => {
  it("pBdr com todos os lados none NÃO vira blockquote", async () => {
    expect(await tipoDe(PBDR_NONE)).toBe("paragraph");
  });

  it("w:left val=nil também não vira blockquote", async () => {
    expect(await tipoDe('<w:pBdr><w:left w:val="nil"/></w:pBdr>')).toBe("paragraph");
  });

  it("w:left sem w:val não vira blockquote", async () => {
    expect(await tipoDe('<w:pBdr><w:left w:sz="0"/></w:pBdr>')).toBe("paragraph");
  });

  it("borda esquerda DE VERDADE continua virando blockquote", async () => {
    expect(await tipoDe('<w:pBdr><w:left w:val="single" w:sz="12"/></w:pBdr>')).toBe("blockquote");
  });

  it("borda esquerda ligada convive com os outros lados em none", async () => {
    const pPr =
      '<w:pBdr><w:top w:val="none"/><w:left w:val="single" w:sz="12"/>' +
      '<w:bottom w:val="none"/><w:right w:val="none"/></w:pBdr>';
    expect(await tipoDe(pPr)).toBe("blockquote");
  });

  it("pBdr no-op não impede a detecção de linha de resposta", async () => {
    // Parágrafo vazio com borda inferior DE VERDADE, mais os outros lados none.
    const d = await docxFromBody(
      '<w:p><w:pPr><w:pBdr><w:left w:val="none"/><w:bottom w:val="single" w:sz="6"/></w:pBdr></w:pPr></w:p>',
    );
    expect(d.blocks[0].attrs.answerLine).toBe(true);
    expect(d.blocks[0].type).toBe("paragraph");
  });

  it("parágrafo sem pBdr continua parágrafo", async () => {
    expect(await tipoDe("")).toBe("paragraph");
  });
});
