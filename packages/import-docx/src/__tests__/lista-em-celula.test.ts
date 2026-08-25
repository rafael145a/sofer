import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";

async function docxFrom(bodyXml: string, numberingXml?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`,
  );
  if (numberingXml) zip.file("word/numbering.xml", numberingXml);
  return zip.generateAsync({ type: "uint8array" });
}

const NUMBERING = `<?xml version="1.0"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:start w:val="1"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const listP = (t: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const plainP = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const tbl = (inner: string) => `<w:tbl><w:tr><w:tc>${inner}</w:tc></w:tr></w:tbl>`;

describe("import de lista dentro de célula", () => {
  it("célula com parágrafos numerados vira célula com listKind ordered", async () => {
    const doc = await docxBlobToDocument(
      await docxFrom(tbl(listP("um") + listP("dois") + listP("tres")), NUMBERING),
    );
    const t = doc.blocks.find((b) => b.type === "table")!;
    expect(t.cells![0].attrs.listKind).toBe("ordered");
    expect(t.cells![0].text).toBe("um\ndois\ntres");
  });

  it("célula sem numeração continua sem listKind", async () => {
    const doc = await docxBlobToDocument(await docxFrom(tbl(plainP("a") + plainP("b"))));
    const t = doc.blocks.find((b) => b.type === "table")!;
    expect(t.cells![0].attrs.listKind).toBeUndefined();
    expect(t.cells![0].text).toBe("a\nb");
  });

  it("o contador de numeração avança através da tabela", async () => {
    // No Word:  1. antes  |  tabela com 2. e 3.  |  4. depois
    const doc = await docxBlobToDocument(
      await docxFrom(listP("antes") + tbl(listP("na") + listP("tabela")) + listP("depois"), NUMBERING),
    );
    const itens = doc.blocks.filter((b) => b.type === "listItem");
    expect(itens.map((b) => b.text)).toEqual(["antes", "depois"]);

    // `paragraphs.ts:54` grava o ordinal do Word em `listStart` de cada item, e
    // `docx.ts` mantém o valor nos líderes de grupo. A tabela separa os dois
    // itens em grupos distintos, então os dois preservam o número.
    //
    // Esta é a asserção que morde: se `resolve()` NÃO fosse chamado para os
    // parágrafos da célula, o contador não avançaria e "depois" viria como 2
    // em vez de 4 — divergindo do que o Word mostra.
    expect(itens[0].attrs.listStart).toBe(1);
    expect(itens[1].attrs.listStart).toBe(4);

    const t = doc.blocks.find((b) => b.type === "table")!;
    expect(t.cells![0].attrs.listKind).toBe("ordered");
  });
});
