import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  EditorHistory,
  MAX_LIST_LEVEL,
  collapsedSelection,
  dedentList,
  deleteBackward,
  indentList,
  insertParagraph,
  insertText,
  splitListItem,
  toggleList,
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

describe("lists", () => {
  it("toggleList converts a paragraph to a bullet listItem", () => {
    const h = harness();
    insertText(h.ctx, "first");
    toggleList(h.ctx, "bullet");
    const b = h.snap()[0];
    expect(b.type).toBe("listItem");
    expect(b.attrs.listKind).toBe("bullet");
    expect(b.attrs.listLevel).toBe(0);
    expect(b.text).toBe("first");
  });

  it("toggleList toggles off when every block already matches", () => {
    const h = harness();
    insertText(h.ctx, "x");
    toggleList(h.ctx, "ordered");
    toggleList(h.ctx, "ordered");
    expect(h.snap()[0].type).toBe("paragraph");
  });

  it("toggleList between bullet and ordered preserves level", () => {
    const h = harness();
    insertText(h.ctx, "x");
    toggleList(h.ctx, "bullet");
    indentList(h.ctx);
    indentList(h.ctx);
    expect(h.snap()[0].attrs.listLevel).toBe(2);
    toggleList(h.ctx, "ordered");
    const b = h.snap()[0];
    expect(b.attrs.listKind).toBe("ordered");
    expect(b.attrs.listLevel).toBe(2);
  });

  it("indentList caps at MAX_LIST_LEVEL", () => {
    const h = harness();
    insertText(h.ctx, "x");
    toggleList(h.ctx, "bullet");
    for (let i = 0; i < MAX_LIST_LEVEL + 3; i++) indentList(h.ctx);
    expect(h.snap()[0].attrs.listLevel).toBe(MAX_LIST_LEVEL);
  });

  it("dedentList at level 0 demotes back to paragraph", () => {
    const h = harness();
    insertText(h.ctx, "x");
    toggleList(h.ctx, "bullet");
    dedentList(h.ctx);
    expect(h.snap()[0].type).toBe("paragraph");
  });

  it("indent/dedent are no-ops on non-listItem blocks", () => {
    const h = harness();
    insertText(h.ctx, "x");
    indentList(h.ctx);
    expect(h.snap()[0].type).toBe("paragraph");
    dedentList(h.ctx);
    expect(h.snap()[0].type).toBe("paragraph");
  });

  it("splitListItem on empty item at level > 0 dedents", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    indentList(h.ctx);
    indentList(h.ctx); // level 2, empty item
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    const handled = splitListItem(h.ctx);
    expect(handled).toBe(true);
    expect(h.snap()[0].type).toBe("listItem");
    expect(h.snap()[0].attrs.listLevel).toBe(1);
  });

  it("splitListItem on empty item at level 0 converts to paragraph", () => {
    const h = harness();
    insertText(h.ctx, "");
    toggleList(h.ctx, "bullet"); // level 0
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    const handled = splitListItem(h.ctx);
    expect(handled).toBe(true);
    expect(h.snap()[0].type).toBe("paragraph");
  });

  it("splitListItem on non-empty item splits into two listItems with same kind/level", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    toggleList(h.ctx, "ordered");
    indentList(h.ctx); // level 1
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    const handled = splitListItem(h.ctx);
    expect(handled).toBe(true);
    const snap = h.snap();
    expect(snap.length).toBe(2);
    expect(snap[0].text).toBe("abc");
    expect(snap[1].text).toBe("def");
    expect(snap[0].type).toBe("listItem");
    expect(snap[1].type).toBe("listItem");
    expect(snap[1].attrs.listKind).toBe("ordered");
    expect(snap[1].attrs.listLevel).toBe(1);
  });

  it("splitListItem returns false on a paragraph", () => {
    const h = harness();
    insertText(h.ctx, "x");
    const handled = splitListItem(h.ctx);
    expect(handled).toBe(false);
  });

  it("toggleList applies across heterogeneous selection", () => {
    const h = harness();
    insertText(h.ctx, "first");
    insertParagraph(h.ctx);
    insertText(h.ctx, "second");
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 0 },
      focus: { blockIndex: 1, offset: 6 },
    });
    toggleList(h.ctx, "bullet");
    const snap = h.snap();
    expect(snap.map((b) => b.type)).toEqual(["listItem", "listItem"]);
    expect(snap.every((b) => b.attrs.listKind === "bullet")).toBe(true);
  });

  it("Backspace at offset 0 of a level>0 listItem dedents instead of merging", () => {
    const h = harness();
    insertText(h.ctx, "alpha");
    toggleList(h.ctx, "bullet");
    indentList(h.ctx);
    indentList(h.ctx); // level 2
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    deleteBackward(h.ctx);
    expect(h.snap()[0].type).toBe("listItem");
    expect(h.snap()[0].attrs.listLevel).toBe(1);
    expect(h.snap()[0].text).toBe("alpha");
  });

  it("Backspace at offset 0 of a level 0 listItem converts to paragraph", () => {
    const h = harness();
    insertText(h.ctx, "alpha");
    toggleList(h.ctx, "bullet"); // level 0
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    deleteBackward(h.ctx);
    expect(h.snap()[0].type).toBe("paragraph");
    expect(h.snap()[0].text).toBe("alpha");
  });

  it("preserves inline marks when converting paragraph to listItem", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 0 },
      focus: { blockIndex: 0, offset: 3 },
    });
    toggleMark(h.ctx, "bold");
    toggleList(h.ctx, "bullet");
    const d = h.snap()[0].delta;
    expect(d[0]).toEqual({ insert: "abc", attributes: { bold: true } });
  });
});
