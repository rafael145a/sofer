import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import { renderInline } from "../renderInline";
import type { DeltaOp } from "@sofereditor/core";

// Bug #11: applying a caption must NOT change the <img>'s parent type. Before
// the fix, no-caption rendered a bare <img> and with-caption nested it in a
// <figure>, forcing React to remount the <img> (sync base64 re-decode → freeze).
// The fix makes the structure invariant: ALWAYS <figure><img/>{?figcaption}.
// This test pins the structural invariant (combined with the positional key,
// that's the necessary+sufficient condition for the <img> DOM node to survive).

const IMG_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageDelta(extra: Partial<Record<string, unknown>> = {}): DeltaOp[] {
  return [
    {
      insert: {
        type: "image",
        src: IMG_SRC,
        width: 600,
        height: 400,
        layout: "front",
        offsetX: 10,
        offsetY: 20,
        ...extra,
      },
    } as unknown as DeltaOp,
  ];
}

function html(delta: DeltaOp[]): string {
  // renderInline returns a ReactNode (array); wrap in a Fragment to render.
  return renderToStaticMarkup(createElement(Fragment, null, renderInline(delta, "t")));
}

describe("renderInline image caption (bug #11)", () => {
  it("renders the <img> inside a <figure> even WITHOUT a caption", () => {
    const out = html(imageDelta());
    expect(out).toContain("<figure");
    expect(out).toContain('data-embed="image"');
    // the <img> must be a child of the <figure> (figure opens before img)
    expect(out.indexOf("<figure")).toBeLessThan(out.indexOf("<img"));
    expect(out.indexOf("<img")).toBeLessThan(out.indexOf("</figure>"));
    // no caption → no <figcaption>
    expect(out).not.toContain("figcaption");
    // figure carries the layout (positioning) attribute
    expect(out).toContain('data-embed-layout="front"');
  });

  it("renders the SAME figure>img structure WITH a caption, only adding <figcaption>", () => {
    const out = html(imageDelta({ caption: "uma legenda" }));
    expect(out).toContain("<figure");
    expect(out.indexOf("<figure")).toBeLessThan(out.indexOf("<img"));
    expect(out).toContain("<figcaption");
    expect(out).toContain("uma legenda");
    // figcaption comes AFTER the img, still inside the figure
    expect(out.indexOf("<img")).toBeLessThan(out.indexOf("<figcaption"));
  });

  it("the <img> markup is byte-identical with and without a caption (no remount trigger)", () => {
    const withoutCap = html(imageDelta());
    const withCap = html(imageDelta({ caption: "x" }));
    const imgOf = (s: string) => s.slice(s.indexOf("<img"), s.indexOf(">", s.indexOf("<img")) + 1);
    expect(imgOf(withCap)).toBe(imgOf(withoutCap));
  });
});
