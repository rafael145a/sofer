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
import { useEditorContext } from "./EditorContext";

interface Props {
  /** Ref to the underlying `<table>` element. */
  tableRef: RefObject<HTMLTableElement | null>;
  blockIndex: number;
  cols: number;
}

/**
 * Renders absolute-positioned drag handles aligned with each column boundary
 * (except the table's left edge). While dragging, calls the editor's
 * `setColumnWidth` with the live width so the model — and therefore the
 * `<colgroup>` — updates in real time.
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
  const draggingRef = useRef<{ col: number; startX: number; startWidth: number } | null>(null);

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
      const cgCols = table.querySelectorAll<HTMLTableColElement>("colgroup > col");
      const startWidth = cgCols[col]?.getBoundingClientRect().width ?? 100;
      draggingRef.current = { col, startX: e.clientX, startWidth };
      setPositions({ x: e.clientX, height: layout?.height ?? 0 });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [layout, tableRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = draggingRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const next = Math.max(40, d.startWidth + dx);
      editor.setColumnWidth(blockIndex, d.col, next);
    },
    [blockIndex, editor],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = null;
    setPositions(null);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

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
          aria-label={`Redimensionar coluna ${c + 1}`}
          role="separator"
        />
      ))}
    </>
  );
}
