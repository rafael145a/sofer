import { describe, it, expect } from "vitest";
import { EditorDocument, stripFontFamilyMarks } from "../index";
import type { SerializedDocument } from "../types";

function docComFonte(): EditorDocument {
  const input: SerializedDocument = {
    blocks: [
      {
        type: "paragraph",
        text: "ab",
        delta: [
          { insert: "a", attributes: { fontFamily: "Liberation Sans", bold: true } },
          { insert: "b", attributes: { fontFamily: "Arial" } },
        ],
        attrs: {},
      },
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "C", delta: [{ insert: "C", attributes: { fontFamily: "Liberation Sans" } }], attrs: {} },
          { text: "D", delta: [{ insert: "D", attributes: { italic: true } }], attrs: {} },
        ],
      },
    ],
  };
  return EditorDocument.fromJSON(input);
}

describe("stripFontFamilyMarks", () => {
  it("remove fontFamily de bloco e de célula, preservando as outras marcas", () => {
    const doc = docComFonte();
    const n = stripFontFamilyMarks(doc);

    expect(n).toBe(3);

    const blocks = doc.toJSON().blocks;
    expect(blocks[0].delta).toEqual([
      { insert: "a", attributes: { bold: true } },
      { insert: "b" },
    ]);
    expect(blocks[1].cells![0].delta).toEqual([{ insert: "C" }]);
    expect(blocks[1].cells![1].delta).toEqual([
      { insert: "D", attributes: { italic: true } },
    ]);
  });

  it("é idempotente: a segunda chamada não encontra nada e não escreve", () => {
    const doc = docComFonte();
    stripFontFamilyMarks(doc);

    let updates = 0;
    doc.ydoc.on("update", () => {
      updates++;
    });

    expect(stripFontFamilyMarks(doc)).toBe(0);
    expect(updates).toBe(0);
  });

  it("documento sem a marca não gera update nenhum", () => {
    const doc = EditorDocument.fromJSON({
      blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
    });
    let updates = 0;
    doc.ydoc.on("update", () => {
      updates++;
    });

    expect(stripFontFamilyMarks(doc)).toBe(0);
    expect(updates).toBe(0);
  });

  it("dryRun conta sem modificar o documento", () => {
    const doc = docComFonte();
    const antes = JSON.stringify(doc.toJSON());

    let updates = 0;
    doc.ydoc.on("update", () => {
      updates++;
    });

    expect(stripFontFamilyMarks(doc, { dryRun: true })).toBe(3);
    expect(updates).toBe(0);
    expect(JSON.stringify(doc.toJSON())).toBe(antes);
  });

  it("usa origin 'migration' para o UndoManager não rastrear", () => {
    const doc = docComFonte();
    const origins: unknown[] = [];
    doc.ydoc.on("update", (_u: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });

    stripFontFamilyMarks(doc);
    expect(origins).toEqual(["migration"]);
  });
});
