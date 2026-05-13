import type { DeltaOp, MarkAttrs } from "@sofereditor/core";
import {
  attr,
  childrenOf,
  findChild,
  tagOf,
  type OoxmlNode,
} from "./parse-xml";
import { docxHexToCssColor, halfPointsToCssPt } from "./units";
import { extractImageFromDrawing, type ImageContext } from "./images";

export interface RunContext extends ImageContext {}

/**
 * Walk a paragraph's children (post `<w:pPr>`) and emit a `DeltaOp[]`. Combines
 * adjacent runs that share the same mark set into a single op for parity with
 * the export — Y.Text.applyDelta would merge them anyway, but pre-merging keeps
 * round-trip output stable.
 */
export function paragraphChildrenToDelta(children: OoxmlNode[], ctx: RunContext): DeltaOp[] {
  const ops: DeltaOp[] = [];
  for (const child of children) {
    const tag = tagOf(child);
    if (!tag) continue;
    if (tag === "w:pPr") continue;
    if (tag === "w:r") {
      collectRun(child, ctx, undefined, ops);
    } else if (tag === "w:hyperlink") {
      // hyperlinks carry an r:id that maps via relationships to the href.
      const rId = attr(child, "r:id");
      const href = rId ? ctx.relationships.get(rId) : undefined;
      const linkMark: MarkAttrs | undefined = href ? { link: { href } } : undefined;
      for (const sub of childrenOf(child)) {
        if (tagOf(sub) === "w:r") collectRun(sub, ctx, linkMark, ops);
      }
    }
  }
  return mergeAdjacent(ops);
}

function collectRun(
  run: OoxmlNode,
  ctx: RunContext,
  wrappingMarks: MarkAttrs | undefined,
  out: DeltaOp[],
): void {
  const marks = mergeMarks(wrappingMarks, runMarks(findChild(run, "w:rPr")));
  for (const child of childrenOf(run)) {
    const tag = tagOf(child);
    if (!tag) continue;
    if (tag === "w:t") {
      const text = textContent(child);
      if (text.length > 0) push(out, text, marks);
    } else if (tag === "w:tab") {
      push(out, "\t", marks);
    } else if (tag === "w:br") {
      // Treat w:br type="page" as also a soft break for the model — we have no
      // explicit page-break node in the schema; pagination is computed live.
      push(out, "\n", marks);
    } else if (tag === "w:drawing") {
      const embed = extractImageFromDrawing(child, ctx);
      if (embed) out.push({ insert: embed });
    }
    // Other run children (w:sym, w:fldChar, etc.) are silently dropped.
  }
}

function runMarks(rPr: OoxmlNode | undefined): MarkAttrs {
  const m: MarkAttrs = {};
  if (!rPr) return m;
  for (const child of childrenOf(rPr)) {
    const tag = tagOf(child);
    if (!tag) continue;
    switch (tag) {
      case "w:b":
        if (!isFalse(attr(child, "w:val"))) m.bold = true;
        break;
      case "w:i":
        if (!isFalse(attr(child, "w:val"))) m.italic = true;
        break;
      case "w:u": {
        const val = attr(child, "w:val");
        if (val && val.toLowerCase() !== "none") m.underline = true;
        break;
      }
      case "w:strike":
        if (!isFalse(attr(child, "w:val"))) m.strike = true;
        break;
      case "w:color": {
        const hex = attr(child, "w:val");
        const css = docxHexToCssColor(hex);
        if (css) m.color = css;
        break;
      }
      // w:rFonts intentionally ignored: school standard is Arial for all
      // exams. Any font declared in the .docx is dropped on import so the
      // imported doc inherits Arial from `.ed-root` / PDF base stylesheet.
      case "w:sz": {
        const halfPts = Number.parseFloat(attr(child, "w:val") ?? "");
        const css = halfPointsToCssPt(halfPts);
        if (css) m.fontSize = css;
        break;
      }
    }
  }
  return m;
}

function mergeMarks(a: MarkAttrs | undefined, b: MarkAttrs): MarkAttrs {
  if (!a) return b;
  return { ...a, ...b };
}

function textContent(node: OoxmlNode): string {
  let out = "";
  for (const child of childrenOf(node)) {
    if ("#text" in child) {
      const t = child["#text"];
      if (typeof t === "string") out += t;
    }
  }
  return out;
}

function isFalse(val: string | undefined): boolean {
  if (val == null) return false;
  const v = val.toLowerCase();
  return v === "0" || v === "false" || v === "none";
}

function push(out: DeltaOp[], text: string, marks: MarkAttrs): void {
  const op: DeltaOp =
    Object.keys(marks).length === 0 ? { insert: text } : { insert: text, attributes: { ...marks } };
  out.push(op);
}

function mergeAdjacent(ops: DeltaOp[]): DeltaOp[] {
  const out: DeltaOp[] = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (
      prev &&
      typeof prev.insert === "string" &&
      typeof op.insert === "string" &&
      sameMarks(prev.attributes, op.attributes)
    ) {
      prev.insert = prev.insert + op.insert;
      continue;
    }
    out.push(op);
  }
  return out;
}

function sameMarks(a: MarkAttrs | undefined, b: MarkAttrs | undefined): boolean {
  const ak = a ? Object.keys(a).sort() : [];
  const bk = b ? Object.keys(b).sort() : [];
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    const av = (a as Record<string, unknown>)[ak[i]];
    const bv = (b as Record<string, unknown>)[bk[i]];
    if (typeof av === "object" && av !== null && typeof bv === "object" && bv !== null) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}
