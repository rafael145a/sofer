import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  insertImage,
  insertParagraph,
  insertTable,
  insertText,
  serializeSelection,
  setBlockType,
  sliceToText,
  toggleMark,
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
    setSelection: (s) => { selection = s; },
  };
  return { ctx, doc, get selection() { return selection; } };
}

const IMG: ImageEmbed = { type: "image", src: "data:image/png;base64,AAA", width: 10, height: 10 };
function select(ctx: CommandContext, sel: Selection) { ctx.setSelection(sel); }

describe("clipboard — serializeSelection", () => {
  it("returns null for a collapsed selection", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    expect(serializeSelection(h.doc, h.selection)).toBeNull();
  });

  it("serializes within-block rich text preserving marks", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    toggleMark(h.ctx, "bold");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].delta).toEqual([{ insert: "bcd", attributes: { bold: true } }]);
    expect(slice.openStart).toBe(true);
    expect(slice.openEnd).toBe(true);
  });

  it("serializes a single image embed", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    insertImage(h.ctx, IMG);
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 2 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].delta).toEqual([{ insert: IMG }]);
  });

  it("serializes a multi-block selection preserving block types and open flags", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    setBlockType(h.ctx, "heading", { level: 2 });
    select(h.ctx, { anchor: { blockIndex: 0, offset: 2 }, focus: { blockIndex: 1, offset: 3 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(2);
    expect(slice.blocks[0].type).toBe("paragraph");
    expect(slice.blocks[0].delta).toEqual([{ insert: "llo" }]);
    expect(slice.blocks[1].type).toBe("heading");
    expect(slice.blocks[1].delta).toEqual([{ insert: "wor" }]);
    expect(slice.openStart).toBe(true);
    expect(slice.openEnd).toBe(true);
  });

  it("sliceToText joins block texts with newlines", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 5 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(sliceToText(slice)).toBe("hello\nworld");
  });

  it("returns null when anchor and focus are in different cells", () => {
    const h = harness();
    insertTable(h.ctx, 1, 2);                 // table is inserted; caret lands in cell 0
    const tableIdx = h.selection.focus.blockIndex;
    h.ctx.setSelection({
      anchor: { blockIndex: tableIdx, cellIndex: 0, offset: 0 },
      focus: { blockIndex: tableIdx, cellIndex: 1, offset: 0 },
    });
    expect(serializeSelection(h.doc, h.selection)).toBeNull();
  });

  it("preserves block-level attrs (heading level) in the slice", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    setBlockType(h.ctx, "heading", { level: 2 });
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 5 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks[1].type).toBe("heading");
    expect(slice.blocks[1].attrs.level).toBe(2);
  });
});
