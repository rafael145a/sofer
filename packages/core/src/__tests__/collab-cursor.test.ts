import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { EditorDocument, createBlock } from "../document";
import { encodeSelection, decodeSelection } from "../collab-cursor";
import type { SerializedDocument } from "../types";

function makeDoc(n: number) {
  const blocks = Array.from({ length: n }, (_, i) => ({
    type: "paragraph" as const,
    text: `Bloco ${i} conteudo`,
    delta: [{ insert: `Bloco ${i} conteudo` }],
    attrs: {},
  }));
  return EditorDocument.fromJSON({ blocks } as SerializedDocument);
}

describe("collab-cursor (RelativePosition + blockId)", () => {
  it("round-trip de seleção absoluta", () => {
    const doc = makeDoc(5);
    const sel = {
      anchor: { blockIndex: 2, offset: 3 },
      focus: { blockIndex: 2, offset: 7 },
    };
    const enc = encodeSelection(doc, sel);
    expect(enc).not.toBeNull();
    expect(decodeSelection(doc, enc!)).toEqual(sel);
  });

  it("resiliente a inserção de bloco ACIMA (segue o shift)", () => {
    const doc = makeDoc(5);
    const enc = encodeSelection(doc, {
      anchor: { blockIndex: 2, offset: 3 },
      focus: { blockIndex: 2, offset: 3 },
    })!;
    doc.ydoc.transact(() => {
      doc.blocks.insert(0, [createBlock("paragraph", "novo")]);
    });
    const dec = decodeSelection(doc, enc)!;
    expect(dec.anchor.blockIndex).toBe(3); // 2 → 3
    expect(dec.anchor.offset).toBe(3);
  });

  it("resiliente a edição de texto antes do cursor (offset acompanha)", () => {
    const doc = makeDoc(3);
    const enc = encodeSelection(doc, {
      anchor: { blockIndex: 1, offset: 5 },
      focus: { blockIndex: 1, offset: 5 },
    })!;
    const yText = doc.blocks.get(1).get("text") as Y.Text;
    doc.ydoc.transact(() => yText.insert(0, "XYZ"));
    const dec = decodeSelection(doc, enc)!;
    expect(dec.anchor.blockIndex).toBe(1);
    expect(dec.anchor.offset).toBe(8); // 5 + 3
  });

  it("fallback por blockId quando a RelativePosition não resolve", () => {
    const doc = makeDoc(3);
    const enc = encodeSelection(doc, {
      anchor: { blockIndex: 1, offset: 4 },
      focus: { blockIndex: 1, offset: 4 },
    })!;
    const broken = {
      anchor: { ...enc.anchor, rel: "AAAA" },
      focus: { ...enc.focus, rel: "AAAA" },
    };
    const dec = decodeSelection(doc, broken);
    expect(dec).not.toBeNull();
    expect(dec!.anchor.blockIndex).toBe(1); // achou pelo blockId
    expect(dec!.anchor.offset).toBe(0); // ancora no início
  });
});
