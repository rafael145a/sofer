import type { Position, Selection } from "./types";

export function isCollapsed(sel: Selection): boolean {
  return positionsEqual(sel.anchor, sel.focus);
}

export function positionsEqual(a: Position, b: Position): boolean {
  return (
    a.blockIndex === b.blockIndex &&
    (a.cellIndex ?? -1) === (b.cellIndex ?? -1) &&
    a.offset === b.offset
  );
}

export function comparePositions(a: Position, b: Position): number {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
  const ac = a.cellIndex ?? -1;
  const bc = b.cellIndex ?? -1;
  if (ac !== bc) return ac - bc;
  return a.offset - b.offset;
}

export function orderedRange(sel: Selection): { start: Position; end: Position } {
  if (comparePositions(sel.anchor, sel.focus) <= 0) {
    return { start: sel.anchor, end: sel.focus };
  }
  return { start: sel.focus, end: sel.anchor };
}

export function collapsedSelection(pos: Position): Selection {
  return { anchor: pos, focus: pos };
}

/**
 * Two positions are in the same "editable run" (same Y.Text) when they share
 * the block index AND the cellIndex (treating absent and present-with-undefined
 * the same way: a non-table position has cellIndex === undefined for both).
 */
export function sameTextRun(a: Position, b: Position): boolean {
  return a.blockIndex === b.blockIndex && (a.cellIndex ?? -1) === (b.cellIndex ?? -1);
}
