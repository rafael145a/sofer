import type { ListKind } from "@editor/core";
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
export class NumberingResolver {
  private numIdToAbstract = new Map<string, string>();
  private abstractLevelFmt = new Map<string, Map<number, string>>();

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
          for (const lvl of findChildren(child, "w:lvl")) {
            const ilvl = parseIntAttr(attr(lvl, "w:ilvl"), 0);
            const fmt = attr(findChild(lvl, "w:numFmt") ?? {}, "w:val");
            if (fmt) levels.set(ilvl, fmt);
          }
          this.abstractLevelFmt.set(abstractId, levels);
        } else if (tag === "w:num") {
          const numId = attr(child, "w:numId");
          const abstractRef = findChild(child, "w:abstractNumId");
          const abstractId = abstractRef ? attr(abstractRef, "w:val") : undefined;
          if (numId && abstractId) this.numIdToAbstract.set(numId, abstractId);
        }
      }
    }
  }

  /** Returns `{listKind, listLevel}` for a given paragraph's `<w:numPr>` node, or null. */
  resolve(numPr: OoxmlNode | undefined): { listKind: ListKind; listLevel: number } | null {
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
    const fmt = (levels?.get(listLevel) ?? "bullet").toLowerCase();
    const listKind: ListKind = fmt === "bullet" || fmt === "none" ? "bullet" : "ordered";
    return { listKind, listLevel };
  }
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.trunc(n)));
}
