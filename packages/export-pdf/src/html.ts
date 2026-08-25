import type {
  AlignValue,
  BlockAttrs,
  DeltaOp,
  DirValue,
  ImageEmbed,
  LegacySerializedDocument,
  ListKind,
  MarkAttrs,
  PageSettings,
  SerializedBlock,
  SerializedCell,
  SerializedDocument,
} from "@sofereditor/core";
import {
  BLANK_STYLE,
  answerLineStyle,
  cellBorderStyle,
  isImageEmbed,
  isLegacySerializedDocument,
  normalizarLarguras,
  pxToMm,
  splitDeltaByLines,
  splitUnderscoreRuns,
  styleToCssText,
  type CellBorderPos,
  type StyleRecord,
} from "@sofereditor/core";

function normalize(doc: SerializedDocument | LegacySerializedDocument): SerializedDocument {
  return isLegacySerializedDocument(doc) ? { blocks: doc } : doc;
}

export interface DocumentToHtmlOptions {
  /** Document title (set on `<title>` and used as the file name hint). Default "Documento". */
  title?: string;
  /** When true (default) emits a full `<html>` document. When false emits only the body fragment. */
  standalone?: boolean;
  /** Extra CSS appended after the default print stylesheet. Only honored when `standalone`. */
  extraCss?: string;
  /** Page geometry hints injected into `@page`. Defaults to A4. */
  page?: {
    width: string;
    height: string;
    marginTop: string;
    marginBottom: string;
    marginLeft: string;
    marginRight: string;
  };
}

const DEFAULT_PAGE = {
  width: "210mm",
  height: "297mm",
  marginTop: "25mm",
  marginBottom: "25mm",
  marginLeft: "25mm",
  marginRight: "25mm",
};

/**
 * Serialize a `SerializedDocument` to standalone HTML.
 *
 * Output structure mirrors what `@sofereditor/react` paints at runtime: each
 * top-level block becomes one element (`<p>`, `<h1..6>`, `<blockquote>`, `<pre>`,
 * `<table>`), consecutive `listItem` blocks are reconstructed into nested
 * `<ul>`/`<ol>` trees, and image embeds are emitted as `<img>` tags carrying the
 * embed's data URL (so the export is self-contained).
 *
 * NOT a fragment of the live editor DOM — this walks the model so the output is
 * editor-state agnostic (no caret artifacts, no zero-width phantom anchors).
 */
export function documentToHtml(
  doc: SerializedDocument | LegacySerializedDocument,
  options: DocumentToHtmlOptions = {},
): string {
  const normalized = normalize(doc);
  const body = documentToHtmlFragment(normalized);
  if (options.standalone === false) return body;
  const page = options.page ?? pageFromSettings(normalized.pageSettings);
  const title = escapeHtml(options.title ?? "Documento");
  const extra = options.extraCss ?? "";
  return [
    "<!doctype html>",
    `<html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>`,
    `<style>${baseStylesheet(page)}${extra}</style>`,
    "</head><body>",
    body,
    "</body></html>",
  ].join("");
}

function pageFromSettings(s: PageSettings | undefined): NonNullable<DocumentToHtmlOptions["page"]> {
  if (!s) return DEFAULT_PAGE;
  const fmt = (px: number) => `${pxToMm(px).toFixed(2)}mm`;
  return {
    width: fmt(s.width),
    height: fmt(s.height),
    marginTop: fmt(s.marginTop),
    marginBottom: fmt(s.marginBottom),
    marginLeft: fmt(s.marginLeft),
    marginRight: fmt(s.marginRight),
  };
}

/** Body-only HTML for embedding in other documents. */
export function documentToHtmlFragment(
  doc: SerializedDocument | LegacySerializedDocument,
): string {
  const blocks = normalize(doc).blocks;
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "listItem") {
      const groupStart = i;
      const kind: ListKind = block.attrs.listKind === "ordered" ? "ordered" : "bullet";
      const items: SerializedBlock[] = [];
      while (
        i < blocks.length &&
        blocks[i].type === "listItem" &&
        (blocks[i].attrs.listKind ?? "bullet") === kind
      ) {
        items.push(blocks[i]);
        i++;
      }
      out.push(renderListGroup(items, kind, groupStart));
      continue;
    }
    out.push(renderBlock(block, i));
    i++;
  }
  return out.join("");
}

/** JSON export — a stable serialization for save/load round-trips. */
export function documentToJson(
  doc: SerializedDocument | LegacySerializedDocument,
  pretty = true,
): string {
  return JSON.stringify(normalize(doc), null, pretty ? 2 : 0);
}

// ---------- blocks ----------

function renderBlock(block: SerializedBlock, index: number): string {
  switch (block.type) {
    case "paragraph":
      return `<p${blockAttrs("ed-paragraph", block.attrs)}>${renderInline(block.delta)}</p>`;
    case "heading": {
      const level = clampHeadingLevel(block.attrs.level);
      return `<h${level}${blockAttrs(`ed-heading ed-heading-${level}`, block.attrs)}>${renderInline(
        block.delta,
      )}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote${blockAttrs("ed-blockquote", block.attrs)}>${renderInline(
        block.delta,
      )}</blockquote>`;
    case "codeBlock": {
      const lang = block.attrs.language;
      const codeAttrs = lang ? ` class="language-${escapeAttr(lang)}"` : "";
      return `<pre${blockAttrs("ed-codeblock", block.attrs)}><code${codeAttrs}>${renderInline(
        block.delta,
      )}</code></pre>`;
    }
    case "table":
      return renderTable(block);
    default:
      return `<p${blockAttrs("ed-paragraph", block.attrs)}>${renderInline(block.delta)}</p>`;
  }
}

function renderListGroup(items: SerializedBlock[], kind: ListKind, key: number): string {
  // Tree-build using listLevel just like Editor.buildListTree.
  interface Node { item: SerializedBlock; children: Node[]; }
  const roots: Node[] = [];
  const stack: { children: Node[]; level: number }[] = [{ children: roots, level: -1 }];
  for (const it of items) {
    const level = clampListLevel(it.attrs.listLevel);
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node: Node = { item: it, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ children: node.children, level });
  }
  return renderListTree(roots, kind, `list-${key}`);
}

function renderListTree(nodes: { item: SerializedBlock; children: any[] }[], kind: ListKind, _key: string): string {
  const Tag = kind === "ordered" ? "ol" : "ul";
  const cls = `ed-list ed-list-${kind}`;
  const items = nodes
    .map((n) => {
      const inner = renderInline(n.item.delta);
      const nested =
        n.children.length > 0 ? renderListTree(n.children, kind, _key + "n") : "";
      return `<li${blockAttrs("ed-listitem", n.item.attrs)}>${inner}${nested}</li>`;
    })
    .join("");
  return `<${Tag} class="${cls}" data-list-kind="${kind}">${items}</${Tag}>`;
}

function renderTable(block: SerializedBlock): string {
  const rows = typeof block.attrs.rows === "number" ? block.attrs.rows : 0;
  const cols = typeof block.attrs.cols === "number" ? block.attrs.cols : 0;
  const cells = block.cells ?? [];
  if (rows <= 0 || cols <= 0) return "";

  const colGroup = renderColGroup(block.attrs.colWidths, cols);
  const preset = block.attrs.borderPreset;
  const borderColor = block.attrs.borderColor;
  const tableWidth = block.attrs.tableWidth;
  const tableStyle =
    typeof tableWidth === "number" ? ` style="width:${tableWidth}%"` : "";
  const rowHeights = block.attrs.rowHeights as number[] | undefined;
  const trs: string[] = [];
  for (let r = 0; r < rows; r++) {
    // `height` no <tr> é tratado pelo CSS de tabela como MÍNIMO, não fixo —
    // conteúdo maior empurra a linha. Sem max-height/overflow aqui, ou texto
    // some da prova.
    const trStyle =
      typeof rowHeights?.[r] === "number" ? ` style="height:${rowHeights[r]}px"` : "";
    const tds: string[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      // Este caminho NÃO fragmenta a tabela (o HTML de servidor não pagina),
      // então os limites do fragmento são os da tabela lógica.
      const at = (rowspan: number, colspan: number): CellBorderPos => ({
        row: r,
        col: c,
        rowspan,
        colspan,
        cols,
        rowStart: 0,
        rowEnd: rows,
      });
      if (!cell) {
        // Célula ausente também precisa das bordas, senão vira um buraco na grade.
        const style = styleToCssText(cellBorderStyle(preset, at(1, 1), "print", borderColor));
        tds.push(`<td class="ed-cell" style="${style}"></td>`);
        continue;
      }
      if (cell.attrs?.covered) continue;
      const rowspan = cell.attrs?.rowspan && cell.attrs.rowspan > 1 ? cell.attrs.rowspan : 1;
      const colspan = cell.attrs?.colspan && cell.attrs.colspan > 1 ? cell.attrs.colspan : 1;
      tds.push(
        renderCell(cell, cellBorderStyle(preset, at(rowspan, colspan), "print", borderColor)),
      );
    }
    trs.push(`<tr${trStyle}>${tds.join("")}</tr>`);
  }
  return `<div class="ed-table-wrap"><table class="ed-table"${tableStyle}>${colGroup}<tbody>${trs.join("")}</tbody></table></div>`;
}

function renderColGroup(widths: number[] | undefined, cols: number): string {
  const pct = normalizarLarguras(widths, cols);
  const cells = pct.map((w) => `<col style="width:${w}%">`);
  return `<colgroup>${cells.join("")}</colgroup>`;
}

function renderCell(cell: SerializedCell, border: StyleRecord): string {
  const rs = cell.attrs?.rowspan && cell.attrs.rowspan > 1
    ? ` rowspan="${cell.attrs.rowspan}"`
    : "";
  const cs = cell.attrs?.colspan && cell.attrs.colspan > 1
    ? ` colspan="${cell.attrs.colspan}"`
    : "";
  // `variant: "print"` sempre: este HTML é para servidor/PDF, nunca para a tela
  // do editor — logo, lado desligado é `transparent`, nunca a guia visual.
  const styles: string[] = [styleToCssText(border)];
  const align = clampAlign(cell.attrs?.align);
  if (align) styles.push(`text-align:${align}`);
  if (cell.attrs?.bgColor) styles.push(`background-color:${cssValue(cell.attrs.bgColor)}`);
  const style = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
  return `<td class="ed-cell"${rs}${cs}${style}>${renderCellContent(cell)}</td>`;
}

/**
 * Conteúdo de um `<td>`. Espelha `renderCellContent` de
 * `packages/react/src/NodeView.tsx`: sem `listKind`, delta cru (igual antes);
 * com `listKind`, um único `<ul>`/`<ol>` com um `<li data-cell-line>` por
 * linha de `splitDeltaByLines`. Reaproveita `renderInline` — a mesma função
 * que serializa o resto do documento — para não abrir uma segunda rota de
 * delta-para-HTML que diverge da primeira com o tempo.
 */
function renderCellContent(cell: SerializedCell): string {
  const attrs = cell.attrs;
  const kind = attrs?.listKind;
  if (!kind) return renderInline(cell.delta);
  const Tag = kind === "ordered" ? "ol" : "ul";
  const startAttr =
    kind === "ordered" && typeof attrs?.listStart === "number"
      ? ` start="${attrs.listStart}"`
      : "";
  const styleAttr = attrs?.listStyle ? ` style="list-style-type:${cssValue(attrs.listStyle)}"` : "";
  const items = splitDeltaByLines(cell.delta)
    .map((linha, i) => `<li class="ed-listitem" data-cell-line="${i}">${renderInline(linha)}</li>`)
    .join("");
  return `<${Tag} class="ed-list ed-list-${kind}" data-list-kind="${kind}"${startAttr}${styleAttr}>${items}</${Tag}>`;
}

// ---------- inline ----------

function renderInline(delta: DeltaOp[]): string {
  if (delta.length === 0) return "<br>";
  const parts: string[] = [];
  // Floating wrap-left/wrap-right embeds are emitted FIRST so CSS float wraps
  // the following inline text — mirrors the in-editor renderer.
  const wraps: string[] = [];
  for (const op of delta) {
    if (typeof op.insert === "string") {
      if (op.insert.length === 0) continue;
      parts.push(applyMarks(decorateBlanks(op.insert), op.attributes));
    } else if (isImageEmbed(op.insert)) {
      const layout = op.insert.layout ?? "inline";
      if (layout === "wrap-left" || layout === "wrap-right") {
        wraps.push(renderImg(op.insert));
      } else {
        parts.push(renderImg(op.insert));
      }
    }
  }
  if (wraps.length === 0 && parts.length === 0) return "<br>";
  return wraps.join("") + parts.join("");
}

/**
 * Espelha `decorateBlanks` de `@sofereditor/react`: corridas de 3+ underlines
 * viram traço contínuo, com os caracteres preservados. A segmentação vem do
 * mesmo helper puro em `@sofereditor/core` — se divergir daqui, o teste de
 * paridade quebra.
 *
 * Devolve HTML já escapado, que é o que `applyMarks` espera receber.
 */
function decorateBlanks(text: string): string {
  const segs = splitUnderscoreRuns(text);
  if (segs.length === 1 && !segs[0].blank) return escapeHtml(text);
  const css = styleToCssText(BLANK_STYLE);
  return segs
    .map((s) =>
      s.blank
        ? `<span data-blank="true" style="${css}">${escapeHtml(s.text)}</span>`
        : escapeHtml(s.text),
    )
    .join("");
}

function applyMarks(text: string, attrs: MarkAttrs | undefined): string {
  if (!attrs) return text;
  let html = text;
  if (attrs.bold) html = `<strong>${html}</strong>`;
  if (attrs.italic) html = `<em>${html}</em>`;
  if (attrs.underline) html = `<u>${html}</u>`;
  if (attrs.strike) html = `<s>${html}</s>`;
  const styles: string[] = [];
  if (attrs.color) styles.push(`color:${cssValue(attrs.color)}`);
  if (attrs.highlight) styles.push(`background-color:${cssValue(attrs.highlight)}`);
  if (attrs.fontFamily) styles.push(`font-family:${cssValue(attrs.fontFamily)}`);
  if (attrs.fontSize) styles.push(`font-size:${cssValue(attrs.fontSize)}`);
  if (styles.length > 0) html = `<span style="${styles.join(";")}">${html}</span>`;
  if (attrs.link?.href) {
    const t = attrs.link.title ? ` title="${escapeAttr(attrs.link.title)}"` : "";
    html = `<a href="${escapeAttr(attrs.link.href)}"${t} rel="noopener noreferrer" target="_blank">${html}</a>`;
  }
  if (attrs.comment?.markId) {
    html = `<span data-comment-id="${escapeAttr(attrs.comment.markId)}">${html}</span>`;
  }
  return html;
}

function renderImg(embed: ImageEmbed): string {
  const layout = embed.layout ?? "inline";
  const align = embed.align;
  const ox = embed.offsetX ?? 0;
  const oy = embed.offsetY ?? 0;
  const hasCaption = !!embed.caption && embed.caption.length > 0;

  // The wrapper carries the positioning (float/absolute/inline-block/block).
  // The img keeps the intrinsic size when wrapped; when there's no caption we
  // keep the historical bare `<img>` output for unchanged DOM/CSS.
  const wrapperStyles: string[] = [];
  switch (layout) {
    case "wrap-left":
      wrapperStyles.push(
        "float:left",
        `width:${embed.width}px`,
        `margin-right:${Math.max(8, ox)}px`,
        `margin-top:${Math.max(0, oy)}px`,
        "margin-bottom:4px",
      );
      break;
    case "wrap-right":
      wrapperStyles.push(
        "float:right",
        `width:${embed.width}px`,
        `margin-left:${Math.max(8, ox)}px`,
        `margin-top:${Math.max(0, oy)}px`,
        "margin-bottom:4px",
      );
      break;
    case "behind":
    case "front":
      wrapperStyles.push(
        "position:absolute",
        `left:${ox === 0 ? "0" : `${ox}px`}`,
        `top:${oy === 0 ? "0" : `${oy}px`}`,
        `width:${embed.width}px`,
        `z-index:${layout === "behind" ? -1 : 2}`,
      );
      break;
    case "inline":
    default:
      if (align) {
        wrapperStyles.push(
          "display:block",
          `width:${embed.width}px`,
          `margin-left:${align === "left" ? "0" : "auto"}`,
          `margin-right:${align === "right" ? "0" : "auto"}`,
        );
      } else {
        wrapperStyles.push(
          "display:inline-block",
          // Espelha renderInline.tsx — parity.test.tsx trava a igualdade.
          `vertical-align:${embed.formula?.vAlign ?? "text-bottom"}`,
          `width:${embed.width}px`,
        );
      }
      break;
  }

  const imgStyles: string[] = [
    `width:${embed.width}px`,
    `height:${embed.height}px`,
    "display:block",
  ];

  const imgHtml = `<img src="${escapeAttr(embed.src)}" width="${embed.width}" height="${embed.height}" alt="${escapeAttr(embed.caption ?? "")}" data-embed="image" data-embed-layout="${layout}"${
    align ? ` data-embed-align="${escapeAttr(align)}"` : ""
  } style="${imgStyles.join(";")}">`;

  const captionAlign = embed.captionAlign ?? "center";
  return `<figure class="ed-figure"${hasCaption ? ' data-embed-figure="true"' : ""} data-embed-layout="${layout}" style="${wrapperStyles.join(";")}">${imgHtml}${hasCaption ? `<figcaption class="ed-figcaption" data-caption-align="${captionAlign}" style="text-align:${captionAlign}">${escapeHtml(
    embed.caption!,
  )}</figcaption>` : ""}</figure>`;
}

// ---------- helpers ----------

function blockAttrs(baseClass: string, attrs: BlockAttrs): string {
  const classes = [baseClass, "ed-block"];
  const align = clampAlign(attrs.align);
  if (align) classes.push(`ed-align-${align}`);
  const dir = clampDir(attrs.dir);
  const dirAttr = dir ? ` dir="${dir}"` : "";
  // Linha de resposta: mesmo helper puro que o renderizador do editor usa, para
  // a régua e a entrelinha saírem idênticas nos dois caminhos.
  const answer = answerLineStyle(attrs);
  const styleAttr = answer ? ` style="${styleToCssText(answer)}"` : "";
  return ` class="${classes.join(" ")}"${dirAttr}${styleAttr}`;
}

function clampHeadingLevel(l: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  if (typeof l !== "number") return 1;
  const n = Math.trunc(l);
  if (n < 1) return 1;
  if (n > 6) return 6;
  return n as 1 | 2 | 3 | 4 | 5 | 6;
}

function clampListLevel(l: unknown): number {
  if (typeof l !== "number" || !Number.isFinite(l)) return 0;
  return Math.max(0, Math.min(5, Math.trunc(l)));
}

function clampAlign(a: unknown): AlignValue | undefined {
  if (a === "left" || a === "center" || a === "right" || a === "justify") return a;
  return undefined;
}

function clampDir(d: unknown): DirValue | undefined {
  if (d === "ltr" || d === "rtl") return d;
  return undefined;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Allow only safe characters in CSS values — defense in depth against injected `</style>`. */
function cssValue(v: string): string {
  return v.replace(/[<>"';\\]/g, "");
}

function baseStylesheet(page: NonNullable<DocumentToHtmlOptions["page"]>): string {
  // Margins are owned by `@page` only. Chromium honors that block both for
  // `window.print()` (client-side `exportPdfFromDocument`) and for
  // `page.pdf({ preferCSSPageSize: true })` (server-side `renderPdf` in
  // `@sofereditor/export-pdf-server`). Adding the same offsets via `body { padding }`
  // would compound and double the margin in the output PDF.
  return `
@page {
  size: ${page.width} ${page.height};
  margin: ${page.marginTop} ${page.marginRight} ${page.marginBottom} ${page.marginLeft};
}
html, body { margin: 0; padding: 0; background: white; color: #1a1a1f; }
/* Sem isto, o diálogo de impressão descarta background-color/imagens de
   fundo por padrão ("gráficos de fundo" desmarcado) — ex.: células com
   bgColor da tabela de pontuação saíam brancas no PDF. */
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body {
  font-family: "Verdana", sans-serif;
  font-size: 11pt;
  line-height: 1.5;
}
.ed-paragraph { margin: 0 0 0.5em; min-height: 1.5em; }
.ed-heading { margin: 0.5em 0 0.25em; font-weight: 600; line-height: 1.25; }
.ed-heading-1 { font-size: 28pt; }
.ed-heading-2 { font-size: 22pt; }
.ed-heading-3 { font-size: 18pt; }
.ed-heading-4 { font-size: 14pt; }
.ed-heading-5 { font-size: 12pt; }
.ed-heading-6 { font-size: 11pt; color: #6b7280; }
.ed-blockquote {
  margin: 0 0 0.5em; padding: 0.25em 12px;
  border-inline-start: 3px solid #e5e7eb; color: #6b7280;
}
.ed-codeblock {
  margin: 0 0 0.5em; background: #0f172a; color: #e2e8f0;
  padding: 12px 14px; border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11pt; white-space: pre-wrap;
}
.ed-codeblock code { font-family: inherit; background: transparent; color: inherit; }
.ed-block[dir="rtl"] { text-align: start; }
.ed-align-left { text-align: left; }
.ed-align-center { text-align: center; }
.ed-align-right { text-align: right; }
.ed-align-justify { text-align: justify; }
.ed-list { margin: 0 0 0.5em; padding-inline-start: 28px; }
.ed-list .ed-list { margin-block: 0; }
.ed-list-bullet { list-style-type: disc; }
.ed-list-bullet .ed-list-bullet { list-style-type: circle; }
.ed-list-bullet .ed-list-bullet .ed-list-bullet { list-style-type: square; }
.ed-list-ordered { list-style-type: decimal; }
.ed-list-ordered .ed-list-ordered { list-style-type: lower-alpha; }
.ed-list-ordered .ed-list-ordered .ed-list-ordered { list-style-type: lower-roman; }
.ed-listitem { margin: 0; min-height: 1.5em; }
.ed-cell .ed-list { margin: 0; padding-inline-start: 20px; }
.ed-cell .ed-listitem { margin: 0; }
.ed-table-wrap { margin: 0 0 0.5em; position: relative; }
.ed-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ed-cell {
  border: 1px solid #cbd5e1; padding: 6px 8px;
  vertical-align: top; word-break: break-word; white-space: pre-wrap;
}
img[data-embed="image"] { max-width: 100%; }
.ed-figure { margin: 0; padding: 0; }
.ed-block { position: relative; isolation: isolate; }
a { color: #2563eb; }
`;
}
