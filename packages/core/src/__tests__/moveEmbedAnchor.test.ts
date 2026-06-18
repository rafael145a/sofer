import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  insertImage,
  insertParagraph,
  insertText,
  isImageEmbed,
  moveEmbedAnchor,
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
  return {
    ctx,
    doc,
    get selection() {
      return selection;
    },
  };
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
    if (cursor === offset && isImageEmbed(op.insert)) return op.insert as ImageEmbed;
    cursor += 1;
  }
  return null;
}

function countEmbeds(doc: EditorDocument, blockIndex: number): number {
  const yText = doc.textAt(blockIndex, undefined);
  if (!yText) return 0;
  const delta = yText.toDelta() as { insert: unknown }[];
  return delta.filter((op) => isImageEmbed(op.insert)).length;
}

const BEHIND: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAA",
  width: 100,
  height: 50,
  layout: "behind",
  offsetX: 10,
  offsetY: 20,
  caption: "fig 1",
};

/** Build a 2-block doc: block 0 = "abc"+embed@3, block 1 = "xyz". */
function twoBlockDoc() {
  const h = harness();
  insertText(h.ctx, "abc"); // block 0 = "abc"
  insertParagraph(h.ctx); // block 1 (empty), caret at (1,0)
  insertText(h.ctx, "xyz"); // block 1 = "xyz"
  h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
  insertImage(h.ctx, BEHIND); // block 0 = "abc"+embed@3
  return h;
}

describe("moveEmbedAnchor", () => {
  it("moves a behind embed from block 0 to block 1, preserving attrs + new offsets", () => {
    const h = twoBlockDoc();
    moveEmbedAnchor(h.ctx, { blockIndex: 0, offset: 3 }, { blockIndex: 1, offset: 1 }, 77, 88);
    // Removed from block 0
    expect(countEmbeds(h.doc, 0)).toBe(0);
    // Landed in block 1 at offset 1 ("x" + embed)
    const e = embedAt(h.doc, 1, 1);
    expect(e).not.toBeNull();
    expect(e?.src).toBe(BEHIND.src);
    expect(e?.width).toBe(100);
    expect(e?.height).toBe(50);
    expect(e?.layout).toBe("behind");
    expect(e?.caption).toBe("fig 1");
    expect(e?.offsetX).toBe(77);
    expect(e?.offsetY).toBe(88);
    // Selection covers the moved embed (anchor=1, focus=2) in block 1
    expect(h.selection.anchor).toMatchObject({ blockIndex: 1, offset: 1 });
    expect(h.selection.focus).toMatchObject({ blockIndex: 1, offset: 2 });
  });

  it("no-ops for an inline embed (no layout)", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    insertParagraph(h.ctx);
    insertText(h.ctx, "xyz");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertImage(h.ctx, {
      type: "image",
      src: "data:image/png;base64,BBB",
      width: 40,
      height: 40,
    }); // no layout => inline
    moveEmbedAnchor(h.ctx, { blockIndex: 0, offset: 3 }, { blockIndex: 1, offset: 0 }, 5, 5);
    // Unchanged: still in block 0, none in block 1
    expect(countEmbeds(h.doc, 0)).toBe(1);
    expect(countEmbeds(h.doc, 1)).toBe(0);
  });

  it("same-Y.Text move with to.offset > from.offset lands at to.offset-1, no dup/loss", () => {
    // block 0 = "ab" + embed@2 + "cde"  (length 6: a b [embed] c d e)
    const h = harness();
    insertText(h.ctx, "abcde");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 2 }));
    insertImage(h.ctx, BEHIND); // now "ab"+embed+"cde", embed at offset 2
    expect(countEmbeds(h.doc, 0)).toBe(1);
    // Move within the same block to offset 5 (past the embed).
    moveEmbedAnchor(h.ctx, { blockIndex: 0, offset: 2 }, { blockIndex: 0, offset: 5 }, 33, 44);
    // Exactly one embed, no duplication, no loss.
    expect(countEmbeds(h.doc, 0)).toBe(1);
    // After deleting at offset 2, text is "abcde"(5). Inserting at to.offset-1 = 4
    // => "abcd"+embed+"e".
    const e = embedAt(h.doc, 0, 4);
    expect(e).not.toBeNull();
    expect(e?.offsetX).toBe(33);
    expect(e?.offsetY).toBe(44);
    expect(h.selection.anchor).toMatchObject({ blockIndex: 0, offset: 4 });
    expect(h.selection.focus).toMatchObject({ blockIndex: 0, offset: 5 });
  });

  it("no-ops for a wrap-left embed (wraps are not re-anchorable — see RESOLVED DECISION at top of plan)", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    insertParagraph(h.ctx);
    insertText(h.ctx, "xyz");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertImage(h.ctx, { ...BEHIND, layout: "wrap-left" });
    moveEmbedAnchor(h.ctx, { blockIndex: 0, offset: 3 }, { blockIndex: 1, offset: 0 }, 12, 13);
    // Unchanged: the embed stays put in block 0 and never lands in block 1.
    expect(countEmbeds(h.doc, 0)).toBe(1);
    expect(countEmbeds(h.doc, 1)).toBe(0);
    const e = embedAt(h.doc, 0, 3);
    expect(e?.layout).toBe("wrap-left");
    // Offsets are untouched (the no-op never applies the new coordinates).
    expect(e?.offsetX).toBe(BEHIND.offsetX);
    expect(e?.offsetY).toBe(BEHIND.offsetY);
  });

  it("coalesces into a single undo step", async () => {
    const { EditorHistory } = await import("../history");
    const h = twoBlockDoc();
    const history = new EditorHistory(h.doc);
    moveEmbedAnchor(h.ctx, { blockIndex: 0, offset: 3 }, { blockIndex: 1, offset: 1 }, 77, 88);
    expect(countEmbeds(h.doc, 1)).toBe(1);
    history.undo();
    // One undo restores the embed to block 0 and clears it from block 1.
    expect(countEmbeds(h.doc, 1)).toBe(0);
    expect(countEmbeds(h.doc, 0)).toBe(1);
  });
});
