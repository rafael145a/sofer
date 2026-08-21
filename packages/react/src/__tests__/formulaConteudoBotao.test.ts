import { describe, it, expect, vi } from "vitest";
import { convertLatexToMarkup } from "mathlive/ssr";
import { conteudoDoBotao, paraMarkup, paraMathlive } from "../formulaSnippet";

const vis = (h: string) => h.replace(/<[^>]+>/g, "").replace(/​/g, "").trim();

describe("conteúdo do botão da paleta", () => {
  it("sem renderer carregado, cai no rótulo", () => {
    expect(conteudoDoBotao(null, "\\frac{}{}", "Fração")).toEqual({
      children: "Fração",
    });
  });

  it("com renderer, traduz com paraMarkup e NÃO com paraMathlive", () => {
    // Esta é a asserção que mata a mutação. Trocar as duas funções na ligação
    // do componente deixava a suíte inteira verde com os botões vazios,
    // porque no jsdom o import dinâmico não entrega o renderer e o botão
    // sempre caía no rótulo.
    const spy = vi.fn(() => "<span>x</span>");
    conteudoDoBotao(spy, "^{}", "Expoente");
    expect(spy).toHaveBeenCalledWith("^{□}");
    expect(spy).not.toHaveBeenCalledWith("^{#?}");
  });

  it("o markup do paraMarkup tem glifo; o do paraMathlive não tem", () => {
    // O porquê da asserção acima, medido contra o renderer de verdade.
    for (const s of ["^{}", "_{}", "\\frac{}{}"]) {
      expect(vis(convertLatexToMarkup(paraMarkup(s))).length).toBeGreaterThan(0);
      expect(vis(convertLatexToMarkup(paraMathlive(s)))).toBe("");
    }
  });
});
