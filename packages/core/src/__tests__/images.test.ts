import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  insertImage,
  insertText,
  isImageEmbed,
  setImageAttrs,
  type CommandContext,
  type ImageEmbed,
  type Selection,
} from "../index";

function harness() {
  const doc = new EditorDocument();
  let selection: Selection = collapsedSelection({ blockIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
  };
  return { ctx, doc, get selection() { return selection; } };
}

function embedAt(doc: EditorDocument, blockIndex: number, offset: number): ImageEmbed | null {
  const yText = doc.textAt(blockIndex, undefined);
  if (!yText) return null;
  const delta = yText.toDelta() as { insert: unknown }[];
  let cursor = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      cursor += op.insert.length;
      continue;
    }
    if (cursor === offset && isImageEmbed(op.insert)) return op.insert;
    cursor += 1;
  }
  return null;
}

const SAMPLE: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAA",
  width: 100,
  height: 50,
};

describe("Fase 6 — image layout", () => {
  it("persists layout/offsetX/offsetY through setImageAttrs", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    insertImage(h.ctx, SAMPLE);

    setImageAttrs(h.ctx, 0, 1, {
      layout: "wrap-left",
      offsetX: 24,
      offsetY: 8,
    });

    const e = embedAt(h.doc, 0, 1);
    expect(e).not.toBeNull();
    expect(e?.layout).toBe("wrap-left");
    expect(e?.offsetX).toBe(24);
    expect(e?.offsetY).toBe(8);
    expect(e?.width).toBe(100); // untouched
    expect(e?.height).toBe(50);
  });

  it("switching layout mode preserves the embed at its offset", () => {
    const h = harness();
    insertImage(h.ctx, SAMPLE);

    setImageAttrs(h.ctx, 0, 0, { layout: "behind", offsetX: 30, offsetY: 40 });
    let e = embedAt(h.doc, 0, 0);
    expect(e?.layout).toBe("behind");
    expect(e?.offsetX).toBe(30);

    setImageAttrs(h.ctx, 0, 0, { layout: "front", offsetX: 0, offsetY: 0 });
    e = embedAt(h.doc, 0, 0);
    expect(e?.layout).toBe("front");
    expect(e?.offsetX).toBe(0);
    expect(e?.offsetY).toBe(0);
  });

  it("default layout (omitted) reads as inline-equivalent", () => {
    const h = harness();
    insertImage(h.ctx, SAMPLE);
    const e = embedAt(h.doc, 0, 0);
    expect(e?.layout).toBeUndefined();
  });
});
