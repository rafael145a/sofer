import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument, SerializedBlock } from "@sofereditor/core";
import { documentToDocxBuffer } from "@sofereditor/export-docx";
import { docxBlobToDocument } from "../docx";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

async function roundTrip(input: LegacySerializedDocument): Promise<SerializedBlock[]> {
  const { buffer: buf } = await documentToDocxBuffer(input);
  const result = await docxBlobToDocument(buf);
  return result.blocks;
}

describe("export → import round-trip", () => {
  it("paragraph with bold/italic/underline/strike marks", async () => {
    const input: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "ABCD",
        delta: [
          { insert: "A", attributes: { bold: true } },
          { insert: "B", attributes: { italic: true } },
          { insert: "C", attributes: { underline: true } },
          { insert: "D", attributes: { strike: true } },
        ],
        attrs: {},
      },
    ];
    const out = await roundTrip(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].delta).toEqual(input[0].delta);
  });

  it("heading levels 1–6", async () => {
    const input: LegacySerializedDocument = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      type: "heading" as const,
      text: `H${level}`,
      delta: [{ insert: `H${level}` }],
      attrs: { level },
    }));
    const out = await roundTrip(input);
    expect(out).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(out[i].type).toBe("heading");
      expect(out[i].attrs.level).toBe(i + 1);
      expect(out[i].text).toBe(`H${i + 1}`);
    }
  });

  it("ordered + bullet lists with multiple levels", async () => {
    const input: LegacySerializedDocument = [
      { type: "listItem", text: "a", delta: [{ insert: "a" }], attrs: { listKind: "bullet", listLevel: 0 } },
      { type: "listItem", text: "b", delta: [{ insert: "b" }], attrs: { listKind: "bullet", listLevel: 1 } },
      { type: "listItem", text: "1", delta: [{ insert: "1" }], attrs: { listKind: "ordered", listLevel: 0 } },
      { type: "listItem", text: "1.a", delta: [{ insert: "1.a" }], attrs: { listKind: "ordered", listLevel: 1 } },
    ];
    const out = await roundTrip(input);
    expect(out.map((b) => b.type)).toEqual(["listItem", "listItem", "listItem", "listItem"]);
    expect(out[0].attrs).toMatchObject({ listKind: "bullet", listLevel: 0 });
    expect(out[1].attrs).toMatchObject({ listKind: "bullet", listLevel: 1 });
    expect(out[2].attrs).toMatchObject({ listKind: "ordered", listLevel: 0 });
    expect(out[3].attrs).toMatchObject({ listKind: "ordered", listLevel: 1 });
  });

  it("table 1x2 with text in both cells", async () => {
    const input: LegacySerializedDocument = [
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
    ];
    const out = await roundTrip(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("table");
    expect(out[0].attrs).toMatchObject({ rows: 1, cols: 2 });
    expect(out[0].cells).toHaveLength(2);
    expect(out[0].cells?.[0].text).toBe("A");
    expect(out[0].cells?.[1].text).toBe("B");
  });

  it("table with horizontal merge: real cell with colspan + covered slot", async () => {
    const input: LegacySerializedDocument = [
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
    const out = await roundTrip(input);
    expect(out[0].cells?.[0].attrs).toMatchObject({ colspan: 2 });
    expect(out[0].cells?.[1].attrs).toMatchObject({ covered: true });
  });

  it("paragraph alignment center", async () => {
    const input: LegacySerializedDocument = [
      { type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: { align: "center" } },
    ];
    const out = await roundTrip(input);
    expect(out[0].attrs.align).toBe("center");
  });

  it("inline PNG image is embedded as data URL", async () => {
    const input: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        delta: [{ insert: { type: "image", src: PNG_1PX, width: 32, height: 32 } }],
        attrs: {},
      },
    ];
    const out = await roundTrip(input);
    expect(out).toHaveLength(1);
    const op = out[0].delta[0];
    expect(typeof op?.insert === "object").toBe(true);
    const embed = op.insert as { type: string; src: string; width: number; height: number };
    expect(embed.type).toBe("image");
    expect(embed.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(embed.width).toBeGreaterThan(0);
    expect(embed.height).toBeGreaterThan(0);
  });
});
