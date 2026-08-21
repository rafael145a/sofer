import { describe, it, expect } from "vitest";
import {
  halfPointsToCssPt,
  docxHexToCssColor,
  parseAlign,
  parseIntAttr,
  twipToMillimeters,
} from "../units";

describe("units", () => {
  it("halfPointsToCssPt: 24 → 12pt", () => {
    expect(halfPointsToCssPt(24)).toBe("12pt");
    expect(halfPointsToCssPt(28)).toBe("14pt");
    expect(halfPointsToCssPt(9)).toBe("4.5pt");
  });

  it("halfPointsToCssPt rejects non-positive", () => {
    expect(halfPointsToCssPt(0)).toBeUndefined();
    expect(halfPointsToCssPt(-1)).toBeUndefined();
    expect(halfPointsToCssPt(Number.NaN)).toBeUndefined();
  });

  it("docxHexToCssColor adds # and lowercases", () => {
    expect(docxHexToCssColor("FF0000")).toBe("#ff0000");
    expect(docxHexToCssColor("aabbcc")).toBe("#aabbcc");
    expect(docxHexToCssColor("nope")).toBeUndefined();
    expect(docxHexToCssColor(undefined)).toBeUndefined();
  });

  it("parseAlign maps OOXML values", () => {
    expect(parseAlign("left")).toBe("left");
    expect(parseAlign("center")).toBe("center");
    expect(parseAlign("right")).toBe("right");
    expect(parseAlign("both")).toBe("justify");
    expect(parseAlign("distribute")).toBe("justify");
    expect(parseAlign(undefined)).toBeUndefined();
  });

  it("parseIntAttr handles strings, numbers, fallback", () => {
    expect(parseIntAttr("12")).toBe(12);
    expect(parseIntAttr(7)).toBe(7);
    expect(parseIntAttr("abc", 42)).toBe(42);
    expect(parseIntAttr(undefined, 3)).toBe(3);
  });

  it("twipToMillimeters is the inverse of convertMillimetersToTwip", () => {
    // 1440 twip = 1 in = 25.4mm.
    expect(twipToMillimeters(1440)).toBeCloseTo(25.4, 6);
    expect(twipToMillimeters(720)).toBeCloseTo(12.7, 6);
    expect(twipToMillimeters(0)).toBe(0);
  });
});
