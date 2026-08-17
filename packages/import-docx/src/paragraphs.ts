import type {
  AlignValue,
  AnswerLineSpacing,
  BlockAttrs,
  BlockType,
  DeltaOp,
  SerializedBlock,
} from "@sofereditor/core";
import {
  attr,
  childrenOf,
  findChild,
  tagOf,
  type OoxmlNode,
} from "./parse-xml";
import { paragraphChildrenToDelta, type RunContext } from "./runs";
import { NumberingResolver } from "./numbering";
import { parseAlign } from "./units";

/**
 * Map a `<w:p>` element to a SerializedBlock. Decides between
 * `paragraph / heading / blockquote / codeBlock / listItem` based on the
 * paragraph style + `w:pPr` properties — mirrors the heuristics encoded in
 * `@sofereditor/export-docx/src/docx.ts`.
 */
export function paragraphToBlock(
  p: OoxmlNode,
  ctx: RunContext,
  numbering: NumberingResolver,
): SerializedBlock {
  const pPr = findChild(p, "w:pPr");
  const numPr = pPr ? findChild(pPr, "w:numPr") : undefined;
  const styleId = pPr ? attr(findChild(pPr, "w:pStyle") ?? {}, "w:val") : undefined;

  const delta = paragraphChildrenToDelta(childrenOf(p), ctx);
  const text = collectText(delta);
  const align = parseAlign(pPr ? attr(findChild(pPr, "w:jc") ?? {}, "w:val") : undefined);
  const isRtl = pPr ? !!findChild(pPr, "w:bidi") : false;

  // List? — numPr is the strongest signal.
  if (numPr) {
    const resolved = numbering.resolve(numPr);
    const attrs: BlockAttrs = {
      listKind: resolved?.listKind ?? "bullet",
      listLevel: resolved?.listLevel ?? 0,
    };
    if (resolved?.listKind === "ordered") {
      // O ordinal Word vai TEMPORARIAMENTE em listStart de todos os itens; o
      // pós-passe em docx.ts remove dos não-líderes (um listStart em item de
      // continuação quebraria o grupo no renderer). listStyle fica em todos —
      // itens do mesmo estilo agrupam; estilo diferente (ex.: a/b/c entre
      // questões decimais) quebra o grupo exatamente como no Word.
      if (resolved.ordinal != null) attrs.listStart = resolved.ordinal;
      if (resolved.listStyle) attrs.listStyle = resolved.listStyle;
    }
    if (align) attrs.align = align;
    if (isRtl) attrs.dir = "rtl";
    return { type: "listItem", text, delta, attrs };
  }

  // Heading?
  const headingLevel = styleId ? headingFromStyleId(styleId) : null;
  if (headingLevel != null) {
    const attrs: BlockAttrs = { level: headingLevel };
    if (align) attrs.align = align;
    if (isRtl) attrs.dir = "rtl";
    return { type: "heading", text, delta, attrs };
  }

  // Blockquote (export uses left border + 480 twip indent).
  if (pPr && hasLeftBorder(pPr)) {
    const attrs: BlockAttrs = {};
    if (align) attrs.align = align;
    if (isRtl) attrs.dir = "rtl";
    return { type: "blockquote", text, delta, attrs };
  }

  // Code block (export uses Consolas + light-gray shading).
  if (pPr && hasCodeBlockShading(pPr)) {
    const attrs: BlockAttrs = {};
    if (align) attrs.align = align;
    if (isRtl) attrs.dir = "rtl";
    return { type: "codeBlock", text, delta, attrs };
  }

  const attrs: BlockAttrs = {};
  if (align) attrs.align = align;
  if (isRtl) attrs.dir = "rtl";
  Object.assign(attrs, readAnswerLine(pPr, text.length > 0));
  return { type: "paragraph", text, delta, attrs };
}

/**
 * Parágrafo SEM texto e com borda INFERIOR = linha de resposta.
 *
 * A exigência de estar vazio é essencial: um parágrafo com texto e régua é um
 * título sublinhado, e convertê-lo em linha de resposta destruiria a semântica
 * do conteúdo. A borda ESQUERDA já é tratada antes como blockquote.
 */
function readAnswerLine(pPr: OoxmlNode | undefined, hasText: boolean): Partial<BlockAttrs> {
  if (!pPr || hasText) return {};
  const pBdr = findChild(pPr, "w:pBdr");
  if (!pBdr) return {};
  const bottom = findChild(pBdr, "w:bottom");
  if (!bottom) return {};
  const val = (attr(bottom, "w:val") ?? "").toLowerCase();
  if (val === "" || val === "none" || val === "nil") return {};
  return { answerLine: true, answerLineSpacing: readAnswerLineSpacing(pPr) };
}

/** 240 twips = 1 linha. Arredonda para o bucket suportado mais próximo. */
function readAnswerLineSpacing(pPr: OoxmlNode): AnswerLineSpacing {
  const sp = findChild(pPr, "w:spacing");
  const line = sp ? Number.parseFloat(attr(sp, "w:line") ?? "") : NaN;
  if (!Number.isFinite(line)) return 1;
  const buckets: AnswerLineSpacing[] = [1, 1.5, 2];
  let best: AnswerLineSpacing = 1;
  let bestDist = Infinity;
  for (const b of buckets) {
    const d = Math.abs(line - 240 * b);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
}

function collectText(delta: DeltaOp[]): string {
  let out = "";
  for (const op of delta) {
    if (typeof op.insert === "string") out += op.insert;
  }
  return out;
}

function headingFromStyleId(id: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const m = /^Heading\s*([1-6])$/i.exec(id);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return (n as 1 | 2 | 3 | 4 | 5 | 6) ?? null;
}

function hasLeftBorder(pPr: OoxmlNode): boolean {
  const pBdr = findChild(pPr, "w:pBdr");
  if (!pBdr) return false;
  return !!findChild(pBdr, "w:left");
}

function hasCodeBlockShading(pPr: OoxmlNode): boolean {
  const shd = findChild(pPr, "w:shd");
  if (!shd) return false;
  const fill = attr(shd, "w:fill");
  if (!fill) return false;
  return fill.toLowerCase() === "f1f5f9";
}

/** Whitelist the block types this module produces (used by callers for typing). */
export type ParagraphBlockType = Exclude<BlockType, "table">;
/** Whitelist the align values this module produces (used by callers for typing). */
export type ParagraphAlign = AlignValue;
