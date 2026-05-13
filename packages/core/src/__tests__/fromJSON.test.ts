import { describe, it, expect } from "vitest";
import { EditorDocument } from "../document";
import { DEFAULT_PAGE_SETTINGS } from "../page-settings";
import type { LegacySerializedDocument, SerializedDocument } from "../types";

describe("EditorDocument.fromJSON / loadFromJSON", () => {
  it("round-trips a simple paragraph (new shape)", () => {
    const input: SerializedDocument = {
      blocks: [
        {
          type: "paragraph",
          text: "olá mundo",
          delta: [{ insert: "olá mundo" }],
          attrs: {},
        },
      ],
    };
    const doc = EditorDocument.fromJSON(input);
    expect(doc.toJSON().blocks).toEqual(input.blocks);
  });

  it("preserves marks via Y.Text.applyDelta", () => {
    const input: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "ab",
        delta: [
          { insert: "a", attributes: { bold: true } },
          { insert: "b", attributes: { italic: true } },
        ],
        attrs: {},
      },
    ];
    const doc = EditorDocument.fromJSON(input);
    expect(doc.toJSON().blocks).toEqual(input);
  });

  it("preserves heading attrs and align", () => {
    const input: LegacySerializedDocument = [
      {
        type: "heading",
        text: "T",
        delta: [{ insert: "T" }],
        attrs: { level: 2, align: "center" },
      },
    ];
    const doc = EditorDocument.fromJSON(input);
    expect(doc.toJSON().blocks).toEqual(input);
  });

  it("preserves table cells, colspan/rowspan, and covered slots", () => {
    const input: LegacySerializedDocument = [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 2, cols: 2 },
        cells: [
          { text: "M", delta: [{ insert: "M" }], attrs: { colspan: 2 } },
          { text: "", delta: [], attrs: { covered: true } },
          { text: "C", delta: [{ insert: "C" }], attrs: {} },
          { text: "D", delta: [{ insert: "D" }], attrs: {} },
        ],
      },
    ];
    const doc = EditorDocument.fromJSON(input);
    expect(doc.toJSON().blocks).toEqual(input);
  });

  it("loadFromJSON replaces existing content", () => {
    const doc = new EditorDocument();
    expect(doc.toJSON().blocks).toEqual([
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ]);
    const replacement: LegacySerializedDocument = [
      { type: "heading", text: "Novo", delta: [{ insert: "Novo" }], attrs: { level: 1 } },
    ];
    doc.loadFromJSON(replacement);
    expect(doc.toJSON().blocks).toEqual(replacement);
  });

  it("empty serialized doc yields a single empty paragraph", () => {
    const doc = EditorDocument.fromJSON([]);
    expect(doc.toJSON().blocks).toEqual([
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ]);
  });

  it("legacy array input still works (backwards compat)", () => {
    const legacy: LegacySerializedDocument = [
      { type: "paragraph", text: "a", delta: [{ insert: "a" }], attrs: {} },
    ];
    const doc = EditorDocument.fromJSON(legacy);
    expect(doc.toJSON().blocks).toEqual(legacy);
    expect(doc.toJSON().pageSettings).toMatchObject({
      width: DEFAULT_PAGE_SETTINGS.width,
      height: DEFAULT_PAGE_SETTINGS.height,
    });
  });

  it("pageSettings round-trip", () => {
    const input: SerializedDocument = {
      blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
      pageSettings: {
        width: 816,
        height: 1248,
        marginTop: 48,
        marginBottom: 48,
        marginLeft: 48,
        marginRight: 48,
      },
    };
    const doc = EditorDocument.fromJSON(input);
    const out = doc.toJSON();
    expect(out.pageSettings).toMatchObject({
      width: 816,
      height: 1248,
      marginTop: 48,
      preset: "oficio",
    });
  });
});
