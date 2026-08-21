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

  // Largura útil da A4 default (settings reais, não "210mm" cravado — ver
  // tableProporcao.test.ts para a explicação de por que a conta parte do
  // pageSettings em vez de literais mm).
  async function larguraUtilA4Twips(): Promise<number> {
    const { convertMillimetersToTwip } = await import("docx");
    const { DEFAULT_PAGE_SETTINGS, pxToMm } = await import("@sofereditor/core");
    const s = DEFAULT_PAGE_SETTINGS;
    return convertMillimetersToTwip(pxToMm(s.width - s.marginLeft - s.marginRight));
  }

  it("colWidths (proporção) gera gridCol distribuindo a largura útil da página", async () => {
    // colWidths não é mais px absoluto — é proporção. [260, 130] não soma
    // 100, então normaliza para 2:1 (66.667/33.333) e distribui contra a
    // largura útil REAL da página, não a soma dos dois valores.
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
    const larguraUtil = await larguraUtilA4Twips();
    const w0 = Math.round(larguraUtil * (2 / 3));
    const w1 = Math.round(larguraUtil * (1 / 3));
    expect(xml).toContain(`<w:gridCol w:w="${w0}"/>`);
    expect(xml).toContain(`<w:gridCol w:w="${w1}"/>`);
    // Larguras fixas: sem `tblLayout="fixed"` o Word ignora o grid e faz autofit
    // pelo conteúdo, tornando `columnWidths` um mero palpite.
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(xml).toContain(`<w:tblW w:type="dxa" w:w="${w0 + w1}"/>`);
  });

  it("sem colWidths a tabela ocupa a largura útil inteira, dividida em colunas iguais", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1 },
        cells: [{ text: "x", delta: [{ insert: "x" }], attrs: {} }],
      },
    ];
    const { buffer } = await documentToDocxBuffer(doc);
    const xml = await documentXml(buffer);
    const larguraUtil = await larguraUtilA4Twips();
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(xml).toContain(`<w:gridCol w:w="${larguraUtil}"/>`);
    expect(xml).toContain(`<w:tblW w:type="dxa" w:w="${larguraUtil}"/>`);
  });

  it("colWidths com valor inválido (comprimento não bate com cols) cai no split igual, sem deslocar larguras", async () => {
    // Filtrar entradas inválidas ANTES de validar o tamanho contra `cols`
    // deslocaria [260, 130] para as colunas erradas em vez de cair no
    // split igual — `normalizarLarguras` valida o array bruto.
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
    const larguraUtil = await larguraUtilA4Twips();
    const metade = Math.round(larguraUtil / 2);
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(xml).toContain(`<w:gridCol w:w="${metade}"/>`);
  });
});

describe("presets de borda de tabela", () => {
  async function bordasDe(preset?: string) {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const { buffer } = await documentToDocxBuffer([
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 2, cols: 2, ...(preset ? { borderPreset: preset } : {}) },
        cells,
      },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const xml = await documentXml(buffer);
    const tblBorders = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(xml)?.[1] ?? "";
    const ligado = (lado: string) => {
      const m = new RegExp(`<w:${lado}\\b[^>]*w:val="([^"]+)"`).exec(tblBorders);
      return m ? m[1] !== "none" && m[1] !== "nil" : false;
    };
    return {
      top: ligado("top"),
      bottom: ligado("bottom"),
      left: ligado("left"),
      right: ligado("right"),
      insideH: ligado("insideH"),
      insideV: ligado("insideV"),
    };
  }

  async function corDaBorda(preset: string, borderColor?: string): Promise<string> {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const { buffer } = await documentToDocxBuffer([
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 2, cols: 2, borderPreset: preset, ...(borderColor ? { borderColor } : {}) },
        cells,
      },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const xml = await documentXml(buffer);
    const tblBorders = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(xml)?.[1] ?? "";
    return /<w:top\b[^>]*w:color="([^"]+)"/.exec(tblBorders)?.[1] ?? "";
  }

  it("emite a cor escolhida no w:tblBorders", async () => {
    expect(await corDaBorda("all", "#000000")).toBe("000000");
  });

  it("sem cor escolhida emite o padrão CBD5E1", async () => {
    expect(await corDaBorda("all")).toBe("CBD5E1");
  });

  it("cor inválida cai no padrão em vez de emitir lixo", async () => {
    expect(await corDaBorda("all", "não-é-cor")).toBe("CBD5E1");
  });

  // Um teste por linha da tabela-verdade — a tabela É a especificação.
  it("all: os seis lados ligados", async () => {
    expect(await bordasDe("all")).toEqual({
      top: true, bottom: true, left: true, right: true, insideH: true, insideV: true,
    });
  });

  it("outer: só os quatro externos", async () => {
    expect(await bordasDe("outer")).toEqual({
      top: true, bottom: true, left: true, right: true, insideH: false, insideV: false,
    });
  });

  it("horizontal: top/bottom/insideH", async () => {
    expect(await bordasDe("horizontal")).toEqual({
      top: true, bottom: true, left: false, right: false, insideH: true, insideV: false,
    });
  });

  it("vertical: left/right/insideV", async () => {
    expect(await bordasDe("vertical")).toEqual({
      top: false, bottom: false, left: true, right: true, insideH: false, insideV: true,
    });
  });

  it("none: nenhum lado ligado", async () => {
    expect(await bordasDe("none")).toEqual({
      top: false, bottom: false, left: false, right: false, insideH: false, insideV: false,
    });
  });

  it("preset ausente mantém a grade completa", async () => {
    expect(await bordasDe(undefined)).toEqual({
      top: true, bottom: true, left: true, right: true, insideH: true, insideV: true,
    });
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

describe("SVG no DOCX", () => {
  const SVG_SRC =
    "data:image/svg+xml;base64," +
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>").toString("base64");

  const docComSvg = (svgFallback?: string): LegacySerializedDocument => [
    {
      type: "paragraph",
      text: "",
      attrs: {},
      delta: [
        {
          insert: {
            type: "image",
            src: SVG_SRC,
            width: 20,
            height: 12,
            ...(svgFallback ? { svgFallback } : {}),
          },
        },
      ],
    },
  ];

  it("SVG COM fallback entra no documento", async () => {
    // Antes desta mudança o export descartava TODO svg silenciosamente —
    // um defeito que já existia, independente de fórmulas.
    const { skippedImages } = await documentToDocxBuffer(docComSvg(PNG_1PX));
    expect(skippedImages).toBe(0);
  });

  it("SVG SEM fallback continua pulado — não inventamos raster no servidor", async () => {
    const { skippedImages } = await documentToDocxBuffer(docComSvg());
    expect(skippedImages).toBe(1);
  });

  it("PNG comum não mudou de comportamento", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [{ insert: { type: "image", src: PNG_1PX, width: 10, height: 10 } }],
      },
    ];
    const { skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(0);
  });

  it("mesmo src em duas ocorrências, só a segunda traz svgFallback — as DUAS entram no documento", async () => {
    // Cenário real: uma prova salva antes do campo `svgFallback` existir,
    // depois editada inserindo a mesma fórmula de novo. O `src` é o próprio
    // conteúdo (data URL), então as duas ocorrências têm o mesmo src — uma
    // sem fallback (a antiga), outra com (a nova). A decisão de resolver o
    // SVG é por SRC (resolveAllImages/"primeiro ganha"); a ocorrência sem
    // svgFallback não pode sumir do documento sem entrar em skippedImages.
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          { insert: { type: "image", src: SVG_SRC, width: 20, height: 12 } },
          { insert: { type: "image", src: SVG_SRC, width: 20, height: 12, svgFallback: PNG_1PX } },
        ],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(0);
    const xml = await documentXml(buffer);
    const drawingCount = (xml.match(/<w:drawing>/g) ?? []).length;
    expect(drawingCount).toBe(2);
  });
});

describe("SVG no DOCX — contrato OOXML", () => {
  const SVG_TEXT = "<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>";
  const SVG_SRC = "data:image/svg+xml;base64," + Buffer.from(SVG_TEXT).toString("base64");

  // Assinatura PNG: 0x89 'P' 'N' 'G'. Confirma que o arquivo apontado como
  // fallback é raster de verdade, não apenas que a extensão do nome bate.
  function isPngMagic(bytes: Uint8Array): boolean {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }

  it("word/media tem os dois arquivos, e o <a:blip> principal resolve para o PNG (não o SVG)", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [
          {
            insert: {
              type: "image",
              src: SVG_SRC,
              width: 20,
              height: 12,
              svgFallback: PNG_1PX,
            },
          },
        ],
      },
    ];
    const { buffer, skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(0);

    const zip = await JSZip.loadAsync(buffer);
    const mediaNames = Object.keys(zip.files).filter(
      (n) => n.startsWith("word/media/") && !n.endsWith("/"),
    );
    expect(mediaNames.some((n) => n.endsWith(".png"))).toBe(true);
    expect(mediaNames.some((n) => n.endsWith(".svg"))).toBe(true);

    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("asvg:svgBlip");

    // O <a:blip> PRINCIPAL (o que o Word renderiza por padrão, inclusive em
    // versões que não entendem SVG) tem que resolver — via rels — para o
    // PNG. A extensão asvg:svgBlip (Word 2016+) é quem aponta para o SVG.
    // Uma inversão dos dois passaria batido se só checássemos "os dois
    // arquivos existem" — por isso o teste segue a cadeia de relação até o
    // arquivo e confere o CONTEÚDO (assinatura PNG / texto "<svg"), não só a
    // extensão do nome.
    const mainBlip = /<a:blip r:embed="([^"]+)"/.exec(xml);
    const svgBlip = /<asvg:svgBlip[^>]*r:embed="([^"]+)"/.exec(xml);
    expect(mainBlip).not.toBeNull();
    expect(svgBlip).not.toBeNull();

    const relsXml = await zip.file("word/_rels/document.xml.rels")!.async("string");
    const relsMap = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relsMap.set(m[1], m[2]);
    }

    const mainTarget = relsMap.get(mainBlip![1]);
    const svgTarget = relsMap.get(svgBlip![1]);
    expect(mainTarget).toMatch(/\.png$/);
    expect(svgTarget).toMatch(/\.svg$/);

    const mainBytes = await zip.file(`word/${mainTarget}`)!.async("uint8array");
    const svgBytes = await zip.file(`word/${svgTarget}`)!.async("uint8array");
    expect(isPngMagic(mainBytes)).toBe(true);
    expect(new TextDecoder().decode(svgBytes)).toContain("<svg");
  });
});
