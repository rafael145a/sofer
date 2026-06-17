import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  createBlock,
  createTableBlock,
  deleteSelection,
  insertImage,
  insertParagraph,
  insertSlice,
  insertTable,
  insertText,
  serializeSelection,
  setBlockType,
  sliceToText,
  toggleMark,
  type ClipboardSlice,
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

describe("clipboard — insertSlice / deleteSelection", () => {
  it("pastes within-block rich text inline, preserving marks", () => {
    const h = harness();
    insertText(h.ctx, "XbcdY");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    toggleMark(h.ctx, "bold");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    // deterministic clean empty paragraph target (NOT via a selection-respecting
    // command — the source selection is still the non-collapsed [1,4] range).
    h.doc.blocks.insert(1, [createBlock("paragraph", "")]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, offset: 0 }));
    insertSlice(h.ctx, slice);
    expect(h.doc.getBlockText(1)!.toDelta()).toEqual([{ insert: "bcd", attributes: { bold: true } }]);
    expect(h.selection.focus).toEqual({ blockIndex: 1, offset: 3 });
  });

  it("pastes a single image embed", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    insertImage(h.ctx, IMG);                 // a[img]b
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 2 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    insertSlice(h.ctx, slice);
    const delta = h.doc.getBlockText(0)!.toDelta() as { insert: unknown }[];
    const embeds = delta.filter((op) => typeof op.insert !== "string");
    expect(embeds).toHaveLength(2);
  });

  it("pastes a multi-block slice merging open ends", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    setBlockType(h.ctx, "heading", { level: 2 });
    select(h.ctx, { anchor: { blockIndex: 0, offset: 2 }, focus: { blockIndex: 1, offset: 3 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    h.doc.blocks.insert(2, [createBlock("paragraph", "PQRS")]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 2, offset: 3 }));
    insertSlice(h.ctx, slice);
    expect(h.doc.getBlockText(2)!.toString()).toBe("PQRllo");
    expect(h.doc.getBlockType(2)).toBe("paragraph");
    expect(h.doc.getBlockText(3)!.toString()).toBe("worS");
    expect(h.doc.getBlockType(3)).toBe("heading");
    expect(h.selection.focus).toEqual({ blockIndex: 3, offset: 3 });
  });

  it("flattens a multi-block slice when pasting into a table cell", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 5 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    h.doc.blocks.insert(2, [createTableBlock(1, 1)]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 2, cellIndex: 0, offset: 0 }));
    insertSlice(h.ctx, slice);
    // block boundaries become "\n" (cells render pre-wrap), not glued words
    expect(h.doc.getCellText(2, 0)!.toString()).toBe("hello\nworld");
  });

  it("deleteSelection removes the selected range and collapses the caret", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    deleteSelection(h.ctx);
    expect(h.doc.getBlockText(0)!.toString()).toBe("aef");
    expect(h.selection.focus).toEqual({ blockIndex: 0, offset: 1 });
  });

  it("a pasted plain run does NOT inherit an adjacent bold mark", () => {
    const h = harness();
    // existing content: "Z" bold, caret right after it.
    insertText(h.ctx, "Z");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 0, offset: 1 } });
    toggleMark(h.ctx, "bold");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    // paste a slice = bold "a" + plain "b"
    const slice: ClipboardSlice = {
      blocks: [
        {
          type: "paragraph",
          text: "ab",
          delta: [{ insert: "a", attributes: { bold: true } }, { insert: "b" }],
          attrs: {},
        },
      ],
      openStart: true,
      openEnd: true,
    };
    insertSlice(h.ctx, slice);
    // "Z"+"a" are bold and merge; "b" must stay PLAIN (no inherited bold).
    expect(h.doc.getBlockText(0)!.toDelta()).toEqual([
      { insert: "Za", attributes: { bold: true } },
      { insert: "b" },
    ]);
  });

  it("pastes whole-block slices as discrete blocks without a stray trailing block", () => {
    const h = harness();
    insertText(h.ctx, "AAA");
    insertParagraph(h.ctx);
    insertText(h.ctx, "BBB");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 3 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.openStart).toBe(false);
    expect(slice.openEnd).toBe(false);
    // target: paragraph "ZZZ" at block 2, paste at end (offset 3)
    h.doc.blocks.insert(2, [createBlock("paragraph", "ZZZ")]);
    const before = h.doc.blockCount();
    h.ctx.setSelection(collapsedSelection({ blockIndex: 2, offset: 3 }));
    insertSlice(h.ctx, slice);
    expect(h.doc.blockCount()).toBe(before + 2); // +AAA +BBB, NO stray empty block
    expect(h.doc.getBlockText(2)!.toString()).toBe("ZZZ");
    expect(h.doc.getBlockText(3)!.toString()).toBe("AAA");
    expect(h.doc.getBlockText(4)!.toString()).toBe("BBB");
    expect(h.selection.focus).toEqual({ blockIndex: 4, offset: 3 });
  });

  it("reuses an empty target paragraph when pasting whole blocks (no stray leading block)", () => {
    const h = harness();
    insertText(h.ctx, "AAA");
    insertParagraph(h.ctx);
    insertText(h.ctx, "BBB");
    setBlockType(h.ctx, "heading", { level: 2 }); // block 1 = heading "BBB"
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 3 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    // target: an EMPTY paragraph at block 2
    h.doc.blocks.insert(2, [createBlock("paragraph", "")]);
    const before = h.doc.blockCount();
    h.ctx.setSelection(collapsedSelection({ blockIndex: 2, offset: 0 }));
    insertSlice(h.ctx, slice);
    expect(h.doc.blockCount()).toBe(before + 1); // empty target became AAA, +BBB
    expect(h.doc.getBlockText(2)!.toString()).toBe("AAA");
    expect(h.doc.getBlockType(2)).toBe("paragraph");
    expect(h.doc.getBlockText(3)!.toString()).toBe("BBB");
    expect(h.doc.getBlockType(3)).toBe("heading");
    expect(h.selection.focus).toEqual({ blockIndex: 3, offset: 3 });
  });

  it("survives a JSON round-trip (the real clipboard path) preserving marks and embeds", () => {
    const h = harness();
    insertText(h.ctx, "Xbo");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 3 } });
    toggleMark(h.ctx, "bold"); // "bo" bold
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertImage(h.ctx, IMG); // "Xbo[img]"
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 0, offset: 4 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    // onCopy does JSON.stringify; onPaste does JSON.parse — exercise that seam.
    const roundTripped = JSON.parse(JSON.stringify(slice));
    h.doc.blocks.insert(1, [createBlock("paragraph", "")]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, offset: 0 }));
    insertSlice(h.ctx, roundTripped);
    const delta = h.doc.getBlockText(1)!.toDelta() as { insert: unknown; attributes?: unknown }[];
    expect(delta[0]).toEqual({ insert: "X" });
    expect(delta[1]).toEqual({ insert: "bo", attributes: { bold: true } });
    expect(delta[2].insert).toEqual(IMG); // embed survived JSON
  });

  it("serializes content inside a single table cell as a paragraph block", () => {
    const h = harness();
    insertTable(h.ctx, 1, 1);
    const tableIdx = h.selection.focus.blockIndex;
    h.ctx.setSelection(collapsedSelection({ blockIndex: tableIdx, cellIndex: 0, offset: 0 }));
    insertText(h.ctx, "cellcontent");
    select(h.ctx, {
      anchor: { blockIndex: tableIdx, cellIndex: 0, offset: 0 },
      focus: { blockIndex: tableIdx, cellIndex: 0, offset: 4 },
    });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].type).toBe("paragraph"); // cell content → paragraph
    expect(slice.blocks[0].delta).toEqual([{ insert: "cell" }]);
  });
});
