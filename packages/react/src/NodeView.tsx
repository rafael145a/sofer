import { useMemo, useRef, type CSSProperties, type JSX, type ReactNode } from "react";
import {
  answerLineStyle,
  cellBorderStyle,
  normalizarLarguras,
  tableRectSelection,
  type BlockAttrs,
  type CellAttrs,
  type SerializedBlock,
  type StyleRecord,
} from "@sofereditor/core";
import { useEditorContext } from "./EditorContext";
import { renderInline } from "./renderInline";
import { sliceDelta } from "./sliceDelta";
import { TableResizeOverlay } from "./TableResizeOverlay";

export interface NodeViewFragment {
  index: number;
  start: number;
  end: number;
}

interface NodeViewProps {
  block: SerializedBlock;
  index: number;
  /** Optional nested content. Used by `listItem` to host the nested <ol>/<ul>. */
  children?: ReactNode;
  /** Optional fragment slice — when present, the rendered DOM covers only chars [start, end). */
  fragment?: NodeViewFragment;
  /**
   * Optional table-row fragmentation slice for Sub-phase 4.6. When set, only
   * the rows in `[rowStart, rowEnd)` are rendered, and the resize overlay is
   * suppressed except on the FIRST fragment.
   */
  tableFragment?: { index: number; rowStart: number; rowEnd: number };
}

export function NodeView({ block, index, children, fragment, tableFragment }: NodeViewProps): JSX.Element {
  if (block.type === "table") {
    return <TableView block={block} index={index} tableFragment={tableFragment} />;
  }
  const inline = fragment
    ? renderInline(sliceDelta(block.delta, fragment.start, fragment.end), index)
    : renderInline(block.delta, index);
  const common = commonBlockProps(block.attrs, index, block.type, fragment);

  switch (block.type) {
    case "heading": {
      const level = clampLevel(block.attrs.level);
      const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
      return (
        <Tag
          {...common}
          className={`ed-block ed-heading ed-heading-${level}${alignClass(block.attrs.align)}${fragmentClass(fragment)}`}
        >
          {inline}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote
          {...common}
          className={`ed-block ed-blockquote${alignClass(block.attrs.align)}${fragmentClass(fragment)}`}
        >
          {inline}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre
          {...common}
          data-language={block.attrs.language ?? undefined}
          className={`ed-block ed-codeblock${alignClass(block.attrs.align)}`}
        >
          <code>{inline}</code>
        </pre>
      );
    case "listItem": {
      const level = clampListLevel(block.attrs.listLevel);
      return (
        <li
          {...common}
          data-list-kind={block.attrs.listKind ?? "bullet"}
          data-list-level={level}
          className={`ed-block ed-listitem${alignClass(block.attrs.align)}`}
        >
          {inline}
          {children}
        </li>
      );
    }
    case "paragraph":
    default:
      return (
        <div
          {...common}
          className={`ed-block ed-paragraph${alignClass(block.attrs.align)}${fragmentClass(fragment)}`}
        >
          {inline}
        </div>
      );
  }
}

export function commonBlockProps(
  attrs: BlockAttrs,
  index: number,
  type: string,
  fragment: NodeViewFragment | undefined,
) {
  const style: CSSProperties = {};
  if (attrs.align) style.textAlign = attrs.align;
  // Linha de resposta: régua inferior + entrelinha. Vem de um helper puro em
  // core para o HTML de servidor emitir exatamente o mesmo estilo.
  Object.assign(style, answerLineStyle(attrs) ?? {});
  const base: Record<string, unknown> = {
    "data-block-index": index,
    "data-block-type": type,
    dir: attrs.dir,
    style: Object.keys(style).length > 0 ? style : undefined,
  };
  if (!fragment) return base;
  base["data-fragment-index"] = fragment.index;
  base["data-fragment-start"] = fragment.start;
  base["data-fragment-end"] = fragment.end;
  return base;
}

function fragmentClass(f?: NodeViewFragment): string {
  if (!f) return "";
  // First fragment keeps top margin, last keeps bottom; intermediate fragments drop both.
  return ` ed-fragment ed-fragment-${f.index}`;
}

function alignClass(a?: BlockAttrs["align"]): string {
  return a ? ` ed-align-${a}` : "";
}

/**
 * Inline style for a table cell's visual attrs (align, bgColor).
 * Returns undefined when the cell has none, so the <td> carries no style attr.
 */
export function cellStyle(
  attrs?: CellAttrs,
  border?: StyleRecord,
): CSSProperties | undefined {
  const style: CSSProperties = { ...(border as CSSProperties | undefined) };
  if (attrs?.align) style.textAlign = attrs.align;
  if (attrs?.bgColor) style.backgroundColor = attrs.bgColor;
  return Object.keys(style).length > 0 ? style : undefined;
}

function clampLevel(l: BlockAttrs["level"]): 1 | 2 | 3 | 4 | 5 | 6 {
  if (l === 2 || l === 3 || l === 4 || l === 5 || l === 6) return l;
  return 1;
}

function clampListLevel(l: BlockAttrs["listLevel"]): number {
  if (typeof l !== "number" || !Number.isFinite(l)) return 0;
  return Math.max(0, Math.min(5, Math.trunc(l)));
}

interface TableViewProps {
  block: SerializedBlock;
  index: number;
  tableFragment?: { index: number; rowStart: number; rowEnd: number };
}

function TableView({ block, index, tableFragment }: TableViewProps): JSX.Element {
  const rows = clampPositive(block.attrs.rows);
  const cols = clampPositive(block.attrs.cols);
  const cells = block.cells ?? [];
  const widths = normalizarLarguras(block.attrs.colWidths as number[] | undefined, cols);
  const tableWidth = block.attrs.tableWidth;
  const rowHeights = block.attrs.rowHeights as number[] | undefined;
  const tableRef = useRef<HTMLTableElement | null>(null);

  // Row range to render. Default = full table.
  const rowStart = tableFragment?.rowStart ?? 0;
  const rowEnd = tableFragment?.rowEnd ?? rows;
  const isFirstFragment = !tableFragment || tableFragment.index === 0;

  // Recompute the rectangular cell selection each render. Reading the snapshot
  // off `editor.snapshot` ties this to the same render that NodeView is in.
  const editor = useEditorContext();
  const rect = useMemo(() => {
    if (editor.selection.anchor.blockIndex !== index) return null;
    if (editor.selection.focus.blockIndex !== index) return null;
    return tableRectSelection(editor.doc, editor.selection);
  }, [editor.doc, editor.selection, index]);

  return (
    <div className="ed-table-wrap">
      <table
        ref={tableRef}
        data-block-index={index}
        data-block-type="table"
        className="ed-block ed-table"
        style={typeof tableWidth === "number" ? { width: `${tableWidth}%` } : undefined}
      >
        <colgroup>
          {widths.map((w, c) => (
            <col key={c} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <tbody>
        {Array.from({ length: rowEnd - rowStart }, (_, i) => {
          const r = rowStart + i;
          return (
          <tr
            key={r}
            data-cell-row={r}
            // `height` no <tr> é tratado pelo CSS de tabela como MÍNIMO, não
            // fixo — conteúdo maior empurra a linha. Não usar max-height nem
            // overflow: hidden aqui, ou texto some da prova.
            style={
              typeof rowHeights?.[r] === "number"
                ? { height: `${rowHeights[r]}px` }
                : undefined
            }
          >
            {Array.from({ length: cols }, (_, c) => {
              const flat = r * cols + c;
              const cell = cells[flat];
              if (cell?.attrs.covered === true) return null;
              const rowspan = spanAttr(cell?.attrs.rowspan);
              const colspan = spanAttr(cell?.attrs.colspan);
              const delta = cell?.delta ?? [];
              const inRect =
                rect !== null &&
                r >= rect.top && r <= rect.bottom &&
                c >= rect.left && c <= rect.right;
              // Cell align is applied via inline textAlign; block-level align uses ed-align-* classes instead.
              return (
                <td
                  key={c}
                  data-cell-index={flat}
                  data-cell-row={r}
                  data-cell-col={c}
                  data-cell-rowspan={rowspan}
                  data-cell-colspan={colspan}
                  rowSpan={rowspan > 1 ? rowspan : undefined}
                  colSpan={colspan > 1 ? colspan : undefined}
                  style={cellStyle(
                    cell?.attrs,
                    // rowStart/rowEnd são os limites do FRAGMENTO: numa tabela
                    // quebrada entre páginas, cada página fecha a própria caixa.
                    cellBorderStyle(
                      block.attrs.borderPreset,
                      { row: r, col: c, rowspan, colspan, cols, rowStart, rowEnd },
                      "screen",
                      block.attrs.borderColor,
                    ),
                  )}
                  className={inRect ? "ed-cell ed-cell--selected" : "ed-cell"}
                >
                  {renderInline(delta, `t${index}-c${flat}`)}
                </td>
              );
            })}
          </tr>
          );
        })}
        </tbody>
      </table>
      {isFirstFragment && (
        <TableResizeOverlay tableRef={tableRef} blockIndex={index} cols={cols} rows={rows} />
      )}
    </div>
  );
}

function spanAttr(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return 1;
  return Math.trunc(v);
}

function clampPositive(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 1;
  return Math.trunc(n);
}
