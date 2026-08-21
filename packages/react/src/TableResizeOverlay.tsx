import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type RefObject,
} from "react";
import { normalizarLarguras } from "@sofereditor/core";
import { useEditorContext } from "./EditorContext";

interface Props {
  /** Ref to the underlying `<table>` element. */
  tableRef: RefObject<HTMLTableElement | null>;
  blockIndex: number;
  cols: number;
}

/**
 * O arrasto chega em px de tela; o modelo é proporção. A conversão é contra
 * a largura RENDERIZADA da tabela, que é justamente o que torna o arrasto
 * exato: mover o dedo 60 px numa tabela de 600 px é mover a divisa 10 pontos,
 * e 10 pontos renderizam 60 px. Ida e volta fecham.
 */
export function deltaPctDoArrasto(dxPx: number, larguraTabelaPx: number): number {
  if (!(larguraTabelaPx > 0)) return 0;
  return (dxPx / larguraTabelaPx) * 100;
}

/**
 * Renders absolute-positioned drag handles aligned with each column boundary
 * (except the table's left edge). While dragging, converts the pointer delta
 * (px) into percentage points against the table's rendered width — using
 * `deltaPctDoArrasto` — and calls `setColumnBoundary` (or, for the last
 * handle — the table's own right edge — `setTableWidth`) so the model — and
 * therefore the `<colgroup>` — updates in real time.
 *
 * O delta é sempre calculado contra o estado do MODELO lido uma única vez no
 * `pointerdown` (`draggingRef.current.base` / `baseTableWidthPct`), nunca
 * contra a largura renderizada corrente: acumular contra o DOM é o que
 * produzia o salto elástico que esta tarefa mata (ver `deltaPctDoArrasto`
 * acima e o brief da Task 3 para a medição do defeito).
 *
 * No `pointerup` a alça reancora via `measure()` — necessário porque, se a
 * coluna bateu no piso (`MIN_COLUNA_PCT`) e parou antes do dedo, a posição
 * calculada a partir do delta fica à frente de onde a borda realmente está.
 * `measure()` NÃO é chamado durante o `pointermove`: chamá-lo ali voltaria a
 * ler a largura renderizada a cada quadro e reintroduziria o defeito por
 * outro caminho.
 *
 * Lives as a sibling of the `<table>` inside a `position: relative` wrapper.
 * Handles are `contentEditable={false}` so they don't interfere with caret
 * placement inside cells.
 */
export function TableResizeOverlay({ tableRef, blockIndex, cols }: Props): JSX.Element | null {
  const editor = useEditorContext();
  const [positions, setPositions] = useState<{ x: number; height: number } | null>(null);
  // The handle X positions and the table's total height. Recomputed after every layout.
  const [layout, setLayout] = useState<{ rights: number[]; height: number } | null>(null);
  const draggingRef = useRef<{
    /** Handle index — the right edge of column `col`. */
    col: number;
    startX: number;
    /** Table's rendered width (px) at drag start — the 100% reference for column deltas
     *  (colgroup `<col>` percentages are relative to the TABLE itself). */
    tableWidthPx: number;
    /**
     * `.ed-table-wrap` rendered width (px) at drag start — the 100% reference
     * for `tableWidth` deltas. `<table style="width:X%">` is a percentage of
     * its containing block (`.ed-table-wrap`, which has no width of its own
     * and simply fills the page column), NOT of the table's own current
     * width. Whenever `baseTableWidthPct !== 100` those two differ, and using
     * `tableWidthPx` there overshoots by a factor of `100 / baseTableWidthPct`
     * — invisible on a fresh 100%-wide table, but a second drag of the right
     * edge after a resize reproduces the exact rubber-banding this task
     * exists to kill, just on the outer edge instead of an inner boundary.
     */
    containerWidthPx: number;
    /** colWidths proportions at drag start, so the delta is always relative to that instant. */
    base: number[];
    /** `tableWidth` attr at drag start (defaults to 100 when absent). */
    baseTableWidthPct: number;
  } | null>(null);

  // Measure column right-edges relative to the table's left edge.
  const measure = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const tableRect = table.getBoundingClientRect();
    // Prefer measuring via `<col>` elements when present.
    const cgCols = table.querySelectorAll<HTMLTableColElement>("colgroup > col");
    let rights: number[] = [];
    if (cgCols.length === cols) {
      let acc = 0;
      cgCols.forEach((c) => {
        acc += c.getBoundingClientRect().width;
        rights.push(acc);
      });
    } else {
      // Fallback: use the first row's <td> bounding rects.
      const firstRowCells = table.querySelectorAll<HTMLTableCellElement>("tbody > tr:first-child > td");
      let acc = 0;
      firstRowCells.forEach((td) => {
        // Account for colSpan: split the width evenly across the spanned cols.
        const cs = Math.max(1, td.colSpan || 1);
        const w = td.getBoundingClientRect().width / cs;
        for (let i = 0; i < cs; i++) {
          acc += w;
          rights.push(acc);
        }
      });
    }
    if (rights.length !== cols) {
      // Shape mismatch — bail out rather than place handles in wrong spots.
      setLayout(null);
      return;
    }
    setLayout({ rights, height: tableRect.height });
  }, [cols, tableRef]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(table);
    return () => ro.disconnect();
  }, [measure, tableRef]);

  const onPointerDown = useCallback(
    (col: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      // Prevent the editor from losing focus / caret being placed on the handle.
      e.preventDefault();
      e.stopPropagation();
      const table = tableRef.current;
      if (!table) return;
      const tableWidthPx = table.getBoundingClientRect().width || 1;
      // `.ed-table-wrap` is always the table's parent (see TableView) and is
      // the containing block the inline `width:X%` style resolves against.
      const containerWidthPx = table.parentElement?.getBoundingClientRect().width || tableWidthPx;
      const attrs = editor.doc.getBlockAttrs(blockIndex);
      const base = normalizarLarguras(attrs.colWidths as number[] | undefined, cols);
      const baseTableWidthPct = typeof attrs.tableWidth === "number" ? attrs.tableWidth : 100;
      draggingRef.current = { col, startX: e.clientX, tableWidthPx, containerWidthPx, base, baseTableWidthPct };
      setPositions({ x: e.clientX, height: layout?.height ?? 0 });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [layout, tableRef, editor, blockIndex, cols],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = draggingRef.current;
      if (!d) return;
      // Delta SEMPRE relativo ao estado do pointerdown (d.base /
      // d.baseTableWidthPct), nunca ao que está renderizado agora —
      // acumular contra o DOM é o defeito que esta tarefa mata.
      const dx = e.clientX - d.startX;
      if (d.col < cols - 1) {
        // Real boundary between column `d.col` and `d.col + 1`. colgroup
        // percentages are relative to the table itself.
        editor.setColumnBoundary(blockIndex, d.col, deltaPctDoArrasto(dx, d.tableWidthPx), d.base);
      } else {
        // Last column's right edge is the table's own outer border —
        // `tableWidth` is relative to the CONTAINER, not the table's own
        // current rendered width (see draggingRef docstring).
        editor.setTableWidth(blockIndex, d.baseTableWidthPct + deltaPctDoArrasto(dx, d.containerWidthPx));
      }
    },
    [blockIndex, cols, editor],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = null;
      setPositions(null);
      // Remede: se a coluna bateu no mínimo, a divisa parou antes do dedo, e
      // a alça precisa voltar para onde a borda REALMENTE está. Sem isto ela
      // fica boiando longe da borda e o arrasto seguinte salta. Chamado só
      // aqui — nunca durante o pointermove (ver docstring do componente).
      measure();
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [measure],
  );

  if (!layout) return null;
  const handleStyle = (x: number): CSSProperties => ({
    position: "absolute",
    top: 0,
    left: `${x - 3}px`,
    width: "6px",
    height: `${layout.height}px`,
    cursor: "col-resize",
    zIndex: 5,
  });

  // Render handles for every column EXCEPT we don't need a left-edge handle
  // (the table's left edge isn't a resizable boundary). Each handle resizes
  // the column whose right edge it sits on.
  void positions;
  return (
    <>
      {layout.rights.map((x, c) => (
        <div
          key={c}
          contentEditable={false}
          className="ed-col-resize-handle"
          style={handleStyle(x)}
          onPointerDown={onPointerDown(c)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label={c === cols - 1 ? "Largura da tabela" : `Redimensionar coluna ${c + 1}`}
          role="separator"
        />
      ))}
    </>
  );
}
