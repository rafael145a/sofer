import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type RefObject,
} from "react";
import {
  decodeSelection,
  type EditorDocument,
  type EncodedCursor,
} from "@sofereditor/core";
import { locatePoint } from "./dom-bridge";

/**
 * Subconjunto mínimo da Awareness do y-protocols que o overlay usa. Tipar assim
 * evita que `@sofereditor/react` dependa de `y-protocols` — o objeto vem de fora
 * (de `useCollab().binding.awareness`) e é estruturalmente compatível.
 */
export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: "change", cb: () => void): void;
  off(event: "change", cb: () => void): void;
  setLocalStateField(field: string, value: unknown): void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PeerCursorView {
  clientId: number;
  name: string;
  color: string;
  caret: { top: number; left: number; height: number } | null;
  selection: Rect[];
}

interface RemoteCursorsOverlayProps {
  rootRef: RefObject<HTMLDivElement>;
  doc: EditorDocument;
  awareness: AwarenessLike;
  /** Muda a cada edição/repaginação → re-medir os carets remotos. */
  revision?: unknown;
}

const DEFAULT_COLOR = "#3b82f6";

/**
 * Desenha o caret + seleção + nome de cada usuário remoto sobre o conteúdo
 * paginado. Posições remotas chegam via awareness (campo `cursor`, codificado
 * com Y.RelativePosition pelo core) e são resolvidas para coordenadas DOM com
 * o mesmo bridge da seleção local — ciente de fragmentação por página.
 */
export function RemoteCursorsOverlay({
  rootRef,
  doc,
  awareness,
  revision,
}: RemoteCursorsOverlayProps): JSX.Element | null {
  const [views, setViews] = useState<PeerCursorView[]>([]);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      setViews((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const rr = root.getBoundingClientRect();
    const out: PeerCursorView[] = [];

    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
      const s = state as {
        user?: { name?: string; color?: string };
        cursor?: EncodedCursor;
      };
      if (!s.cursor) return;
      const sel = decodeSelection(doc, s.cursor);
      if (!sel) return;

      const color = s.user?.color || DEFAULT_COLOR;
      const name = s.user?.name || "Anônimo";

      const focus = locatePoint(root, sel.focus);
      let caret: PeerCursorView["caret"] = null;
      if (focus) {
        try {
          const range = document.createRange();
          range.setStart(focus.node, focus.offset);
          range.collapse(true);
          let rect = range.getBoundingClientRect();
          if (rect.height === 0 && focus.node.nodeType === Node.ELEMENT_NODE) {
            rect = (focus.node as HTMLElement).getBoundingClientRect();
          }
          caret = {
            top: rect.top - rr.top + root.scrollTop,
            left: rect.left - rr.left + root.scrollLeft,
            height: rect.height || 18,
          };
        } catch {
          /* range inválido — sem caret */
        }
      }

      const collapsed =
        sel.anchor.blockIndex === sel.focus.blockIndex &&
        (sel.anchor.cellIndex ?? -1) === (sel.focus.cellIndex ?? -1) &&
        sel.anchor.offset === sel.focus.offset;

      const selection: Rect[] = [];
      if (!collapsed && focus) {
        const anchor = locatePoint(root, sel.anchor);
        if (anchor) {
          try {
            const r = document.createRange();
            r.setStart(anchor.node, anchor.offset);
            r.setEnd(focus.node, focus.offset);
            if (r.collapsed) {
              r.setStart(focus.node, focus.offset);
              r.setEnd(anchor.node, anchor.offset);
            }
            for (const cr of Array.from(r.getClientRects())) {
              if (cr.width === 0 || cr.height === 0) continue;
              selection.push({
                top: cr.top - rr.top + root.scrollTop,
                left: cr.left - rr.left + root.scrollLeft,
                width: cr.width,
                height: cr.height,
              });
            }
          } catch {
            /* seleção cross-fragmento inválida — ignora */
          }
        }
      }

      out.push({ clientId, name, color, caret, selection });
    });

    setViews(out);
  }, [rootRef, doc, awareness]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current != null) return;
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    rafRef.current = raf(() => {
      rafRef.current = null;
      measure();
    });
  }, [measure]);

  // Awareness: re-mede quando qualquer peer muda cursor/entra/sai.
  useEffect(() => {
    const onChange = () => scheduleMeasure();
    awareness.on("change", onChange);
    scheduleMeasure();
    return () => awareness.off("change", onChange);
  }, [awareness, scheduleMeasure]);

  // Edição/repaginação local.
  useEffect(() => {
    scheduleMeasure();
  }, [revision, scheduleMeasure]);

  // Resize do root + scroll re-posicionam os carets.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = () => scheduleMeasure();
    root.addEventListener("scroll", onScroll, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => scheduleMeasure());
      ro.observe(root);
    }
    return () => {
      root.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [rootRef, scheduleMeasure]);

  if (views.length === 0) return null;

  const layer: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 6,
  };

  return (
    <div className="ed-remote-cursors" aria-hidden style={layer}>
      {views.map((v) => (
        <div key={v.clientId}>
          {v.selection.map((r, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
                background: v.color,
                opacity: 0.22,
                borderRadius: 2,
              }}
            />
          ))}
          {v.caret && (
            <div
              style={{
                position: "absolute",
                top: v.caret.top,
                left: v.caret.left,
                height: v.caret.height,
                width: 2,
                background: v.color,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: -15,
                  left: -1,
                  fontSize: 10,
                  lineHeight: "14px",
                  padding: "0 4px",
                  borderRadius: 3,
                  color: "#fff",
                  background: v.color,
                  whiteSpace: "nowrap",
                  fontFamily: "system-ui, sans-serif",
                  userSelect: "none",
                }}
              >
                {v.name}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
