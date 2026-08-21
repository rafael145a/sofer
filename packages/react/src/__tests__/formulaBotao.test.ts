import { describe, it, expect } from "vitest";
import { PALETA } from "../formulaSnippet";

/**
 * Com o botão renderizado, o conteúdo vira uma pilha de <span> do KaTeX e o
 * botão fica SEM NOME ACESSÍVEL NENHUM — hoje ao menos o caractere é lido.
 * O aria-label passa a ser a única fonte, então todo item precisa de um.
 */
describe("todo item tem nome acessível", () => {
  it.each(PALETA.flatMap((c) => c.itens.map((i) => ({ cat: c.nome, ...i }))))(
    "$cat / $label",
    ({ titulo, label }) => {
      const nome = titulo ?? label;
      expect(nome.trim().length).toBeGreaterThan(0);
    },
  );
});
