import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Sub-phase 3.2 — page layout with intra-paragraph fragmentation.
 *
 * Two-phase render cycle:
 *   1. "measure" phase: editor renders with the default (unfragmented) layout
 *      — every top-level on page 1. After the DOM commits, `usePageLayout`
 *      reads each top-level's geometry, runs `computeLayout`, and sets the
 *      real layout (with page splits and fragment offsets).
 *   2. "stable" phase: editor renders the real layout. No further measurement
 *      until `deps` change (typically `[topLevels]`), at which point we go
 *      back to step 1.
 *
 * Fragmentation only applies to "fragmentable" top-levels (paragraph, heading,
 * blockquote — single Y.Text blocks). List groups and code blocks are placed
 * atomically: if they don't fit they jump to the next page and bleed if larger
 * than a page.
 */

export interface PageGeometry {
  /** Page width in CSS px (A4 @ 96dpi = ~794). */
  width: number;
  /** Page height in CSS px (A4 @ 96dpi = ~1123). */
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /**
   * Espaço adicional somado ao marginTop só na 1ª página. Útil para clientes
   * que rendem um header fixo (timbrado, identificação) na pág 1 via
   * `renderPageHeader` e não querem que esse espaço seja reservado nas demais.
   * Quando omitido, todas as páginas têm a mesma `contentHeight`.
   */
  firstPageExtraTop?: number;
}

export const A4_PAGE: PageGeometry = {
  width: 794,
  height: 1123,
  marginTop: 96,
  marginBottom: 96,
  marginLeft: 96,
  marginRight: 96,
};

export function contentHeight(g: PageGeometry, pageIndex: number = 0): number {
  const extra = pageIndex === 0 ? g.firstPageExtraTop ?? 0 : 0;
  return g.height - g.marginTop - g.marginBottom - extra;
}

export function contentWidth(g: PageGeometry): number {
  return g.width - g.marginLeft - g.marginRight;
}

export interface BlockFragment {
  index: number;
  start: number;
  end: number;
}

export interface TableRowFragment {
  /** 0, 1, 2... sequential fragment id within the table. */
  index: number;
  /** First row included (inclusive). */
  rowStart: number;
  /** First row NOT included (exclusive). */
  rowEnd: number;
}

export interface ListItemRangeFragment {
  /** 0, 1, 2... sequential fragment id within the list group. */
  index: number;
  /** First top-level item (level 0) included (inclusive). */
  itemStart: number;
  /** First top-level item (level 0) NOT included (exclusive). */
  itemEnd: number;
}

export interface PageSlot {
  topLevelIndex: number;
  /** Set when this slot represents a paragraph/heading/blockquote line-level fragment. */
  fragment?: BlockFragment;
  /** Set when this slot is a row-range fragment of a table (Sub-phase 4.6). */
  tableFragment?: TableRowFragment;
  /** Set when this slot is an item-range fragment of an ordered/bullet list. */
  listFragment?: ListItemRangeFragment;
}

export interface PageEntry {
  slots: PageSlot[];
}

export interface PageLayout {
  pages: PageEntry[];
}

export function defaultPageLayout(topLevelCount: number): PageLayout {
  return {
    pages: [
      {
        slots: Array.from({ length: topLevelCount }, (_, i) => ({ topLevelIndex: i })),
      },
    ],
  };
}

export type PaginationPhase = "measure" | "stable";

export interface PageLayoutResult {
  layout: PageLayout;
  /**
   * "measure" between a deps change and the post-commit measurement; "stable"
   * once the layout matches the rendered DOM. Consumers can hide the caret /
   * suppress visible flashes during "measure" (the DOM is briefly in the
   * unfragmented intermediate state and the native caret may jump to the start
   * of the line before useLayoutEffect re-applies the model selection).
   */
  phase: PaginationPhase;
}

export function usePageLayout(
  rootRef: RefObject<HTMLElement>,
  geometry: PageGeometry,
  topLevelCount: number,
  deps: ReadonlyArray<unknown>,
): PageLayoutResult {
  const [phase, setPhase] = useState<PaginationPhase>("measure");
  const [layout, setLayout] = useState<PageLayout>(() => defaultPageLayout(topLevelCount));
  const lastDepsRef = useRef<unknown[] | null>(null);

  // Reset effect: when `deps` (consumer-provided), `topLevelCount`, or
  // `geometry` change, go back to the unfragmented default layout and
  // re-enter the measure phase.
  //
  // Why a useLayoutEffect (instead of `setState` in render body, the previous
  // approach): with concurrent rendering / Strict Mode, mutating
  // `lastDepsRef.current` during render is fragile — React may discard a
  // render pass while keeping the ref mutation, so a subsequent pass sees
  // "deps unchanged" and the reset never fires. The historical symptom was
  // a doc whose N blocks arrived entirely via remote `Y.applyUpdate`
  // (e.g. an Hocuspocus / y-websocket sync): the editor's snapshot updated
  // to N in `useEditor`, but `layout` stayed at 1 page × 1 slot — the reset
  // condition in the old render-body path silently missed firing.
  //
  // Doing the reset in a useLayoutEffect runs after the commit (so refs are
  // stable and visible), but BEFORE paint (so the user never sees a frame
  // with stale layout). The phase change schedules a synchronous re-render
  // and the measure effect below picks up immediately.
  //
  // Equality uses `shallowArrayEqual` for deps (consumer's responsibility to
  // pass stable references / structural keys) and `layoutsDeepEqual` for
  // the layout itself (fragment-aware — see the historical bug where shallow
  // equality let a fragmented layout matching `1 page × 1 slot` survive the
  // reset and lock subsequent measures via `!isUnfragmented(layout)`).
  useLayoutEffect(() => {
    const currentDeps = [...deps, topLevelCount, geometry];
    if (lastDepsRef.current !== null && shallowArrayEqual(lastDepsRef.current, currentDeps)) {
      return;
    }
    lastDepsRef.current = currentDeps;
    setLayout((prev) => {
      const next = defaultPageLayout(topLevelCount);
      return layoutsDeepEqual(prev, next) ? prev : next;
    });
    setPhase("measure");
    // No dependency array: this effect runs after every commit and decides
    // internally whether deps changed. We can't put `[...deps, topLevelCount, geometry]`
    // here because `deps` is a variable-length array from the caller — React's
    // hook deps must be a fixed-shape list. Running every commit is cheap (one
    // shallow array compare).
  });

  // Measure effect: when in the measure phase with an unfragmented layout,
  // read the DOM and compute the real (possibly multi-page, possibly
  // fragmented) layout. Returns to the "stable" phase.
  useLayoutEffect(() => {
    if (phase !== "measure") return;
    const root = rootRef.current;
    if (!root) return;
    // Only safe to measure when the DOM is in the unfragmented state.
    if (!isUnfragmented(layout)) return;
    const next = computeLayout(root, geometry, topLevelCount);
    if (!layoutsDeepEqual(layout, next)) setLayout(next);
    setPhase("stable");
  }, [phase, layout, geometry, topLevelCount, rootRef]);

  return { layout, phase };
}

// ---------- Layout computation ----------

function isUnfragmented(layout: PageLayout): boolean {
  return (
    layout.pages.length === 1 &&
    layout.pages[0].slots.every(
      (s) =>
        s.fragment === undefined &&
        s.tableFragment === undefined &&
        s.listFragment === undefined,
    )
  );
}

function computeLayout(
  root: HTMLElement,
  geometry: PageGeometry,
  topLevelCount: number,
): PageLayout {
  const tops = collectTopLevelElements(root);
  if (tops.length === 0) return defaultPageLayout(topLevelCount);

  // `firstPageExtraTop` faz a pág 0 ter content height menor; usar uma função
  // permite recomputar quando empurramos novas páginas.
  const limitFor = (pageIndex: number) => contentHeight(geometry, pageIndex);
  const pages: PageEntry[] = [{ slots: [] }];
  let currentPage = pages[0];
  let limit = limitFor(0);
  let used = 0;

  const cap = Math.min(tops.length, topLevelCount);
  for (let i = 0; i < cap; i++) {
    const el = tops[i];
    const h = elTotalHeight(el);

    if (used + h <= limit) {
      currentPage.slots.push({ topLevelIndex: i });
      used += h;
      continue;
    }

    if (isFragmentable(el)) {
      const result = placeFragmentedBlock(el, i, pages, used, limitFor);
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = result.lastUsed;
      continue;
    }

    if (isTableTopLevel(el)) {
      const result = placeFragmentedTable(el, i, pages, used, limitFor);
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = result.lastUsed;
      continue;
    }

    if (isListTopLevel(el)) {
      const result = placeFragmentedList(el, i, pages, used, limitFor);
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = result.lastUsed;
      continue;
    }

    // Atomic top-level that doesn't fit
    if (currentPage.slots.length === 0) {
      // empty current page; place anyway (bleed if huge)
      currentPage.slots.push({ topLevelIndex: i });
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = 0;
    } else {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      currentPage.slots.push({ topLevelIndex: i });
      used = h;
    }
  }

  // Strip trailing empty page if any
  if (pages.length > 1 && pages[pages.length - 1].slots.length === 0) pages.pop();

  return { pages };
}

function placeFragmentedBlock(
  el: HTMLElement,
  topLevelIndex: number,
  pages: PageEntry[],
  startUsed: number,
  limitFor: (pageIndex: number) => number,
): { lastUsed: number } {
  let limit = limitFor(pages.length - 1);
  const totalChars = getBlockTextLength(el);
  if (totalChars === 0) {
    const h = elTotalHeight(el);
    let currentPage = pages[pages.length - 1];
    if (startUsed + h > limit && currentPage.slots.length > 0) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      startUsed = 0;
    }
    currentPage.slots.push({ topLevelIndex });
    return { lastUsed: startUsed + h };
  }

  // Measure every original line. Splitting only at line boundaries is what
  // makes fragmentation work correctly: when fragment K starts at an original
  // line boundary AND is rendered at the same width, its line wrapping matches
  // the original exactly, so our measured height predicts the rendered height.
  const lines = measureLines(el);
  if (lines.length === 0) {
    // Couldn't measure (no text nodes?) — place atomically as last resort.
    const h = elTotalHeight(el);
    let currentPage = pages[pages.length - 1];
    if (startUsed + h > limit && currentPage.slots.length > 0) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      startUsed = 0;
    }
    currentPage.slots.push({ topLevelIndex });
    return { lastUsed: startUsed + h };
  }

  let lineIdx = 0;
  let currentPage = pages[pages.length - 1];
  let used = startUsed;
  let fragIndex = 0;

  while (lineIdx < lines.length) {
    const available = Math.max(0, limit - used);
    if (available <= 0) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = 0;
      continue;
    }

    // Greedy: include as many consecutive lines as fit. bestK is the last fitting line index.
    const startTop = lines[lineIdx].top;
    let bestK = -1;
    for (let k = lineIdx; k < lines.length; k++) {
      const h = lines[k].bottom - startTop;
      if (h <= available) bestK = k;
      else break;
    }

    if (bestK < 0) {
      // Not even one line fits in the remaining space.
      if (currentPage.slots.length === 0) {
        // Page is empty; force-place a single oversized line (bleed).
        bestK = lineIdx;
      } else {
        pages.push({ slots: [] });
        currentPage = pages[pages.length - 1];
        limit = limitFor(pages.length - 1);
        used = 0;
        continue;
      }
    }

    const fragStart = lines[lineIdx].start;
    const fragEnd = bestK + 1 < lines.length ? lines[bestK + 1].start : totalChars;
    const fragHeight = lines[bestK].bottom - startTop;

    currentPage.slots.push({
      topLevelIndex,
      fragment: { index: fragIndex, start: fragStart, end: fragEnd },
    });
    used += fragHeight;
    fragIndex++;
    lineIdx = bestK + 1;

    if (lineIdx < lines.length) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = 0;
    }
  }

  return { lastUsed: used };
}

interface LineMetric {
  /** Char offset (within the block) of the first char on this line. */
  start: number;
  /** Viewport-y top of the line. */
  top: number;
  /** Viewport-y bottom of the line. */
  bottom: number;
}

/**
 * Walk every text node inside `el`, measuring each character's rect to detect
 * line boundaries. Linear in total character count.
 *
 * Memoized by `(offsetWidth, textContent)`: a block whose width and text
 * haven't changed (the common case during typing — only ONE block changes per
 * keystroke) skips the measurement entirely. This is the perf core of Sub-phase
 * 3.3's incremental repagination story.
 *
 * NOTE: cached `top`/`bottom` are viewport-absolute, but `placeFragmentedBlock`
 * only ever uses RELATIVE differences (`lines[k].bottom - lines[j].top`), which
 * are invariant to scroll/layout offsets — so cached values stay correct.
 */
const lineMetricsCache = new Map<string, LineMetric[]>();
const LINE_METRICS_CACHE_LIMIT = 200;

function measureLines(el: HTMLElement): LineMetric[] {
  const text = el.textContent ?? "";
  const cacheKey = `${el.offsetWidth}|${text}`;
  const cached = lineMetricsCache.get(cacheKey);
  if (cached) {
    // LRU touch
    lineMetricsCache.delete(cacheKey);
    lineMetricsCache.set(cacheKey, cached);
    return cached;
  }

  const fresh = measureLinesUncached(el);
  lineMetricsCache.set(cacheKey, fresh);
  if (lineMetricsCache.size > LINE_METRICS_CACHE_LIMIT) {
    const oldest = lineMetricsCache.keys().next().value;
    if (oldest !== undefined) lineMetricsCache.delete(oldest);
  }
  return fresh;
}

function measureLinesUncached(el: HTMLElement): LineMetric[] {
  const range = document.createRange();
  const lines: LineMetric[] = [];

  // Walk text nodes AND image embeds — embeds count as 1 char in offset
  // arithmetic and contribute their bounding rect as a line (or part of one).
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    blockBoundaryFilter(el),
  );
  let n: Node | null;
  let charOffset = 0;

  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        try {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
        } catch {
          continue;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const last = lines[lines.length - 1];
        if (!last || rect.top >= last.bottom) {
          lines.push({ start: charOffset + i, top: rect.top, bottom: rect.bottom });
        } else {
          last.top = Math.min(last.top, rect.top);
          last.bottom = Math.max(last.bottom, rect.bottom);
        }
      }
      charOffset += text.length;
      continue;
    }
    if (
      n.nodeType === Node.ELEMENT_NODE &&
      (n as HTMLElement).dataset.embed === "image"
    ) {
      const rect = (n as HTMLElement).getBoundingClientRect();
      if (rect.height > 0) {
        const last = lines[lines.length - 1];
        if (!last || rect.top >= last.bottom) {
          lines.push({ start: charOffset, top: rect.top, bottom: rect.bottom });
        } else {
          last.top = Math.min(last.top, rect.top);
          last.bottom = Math.max(last.bottom, rect.bottom);
        }
      }
      charOffset += 1;
    }
  }
  return lines;
}

// ---------- DOM measurement primitives ----------

function elTotalHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const m = parseFloat(cs.marginTop || "0") + parseFloat(cs.marginBottom || "0");
  return el.offsetHeight + m;
}

function isFragmentable(el: HTMLElement): boolean {
  // Top-level fragmentable types: paragraph, heading, blockquote.
  // Tables fragment via `placeFragmentedTable` (row-level), not the line engine.
  const type = el.getAttribute("data-block-type");
  if (type === "paragraph") return true;
  if (type === "heading") return true;
  if (type === "blockquote") return true;
  return false;
}

/**
 * The top-level for a table block is a `<div class="ed-table-wrap">` wrapper —
 * the `data-block-type="table"` attribute lives on the nested `<table>`.
 */
function isTableTopLevel(el: HTMLElement): boolean {
  return el.querySelector(':scope > table[data-block-type="table"]') !== null;
}

interface PlaceFragmentedTableResult { lastUsed: number; }

/**
 * Sub-phase 4.6 — split a table that doesn't fit on the current page across
 * pages at row boundaries.
 *
 * Constraints:
 * - A break between rows `r` and `r+1` is INVALID when any cell with
 *   `rowSpan > 1` whose owner sits at row `r' <= r` extends into row `r+1`.
 *   We compute this by walking each row's `<td>`s: a `rowSpan = N > 1` at row
 *   `r` blocks the boundaries `(r, r+1), (r+1, r+2), … (r+N-2, r+N-1)`.
 *
 * - If no clean break fits the available height (e.g. a very tall span at the
 *   top of the table), and the current page already has content, we move to
 *   the next page and try again. If even an empty page can't fit a valid
 *   prefix, we bleed the smallest legal prefix rather than loop forever.
 *
 * Heights come from `<tr>.getBoundingClientRect()` — these are measured against
 * the unfragmented render, but row layout is invariant under fragmentation as
 * long as the `<colgroup>` widths don't change (they don't), and as long as a
 * span isn't cut (which is exactly the constraint above).
 */
function placeFragmentedTable(
  el: HTMLElement,
  topLevelIndex: number,
  pages: PageEntry[],
  startUsed: number,
  limitFor: (pageIndex: number) => number,
): PlaceFragmentedTableResult {
  let limit = limitFor(pages.length - 1);
  const table = el.querySelector(':scope > table[data-block-type="table"]') as HTMLTableElement | null;
  const tbody = table?.querySelector(':scope > tbody');
  const trs = tbody ? (Array.from(tbody.children) as HTMLTableRowElement[]) : [];
  if (trs.length === 0) {
    // Empty / no rows — fall back to atomic.
    const h = elTotalHeight(el);
    let currentPage = pages[pages.length - 1];
    if (startUsed + h > limit && currentPage.slots.length > 0) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      startUsed = 0;
    }
    currentPage.slots.push({ topLevelIndex });
    return { lastUsed: startUsed + h };
  }

  const rowHeights = trs.map((tr) => tr.getBoundingClientRect().height);

  // Invalid break boundaries — indices `k` for which the break between row `k`
  // and `k+1` is blocked by a rowspan crossing it.
  const invalid = new Set<number>();
  for (let r = 0; r < trs.length; r++) {
    const tds = Array.from(trs[r].children) as HTMLTableCellElement[];
    for (const td of tds) {
      const rs = td.rowSpan || 1;
      if (rs > 1) {
        for (let k = r; k <= r + rs - 2 && k < trs.length - 1; k++) {
          invalid.add(k);
        }
      }
    }
  }

  // Vertical padding/margin around the table proper, distributed conservatively
  // onto the FIRST fragment only — keeps subsequent fragments compact.
  const wrapHeight = elTotalHeight(el);
  const tableHeight = table ? table.getBoundingClientRect().height : 0;
  const chrome = Math.max(0, wrapHeight - tableHeight);

  let rowIdx = 0;
  let used = startUsed;
  let fragIndex = 0;
  let currentPage = pages[pages.length - 1];

  while (rowIdx < trs.length) {
    const overhead = fragIndex === 0 ? chrome : 0;
    const available = Math.max(0, limit - used - overhead);
    if (available <= 0) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = 0;
      continue;
    }

    // Greedy: keep extending the run as long as height fits and we haven't
    // passed a valid break boundary. Track the LAST valid `bestEnd`.
    let bestEnd = -1;
    let accH = 0;
    for (let k = rowIdx; k < trs.length; k++) {
      accH += rowHeights[k];
      if (accH > available) break;
      if (k === trs.length - 1 || !invalid.has(k)) bestEnd = k + 1;
    }

    if (bestEnd < 0) {
      if (currentPage.slots.length === 0) {
        // Empty page yet still no valid prefix fits — find the smallest legal
        // prefix and bleed (better than an infinite loop).
        let k = rowIdx;
        while (k < trs.length - 1 && invalid.has(k)) k++;
        bestEnd = k + 1;
      } else {
        pages.push({ slots: [] });
        currentPage = pages[pages.length - 1];
        limit = limitFor(pages.length - 1);
        used = 0;
        continue;
      }
    }

    let fragHeight = 0;
    for (let k = rowIdx; k < bestEnd; k++) fragHeight += rowHeights[k];
    if (fragIndex === 0) fragHeight += chrome;

    currentPage.slots.push({
      topLevelIndex,
      tableFragment: { index: fragIndex, rowStart: rowIdx, rowEnd: bestEnd },
    });
    used += fragHeight;
    fragIndex++;
    rowIdx = bestEnd;

    if (rowIdx < trs.length) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = 0;
    }
  }

  return { lastUsed: used };
}

/**
 * A top-level for a list group is the `<ol>` or `<ul>` rendered by
 * `renderListTree`. Its direct `<li>` children are the level-0 entries of
 * the group; nested sub-lists live INSIDE those `<li>`s and travel with them.
 */
function isListTopLevel(el: HTMLElement): boolean {
  if (el.tagName !== "OL" && el.tagName !== "UL") return false;
  return el.classList.contains("ed-list");
}

interface PlaceFragmentedListResult { lastUsed: number; }

/**
 * Split a list group that doesn't fit on the current page across pages at
 * top-level `<li>` boundaries. Nested sub-lists stay attached to their parent
 * `<li>` (we never break inside a nested list — that's reserved for the rare
 * case where a single top-level item is itself taller than a full page, in
 * which case we bleed it).
 *
 * Heights come from `<li>.getBoundingClientRect()` measured against the
 * unfragmented render. They include the nested sub-list height when present.
 */
function placeFragmentedList(
  el: HTMLElement,
  topLevelIndex: number,
  pages: PageEntry[],
  startUsed: number,
  limitFor: (pageIndex: number) => number,
): PlaceFragmentedListResult {
  let limit = limitFor(pages.length - 1);

  // Direct <li> children of the top-level <ol>/<ul>. Filter strictly by
  // `.ed-listitem` class so any other DOM injected by the consumer (markers,
  // dividers) doesn't get counted as an item.
  const items: HTMLLIElement[] = [];
  for (const c of Array.from(el.children)) {
    if (c instanceof HTMLLIElement && c.classList.contains("ed-listitem")) {
      items.push(c);
    }
  }

  if (items.length === 0) {
    const h = elTotalHeight(el);
    let currentPage = pages[pages.length - 1];
    if (startUsed + h > limit && currentPage.slots.length > 0) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      startUsed = 0;
    }
    currentPage.slots.push({ topLevelIndex });
    return { lastUsed: startUsed + h };
  }

  const heights = items.map((li) => elTotalHeight(li));
  // Vertical padding/margin contributed by the wrapping <ol>/<ul> itself
  // (margin-block + padding-block beyond the sum of item heights). We charge
  // this overhead only to the FIRST fragment's page so subsequent continuation
  // fragments don't double-count it.
  const sumHeights = heights.reduce((a, b) => a + b, 0);
  const wrapperOverhead = Math.max(0, elTotalHeight(el) - sumHeights);

  let i = 0;
  let currentPage = pages[pages.length - 1];
  let used = startUsed;
  let fragIndex = 0;

  while (i < items.length) {
    const available = Math.max(0, limit - used);
    // Greedy: include as many consecutive items as fit. bestK is the last
    // fitting item index.
    const isFirstFragment = fragIndex === 0;
    let bestK = -1;
    let runningH = isFirstFragment ? wrapperOverhead : 0;
    for (let k = i; k < items.length; k++) {
      runningH += heights[k];
      if (runningH <= available) bestK = k;
      else break;
    }

    if (bestK < 0) {
      // Not even one item fits in the remaining space.
      if (currentPage.slots.length === 0) {
        // Page is empty; force-place a single oversized item (bleed).
        bestK = i;
      } else {
        // Move to next page and retry.
        pages.push({ slots: [] });
        currentPage = pages[pages.length - 1];
        limit = limitFor(pages.length - 1);
        used = 0;
        continue;
      }
    }

    currentPage.slots.push({
      topLevelIndex,
      listFragment: { index: fragIndex, itemStart: i, itemEnd: bestK + 1 },
    });

    // Account for consumed height on the current page.
    let consumed = isFirstFragment ? wrapperOverhead : 0;
    for (let k = i; k <= bestK; k++) consumed += heights[k];
    used += consumed;

    i = bestK + 1;
    fragIndex++;
    if (i < items.length) {
      pages.push({ slots: [] });
      currentPage = pages[pages.length - 1];
      limit = limitFor(pages.length - 1);
      used = 0;
    }
  }

  return { lastUsed: used };
}

function collectTopLevelElements(root: HTMLElement): HTMLElement[] {
  // The root may be in one of three shapes:
  //   - flat:         root > top1, top2, ...
  //   - paged simple: root > .ed-page > .ed-page-content > top1, top2, ...
  //   - paged + fragments: same as above, but some "tops" are fragments of the
  //                        same block index. We don't expect to be called in
  //                        that state (caller guards on isUnfragmented), so
  //                        collecting direct children is fine.
  const pageContents = root.querySelectorAll<HTMLElement>(":scope > .ed-page > .ed-page-content");
  if (pageContents.length > 0) {
    const out: HTMLElement[] = [];
    pageContents.forEach((pc) => {
      Array.from(pc.children).forEach((c) => out.push(c as HTMLElement));
    });
    return out;
  }
  return Array.from(root.children) as HTMLElement[];
}

/**
 * Sum text-node lengths inside `el` plus 1 for each image embed, skipping any
 * descendant `[data-block-index]`. Mirrors the model's notion of "length".
 */
function getBlockTextLength(el: HTMLElement): number {
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    blockBoundaryFilter(el),
  );
  let n: Node | null;
  let sum = 0;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      sum += (n.textContent ?? "").length;
    } else if (
      n.nodeType === Node.ELEMENT_NODE &&
      (n as HTMLElement).dataset.embed === "image"
    ) {
      sum += 1;
    }
  }
  return sum;
}

function blockBoundaryFilter(blockEl: HTMLElement): NodeFilter {
  return {
    acceptNode(n: Node) {
      let p: Node | null = n.parentNode;
      while (p && p !== blockEl) {
        if (p.nodeType === Node.ELEMENT_NODE) {
          const e = p as HTMLElement;
          if (e.dataset.blockIndex != null) return NodeFilter.FILTER_REJECT;
        }
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  };
}

// ---------- Equality helpers ----------

function shallowArrayEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function layoutsDeepEqual(a: PageLayout, b: PageLayout): boolean {
  if (a.pages.length !== b.pages.length) return false;
  for (let i = 0; i < a.pages.length; i++) {
    const sA = a.pages[i].slots;
    const sB = b.pages[i].slots;
    if (sA.length !== sB.length) return false;
    for (let j = 0; j < sA.length; j++) {
      if (sA[j].topLevelIndex !== sB[j].topLevelIndex) return false;
      const fA = sA[j].fragment;
      const fB = sB[j].fragment;
      if (fA || fB) {
        if (!fA || !fB) return false;
        if (fA.index !== fB.index || fA.start !== fB.start || fA.end !== fB.end) return false;
      }
      const tA = sA[j].tableFragment;
      const tB = sB[j].tableFragment;
      if (tA || tB) {
        if (!tA || !tB) return false;
        if (tA.index !== tB.index || tA.rowStart !== tB.rowStart || tA.rowEnd !== tB.rowEnd) {
          return false;
        }
      }
      const lA = sA[j].listFragment;
      const lB = sB[j].listFragment;
      if (lA || lB) {
        if (!lA || !lB) return false;
        if (lA.index !== lB.index || lA.itemStart !== lB.itemStart || lA.itemEnd !== lB.itemEnd) {
          return false;
        }
      }
    }
  }
  return true;
}
