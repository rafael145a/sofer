import { Fragment, memo, type CSSProperties, type ReactNode } from "react";
import {
  BLANK_STYLE,
  isImageEmbed,
  splitUnderscoreRuns,
  type DeltaOp,
  type ImageEmbed,
  type MarkAttrs,
} from "@sofereditor/core";
import { hasOpenModifier } from "./platform";

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
      // Marks aplicadas ao 1-char range que cobre o embed: hoje só
      // `comment` é renderizada visualmente (espelha o tratamento de
      // texto em `wrap()`). Outras marks (bold/italic/etc.) não fazem
      // sentido em embed visual e são ignoradas.
      const commentMarkId = op.attributes?.comment?.markId;
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
        const imgNode = <ImageEmbedView key={key} embed={op.insert} offset={offset} />;
        if (commentMarkId) {
          body.push(
            <span key={`${key}-cmt`} data-comment-id={commentMarkId} className="ed-comment">
              {imgNode}
            </span>,
          );
        } else {
          body.push(imgNode);
        }
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

// Inline style for links (the package ships no CSS). `color`/underline give the
// link its visual affordance; `cursor: "text"` matches the surrounding editable
// text — the browser's UA stylesheet makes `<a href>` use `cursor: pointer`,
// which flickers pointer↔text across the link boundary inside a contentEditable
// (hard to click / "cursor oscila"). To FOLLOW a link, Cmd/Ctrl+click.
const LINK_STYLE: CSSProperties = {
  color: "#2563eb",
  textDecoration: "underline",
  cursor: "text",
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
            // Fórmula inline traz o deslocamento de base que o MathJax mediu;
            // sem ele a fórmula flutua no topo da linha em vez de sentar nela.
            verticalAlign: embed.formula?.vAlign ?? "text-bottom",
            width: embed.width,
          };
      break;
  }

  // The img always carries the data-* attributes used by Editor/Overlay.
  //
  // Structure-stable rendering (bug #11): the <img> ALWAYS lives inside a
  // <figure> that carries `outerStyle`, so adding/removing a caption never
  // changes the <img>'s parent type. React then keeps the same <img> DOM node
  // instead of unmounting+remounting it — a remount would force a synchronous
  // base64 re-decode (`decoding="sync"` below), freezing the UI on large
  // images. The <img> therefore always uses the intrinsic-size style; the
  // <figure> owns the positioning.
  const imgStyle: CSSProperties = {
    width: embed.width,
    height: embed.height,
    display: "block",
  };

  // `decoding="sync"` + `loading="eager"` evita o piscar quando a paginação
  // remonta o <img> (consumidor com `renderPageHeader` faz a 1ª página ter
  // marginTop diferente, o que muda o DOM pai do bloco quando ele cruza
  // páginas): com cache do browser quente, o frame de remount já vem pintado.
  const img = (
    <img
      src={embed.src}
      width={embed.width}
      height={embed.height}
      contentEditable={false}
      draggable={false}
      decoding="sync"
      loading="eager"
      data-embed="image"
      data-embed-offset={offset}
      data-embed-align={align ?? ""}
      data-embed-layout={layout}
      data-wrap-anchor={wrapAnchor ? "true" : undefined}
      style={imgStyle}
      alt=""
    />
  );

  // Always render the <figure> wrapper (structure-stable; see imgStyle note).
  // The <figcaption> is the ONLY part that toggles with the caption — the
  // <img> stays mounted, so no re-decode/freeze.
  const captionAlign = embed.captionAlign ?? "center";
  return (
    <figure
      className="ed-figure"
      contentEditable={false}
      data-embed-figure={hasCaption ? "true" : undefined}
      data-embed-layout={layout}
      style={outerStyle}
    >
      {img}
      {hasCaption && (
        <figcaption
          className="ed-figcaption"
          data-caption-align={captionAlign}
          style={{ textAlign: captionAlign }}
        >
          {embed.caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Corridas de 3+ underlines viram um traço contínuo (lacuna de prova).
 *
 * Os caracteres PERMANECEM no DOM como nós de texto: `dom-bridge` mapeia
 * posição de DOM → offset do modelo somando `textContent.length`, então dividir
 * a run em sub-spans é seguro, mas introduzir ou remover caracteres não seria.
 */
function decorateBlanks(text: string): ReactNode {
  const segs = splitUnderscoreRuns(text);
  // Caminho comum (texto sem lacuna): devolve a string crua, sem wrapper.
  if (segs.length === 1 && !segs[0].blank) return text;
  return segs.map((s, i) =>
    s.blank ? (
      <span key={i} data-blank="true" style={BLANK_STYLE as CSSProperties}>
        {s.text}
      </span>
    ) : (
      <Fragment key={i}>{s.text}</Fragment>
    ),
  );
}

function wrap(text: string, attrs?: MarkAttrs): ReactNode {
  // A lacuna fica DENTRO dos wrappers de mark: é decoração do texto, não uma mark.
  let node: ReactNode = decorateBlanks(text);
  if (!attrs) return node;

  if (attrs.bold) node = <strong>{node}</strong>;
  if (attrs.italic) node = <em>{node}</em>;
  if (attrs.underline) node = <u>{node}</u>;
  if (attrs.strike) node = <s>{node}</s>;

  const styleParts: CSSProperties = {};
  if (attrs.color) styleParts.color = attrs.color;
  if (attrs.highlight) styleParts.backgroundColor = attrs.highlight;
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
        style={LINK_STYLE}
        onClick={(e) => {
          // Plain click edits the link text (caret), never navigates. The
          // platform "open" modifier (⌘ on macOS, Ctrl elsewhere) opens the
          // link directly in a new tab. We `preventDefault` in BOTH cases and
          // open via `window.open` ourselves: inside a contentEditable the
          // browser doesn't reliably navigate an `<a>` on modifier-click, so
          // relying on the default action did nothing.
          e.preventDefault();
          if (hasOpenModifier(e) && attrs.link?.href) {
            window.open(attrs.link.href, "_blank", "noopener,noreferrer");
          }
        }}
      >
        {node}
      </a>
    );
  }

  if (attrs.comment?.markId) {
    node = (
      <span data-comment-id={attrs.comment.markId} className="ed-comment">
        {node}
      </span>
    );
  }

  return node;
}
