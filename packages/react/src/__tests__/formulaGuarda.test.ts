import { describe, it, expect } from "vitest";
import { podeInserir, motivoBloqueio } from "../formulaGuarda";

describe("gate do botão Inserir", () => {
  it("bloqueia enquanto houver caixa em branco", () => {
    // O MathLive serializa caixa não preenchida como \placeholder{}, e isso
    // é `Undefined control sequence` no MathJax: a fórmula não entraria em
    // branco no documento, entraria QUEBRADA.
    expect(podeInserir("\\frac{1}{\\placeholder{}}", { ok: true })).toBe(false);
    expect(podeInserir("\\placeholder{}", { ok: true })).toBe(false);
  });

  it("bloqueia campo vazio e só de espaço", () => {
    expect(podeInserir("", { ok: true })).toBe(false);
    expect(podeInserir("   ", { ok: true })).toBe(false);
  });

  it("bloqueia quando o MathJax recusou", () => {
    expect(podeInserir("\\frac{1}{2}", { ok: false })).toBe(false);
    expect(podeInserir("\\frac{1}{2}", null)).toBe(false);
  });

  it("libera fórmula completa que renderiza", () => {
    expect(podeInserir("\\frac{1}{2}", { ok: true })).toBe(true);
    expect(podeInserir("\\operatorname{sen} x", { ok: true })).toBe(true);
  });
});

describe("motivo mostrado ao professor", () => {
  it("caixa em branco tem mensagem própria, não o erro cru do MathJax", () => {
    // Sem isto o professor lê "Undefined control sequence \placeholder",
    // que não diz o que fazer.
    expect(motivoBloqueio("\\frac{1}{\\placeholder{}}", { ok: false, error: "Undefined control sequence \\placeholder" }))
      .toBe("Preencha os campos em branco da fórmula.");
  });
  it("erro de LaTeX de verdade passa a mensagem do renderer", () => {
    expect(motivoBloqueio("\\frac", { ok: false, error: "Missing argument for \\frac" }))
      .toBe("Missing argument for \\frac");
  });
  it("fórmula boa não tem motivo", () => {
    expect(motivoBloqueio("x", { ok: true })).toBe(null);
  });
});

describe("caixa esvaziada depois de preenchida", () => {
  // O `\placeholder{}` marca só o que NUNCA foi tocado. Quem preenche e
  // depois apaga devolve grupo vazio (`\frac{1}{}`) ou, dentro de matriz,
  // NADA entre dois separadores. As duas formas passavam pelo gate, e o
  // MathJax renderiza as duas com `ok: true` — `\frac{1}{}` vira um SVG de
  // 919 bytes com um glifo só, o "1", sem barra e sem denominador.
  //
  // O caminho mais provável de todos: clicar em Fração, preencher, e apertar
  // Backspace uma vez para corrigir o denominador.
  const REJEITAR = [
    "\\frac{1}{}",
    "\\frac{}{2}",
    "x^{}",
    "x_{}",
    "\\sqrt{}",
    "\\log_{}",
    "\\left|{}\\right|",
    "\\begin{pmatrix}1 & 2\\\\ 3 & \\end{pmatrix}",
    "\\begin{cases}x=1\\\\ \\end{cases}",
    "\\begin{pmatrix} & \\\\ & \\end{pmatrix}",
  ];
  it.each(REJEITAR)("bloqueia %s", (latex) => {
    expect(podeInserir(latex, { ok: true })).toBe(false);
    expect(motivoBloqueio(latex, { ok: true })).toBe(
      "Preencha os campos em branco da fórmula.",
    );
  });

  // A outra metade do teste, e a que importa mais: o guarda não pode passar a
  // recusar fórmula legítima. Matriz e sistema COMPLETOS têm os mesmos `&` e
  // `\\` das versões quebradas — é só o que está entre eles que muda.
  const ACEITAR = [
    "\\frac{1}{2}",
    "\\operatorname{sen} x",
    "3{,}14",
    "\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}",
    "\\begin{cases}x=1\\\\ y=2\\end{cases}",
    "\\sqrt[3]{8}",
    "\\left|x\\right|",
    "9{,}8\\,\\text{m/s}^2",
    "\\lim_{x \\to 0}",
    "\\sum_{i=1}^{n} i",
    "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
    "\\cos^{2}\\theta",
  ];
  it.each(ACEITAR)("aceita %s", (latex) => {
    expect(podeInserir(latex, { ok: true })).toBe(true);
    expect(motivoBloqueio(latex, { ok: true })).toBe(null);
  });
});
