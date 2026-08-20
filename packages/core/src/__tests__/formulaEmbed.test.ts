import { describe, it, expect } from "vitest";
import { isImageEmbed, isFormulaEmbed, type ImageEmbed } from "../types";

const imagem: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAA",
  width: 10,
  height: 10,
};

const formula: ImageEmbed = {
  type: "image",
  src: "data:image/svg+xml;base64,AAA",
  width: 20,
  height: 12,
  formula: { latex: "\\frac{1}{2}", display: false, vAlign: "-0.781ex" },
  svgFallback: "data:image/png;base64,BBB",
};

describe("isFormulaEmbed", () => {
  it("reconhece embed com campo formula", () => {
    expect(isFormulaEmbed(formula)).toBe(true);
  });

  it("não reconhece imagem comum", () => {
    expect(isFormulaEmbed(imagem)).toBe(false);
  });

  it("não reconhece string nem null", () => {
    expect(isFormulaEmbed("texto")).toBe(false);
    expect(isFormulaEmbed(null)).toBe(false);
  });

  it("uma fórmula CONTINUA sendo um embed de imagem", () => {
    // É o ponto todo do desenho: paginação, clipboard, resize e delete
    // narrowam por isImageEmbed e não podem passar a ignorar fórmula.
    expect(isImageEmbed(formula)).toBe(true);
  });

  it("imagem comum não vira fórmula por ter svgFallback", () => {
    // svgFallback é geral para SVG, não exclusivo de fórmula.
    const svg: ImageEmbed = { ...imagem, svgFallback: "data:image/png;base64,CCC" };
    expect(isFormulaEmbed(svg)).toBe(false);
    expect(isImageEmbed(svg)).toBe(true);
  });
});
