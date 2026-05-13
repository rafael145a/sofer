import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument } from "@sofer/core";
import { documentToDocxBuffer } from "../docx";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

describe("documentToDocxBuffer", () => {
  it("produces a non-empty docx (PK zip header) for a simple paragraph", async () => {
    const doc: LegacySerializedDocument = [
      { type: "paragraph", text: "olá", delta: [{ insert: "olá" }], attrs: {} },
    ];
    const buf = await documentToDocxBuffer(doc);
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
    const buf = await documentToDocxBuffer(doc);
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
    const buf = await documentToDocxBuffer(doc);
    // Smoke: just verify it doesn't blow up and produces output.
    expect(buf.length).toBeGreaterThan(200);
  });
});
