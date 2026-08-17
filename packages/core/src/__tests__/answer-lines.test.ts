import { describe, it, expect } from "vitest";
import {
  ANSWER_LINE_MAX,
  EditorDocument,
  answerLineStyle,
  collapsedSelection,
  insertAnswerLines,
  type AnswerLineSpacing,
  type CommandContext,
  type Selection,
} from "../index";
import { createTableBlock } from "../document";

function harness(initial?: Selection) {
  const doc = new EditorDocument();
  let selection: Selection = initial ?? collapsedSelection({ blockIndex: 0, offset: 0 });
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
    blocks: () => doc.toJSON().blocks,
  };
}

describe("insertAnswerLines", () => {
  it("insere N parágrafos pautados depois do bloco focado", () => {
    const h = harness();
    insertAnswerLines(h.ctx, 3, 1.5);
    const blocks = h.blocks();
    expect(blocks).toHaveLength(4); // 1 original + 3
    for (const b of blocks.slice(1)) {
      expect(b.type).toBe("paragraph");
      expect(b.attrs.answerLine).toBe(true);
      expect(b.attrs.answerLineSpacing).toBe(1.5);
      expect(b.text).toBe("");
    }
  });

  it("não altera o bloco original", () => {
    const h = harness();
    insertAnswerLines(h.ctx, 2, 1);
    expect(h.blocks()[0].attrs.answerLine).toBeUndefined();
  });

  it("limita count ao intervalo 1..ANSWER_LINE_MAX", () => {
    expect(ANSWER_LINE_MAX).toBe(50);

    const zero = harness();
    insertAnswerLines(zero.ctx, 0, 1);
    expect(zero.blocks()).toHaveLength(2);

    const negativo = harness();
    insertAnswerLines(negativo.ctx, -5, 1);
    expect(negativo.blocks()).toHaveLength(2);

    const demais = harness();
    insertAnswerLines(demais.ctx, 999, 1);
    expect(demais.blocks()).toHaveLength(1 + ANSWER_LINE_MAX);

    const fracionado = harness();
    insertAnswerLines(fracionado.ctx, 3.9, 1);
    expect(fracionado.blocks()).toHaveLength(4);
  });

  it("coloca o caret na primeira linha inserida", () => {
    const h = harness();
    insertAnswerLines(h.ctx, 2, 1);
    expect(h.selection.focus.blockIndex).toBe(1);
    expect(h.selection.focus.offset).toBe(0);
    expect(h.selection.focus.cellIndex).toBeUndefined();
  });

  it("aceita as três entrelinhas", () => {
    for (const spacing of [1, 1.5, 2] as AnswerLineSpacing[]) {
      const h = harness();
      insertAnswerLines(h.ctx, 1, spacing);
      expect(h.blocks()[1].attrs.answerLineSpacing).toBe(spacing);
    }
  });

  it("é uma transação só — um undo desfaz todas as linhas", () => {
    const h = harness();
    let transacoes = 0;
    h.doc.ydoc.on("afterTransaction", () => {
      transacoes++;
    });
    insertAnswerLines(h.ctx, 10, 1);
    expect(transacoes).toBe(1);
    expect(h.blocks()).toHaveLength(11);
  });

  it("com o caret dentro de uma célula, insere DEPOIS da tabela inteira", () => {
    const h = harness();
    h.doc.blocks.insert(1, [createTableBlock(2, 2)]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, cellIndex: 0, offset: 0 }));
    insertAnswerLines(h.ctx, 2, 1);
    const blocks = h.blocks();
    expect(blocks[1].type).toBe("table");
    // A tabela continua com 4 células — nada foi inserido dentro dela.
    expect(blocks[1].cells).toHaveLength(4);
    expect(blocks[2].attrs.answerLine).toBe(true);
    expect(blocks[3].attrs.answerLine).toBe(true);
  });
});

describe("answerLineStyle", () => {
  it("devolve undefined quando o bloco não é linha de resposta", () => {
    expect(answerLineStyle({})).toBeUndefined();
    expect(answerLineStyle({ align: "center" })).toBeUndefined();
  });

  it("desenha régua inferior e entrelinha", () => {
    expect(answerLineStyle({ answerLine: true, answerLineSpacing: 2 })).toEqual({
      borderBottom: "1px solid #000000",
      lineHeight: "2",
      minHeight: "2em",
    });
  });

  it("entrelinha ausente vale 1", () => {
    expect(answerLineStyle({ answerLine: true })).toEqual({
      borderBottom: "1px solid #000000",
      lineHeight: "1",
      minHeight: "1em",
    });
  });

  it("entrelinha 1,5 sai como decimal CSS válido", () => {
    expect(answerLineStyle({ answerLine: true, answerLineSpacing: 1.5 })?.lineHeight).toBe("1.5");
  });

  it("fixa minHeight casado com a entrelinha", () => {
    // Sem isto, um `min-height` no CSS do consumidor (o playground usa 1.5em em
    // parágrafo) faria "Simples" e "1,5" renderizarem com a mesma altura.
    for (const s of [1, 1.5, 2] as AnswerLineSpacing[]) {
      const style = answerLineStyle({ answerLine: true, answerLineSpacing: s })!;
      expect(style.minHeight).toBe(`${s}em`);
      expect(style.lineHeight).toBe(String(s));
    }
  });
});
