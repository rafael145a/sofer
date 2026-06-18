// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Position, Selection } from "@sofereditor/core";
import {
  applyDomSelection,
  findBlockIndex,
  getBlockElement,
  getCellElement,
  getFragmentForOffset,
  isTableRectSelection,
  locatePoint,
  readDomSelection,
  selectionsEqual,
  textOffsetWithin,
} from "../dom-bridge";

// These tests build DOM by hand to match exactly what the React renderer emits
// (see renderInline.tsx / NodeView.tsx). The attributes asserted against are the
// real contract: `data-block-index`, `data-block-type`, `data-cell-index`,
// `data-fragment-start/-end`, `data-embed="image"`, `data-wrap-anchor="true"`,
// `data-embed-phantom="true"`.

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "ed-root";
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// findBlockIndex / getBlockElement
// ---------------------------------------------------------------------------
describe("findBlockIndex / getBlockElement", () => {
  it("resolves a text node inside a block to its data-block-index", () => {
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">hello</div>` +
        `<div data-block-index="1" data-block-type="paragraph">world</div>`,
    );
    const block1 = root.children[1] as HTMLElement;
    const textNode = block1.firstChild!; // "world"
    expect(findBlockIndex(textNode, root)).toBe(1);
  });

  it("returns null for a node outside any block", () => {
    const root = makeRoot(`<span id="loose">loose</span>`);
    const loose = root.querySelector("#loose")!.firstChild!;
    expect(findBlockIndex(loose, root)).toBeNull();
  });

  it("resolves a nested element to the nearest block ancestor", () => {
    const root = makeRoot(
      `<div data-block-index="3" data-block-type="paragraph">` +
        `<strong><em id="deep">x</em></strong></div>`,
    );
    const deep = root.querySelector("#deep")!;
    expect(findBlockIndex(deep, root)).toBe(3);
  });

  it("getBlockElement returns the first element for a block index", () => {
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">a</div>` +
        `<div data-block-index="5" data-block-type="paragraph">b</div>`,
    );
    const el = getBlockElement(root, 5);
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("b");
  });

  it("getBlockElement returns the first fragment for a fragmented block", () => {
    const root = makeRoot(
      `<div data-block-index="2" data-block-type="paragraph" data-fragment-start="0" data-fragment-end="4">frag</div>` +
        `<div data-block-index="2" data-block-type="paragraph" data-fragment-start="4" data-fragment-end="8">ment</div>`,
    );
    const el = getBlockElement(root, 2);
    expect(el!.dataset.fragmentStart).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// getFragmentForOffset
// ---------------------------------------------------------------------------
describe("getFragmentForOffset", () => {
  function fragmentedRoot(): HTMLElement {
    // Block 0 split: fragment A covers [0,4), fragment B covers [4,8).
    return makeRoot(
      `<div data-block-index="0" data-block-type="paragraph" data-fragment-start="0" data-fragment-end="4">aaaa</div>` +
        `<div data-block-index="0" data-block-type="paragraph" data-fragment-start="4" data-fragment-end="8">bbbb</div>`,
    );
  }

  it("returns the single element for an unfragmented block", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">x</div>`);
    const el = getFragmentForOffset(root, 0, 0);
    expect(el!.textContent).toBe("x");
  });

  it("offset < K resolves to the first fragment", () => {
    const root = fragmentedRoot();
    const el = getFragmentForOffset(root, 0, 2);
    expect(el!.textContent).toBe("aaaa");
  });

  it("offset >= K resolves to the second fragment", () => {
    const root = fragmentedRoot();
    const el = getFragmentForOffset(root, 0, 4);
    expect(el!.textContent).toBe("bbbb");
  });

  it("end-of-block offset falls on the last fragment", () => {
    const root = fragmentedRoot();
    // offset 8 == end of block; no [start,end) covers it → returns last.
    const el = getFragmentForOffset(root, 0, 8);
    expect(el!.textContent).toBe("bbbb");
  });

  it("returns null when no element carries the block index", () => {
    const root = makeRoot(`<div data-block-index="1" data-block-type="paragraph">a</div>`);
    expect(getFragmentForOffset(root, 99, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCellElement
// ---------------------------------------------------------------------------
describe("getCellElement", () => {
  function tableRoot(): HTMLElement {
    return makeRoot(
      `<div class="ed-table-wrap"><table data-block-index="0" data-block-type="table"><tbody>` +
        `<tr data-cell-row="0">` +
        `<td data-cell-index="0">c0</td>` +
        `<td data-cell-index="1">c1</td>` +
        `</tr><tr data-cell-row="1">` +
        `<td data-cell-index="2">c2</td>` +
        `<td data-cell-index="3">c3</td>` +
        `</tr></tbody></table></div>`,
    );
  }

  it("returns the cell matching a given cellIndex", () => {
    const root = tableRoot();
    expect(getCellElement(root, 0, 2)!.textContent).toBe("c2");
    expect(getCellElement(root, 0, 1)!.textContent).toBe("c1");
  });

  it("returns null for a missing cell", () => {
    const root = tableRoot();
    expect(getCellElement(root, 0, 99)).toBeNull();
  });

  it("returns null when the block does not exist", () => {
    const root = tableRoot();
    expect(getCellElement(root, 7, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// textOffsetWithin
// ---------------------------------------------------------------------------
describe("textOffsetWithin", () => {
  it("(a) caret mid-text counts characters up to the boundary", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">hello</div>`);
    const block = root.firstElementChild as HTMLElement;
    const textNode = block.firstChild!; // "hello"
    expect(textOffsetWithin(block, textNode, 3)).toBe(3);
  });

  it("(a) text spread across nested mark elements", () => {
    // "AB" + <strong>"CD"</strong> ; caret at offset 1 inside the strong text.
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">AB<strong>CD</strong></div>`,
    );
    const block = root.firstElementChild as HTMLElement;
    const strongText = block.querySelector("strong")!.firstChild!; // "CD"
    // Counts "AB" (2) before the strong subtree + 1 into "CD" = 3.
    expect(textOffsetWithin(block, strongText, 1)).toBe(3);
  });

  it("(b)+(c) an embed counts +1; figure-wrapped img is nesting-agnostic", () => {
    // "AB" + <figure><img data-embed="image"></figure> + "CD".
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">AB` +
        `<figure class="ed-figure"><img data-embed="image" data-embed-offset="2"></figure>` +
        `CD</div>`,
    );
    const block = root.firstElementChild as HTMLElement;
    const cdText = block.childNodes[block.childNodes.length - 1]; // "CD"
    // "AB" (2) + figure-wrapped embed (1) = 3 ; caret at start of "CD".
    expect(textOffsetWithin(block, cdText, 0)).toBe(3);
  });

  it("(b) anchor pointing AT the img normalizes to (parent, index) and lands before it", () => {
    // "AB" + <img data-embed="image"> (no figure wrapper here for a clean
    // "anchor AT the img" case) + "CD".
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">AB` +
        `<img data-embed="image" data-embed-offset="2">CD</div>`,
    );
    const block = root.firstElementChild as HTMLElement;
    const img = block.querySelector("img")!;
    // Anchor is the img itself with offset 0; normalizes to (parent, indexOfImg)
    // and counts only text BEFORE the img = "AB" = 2 (caret lands before embed).
    expect(textOffsetWithin(block, img, 0)).toBe(2);
  });

  it("(d) a wrap-anchor img is SKIPPED, (e) the phantom span counts +1", () => {
    // Real wrap layout: anchor <img data-wrap-anchor> emitted first (skipped),
    // then a zero-width phantom span at the embed's true offset (counts +1),
    // then the body text.
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">` +
        `<img data-embed="image" data-wrap-anchor="true" data-embed-offset="0">` +
        `<span data-embed-phantom="true" data-embed-offset="0"></span>` +
        `XY</div>`,
    );
    const block = root.firstElementChild as HTMLElement;
    const xy = block.childNodes[block.childNodes.length - 1]; // "XY"
    // anchor skipped (0) + phantom (1) + caret at start of "XY" = 1.
    expect(textOffsetWithin(block, xy, 0)).toBe(1);
    // Caret 2 into "XY" → phantom (1) + 2 = 3.
    expect(textOffsetWithin(block, xy, 2)).toBe(3);
  });

  it("ignores a sibling block's subtree (isRejectedSubtree)", () => {
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">AB` +
        `<div data-block-index="1" data-block-type="paragraph">ZZZZ</div>` +
        `</div>`,
    );
    const block0 = root.firstElementChild as HTMLElement;
    const abText = block0.firstChild!; // "AB"
    // Walking block0 with caret at end of "AB" — the nested block-1 subtree is
    // rejected, so it does not contribute even though it is a DOM descendant.
    expect(textOffsetWithin(block0, abText, 2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// locatePoint <-> textOffsetWithin round-trip (unfragmented => containerStart 0)
// ---------------------------------------------------------------------------
describe("locatePoint <-> textOffsetWithin round-trip", () => {
  it("round-trips text-only offsets", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">hello</div>`);
    const block = root.firstElementChild as HTMLElement;
    for (const off of [0, 1, 3, 5]) {
      const pos: Position = { blockIndex: 0, offset: off };
      const pt = locatePoint(root, pos)!;
      expect(pt).not.toBeNull();
      expect(textOffsetWithin(block, pt.node, pt.offset)).toBe(off);
    }
  });

  it("round-trips offsets before and after an embed", () => {
    // "AB" + figure(img) + "CD" => model length 5 (A B [img] C D).
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">AB` +
        `<figure class="ed-figure"><img data-embed="image" data-embed-offset="2"></figure>` +
        `CD</div>`,
    );
    const block = root.firstElementChild as HTMLElement;
    // 0,1,2 = within/before embed ; 3 = just after embed ; 4,5 = in "CD".
    for (const off of [0, 1, 2, 3, 4, 5]) {
      const pos: Position = { blockIndex: 0, offset: off };
      const pt = locatePoint(root, pos)!;
      expect(pt, `offset ${off}`).not.toBeNull();
      expect(textOffsetWithin(block, pt.node, pt.offset), `offset ${off}`).toBe(off);
    }
  });

  it("locatePoint returns null for an unknown block", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">x</div>`);
    expect(locatePoint(root, { blockIndex: 42, offset: 0 })).toBeNull();
  });

  // Regression (bug #1 caret flash): when the model selection is transiently
  // AHEAD of the rendered DOM (insertText commits the new selection in one
  // React commit and the new text in the next), an out-of-range offset must
  // clamp to the END of the last text node — NOT collapse to the container's
  // start (offset 0), which paints the caret at the start of the line for one
  // frame before the next commit corrects it.
  it("clamps an out-of-range offset to the end of the last text node", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">hello</div>`);
    const block = root.firstElementChild as HTMLElement;
    const textNode = block.firstChild as Text;
    // Model wants offset 6 but the DOM text node only holds 5 chars.
    const pt = locatePoint(root, { blockIndex: 0, offset: 6 })!;
    expect(pt).not.toBeNull();
    expect(pt.node).toBe(textNode);
    expect(pt.offset).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// selectionsEqual (pure)
// ---------------------------------------------------------------------------
describe("selectionsEqual", () => {
  const sel = (
    aB: number, aO: number, fB: number, fO: number,
    aC?: number, fC?: number,
  ): Selection => ({
    anchor: { blockIndex: aB, cellIndex: aC, offset: aO },
    focus: { blockIndex: fB, cellIndex: fC, offset: fO },
  });

  it("equal selections compare equal", () => {
    expect(selectionsEqual(sel(0, 0, 1, 3), sel(0, 0, 1, 3))).toBe(true);
  });

  it("different anchor offset compares unequal", () => {
    expect(selectionsEqual(sel(0, 0, 1, 3), sel(0, 1, 1, 3))).toBe(false);
  });

  it("different focus block compares unequal", () => {
    expect(selectionsEqual(sel(0, 0, 1, 3), sel(0, 0, 2, 3))).toBe(false);
  });

  it("undefined and null cellIndex both normalize to -1 (equal)", () => {
    const a: Selection = {
      anchor: { blockIndex: 0, cellIndex: undefined, offset: 0 },
      focus: { blockIndex: 0, cellIndex: undefined, offset: 1 },
    };
    const b: Selection = {
      anchor: { blockIndex: 0, cellIndex: null as unknown as undefined, offset: 0 },
      focus: { blockIndex: 0, cellIndex: null as unknown as undefined, offset: 1 },
    };
    expect(selectionsEqual(a, b)).toBe(true);
  });

  it("cellIndex 0 does NOT normalize to undefined (?? only collapses null/undefined)", () => {
    const withZero = sel(0, 0, 0, 1, 0, 0);
    const withUndef = sel(0, 0, 0, 1, undefined, undefined);
    expect(selectionsEqual(withZero, withUndef)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTableRectSelection (pure)
// ---------------------------------------------------------------------------
describe("isTableRectSelection", () => {
  it("same block, different cellIndex on both ends => true", () => {
    const s: Selection = {
      anchor: { blockIndex: 0, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 0, cellIndex: 3, offset: 0 },
    };
    expect(isTableRectSelection(s)).toBe(true);
  });

  it("same block, same cellIndex => false", () => {
    const s: Selection = {
      anchor: { blockIndex: 0, cellIndex: 2, offset: 0 },
      focus: { blockIndex: 0, cellIndex: 2, offset: 3 },
    };
    expect(isTableRectSelection(s)).toBe(false);
  });

  it("different blocks => false", () => {
    const s: Selection = {
      anchor: { blockIndex: 0, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 1, offset: 0 },
    };
    expect(isTableRectSelection(s)).toBe(false);
  });

  it("a null/undefined cellIndex on either end => false", () => {
    const s: Selection = {
      anchor: { blockIndex: 0, cellIndex: undefined, offset: 0 },
      focus: { blockIndex: 0, cellIndex: 1, offset: 0 },
    };
    expect(isTableRectSelection(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readDomSelection / applyDomSelection round-trip (jsdom getSelection)
// ---------------------------------------------------------------------------
describe("readDomSelection / applyDomSelection round-trip", () => {
  it("returns null when nothing is selected / selection outside root", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">hi</div>`);
    window.getSelection()!.removeAllRanges();
    expect(readDomSelection(root)).toBeNull();
  });

  it("round-trips a collapsed caret in a paragraph", () => {
    const root = makeRoot(`<div data-block-index="0" data-block-type="paragraph">hello</div>`);
    const sel: Selection = {
      anchor: { blockIndex: 0, offset: 2 },
      focus: { blockIndex: 0, offset: 2 },
    };
    applyDomSelection(root, sel);
    const read = readDomSelection(root);
    expect(read, "selection should be readable after apply").not.toBeNull();
    expect(selectionsEqual(read!, sel)).toBe(true);
  });

  it("round-trips a range across two blocks", () => {
    const root = makeRoot(
      `<div data-block-index="0" data-block-type="paragraph">hello</div>` +
        `<div data-block-index="1" data-block-type="paragraph">world</div>`,
    );
    const sel: Selection = {
      anchor: { blockIndex: 0, offset: 1 },
      focus: { blockIndex: 1, offset: 4 },
    };
    applyDomSelection(root, sel);
    const read = readDomSelection(root);
    expect(read).not.toBeNull();
    expect(selectionsEqual(read!, sel)).toBe(true);
  });

  it("round-trips a caret inside a table cell (cellIndex preserved)", () => {
    const root = makeRoot(
      `<div class="ed-table-wrap"><table data-block-index="0" data-block-type="table"><tbody>` +
        `<tr data-cell-row="0">` +
        `<td data-cell-index="0">aa</td>` +
        `<td data-cell-index="1">bbbb</td>` +
        `</tr></tbody></table></div>`,
    );
    const sel: Selection = {
      anchor: { blockIndex: 0, cellIndex: 1, offset: 2 },
      focus: { blockIndex: 0, cellIndex: 1, offset: 2 },
    };
    applyDomSelection(root, sel);
    const read = readDomSelection(root);
    expect(read).not.toBeNull();
    expect(read!.anchor.cellIndex).toBe(1);
    expect(selectionsEqual(read!, sel)).toBe(true);
  });

  it("applyDomSelection clears the native range for a table rect selection", () => {
    const root = makeRoot(
      `<div class="ed-table-wrap"><table data-block-index="0" data-block-type="table"><tbody>` +
        `<tr data-cell-row="0">` +
        `<td data-cell-index="0">aa</td>` +
        `<td data-cell-index="1">bb</td>` +
        `</tr></tbody></table></div>`,
    );
    // First put a real range down so we can observe it being cleared.
    applyDomSelection(root, {
      anchor: { blockIndex: 0, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 0, cellIndex: 0, offset: 1 },
    });
    // Now a rect selection (different cells) => removeAllRanges, no native range.
    applyDomSelection(root, {
      anchor: { blockIndex: 0, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 0, cellIndex: 1, offset: 0 },
    });
    expect(window.getSelection()!.rangeCount).toBe(0);
  });
});
