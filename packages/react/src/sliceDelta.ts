import type { DeltaOp } from "@editor/core";

/** Total number of inserted characters. Embeds (non-string inserts) count as 1. */
export function deltaLength(delta: DeltaOp[]): number {
  let sum = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") sum += op.insert.length;
    else if (op.insert != null) sum += 1;
  }
  return sum;
}

/**
 * Return the subset of `delta` covering `[start, end)` characters. Attributes
 * are preserved on each intersecting op. Embeds are atomic length-1 ops:
 * included whole if their slot intersects the range.
 */
export function sliceDelta(delta: DeltaOp[], start: number, end: number): DeltaOp[] {
  if (end <= start) return [];
  const out: DeltaOp[] = [];
  let cursor = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      const opStart = cursor;
      const opEnd = cursor + op.insert.length;
      cursor = opEnd;
      if (opEnd <= start) continue;
      if (opStart >= end) break;
      const sliceFrom = Math.max(opStart, start) - opStart;
      const sliceTo = Math.min(opEnd, end) - opStart;
      out.push({
        insert: op.insert.slice(sliceFrom, sliceTo),
        attributes: op.attributes,
      });
    } else if (op.insert != null) {
      const opStart = cursor;
      const opEnd = cursor + 1;
      cursor = opEnd;
      if (opEnd <= start) continue;
      if (opStart >= end) break;
      out.push({ insert: op.insert, attributes: op.attributes });
    }
  }
  return out;
}
