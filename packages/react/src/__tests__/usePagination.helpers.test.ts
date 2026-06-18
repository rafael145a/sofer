import { describe, it, expect } from "vitest";
import {
  A4_PAGE,
  contentHeight,
  contentWidth,
  defaultPageLayout,
  type PageGeometry,
} from "../usePagination";

describe("A4_PAGE", () => {
  it("is a sane PageGeometry with positive numeric fields", () => {
    expect(typeof A4_PAGE.width).toBe("number");
    expect(typeof A4_PAGE.height).toBe("number");
    expect(A4_PAGE.width).toBeGreaterThan(0);
    expect(A4_PAGE.height).toBeGreaterThan(0);
    // Portrait A4: height > width.
    expect(A4_PAGE.height).toBeGreaterThan(A4_PAGE.width);

    for (const m of [
      A4_PAGE.marginTop,
      A4_PAGE.marginBottom,
      A4_PAGE.marginLeft,
      A4_PAGE.marginRight,
    ]) {
      expect(typeof m).toBe("number");
      expect(m).toBeGreaterThan(0);
    }
    // No first-page extra by default — every page has the same content height.
    expect(A4_PAGE.firstPageExtraTop).toBeUndefined();
  });
});

describe("contentWidth", () => {
  it("equals width minus left + right margins", () => {
    const expected = A4_PAGE.width - A4_PAGE.marginLeft - A4_PAGE.marginRight;
    expect(contentWidth(A4_PAGE)).toBe(expected);
  });

  it("works for an arbitrary geometry", () => {
    const g: PageGeometry = {
      width: 500,
      height: 800,
      marginTop: 10,
      marginBottom: 20,
      marginLeft: 30,
      marginRight: 40,
    };
    expect(contentWidth(g)).toBe(500 - 30 - 40);
  });
});

describe("contentHeight", () => {
  it("equals height minus top + bottom margins on page 0 (no firstPageExtraTop)", () => {
    const expected = A4_PAGE.height - A4_PAGE.marginTop - A4_PAGE.marginBottom;
    expect(contentHeight(A4_PAGE, 0)).toBe(expected);
  });

  it("defaults pageIndex to 0", () => {
    expect(contentHeight(A4_PAGE)).toBe(contentHeight(A4_PAGE, 0));
  });

  it("is the same for non-zero pages when firstPageExtraTop is absent", () => {
    expect(contentHeight(A4_PAGE, 3)).toBe(contentHeight(A4_PAGE, 0));
  });

  it("subtracts firstPageExtraTop only on page 0", () => {
    const g: PageGeometry = { ...A4_PAGE, firstPageExtraTop: 120 };
    const base = g.height - g.marginTop - g.marginBottom;
    // Page 0 pays the extra.
    expect(contentHeight(g, 0)).toBe(base - 120);
    // Subsequent pages do not.
    expect(contentHeight(g, 1)).toBe(base);
    expect(contentHeight(g, 5)).toBe(base);
    // The two differ by exactly the extra.
    expect(contentHeight(g, 1) - contentHeight(g, 0)).toBe(120);
  });
});

describe("defaultPageLayout", () => {
  it("returns a single page with no slots for count 0", () => {
    const layout = defaultPageLayout(0);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].slots).toEqual([]);
  });

  it("returns a single page with one slot for count 1", () => {
    const layout = defaultPageLayout(1);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].slots).toEqual([{ topLevelIndex: 0 }]);
  });

  it("places every top-level on page 1 in index order for several", () => {
    const layout = defaultPageLayout(4);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].slots).toEqual([
      { topLevelIndex: 0 },
      { topLevelIndex: 1 },
      { topLevelIndex: 2 },
      { topLevelIndex: 3 },
    ]);
  });

  it("produces no fragment metadata on default slots", () => {
    const layout = defaultPageLayout(3);
    for (const slot of layout.pages[0].slots) {
      expect(slot.fragment).toBeUndefined();
      expect(slot.tableFragment).toBeUndefined();
      expect(slot.listFragment).toBeUndefined();
    }
  });
});
