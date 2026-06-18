import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { getFragmentForOffset } from "./dom-bridge";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface BehindImageSelectAffordanceProps {
  blockIndex: number;
  offset: number;
  cellIndex?: number;
  rootRef: RefObject<HTMLDivElement>;
  /** Select the embed (shows the resize/move overlay). */
  onSelect: () => void;
}

const ACCENT = "#3b82f6";

/**
 * Hover affordance to select a `behind` image (z-index:-1) even when text sits
 * on top of it. The image's own box doesn't receive the click there — the text
 * /block does — so the overlay can't appear from a plain click. On hover we draw
 * a dashed outline (pointer-events:none, so it never steals a text click) plus a
 * clickable badge that selects the image. Lives in the un-clipped `.ed-root`
 * layer, positioned over the image (same measure pattern as ImageResizeOverlay).
 * Inline styles only — the package ships no CSS.
 */
export function BehindImageSelectAffordance({
  blockIndex,
  offset,
  cellIndex,
  rootRef,
  onSelect,
}: BehindImageSelectAffordanceProps): JSX.Element | null {
  const [rect, setRect] = useState<Rect | null>(null);

  const locateImage = useCallback((): HTMLImageElement | null => {
    const root = rootRef.current;
    if (!root) return null;
    let container: HTMLElement | null = null;
    if (cellIndex != null) {
      container = root.querySelector<HTMLElement>(
        `[data-block-index="${blockIndex}"] [data-cell-index="${cellIndex}"]`,
      );
    } else {
      container = getFragmentForOffset(root, blockIndex, offset);
    }
    if (!container) return null;
    const fragmentStart = container.dataset.fragmentStart
      ? Number.parseInt(container.dataset.fragmentStart, 10) || 0
      : 0;
    const localOffset = offset - fragmentStart;
    return container.querySelector<HTMLImageElement>(
      `img[data-embed="image"][data-embed-offset="${localOffset}"]`,
    );
  }, [rootRef, blockIndex, offset, cellIndex]);

  const measure = useCallback(() => {
    const img = locateImage();
    const root = rootRef.current;
    if (!img || !root) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const r = img.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const next: Rect = {
      top: r.top - rr.top + root.scrollTop,
      left: r.left - rr.left + root.scrollLeft,
      width: r.width,
      height: r.height,
    };
    setRect((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    );
  }, [locateImage, rootRef]);

  useLayoutEffect(() => {
    measure();
    let cancelled = false;
    const remeasure = () => {
      if (!cancelled) measure();
    };
    const id =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(remeasure)
        : (queueMicrotask(remeasure), 0);
    return () => {
      cancelled = true;
      if (typeof cancelAnimationFrame === "function" && typeof id === "number" && id > 0) {
        cancelAnimationFrame(id);
      }
    };
  }, [measure]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = () => measure();
    window.addEventListener("resize", onScroll);
    root.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("resize", onScroll);
      root.removeEventListener("scroll", onScroll);
    };
  }, [measure, rootRef]);

  if (!rect) return null;

  const outlineStyle: CSSProperties = {
    position: "absolute",
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    border: `1.5px dashed ${ACCENT}`,
    borderRadius: 2,
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: 4,
  };

  const badgeStyle: CSSProperties = {
    position: "absolute",
    top: rect.top - 2,
    left: rect.left - 2,
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: ACCENT,
    color: "#fff",
    borderRadius: 4,
    cursor: "pointer",
    pointerEvents: "auto",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    zIndex: 5,
  };

  const onBadgeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
  };

  return (
    <>
      <div style={outlineStyle} contentEditable={false} aria-hidden />
      <div
        style={badgeStyle}
        contentEditable={false}
        onPointerDown={onBadgeDown}
        role="button"
        aria-label="Selecionar imagem"
        title="Selecionar imagem"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
        </svg>
      </div>
    </>
  );
}
