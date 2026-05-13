import type { Position, Selection } from "@sofer/core";

/**
 * Mapping between the model and the contenteditable DOM.
 *
 * Each block is rendered as one or more elements carrying `data-block-index`.
 * Unfragmented blocks have a single such element. A paragraph fragmented across
 * pages (Sub-phase 3.2) has multiple elements with the same `data-block-index`,
 * each carrying `data-fragment-start` / `data-fragment-end` indicating the
 * character offsets within the block's text that the element covers.
 *
 * Table blocks (Sub-phase 4.1) render the `<table>` itself with `data-block-index`.
 * Each `<td>` cell carries `data-cell-index` (flat row-major). Model positions
 * inside a table always include `cellIndex`; their `offset` is local to that
 * cell's text.
 */

/** Walks up from `node` to the first ancestor that carries `data-block-index`. */
function findContainingBlockElement(node: Node, root: HTMLElement): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.dataset.blockIndex != null) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** Walks up to the first ancestor carrying `data-cell-index`, stopping at the block element. */
function findContainingCellElement(
  node: Node,
  blockEl: HTMLElement,
): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== blockEl) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.dataset.cellIndex != null) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

export function findBlockIndex(node: Node, root: HTMLElement): number | null {
  const el = findContainingBlockElement(node, root);
  if (!el) return null;
  return Number.parseInt(el.dataset.blockIndex!, 10);
}

/**
 * Returns the first DOM element for `blockIndex`. For a fragmented block this
 * is the first fragment. Prefer `getFragmentForOffset` when you need the
 * fragment that contains a specific offset.
 */
export function getBlockElement(root: HTMLElement, blockIndex: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-block-index="${blockIndex}"]`);
}

function readFragmentStart(el: HTMLElement): number {
  const s = el.dataset.fragmentStart;
  if (s == null) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function readFragmentEnd(el: HTMLElement): number | undefined {
  const s = el.dataset.fragmentEnd;
  if (s == null) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Returns the DOM element responsible for `offset` inside `blockIndex`.
 * - Unfragmented block (single element): returns it.
 * - Fragmented block: returns the fragment whose `[start, end)` covers `offset`.
 *   For the end-of-block offset, returns the last fragment.
 */
export function getFragmentForOffset(
  root: HTMLElement,
  blockIndex: number,
  offset: number,
): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(`[data-block-index="${blockIndex}"]`);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  let last: HTMLElement | null = null;
  for (const el of candidates) {
    last = el;
    const start = readFragmentStart(el);
    const end = readFragmentEnd(el);
    if (end == null) return el;
    if (offset >= start && offset < end) return el;
  }
  return last; // end-of-block offset falls on the last fragment
}

/**
 * Returns the `<td>` element for `(blockIndex, cellIndex)`. Tables are
 * unfragmented in 4.1 so there's at most one block element to search inside.
 */
export function getCellElement(
  root: HTMLElement,
  blockIndex: number,
  cellIndex: number,
): HTMLElement | null {
  const blockEl = getBlockElement(root, blockIndex);
  if (!blockEl) return null;
  return blockEl.querySelector<HTMLElement>(`[data-cell-index="${cellIndex}"]`);
}

/**
 * `true` when `el` is an image embed (a length-1 atomic insert in the model).
 * Image embeds participate in offset arithmetic as 1 char each. Intentionally
 * not a type predicate — narrowing `n is HTMLElement` would collapse the
 * "already an HTMLElement" path to `never` and break downstream code.
 */
function isImgEmbed(n: Node): boolean {
  return (
    n.nodeType === Node.ELEMENT_NODE &&
    (n as HTMLElement).dataset.embed === "image"
  );
}

/**
 * `true` when `el` is the float-wrap anchor `<img>` rendered at the START of a
 * block (so CSS float can wrap text around it). The model places this embed at
 * its original offset — represented in the DOM by a zero-width phantom span —
 * so the anchor itself must be SKIPPED during offset counting.
 */
function isWrapAnchorImg(n: Node): boolean {
  return (
    n.nodeType === Node.ELEMENT_NODE &&
    (n as HTMLElement).dataset.wrapAnchor === "true"
  );
}

/**
 * `true` when `el` is the zero-width sentinel left at the model offset of a
 * float-wrap image. Counts as 1 char in offset arithmetic, mirroring how the
 * embed counts in the model.
 */
function isPhantomEmbed(n: Node): boolean {
  return (
    n.nodeType === Node.ELEMENT_NODE &&
    (n as HTMLElement).dataset.embedPhantom === "true"
  );
}

/** Index of `n` within its parent's `childNodes`. */
function indexInParent(n: Node): number {
  const parent = n.parentNode;
  if (!parent) return 0;
  let i = 0;
  for (const c of Array.from(parent.childNodes)) {
    if (c === n) return i;
    i++;
  }
  return 0;
}

/**
 * `true` when the subtree rooted at `el` should be skipped during a
 * container-scoped walk — i.e. it belongs to a different block or to a sibling
 * cell when scoping a cell container.
 */
function isRejectedSubtree(el: HTMLElement, container: HTMLElement): boolean {
  if (el === container) return false;
  if (el.dataset.blockIndex != null) return true;
  if (container.dataset.cellIndex != null && el.dataset.cellIndex != null) return true;
  return false;
}

/**
 * Sum length of all text nodes plus 1 for each image embed inside `container`,
 * up to the boundary defined by `(node, offsetInNode)`. Mirrors how the model
 * counts characters: embeds are atomic length-1 inserts.
 */
export function textOffsetWithin(
  container: HTMLElement,
  node: Node,
  offsetInNode: number,
): number {
  // Normalize an anchor pointing AT an image embed to (parent, indexOfImg).
  let target: Node = node;
  let targetOff = offsetInNode;
  if (isImgEmbed(target) && target.parentNode) {
    targetOff = indexInParent(target);
    target = target.parentNode as Node;
  }

  let offset = 0;
  let done = false;

  function visit(n: Node): void {
    if (done) return;
    if (n === target) {
      if (n.nodeType === Node.TEXT_NODE) {
        offset += targetOff;
        done = true;
        return;
      }
      // Element target: consume childNodes[0..targetOff-1] recursively.
      const children = n.childNodes;
      for (let i = 0; i < targetOff && i < children.length; i++) {
        visit(children[i]);
        if (done) return;
      }
      done = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      offset += (n.textContent ?? "").length;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (isRejectedSubtree(el, container)) return;
    // Float-wrap anchor `<img>` is rendered at the block start as a pure
    // visual; its model position lives in the phantom span downstream.
    if (isImgEmbed(el) && isWrapAnchorImg(el)) return;
    if (isImgEmbed(el) || isPhantomEmbed(el)) {
      offset += 1;
      return;
    }
    for (const child of Array.from(el.childNodes)) {
      visit(child);
      if (done) return;
    }
  }

  visit(container);
  return offset;
}

interface ResolvedAnchor {
  blockIdx: number;
  cellIdx: number | undefined;
  /** The element whose text content offsets are computed against. */
  container: HTMLElement;
  /** Number to add to within-container offsets — non-zero only for fragmented blocks. */
  containerStart: number;
}

function resolveAnchorElement(
  node: Node,
  root: HTMLElement,
): ResolvedAnchor | null {
  const blockEl = findContainingBlockElement(node, root);
  if (!blockEl) return null;
  const blockIdx = Number.parseInt(blockEl.dataset.blockIndex!, 10);
  const blockType = blockEl.dataset.blockType;
  if (blockType === "table") {
    const cellEl = findContainingCellElement(node, blockEl);
    if (!cellEl) {
      // Click landed inside the table but not in any cell — snap to first cell.
      const firstCell = blockEl.querySelector<HTMLElement>("[data-cell-index]");
      if (!firstCell) return null;
      return {
        blockIdx,
        cellIdx: 0,
        container: firstCell,
        containerStart: 0,
      };
    }
    const cellIdx = Number.parseInt(cellEl.dataset.cellIndex!, 10);
    return {
      blockIdx,
      cellIdx,
      container: cellEl,
      containerStart: 0,
    };
  }
  return {
    blockIdx,
    cellIdx: undefined,
    container: blockEl,
    containerStart: readFragmentStart(blockEl),
  };
}

export function readDomSelection(root: HTMLElement): Selection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  if (!sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;

  const a = resolveAnchorElement(sel.anchorNode, root);
  const f = resolveAnchorElement(sel.focusNode, root);
  if (!a || !f) return null;

  const anchor: Position = {
    blockIndex: a.blockIdx,
    cellIndex: a.cellIdx,
    offset: a.containerStart + textOffsetWithin(a.container, sel.anchorNode, sel.anchorOffset),
  };
  const focus: Position = {
    blockIndex: f.blockIdx,
    cellIndex: f.cellIdx,
    offset: f.containerStart + textOffsetWithin(f.container, sel.focusNode, sel.focusOffset),
  };
  return { anchor, focus };
}

interface DomPoint {
  node: Node;
  offset: number;
}

function locatePoint(root: HTMLElement, pos: Position): DomPoint | null {
  let container: HTMLElement | null;
  let containerStart = 0;

  if (pos.cellIndex != null) {
    container = getCellElement(root, pos.blockIndex, pos.cellIndex);
    if (!container) return null;
  } else {
    container = getFragmentForOffset(root, pos.blockIndex, pos.offset);
    if (!container) return null;
    containerStart = readFragmentStart(container);
  }

  let remaining = Math.max(0, pos.offset - containerStart);
  let result: DomPoint | null = null;
  let lastImg: HTMLElement | null = null;

  function visit(n: Node): void {
    if (result) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? "").length;
      if (remaining <= len) {
        result = { node: n, offset: remaining };
        return;
      }
      remaining -= len;
      lastImg = null;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (isRejectedSubtree(el, container!)) return;
    // Skip the float-wrap anchor — its slot in the model lives on the phantom.
    if (isImgEmbed(el) && isWrapAnchorImg(el)) return;
    if (isImgEmbed(el) || isPhantomEmbed(el)) {
      if (remaining === 0) {
        const parent = el.parentNode;
        if (parent) {
          result = { node: parent, offset: indexInParent(el) };
          return;
        }
      }
      remaining -= 1;
      lastImg = el;
      return;
    }
    for (const child of Array.from(el.childNodes)) {
      visit(child);
      if (result) return;
    }
  }

  visit(container);
  if (result) return result;

  // Walked the whole container without consuming `remaining` — caret lands
  // just AFTER the last embed if it was the last visited node, otherwise at
  // the container's start as a last-resort fallback.
  if (lastImg && remaining === 0) {
    const parent = (lastImg as HTMLElement).parentNode;
    if (parent) return { node: parent, offset: indexInParent(lastImg) + 1 };
  }
  return { node: container, offset: 0 };
}

export function selectionsEqual(a: Selection, b: Selection): boolean {
  return (
    a.anchor.blockIndex === b.anchor.blockIndex &&
    (a.anchor.cellIndex ?? -1) === (b.anchor.cellIndex ?? -1) &&
    a.anchor.offset === b.anchor.offset &&
    a.focus.blockIndex === b.focus.blockIndex &&
    (a.focus.cellIndex ?? -1) === (b.focus.cellIndex ?? -1) &&
    a.focus.offset === b.focus.offset
  );
}

/**
 * `true` when the selection is a rectangular table-cell range — both endpoints
 * inside cells of the same block, addressing different cells. The visual
 * highlight comes from CSS classes applied by `<TableView>`; we deliberately
 * leave the native DOM selection empty so the browser doesn't draw a confusing
 * cross-`<td>` range.
 */
export function isTableRectSelection(sel: Selection): boolean {
  if (sel.anchor.blockIndex !== sel.focus.blockIndex) return false;
  if (sel.anchor.cellIndex == null || sel.focus.cellIndex == null) return false;
  return sel.anchor.cellIndex !== sel.focus.cellIndex;
}

export function applyDomSelection(root: HTMLElement, modelSel: Selection): void {
  const domSel = window.getSelection();
  if (!domSel) return;
  if (isTableRectSelection(modelSel)) {
    // Don't paint a native range — TableView highlights the rect via classes.
    domSel.removeAllRanges();
    return;
  }
  const anchorPt = locatePoint(root, modelSel.anchor);
  const focusPt = locatePoint(root, modelSel.focus);
  if (!anchorPt || !focusPt) return;

  try {
    domSel.removeAllRanges();
    domSel.setBaseAndExtent(anchorPt.node, anchorPt.offset, focusPt.node, focusPt.offset);
  } catch {
    // ignore — node may not be attached yet
  }
}
