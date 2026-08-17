import { describe, it, expect } from "vitest";
import { cellStyle } from "../NodeView";
import {
  cellBorderStyle,
  TABLE_BORDER_COLOR,
  TABLE_GUIDE_COLOR,
  type CellBorderPos,
  type TableBorderPreset,
} from "@sofereditor/core";

function pos(p: Partial<CellBorderPos> = {}): CellBorderPos {
  return { row: 1, col: 1, rowspan: 1, colspan: 1, cols: 3, rowStart: 0, rowEnd: 3, ...p };
}

const border = (preset: TableBorderPreset) => cellBorderStyle(preset, pos(), "screen");

describe("cellStyle com bordas", () => {
  it("mescla as cores de borda com os atributos visuais da célula", () => {
    expect(cellStyle({ bgColor: "#ffe58f" }, border("horizontal"))).toMatchObject({
      backgroundColor: "#ffe58f",
      borderTopColor: TABLE_BORDER_COLOR,
      borderBottomColor: TABLE_BORDER_COLOR,
    });
  });

  it("devolve o estilo de borda mesmo sem atributos visuais", () => {
    expect(cellStyle({}, border("all"))).toMatchObject({
      borderTopColor: TABLE_BORDER_COLOR,
    });
  });

  it("aceita célula undefined", () => {
    expect(cellStyle(undefined, border("all"))).toMatchObject({
      borderTopColor: TABLE_BORDER_COLOR,
    });
  });

  it("sem borda passada, mantém o comportamento antigo", () => {
    // Compatibilidade com cellStyle.test.ts, que chama com um argumento só.
    expect(cellStyle({})).toBeUndefined();
    expect(cellStyle(undefined)).toBeUndefined();
    expect(cellStyle({ align: "center" })).toEqual({ textAlign: "center" });
  });

  it("os atributos da célula vencem sobre a borda em caso de colisão de chave", () => {
    // align/bgColor não colidem com border*Color, mas a ordem de spread precisa
    // ser estável: borda primeiro, atributos depois.
    const s = cellStyle({ align: "right", bgColor: "#fff" }, border("none"))!;
    expect(s.textAlign).toBe("right");
    expect(s.backgroundColor).toBe("#fff");
  });

  it("emite as quatro cores em todos os presets — geometria invariante", () => {
    for (const preset of ["all", "outer", "horizontal", "vertical", "none"] as TableBorderPreset[]) {
      const s = cellStyle({}, border(preset))!;
      expect(s.borderTopColor).toBeDefined();
      expect(s.borderRightColor).toBeDefined();
      expect(s.borderBottomColor).toBeDefined();
      expect(s.borderLeftColor).toBeDefined();
      // Nunca espessura: é isso que garante que trocar de preset não reflui.
      expect(s.borderWidth).toBeUndefined();
      expect(s.borderTopWidth).toBeUndefined();
    }
  });
});

describe("cellStyle com cor de borda customizada", () => {
  it("propaga a cor escolhida para os lados ligados", () => {
    const s = cellStyle({}, cellBorderStyle("all", pos(), "screen", "#ff0000"))!;
    expect(s.borderTopColor).toBe("#ff0000");
    expect(s.borderLeftColor).toBe("#ff0000");
  });

  it("mantém a guia nos lados desligados", () => {
    const s = cellStyle({}, cellBorderStyle("horizontal", pos(), "screen", "#ff0000"))!;
    expect(s.borderTopColor).toBe("#ff0000");
    expect(s.borderLeftColor).toBe(TABLE_GUIDE_COLOR);
  });

  it("cor customizada convive com bgColor da célula", () => {
    const s = cellStyle({ bgColor: "#ffe58f" }, cellBorderStyle("all", pos(), "screen", "#000000"))!;
    expect(s.backgroundColor).toBe("#ffe58f");
    expect(s.borderTopColor).toBe("#000000");
  });

  it("o atributo borderColor do bloco chega ao estilo da célula", () => {
    // Mesma composição que TableView faz no <td>.
    const attrsDoBloco = { rows: 1, cols: 1, borderPreset: "all", borderColor: "#123456" } as const;
    const s = cellStyle(
      {},
      cellBorderStyle(
        attrsDoBloco.borderPreset,
        { row: 0, col: 0, rowspan: 1, colspan: 1, cols: 1, rowStart: 0, rowEnd: 1 },
        "screen",
        attrsDoBloco.borderColor,
      ),
    )!;
    expect(s.borderTopColor).toBe("#123456");
  });
});
