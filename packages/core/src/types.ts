/**
 * Public type definitions for the document model.
 * The runtime representation lives in Y.js (see document.ts);
 * these types describe its shape for consumers.
 */

export type BlockType =
  | "paragraph"
  | "heading"
  | "blockquote"
  | "codeBlock"
  | "listItem"
  | "table";

export type AlignValue = "left" | "center" | "right" | "justify";
export type DirValue = "ltr" | "rtl";
export type ListKind = "bullet" | "ordered";

export type ListStyleType =
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";

/** Maximum supported list nesting (0 = top level). */
export const MAX_LIST_LEVEL = 5;

/** Entrelinha de uma linha de resposta: simples, 1,5 ou dupla. */
export type AnswerLineSpacing = 1 | 1.5 | 2;

/**
 * Onde as linhas da grade de uma tabela aparecem.
 * Vocabulário nativo de `w:tblBorders` (top/left/bottom/right/insideH/insideV).
 */
export type TableBorderPreset = "all" | "outer" | "horizontal" | "vertical" | "none";

export interface BlockAttrs {
  align?: AlignValue;
  dir?: DirValue;
  /** Only meaningful when `type === "heading"`. 1..6. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Only meaningful when `type === "codeBlock"`. Free-form (CSS-style language hint). */
  language?: string;
  /** Only meaningful when `type === "listItem"`. */
  listKind?: ListKind;
  /** Only meaningful when `type === "listItem"`. 0..MAX_LIST_LEVEL. */
  listLevel?: number;
  /**
   * Only meaningful when `type === "listItem"` and `listKind === "ordered"`.
   * When set on a listItem, that item starts a NEW list group whose first
   * `<ol>` carries `start={listStart}`. Used to renumerate questions or pick
   * up an interrupted sequence.
   */
  listStart?: number;
  /**
   * Only meaningful when `type === "listItem"`. Overrides the default per-level
   * CSS cycle (decimal → lower-alpha → lower-roman) with an explicit style.
   * Like `listStart`, setting this on a listItem breaks the group so the new
   * `<ol>` carries the requested `list-style-type`.
   */
  listStyle?: ListStyleType;
  /** Only meaningful when `type === "table"`. */
  rows?: number;
  /** Only meaningful when `type === "table"`. */
  cols?: number;
  /**
   * Only meaningful when `type === "table"`. Per-column widths in
   * **proportion**, summing to 100. Old documents have absolute px and are
   * normalized on read — see `normalizarLarguras`.
   */
  colWidths?: number[];
  /**
   * Only meaningful when `type === "table"`. Total table width as a
   * percentage of the available page width. Missing = 100, so existing
   * documents don't change appearance.
   */
  tableWidth?: number;
  /**
   * Only meaningful when `type === "table"`. Per-row height in px, one entry
   * per row. It's a MINIMUM, not fixed — the row grows past it when content
   * needs more room (same posture as `w:trHeight hRule="atLeast"` in DOCX).
   * Missing = rows size to content, exactly like today.
   */
  rowHeights?: number[];
  /**
   * Só relevante quando `type === "table"`. Onde as linhas da grade aparecem.
   * Ausente = "all" — documentos existentes não mudam de aparência.
   */
  borderPreset?: TableBorderPreset;
  /**
   * Só relevante quando `type === "table"`. Cor das linhas da grade.
   * Ausente = `TABLE_BORDER_COLOR` — documentos existentes não mudam.
   */
  borderColor?: string;
  /**
   * Só relevante quando `type === "paragraph"`. Parágrafo pautado para o aluno
   * escrever a resposta: renderiza com régua inferior de largura total.
   */
  answerLine?: true;
  /**
   * Só relevante quando `answerLine`. Entrelinha. Ausente = 1.
   *
   * Deliberadamente escopado a linhas de resposta em vez de um `lineSpacing`
   * genérico de parágrafo: entrelinha geral mudaria a medição de paginação de
   * TODO parágrafo do documento, o que é outra feature com outro raio de impacto.
   */
  answerLineSpacing?: AnswerLineSpacing;
}

export interface CellAttrs {
  /**
   * Number of rows this cell spans, starting at its row. Default 1.
   * Only meaningful on REAL cells (not covered).
   */
  rowspan?: number;
  /** Default 1. Only meaningful on REAL cells. */
  colspan?: number;
  /**
   * `true` iff this cell is occluded by an owning cell with a `rowspan`/`colspan`
   * spanning into this position. Covered cells do not render their own `<td>`,
   * never accept input, and are skipped by Tab navigation.
   *
   * The cells array keeps `rows * cols` entries to preserve the row-major index
   * scheme — covered cells are placeholders, not gaps.
   */
  covered?: true;
  /** Alinhamento horizontal do texto da célula. Mesmos valores de bloco. */
  align?: AlignValue;
  /** Cor de fundo da célula (CSS color, ex. `#ffe58f`). Ausente = sem fundo. */
  bgColor?: string;
  /**
   * Quando presente, a célula renderiza como lista e cada linha separada por
   * `\n` vira um item. Ausente = texto normal com quebras visuais.
   *
   * Não existe `listLevel` aqui de propósito: `Y.Text` plano não guarda
   * atributo por linha, então recuo seria um nível para a célula inteira, não
   * por item. Aninhamento dentro de célula exigiria blocos de verdade dentro
   * dela — ver o spec de 2026-08-24.
   */
  listKind?: ListKind;
  /** Só relevante com `listKind === "ordered"`. Primeiro número da lista. */
  listStart?: number;
  /** Só relevante com `listKind === "ordered"`. Sobrepõe o marcador padrão. */
  listStyle?: ListStyleType;
}

export interface Position {
  blockIndex: number;
  /**
   * When the caret is inside a table cell, identifies which cell within the
   * table at `blockIndex`. Flat row-major index: `row * cols + col`.
   * `undefined` means the position addresses the block's own text (or the block
   * itself, for atomic blocks). Tables have no own text — every caret position
   * inside a table block carries a defined `cellIndex`.
   */
  cellIndex?: number;
  offset: number;
}

export interface Selection {
  anchor: Position;
  focus: Position;
}

export type MarkName =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "color"
  | "highlight"
  | "fontFamily"
  | "fontSize"
  | "link"
  | "comment";

export interface LinkAttr {
  href: string;
  title?: string;
}

export interface CommentAttr {
  /** Identificador estável compartilhado com o backend (ProvaDocumentoComentario.markId). */
  markId: string;
}

export interface MarkAttrs {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  color?: string;
  /** Cor de fundo do texto (marca-texto). CSS color, ex. `#fff176`. */
  highlight?: string;
  fontFamily?: string;
  fontSize?: string;
  link?: LinkAttr;
  comment?: CommentAttr;
}

export type MarkValue<K extends MarkName = MarkName> = NonNullable<MarkAttrs[K]>;

/**
 * Visual layout mode for an image embed.
 *
 * - `inline` (default): part of the text run, flows like a character.
 * - `wrap-left` / `wrap-right`: image floats to the named side of the anchor
 *   paragraph (Word-style "wrap square"). Text in the paragraph wraps around it.
 * - `behind`: image is absolutely positioned beneath the text (z-index < text).
 * - `front`: image is absolutely positioned above the text (z-index > text).
 *
 * In every non-inline mode the embed remains in the Y.Text run at its offset —
 * the offset is its **anchor** (it follows the paragraph during pagination
 * and re-flows). Visual position is offset from the anchor block's content box.
 */
export type ImageLayout = "inline" | "wrap-left" | "wrap-right" | "behind" | "front";

export interface ImageEmbed {
  type: "image";
  /** Data URL (base64) — self-contained so the embed travels with the Y.Doc. */
  src: string;
  /** Rendered CSS px (display size — may differ from intrinsic dimensions). */
  width: number;
  height: number;
  /** When set (inline mode only), the image renders `display: block` with the matching margin auto. */
  align?: "left" | "center" | "right";
  /** Visual layout. Defaults to "inline" when omitted. */
  layout?: ImageLayout;
  /**
   * Horizontal offset in CSS px from the anchor block's content box.
   * - wrap-left: extra left margin from the paragraph's start edge.
   * - wrap-right: extra right margin from the paragraph's end edge.
   * - behind / front: `left` relative to the anchor block's padding-box.
   * Ignored for `inline`.
   */
  offsetX?: number;
  /**
   * Vertical offset in CSS px from the anchor block's content box.
   * - wrap-left / wrap-right: extra top margin pushing the float down inside
   *   the paragraph.
   * - behind / front: `top` relative to the anchor block's padding-box.
   * Ignored for `inline`.
   */
  offsetY?: number;
  /**
   * Optional plain-text caption. Renders inside a `<figcaption>` beneath the
   * image in any layout — the figure wraps the image so the caption travels
   * with floats/anchors. Plain text only; rich marks are out of scope (we
   * never want a sub-editor inside an inline embed).
   */
  caption?: string;
  /**
   * Text alignment for the caption. Defaults to "center" (Word/Google Docs
   * default for figure captions). Only meaningful when `caption` is set.
   * Note: DOCX export emits captions inside the host paragraph, so this
   * setting only affects the editor and HTML/PDF exports — Word displays the
   * caption using the paragraph's own alignment.
   */
  captionAlign?: "left" | "center" | "right";
  /**
   * Presente ⇒ este embed é uma fórmula. A imagem (`src`) é o RENDER; isto é
   * a fonte. Reabrir o editor de fórmula relê `latex` daqui.
   */
  formula?: {
    /** Fonte da verdade. O que o professor escreveu. */
    latex: string;
    /**
     * Bloco (`\displaystyle`, centrado) em vez de inline. Guardado explícito
     * em vez de derivado de `align === "center"`: derivar acoplaria o modo da
     * fórmula a um campo de layout que o usuário mexe pelos botões de
     * alinhamento da toolbar, e reabrir o modal cairia no modo errado.
     */
    display: boolean;
    /**
     * Alinhamento de base para fórmula inline, no formato que o MathJax
     * devolve (ex.: "-0.781ex"). Aplicado como `vertical-align` no WRAPPER
     * (<figure>) para a fórmula sentar na linha do texto. Ausente quando
     * `display` é true.
     */
    vAlign?: string;
  };
  /**
   * PNG data URL. Só o `export-docx` consome: o `ImageRun` de `type: "svg"`
   * exige um `fallback` raster. Vale para qualquer embed cujo `src` seja SVG —
   * não é exclusivo de fórmula.
   */
  svgFallback?: string;
}

export type InsertContent = string | ImageEmbed;

export function isImageEmbed(v: unknown): v is ImageEmbed {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "image" &&
    typeof (v as { src?: unknown }).src === "string"
  );
}

/**
 * Um embed de fórmula é um embed de IMAGEM que carrega seu LaTeX. Só dois
 * lugares precisam distinguir: a toolbar (trocar "Legenda" por "Editar
 * fórmula") e o duplo clique que reabre o modal. Todo o resto trata como
 * imagem, de propósito.
 */
export function isFormulaEmbed(
  v: unknown,
): v is ImageEmbed & { formula: NonNullable<ImageEmbed["formula"]> } {
  return isImageEmbed(v) && (v as ImageEmbed).formula != null;
}

export interface DeltaOp {
  insert: InsertContent;
  attributes?: MarkAttrs;
}

export interface SerializedCell {
  /** Plain concatenated text. */
  text: string;
  /** Delta with marks. */
  delta: DeltaOp[];
  attrs: CellAttrs;
}

export interface SerializedBlock {
  /** Id estável do bloco (cursores colaborativos / keying). Ausente em docs antigos. */
  id?: string;
  type: BlockType;
  /** Plain concatenated text (no marks). Kept for ergonomic equality checks. */
  text: string;
  /** Yjs delta — used by the renderer to draw mark-aware spans. */
  delta: DeltaOp[];
  /** Block-level attributes (align, dir, heading level, code language…). */
  attrs: BlockAttrs;
  /** Only present when `type === "table"`. Flat row-major list, length = rows * cols. */
  cells?: SerializedCell[];
}

import type { PageSettings } from "./page-settings";

/**
 * Document JSON shape used by `EditorDocument.toJSON` / `fromJSON`, the
 * exporters and the importer. Until Fase 9.5 this was a bare `SerializedBlock[]`;
 * Fase 9.6 promoted it to an object so per-document settings (page size,
 * margins) can travel with the content.
 *
 * `fromJSON` still accepts a legacy array for backwards compatibility — see
 * `isLegacySerializedDocument`.
 */
export interface SerializedDocument {
  blocks: SerializedBlock[];
  /** Page settings. Optional; omitted means default A4 + 1" margins. */
  pageSettings?: PageSettings;
}

/** A `SerializedDocument` produced before Fase 9.6 — just an array of blocks. */
export type LegacySerializedDocument = SerializedBlock[];

export function isLegacySerializedDocument(
  v: SerializedDocument | LegacySerializedDocument,
): v is LegacySerializedDocument {
  return Array.isArray(v);
}
