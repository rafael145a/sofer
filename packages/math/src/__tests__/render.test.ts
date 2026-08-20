import { describe, it, expect } from "vitest";
import { renderLatexToSvg } from "../render";

describe("renderLatexToSvg", () => {
  it("converte LaTeX válido e devolve dimensões em ex", () => {
    const r = renderLatexToSvg("\\frac{1}{2}", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg.startsWith("<svg")).toBe(true);
    expect(r.widthEx).toBeGreaterThan(0);
    expect(r.heightEx).toBeGreaterThan(0);
  });

  it("O SVG É AUTO-CONTIDO — este é o teste que mais importa", () => {
    // fontCache 'global' (o padrão do MathJax) põe os glifos num <defs> FORA
    // do SVG. O preview funcionaria e o documento salvo, o PDF e o DOCX
    // sairiam EM BRANCO. Este teste é o único guardrail contra isso.
    const r = renderLatexToSvg("\\sum_{i=1}^{n} i^2", true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("<defs>");
    // Nenhum <use> apontando para fora do próprio SVG.
    const usesExternos = /<use[^>]*(?:xlink:)?href="#(?!MJX-)/.test(r.svg);
    expect(usesExternos).toBe(false);
  });

  it("fórmula inline devolve vAlignEx negativo (desce abaixo da base)", () => {
    const r = renderLatexToSvg("\\frac{1}{2}", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vAlignEx).toBeLessThan(0);
  });

  it("display muda o resultado em relação ao inline", () => {
    const inline = renderLatexToSvg("\\sum_{i=1}^{n} i", false);
    const bloco = renderLatexToSvg("\\sum_{i=1}^{n} i", true);
    expect(inline.ok && bloco.ok).toBe(true);
    if (!inline.ok || !bloco.ok) return;
    // Em display os limites vão acima/abaixo do sigma: fica mais alto e mais estreito.
    expect(bloco.heightEx).toBeGreaterThan(inline.heightEx);
  });

  it("os oito itens da paleta renderizam sem erro", () => {
    const paleta = [
      "\\frac{1}{2}",
      "x^{2}",
      "a_{n}",
      "\\sqrt{x}",
      "\\sqrt[3]{x}",
      "\\sum_{i=1}^{n} i",
      "\\int_{0}^{1} x dx",
      "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
    ];
    for (const tex of paleta) {
      expect(renderLatexToSvg(tex, false).ok, tex).toBe(true);
    }
  });

  it("LaTeX inválido devolve ok:false com a mensagem do MathJax", () => {
    const r = renderLatexToSvg("\\frac{1}{", false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Missing close brace");
  });

  it("macro desconhecida também é erro, não silêncio", () => {
    const r = renderLatexToSvg("\\naoexiste{x}", false);
    expect(r.ok).toBe(false);
  });
});
