import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";

/**
 * Content controls (`w:sdt`) são o que o Word emite ao BLOQUEAR um trecho
 * ("Controles de Conteúdo" / conteúdo travado). No OOXML eles são wrappers
 * TRANSPARENTES: o conteúdo real vive em `w:sdtContent`, e `w:sdtPr` carrega só
 * metadados de proteção.
 *
 * O importador ignorava `w:sdt` em todas as listas brancas de tag, então todo
 * conteúdo travado sumia silenciosamente — tabela inteira inclusive.
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

/** Content control bloqueado, como o Word emite. */
const sdt = (inner: string) =>
  `<w:sdt><w:sdtPr><w:alias w:val="trava"/><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

const P = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const TC = (t: string) => `<w:tc>${P(t)}</w:tc>`;
const GRID = "<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>";
const textos = (cells: { text: string }[] | undefined) => (cells ?? []).map((c) => c.text);

describe("import de conteúdo bloqueado (w:sdt)", () => {
  it("tabela inteira dentro de um content control", async () => {
    const d = await docxFromBody(
      sdt(`<w:tbl>${GRID}<w:tr>${TC("A1")}${TC("B1")}</w:tr><w:tr>${TC("A2")}${TC("B2")}</w:tr></w:tbl>`),
    );
    const t = d.blocks.find((b) => b.type === "table");
    expect(t, "a tabela bloqueada precisa importar").toBeDefined();
    expect(t!.attrs.rows).toBe(2);
    expect(t!.attrs.cols).toBe(2);
    expect(textos(t!.cells)).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("parágrafo dentro de um content control", async () => {
    const d = await docxFromBody(sdt(P("texto travado")));
    expect(d.blocks.map((b) => b.text)).toContain("texto travado");
  });

  it("célula dentro de um content control (sdt dentro de w:tr)", async () => {
    const d = await docxFromBody(`<w:tbl>${GRID}<w:tr>${TC("A1")}${sdt(TC("B1"))}</w:tr></w:tbl>`);
    const t = d.blocks.find((b) => b.type === "table");
    expect(textos(t?.cells)).toEqual(["A1", "B1"]);
  });

  it("parágrafo de célula dentro de um content control (sdt dentro de w:tc)", async () => {
    const d = await docxFromBody(
      `<w:tbl>${GRID}<w:tr>${TC("A1")}<w:tc>${sdt(P("B1"))}</w:tc></w:tr></w:tbl>`,
    );
    const t = d.blocks.find((b) => b.type === "table");
    expect(textos(t?.cells)).toEqual(["A1", "B1"]);
  });

  it("run inline dentro de um content control (sdt dentro de w:p)", async () => {
    const d = await docxFromBody(
      `<w:p><w:r><w:t>antes </w:t></w:r>${sdt("<w:r><w:t>TRAVADO</w:t></w:r>")}<w:r><w:t> depois</w:t></w:r></w:p>`,
    );
    expect(d.blocks[0].text).toBe("antes TRAVADO depois");
  });

  it("marks do run travado sobrevivem", async () => {
    const d = await docxFromBody(
      `<w:p>${sdt('<w:r><w:rPr><w:b/></w:rPr><w:t>negrito travado</w:t></w:r>')}</w:p>`,
    );
    expect(d.blocks[0].delta[0].attributes).toMatchObject({ bold: true });
  });

  it("content controls aninhados são desembrulhados até o fim", async () => {
    const d = await docxFromBody(sdt(sdt(P("duplamente travado"))));
    expect(d.blocks.map((b) => b.text)).toContain("duplamente travado");
  });

  it("w:sdtPr não vira conteúdo", async () => {
    // O alias/lock são metadados; não podem virar texto no documento.
    const d = await docxFromBody(sdt(P("só isto")));
    expect(d.blocks.map((b) => b.text).join("")).toBe("só isto");
  });

  it("documento sem content control continua igual", async () => {
    const d = await docxFromBody(`<w:tbl>${GRID}<w:tr>${TC("A1")}${TC("B1")}</w:tr></w:tbl>`);
    const t = d.blocks.find((b) => b.type === "table");
    expect(textos(t?.cells)).toEqual(["A1", "B1"]);
  });
});
