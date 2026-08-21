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
import { MIN_LINHA_PX, normalizarLarguras } from "@sofereditor/core";
import { useEditorContext } from "./EditorContext";

interface Props {
  /** Ref to the underlying `<table>` element. */
  tableRef: RefObject<HTMLTableElement | null>;
  blockIndex: number;
  cols: number;
  rows: number;
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
 * Divide `deltaPx` em partes IGUAIS (não proporcionais) entre as linhas de
 * `base` — é o que faz a alça da base da tabela preservar uma linha que o
 * professor deixou alta de propósito, em vez de ela crescer/encolher mais
 * que as outras. Cada resultado passa pelo mesmo piso de `setRowHeight`
 * (`MIN_LINHA_PX`), então encolher demais nunca estoura para negativo — a
 * conta simplesmente para no piso.
 *
 * Pura e sem DOM: é o coração da alça de "altura total" e do braço vertical
 * da alça de canto, testável sem montar o editor.
 */
export function distribuirAltura(base: number[], deltaPx: number): number[] {
  if (base.length === 0) return base;
  const fatia = deltaPx / base.length;
  return base.map((h) => Math.max(MIN_LINHA_PX, Math.round(h + fatia)));
}

/**
 * Estado de arrasto — um só ref, discriminado por `tipo`, para as cinco
 * famílias de alça (divisa de coluna, largura total, divisa de linha, altura
 * total, canto). Em TODOS os ramos o delta do `onPointerMove` é calculado
 * contra o que foi lido aqui no `pointerdown`, nunca contra o modelo/DOM
 * corrente — é a regra que mata o emborrachado (ver `deltaPctDoArrasto` e o
 * brief da Task 3 para a medição do defeito original na coluna).
 */
type Arrasto =
  | { tipo: "coluna"; boundary: number; startX: number; baseWidths: number[]; tableWidthPx: number }
  | { tipo: "larguraTotal"; startX: number; baseWidthPct: number; utilPx: number }
  | { tipo: "linha"; row: number; startY: number; baseHeightPx: number }
  | { tipo: "alturaTotal"; startY: number; baseHeights: number[] }
  | {
      tipo: "canto";
      startX: number;
      startY: number;
      baseWidthPct: number;
      utilPx: number;
      baseHeights: number[];
    };

/**
 * Renders absolute-positioned drag handles for every resizable boundary of a
 * table: column divisas, the table's own right edge (width), row divisas,
 * the table's own bottom edge (height, distributed evenly across rows via
 * `distribuirAltura`), and a corner handle that drives both axes at once.
 *
 * O delta é sempre calculado contra o estado do MODELO (ou, para linhas, do
 * DOM RENDERIZADO — ver nota abaixo) lido uma única vez no `pointerdown`,
 * nunca contra o corrente: acumular contra o DOM/modelo corrente é o que
 * produzia o salto elástico que a Task 3 matou para colunas, e o mesmo vale
 * aqui para as outras quatro famílias.
 *
 * Altura de linha é MÍNIMO, não largura — por isso a base de uma alça de
 * linha/altura-total/canto é lida do LAYOUT MEDIDO (`layout.bottoms`), não
 * do atributo do modelo: se o modelo não tem `rowHeights` (ou tem um mínimo
 * menor que o conteúdo), o `<tr>` renderiza mais alto que o mínimo gravado, e
 * ancorar no mínimo faria o arrasto de CRESCER ter uma "zona morta" antes de
 * a borda começar a se mexer. Ancorar no renderizado faz crescer colar no
 * dedo desde o primeiro pixel — e faz ENCOLHER abaixo do conteúdo gravar o
 * valor sem mover o desenho, que é exatamente o comportamento esperado (ver
 * `onPointerUp`/`measure` abaixo).
 *
 * No `pointerup` a alça reancora via `measure()` — aqui isso importa MAIS do
 * que na coluna: como altura é mínimo, arrastar a base para cima do que o
 * conteúdo permite grava o valor mas NÃO move o desenho, e a alça (se não
 * reancorada) ficaria flutuando onde o dedo soltou, longe da borda real.
 * `measure()` NÃO é chamado durante o `pointermove` — chamá-lo ali voltaria
 * a ler o renderizado a cada quadro e reintroduziria o defeito por outro
 * caminho, agora nas linhas.
 *
 * Lives as a sibling of the `<table>` inside a `position: relative` wrapper.
 * Handles are `contentEditable={false}` so they don't interfere with caret
 * placement inside cells.
 */
export function TableResizeOverlay({ tableRef, blockIndex, cols, rows }: Props): JSX.Element | null {
  const editor = useEditorContext();
  // Handle positions (column rights, row bottoms, in px relative to the
  // table's own top-left) and the table's own rendered box. Recomputed after
  // every layout via `measure()`.
  const [layout, setLayout] = useState<{
    rights: number[];
    bottoms: number[];
    width: number;
    height: number;
  } | null>(null);
  const arrastoRef = useRef<Arrasto | null>(null);

  type Layout = { rights: number[]; bottoms: number[]; width: number; height: number };

  /**
   * Mede column right-edges e row bottom-edges relativos ao canto
   * superior-esquerdo da própria tabela — SEMPRE contra o DOM corrente, sem
   * depender do estado `layout` (que só é atualizado quando `measure()`
   * decide chamar `setLayout`, ou seja, pode estar um `ResizeObserver` atrás
   * do real). Usada tanto por `measure()` (pra atualizar o estado usado no
   * posicionamento visual das alças) quanto pelos `pointerdown` de
   * linha/altura-total/canto (pra garantir que `baseHeightPx`/`baseHeights`
   * nunca partam de uma medição velha).
   */
  const measureNow = useCallback((): Layout | null => {
    const table = tableRef.current;
    if (!table) return null;
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
      // Column shape mismatch — bail out rather than place handles in wrong spots.
      return null;
    }
    // Row bottoms — same accumulating approach, via each `<tr>`'s rendered
    // height. Rows stack directly under the table's top edge (no <thead>
    // here), so the accumulation starts at 0 exactly like the column rights
    // above.
    const trs = table.querySelectorAll<HTMLTableRowElement>("tbody > tr");
    const bottoms: number[] = [];
    let accY = 0;
    trs.forEach((tr) => {
      accY += tr.getBoundingClientRect().height;
      bottoms.push(accY);
    });
    // Row/height handles only make sense when this DOM covers the WHOLE
    // table. A table split across pages renders only the first fragment's
    // rows here (`isFirstFragment` in NodeView) — `trs.length < rows` in
    // that case. Rather than null out the entire overlay (which would also
    // kill the still-valid column handles), just suppress the row-based
    // handles: `bottoms` stays empty and callers skip them.
    return {
      rights,
      bottoms: trs.length === rows ? bottoms : [],
      width: tableRect.width,
      height: tableRect.height,
    };
  }, [cols, rows, tableRef]);

  const measure = useCallback(() => {
    setLayout(measureNow());
  }, [measureNow]);

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

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      arrastoRef.current = null;
      // Remede: reancora a alça na borda REAL (renderizada). Necessário
      // sempre que o arrasto pode ter batido num piso antes do dedo — coluna
      // no MIN_COLUNA_PCT, linha no MIN_LINHA_PX ou no próprio conteúdo (que
      // não tem "mínimo" nenhum pra bater, mas também não obedece um mínimo
      // MENOR que ele mesmo). Chamado só aqui — nunca durante o pointermove
      // (ver docstring do componente).
      measure();
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [measure],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = arrastoRef.current;
      if (!d) return;
      switch (d.tipo) {
        case "coluna": {
          const dPct = deltaPctDoArrasto(e.clientX - d.startX, d.tableWidthPx);
          editor.setColumnBoundary(blockIndex, d.boundary, dPct, d.baseWidths);
          break;
        }
        case "larguraTotal": {
          const dPct = deltaPctDoArrasto(e.clientX - d.startX, d.utilPx);
          editor.setTableWidth(blockIndex, d.baseWidthPct + dPct);
          break;
        }
        case "linha": {
          editor.setRowHeight(blockIndex, d.row, d.baseHeightPx + (e.clientY - d.startY));
          break;
        }
        case "alturaTotal": {
          editor.setRowHeights(blockIndex, distribuirAltura(d.baseHeights, e.clientY - d.startY));
          break;
        }
        case "canto": {
          const dPct = deltaPctDoArrasto(e.clientX - d.startX, d.utilPx);
          editor.setTableWidth(blockIndex, d.baseWidthPct + dPct);
          editor.setRowHeights(blockIndex, distribuirAltura(d.baseHeights, e.clientY - d.startY));
          break;
        }
      }
    },
    [blockIndex, editor],
  );

  // `.ed-table-wrap` is always the table's parent (see TableView) and is the
  // containing block the inline `width:X%` style resolves against.
  const containerWidthPxOf = useCallback((table: HTMLTableElement, tableWidthPx: number): number => {
    return table.parentElement?.getBoundingClientRect().width || tableWidthPx;
  }, []);

  const onColumnPointerDown = useCallback(
    (boundary: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      // Prevent the editor from losing focus / caret being placed on the handle.
      e.preventDefault();
      e.stopPropagation();
      const table = tableRef.current;
      if (!table) return;
      const tableWidthPx = table.getBoundingClientRect().width || 1;
      const attrs = editor.doc.getBlockAttrs(blockIndex);
      const baseWidths = normalizarLarguras(attrs.colWidths as number[] | undefined, cols);
      arrastoRef.current = { tipo: "coluna", boundary, startX: e.clientX, baseWidths, tableWidthPx };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [tableRef, editor, blockIndex, cols],
  );

  const onTableWidthPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const table = tableRef.current;
      if (!table) return;
      const tableWidthPx = table.getBoundingClientRect().width || 1;
      // `<table style="width:X%">` is a percentage of `.ed-table-wrap`
      // (which has no width of its own and simply fills the page column),
      // NOT of the table's own current width. Whenever `baseWidthPct !== 100`
      // those two differ, and using `tableWidthPx` there overshoots by a
      // factor of `100 / baseWidthPct` — invisible on a fresh 100%-wide
      // table, but a second drag of the right edge after a resize reproduces
      // the exact rubber-banding Task 3 killed, just on the outer edge.
      const utilPx = containerWidthPxOf(table, tableWidthPx);
      const attrs = editor.doc.getBlockAttrs(blockIndex);
      const baseWidthPct = typeof attrs.tableWidth === "number" ? attrs.tableWidth : 100;
      arrastoRef.current = { tipo: "larguraTotal", startX: e.clientX, baseWidthPct, utilPx };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [tableRef, editor, blockIndex, containerWidthPxOf],
  );

  // Converte um array acumulado de bottoms em alturas por-linha.
  const heightsFromBottoms = (bottoms: number[]): number[] =>
    bottoms.map((b, i) => b - (i === 0 ? 0 : bottoms[i - 1]!));

  const onRowPointerDown = useCallback(
    (row: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      // Medição FRESCA, não o estado `layout` — que só é atualizado quando o
      // `ResizeObserver` dispara (assíncrono) e pode estar um frame atrás de
      // uma edição de conteúdo que acabou de mudar a altura desta linha.
      const m = measureNow();
      if (!m || m.bottoms.length === 0) return;
      const baseHeightPx = m.bottoms[row]! - (row === 0 ? 0 : m.bottoms[row - 1]!);
      arrastoRef.current = { tipo: "linha", row, startY: e.clientY, baseHeightPx };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [measureNow],
  );

  const onTableHeightPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const m = measureNow();
      if (!m || m.bottoms.length === 0) return;
      arrastoRef.current = { tipo: "alturaTotal", startY: e.clientY, baseHeights: heightsFromBottoms(m.bottoms) };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [measureNow],
  );

  const onCornerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const table = tableRef.current;
      const m = measureNow();
      if (!table || !m) return;
      const tableWidthPx = table.getBoundingClientRect().width || 1;
      const utilPx = containerWidthPxOf(table, tableWidthPx);
      const attrs = editor.doc.getBlockAttrs(blockIndex);
      const baseWidthPct = typeof attrs.tableWidth === "number" ? attrs.tableWidth : 100;
      arrastoRef.current = {
        tipo: "canto",
        startX: e.clientX,
        startY: e.clientY,
        baseWidthPct,
        utilPx,
        baseHeights: heightsFromBottoms(m.bottoms),
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [tableRef, editor, blockIndex, measureNow, containerWidthPxOf],
  );

  if (!layout) return null;

  const colHandleStyle = (x: number): CSSProperties => ({
    position: "absolute",
    top: 0,
    left: `${x - 3}px`,
    width: "6px",
    height: `${layout.height}px`,
    cursor: "col-resize",
    zIndex: 5,
  });
  const rowHandleStyle = (y: number): CSSProperties => ({
    position: "absolute",
    left: 0,
    top: `${y - 3}px`,
    width: `${layout.width}px`,
    height: "6px",
    cursor: "row-resize",
    zIndex: 5,
  });
  const cornerHandleStyle: CSSProperties = {
    position: "absolute",
    left: `${layout.width - 5}px`,
    top: `${layout.height - 5}px`,
    width: "10px",
    height: "10px",
    cursor: "nwse-resize",
    zIndex: 6,
  };

  return (
    <>
      {/* Column divisas + the table's own right edge (width). */}
      {layout.rights.map((x, c) =>
        c < cols - 1 ? (
          <div
            key={`col-${c}`}
            contentEditable={false}
            className="ed-col-resize-handle"
            style={colHandleStyle(x)}
            onPointerDown={onColumnPointerDown(c)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label={`Redimensionar coluna ${c + 1}`}
            role="separator"
          />
        ) : (
          <div
            key="col-total"
            contentEditable={false}
            className="ed-col-resize-handle"
            style={colHandleStyle(x)}
            onPointerDown={onTableWidthPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label="Largura da tabela"
            role="separator"
          />
        ),
      )}
      {/* Row divisas + the table's own bottom edge (height). */}
      {layout.bottoms.map((y, r) =>
        r < rows - 1 ? (
          <div
            key={`row-${r}`}
            contentEditable={false}
            className="ed-row-resize-handle"
            style={rowHandleStyle(y)}
            onPointerDown={onRowPointerDown(r)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label={`Redimensionar linha ${r + 1}`}
            role="separator"
          />
        ) : (
          <div
            key="row-total"
            contentEditable={false}
            className="ed-row-resize-handle"
            style={rowHandleStyle(y)}
            onPointerDown={onTableHeightPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            aria-label="Altura da tabela"
            role="separator"
          />
        ),
      )}
      {/* Corner: drives width + height at once. */}
      <div
        contentEditable={false}
        className="ed-table-corner-handle"
        style={cornerHandleStyle}
        onPointerDown={onCornerPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Redimensionar tabela"
        role="separator"
      />
    </>
  );
}
