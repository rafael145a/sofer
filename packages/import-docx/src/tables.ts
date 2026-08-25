import type {
  BlockAttrs,
  CellAttrs,
  DeltaOp,
  ListKind,
  SerializedBlock,
  SerializedCell,
  TableBorderPreset,
} from "@sofereditor/core";
import {
  MIN_LINHA_PX,
  mmToPx,
  normalizarLarguras,
  travaLarguraTabela,
} from "@sofereditor/core";
import {
  attr,
  borderSideOn,
  childrenOf,
  findChild,
  findChildren,
  tagOf,
  type OoxmlNode,
} from "./parse-xml";
import type { NumberingResolver } from "./numbering";
import { paragraphChildrenToDelta, type RunContext } from "./runs";
import { docxHexToCssColor, parseIntAttr, twipToMillimeters } from "./units";

/**
 * Map a `<w:tbl>` element to a SerializedBlock(table). The output `cells` array
 * is row-major with `rows * cols` entries — covered slots are filled with
 * `{attrs: {covered: true}}` placeholders so it matches the invariant required
 * by `@sofereditor/core`'s `EditorDocument`.
 *
 * `larguraUtilTwips` (largura útil da PÁGINA, de `w:sectPr`, lida uma vez em
 * `docxBlobToDocument`) é o que permite reconstruir `tableWidth` a partir de
 * `w:tblW` — sem ela, uma tabela exportada com 50% de largura reimportaria
 * como 100%, porque `normalizarLarguras` só recupera a proporção ENTRE
 * colunas, nunca a largura total da tabela contra a página.
 */
export function tableToBlock(
  tbl: OoxmlNode,
  ctx: RunContext,
  larguraUtilTwips: number | undefined,
  numbering: NumberingResolver,
): SerializedBlock {
  const tblGrid = findChild(tbl, "w:tblGrid");
  const gridCols = tblGrid ? findChildren(tblGrid, "w:gridCol") : [];
  const trs = findChildren(tbl, "w:tr");

  // The docx writer (and Word itself) may emit fewer `<w:gridCol>` entries than
  // the table's logical column count when a row has merged cells. Take the max
  // of (declared gridCols, widest row's total gridSpan) to stay robust.
  let cols = gridCols.length;
  for (const tr of trs) {
    const tcs = findChildren(tr, "w:tc");
    let count = 0;
    for (const tc of tcs) count += gridSpanOf(tc);
    if (count > cols) cols = count;
  }
  if (cols < 1) cols = 1;
  const rows = trs.length;

  // Build a row-major grid of slots. Each slot is either a real cell or marked
  // as covered. We track which (row, col) is the anchor for vMerge groups.
  const slots: Array<SerializedCell | null> = new Array(rows * cols).fill(null);
  // Anchor of the active vMerge per column index; resets when a non-merge cell
  // is placed in the same column.
  const vMergeAnchorByCol = new Map<number, { row: number; col: number }>();

  for (let r = 0; r < rows; r++) {
    const tr = trs[r];
    let cursor = 0;
    for (const tc of findChildren(tr, "w:tc")) {
      // Advance the cursor past already-occupied (covered-from-above) slots.
      while (cursor < cols && slots[r * cols + cursor] !== null) cursor++;
      if (cursor >= cols) break;

      const tcPr = findChild(tc, "w:tcPr");
      const gridSpan = gridSpanOf(tc);
      const vMergeNode = tcPr ? findChild(tcPr, "w:vMerge") : undefined;
      const vMergeVal = vMergeNode ? (attr(vMergeNode, "w:val") ?? "continue") : null;

      if (vMergeNode && vMergeVal !== "restart") {
        // Continuation of a vertical merge. Cover this row, and bump the anchor's
        // rowspan if we can find it.
        const anchor = vMergeAnchorByCol.get(cursor);
        if (anchor) {
          const anchorIdx = anchor.row * cols + anchor.col;
          const a = slots[anchorIdx];
          if (a) {
            a.attrs = { ...(a.attrs ?? {}), rowspan: (a.attrs?.rowspan ?? 1) + 1 };
          }
        }
        for (let c = 0; c < gridSpan && cursor + c < cols; c++) {
          slots[r * cols + cursor + c] = coveredCell();
        }
        cursor += gridSpan;
        continue;
      }

      // Real cell: build its delta + attrs.
      const { delta, listKind } = cellChildrenToDelta(tc, ctx, numbering);
      const text = textOfDelta(delta);
      const cellAttrs: CellAttrs = {};
      if (listKind) cellAttrs.listKind = listKind;
      if (gridSpan > 1) cellAttrs.colspan = gridSpan;
      // rowspan starts at 1 — vMerge continuations bump it.

      const realCell: SerializedCell = { text, delta, attrs: cellAttrs };
      slots[r * cols + cursor] = realCell;

      // Mark horizontally-covered slots from gridSpan.
      for (let c = 1; c < gridSpan && cursor + c < cols; c++) {
        slots[r * cols + cursor + c] = coveredCell();
      }

      if (vMergeVal === "restart") {
        vMergeAnchorByCol.set(cursor, { row: r, col: cursor });
      } else {
        vMergeAnchorByCol.delete(cursor);
      }
      cursor += gridSpan;
    }

    // Fill any trailing un-touched slots in this row with empty placeholders so
    // the row-major invariant holds (length = rows * cols).
    for (let c = 0; c < cols; c++) {
      if (slots[r * cols + c] === null) {
        slots[r * cols + c] = emptyCell();
      }
    }
  }

  const cells: SerializedCell[] = slots.map((s) => s ?? emptyCell());

  const attrs: BlockAttrs = { rows, cols };
  const preset = readBorderPreset(tbl);
  if (preset) attrs.borderPreset = preset;
  const borderColor = readBorderColor(tbl);
  if (borderColor) attrs.borderColor = borderColor;
  // `w:gridCol` chega em twips absolutos; `normalizarLarguras` converte para
  // proporção somando 100 — a mesma conta usada para normalizar documentos
  // antigos em px, então não duplicamos a lógica aqui. Quando faltam gridCols
  // (ou o número não bate com `cols`), o próprio helper cai no split igual, o
  // que é idêntico a omitir o atributo — gravá-lo de qualquer forma é
  // inofensivo.
  const twips = gridCols.map((g) => Number(attr(g, "w:w") ?? 0));
  attrs.colWidths = normalizarLarguras(twips, cols);
  const rowHeights = readRowHeights(trs);
  if (rowHeights) attrs.rowHeights = rowHeights;
  const tableWidth = readTableWidth(tbl, larguraUtilTwips);
  if (tableWidth !== undefined) attrs.tableWidth = tableWidth;
  return { type: "table", text: "", delta: [], attrs, cells };
}

/**
 * Lê `w:w`, que no OOXML é `ST_MeasurementOrPercent`: pode vir como número
 * puro OU com sufixo `%` ("50%"). `Number("50%")` é `NaN`, e sem tratar isso
 * a largura era descartada em silêncio e a tabela voltava com 100%.
 */
function leMedida(bruto: string | undefined): { valor: number; ehPercentSufixo: boolean } | undefined {
  if (bruto === undefined) return undefined;
  const t = bruto.trim();
  const comSufixo = t.endsWith("%");
  const n = Number(comSufixo ? t.slice(0, -1) : t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return { valor: n, ehPercentSufixo: comSufixo };
}

/**
 * `w:tblW` → percentual da largura útil da página (`tableWidth`).
 *
 * Dois tipos possíveis: `dxa` (twips absolutos — divide contra
 * `larguraUtilTwips`, a MESMA conta que `export-docx` fez ao contrário) e
 * `pct` (já percentual, só que em quinquagésimos — `5000` = 100%). Qualquer
 * outra coisa (ausente, `auto`, `larguraUtilTwips` desconhecida) devolve
 * `undefined` e o bloco fica sem `tableWidth` — que é exatamente o default
 * (100%) do modelo, então omitir é seguro.
 */
function readTableWidth(tbl: OoxmlNode, larguraUtilTwips: number | undefined): number | undefined {
  const tblPr = findChild(tbl, "w:tblPr");
  const tblW = tblPr ? findChild(tblPr, "w:tblW") : undefined;
  if (!tblW) return undefined;
  const medida = leMedida(attr(tblW, "w:w"));
  if (!medida) return undefined;
  const type = attr(tblW, "w:type");

  // O Word aceita tabela mais larga que a página; o editor não. `travaLarguraTabela`
  // é a MESMA faixa que `setTableWidth` usa, importada do core de propósito —
  // duas travas separadas divergiriam, e foi medido o que acontece sem ela:
  // `w:tblW` de 7500 pct entrava como 150%, a tabela era cortada pelo
  // `overflow: hidden` da página e a última coluna sumia da tela E do papel.
  // Um `9639 dxa` entrava como 113% e invadia 80 dos 96px de margem, parando
  // a 17px da borda do papel — dentro da faixa que impressora não imprime.
  if (medida.ehPercentSufixo) return travaLarguraTabela(arredondaPct(medida.valor));
  if (type === "pct") return travaLarguraTabela(arredondaPct(medida.valor / 50));
  if (type === "dxa" || type === undefined) {
    if (larguraUtilTwips === undefined || larguraUtilTwips <= 0) return undefined;
    return travaLarguraTabela(arredondaPct((medida.valor / larguraUtilTwips) * 100));
  }
  return undefined;
}

function arredondaPct(pct: number): number {
  return Math.round(pct * 100) / 100;
}

/**
 * `w:trHeight` por linha, convertido de twips para px (o editor guarda
 * altura em px). Devolve `undefined` quando NENHUMA linha declara altura —
 * gravar um array cheio de `undefined`/0 faria uma tabela importada sem
 * altura nascer "congelada" no mínimo, quando ela deveria crescer livremente
 * com o conteúdo (mesmo comportamento de hoje, sem `rowHeights`).
 */
function readRowHeights(trs: OoxmlNode[]): number[] | undefined {
  const heights = trs.map((tr) => {
    const trPr = findChild(tr, "w:trPr");
    const trHeight = trPr ? findChild(trPr, "w:trHeight") : undefined;
    const val = trHeight ? Number(attr(trHeight, "w:val") ?? "") : NaN;
    return Number.isFinite(val) && val > 0 ? mmToPx(twipToMillimeters(val)) : undefined;
  });
  if (heights.every((h) => h === undefined)) return undefined;
  // Ao menos uma linha declarou altura — as que não declararam ficam no
  // mínimo do modelo (MIN_LINHA_PX), não em 0: é o mesmo "sem restrição
  // real" que a linha já tem hoje sem `rowHeights`, só que representável
  // dentro do array sem inventar um valor arbitrário.
  return heights.map((h) => h ?? MIN_LINHA_PX);
}

/**
 * Reduz `w:tblBorders` ao preset mais próximo.
 *
 * O modelo não tem borda por célula, então `w:tcBorders` continua ignorado —
 * deliberadamente. Combinação não mapeável cai em `all`, que é o padrão visual
 * e o comportamento menos surpreendente para quem importa um documento externo.
 *
 * Retorna `undefined` quando a tabela não declara `tblBorders`, para não gravar
 * a chave à toa.
 */
/**
 * Cor da grade, lida do PRIMEIRO lado LIGADO do `w:tblBorders`.
 *
 * Lados desligados são ignorados de propósito: o Word emite `w:val="none"` com
 * `w:color="auto"`, que não carrega informação de cor — ler dali gravaria lixo.
 * `auto` também não grava, para o documento cair no default do modelo.
 */
function readBorderColor(tbl: OoxmlNode): string | undefined {
  const tblPr = findChild(tbl, "w:tblPr");
  const b = tblPr ? findChild(tblPr, "w:tblBorders") : undefined;
  if (!b) return undefined;
  const LADOS = [
    "w:top",
    "w:bottom",
    "w:left",
    "w:start",
    "w:right",
    "w:end",
    "w:insideH",
    "w:insideV",
  ];
  for (const nome of LADOS) {
    const n = findChild(b, nome);
    if (!n) continue;
    const val = (attr(n, "w:val") ?? "").toLowerCase();
    if (val === "" || val === "none" || val === "nil") continue;
    const hex = attr(n, "w:color");
    if (!hex || hex.toLowerCase() === "auto") continue;
    const css = docxHexToCssColor(hex);
    if (css) return css;
  }
  return undefined;
}

function readBorderPreset(tbl: OoxmlNode): TableBorderPreset | undefined {
  const tblPr = findChild(tbl, "w:tblPr");
  const b = tblPr ? findChild(tblPr, "w:tblBorders") : undefined;
  if (!b) return undefined;

  // `borderSideOn` trata os nomes alternativos do OOXML estrito (start/end) e
  // ignora lados declarados como "none"/"nil".
  const ligado = (...nomes: string[]): boolean => borderSideOn(b, ...nomes);

  const top = ligado("w:top");
  const bottom = ligado("w:bottom");
  const left = ligado("w:left", "w:start");
  const right = ligado("w:right", "w:end");
  const iH = ligado("w:insideH");
  const iV = ligado("w:insideV");

  if (top && bottom && left && right && iH && iV) return "all";
  if (top && bottom && left && right && !iH && !iV) return "outer";
  if (top && bottom && !left && !right && iH && !iV) return "horizontal";
  if (!top && !bottom && left && right && !iH && iV) return "vertical";
  if (!top && !bottom && !left && !right && !iH && !iV) return "none";
  return "all";
}

function gridSpanOf(tc: OoxmlNode): number {
  const tcPr = findChild(tc, "w:tcPr");
  if (!tcPr) return 1;
  const gs = findChild(tcPr, "w:gridSpan");
  if (!gs) return 1;
  const n = parseIntAttr(attr(gs, "w:val"), 1);
  return Math.max(1, n);
}

/**
 * Delta da célula + o tipo de lista, se os parágrafos dela vierem numerados.
 *
 * A célula no modelo é um único `Y.Text`, então achatamos os `<w:p>` com `\n`
 * entre eles. Quando ALGUM parágrafo traz `<w:numPr>`, a célula inteira vira
 * lista: cada linha passa a ser um item. Célula mista (alguns com marcador,
 * outros sem) vira lista inteira — é o menos surpreendente, e prova real não
 * mistura.
 *
 * O `listLevel` do Word é descartado de propósito: `CellAttrs` não tem nível
 * (`Y.Text` plano não guarda atributo por linha). Aninhamento dentro de célula
 * exigiria blocos de verdade — ver o spec de 2026-08-24.
 *
 * `numbering.resolve()` MUTA o contador de ordinais para listas ordenadas
 * (`numbering.ts:113-116`). Chamamos mesmo assim, e de propósito: o Word também
 * conta os parágrafos numerados de dentro da tabela, então não chamar
 * dessincronizaria a numeração dos itens que vêm depois dela.
 */
function cellChildrenToDelta(
  tc: OoxmlNode,
  ctx: RunContext,
  numbering: NumberingResolver,
): { delta: DeltaOp[]; listKind?: ListKind } {
  const out: DeltaOp[] = [];
  let listKind: ListKind | undefined;
  let first = true;
  for (const child of childrenOf(tc)) {
    if (tagOf(child) !== "w:p") continue;
    if (!first) out.push({ insert: "\n" });
    first = false;
    const pPr = findChild(child, "w:pPr");
    const numPr = pPr ? findChild(pPr, "w:numPr") : undefined;
    const resolvido = numbering.resolve(numPr);
    if (resolvido && !listKind) listKind = resolvido.listKind;
    out.push(...paragraphChildrenToDelta(childrenOf(child), ctx));
  }
  return { delta: out, listKind };
}

function textOfDelta(delta: DeltaOp[]): string {
  let out = "";
  for (const op of delta) {
    if (typeof op.insert === "string") out += op.insert;
  }
  return out;
}

function coveredCell(): SerializedCell {
  return { text: "", delta: [], attrs: { covered: true } };
}

function emptyCell(): SerializedCell {
  return { text: "", delta: [], attrs: {} };
}
