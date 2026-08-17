import { describe, it, expect } from "vitest";
import { isNativeControl, keepsOwnMouseDown } from "../Toolbar";

/**
 * A toolbar previne `mousedown` para não limpar a seleção do editor. Mas um
 * `<select>` PRECISA receber o mousedown, senão o dropdown nativo não abre.
 *
 * A regra estava duplicada em três lugares com três listas diferentes, e o
 * `<select>` de bordas da tabela caiu justamente na cópia que esquecia SELECT.
 * Estes testes fixam o predicado único.
 */
const alvo = (tagName: string) => ({ tagName }) as unknown as EventTarget;

describe("isNativeControl", () => {
  it("reconhece os controles nativos que abrem dropdown/picker", () => {
    for (const tag of ["SELECT", "INPUT", "OPTION"]) {
      expect(isNativeControl(alvo(tag)), tag).toBe(true);
    }
  });

  it("não reconhece elementos comuns", () => {
    for (const tag of ["DIV", "SPAN", "BUTTON", "LABEL", "HR"]) {
      expect(isNativeControl(alvo(tag)), tag).toBe(false);
    }
  });

  it("aceita alvo nulo sem quebrar", () => {
    expect(isNativeControl(null)).toBe(false);
  });
});

describe("keepsOwnMouseDown (popovers)", () => {
  it("preserva o mousedown de SELECT — sem isso o dropdown não abre", () => {
    expect(keepsOwnMouseDown(alvo("SELECT"))).toBe(true);
  });

  it("preserva o mousedown de INPUT e OPTION", () => {
    expect(keepsOwnMouseDown(alvo("INPUT"))).toBe(true);
    expect(keepsOwnMouseDown(alvo("OPTION"))).toBe(true);
  });

  it("preserva o mousedown de BUTTON", () => {
    expect(keepsOwnMouseDown(alvo("BUTTON"))).toBe(true);
  });

  it("previne no fundo do popover, para não limpar a seleção do editor", () => {
    for (const tag of ["DIV", "SPAN", "LABEL", "HR"]) {
      expect(keepsOwnMouseDown(alvo(tag)), tag).toBe(false);
    }
  });

  it("aceita alvo nulo sem quebrar", () => {
    expect(keepsOwnMouseDown(null)).toBe(false);
  });

  it("é um superconjunto de isNativeControl", () => {
    // Todo controle nativo também é preservado dentro de um popover.
    for (const tag of ["SELECT", "INPUT", "OPTION"]) {
      expect(keepsOwnMouseDown(alvo(tag))).toBe(true);
    }
  });
});
