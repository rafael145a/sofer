import { describe, it, expect } from "vitest";
import {
  cellBorderColors,
  cellBorderStyle,
  TABLE_BORDER_COLOR,
  TABLE_GUIDE_COLOR,
  type CellBorderPos,
} from "../table-borders";
import type { TableBorderPreset } from "../types";

const ON = TABLE_BORDER_COLOR;
const OFF = "transparent";

/** Célula do miolo de uma tabela 3×3 não fragmentada. */
function pos(p: Partial<CellBorderPos> = {}): CellBorderPos {
  return { row: 1, col: 1, rowspan: 1, colspan: 1, cols: 3, rowStart: 0, rowEnd: 3, ...p };
}

describe("cellBorderColors", () => {
  it("preset ausente vale 'all' — nenhum documento existente muda de aparência", () => {
    expect(cellBorderColors(undefined, pos(), "print")).toEqual({
      top: ON,
      right: ON,
      bottom: ON,
      left: ON,
    });
  });

  it("all liga os quatro lados de toda célula", () => {
    expect(cellBorderColors("all", pos(), "print")).toEqual({
      top: ON,
      right: ON,
      bottom: ON,
      left: ON,
    });
  });

  it("horizontal: só topo e base", () => {
    expect(cellBorderColors("horizontal", pos(), "print")).toEqual({
      top: ON,
      right: OFF,
      bottom: ON,
      left: OFF,
    });
  });

  it("vertical: só laterais", () => {
    expect(cellBorderColors("vertical", pos(), "print")).toEqual({
      top: OFF,
      right: ON,
      bottom: OFF,
      left: ON,
    });
  });

  it("none: nada visível na impressão", () => {
    expect(cellBorderColors("none", pos(), "print")).toEqual({
      top: OFF,
      right: OFF,
      bottom: OFF,
      left: OFF,
    });
  });
});

describe("cellBorderColors — preset outer", () => {
  it("célula do miolo não tem nenhuma borda visível", () => {
    expect(cellBorderColors("outer", pos(), "print")).toEqual({
      top: OFF,
      right: OFF,
      bottom: OFF,
      left: OFF,
    });
  });

  it("canto superior esquerdo tem topo e esquerda", () => {
    expect(cellBorderColors("outer", pos({ row: 0, col: 0 }), "print")).toEqual({
      top: ON,
      right: OFF,
      bottom: OFF,
      left: ON,
    });
  });

  it("canto inferior direito tem base e direita", () => {
    expect(cellBorderColors("outer", pos({ row: 2, col: 2 }), "print")).toEqual({
      top: OFF,
      right: ON,
      bottom: ON,
      left: OFF,
    });
  });

  it("colspan que alcança a última coluna ganha a borda direita", () => {
    // Uma célula em col=1 com colspan=2 cobre as colunas 1 e 2 de 3 → toca a direita.
    expect(cellBorderColors("outer", pos({ row: 1, col: 1, colspan: 2 }), "print").right).toBe(ON);
    // Sem o span, a mesma posição NÃO toca.
    expect(cellBorderColors("outer", pos({ row: 1, col: 1 }), "print").right).toBe(OFF);
  });

  it("rowspan que alcança a última linha ganha a borda inferior", () => {
    expect(cellBorderColors("outer", pos({ row: 1, col: 0, rowspan: 2 }), "print").bottom).toBe(ON);
    expect(cellBorderColors("outer", pos({ row: 1, col: 0 }), "print").bottom).toBe(OFF);
  });

  it("span degenerado (0 ou negativo) é tratado como 1", () => {
    expect(cellBorderColors("outer", pos({ row: 2, col: 2, rowspan: 0, colspan: 0 }), "print")).toEqual(
      { top: OFF, right: ON, bottom: ON, left: OFF },
    );
  });

  it("numa tabela quebrada, a borda externa segue o FRAGMENTO", () => {
    // Fragmento com as linhas 2..4 de uma tabela de 6 linhas: cada página fecha
    // a própria caixa, como o Word faz.
    const primeira = pos({ row: 2, col: 0, rowStart: 2, rowEnd: 5 });
    expect(cellBorderColors("outer", primeira, "print").top).toBe(ON);

    const ultima = pos({ row: 4, col: 0, rowStart: 2, rowEnd: 5 });
    expect(cellBorderColors("outer", ultima, "print").bottom).toBe(ON);

    const meio = pos({ row: 3, col: 1, rowStart: 2, rowEnd: 5 });
    expect(cellBorderColors("outer", meio, "print")).toEqual({
      top: OFF,
      right: OFF,
      bottom: OFF,
      left: OFF,
    });
  });

  it("a linha 0 NÃO fecha o topo quando o fragmento começa depois dela", () => {
    expect(cellBorderColors("outer", pos({ row: 0, col: 0, rowStart: 1, rowEnd: 3 }), "print").top).toBe(
      OFF,
    );
  });
});

describe("cellBorderColors — guia de tela", () => {
  it("na tela, lados desligados viram guia — mesma geometria, cor diferente", () => {
    expect(cellBorderColors("none", pos(), "screen")).toEqual({
      top: TABLE_GUIDE_COLOR,
      right: TABLE_GUIDE_COLOR,
      bottom: TABLE_GUIDE_COLOR,
      left: TABLE_GUIDE_COLOR,
    });
  });

  it("a guia é uma custom property com fallback transparent", () => {
    // Sem a variável definida (consumidor sem CSS, ou @media print), some.
    expect(TABLE_GUIDE_COLOR).toBe("var(--ed-guide-color, transparent)");
  });

  it("variant não altera os lados LIGADOS", () => {
    for (const preset of ["all", "outer", "horizontal", "vertical"] as TableBorderPreset[]) {
      const tela = cellBorderColors(preset, pos({ row: 0, col: 0 }), "screen");
      const impressa = cellBorderColors(preset, pos({ row: 0, col: 0 }), "print");
      for (const lado of ["top", "right", "bottom", "left"] as const) {
        if (impressa[lado] === ON) expect(tela[lado]).toBe(ON);
      }
    }
  });
});

describe("cellBorderStyle", () => {
  it("emite SEMPRE os quatro lados, só cor — nunca espessura", () => {
    for (const preset of ["all", "outer", "horizontal", "vertical", "none"] as TableBorderPreset[]) {
      const s = cellBorderStyle(preset, pos(), "print");
      expect(Object.keys(s).sort()).toEqual([
        "borderBottomColor",
        "borderLeftColor",
        "borderRightColor",
        "borderTopColor",
      ]);
      const json = JSON.stringify(s);
      expect(json).not.toContain("Width");
      expect(json).not.toContain("Style");
    }
  });

  it("a geometria é invariante entre presets — nada reflui ao trocar", () => {
    // Todos os presets produzem exatamente o mesmo conjunto de propriedades,
    // então a caixa da célula é idêntica em todos eles.
    const chaves = (p: TableBorderPreset) =>
      Object.keys(cellBorderStyle(p, pos(), "print")).sort().join(",");
    const base = chaves("all");
    for (const p of ["outer", "horizontal", "vertical", "none"] as TableBorderPreset[]) {
      expect(chaves(p)).toBe(base);
    }
  });
});

describe("setBlockAttrAtIndex", () => {
  it("muda o attr da TABELA com o caret dentro de uma célula", async () => {
    const { EditorDocument, createTableBlock } = await import("../document");
    const { setBlockAttrAtIndex, setBlockAttr } = await import("../commands");
    const { collapsedSelection } = await import("../selection");

    const doc = new EditorDocument();
    doc.blocks.insert(1, [createTableBlock(2, 2)]);
    let sel = collapsedSelection({ blockIndex: 1, cellIndex: 0, offset: 0 });
    const ctx = { doc, getSelection: () => sel, setSelection: (s: typeof sel) => { sel = s; } };

    // setBlockAttr é inerte com o caret dentro de célula — é por isso que
    // setBlockAttrAtIndex existe.
    setBlockAttr(ctx, "borderPreset", "outer");
    expect(doc.toJSON().blocks[1].attrs.borderPreset).toBeUndefined();

    setBlockAttrAtIndex(ctx, 1, "borderPreset", "outer");
    expect(doc.toJSON().blocks[1].attrs.borderPreset).toBe("outer");
  });

  it("apaga a chave quando o valor é null", async () => {
    const { EditorDocument, createTableBlock } = await import("../document");
    const { setBlockAttrAtIndex } = await import("../commands");
    const { collapsedSelection } = await import("../selection");

    const doc = new EditorDocument();
    doc.blocks.insert(1, [createTableBlock(1, 1)]);
    let sel = collapsedSelection({ blockIndex: 1, cellIndex: 0, offset: 0 });
    const ctx = { doc, getSelection: () => sel, setSelection: (s: typeof sel) => { sel = s; } };

    setBlockAttrAtIndex(ctx, 1, "borderPreset", "none");
    expect(doc.toJSON().blocks[1].attrs.borderPreset).toBe("none");
    setBlockAttrAtIndex(ctx, 1, "borderPreset", null);
    expect(doc.toJSON().blocks[1].attrs.borderPreset).toBeUndefined();
  });

  it("índice inexistente é no-op", async () => {
    const { EditorDocument } = await import("../document");
    const { setBlockAttrAtIndex } = await import("../commands");
    const { collapsedSelection } = await import("../selection");

    const doc = new EditorDocument();
    let sel = collapsedSelection({ blockIndex: 0, offset: 0 });
    const ctx = { doc, getSelection: () => sel, setSelection: (s: typeof sel) => { sel = s; } };
    expect(() => setBlockAttrAtIndex(ctx, 99, "borderPreset", "all")).not.toThrow();
  });
});
