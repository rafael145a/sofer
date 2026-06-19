/**
 * Platform detection for keyboard-modifier conventions. On macOS the "command"
 * modifier is ⌘ (`metaKey`); elsewhere it's Ctrl (`ctrlKey`). Computed once.
 */
export const IS_MAC: boolean = (() => {
  if (typeof navigator === "undefined") return false;
  // NB: case-INSENSITIVE. Chrome's `navigator.userAgentData.platform` returns
  // "macOS" (lowercase m), while `navigator.platform` returns "MacIntel" — a
  // `/Mac/` (case-sensitive) test silently missed "macOS", so Macs were treated
  // as non-Mac (showed "Ctrl", and Cmd+click didn't open).
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
})();

/** Text label for the platform's primary command modifier ("Cmd" / "Ctrl"). */
export const MOD_LABEL: string = IS_MAC ? "Cmd" : "Ctrl";

/**
 * Keyboard GLYPH for the platform's command modifier: ⌘ (Command) on macOS,
 * ⌃ (Control) elsewhere. Used for keycap-style hints instead of the text label.
 */
export const MOD_SYMBOL: string = IS_MAC ? "⌘" : "⌃";

/** True when the platform's "open in new tab" modifier is held during a click. */
export function hasOpenModifier(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}
