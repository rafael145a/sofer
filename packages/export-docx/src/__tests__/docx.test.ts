import { describe, it, expect, vi, afterEach } from "vitest";
import JSZip from "jszip";
import type { LegacySerializedDocument } from "@sofereditor/core";
import { documentToDocxBuffer } from "../docx";

async function documentXml(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

const SVG_1PX =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==";

function decodePngFixture(): Uint8Array {
  const b64 = PNG_1PX.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("documentToDocxBuffer", () => {
  it("produces a non-empty docx (PK zip header) for a simple paragraph", async () => {
    const doc: LegacySerializedDocument = [
      { type: "paragraph", text: "olá", delta: [{ insert: "olá" }], attrs: {} },
    ];
    const { buffer: buf } = await documentToDocxBuffer(doc);
    expect(buf.length).toBeGreaterThan(200);
    // .docx files are ZIP archives — first two bytes are 'PK'.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("supports a mixed document with marks, list, table, and image", async () => {
    const doc: LegacySerializedDocument = [
      { type: "heading", text: "Título", delta: [{ insert: "Título" }], attrs: { level: 1 } },
      {
        type: "paragraph",
        text: "negrito itálico colorido",
        delta: [
          { insert: "negrito ", attributes: { bold: true } },
          { insert: "itálico ", attributes: { italic: true } },
          { insert: "colorido", attributes: { color: "#ff0000" } },
        ],
        attrs: { align: "center" },
      },
      {
        type: "listItem",
        text: "um",
        delta: [{ insert: "um" }],
        attrs: { listKind: "bullet", listLevel: 0 },
      },
      {
        type: "listItem",
        text: "dois",
        delta: [{ insert: "dois" }],
        attrs: { listKind: "bullet", listLevel: 1 },
      },
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "A", delta: [{ insert: "A" }], attrs: {} },
          { text: "B", delta: [{ insert: "B" }], attrs: {} },
        ],
      },
      {
        type: "paragraph",
        text: "",
        delta: [
          {
            insert: {
              type: "image",
              src: PNG_1PX,
              width: 32,
              height: 32,
            } as any,
          },
        ],
        attrs: {},
      },
    ];
    const { buffer: buf } = await documentToDocxBuffer(doc);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("skips covered cells when serializing tables", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "M", delta: [{ insert: "M" }], attrs: { colspan: 2 } },
          { text: "", delta: [], attrs: { covered: true } },
        ],
      },
    ];
    const { buffer: buf } = await documentToDocxBuffer(doc);
    // Smoke: just verify it doesn't blow up and produces output.
    expect(buf.length).toBeGreaterThan(200);
  });
});

describe("resolveImage", () => {
  it("retorna skippedImages=0 e embute data URL sem resolver custom", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [{ insert: { type: "image", src: PNG_1PX, width: 10, height: 10 } }],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(0);
    expect(buffer[0]).toBe(0x50);
  });

  it("chama o resolver para src http e embute o resultado", async () => {
    const calls: string[] = [];
    const png = decodePngFixture(); // bytes do PNG_1PX — helper abaixo
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          {
            insert: { type: "image", src: "https://exemplo.com/a.png", width: 10, height: 10 },
          },
        ],
      },
    ];
    const { skippedImages } = await documentToDocxBuffer(doc, {
      resolveImage: async (src) => {
        calls.push(src);
        return { data: png, type: "png" };
      },
    });
    expect(calls).toEqual(["https://exemplo.com/a.png"]);
    expect(skippedImages).toBe(0);
  });

  it("imagem sem resolução é pulada sem quebrar (skippedImages=1)", async () => {
    const doc: LegacySerializedDocument = [
      { type: "paragraph", text: "antes", attrs: {}, delta: [{ insert: "antes" }] },
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          {
            insert: { type: "image", src: "https://exemplo.com/404.png", width: 10, height: 10 },
          },
        ],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc, {
      resolveImage: async () => null,
    });
    expect(skippedImages).toBe(1);
    expect(buffer[0]).toBe(0x50); // export segue válido
  });

  it("resolve imagens dentro de células de tabela", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 1 },
        cells: [
          {
            text: "",
            attrs: {},
            delta: [
              { insert: { type: "image", src: "https://exemplo.com/b.png", width: 5, height: 5 } },
            ],
          },
        ],
      },
    ];
    const calls: string[] = [];
    await documentToDocxBuffer(doc, {
      resolveImage: async (src) => {
        calls.push(src);
        return null;
      },
    });
    expect(calls).toEqual(["https://exemplo.com/b.png"]);
  });

  it("resolver custom que lança é tratado como skip (não propaga, export segue válido)", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          { insert: { type: "image", src: "https://exemplo.com/boom.png", width: 10, height: 10 } },
        ],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc, {
      resolveImage: async () => {
        throw new Error("boom");
      },
    });
    expect(skippedImages).toBe(1);
    expect(buffer[0]).toBe(0x50);
  });

  it("mesma src não-resolvível em 2 embeds conta 2 ocorrências (não srcs únicos)", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          { insert: { type: "image", src: "https://exemplo.com/404.png", width: 10, height: 10 } },
          { insert: { type: "image", src: "https://exemplo.com/404.png", width: 10, height: 10 } },
        ],
      },
    ];
    const { skippedImages } = await documentToDocxBuffer(doc, {
      resolveImage: async () => null,
    });
    expect(skippedImages).toBe(2);
  });

  it("data URL image/svg+xml é pulada (skippedImages=1) sem lançar — docx exige fallback p/ svg", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [{ insert: { type: "image", src: SVG_1PX, width: 10, height: 10 } }],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(1);
    expect(buffer[0]).toBe(0x50);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("default resolveImage: content-type desconhecido (webp) sem extensão reconhecida é pulado (skippedImages=1)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? "image/webp" : null),
        },
        arrayBuffer: async () => new ArrayBuffer(4),
      })),
    );
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          {
            insert: {
              type: "image",
              src: "https://exemplo.com/foto-sem-extensao",
              width: 10,
              height: 10,
            },
          },
        ],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(1);
    expect(buffer[0]).toBe(0x50); // export segue válido, não lança
  });
});

describe("células de tabela", () => {
  it("bgColor vira shading fill no XML", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1 },
        cells: [{ text: "Questão", delta: [{ insert: "Questão" }], attrs: { bgColor: "#032b50" } }],
      },
    ];
    const { buffer } = await documentToDocxBuffer(doc);
    const xml = await documentXml(buffer);
    // Ancorado dentro de <w:tcPr> — não basta o fill aparecer em algum lugar
    // do XML, precisa estar nas propriedades da célula.
    expect(xml).toMatch(/<w:tcPr>(?:(?!<\/w:tcPr>).)*w:fill="032B50"/s);
  });

  it("align da célula alinha o parágrafo interno", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1 },
        cells: [{ text: "x", delta: [{ insert: "x" }], attrs: { align: "center" } }],
      },
    ];
    const { buffer } = await documentToDocxBuffer(doc);
    const xml = await documentXml(buffer);
    expect(xml).toMatch(/<w:jc w:val="center"\/>/);
  });

  it("colWidths gera gridCol com larguras em twips", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table", text: "", delta: [],
        attrs: { rows: 1, cols: 2, colWidths: [260, 130] },
        cells: [
          { text: "a", delta: [{ insert: "a" }], attrs: {} },
          { text: "b", delta: [{ insert: "b" }], attrs: {} },
        ],
      },
    ];
    const { buffer } = await documentToDocxBuffer(doc);
    const xml = await documentXml(buffer);
    // 260px → 68.8mm... conferir o valor exato no primeiro run e fixá-lo:
    // twips = convertMillimetersToTwip(pxToMm(260)). O teste asserta a presença
    // de <w:gridCol w:w="..."> com o mesmo número calculado no teste.
    const { convertMillimetersToTwip } = await import("docx");
    const { pxToMm } = await import("@sofereditor/core");
    const w0 = convertMillimetersToTwip(pxToMm(260));
    const w1 = convertMillimetersToTwip(pxToMm(130));
    expect(xml).toContain(`<w:gridCol w:w="${w0}"/>`);
    expect(xml).toContain(`<w:gridCol w:w="${w1}"/>`);
    // Larguras fixas: sem `tblLayout="fixed"` o Word ignora o grid e faz autofit
    // pelo conteúdo, tornando `columnWidths` um mero palpite.
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(xml).toContain(`<w:tblW w:type="dxa" w:w="${w0 + w1}"/>`);
  });

  it("sem colWidths a tabela mantém largura 100% (fallback)", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1 },
        cells: [{ text: "x", delta: [{ insert: "x" }], attrs: {} }],
      },
    ];
    const { buffer } = await documentToDocxBuffer(doc);
    const xml = await documentXml(buffer);
    expect(xml).toContain('w:type="pct"');
    expect(xml).not.toContain("w:tblLayout");
  });

  it("colWidths com valor inválido (negativo) cai no fallback percentual, sem deslocar larguras", async () => {
    // Filtrar entradas inválidas ANTES de validar o tamanho contra `cols`
    // deslocaria [260, 130] para as colunas erradas em vez de cair no
    // fallback — a validação precisa rodar sobre o array bruto.
    const doc: LegacySerializedDocument = [
      {
        type: "table", text: "", delta: [],
        attrs: { rows: 1, cols: 2, colWidths: [-5, 260, 130] },
        cells: [
          { text: "a", delta: [{ insert: "a" }], attrs: {} },
          { text: "b", delta: [{ insert: "b" }], attrs: {} },
        ],
      },
    ];
    const { buffer } = await documentToDocxBuffer(doc);
    const xml = await documentXml(buffer);
    expect(xml).toContain('w:type="pct"');
    expect(xml).not.toContain("w:tblLayout");
  });
});

describe("linhas de resposta", () => {
  async function xmlForAttrs(attrs: Record<string, unknown>): Promise<string> {
    const { buffer } = await documentToDocxBuffer([
      { type: "paragraph", text: "", delta: [], attrs },
    ] as unknown as LegacySerializedDocument);
    return documentXml(buffer);
  }

  it("emite pBdr inferior em linha de resposta", async () => {
    const xml = await xmlForAttrs({ answerLine: true });
    expect(xml).toContain("w:pBdr");
    expect(xml).toContain("w:bottom");
  });

  it("mapeia entrelinha para twips (240 = 1 linha)", async () => {
    expect(await xmlForAttrs({ answerLine: true, answerLineSpacing: 1 })).toContain(
      'w:line="240"',
    );
    expect(await xmlForAttrs({ answerLine: true, answerLineSpacing: 1.5 })).toContain(
      'w:line="360"',
    );
    expect(await xmlForAttrs({ answerLine: true, answerLineSpacing: 2 })).toContain(
      'w:line="480"',
    );
  });

  it("entrelinha ausente vale 1 linha", async () => {
    expect(await xmlForAttrs({ answerLine: true })).toContain('w:line="240"');
  });

  it("não emite pBdr em parágrafo comum", async () => {
    const { buffer } = await documentToDocxBuffer([
      { type: "paragraph", text: "oi", delta: [{ insert: "oi" }], attrs: {} },
    ] as LegacySerializedDocument);
    expect(await documentXml(buffer)).not.toContain("w:pBdr");
  });
});

describe("marca-texto (highlight)", () => {
  async function xmlFor(delta: LegacySerializedDocument[0]["delta"]): Promise<string> {
    const { buffer } = await documentToDocxBuffer([
      { type: "paragraph", text: "", delta, attrs: {} },
    ] as LegacySerializedDocument);
    return documentXml(buffer);
  }

  it("emite w:shd com o fill da cor de marca-texto", async () => {
    const xml = await xmlFor([{ insert: "oi", attributes: { highlight: "#fff176" } }]);
    expect(xml).toContain('w:fill="FFF176"');
  });

  it("não emite w:shd quando não há marca-texto", async () => {
    const xml = await xmlFor([{ insert: "oi" }]);
    expect(xml).not.toContain("w:shd");
  });

  it("usa w:shd e NÃO w:highlight (que só aceita ~15 cores nomeadas)", async () => {
    const xml = await xmlFor([{ insert: "oi", attributes: { highlight: "#fff176" } }]);
    expect(xml).not.toContain("w:highlight");
  });

  it("preserva a marca-texto em run com quebra de linha", async () => {
    // O caminho multi-linha de makeTextRun é um segundo sítio de props; sem a
    // extração, texto com \n perderia o fundo silenciosamente.
    const xml = await xmlFor([{ insert: "a\nb", attributes: { highlight: "#a5d6a7" } }]);
    expect(xml).toContain('w:fill="A5D6A7"');
  });

  it("combina marca-texto com cor de texto no mesmo run", async () => {
    const xml = await xmlFor([
      { insert: "oi", attributes: { color: "#ff0000", highlight: "#fff176" } },
    ]);
    expect(xml).toContain('w:fill="FFF176"');
    expect(xml).toContain('w:val="FF0000"');
  });
});
