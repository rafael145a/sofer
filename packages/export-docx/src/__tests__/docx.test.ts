import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument } from "@sofereditor/core";
import { documentToDocxBuffer } from "../docx";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

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
});
