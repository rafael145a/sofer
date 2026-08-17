import type { StyleRecord } from "./decorations";
import type { TableBorderPreset } from "./types";

/** Cor da grade. Mesmo valor que o CSS de `.ed-cell` já usa. */
export const TABLE_BORDER_COLOR = "#cbd5e1";

/**
 * Guia de tela para lados de borda desligados por preset.
 *
 * É uma custom property com fallback `transparent`: sem a variável definida
 * (consumidor sem CSS próprio, ou dentro de `@media print`), o lado
 * simplesmente não aparece — que é o correto para impressão. Nunca muda a
 * geometria: o lado continua com 1px, só sem cor.
 */
export const TABLE_GUIDE_COLOR = "var(--ed-guide-color, transparent)";

export interface CellBorderPos {
  /** Linha absoluta da célula na tabela lógica. */
  row: number;
  /** Coluna absoluta. */
  col: number;
  rowspan: number;
  colspan: number;
  /** Total de colunas da tabela. */
  cols: number;
  /** Primeira linha do fragmento renderizado. Tabela inteira = 0. */
  rowStart: number;
  /** Fim exclusivo do fragmento. Tabela inteira = `rows`. */
  rowEnd: number;
}

export interface CellBorderColors {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

/**
 * Cor de cada lado da célula segundo o preset.
 *
 * NUNCA devolve espessura. Trocar de preset muda só cor, então nenhuma linha
 * reflui e a paginação já validada não se mexe. Como todas as bordas têm a
 * mesma espessura e o mesmo estilo em toda a tabela, também não há conflito de
 * `border-collapse` para resolver.
 *
 * As bordas externas seguem os limites do FRAGMENTO, não da tabela lógica: numa
 * tabela quebrada entre páginas, cada página fecha a própria caixa — o
 * comportamento do Word.
 *
 * O teste de "toca a borda" usa row/col + spans em vez dos seletores CSS
 * `:first-child`/`:last-child`, que quebram assim que uma célula `covered` some
 * do DOM por causa de um rowspan.
 */
export function cellBorderColors(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
): CellBorderColors {
  const on = TABLE_BORDER_COLOR;
  const off = variant === "screen" ? TABLE_GUIDE_COLOR : "transparent";
  switch (preset ?? "all") {
    case "horizontal":
      return { top: on, right: off, bottom: on, left: off };
    case "vertical":
      return { top: off, right: on, bottom: off, left: on };
    case "none":
      return { top: off, right: off, bottom: off, left: off };
    case "outer": {
      const isTop = pos.row === pos.rowStart;
      const isBottom = pos.row + Math.max(1, pos.rowspan) - 1 === pos.rowEnd - 1;
      const isLeft = pos.col === 0;
      const isRight = pos.col + Math.max(1, pos.colspan) - 1 === pos.cols - 1;
      return {
        top: isTop ? on : off,
        right: isRight ? on : off,
        bottom: isBottom ? on : off,
        left: isLeft ? on : off,
      };
    }
    case "all":
    default:
      return { top: on, right: on, bottom: on, left: on };
  }
}

/** `cellBorderColors` no formato de estilo inline consumido pelos renderizadores. */
export function cellBorderStyle(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
): StyleRecord {
  const c = cellBorderColors(preset, pos, variant);
  return {
    borderTopColor: c.top,
    borderRightColor: c.right,
    borderBottomColor: c.bottom,
    borderLeftColor: c.left,
  };
}
