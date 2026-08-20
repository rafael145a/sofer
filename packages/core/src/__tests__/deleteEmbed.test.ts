import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  deleteBackward,
  deleteForward,
  insertImage,
  insertText,
  isEmbedAdjacentToCaret,
  isImageEmbed,
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
    delta: () => (doc.textAt(0, undefined)?.toDelta() as { insert: unknown }[]) ?? [],
  };
}

const SAMPLE: ImageEmbed = { type: "image", src: "data:image/png;base64,AAA", width: 10, height: 10 };

describe("isEmbedAdjacentToCaret", () => {
  it("backward: true quando o embed está logo ANTES do caret colapsado", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    insertImage(h.ctx, SAMPLE); // "ab" + embed @ offset 2, caret em 3
    expect(h.selection.focus.offset).toBe(3);
    expect(isEmbedAdjacentToCaret(h.ctx, "backward")).toBe(true);
    expect(isEmbedAdjacentToCaret(h.ctx, "forward")).toBe(false);
  });

  it("forward: true quando o embed está logo DEPOIS do caret colapsado", () => {
    const h = harness();
    insertImage(h.ctx, SAMPLE); // embed @ 0, caret vai pra 1
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    expect(isEmbedAdjacentToCaret(h.ctx, "forward")).toBe(true);
    expect(isEmbedAdjacentToCaret(h.ctx, "backward")).toBe(false);
  });

  it("caret em texto normal (sem embed adjacente): false nas duas direções — NÃO deve interceptar", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    expect(isEmbedAdjacentToCaret(h.ctx, "backward")).toBe(false);
    expect(isEmbedAdjacentToCaret(h.ctx, "forward")).toBe(false);
  });

  it("caret no início/fim do documento vazio: false, não lança", () => {
    const h = harness();
    expect(isEmbedAdjacentToCaret(h.ctx, "backward")).toBe(false);
    expect(isEmbedAdjacentToCaret(h.ctx, "forward")).toBe(false);
  });

  it("seleção NÃO colapsada: sempre false (é responsabilidade de getSelectedEmbed)", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    insertImage(h.ctx, SAMPLE);
    h.ctx.setSelection({
      anchor: { blockIndex: 0, offset: 2 },
      focus: { blockIndex: 0, offset: 3 },
    });
    expect(isEmbedAdjacentToCaret(h.ctx, "backward")).toBe(false);
    expect(isEmbedAdjacentToCaret(h.ctx, "forward")).toBe(false);
  });

  it("embed no meio do texto ('a' + embed + 'b'), caret logo depois dele", () => {
    const h = harness();
    insertText(h.ctx, "a");
    insertImage(h.ctx, SAMPLE);
    insertText(h.ctx, "b");
    // delta: "a", embed, "b" — caret depois do "b", em offset 3.
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    // caret logo DEPOIS de "a", logo ANTES do embed.
    expect(isEmbedAdjacentToCaret(h.ctx, "forward")).toBe(true);
    expect(isEmbedAdjacentToCaret(h.ctx, "backward")).toBe(false);
  });
});

describe("Backspace/Delete no modelo apagam o embed adjacente (comando já correto — deleteBackward/deleteForward)", () => {
  it("deleteBackward remove o embed quando ele está logo antes do caret", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    insertImage(h.ctx, SAMPLE);
    expect(h.delta().some((op) => isImageEmbed(op.insert))).toBe(true);
    deleteBackward(h.ctx);
    expect(h.delta().some((op) => isImageEmbed(op.insert))).toBe(false);
    expect(h.doc.toJSON().blocks[0].text).toBe("ab");
  });

  it("deleteForward remove o embed quando ele está logo depois do caret", () => {
    const h = harness();
    insertImage(h.ctx, SAMPLE);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    expect(h.delta().some((op) => isImageEmbed(op.insert))).toBe(true);
    deleteForward(h.ctx);
    expect(h.delta().some((op) => isImageEmbed(op.insert))).toBe(false);
  });
});
