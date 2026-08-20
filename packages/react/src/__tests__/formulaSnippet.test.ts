import { describe, it, expect } from "vitest";
import { applySnippet, PALETA } from "../formulaSnippet";

describe("PALETA", () => {
  it("tem os oito itens, com os rótulos exatos", () => {
    expect(PALETA.map((p) => p.label)).toEqual([
      "Fração",
      "Expoente",
      "Índice",
      "Raiz",
      "Raiz n-ésima",
      "Somatório",
      "Integral",
      "Matriz 2×2",
    ]);
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
