import type { Position, Selection } from "@sofereditor/core";

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

/**
 * `true` for a `<li>` of célula-lista that is NOT the first item of the list.
 *
 * The cell is a plain `Y.Text`: `"um\ndois"` becomes two `<li>`, and the `\n`
 * disappears from the DOM's text. Every `<li>` from the second on therefore
 * consumes one character of the model that has no corresponding DOM text —
 * the same situation as embeds, handled the same way in both directions.
 */
function isCellLineBoundary(n: Node): boolean {
  if (n.nodeType !== Node.ELEMENT_NODE) return false;
  const line = (n as HTMLElement).dataset.cellLine;
  return line != null && Number(line) > 0;
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
    // Fires for EVERY visit of a boundary `<li>`, whether it's the target
    // itself or just a node the walk passes through on the way to a
    // descendant target. This must run before the `n === target` check
    // below: `readDomSelection` feeds real browser selections into this
    // function, and a click into an empty line's `<li><br data-empty></li>`
    // (no text node to anchor into) lands the browser's anchor directly ON
    // that `<li>` — i.e. target CAN BE the boundary element itself, not
    // just an ancestor passed through. Checking only in the pass-through
    // branch (below the target check) silently drops the +1 for exactly
    // that anchor shape — cursor lands one line too early, invisibly, until
    // the next keystroke inserts the character on the wrong line.
    if (isCellLineBoundary(n)) offset += 1;
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

export function locatePoint(root: HTMLElement, pos: Position): DomPoint | null {
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
  let lastBoundary: HTMLElement | null = null;
  let lastText: Text | null = null;

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
      lastBoundary = null;
      lastText = n as Text;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (isRejectedSubtree(el, container!)) return;
    // Skip the float-wrap anchor — its slot in the model lives on the phantom.
    if (isImgEmbed(el) && isWrapAnchorImg(el)) return;
    // Mirrors the embed guard directly below: a `<li>` boundary consumes one
    // model char that has no DOM text. When `remaining` is already exhausted
    // right as we reach the boundary (e.g. the line before it was empty), a
    // naked decrement would run `remaining` negative — unreachable when
    // every line before the last is non-empty (the brief's arithmetic
    // table) but real for an empty leading/only line, e.g. `"\na"` or
    // `"\n"`.
    //
    // UNLIKE the embed case, the resolved point is NOT `(parent, index)`.
    // An embed is inline — `(parent, indexOfImg)` visually IS "end of the
    // text right before it", so pointing there is correct. A `<li>` is a
    // block boundary: `(ul, indexOfThisLi)` is a position BETWEEN list
    // items, which no caret can render inside — the actual point the model
    // offset addresses is the START of the PREVIOUS line, IF that line is
    // truly empty.
    //
    // It might not be: `remaining === 0` here also happens when the
    // previous line's last content was an embed (image or wrap-float
    // phantom) — the embed branch below already decremented `remaining` to
    // 0 without resolving (it only resolves inline when it's itself the
    // target of `remaining`), so the boundary sees the same `remaining ===
    // 0` a truly-empty previous line would produce. Inferring the point
    // from DOM sibling topology (`previousElementSibling`, offset 0) can't
    // tell the two apart — it always picks "start of previous line", wrong
    // when that line ends in an embed. The walk's own state can: `lastImg`
    // is set if and only if the last thing consumed before reaching this
    // boundary was an embed (mutually exclusive with `lastBoundary`/
    // `lastText`, reset by every other branch), so checking it first routes
    // to "right after the embed" — the same resolution the embed's own
    // trailing-fallback below already uses — before falling back to
    // "start of previous line" for the genuinely-empty case.
    if (isCellLineBoundary(el)) {
      if (remaining === 0) {
        if (lastImg) {
          const parent = (lastImg as HTMLElement).parentNode;
          if (parent) {
            result = { node: parent, offset: indexInParent(lastImg) + 1 };
            return;
          }
        }
        const prevLine = el.previousElementSibling;
        if (prevLine) {
          result = { node: prevLine, offset: 0 };
          return;
        }
      }
      remaining -= 1;
      lastBoundary = el;
      lastImg = null;
    }
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
      lastBoundary = null;
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
  // inside a trailing empty line if the last node visited was a boundary
  // `<li>` whose own content had nothing to absorb `remaining` (e.g. the
  // cell ends in "\n"). By construction this only fires when `lastBoundary`
  // itself was empty (any real text inside it would already have resolved
  // via the text-node branch above, before the walk could finish) — so the
  // point lives INSIDE `lastBoundary`, at its own offset 0, same reasoning
  // as the entry guard above but for the CURRENT boundary instead of the
  // previous one. `lastImg`/`lastBoundary` are kept mutually exclusive
  // above (each setter nulls the other), so at most one of the two blocks
  // below can fire; the order between them doesn't change behavior, only
  // which comment reads first.
  if (lastBoundary && remaining === 0) {
    return { node: lastBoundary, offset: 0 };
  }
  if (lastImg && remaining === 0) {
    const parent = (lastImg as HTMLElement).parentNode;
    if (parent) return { node: parent, offset: indexInParent(lastImg) + 1 };
  }
  // Offset overflowed the container's content (the model selection is
  // transiently AHEAD of the rendered DOM — insertText commits the new
  // selection one React commit before the new text). Clamp to the END of the
  // last text node so the caret stays at the end of the line. Collapsing to
  // the container's start instead would paint the caret at the start of the
  // line for one frame before the next commit corrects it (bug #1 flash).
  if (lastText) {
    const t = lastText as Text;
    return { node: t, offset: (t.textContent ?? "").length };
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

  // Already on the resolved points? Don't touch the live range. `removeAllRanges`
  // momentarily clears the selection (the caret blinks out), so re-applying an
  // identical selection is a visible no-op flash. This matters when the offset
  // clamped to the end of the line (model transiently ahead of the DOM): the
  // caret is already there, so we must leave it alone (bug #1 flash).
  if (
    domSel.anchorNode === anchorPt.node &&
    domSel.anchorOffset === anchorPt.offset &&
    domSel.focusNode === focusPt.node &&
    domSel.focusOffset === focusPt.offset
  ) {
    return;
  }

  try {
    domSel.removeAllRanges();
    domSel.setBaseAndExtent(anchorPt.node, anchorPt.offset, focusPt.node, focusPt.offset);
  } catch {
    // ignore — node may not be attached yet
  }
}
