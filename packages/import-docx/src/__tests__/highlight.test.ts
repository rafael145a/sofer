import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";

/**
 * `readDocx` só exige `word/document.xml` — o resto do pacote OOXML é
 * opcional. Isso permite fixtures de XML cru, que é a única forma de cobrir
 * `w:highlight`: `@sofereditor/export-docx` nunca o emite (usa `w:shd`), então
 * um teste de round-trip jamais passaria por esse caminho.
 */
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

async function marksOfFirstRun(rPrXml: string): Promise<Record<string, unknown>> {
  const buf = await docxFromBody(
    `<w:p><w:r><w:rPr>${rPrXml}</w:rPr><w:t>oi</w:t></w:r></w:p>`,
  );
  const doc = await docxBlobToDocument(buf);
  return (doc.blocks[0].delta[0]?.attributes ?? {}) as Record<string, unknown>;
}

describe("import de marca-texto", () => {
  it("lê w:shd de run como highlight", async () => {
    const m = await marksOfFirstRun('<w:shd w:val="clear" w:fill="FFF176"/>');
    expect(m.highlight).toBe("#fff176");
  });

  it("ignora w:shd com fill auto", async () => {
    const m = await marksOfFirstRun('<w:shd w:val="clear" w:fill="auto"/>');
    expect(m.highlight).toBeUndefined();
  });

  it("ignora w:shd sem fill", async () => {
    const m = await marksOfFirstRun('<w:shd w:val="clear"/>');
    expect(m.highlight).toBeUndefined();
  });

  it("lê w:highlight nomeado como highlight", async () => {
    expect((await marksOfFirstRun('<w:highlight w:val="yellow"/>')).highlight).toBe("#ffff00");
    expect((await marksOfFirstRun('<w:highlight w:val="green"/>')).highlight).toBe("#00ff00");
    expect((await marksOfFirstRun('<w:highlight w:val="darkRed"/>')).highlight).toBe("#800000");
  });

  it("w:highlight none ou desconhecido não vira marca", async () => {
    expect((await marksOfFirstRun('<w:highlight w:val="none"/>')).highlight).toBeUndefined();
    expect((await marksOfFirstRun('<w:highlight w:val="chartreuse"/>')).highlight).toBeUndefined();
  });

  it("convive com as outras marks do run", async () => {
    const m = await marksOfFirstRun(
      '<w:b/><w:color w:val="FF0000"/><w:shd w:val="clear" w:fill="A5D6A7"/>',
    );
    expect(m).toMatchObject({ bold: true, color: "#ff0000", highlight: "#a5d6a7" });
  });

  it("run sem rPr não ganha marca-texto", async () => {
    const buf = await docxFromBody("<w:p><w:r><w:t>oi</w:t></w:r></w:p>");
    const doc = await docxBlobToDocument(buf);
    expect(doc.blocks[0].delta[0].attributes).toBeUndefined();
  });
});
