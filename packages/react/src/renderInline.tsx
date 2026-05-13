import { Fragment, memo, type CSSProperties, type ReactNode } from "react";
import { isImageEmbed, type DeltaOp, type ImageEmbed, type MarkAttrs } from "@editor/core";

/**
 * Convert a Y.Text delta into ReactNodes.
 *
 * Wrap order (innermost → outermost): bold → italic → underline → strike → font/color span → link.
 * Semantic tags carry bold/italic/underline/strike; color and fonts go on a styled <span>.
 *
 * Keys are stable on `${blockIndex}-${runningOffset}` so React reconciliation
 * survives split/merge of runs under collaboration.
 */
export function renderInline(delta: DeltaOp[], keyPrefix: number | string): ReactNode {
  if (
    delta.length === 0 ||
    (delta.length === 1 &&
      typeof delta[0].insert === "string" &&
      delta[0].insert === "")
  ) {
    return <br data-empty="true" />;
  }
  let offset = 0;
  // Float-wrap images (wrap-left / wrap-right) are emitted as the FIRST DOM
  // children of the block so CSS float can flow the whole paragraph around
  // them — float only wraps siblings that come after it in DOM order. A
  // zero-width phantom span is left at the embed's original offset so the
  // caret-position math in dom-bridge keeps counting the embed as 1 char in
  // its true model position.
  const wrapAnchors: ReactNode[] = [];
  const body: ReactNode[] = [];
  for (const op of delta) {
    if (typeof op.insert === "string") {
      const text = op.insert;
      if (text.length === 0) continue;
      const key = `${keyPrefix}-${offset}`;
      body.push(<Fragment key={key}>{wrap(text, op.attributes)}</Fragment>);
      offset += text.length;
    } else if (isImageEmbed(op.insert)) {
      const key = `${keyPrefix}-${offset}`;
      const layout = op.insert.layout ?? "inline";
      if (layout === "wrap-left" || layout === "wrap-right") {
        wrapAnchors.push(
          <ImageEmbedView key={`${key}-anchor`} embed={op.insert} offset={offset} wrapAnchor />,
        );
        body.push(
          <span
            key={`${key}-phantom`}
            data-embed-phantom="true"
            data-embed-offset={offset}
            contentEditable={false}
            style={PHANTOM_STYLE}
          />,
        );
      } else {
        body.push(<ImageEmbedView key={key} embed={op.insert} offset={offset} />);
      }
      offset += 1;
    } else if (op.insert != null) {
      // Unknown embed kind — reserve the offset slot so caret math stays correct.
      offset += 1;
    }
  }
  if (wrapAnchors.length === 0 && body.length === 0) return <br data-empty="true" />;
  return [...wrapAnchors, ...body];
}

const PHANTOM_STYLE: CSSProperties = {
  display: "inline-block",
  width: 0,
  height: 0,
  overflow: "hidden",
  verticalAlign: "baseline",
};

interface ImageEmbedViewProps {
  embed: ImageEmbed;
  offset: number;
  wrapAnchor?: boolean;
}

/**
 * `embed.src` is a (potentially huge) base64 data URL. Y.Text.toDelta() builds
 * a fresh `ImageEmbed` object every time the parent snapshot recomputes — so
 * by default React would re-render `<img src={...}>` on every keystroke even
 * when nothing about the image changed. Memoizing by *value* on the cheap
 * fields and skipping the src deep-compare (it's stable while the embed is
 * stable; if src actually changes, width/height typically change too) keeps
 * the `<img>` DOM node fully stable across keystrokes.
 */
function imageEmbedPropsEqual(a: ImageEmbedViewProps, b: ImageEmbedViewProps): boolean {
  if (a.offset !== b.offset || a.wrapAnchor !== b.wrapAnchor) return false;
  const x = a.embed;
  const y = b.embed;
  if (x === y) return true;
  return (
    x.width === y.width &&
    x.height === y.height &&
    x.layout === y.layout &&
    x.align === y.align &&
    x.offsetX === y.offsetX &&
    x.offsetY === y.offsetY &&
    x.caption === y.caption &&
    x.captionAlign === y.captionAlign &&
    // src is the expensive compare — only fall back to ref equality. Fresh
    // toDelta() objects share the same string reference for embed payloads
    // because Y.js stores the embed in its content map and re-exposes it.
    x.src === y.src
  );
}

const ImageEmbedView = memo(ImageEmbedViewImpl, imageEmbedPropsEqual);

function ImageEmbedViewImpl({
  embed,
  offset,
  wrapAnchor,
}: ImageEmbedViewProps): ReactNode {
  const layout = embed.layout ?? "inline";
  const align = embed.align;
  const ox = embed.offsetX ?? 0;
  const oy = embed.offsetY ?? 0;
  const hasCaption = !!embed.caption && embed.caption.length > 0;

  // The outer style positions the wrapper (float / absolute / inline-block /
  // block-with-align). The img itself stays at intrinsic width × height so the
  // existing caret-position math (`data-embed-offset`) and ImageResizeOverlay
  // queries (`img[data-embed="image"]`) keep working. A `<figcaption>` lives
  // inside the wrapper when a caption is set.
  let outerStyle: CSSProperties;
  switch (layout) {
    case "wrap-left":
      outerStyle = {
        float: "left",
        width: embed.width,
        marginRight: Math.max(8, ox),
        marginTop: Math.max(0, oy),
        marginBottom: 4,
      };
      break;
    case "wrap-right":
      outerStyle = {
        float: "right",
        width: embed.width,
        marginLeft: Math.max(8, ox),
        marginTop: Math.max(0, oy),
        marginBottom: 4,
      };
      break;
    case "behind":
    case "front":
      outerStyle = {
        position: "absolute",
        left: ox,
        top: oy,
        width: embed.width,
        zIndex: layout === "behind" ? -1 : 2,
      };
      break;
    case "inline":
    default:
      outerStyle = align
        ? {
            display: "block",
            width: embed.width,
            marginLeft: align === "left" ? 0 : "auto",
            marginRight: align === "right" ? 0 : "auto",
          }
        : {
            display: "inline-block",
            verticalAlign: "text-bottom",
            width: embed.width,
          };
      break;
  }

  // The img always carries the data-* attributes used by Editor/Overlay; the
  // style is either the outer positioning (no caption — bare img) or just the
  // intrinsic size (with caption — figure carries the outer positioning).
  const imgStyle: CSSProperties = hasCaption
    ? { width: embed.width, height: embed.height, display: "block" }
    : outerStyle;

  const img = (
    <img
      src={embed.src}
      width={embed.width}
      height={embed.height}
      contentEditable={false}
      draggable={false}
      data-embed="image"
      data-embed-offset={offset}
      data-embed-align={align ?? ""}
      data-embed-layout={layout}
      data-wrap-anchor={wrapAnchor ? "true" : undefined}
      style={imgStyle}
      alt=""
    />
  );

  if (!hasCaption) return img;

  const captionAlign = embed.captionAlign ?? "center";
  return (
    <figure
      className="ed-figure"
      contentEditable={false}
      data-embed-figure="true"
      data-embed-layout={layout}
      style={outerStyle}
    >
      {img}
      <figcaption
        className="ed-figcaption"
        data-caption-align={captionAlign}
        style={{ textAlign: captionAlign }}
      >
        {embed.caption}
      </figcaption>
    </figure>
  );
}

function wrap(text: string, attrs?: MarkAttrs): ReactNode {
  let node: ReactNode = text;
  if (!attrs) return node;

  if (attrs.bold) node = <strong>{node}</strong>;
  if (attrs.italic) node = <em>{node}</em>;
  if (attrs.underline) node = <u>{node}</u>;
  if (attrs.strike) node = <s>{node}</s>;

  const styleParts: CSSProperties = {};
  if (attrs.color) styleParts.color = attrs.color;
  if (attrs.fontFamily) styleParts.fontFamily = attrs.fontFamily;
  if (attrs.fontSize) styleParts.fontSize = attrs.fontSize;
  if (Object.keys(styleParts).length > 0) {
    node = <span style={styleParts}>{node}</span>;
  }

  if (attrs.link?.href) {
    node = (
      <a
        href={attrs.link.href}
        title={attrs.link.title}
        rel="noopener noreferrer"
        target="_blank"
        onClick={(e) => {
          // In the editor the link should not navigate on plain click — Cmd/Ctrl+click does.
          if (!(e.metaKey || e.ctrlKey)) e.preventDefault();
        }}
      >
        {node}
      </a>
    );
  }

  return node;
}
