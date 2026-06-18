import { describe, it, expect } from "vitest";
import type { DeltaOp, ImageEmbed } from "@sofereditor/core";
import { deltaLength, sliceDelta } from "../sliceDelta";

const img: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAAA",
  width: 10,
  height: 10,
};

function imageOp(): DeltaOp {
  return { insert: img };
}

describe("deltaLength", () => {
  it("returns 0 for an empty delta", () => {
    expect(deltaLength([])).toBe(0);
  });

  it("sums the lengths of text op inserts", () => {
    const delta: DeltaOp[] = [{ insert: "abc" }, { insert: "de" }];
    expect(deltaLength(delta)).toBe(5);
  });

  it("counts an image embed as 1", () => {
    expect(deltaLength([imageOp()])).toBe(1);
  });

  it("counts mixed text + embed correctly", () => {
    // "hello"(5) + image(1) + "!"(1) = 7
    const delta: DeltaOp[] = [{ insert: "hello" }, imageOp(), { insert: "!" }];
    expect(deltaLength(delta)).toBe(7);
  });
});

describe("sliceDelta", () => {
  it("slices within a single text op preserving attributes", () => {
    const delta: DeltaOp[] = [{ insert: "hello world", attributes: { bold: true } }];
    // chars [6, 11) -> "world"
    const out = sliceDelta(delta, 6, 11);
    expect(out).toEqual([{ insert: "world", attributes: { bold: true } }]);
  });

  it("slices mid-string with start and end both inside the op", () => {
    const delta: DeltaOp[] = [{ insert: "abcdef", attributes: { italic: true } }];
    // chars [1, 4) -> "bcd"
    const out = sliceDelta(delta, 1, 4);
    expect(out).toEqual([{ insert: "bcd", attributes: { italic: true } }]);
  });

  it("preserves the absence of attributes (undefined stays undefined)", () => {
    const delta: DeltaOp[] = [{ insert: "abcdef" }];
    const out = sliceDelta(delta, 1, 3);
    expect(out).toEqual([{ insert: "bc", attributes: undefined }]);
  });

  it("slices spanning multiple ops returns sub-ops with attributes intact", () => {
    const delta: DeltaOp[] = [
      { insert: "foo", attributes: { bold: true } }, // [0,3)
      { insert: "bar", attributes: { italic: true } }, // [3,6)
      { insert: "baz" }, // [6,9)
    ];
    // chars [2, 7) -> "o" from first, "bar" whole, "b" from third
    const out = sliceDelta(delta, 2, 7);
    expect(out).toEqual([
      { insert: "o", attributes: { bold: true } },
      { insert: "bar", attributes: { italic: true } },
      { insert: "b", attributes: undefined },
    ]);
  });

  it("returns the whole delta for [0, deltaLength)", () => {
    const delta: DeltaOp[] = [
      { insert: "ab", attributes: { bold: true } },
      imageOp(),
      { insert: "cd" },
    ];
    const len = deltaLength(delta); // 2 + 1 + 2 = 5
    const out = sliceDelta(delta, 0, len);
    // Text ops are reconstructed with attributes echoed back; embed kept whole.
    expect(out).toEqual([
      { insert: "ab", attributes: { bold: true } },
      { insert: img, attributes: undefined },
      { insert: "cd", attributes: undefined },
    ]);
  });

  describe("embeds are atomic", () => {
    // Layout: "ab"(0,1) image(@2) "cd"(3,4). deltaLength = 5.
    const delta: DeltaOp[] = [{ insert: "ab" }, imageOp(), { insert: "cd" }];

    it("includes the embed whole when the range covers its slot", () => {
      // [2, 3) is exactly the embed slot.
      const out = sliceDelta(delta, 2, 3);
      expect(out).toEqual([{ insert: img, attributes: undefined }]);
    });

    it("includes the embed when start lands on the embed offset", () => {
      // start === embed offset (2). Embed at offset N is in iff start <= N < end.
      const out = sliceDelta(delta, 2, 4);
      expect(out).toEqual([
        { insert: img, attributes: undefined },
        { insert: "c", attributes: undefined },
      ]);
    });

    it("excludes the embed when the range ends at the embed offset", () => {
      // [0, 2): "ab" then boundary at the embed start excludes the embed.
      const out = sliceDelta(delta, 0, 2);
      expect(out).toEqual([{ insert: "ab", attributes: undefined }]);
    });

    it("excludes the embed when the range starts after the embed slot", () => {
      // [3, 5): only the trailing text op.
      const out = sliceDelta(delta, 3, 5);
      expect(out).toEqual([{ insert: "cd", attributes: undefined }]);
    });
  });

  describe("boundaries", () => {
    const delta: DeltaOp[] = [{ insert: "abc" }, { insert: "def" }];

    it("returns [] when start === end", () => {
      expect(sliceDelta(delta, 2, 2)).toEqual([]);
    });

    it("returns [] when end < start", () => {
      expect(sliceDelta(delta, 4, 1)).toEqual([]);
    });

    it("clamps end beyond deltaLength to the available content", () => {
      // deltaLength is 6; end = 100 clamps to 6.
      const out = sliceDelta(delta, 0, 100);
      expect(out).toEqual([
        { insert: "abc", attributes: undefined },
        { insert: "def", attributes: undefined },
      ]);
    });

    it("clamps a start beyond deltaLength to an empty result", () => {
      const out = sliceDelta(delta, 10, 20);
      expect(out).toEqual([]);
    });
  });
});
