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

const CELULA = "<w:tc><w:p/></w:tc>";
const LINHA = `<w:tr>${CELULA}${CELULA}</w:tr>`;

/** Tabela 2×2 com o `tblBorders` dado (string vazia = sem tblBorders). */
function tabela(bordersXml: string): string {
  const tblPr = bordersXml ? `<w:tblPr>${bordersXml}</w:tblPr>` : "";
  return `<w:tbl>${tblPr}<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>${LINHA}${LINHA}</w:tbl>`;
}

/** Monta `<w:tblBorders>` com os lados nomeados em `single` e o resto em `none`. */
function borders(ligados: string[]): string {
  const todos = ["top", "bottom", "left", "right", "insideH", "insideV"];
  const lados = todos
    .map((l) => `<w:${l} w:val="${ligados.includes(l) ? "single" : "none"}" w:sz="6"/>`)
    .join("");
  return `<w:tblBorders>${lados}</w:tblBorders>`;
}

async function presetDe(bordersXml: string) {
  const doc = await docxBlobToDocument(await docxFromBody(tabela(bordersXml)));
  const t = doc.blocks.find((b) => b.type === "table");
  expect(t).toBeDefined();
  return t!.attrs.borderPreset;
}

describe("import de presets de borda", () => {
  // Um teste por linha da tabela de redução.
  it("os 6 lados presentes viram preset all", async () => {
    expect(await presetDe(borders(["top", "bottom", "left", "right", "insideH", "insideV"]))).toBe(
      "all",
    );
  });

  it("só os 4 externos viram preset outer", async () => {
    expect(await presetDe(borders(["top", "bottom", "left", "right"]))).toBe("outer");
  });

  it("top+bottom+insideH viram preset horizontal", async () => {
    expect(await presetDe(borders(["top", "bottom", "insideH"]))).toBe("horizontal");
  });

  it("left+right+insideV viram preset vertical", async () => {
    expect(await presetDe(borders(["left", "right", "insideV"]))).toBe("vertical");
  });

  it("todos none viram preset none", async () => {
    expect(await presetDe(borders([]))).toBe("none");
  });

  it("combinação não mapeável cai em all", async () => {
    // Só o topo ligado não corresponde a nenhum preset.
    expect(await presetDe(borders(["top"]))).toBe("all");
  });

  it("tabela sem tblBorders não define borderPreset", async () => {
    expect(await presetDe("")).toBeUndefined();
  });

  it("aceita w:start/w:end do OOXML estrito no lugar de left/right", async () => {
    const xml =
      '<w:tblBorders><w:top w:val="single"/><w:bottom w:val="single"/>' +
      '<w:start w:val="single"/><w:end w:val="single"/>' +
      '<w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>';
    expect(await presetDe(xml)).toBe("outer");
  });

  it("lado ausente conta como desligado", async () => {
    // Sem insideH/insideV declarados = outer.
    const xml =
      '<w:tblBorders><w:top w:val="single"/><w:bottom w:val="single"/>' +
      '<w:left w:val="single"/><w:right w:val="single"/></w:tblBorders>';
    expect(await presetDe(xml)).toBe("outer");
  });

  it("w:val nil conta como desligado", async () => {
    const xml =
      '<w:tblBorders><w:top w:val="nil"/><w:bottom w:val="nil"/>' +
      '<w:left w:val="nil"/><w:right w:val="nil"/>' +
      '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
    expect(await presetDe(xml)).toBe("none");
  });
});

async function corDe(bordersXml: string) {
  const doc = await docxBlobToDocument(await docxFromBody(tabela(bordersXml)));
  return doc.blocks.find((b) => b.type === "table")!.attrs.borderColor;
}

describe("import da cor da borda", () => {
  it("lê a cor do primeiro lado ligado", async () => {
    const xml =
      '<w:tblBorders><w:top w:val="single" w:color="000000"/>' +
      '<w:bottom w:val="single" w:color="000000"/>' +
      '<w:left w:val="single" w:color="000000"/><w:right w:val="single" w:color="000000"/>' +
      '<w:insideH w:val="single" w:color="000000"/><w:insideV w:val="single" w:color="000000"/>' +
      "</w:tblBorders>";
    expect(await corDe(xml)).toBe("#000000");
  });

  it("ignora a cor de lados DESLIGADOS", async () => {
    // O Word emite w:val="none" com w:color="auto"; ler dali gravaria lixo.
    const xml =
      '<w:tblBorders><w:top w:val="none" w:color="auto"/>' +
      '<w:bottom w:val="none" w:color="auto"/>' +
      '<w:left w:val="single" w:color="FF0000"/><w:right w:val="single" w:color="FF0000"/>' +
      '<w:insideH w:val="none" w:color="auto"/><w:insideV w:val="single" w:color="FF0000"/>' +
      "</w:tblBorders>";
    expect(await corDe(xml)).toBe("#ff0000");
  });

  it("cor auto não grava o atributo", async () => {
    const xml =
      '<w:tblBorders><w:top w:val="single" w:color="auto"/>' +
      '<w:bottom w:val="single" w:color="auto"/>' +
      '<w:left w:val="single" w:color="auto"/><w:right w:val="single" w:color="auto"/>' +
      '<w:insideH w:val="single" w:color="auto"/><w:insideV w:val="single" w:color="auto"/>' +
      "</w:tblBorders>";
    expect(await corDe(xml)).toBeUndefined();
  });

  it("sem w:color não grava o atributo", async () => {
    expect(await corDe(borders(["top", "bottom", "left", "right", "insideH", "insideV"])))
      .toBeUndefined();
  });

  it("tabela sem tblBorders não grava o atributo", async () => {
    expect(await corDe("")).toBeUndefined();
  });
});
