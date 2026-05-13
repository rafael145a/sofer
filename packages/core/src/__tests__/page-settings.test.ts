import { describe, it, expect } from "vitest";
import {
  DEFAULT_PAGE_SETTINGS,
  PAGE_PRESETS,
  detectPreset,
  mmToPx,
  pxToMm,
} from "../page-settings";
import { EditorDocument } from "../document";

describe("page-settings", () => {
  it("mmToPx round-trips with pxToMm", () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 5);
    expect(pxToMm(96)).toBeCloseTo(25.4, 5);
    expect(pxToMm(mmToPx(210))).toBeCloseTo(210, 5);
  });

  it("detectPreset finds A4/Letter/Oficio with tolerance", () => {
    expect(detectPreset(794, 1123)).toBe("a4");
    expect(detectPreset(816, 1056)).toBe("letter");
    expect(detectPreset(816, 1248)).toBe("oficio");
    // Within ±0.5mm (~1.9px) of A4 still recognized
    expect(detectPreset(794 + 1, 1123 - 1)).toBe("a4");
    // Outside tolerance → custom
    expect(detectPreset(900, 1300)).toBe("custom");
  });

  it("EditorDocument.getPageSettings returns defaults when nothing set", () => {
    const doc = new EditorDocument();
    expect(doc.getPageSettings()).toMatchObject({
      width: DEFAULT_PAGE_SETTINGS.width,
      height: DEFAULT_PAGE_SETTINGS.height,
      preset: "a4",
    });
  });

  it("setPageSettings persists and getPageSettings reads back", () => {
    const doc = new EditorDocument();
    doc.setPageSettings({
      width: PAGE_PRESETS.oficio.width,
      height: PAGE_PRESETS.oficio.height,
      marginTop: 48,
    });
    const s = doc.getPageSettings();
    expect(s.width).toBe(816);
    expect(s.height).toBe(1248);
    expect(s.marginTop).toBe(48);
    expect(s.preset).toBe("oficio");
    // Untouched fields stay at default
    expect(s.marginBottom).toBe(DEFAULT_PAGE_SETTINGS.marginBottom);
  });

  it("observePageSettings fires on changes and unsubscribes cleanly", () => {
    const doc = new EditorDocument();
    let count = 0;
    const unsub = doc.observePageSettings(() => count++);
    doc.setPageSettings({ marginTop: 50 });
    expect(count).toBe(1);
    doc.setPageSettings({ marginLeft: 60 });
    expect(count).toBe(2);
    unsub();
    doc.setPageSettings({ marginRight: 70 });
    expect(count).toBe(2);
  });

  it("setPageSettings is not undoable (origin not tracked)", async () => {
    const { EditorHistory } = await import("../history");
    const doc = new EditorDocument();
    const history = new EditorHistory(doc);
    doc.setPageSettings({ marginTop: 99 });
    history.undo();
    // Margin stays — page settings are not tracked by UndoManager.
    expect(doc.getPageSettings().marginTop).toBe(99);
  });
});
