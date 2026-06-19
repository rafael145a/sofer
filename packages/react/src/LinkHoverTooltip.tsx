import { type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { MOD_SYMBOL } from "./platform";

interface LinkHoverTooltipProps {
  href: string;
  /** Link bounding box in viewport coordinates (from getBoundingClientRect). */
  rect: { top: number; left: number; bottom: number; width: number };
}

const MAX_WIDTH = 360;
const GAP = 6;

/**
 * Small floating tooltip shown while hovering a link in the editor. Displays the
 * link URL plus a hint that Cmd/Ctrl+click opens it. Lives at `position: fixed`
 * (viewport coords from the link's rect) so it isn't clipped by the paginated
 * page boxes; `pointerEvents: none` so it never steals the hover/click from the
 * link underneath. The package ships no CSS — all styling is inline.
 */
export function LinkHoverTooltip({ href, rect }: LinkHoverTooltipProps): JSX.Element {
  // Prefer above the link; flip below when too close to the viewport top.
  const above = rect.top > 48;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : MAX_WIDTH + 16;
  const left = Math.max(8, Math.min(rect.left, viewportW - MAX_WIDTH - 8));

  const style: CSSProperties = {
    position: "fixed",
    left,
    top: above ? rect.top - GAP : rect.bottom + GAP,
    transform: above ? "translateY(-100%)" : undefined,
    maxWidth: MAX_WIDTH,
    background: "#1f2937",
    color: "#fff",
    fontSize: 12,
    lineHeight: 1.4,
    padding: "6px 9px",
    borderRadius: 6,
    boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
    zIndex: 60,
    pointerEvents: "none",
  };

  const urlStyle: CSSProperties = {
    display: "block",
    maxWidth: MAX_WIDTH - 18,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 600,
  };

  const hintStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
    fontSize: 11,
    opacity: 0.85,
  };

  // Keycap look (the package ships no CSS): a small key-shaped chip around the
  // modifier glyph and the mouse-click glyph.
  const keycapStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    padding: "0 4px",
    fontSize: 11,
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "rgba(255,255,255,0.16)",
    border: "1px solid rgba(255,255,255,0.4)",
    borderRadius: 4,
    boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.25)",
  };

  // Render into <body> so `position: fixed` stays viewport-relative even if the
  // editor is nested under a transformed/filtered ancestor (which would turn it
  // into the containing block for fixed elements). SSR-safe: no body, no portal.
  if (typeof document === "undefined") return <></>;

  return createPortal(
    <div style={style} contentEditable={false} aria-hidden role="tooltip">
      <span style={urlStyle}>{href}</span>
      <span style={hintStyle}>
        <kbd style={keycapStyle}>{MOD_SYMBOL}</kbd>
        <span style={{ opacity: 0.8 }}>+ clique para abrir</span>
      </span>
    </div>,
    document.body,
  );
}
