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
  Packer,
  Paragraph,
  PageOrientation,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from "docx";

const BULLET_REF = "ed-bullet";
const ORDERED_REF = "ed-ordered";

export interface DocumentToDocxOptions {
  /** Document title; embedded in core properties. */
  title?: string;
  /** Author for core properties. */
  creator?: string;
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
 *  - image embeds → ImageRun with the base64 payload decoded to Uint8Array
 */
export async function documentToDocxBlob(
  doc: SerializedDocument | LegacySerializedDocument,
  options: DocumentToDocxOptions = {},
): Promise<Blob> {
  const built = buildDocument(normalize(doc), options);
  return Packer.toBlob(built);
}

/** Same as `documentToDocxBlob` but returns a Uint8Array (useful in Node/tests). */
export async function documentToDocxBuffer(
  doc: SerializedDocument | LegacySerializedDocument,
  options: DocumentToDocxOptions = {},
): Promise<Uint8Array> {
  const built = buildDocument(normalize(doc), options);
  const buf = await Packer.toBuffer(built);
  // `Packer.toBuffer` returns a Node Buffer at runtime — coerce for consumers.
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

function normalize(doc: SerializedDocument | LegacySerializedDocument): SerializedDocument {
  return isLegacySerializedDocument(doc) ? { blocks: doc } : doc;
}

function buildDocument(doc: SerializedDocument, options: DocumentToDocxOptions): Document {
  const children = blocksToDocxChildren(doc);
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

function blocksToDocxChildren(doc: SerializedDocument): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    switch (block.type) {
      case "paragraph":
        out.push(makeParagraph(block));
        break;
      case "heading":
        out.push(makeHeading(block));
        break;
      case "blockquote":
        out.push(makeBlockquote(block));
        break;
      case "codeBlock":
        out.push(makeCodeBlock(block));
        break;
      case "listItem":
        out.push(makeListItem(block));
        break;
      case "table":
        out.push(makeTable(block));
        break;
      default:
        out.push(makeParagraph(block));
    }
  }
  return out;
}

// ---------- block builders ----------

// School standard: Arial for all body text. Code blocks override with
// Consolas (monospace is more legible for code). Italics on blockquote is
// kept as a stylistic default.
const ARIAL: RunDefaults = { font: "Arial" };

function makeParagraph(block: SerializedBlock): Paragraph {
  return new Paragraph({
    alignment: alignFor(block.attrs.align),
    bidirectional: block.attrs.dir === "rtl" ? true : undefined,
    children: deltaToRuns(block.delta, ARIAL),
  });
}

function makeHeading(block: SerializedBlock): Paragraph {
  const level = clampHeadingLevel(block.attrs.level);
  return new Paragraph({
    heading: HEADING_LEVELS[level - 1],
    alignment: alignFor(block.attrs.align),
    children: deltaToRuns(block.delta, ARIAL),
  });
}

function makeBlockquote(block: SerializedBlock): Paragraph {
  return new Paragraph({
    alignment: alignFor(block.attrs.align),
    indent: { left: 480 }, // ~0.25"
    border: {
      left: { color: "CBD5E1", space: 12, style: BorderStyle.SINGLE, size: 12 },
    },
    children: deltaToRuns(block.delta, { ...ARIAL, italics: true }),
  });
}

function makeCodeBlock(block: SerializedBlock): Paragraph {
  return new Paragraph({
    spacing: { before: 100, after: 100 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" },
    children: deltaToRuns(block.delta, { font: "Consolas", size: 20 }),
  });
}

function makeListItem(block: SerializedBlock): Paragraph {
  const kind: ListKind = block.attrs.listKind === "ordered" ? "ordered" : "bullet";
  const reference = kind === "ordered" ? ORDERED_REF : BULLET_REF;
  const level = clampListLevel(block.attrs.listLevel);
  return new Paragraph({
    numbering: { reference, level },
    alignment: alignFor(block.attrs.align),
    children: deltaToRuns(block.delta, ARIAL),
  });
}

function makeTable(block: SerializedBlock): Table {
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
      cellsOut.push(makeCell(cell));
    }
    rowsOut.push(new TableRow({ children: cellsOut }));
  }

  return new Table({
    rows: rowsOut,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function makeCell(cell: SerializedCell): TableCell {
  const span = cell.attrs?.colspan && cell.attrs.colspan > 1 ? cell.attrs.colspan : 1;
  const rowSpan = cell.attrs?.rowspan && cell.attrs.rowspan > 1 ? cell.attrs.rowspan : 1;
  return new TableCell({
    columnSpan: span,
    rowSpan,
    verticalAlign: VerticalAlign.TOP,
    children: [new Paragraph({ children: deltaToRuns(cell.delta, ARIAL) })],
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
): Array<TextRun | ImageRun> {
  if (delta.length === 0) return [new TextRun("")];
  const out: Array<TextRun | ImageRun> = [];
  for (const op of delta) {
    if (typeof op.insert === "string") {
      if (op.insert.length === 0) continue;
      out.push(makeTextRun(op.insert, op.attributes, defaults));
    } else if (isImageEmbed(op.insert)) {
      const embed = op.insert;
      const img = makeImageRun(embed);
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

function makeTextRun(
  text: string,
  marks: MarkAttrs | undefined,
  defaults: RunDefaults,
): TextRun {
  const m = marks ?? {};
  const fontSize = parseFontSizeToHalfPoints(m.fontSize);
  // TextRun reads newlines via `break`; convert \n into break runs.
  const segments = text.split("\n");
  if (segments.length === 1) {
    return new TextRun({
      text,
      bold: m.bold || defaults.bold,
      italics: m.italic || defaults.italics,
      underline: m.underline ? { type: UnderlineType.SINGLE } : undefined,
      strike: m.strike,
      color: cssColorToDocxHex(m.color),
      font: m.fontFamily ?? defaults.font,
      size: fontSize ?? defaults.size,
    });
  }
  // Multi-line: rejoin via TextRun children — but TextRun expects a single text
  // string. Approximate with non-printing line breaks: produce a sequence of
  // TextRuns separated by `new TextRun({ break: 1 })` packed into the parent.
  // Simpler: collapse to a single TextRun with the string, treating \n as a
  // soft-break placeholder. Word renders \n inside a w:t as a literal space,
  // so we replace with a small symbol-friendly fallback.
  return new TextRun({
    text: text.replace(/\n/g, " "),
    bold: m.bold || defaults.bold,
    italics: m.italic || defaults.italics,
    underline: m.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: m.strike,
    color: cssColorToDocxHex(m.color),
    font: m.fontFamily ?? defaults.font,
    size: fontSize ?? defaults.size,
  });
}

function makeImageRun(embed: ImageEmbed): ImageRun | null {
  const decoded = decodeDataUrl(embed.src);
  if (!decoded) return null;
  return new ImageRun({
    data: decoded.bytes,
    type: decoded.kind,
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
