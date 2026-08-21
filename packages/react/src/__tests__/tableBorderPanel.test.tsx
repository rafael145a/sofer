import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { TableBorderPanel, BORDER_PRESETS, BORDER_MENU_GLYPH } from "../TableBorderPanel";
import type { TableBorderPreset } from "@sofereditor/core";

const html = (preset: TableBorderPreset, color = "#000000"): string =>
  renderToStaticMarkup(
    createElement(TableBorderPanel, {
      preset,
      color,
      onPreset: () => {},
      onColor: () => {},
      onResetColor: () => {},
    }),
  );

/** O trecho do <button> que está marcado como ativo. */
const botaoAtivo = (out: string): string =>
  out.split("<button").find((seg) => seg.includes('aria-pressed="true"')) ?? "";

describe("TableBorderPanel", () => {
  it("oferece os cinco presets do w:tblBorders, nessa ordem", () => {
    expect(BORDER_PRESETS.map((p) => p.key)).toEqual([
      "all",
      "outer",
      "horizontal",
      "vertical",
      "none",
    ]);
  });

  it("usa o quadrado dividido em quatro no gatilho, não a grade fina", () => {
    // ▦ é grade fina e já é o glifo do botão de TABELA. O de bordas é ⊞.
    expect(BORDER_MENU_GLYPH).toBe("⊞");
    expect(BORDER_MENU_GLYPH).not.toBe("▦");
  });

  it("marca exatamente um preset como ativo", () => {
    for (const p of BORDER_PRESETS) {
      const out = html(p.key);
      expect((out.match(/aria-pressed="true"/g) ?? []).length, p.key).toBe(1);
    }
  });

  it("o destaque segue o preset do modelo, não o primeiro da lista", () => {
    // Regressão do risco do spec: sair do <select> com defaultValue para
    // botões controlados só vale se o destaque acompanhar o modelo.
    expect(botaoAtivo(html("outer"))).toContain("Só externas");
    expect(botaoAtivo(html("none"))).toContain("Nenhuma");
    expect(botaoAtivo(html("all"))).toContain("Todas");
  });

  it("mostra a cor da linha recebida no input e na amostra", () => {
    const out = html("all", "#ff0000");
    expect(out).toContain('value="#ff0000"');
    expect(out).toContain("background:#ff0000");
  });

  it("traz o botão de restaurar a cor padrão", () => {
    expect(html("all")).toContain("Padrão");
  });
});
