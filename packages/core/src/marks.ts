import type * as Y from "yjs";
import type { DeltaOp, MarkAttrs, MarkName } from "./types";

/**
 * Helpers for reading mark attributes off a Y.Text by inspecting its delta.
 * Writing is done with `yText.format(...)` directly in commands.ts.
 */

function iterateRunsInRange(
  yText: Y.Text,
  start: number,
  end: number,
  visit: (run: DeltaOp, runStart: number, runEnd: number) => void,
): void {
  if (start >= end) return;
  const delta = yText.toDelta() as DeltaOp[];
  let cursor = 0;
  for (const op of delta) {
    if (typeof op.insert !== "string") {
      // Embed: advance cursor (counts as 1 char) but don't visit — mark queries
      // are about text runs, not embed attributes.
      if (op.insert == null) continue;
      cursor += 1;
      if (cursor > end) break;
      continue;
    }
    const opStart = cursor;
    const opEnd = cursor + op.insert.length;
    cursor = opEnd;
    if (opEnd <= start) continue;
    if (opStart >= end) break;
    const runStart = Math.max(opStart, start);
    const runEnd = Math.min(opEnd, end);
    visit(op, runStart, runEnd);
  }
}

/**
 * Returns the marks observed across `[start, end)`. For each mark name encountered:
 *   - if every covered character has the same value, returns that value
 *   - if values differ OR some characters lack the mark, returns "mixed"
 */
export function getMarksInRange(
  yText: Y.Text,
  start: number,
  end: number,
): Partial<Record<MarkName, MarkAttrs[MarkName] | "mixed">> {
  const result: Partial<Record<MarkName, MarkAttrs[MarkName] | "mixed">> = {};
  if (start >= end) return result;

  // Track total covered length and per-mark covered length to detect "some chars lacked it".
  const total = end - start;
  const coveredByName: Partial<Record<MarkName, number>> = {};

  iterateRunsInRange(yText, start, end, (run, runStart, runEnd) => {
    const len = runEnd - runStart;
    const attrs = (run.attributes ?? {}) as MarkAttrs;
    (Object.keys(attrs) as MarkName[]).forEach((name) => {
      const value = attrs[name];
      if (value === undefined || value === null) return;
      const prev = result[name];
      if (prev === undefined) {
        result[name] = value;
      } else if (prev !== "mixed" && !sameMarkValue(prev, value)) {
        result[name] = "mixed";
      }
      coveredByName[name] = (coveredByName[name] ?? 0) + len;
    });
  });

  (Object.keys(result) as MarkName[]).forEach((name) => {
    if ((coveredByName[name] ?? 0) < total) {
      result[name] = "mixed";
    }
  });

  return result;
}

export function isMarkUniformInRange(
  yText: Y.Text,
  start: number,
  end: number,
  name: MarkName,
  value?: MarkAttrs[MarkName],
): boolean {
  if (start >= end) return false;
  const total = end - start;
  let covered = 0;
  let observed: MarkAttrs[MarkName] | undefined;
  let ok = true;
  iterateRunsInRange(yText, start, end, (run, runStart, runEnd) => {
    if (!ok) return;
    const len = runEnd - runStart;
    const attr = (run.attributes ?? {})[name];
    if (attr === undefined || attr === null) {
      ok = false;
      return;
    }
    if (value !== undefined && !sameMarkValue(value, attr)) {
      ok = false;
      return;
    }
    if (observed === undefined) {
      observed = attr;
    } else if (!sameMarkValue(observed, attr)) {
      ok = false;
      return;
    }
    covered += len;
  });
  return ok && covered === total;
}

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
 * Return the subset of `delta` covering `[start, end)` characters.
 * Embeds are atomic length-1 ops: included whole if their slot intersects the range.
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

function sameMarkValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "object" && typeof b === "object" && a && b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
  }
  return false;
}
