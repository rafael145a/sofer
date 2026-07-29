import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAGE_SETTINGS,
  PAGE_PRESETS,
  type SerializedDocument,
} from "@sofereditor/core";
import { documentToDocxBuffer } from "@sofereditor/export-docx";
import { docxBlobToDocument } from "../docx";

describe("page-settings round-trip", () => {
  it("default A4 + 1\" margins survive export → import", async () => {
    const doc: SerializedDocument = {
      blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
    };
    const { buffer: buf } = await documentToDocxBuffer(doc);
    const result = await docxBlobToDocument(buf);
    expect(result.pageSettings?.preset).toBe("a4");
    expect(result.pageSettings?.width).toBeCloseTo(DEFAULT_PAGE_SETTINGS.width, 0);
    expect(result.pageSettings?.height).toBeCloseTo(DEFAULT_PAGE_SETTINGS.height, 0);
  });

  it("Ofício + narrow margins round-trip", async () => {
    const doc: SerializedDocument = {
      blocks: [{ type: "paragraph", text: "y", delta: [{ insert: "y" }], attrs: {} }],
      pageSettings: {
        width: PAGE_PRESETS.oficio.width,
        height: PAGE_PRESETS.oficio.height,
        marginTop: 48,
        marginBottom: 48,
        marginLeft: 48,
        marginRight: 48,
      },
    };
    const { buffer: buf } = await documentToDocxBuffer(doc);
    const result = await docxBlobToDocument(buf);
    expect(result.pageSettings?.preset).toBe("oficio");
    // Margins survive within ±1px (twips ↔ mm ↔ px round-off).
    expect(result.pageSettings?.marginTop).toBeCloseTo(48, 0);
    expect(result.pageSettings?.marginLeft).toBeCloseTo(48, 0);
  });

  it("custom (non-preset) dimensions survive as 'custom'", async () => {
    const doc: SerializedDocument = {
      blocks: [{ type: "paragraph", text: "z", delta: [{ insert: "z" }], attrs: {} }],
      pageSettings: {
        width: 900,
        height: 1200,
        marginTop: 96,
        marginBottom: 96,
        marginLeft: 96,
        marginRight: 96,
      },
    };
    const { buffer: buf } = await documentToDocxBuffer(doc);
    const result = await docxBlobToDocument(buf);
    expect(result.pageSettings?.preset).toBe("custom");
    expect(result.pageSettings?.width).toBeCloseTo(900, 0);
  });
});
