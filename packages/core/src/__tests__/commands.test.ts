import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  EditorHistory,
  collapsedSelection,
  deleteBackward,
  deleteForward,
  insertParagraph,
  insertText,
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
    text: () => doc.toJSON().blocks.map((b) => b.text),
  };
}

describe("commands", () => {
  it("inserts text into the first paragraph", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    expect(h.text()).toEqual(["hello"]);
    expect(h.selection.focus).toEqual({ blockIndex: 0, offset: 5 });
  });

  it("creates a new paragraph on Enter and carries the tail", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertParagraph(h.ctx);
    expect(h.text()).toEqual(["abc", "def"]);
    expect(h.selection.focus).toEqual({ blockIndex: 1, offset: 0 });
  });

  it("merges with previous on Backspace at start of block", () => {
    const h = harness();
    insertText(h.ctx, "first");
    insertParagraph(h.ctx);
    insertText(h.ctx, "second");
    expect(h.text()).toEqual(["first", "second"]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, offset: 0 }));
    deleteBackward(h.ctx);
    expect(h.text()).toEqual(["firstsecond"]);
    expect(h.selection.focus).toEqual({ blockIndex: 0, offset: 5 });
  });

  it("deletes a character before the caret", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    deleteBackward(h.ctx);
    expect(h.text()).toEqual(["hell"]);
    expect(h.selection.focus).toEqual({ blockIndex: 0, offset: 4 });
  });

  it("deletes a forward range across blocks", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    // select from offset 3 of block 0 to offset 2 of block 1 ("lo\nwo")
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 3 },
      focus: { blockIndex: 1, offset: 2 },
    });
    deleteBackward(h.ctx);
    expect(h.text()).toEqual(["helrld"]);
    expect(h.selection.focus).toEqual({ blockIndex: 0, offset: 3 });
  });

  it("deletes forward and merges next block", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    insertParagraph(h.ctx);
    insertText(h.ctx, "cd");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 2 }));
    deleteForward(h.ctx);
    expect(h.text()).toEqual(["abcd"]);
  });

  it("undo reverts a text insertion", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    h.history.undo();
    expect(h.text()).toEqual([""]);
  });

  it("redo re-applies an undone insertion", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    h.history.undo();
    h.history.redo();
    expect(h.text()).toEqual(["hello"]);
  });

  it("insertParagraph preserves marks on the tail moved to the new block", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    // Mark "def" (chars 3-6) as bold
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 3 },
      focus: { blockIndex: 0, offset: 6 },
    });
    toggleMark(h.ctx, "bold");
    // Split right before "def" — the tail moved to a new block must remain bold.
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertParagraph(h.ctx);
    const snap = h.doc.toJSON().blocks;
    expect(snap[0].delta).toEqual([{ insert: "abc" }]);
    expect(snap[1].delta).toEqual([
      { insert: "def", attributes: { bold: true } },
    ]);
  });

  it("undo reverts a paragraph split as a separate step when capture is stopped", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    // Force a new undo step so the next op is undone independently
    h.history.undoManager.stopCapturing();
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertParagraph(h.ctx);
    h.history.undo();
    expect(h.text()).toEqual(["abcdef"]);
  });
});
