/**
 * Document-level page configuration: physical size and margins.
 *
 * Everything is stored in **CSS pixels @ 96dpi** for consistency with the
 * pagination engine (`packages/react/src/usePagination.ts` reads these
 * directly). Conversion helpers (`mmToPx`, `pxToMm`) round-trip with millimeter
 * inputs from the UI and the OOXML twip values used by docx import/export.
 */

export type PagePreset = "a4" | "letter" | "oficio" | "custom";

export interface PageSettings {
  /** Page width in CSS px. */
  width: number;
  /** Page height in CSS px. */
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /**
   * The preset whose size the geometry matches, with the ±0.5mm tolerance used
   * by `detectPreset`. "custom" when the dimensions don't match any preset.
   * This is purely a UI hint — it's recomputed from width/height when needed.
   */
  preset?: PagePreset;
}

/** Page sizes in CSS px @ 96dpi. */
export const PAGE_PRESETS = {
  a4: { width: 794, height: 1123 }, // 210×297 mm
  letter: { width: 816, height: 1056 }, // 8.5×11 in
  oficio: { width: 816, height: 1248 }, // 216×330 mm (BR Ofício)
} as const;

/** Margin presets in CSS px. Match common Word defaults. */
export const MARGIN_PRESETS = {
  normal: 96, // 25.4 mm = 1 in
  narrow: 48, // 12.7 mm = 0.5 in
  wide: 192, // 50.8 mm = 2 in
} as const;

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  ...PAGE_PRESETS.a4,
  marginTop: MARGIN_PRESETS.normal,
  marginBottom: MARGIN_PRESETS.normal,
  marginLeft: MARGIN_PRESETS.normal,
  marginRight: MARGIN_PRESETS.normal,
  preset: "a4",
};

const PX_PER_MM = 96 / 25.4;

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

export function pxToMm(px: number): number {
  return px / PX_PER_MM;
}

/**
 * Detect which preset a (width, height) pair matches. Tolerance is ±0.5mm to
 * absorb rounding from the twips↔px conversion used by docx round-trip.
 */
export function detectPreset(width: number, height: number): PagePreset {
  const TOL = mmToPx(0.5);
  for (const [name, size] of Object.entries(PAGE_PRESETS) as Array<[PagePreset, { width: number; height: number }]>) {
    if (Math.abs(width - size.width) <= TOL && Math.abs(height - size.height) <= TOL) {
      return name;
    }
  }
  return "custom";
}

/** Fill missing fields with the default. Useful when reading from a Y.Map that may be partially populated. */
export function withDefaults(partial: Partial<PageSettings> | undefined): PageSettings {
  const merged = { ...DEFAULT_PAGE_SETTINGS, ...(partial ?? {}) };
  return { ...merged, preset: detectPreset(merged.width, merged.height) };
}
