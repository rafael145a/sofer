/**
 * Unit conversions between OOXML and the editor's serialized format.
 * These are the inverses of the helpers in `@sofer/export-docx/src/docx.ts`.
 */

/** docx half-points → CSS pt string. 24 (half-pt) → "12pt". */
export function halfPointsToCssPt(halfPoints: number): string | undefined {
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) return undefined;
  const pt = halfPoints / 2;
  return `${stripTrailingZeros(pt)}pt`;
}

/** OOXML RRGGBB (no '#') → CSS hex with leading '#'. */
export function docxHexToCssColor(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const m = /^[0-9a-f]{6}$/i.exec(hex.trim());
  if (!m) return undefined;
  return `#${hex.toLowerCase()}`;
}

/** OOXML alignment value → editor AlignValue. */
export function parseAlign(val: string | undefined): "left" | "center" | "right" | "justify" | undefined {
  if (!val) return undefined;
  switch (val.toLowerCase()) {
    case "left":
    case "start":
      return "left";
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "distribute":
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

/** Parse XML attribute that should be a positive integer. */
export function parseIntAttr(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return Math.trunc(val);
  if (typeof val !== "string") return fallback;
  const n = Number.parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

function stripTrailingZeros(n: number): string {
  // 12 → "12", 12.5 → "12.5"
  return Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, "");
}
