import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { ImageEmbed } from "@editor/core";
import { getFragmentForOffset } from "./dom-bridge";

interface ImageResizeOverlayProps {
  rootRef: RefObject<HTMLDivElement>;
  blockIndex: number;
  offset: number;
  cellIndex?: number;
  embed: ImageEmbed;
  /** Called once on pointer-up with the final width/height (in CSS px). */
  onCommit: (width: number, height: number) => void;
  /**
   * Called once on pointer-up after a move-drag with the new offset
   * coordinates (CSS px). Only fired when `embed.layout` is non-inline.
   */
  onCommitMove?: (offsetX: number, offsetY: number) => void;
}

type Corner = "nw" | "ne" | "sw" | "se";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Floating overlay drawn over the currently-selected image embed: 4 corner
 * handles + outline. Drag a handle to resize keeping aspect ratio. Changes are
 * applied live to the `<img>` style during the drag (no Y.Doc transactions per
 * frame); a single commit happens on pointer-up so Undo treats it as one step.
 */
export function ImageResizeOverlay({
  rootRef,
  blockIndex,
  offset,
  cellIndex,
  embed,
  onCommit,
  onCommitMove,
}: ImageResizeOverlayProps): JSX.Element | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

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
    // The renderInline data-embed-offset is LOCAL to the fragment / container.
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
    if (!img) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    imgRef.current = img;
    const root = rootRef.current;
    if (!root) return;
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
    // Pagination runs in a separate effect after this one, and can shift the
    // image vertically by dozens of pixels (e.g. when `align: center` flips
    // the layout to `display: block`). Re-measure on the next frame to catch
    // the post-reflow position. Falls back to a microtask in non-browser envs.
    let cancelled = false;
    const remeasure = () => {
      if (cancelled) return;
      measure();
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
  }, [
    measure,
    embed.width,
    embed.height,
    embed.align,
    embed.src,
    embed.layout,
    embed.offsetX,
    embed.offsetY,
  ]);

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

  /*
   * The `useLayoutEffect` above re-measures synchronously when embed props
   * change — but the pagination engine runs its own re-layout in a SEPARATE
   * effect right after. That post-pagination shift can move the image by
   * dozens of pixels (e.g. when `align: center` flips it to `display: block`
   * and the paragraph reflows), leaving the overlay at the pre-shift
   * coordinates.
   *
   * A ResizeObserver on both the image AND the editor root fires whenever
   * either box changes — covers reflow, resize, font load, page repagination,
   * and image-load-late-decoded scenarios. Falls back to no-op in jsdom etc.
   */
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const img = locateImage();
    const root = rootRef.current;
    if (!img || !root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(img);
    ro.observe(root);
    return () => ro.disconnect();
  }, [locateImage, measure, rootRef, embed.layout, embed.align, embed.src]);

  if (!rect) return null;

  const layout = embed.layout ?? "inline";
  const movable = layout !== "inline" && onCommitMove !== undefined;

  return (
    <div
      className="ed-image-overlay"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      contentEditable={false}
    >
      {movable && (
        <MoveHandle
          layout={layout}
          startOffsetX={embed.offsetX ?? 0}
          startOffsetY={embed.offsetY ?? 0}
          imgRef={imgRef}
          onCommit={onCommitMove!}
          onLiveChange={measure}
        />
      )}
      <Handle
        corner="nw"
        startW={embed.width}
        startH={embed.height}
        imgRef={imgRef}
        onCommit={onCommit}
        onLiveChange={measure}
      />
      <Handle
        corner="ne"
        startW={embed.width}
        startH={embed.height}
        imgRef={imgRef}
        onCommit={onCommit}
        onLiveChange={measure}
      />
      <Handle
        corner="sw"
        startW={embed.width}
        startH={embed.height}
        imgRef={imgRef}
        onCommit={onCommit}
        onLiveChange={measure}
      />
      <Handle
        corner="se"
        startW={embed.width}
        startH={embed.height}
        imgRef={imgRef}
        onCommit={onCommit}
        onLiveChange={measure}
      />
    </div>
  );
}

interface MoveHandleProps {
  layout: "wrap-left" | "wrap-right" | "behind" | "front" | "inline";
  startOffsetX: number;
  startOffsetY: number;
  imgRef: RefObject<HTMLImageElement | null>;
  onCommit: (ox: number, oy: number) => void;
  onLiveChange: () => void;
}

function MoveHandle({
  layout,
  startOffsetX,
  startOffsetY,
  imgRef,
  onCommit,
  onLiveChange,
}: MoveHandleProps): JSX.Element {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    liveOX: number;
    liveOY: number;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!imgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      liveOX: startOffsetX,
      liveOY: startOffsetY,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !imgRef.current) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const img = imgRef.current;
    let nox = startOffsetX;
    let noy = startOffsetY;
    if (layout === "wrap-left") {
      // dx → right margin (gap to text); negative dx clamped to 8 (min gap).
      nox = Math.max(8, startOffsetX + dx);
      noy = Math.max(0, startOffsetY + dy);
      img.style.marginRight = `${nox}px`;
      img.style.marginTop = `${noy}px`;
    } else if (layout === "wrap-right") {
      // dx is mirrored: dragging LEFT increases the gap to text.
      nox = Math.max(8, startOffsetX - dx);
      noy = Math.max(0, startOffsetY + dy);
      img.style.marginLeft = `${nox}px`;
      img.style.marginTop = `${noy}px`;
    } else if (layout === "behind" || layout === "front") {
      nox = startOffsetX + dx;
      noy = startOffsetY + dy;
      img.style.left = `${nox}px`;
      img.style.top = `${noy}px`;
    }
    d.liveOX = nox;
    d.liveOY = noy;
    onLiveChange();
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    onCommit(Math.round(d.liveOX), Math.round(d.liveOY));
  };

  return (
    <div
      className="ed-image-move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}

interface HandleProps {
  corner: Corner;
  startW: number;
  startH: number;
  imgRef: RefObject<HTMLImageElement | null>;
  onCommit: (w: number, h: number) => void;
  onLiveChange: () => void;
}

const MIN_W = 20;

function Handle({
  corner,
  startW,
  startH,
  imgRef,
  onCommit,
  onLiveChange,
}: HandleProps): JSX.Element {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    aspect: number;
    liveW: number;
    liveH: number;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!imgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const aspect = startW > 0 && startH > 0 ? startW / startH : 1;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW,
      startH,
      aspect,
      liveW: startW,
      liveH: startH,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !imgRef.current) return;
    const dxRaw = e.clientX - d.startX;
    // SE/NE handles grow with +dx; NW/SW grow with -dx.
    const dx = corner === "se" || corner === "ne" ? dxRaw : -dxRaw;
    let w = Math.max(MIN_W, d.startW + dx);
    let h = w / d.aspect;
    // Apply live to the img element directly — no transaction.
    imgRef.current.style.width = `${w}px`;
    imgRef.current.style.height = `${h}px`;
    imgRef.current.width = Math.round(w);
    imgRef.current.height = Math.round(h);
    d.liveW = w;
    d.liveH = h;
    onLiveChange();
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    onCommit(Math.round(d.liveW), Math.round(d.liveH));
  };

  return (
    <div
      className={`ed-image-handle ${corner}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}
