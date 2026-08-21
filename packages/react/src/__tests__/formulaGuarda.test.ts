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
