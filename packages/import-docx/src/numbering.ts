import type { ListKind, ListStyleType } from "@sofereditor/core";
import {
  attr,
  childrenOf,
  findChild,
  findChildren,
  tagOf,
  type OoxmlNode,
} from "./parse-xml";
import { parseIntAttr } from "./units";

/**
 * Resolves per-paragraph `<w:numPr>` into the editor's `{listKind, listLevel}`.
 *
 * docx numbering is two-step:
 *   1. paragraphs reference a `numId` and an `ilvl`
 *   2. each `<w:num numId="...">` points to a `<w:abstractNum>` via `<w:abstractNumId>`
 *   3. each `<w:lvl ilvl="...">` declares a `<w:numFmt val="bullet|decimal|...">`
 *
 * The export side uses two hardcoded reference names ("ed-bullet" / "ed-ordered"),
 * but Word-authored documents use arbitrary `numId`s — we resolve by reading the
 * `numFmt` of the target level.
 */
/** `w:numFmt` → CSS `list-style-type` do editor. Não listados caem em "decimal". */
const FMT_TO_LIST_STYLE: Record<string, ListStyleType> = {
  decimal: "decimal",
  lowerLetter: "lower-alpha",
  upperLetter: "upper-alpha",
  lowerRoman: "lower-roman",
  upperRoman: "upper-roman",
};

export interface ResolvedNumbering {
  listKind: ListKind;
  listLevel: number;
  /**
   * Número Word desta entrada (contador por instância `numId`+nível, honrando
   * `w:start` e resetando níveis mais profundos). Só para `ordered`. O Word
   * numera por INSTÂNCIA — parágrafos comuns entre itens não resetam a
   * contagem — enquanto o editor numera por adjacência; o importador usa este
   * ordinal para semear `listStart` nos líderes de grupo (ver docx.ts).
   */
  ordinal?: number;
  /** Estilo do nível (`w:numFmt` mapeado). Só para `ordered`. */
  listStyle?: ListStyleType;
}

export class NumberingResolver {
  private numIdToAbstract = new Map<string, string>();
  private abstractLevelFmt = new Map<string, Map<number, string>>();
  private abstractLevelStart = new Map<string, Map<number, number>>();
  /** Contadores vivos por instância de lista (numId), indexados por nível. */
  private counters = new Map<string, number[]>();

  constructor(numberingXml: OoxmlNode[] | undefined) {
    if (!numberingXml) return;
    for (const top of numberingXml) {
      if (tagOf(top) !== "w:numbering") continue;
      for (const child of childrenOf(top)) {
        const tag = tagOf(child);
        if (tag === "w:abstractNum") {
          const abstractId = attr(child, "w:abstractNumId");
          if (!abstractId) continue;
          const levels = new Map<number, string>();
          const starts = new Map<number, number>();
          for (const lvl of findChildren(child, "w:lvl")) {
            const ilvl = parseIntAttr(attr(lvl, "w:ilvl"), 0);
            const fmt = attr(findChild(lvl, "w:numFmt") ?? {}, "w:val");
            if (fmt) levels.set(ilvl, fmt);
            const start = findChild(lvl, "w:start");
            if (start) starts.set(ilvl, parseIntAttr(attr(start, "w:val"), 1));
          }
          this.abstractLevelFmt.set(abstractId, levels);
          this.abstractLevelStart.set(abstractId, starts);
        } else if (tag === "w:num") {
          const numId = attr(child, "w:numId");
          const abstractRef = findChild(child, "w:abstractNumId");
          const abstractId = abstractRef ? attr(abstractRef, "w:val") : undefined;
          if (numId && abstractId) this.numIdToAbstract.set(numId, abstractId);
        }
      }
    }
  }

  /**
   * Resolves a paragraph's `<w:numPr>` into `{listKind, listLevel, ordinal?,
   * listStyle?}`, or null. STATEFUL for ordered lists: each call advances the
   * per-`numId` counter (Word instance semantics) — call exactly once per
   * numbered paragraph, in document order.
   */
  resolve(numPr: OoxmlNode | undefined): ResolvedNumbering | null {
    if (!numPr) return null;
    const ilvlRef = findChild(numPr, "w:ilvl");
    const numIdRef = findChild(numPr, "w:numId");
    if (!numIdRef) return null;
    const numId = attr(numIdRef, "w:val");
    if (!numId) return null;
    const listLevel = clampLevel(parseIntAttr(ilvlRef ? attr(ilvlRef, "w:val") : undefined, 0));
    const abstractId = this.numIdToAbstract.get(numId);
    if (abstractId == null) {
      // Numbering refs the export side defines without a numbering.xml entry visible
      // to us (the export-docx pipeline generates them dynamically via the docx lib).
      // Fall back by inspecting the numId itself when it is a known sentinel.
      return { listKind: "bullet", listLevel };
    }
    const levels = this.abstractLevelFmt.get(abstractId);
    const fmt = levels?.get(listLevel) ?? "bullet";
    const fmtLower = fmt.toLowerCase();
    const listKind: ListKind = fmtLower === "bullet" || fmtLower === "none" ? "bullet" : "ordered";
    if (listKind === "bullet") return { listKind, listLevel };

    // Ordinal Word: contador por numId; nível avança, níveis mais profundos resetam.
    const start = this.abstractLevelStart.get(abstractId)?.get(listLevel) ?? 1;
    const c = this.counters.get(numId) ?? [];
    c[listLevel] = c[listLevel] == null ? start : c[listLevel] + 1;
    c.length = listLevel + 1;
    this.counters.set(numId, c);

    return {
      listKind,
      listLevel,
      ordinal: c[listLevel],
      listStyle: FMT_TO_LIST_STYLE[fmt] ?? "decimal",
    };
  }
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.trunc(n)));
}
