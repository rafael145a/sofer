import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  deleteTableColumn,
  insertTable,
  insertTableColumn,
  normalizarLarguras,
  setColumnBoundary,
  setTableWidth,
  type CommandContext,
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
  return {
    doc, ctx,
    get selection() { return selection; },
    setSel(s: Selection) { selection = s; },
  };
}

describe("normalizarLarguras", () => {
  it("converte px de documento antigo em proporção", () => {
    // Os números medidos numa tabela real de produção.
    expect(normalizarLarguras([120, 153, 120, 120], 4)).toEqual([
      23.392, 29.825, 23.392, 23.392,
    ]);
  });

  it("é IDEMPOTENTE — rodar de novo não mexe", () => {
    // Esta é a asserção que protege documentos em produção: o carregamento
    // roda a cada abertura, e uma normalização que não fosse idempotente
    // encolheria a tabela um pouco mais a cada vez que o professor abrisse.
    const uma = normalizarLarguras([120, 153, 120, 120], 4);
    expect(normalizarLarguras(uma, 4)).toEqual(uma);
    expect(normalizarLarguras(normalizarLarguras(uma, 4), 4)).toEqual(uma);
  });

  it("deixa proporção já correta intacta", () => {
    expect(normalizarLarguras([25, 25, 25, 25], 4)).toEqual([25, 25, 25, 25]);
  });

  it("distribui igual quando o array falta ou tem tamanho errado", () => {
    expect(normalizarLarguras(undefined, 4)).toEqual([25, 25, 25, 25]);
    expect(normalizarLarguras([50, 50], 4)).toEqual([25, 25, 25, 25]);
  });

  it("sempre soma 100", () => {
    // Precisão 2 casas (não 6): cada elemento é arredondado independentemente
    // a 3 casas antes da soma, então um erro de até ~0.001-0.002 por
    // acúmulo de arredondamento é esperado e inofensivo — é exatamente a
    // folga que `SOMA_OK` (tolerância 0.5) já documenta como aceitável.
    for (const entrada of [[120, 153, 120, 120], [1, 2, 3], [7], [10, 10]]) {
      const r = normalizarLarguras(entrada, entrada.length);
      expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    }
  });
});

describe("inserir e apagar coluna mantêm a soma em 100", () => {
  it("insertTableColumn não faz a soma virar 200", () => {
    // Hoje `insertTableColumn` insere o literal 100 (commands.ts:1191).
    // Com px isso era um placeholder razoável. Com proporção, faria a soma
    // saltar para 200 e a tabela inteira encolher pela metade na tela.
    const h = harness();
    insertTable(h.ctx, 3, 4);
    setColumnBoundary(h.ctx, 1, 0, 0); // inicializa colWidths em [25,25,25,25]
    // Nota: o brief usa "right" aqui, mas o tipo real de `where` é
    // "before" | "after" — não existe "right"/"left". "after" é o
    // equivalente semântico (insere à direita da coluna 1).
    insertTableColumn(h.ctx, 1, 1, "after");
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(5);
    // Precisão 2 casas, não 6 — mesma folga de arredondamento documentada
    // no teste "sempre soma 100" acima.
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it("deleteTableColumn não deixa a soma abaixo de 100", () => {
    const h = harness();
    insertTable(h.ctx, 3, 4);
    setColumnBoundary(h.ctx, 1, 0, 0);
    deleteTableColumn(h.ctx, 1, 1);
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it("a coluna nova nasce com fatia proporcional, não com sobra", () => {
    const h = harness();
    insertTable(h.ctx, 3, 4);
    setColumnBoundary(h.ctx, 1, 0, 0);
    insertTableColumn(h.ctx, 1, 1, "after");
    // 5 colunas iguais, porque as 4 eram iguais.
    for (const w of h.doc.getBlockAttrs(1).colWidths as number[]) {
      expect(w).toBeCloseTo(20, 3);
    }
  });
});

describe("setTableWidth", () => {
  it("trava em 100 quando pedem mais que isso", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    setTableWidth(h.ctx, 1, 150);
    expect(h.doc.getBlockAttrs(1).tableWidth).toBe(100);
  });

  it("trava no piso (MIN_TABELA_PCT = 20) quando pedem menos que isso", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    setTableWidth(h.ctx, 1, 5);
    expect(h.doc.getBlockAttrs(1).tableWidth).toBe(20);
  });

  it("não escreve tableWidth num bloco que não é tabela", () => {
    const h = harness();
    // blockIndex 0 é o parágrafo padrão com que o documento nasce.
    expect(h.doc.isTable(0)).toBe(false);
    setTableWidth(h.ctx, 0, 50);
    expect(h.doc.getBlockAttrs(0).tableWidth).toBeUndefined();
  });
});

describe("setColumnBoundary — caso degenerado de documento legado", () => {
  it("não deixa nenhum lado ficar negativo quando as duas colunas já nascem abaixo do piso", () => {
    // Um px legado com proporções extremas (ex.: [500,5,5,500]) normaliza
    // para algo como [49.5, 0.495, 0.495, 49.5] — as duas colunas do meio já
    // chegam abaixo de MIN_COLUNA_PCT (3) antes de qualquer arrasto. Não
    // existe delta que ponha as duas em 3 ao mesmo tempo (a soma delas é
    // 0.99, bem menor que 2*3=6): o piso tem que ceder, não estourar para
    // negativo.
    const h = harness();
    insertTable(h.ctx, 2, 4);
    const base = normalizarLarguras([500, 5, 5, 500], 4);
    expect(base[1]).toBeLessThan(3);
    expect(base[2]).toBeLessThan(3);
    setColumnBoundary(h.ctx, 1, 1, -10, base); // arrasta a divisa 1↔2 bem para a esquerda
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    for (const width of w) {
      expect(width).toBeGreaterThanOrEqual(0);
    }
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
});

describe("divisa em documento legado deformado", () => {
  it("curar a vizinha subdimensionada pode mover a divisa CONTRA o arrasto", () => {
    // Comportamento deliberado, medido e travado aqui para ninguém
    // "consertar" depois sem saber o que está desfazendo.
    //
    // Documento legado com px [500, 5, 5, 500] normaliza para proporções
    // [49.5, 0.495, 0.495, 49.5] — duas colunas nascem MUITO abaixo do piso
    // de 3%. Ao arrastar a divisa 0 para a DIREITA, não há de onde tirar: a
    // vizinha já está abaixo do mínimo. O clamp então força o delta negativo
    // necessário para trazê-la ao piso, e a divisa anda para a ESQUERDA.
    //
    // É cura de documento malformado, acontece uma vez, e o resultado é uma
    // tabela válida. A alternativa (não fazer nada) deixaria a coluna
    // invisível para sempre.
    const h = harness();
    insertTable(h.ctx, 2, 4);
    h.doc.getBlockAttrsMap(1)!.set("colWidths", [49.5, 0.495, 0.495, 49.5]);

    setColumnBoundary(h.ctx, 1, 0, +10); // arrasta para a DIREITA
    const w = h.doc.getBlockAttrs(1).colWidths as number[];

    expect(w[0]).toBeLessThan(49.5);   // a divisa andou para a esquerda
    expect(w[1]).toBeCloseTo(3, 3);    // e a vizinha foi curada até o piso
  });

  it("com as DUAS abaixo do piso, a divisa não se move", () => {
    // Não há orçamento para curar nenhuma das duas sem roubar da outra.
    // Ficar parado é melhor que oscilar.
    const h = harness();
    insertTable(h.ctx, 2, 4);
    h.doc.getBlockAttrsMap(1)!.set("colWidths", [0.495, 0.495, 49.5, 49.51]);

    setColumnBoundary(h.ctx, 1, 0, +10);
    const w = h.doc.getBlockAttrs(1).colWidths as number[];

    expect(w[0]).toBeCloseTo(0.495, 3);
    expect(w[1]).toBeCloseTo(0.495, 3);
  });
});
