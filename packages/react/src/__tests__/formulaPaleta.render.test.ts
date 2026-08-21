import { describe, it, expect } from "vitest";
import { renderLatexToSvg } from "@sofereditor/math";
import { PALETA } from "../formulaSnippet";

/**
 * A paleta promete que todo item renderiza. Sem este teste, um snippet com
 * LaTeX inválido passa nos testes de conteúdo e só falha na frente do
 * professor, no preview do modal.
 *
 * Roda o renderer de verdade — o mesmo que o modal usa — contra os 76 itens.
 */
describe("todo item da paleta renderiza", () => {
  const todos = PALETA.flatMap((c) => c.itens.map((i) => ({ cat: c.nome, ...i })));

  it("são 76 itens", () => {
    expect(todos).toHaveLength(76);
  });

  it.each(todos)("$cat / $label", ({ snippet }) => {
    const r = renderLatexToSvg(snippet, false);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});
