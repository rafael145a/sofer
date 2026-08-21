import { describe, it, expect } from "vitest";
import { applySnippet, PALETA } from "../formulaSnippet";

describe("PALETA", () => {
  it("tem as sete categorias, nessa ordem", () => {
    expect(PALETA.map((c) => c.nome)).toEqual([
      "Estruturas",
      "Símbolos",
      "Relações",
      "Gregas",
      "Conjuntos",
      "Funções",
      "Setas",
    ]);
  });

  it("Estruturas vem primeiro e mantém os oito itens originais", () => {
    // Quem já usava a paleta não pode perder velocidade nem reaprender.
    const estruturas = PALETA[0];
    expect(estruturas.nome).toBe("Estruturas");
    const labels = estruturas.itens.map((i) => i.label);
    for (const antigo of [
      "Fração",
      "Expoente",
      "Índice",
      "Raiz",
      "Raiz n-ésima",
      "Somatório",
      "Integral",
      "Matriz 2×2",
    ]) {
      expect(labels, antigo).toContain(antigo);
    }
  });

  it("usa a notação BRASILEIRA das funções trigonométricas", () => {
    // \sin renderiza "sin" e \tan renderiza "tan". Prova brasileira escreve
    // "sen" e "tg". Se alguém "simplificar" para o idioma do LaTeX, a paleta
    // continua parecendo certa e a PROVA IMPRESSA sai errada — por isso o
    // teste trava a string exata, não só que o snippet renderize.
    const funcoes = PALETA.find((c) => c.nome === "Funções")!;
    const porLabel = Object.fromEntries(funcoes.itens.map((i) => [i.label, i.snippet]));
    expect(porLabel["sen"]).toBe("\\operatorname{sen}");
    expect(porLabel["tg"]).toBe("\\operatorname{tg}");
    expect(porLabel["cotg"]).toBe("\\operatorname{cotg}");
    // E o inverso: nenhuma categoria pode conter as formas inglesas.
    const todos = PALETA.flatMap((c) => c.itens.map((i) => i.snippet)).join(" ");
    expect(todos).not.toMatch(/\\sin\b/);
    expect(todos).not.toMatch(/\\tan\b/);
    expect(todos).not.toMatch(/\\cot\b/);
  });

  it("cada categoria cabe em 4 linhas da própria grade", () => {
    // A grade tem min-height fixo para 4 linhas. Uma categoria que passe
    // disso ou rola ou faz o modal pular de altura ao trocar de aba.
    for (const c of PALETA) {
      const linhas = Math.ceil(c.itens.length / c.colunas);
      expect(linhas, `${c.nome} (${c.itens.length} itens / ${c.colunas} col)`).toBeLessThanOrEqual(4);
    }
  });

  it("Estruturas usa 4 colunas e as de símbolo usam 6", () => {
    // Rótulo em palavra ("Raiz n-ésima") não cabe na largura de um símbolo.
    expect(PALETA[0].colunas).toBe(4);
    for (const c of PALETA.slice(1)) {
      expect(c.colunas, c.nome).toBe(6);
    }
  });

  it("não há label repetido dentro da mesma categoria", () => {
    for (const c of PALETA) {
      const labels = c.itens.map((i) => i.label);
      expect(new Set(labels).size, c.nome).toBe(labels.length);
    }
  });

  it("tem 76 itens no total", () => {
    expect(PALETA.reduce((n, c) => n + c.itens.length, 0)).toBe(76);
  });
});

describe("applySnippet", () => {
  it("insere na posição do cursor", () => {
    const r = applySnippet("ab", 1, 1, "\\frac{}{}");
    expect(r.text).toBe("a\\frac{}{}b");
  });

  it("põe o cursor DENTRO do primeiro par de chaves vazio", () => {
    // Sem isto o professor clica em "Fração" e tem que caçar onde digitar.
    const r = applySnippet("", 0, 0, "\\frac{}{}");
    expect(r.text).toBe("\\frac{}{}");
    expect(r.cursor).toBe("\\frac{".length);
  });

  it("substitui a seleção em vez de duplicar", () => {
    const r = applySnippet("axb", 1, 2, "\\sqrt{}");
    expect(r.text).toBe("a\\sqrt{}b");
  });

  it("snippet sem chaves vazias põe o cursor no fim do inserido", () => {
    const r = applySnippet("", 0, 0, "\\infty");
    expect(r.cursor).toBe("\\infty".length);
  });

  it("acha o primeiro {} mesmo quando o snippet tem colchetes antes", () => {
    const r = applySnippet("", 0, 0, "\\sqrt[]{}");
    expect(r.cursor).toBe("\\sqrt[]{".length);
  });
});
