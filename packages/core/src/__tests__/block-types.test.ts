import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  EditorHistory,
  collapsedSelection,
  insertParagraph,
  insertText,
  setBlockAttr,
  setBlockType,
  toggleMark,
  type CommandContext,
  type Selection,
} from "../index";

function harness() {
  const doc = new EditorDocument();
  const history = new EditorHistory(doc);
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
    history,
    get selection() {
      return selection;
    },
    snap: () => doc.toJSON().blocks,
  };
}

describe("block types", () => {
  it("converts paragraph to heading with level 2", () => {
    const h = harness();
    insertText(h.ctx, "Título");
    setBlockType(h.ctx, "heading", { level: 2 });
    const b = h.snap()[0];
    expect(b.type).toBe("heading");
    expect(b.attrs.level).toBe(2);
    expect(b.text).toBe("Título");
  });

  it("setBlockType reapplies defaults when changing type", () => {
    const h = harness();
    insertText(h.ctx, "hi");
    setBlockType(h.ctx, "heading", { level: 4 });
    setBlockType(h.ctx, "paragraph");
    const b = h.snap()[0];
    expect(b.type).toBe("paragraph");
    expect(b.attrs.level).toBeUndefined();
  });

  it("preserves inline marks when changing type", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 0 },
      focus: { blockIndex: 0, offset: 3 },
    });
    toggleMark(h.ctx, "bold");
    setBlockType(h.ctx, "blockquote");
    const b = h.snap()[0];
    expect(b.type).toBe("blockquote");
    expect(b.delta[0]).toEqual({ insert: "abc", attributes: { bold: true } });
  });

  it("setBlockAttr writes and removes an alignment", () => {
    const h = harness();
    insertText(h.ctx, "centered");
    setBlockAttr(h.ctx, "align", "center");
    expect(h.snap()[0].attrs.align).toBe("center");
    setBlockAttr(h.ctx, "align", null);
    expect(h.snap()[0].attrs.align).toBeUndefined();
  });

  it("setBlockAttr applies dir=rtl for Hebrew demo", () => {
    const h = harness();
    insertText(h.ctx, "שלום");
    setBlockAttr(h.ctx, "dir", "rtl");
    expect(h.snap()[0].attrs.dir).toBe("rtl");
  });

  it("undo reverts a block type change", () => {
    const h = harness();
    insertText(h.ctx, "x");
    h.history.undoManager.stopCapturing();
    setBlockType(h.ctx, "heading", { level: 1 });
    expect(h.snap()[0].type).toBe("heading");
    h.history.undo();
    expect(h.snap()[0].type).toBe("paragraph");
  });

  it("setBlockType applies to every block in a multi-block selection", () => {
    const h = harness();
    insertText(h.ctx, "first");
    insertParagraph(h.ctx);
    insertText(h.ctx, "second");
    insertParagraph(h.ctx);
    insertText(h.ctx, "third");
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 0 },
      focus: { blockIndex: 2, offset: 5 },
    });
    setBlockType(h.ctx, "heading", { level: 3 });
    expect(h.snap().map((b) => b.type)).toEqual(["heading", "heading", "heading"]);
    expect(h.snap().every((b) => b.attrs.level === 3)).toBe(true);
  });

  it("new paragraphs created via Enter default to paragraph type", () => {
    const h = harness();
    insertText(h.ctx, "head");
    setBlockType(h.ctx, "heading", { level: 1 });
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 4 }));
    insertParagraph(h.ctx);
    insertText(h.ctx, "body");
    const snap = h.snap();
    expect(snap[0].type).toBe("heading");
    expect(snap[1].type).toBe("paragraph");
    expect(snap[1].attrs.level).toBeUndefined();
  });
});
