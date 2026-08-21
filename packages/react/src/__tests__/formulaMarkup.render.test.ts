import { describe, it, expect } from "vitest";
import { convertLatexToMarkup } from "mathlive/ssr";
import { PALETA, paraMarkup } from "../formulaSnippet";

/**
 * O botão da paleta agora é `convertLatexToMarkup(paraMarkup(p.snippet))`
 * (Task 4, Step 4/5). `formulaPaleta.render.test.ts` já garante que o
 * snippet CRU renderiza sem erro no renderer do documento — mas não pega o
 * caso que este teste existe pra pegar: `convertLatexToMarkup` é estático
 * (sem o comportamento de placeholder do mathfield interativo), e `^{}` /
 * `_{}` sem tradução saem com markup **vazio** — sem glifo, sem linha, sem
 * caixa, verificado à mão contra `mathlive/ssr` antes deste teste existir.
 * O botão de Expoente/Índice ficaria sem forma nenhuma, o problema que esta
 * tarefa existe pra resolver.
 *
 * Extrai só o texto visível (remove as tags) como aproximação barata de
 * "tem alguma forma": todo item deve deixar pelo menos um caractere que não
 * seja espaço ou zero-width space depois de `paraMarkup`.
 */
function textoVisivel(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/​/g, "")
    .trim();
}

describe("todo item da paleta tem forma visível no botão (convertLatexToMarkup)", () => {
  const todos = PALETA.flatMap((c) => c.itens.map((i) => ({ cat: c.nome, ...i })));

  it("são 82 itens", () => {
    expect(todos).toHaveLength(82);
  });

  it.each(todos)("$cat / $label", ({ snippet }) => {
    const html = convertLatexToMarkup(paraMarkup(snippet));
    expect(textoVisivel(html).length).toBeGreaterThan(0);
  });
});
