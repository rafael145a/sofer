import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import { renderInline } from "../renderInline";
import type { DeltaOp } from "@sofereditor/core";

// renderInline returns a ReactNode (array); wrap in a Fragment to render to
// static markup. Assertions are on the rendered HTML, never on React keys.
const html = (d: DeltaOp[]): string =>
  renderToStaticMarkup(createElement(Fragment, null, renderInline(d, "k")));

const IMG_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageOp(
  embed: Partial<Record<string, unknown>> = {},
  attributes?: DeltaOp["attributes"],
): DeltaOp {
  return {
    insert: { type: "image", src: IMG_SRC, width: 600, height: 400, ...embed },
    ...(attributes ? { attributes } : {}),
  } as unknown as DeltaOp;
}

describe("renderInline — text", () => {
  it("renders plain text with no extra wrapper tags", () => {
    const out = html([{ insert: "hello world" }]);
    expect(out).toBe("hello world");
  });

  it("wraps bold→<strong>, italic→<em>, underline→<u>, strike→<s>", () => {
    expect(html([{ insert: "b", attributes: { bold: true } }])).toBe(
      "<strong>b</strong>",
    );
    expect(html([{ insert: "i", attributes: { italic: true } }])).toBe(
      "<em>i</em>",
    );
    expect(html([{ insert: "u", attributes: { underline: true } }])).toBe(
      "<u>u</u>",
    );
    expect(html([{ insert: "s", attributes: { strike: true } }])).toBe(
      "<s>s</s>",
    );
  });

  it("puts color/fontFamily/fontSize on an inline-styled <span>", () => {
    const out = html([
      {
        insert: "styled",
        attributes: {
          color: "rgb(255, 0, 0)",
          fontFamily: "Arial",
          fontSize: "18px",
        },
      },
    ]);
    expect(out).toContain("<span");
    expect(out).toContain("color:rgb(255, 0, 0)");
    expect(out).toContain("font-family:Arial");
    expect(out).toContain("font-size:18px");
    expect(out).toContain(">styled</span>");
  });

  it("puts highlight on the SAME span as color/font (no extra wrapper)", () => {
    const out = html([
      { insert: "x", attributes: { color: "rgb(0, 0, 255)", highlight: "#fff176" } },
    ]);
    expect(out).toBe(
      '<span style="color:rgb(0, 0, 255);background-color:#fff176">x</span>',
    );
  });

  it("renders highlight alone as a background-color span", () => {
    const out = html([{ insert: "marcado", attributes: { highlight: "#fff176" } }]);
    expect(out).toBe('<span style="background-color:#fff176">marcado</span>');
  });

  it("composes multiple marks innermost→outermost (bold inside the color span)", () => {
    const out = html([
      { insert: "x", attributes: { bold: true, color: "rgb(0, 0, 255)" } },
    ]);
    // wrap order: bold (innermost) → ... → font/color span (outer)
    expect(out).toBe('<span style="color:rgb(0, 0, 255)"><strong>x</strong></span>');
  });

  it("nests all semantic tags in order bold→italic→underline→strike", () => {
    const out = html([
      {
        insert: "x",
        attributes: { bold: true, italic: true, underline: true, strike: true },
      },
    ]);
    expect(out).toBe("<s><u><em><strong>x</strong></em></u></s>");
  });

  it("wraps a comment mark in <span data-comment-id=... class=ed-comment>", () => {
    const out = html([
      { insert: "noted", attributes: { comment: { markId: "cmt-42" } } },
    ]);
    expect(out).toBe(
      '<span data-comment-id="cmt-42" class="ed-comment">noted</span>',
    );
  });
});

describe("renderInline — image embeds", () => {
  it("renders an inline image inside <figure> with <img data-embed=image> and intrinsic size; no figcaption", () => {
    const out = html([imageOp()]);
    expect(out).toContain("<figure");
    expect(out).toContain('data-embed="image"');
    expect(out).toContain("<img");
    // <img> lives inside the <figure>
    expect(out.indexOf("<figure")).toBeLessThan(out.indexOf("<img"));
    expect(out.indexOf("<img")).toBeLessThan(out.indexOf("</figure>"));
    // default layout is "inline"
    expect(out).toContain('data-embed-layout="inline"');
    // no align → data-embed-align is present but empty
    expect(out).toContain('data-embed-align=""');
    // intrinsic width/height on the <img> attributes and style
    expect(out).toContain('width="600"');
    expect(out).toContain('height="400"');
    expect(out).toContain("width:600px");
    expect(out).toContain("height:400px");
    expect(out).toContain('data-embed-offset="0"');
    // no caption → no figcaption
    expect(out).not.toContain("figcaption");
    // inline (no align) wrapper: inline-block + vertical-align:text-bottom
    expect(out).toContain("display:inline-block");
    expect(out).toContain("vertical-align:text-bottom");
  });

  it("inline + align renders the figure as a block with auto margins (left)", () => {
    const out = html([imageOp({ align: "left" })]);
    // align is only consulted in the inline/default case → display:block
    expect(out).toContain("display:block");
    expect(out).toContain("margin-left:0");
    expect(out).toContain("margin-right:auto");
    expect(out).not.toContain("margin-left:0px");
    // align is recorded on the <img>
    expect(out).toContain('data-embed-align="left"');
  });

  it("inline + align right → margin-left:auto; margin-right:0", () => {
    const out = html([imageOp({ align: "right" })]);
    expect(out).toContain("display:block");
    expect(out).toContain("margin-left:auto");
    expect(out).toContain("margin-right:0");
    expect(out).toContain('data-embed-align="right"');
  });

  it("inline + align center → both margins auto", () => {
    const out = html([imageOp({ align: "center" })]);
    expect(out).toContain("display:block");
    expect(out).toContain("margin-left:auto");
    expect(out).toContain("margin-right:auto");
    expect(out).toContain('data-embed-align="center"');
  });

  it("layout 'front' positions the figure absolute with left/top/zIndex:2", () => {
    const out = html([imageOp({ layout: "front", offsetX: 10, offsetY: 20 })]);
    expect(out).toContain("position:absolute");
    expect(out).toContain("left:10px");
    expect(out).toContain("top:20px");
    expect(out).toContain("z-index:2");
    expect(out).toContain('data-embed-layout="front"');
  });

  it("layout 'behind' positions the figure absolute with zIndex:-1", () => {
    const out = html([imageOp({ layout: "behind", offsetX: 5, offsetY: 7 })]);
    expect(out).toContain("position:absolute");
    expect(out).toContain("left:5px");
    expect(out).toContain("top:7px");
    expect(out).toContain("z-index:-1");
    expect(out).toContain('data-embed-layout="behind"');
  });

  it("wrap-left emits the anchor img FIRST and a phantom span at the offset, before body text", () => {
    const out = html([
      imageOp({ layout: "wrap-left" }),
      { insert: "body text" },
    ]);
    // anchor img (data-wrap-anchor) comes first, then phantom, then body text
    expect(out).toContain('data-wrap-anchor="true"');
    expect(out).toContain('data-embed-phantom="true"');
    const anchorIdx = out.indexOf('data-wrap-anchor="true"');
    const phantomIdx = out.indexOf('data-embed-phantom="true"');
    const bodyIdx = out.indexOf("body text");
    expect(anchorIdx).toBeGreaterThanOrEqual(0);
    expect(anchorIdx).toBeLessThan(phantomIdx);
    expect(phantomIdx).toBeLessThan(bodyIdx);
    // float style on the anchor figure
    expect(out).toContain("float:left");
    // phantom carries the embed offset (1 image consumed offset 0 → phantom at 0)
    expect(out).toContain('data-embed-offset="0"');
  });

  it("wrap-right emits a right-floated anchor figure plus phantom", () => {
    const out = html([imageOp({ layout: "wrap-right" }), { insert: "tail" }]);
    expect(out).toContain("float:right");
    expect(out).toContain('data-wrap-anchor="true"');
    expect(out).toContain('data-embed-phantom="true"');
    const anchorIdx = out.indexOf('data-wrap-anchor="true"');
    const tailIdx = out.indexOf("tail");
    expect(anchorIdx).toBeLessThan(tailIdx);
  });

  it("renders a comment-wrapped inline image", () => {
    const out = html([imageOp({}, { comment: { markId: "c-img" } })]);
    expect(out).toContain('data-comment-id="c-img"');
    expect(out).toContain("ed-comment");
    expect(out).toContain('data-embed="image"');
  });
});

describe("renderInline — empties & unknown embeds", () => {
  it("empty delta → <br data-empty=true>", () => {
    expect(html([])).toBe('<br data-empty="true"/>');
  });

  it("single empty-string op → <br data-empty=true>", () => {
    expect(html([{ insert: "" }])).toBe('<br data-empty="true"/>');
  });

  it("an unknown (non-image) embed renders nothing visible (offset slot only)", () => {
    const out = html([
      { insert: { type: "video", src: "x" } } as unknown as DeltaOp,
    ]);
    // not an image embed → no <img>, and only an offset slot is reserved
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<figure");
  });
});

// Conserto 1 (revisão final de feat/listas-em-tabela): renderInline numera
// data-embed-offset a partir de 0 no delta que RECEBE. Quando quem chama já
// fatiou o delta (uma linha de célula-lista via splitDeltaByLines), o offset
// emitido fica LOCAL À LINHA em vez de à célula. baseOffset é o jeito de
// corrigir isso sem mudar o caminho que já recebe o delta inteiro (baseOffset
// default 0 == comportamento antigo).
describe("renderInline — baseOffset (offset em coordenadas do container, não do delta recebido)", () => {
  const htmlAt = (d: DeltaOp[], base: number): string =>
    renderToStaticMarkup(createElement(Fragment, null, renderInline(d, "k", base)));

  it("baseOffset omitido (2 args) numera a partir de 0, igual antes", () => {
    const out = html([{ insert: "ab" }, imageOp()]);
    expect(out).toContain('data-embed-offset="2"');
  });

  it("baseOffset desloca o offset emitido pela quantidade pedida", () => {
    // Simula a linha 1 de "um\n[img]x": o embed é o 1º caractere DESSA linha
    // (offset local 0), mas a linha começa em 3 dentro da célula ("um\n").
    const out = htmlAt([imageOp(), { insert: "x" }], 3);
    expect(out).toContain('data-embed-offset="3"');
  });

  it("baseOffset soma com o offset LOCAL do embed dentro do delta recebido (embed no meio de texto)", () => {
    const out = htmlAt([{ insert: "ab" }, imageOp(), { insert: "cd" }], 6);
    // local seria 2 (depois de "ab"); com base 6, emitido deve ser 8.
    expect(out).toContain('data-embed-offset="8"');
  });
});
