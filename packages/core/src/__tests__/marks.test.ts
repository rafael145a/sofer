import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  EditorHistory,
  collapsedSelection,
  insertParagraph,
  insertText,
  removeMark,
  setMark,
  toggleMark,
  type CommandContext,
  type DeltaOp,
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
    delta: (blockIndex = 0): DeltaOp[] => doc.toJSON().blocks[blockIndex].delta,
    text: () => doc.toJSON().blocks.map((b) => b.text),
  };
}

function select(h: ReturnType<typeof harness>, anchor: number, focus: number, block = 0) {
  h.ctx.setSelection({
    anchor: { blockIndex: block, offset: anchor },
    focus: { blockIndex: block, offset: focus },
  });
}

describe("marks", () => {
  it("toggles bold across a selection", () => {
    const h = harness();
    insertText(h.ctx, "hello world");
    select(h, 0, 5); // "hello"
    toggleMark(h.ctx, "bold");
    const d = h.delta();
    expect(d[0]).toEqual({ insert: "hello", attributes: { bold: true } });
    expect(d[1]).toEqual({ insert: " world" });
  });

  it("toggleMark is idempotent (apply twice → no mark)", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    select(h, 0, 5);
    toggleMark(h.ctx, "bold");
    toggleMark(h.ctx, "bold");
    expect(h.delta()).toEqual([{ insert: "hello" }]);
  });

  it("setMark applies and replaces color", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    select(h, 0, 3);
    setMark(h.ctx, "color", "#ff0000");
    expect(h.delta()[0]).toEqual({ insert: "abc", attributes: { color: "#ff0000" } });
    setMark(h.ctx, "color", "#00ff00");
    expect(h.delta()[0]).toEqual({ insert: "abc", attributes: { color: "#00ff00" } });
  });

  it("removeMark removes only the targeted mark", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    select(h, 0, 3);
    toggleMark(h.ctx, "bold");
    setMark(h.ctx, "color", "#ff0000");
    expect(h.delta()[0].attributes).toEqual({ bold: true, color: "#ff0000" });
    removeMark(h.ctx, "color");
    expect(h.delta()[0].attributes).toEqual({ bold: true });
  });

  it("preserves italic when applying bold over the same range", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    select(h, 0, 3);
    toggleMark(h.ctx, "italic");
    toggleMark(h.ctx, "bold");
    expect(h.delta()[0].attributes).toEqual({ italic: true, bold: true });
  });

  it("applies a link mark with href", () => {
    const h = harness();
    insertText(h.ctx, "click here");
    select(h, 6, 10); // "here"
    setMark(h.ctx, "link", { href: "https://example.com" });
    const d = h.delta();
    expect(d[1]).toEqual({
      insert: "here",
      attributes: { link: { href: "https://example.com" } },
    });
  });

  it("applies bold across two blocks", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 2 },
      focus: { blockIndex: 1, offset: 3 },
    });
    toggleMark(h.ctx, "bold");
    const d0 = h.delta(0);
    const d1 = h.delta(1);
    expect(d0[0]).toEqual({ insert: "he" });
    expect(d0[1]).toEqual({ insert: "llo", attributes: { bold: true } });
    expect(d1[0]).toEqual({ insert: "wor", attributes: { bold: true } });
    expect(d1[1]).toEqual({ insert: "ld" });
  });

  it("toggling bold off when only part of the range is bold applies bold to all", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    select(h, 0, 2);
    toggleMark(h.ctx, "bold"); // "he" bold
    select(h, 0, 5);
    toggleMark(h.ctx, "bold"); // not uniform → apply
    expect(h.delta()).toEqual([{ insert: "hello", attributes: { bold: true } }]);
  });

  it("undo reverts a bold toggle", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    h.history.undoManager.stopCapturing();
    select(h, 0, 5);
    toggleMark(h.ctx, "bold");
    expect(h.delta()[0].attributes).toEqual({ bold: true });
    h.history.undo();
    expect(h.delta()).toEqual([{ insert: "hello" }]);
  });

  it("collapsed selection: toggleMark is a no-op", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    toggleMark(h.ctx, "bold");
    expect(h.delta()).toEqual([{ insert: "abc" }]);
  });

  it("insertText with marks override creates a marked run", () => {
    const h = harness();
    insertText(h.ctx, "plain ");
    insertText(h.ctx, "bold", { bold: true });
    const d = h.delta();
    expect(d[0]).toEqual({ insert: "plain " });
    expect(d[1]).toEqual({ insert: "bold", attributes: { bold: true } });
  });

  it("insertText with explicit null clears inherited mark", () => {
    const h = harness();
    insertText(h.ctx, "bold", { bold: true });
    // Caret now sits right after a bold run — without the override, Y.Text would
    // inherit bold for the next insertion.
    insertText(h.ctx, "plain", { bold: null });
    const d = h.delta();
    expect(d[0]).toEqual({ insert: "bold", attributes: { bold: true } });
    expect(d[1]).toEqual({ insert: "plain" });
  });
});
