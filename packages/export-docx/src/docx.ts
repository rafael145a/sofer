import type {
  AlignValue,
  DeltaOp,
  ImageEmbed,
  LegacySerializedDocument,
  ListKind,
  MarkAttrs,
  SerializedBlock,
  SerializedCell,
  SerializedDocument,
} from "@sofereditor/core";
import {
  DEFAULT_PAGE_SETTINGS,
  isImageEmbed,
  isLegacySerializedDocument,
  pxToMm,
  type PageSettings,
} from "@sofereditor/core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  PageOrientation,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from "docx";

const BULLET_REF = "ed-bullet";
const ORDERED_REF = "ed-ordered";

export interface ResolvedImage {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp" | "svg";
}

export interface DocumentToDocxOptions {
  /** Document title; embedded in core properties. */
  title?: string;
  /** Author for core properties. */
  creator?: string;
  /**
   * Resolve um `src` de imagem para bytes. Default: data URLs (decodificadas
   * localmente) e http(s) via fetch. Retornar null pula a imagem (contada em
   * `skippedImages`) sem abortar o export.
   */
  resolveImage?: (src: string) => Promise<ResolvedImage | null>;
}

/**
 * Build a docx `Document` from a `SerializedDocument`. Output is a Blob you can
 * download with `downloadBlob` from `@sofereditor/export-pdf`.
 *
 * Mappings:
 *  - paragraph / heading / blockquote / codeBlock → Paragraph (with `heading`,
 *    shading, monospace font for code)
 *  - listItem → Paragraph with `numbering: { reference, level }`
 *  - table → docx `Table`. `rowspan`/`colspan` map to TableCell's `rowSpan`/
 *    `columnSpan`; "covered" cells are skipped (docx infers cover from spans)
 *  - inline marks → TextRun props (bold, italics, underline, strike, color,
 *    font, size in half-points)
 *  - image embeds → ImageRun with bytes resolved via `resolveImage` (default:
 *    data URLs decoded locally, http(s) fetched; unresolved images are
 *    skipped and counted in `skippedImages` instead of aborting the export)
 */
export async function documentToDocxBlob(
  doc: SerializedDocument | LegacySerializedDocument,
  options: DocumentToDocxOptions = {},
): Promise<{ blob: Blob; skippedImages: number }> {
  const normalized = normalize(doc);
  const { images, skipped } = await resolveAllImages(
    normalized,
    options.resolveImage ?? defaultResolveImage,
  );
  const built = buildDocument(normalized, options, images);
  return { blob: await Packer.toBlob(built), skippedImages: skipped };
}

/** Same as `documentToDocxBlob` but returns a Uint8Array (useful in Node/tests). */
export async function documentToDocxBuffer(
  doc: SerializedDocument | LegacySerializedDocument,
  options: DocumentToDocxOptions = {},
): Promise<{ buffer: Uint8Array; skippedImages: number }> {
  const normalized = normalize(doc);
  const { images, skipped } = await resolveAllImages(
    normalized,
    options.resolveImage ?? defaultResolveImage,
  );
  const built = buildDocument(normalized, options, images);
  const buf = await Packer.toBuffer(built);
  // `Packer.toBuffer` returns a Node Buffer at runtime — coerce for consumers.
  return {
    buffer: buf instanceof Uint8Array ? buf : new Uint8Array(buf),
    skippedImages: skipped,
  };
}

function normalize(doc: SerializedDocument | LegacySerializedDocument): SerializedDocument {
  return isLegacySerializedDocument(doc) ? { blocks: doc } : doc;
}

function buildDocument(
  doc: SerializedDocument,
  options: DocumentToDocxOptions,
  images: Map<string, ResolvedImage | null>,
): Document {
  const children = blocksToDocxChildren(doc, images);
  const settings = doc.pageSettings ?? DEFAULT_PAGE_SETTINGS;
  return new Document({
    creator: options.creator,
    title: options.title,
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: buildBulletLevels(),
        },
        {
          reference: ORDERED_REF,
          levels: buildOrderedLevels(),
        },
      ],
    },
    sections: [
      {
        properties: sectionPropertiesFor(settings),
        children,
      },
    ],
  });
}

function sectionPropertiesFor(settings: PageSettings) {
  return {
    page: {
      size: {
        width: convertMillimetersToTwip(pxToMm(settings.width)),
        height: convertMillimetersToTwip(pxToMm(settings.height)),
        orientation: PageOrientation.PORTRAIT,
      },
      margin: {
        top: convertMillimetersToTwip(pxToMm(settings.marginTop)),
        bottom: convertMillimetersToTwip(pxToMm(settings.marginBottom)),
        left: convertMillimetersToTwip(pxToMm(settings.marginLeft)),
        right: convertMillimetersToTwip(pxToMm(settings.marginRight)),
      },
    },
  };
}

function blocksToDocxChildren(
  doc: SerializedDocument,
  images: Map<string, ResolvedImage | null>,
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    switch (block.type) {
      case "paragraph":
        out.push(makeParagraph(block, images));
        break;
      case "heading":
        out.push(makeHeading(block, images));
        break;
      case "blockquote":
        out.push(makeBlockquote(block, images));
        break;
      case "codeBlock":
        out.push(makeCodeBlock(block, images));
        break;
      case "listItem":
        out.push(makeListItem(block, images));
        break;
      case "table":
        out.push(makeTable(block, images));
        break;
      default:
        out.push(makeParagraph(block, images));
    }
  }
  return out;
}

// ---------- block builders ----------

// School standard: Arial for all body text. Code blocks override with
// Consolas (monospace is more legible for code). Italics on blockquote is
// kept as a stylistic default.
const ARIAL: RunDefaults = { font: "Arial" };

function makeParagraph(
  block: SerializedBlock,
  images: Map<string, ResolvedImage | null>,
): Paragraph {
  return new Paragraph({
    alignment: alignFor(block.attrs.align),
    bidirectional: block.attrs.dir === "rtl" ? true : undefined,
    ...answerLineProps(block.attrs),
    children: deltaToRuns(block.delta, ARIAL, images),
  });
}

/**
 * Linha de resposta → borda inferior de parágrafo (`w:pBdr`) + entrelinha.
 * É como um documento profissional desenha uma pauta: a régua acompanha a
 * margem automaticamente, ao contrário de uma fileira de underlines.
 *
 * 240 twips = uma linha simples no OOXML.
 */
function answerLineProps(attrs: SerializedBlock["attrs"]) {
  if (attrs.answerLine !== true) return {};
  const spacing = attrs.answerLineSpacing ?? 1;
  return {
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 },
    },
    spacing: { line: Math.round(240 * spacing), lineRule: LineRuleType.AUTO },
  };
}

function makeHeading(
  block: SerializedBlock,
  images: Map<string, ResolvedImage | null>,
): Paragraph {
  const level = clampHeadingLevel(block.attrs.level);
  return new Paragraph({
    heading: HEADING_LEVELS[level - 1],
    alignment: alignFor(block.attrs.align),
    children: deltaToRuns(block.delta, ARIAL, images),
  });
}

function makeBlockquote(
  block: SerializedBlock,
  images: Map<string, ResolvedImage | null>,
): Paragraph {
  return new Paragraph({
    alignment: alignFor(block.attrs.align),
    indent: { left: 480 }, // ~0.25"
    border: {
      left: { color: "CBD5E1", space: 12, style: BorderStyle.SINGLE, size: 12 },
    },
    children: deltaToRuns(block.delta, { ...ARIAL, italics: true }, images),
  });
}

function makeCodeBlock(
  block: SerializedBlock,
  images: Map<string, ResolvedImage | null>,
): Paragraph {
  return new Paragraph({
    spacing: { before: 100, after: 100 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" },
    children: deltaToRuns(block.delta, { font: "Consolas", size: 20 }, images),
  });
}

function makeListItem(
  block: SerializedBlock,
  images: Map<string, ResolvedImage | null>,
): Paragraph {
  const kind: ListKind = block.attrs.listKind === "ordered" ? "ordered" : "bullet";
  const reference = kind === "ordered" ? ORDERED_REF : BULLET_REF;
  const level = clampListLevel(block.attrs.listLevel);
  return new Paragraph({
    numbering: { reference, level },
    alignment: alignFor(block.attrs.align),
    children: deltaToRuns(block.delta, ARIAL, images),
  });
}

function makeTable(block: SerializedBlock, images: Map<string, ResolvedImage | null>): Table {
  const rows = typeof block.attrs.rows === "number" ? block.attrs.rows : 0;
  const cols = typeof block.attrs.cols === "number" ? block.attrs.cols : 0;
  const cells = block.cells ?? [];

  const rowsOut: TableRow[] = [];
  for (let r = 0; r < rows; r++) {
    const cellsOut: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      if (!cell) {
        cellsOut.push(emptyCell());
        continue;
      }
      if (cell.attrs?.covered) continue;
      cellsOut.push(makeCell(cell, images));
    }
    rowsOut.push(new TableRow({ children: cellsOut }));
  }

  // Validate the RAW array against `cols` — filtering invalid entries first
  // (e.g. dropping a negative width) would silently shift the remaining
  // widths onto the wrong columns while still passing a length check.
  const rawColWidths = block.attrs.colWidths;
  const isValidColWidths =
    Array.isArray(rawColWidths) &&
    cols > 0 &&
    rawColWidths.length === cols &&
    rawColWidths.every((w): w is number => typeof w === "number" && w > 0);
  const columnWidths = isValidColWidths
    ? rawColWidths.map((px) => convertMillimetersToTwip(pxToMm(px)))
    : undefined;

  return new Table({
    rows: rowsOut,
    ...(columnWidths
      ? {
          columnWidths,
          // Fix the layout so Word honors the column widths verbatim instead
          // of autofitting to content (the OOXML default when `tblLayout` is
          // absent, which would make `columnWidths` a mere hint).
          layout: TableLayoutType.FIXED,
          width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        }
      : { width: { size: 100, type: WidthType.PERCENTAGE } }),
  });
}

function makeCell(cell: SerializedCell, images: Map<string, ResolvedImage | null>): TableCell {
  const span = cell.attrs?.colspan && cell.attrs.colspan > 1 ? cell.attrs.colspan : 1;
  const rowSpan = cell.attrs?.rowspan && cell.attrs.rowspan > 1 ? cell.attrs.rowspan : 1;
  const fill = cssColorToDocxHex(cell.attrs?.bgColor);
  return new TableCell({
    columnSpan: span,
    rowSpan,
    verticalAlign: VerticalAlign.TOP,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    children: [
      new Paragraph({
        alignment: alignFor(cell.attrs?.align),
        children: deltaToRuns(cell.delta, ARIAL, images),
      }),
    ],
  });
}

function emptyCell(): TableCell {
  return new TableCell({ children: [new Paragraph("")] });
}

// ---------- inline ----------

interface RunDefaults {
  bold?: boolean;
  italics?: boolean;
  font?: string;
  size?: number;
}

function deltaToRuns(
  delta: DeltaOp[],
  defaults: RunDefaults = {},
  images: Map<string, ResolvedImage | null>,
): Array<TextRun | ImageRun> {
  if (delta.length === 0) return [new TextRun("")];
  const out: Array<TextRun | ImageRun> = [];
  for (const op of delta) {
    if (typeof op.insert === "string") {
      if (op.insert.length === 0) continue;
      out.push(makeTextRun(op.insert, op.attributes, defaults));
    } else if (isImageEmbed(op.insert)) {
      const embed = op.insert;
      const img = makeImageRun(embed, images);
      if (img) out.push(img);
      // Captions are emitted as italic-smaller text on a new line right after
      // the image. Word-style "Caption" paragraph would need a paragraph
      // break, which we can't do mid-delta — visually correct but loses the
      // semantic "Caption" style.
      if (embed.caption && embed.caption.length > 0) {
        out.push(
          new TextRun({
            text: embed.caption,
            italics: true,
            size: 18, // 9pt — typical caption size
            break: 1,
          }),
        );
      }
    }
  }
  if (out.length === 0) out.push(new TextRun(""));
  return out;
}

/**
 * Props de um `TextRun` a partir das marks. Fica numa função só porque
 * `makeTextRun` tem dois caminhos (linha única e multi-linha) que antes
 * duplicavam esta lista inteira — uma mark acrescentada em apenas um dos dois
 * se perdia silenciosamente em texto com quebra de linha.
 *
 * `highlight` sai como `w:shd` e NÃO como `w:highlight`: este último só aceita
 * ~15 valores nomeados e não sobreviveria a uma cor arbitrária do picker.
 */
function textRunProps(text: string, m: MarkAttrs, defaults: RunDefaults) {
  const fill = cssColorToDocxHex(m.highlight);
  return {
    text,
    bold: m.bold || defaults.bold,
    italics: m.italic || defaults.italics,
    underline: m.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: m.strike,
    color: cssColorToDocxHex(m.color),
    font: m.fontFamily ?? defaults.font,
    size: parseFontSizeToHalfPoints(m.fontSize) ?? defaults.size,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
  };
}

function makeTextRun(
  text: string,
  marks: MarkAttrs | undefined,
  defaults: RunDefaults,
): TextRun {
  const m = marks ?? {};
  // TextRun reads newlines via `break`; convert \n into break runs.
  const segments = text.split("\n");
  if (segments.length === 1) {
    return new TextRun(textRunProps(text, m, defaults));
  }
  // Multi-line: rejoin via TextRun children — but TextRun expects a single text
  // string. Approximate with non-printing line breaks: produce a sequence of
  // TextRuns separated by `new TextRun({ break: 1 })` packed into the parent.
  // Simpler: collapse to a single TextRun with the string, treating \n as a
  // soft-break placeholder. Word renders \n inside a w:t as a literal space,
  // so we replace with a small symbol-friendly fallback.
  return new TextRun(textRunProps(text.replace(/\n/g, " "), m, defaults));
}

function makeImageRun(
  embed: ImageEmbed,
  images: Map<string, ResolvedImage | null>,
): ImageRun | null {
  const resolved = images.get(embed.src);
  if (!resolved) return null;
  return new ImageRun({
    data: resolved.data,
    type: resolved.type,
    transformation: {
      width: Math.max(1, Math.round(embed.width)),
      height: Math.max(1, Math.round(embed.height)),
    },
  } as ConstructorParameters<typeof ImageRun>[0]);
}

interface DecodedImage {
  bytes: Uint8Array;
  kind: "png" | "jpg" | "gif" | "bmp" | "svg";
}

function decodeDataUrl(src: string): DecodedImage | null {
  const m = /^data:image\/(png|jpe?g|gif|bmp|svg\+xml);base64,(.+)$/i.exec(src);
  if (!m) return null;
  const fmt = m[1].toLowerCase();
  const kind: DecodedImage["kind"] =
    fmt === "jpeg" || fmt === "jpg"
      ? "jpg"
      : fmt === "svg+xml"
        ? "svg"
        : (fmt as "png" | "gif" | "bmp");
  const base64 = m[2];
  const bytes = base64ToBytes(base64);
  return { bytes, kind };
}

/**
 * Default `resolveImage`: decode data URLs locally, fetch http(s) URLs, and
 * return null for anything else (caller counts it in `skippedImages`).
 */
async function defaultResolveImage(src: string): Promise<ResolvedImage | null> {
  const decoded = decodeDataUrl(src);
  if (decoded) return { data: decoded.bytes, type: decoded.kind };
  if (/^https?:\/\//i.test(src) && typeof fetch === "function") {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const matchedType: ResolvedImage["type"] | null = ct.includes("png")
        ? "png"
        : ct.includes("jpeg") || ct.includes("jpg")
          ? "jpg"
          : ct.includes("gif")
            ? "gif"
            : ct.includes("bmp")
              ? "bmp"
              : ct.includes("svg")
                ? "svg"
                : null;
      // Unknown content-type (e.g. image/webp) with no recognizable extension
      // in the URL: skip rather than mislabeling bytes as PNG (would produce
      // a broken image in Word — contract is "failure to resolve → skip").
      const type = matchedType ?? typeFromExtension(src);
      if (!type) return null;
      return { data: new Uint8Array(await res.arrayBuffer()), type };
    } catch {
      return null;
    }
  }
  return null;
}

function typeFromExtension(src: string): ResolvedImage["type"] | null {
  const m = /\.(png|jpe?g|gif|bmp|svg)(\?|#|$)/i.exec(src);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ext === "jpeg" || ext === "jpg" ? "jpg" : (ext as ResolvedImage["type"]);
}

/**
 * Async pre-pass: collect every image `src` referenced by the document
 * (block deltas and table cell deltas), resolve them in parallel via
 * `resolve`, and return a lookup map plus the count of embeds that failed to
 * resolve. The rest of the build pipeline stays synchronous and reads from
 * this map.
 */
async function resolveAllImages(
  doc: SerializedDocument,
  resolve: (src: string) => Promise<ResolvedImage | null>,
): Promise<{ images: Map<string, ResolvedImage | null>; skipped: number }> {
  const srcs = new Set<string>();
  const collect = (delta: DeltaOp[]) => {
    for (const op of delta) if (isImageEmbed(op.insert)) srcs.add(op.insert.src);
  };
  for (const block of doc.blocks) {
    collect(block.delta);
    for (const cell of block.cells ?? []) collect(cell.delta);
  }
  const images = new Map<string, ResolvedImage | null>();
  await Promise.all(
    [...srcs].map(async (src) => {
      let resolved: ResolvedImage | null = null;
      try {
        resolved = await resolve(src);
      } catch {
        resolved = null;
      }
      // docx's ImageRun requires a `fallback` for type "svg" (RegularImageOptions);
      // without it the constructor throws synchronously inside buildDocument,
      // which is outside this try/catch and would abort the whole export. Treat
      // svg as unresolved (skip) until we add fallback support.
      if (resolved?.type === "svg") resolved = null;
      images.set(src, resolved);
    }),
  );
  // skipped conta OCORRÊNCIAS de embed sem resolução (não srcs únicos).
  let skipped = 0;
  const count = (delta: DeltaOp[]) => {
    for (const op of delta)
      if (isImageEmbed(op.insert) && !images.get(op.insert.src)) skipped++;
  };
  for (const block of doc.blocks) {
    count(block.delta);
    for (const cell of block.cells ?? []) count(cell.delta);
  }
  return { images, skipped };
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback.
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// ---------- attribute mapping ----------

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

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

function alignFor(a: AlignValue | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (a) {
    case "left":
      return AlignmentType.LEFT;
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
}

function cssColorToDocxHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  // docx expects RRGGBB without leading '#'.
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    // expand short hex
    return c
      .slice(1)
      .split("")
      .map((d) => d + d)
      .join("")
      .toUpperCase();
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    return [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  // Named colors / other forms — let docx fall back to default.
  return undefined;
}

/**
 * docx sizes are in half-points (24 = 12pt). Parse common CSS sizes.
 * Returns `undefined` when not parseable so callers can pick a default.
 */
function parseFontSizeToHalfPoints(size: string | undefined): number | undefined {
  if (!size) return undefined;
  const s = size.trim();
  const m = /^(-?\d*\.?\d+)\s*(pt|px|em|rem)?$/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = (m[2] ?? "pt").toLowerCase();
  const pt =
    unit === "pt"
      ? n
      : unit === "px"
        ? n * 0.75 // CSS px → pt at 96dpi
        : n * 12;
  return Math.round(pt * 2);
}

// ---------- list numbering definitions ----------

function buildBulletLevels(): Array<{
  level: number;
  format: (typeof LevelFormat)[keyof typeof LevelFormat];
  text: string;
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  style?: { paragraph?: { indent?: { left: number; hanging: number } } };
}> {
  const symbols = ["•", "◦", "▪", "•", "◦", "▪"];
  return symbols.map((sym, i) => ({
    level: i,
    format: LevelFormat.BULLET,
    text: sym,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: { indent: { left: 360 + i * 360, hanging: 260 } },
    },
  }));
}

function buildOrderedLevels(): Array<{
  level: number;
  format: (typeof LevelFormat)[keyof typeof LevelFormat];
  text: string;
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  style?: { paragraph?: { indent?: { left: number; hanging: number } } };
}> {
  const formats = [
    LevelFormat.DECIMAL,
    LevelFormat.LOWER_LETTER,
    LevelFormat.LOWER_ROMAN,
    LevelFormat.DECIMAL,
    LevelFormat.LOWER_LETTER,
    LevelFormat.LOWER_ROMAN,
  ];
  return formats.map((format, i) => ({
    level: i,
    format,
    text: `%${i + 1}.`,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: { indent: { left: 360 + i * 360, hanging: 260 } },
    },
  }));
}
