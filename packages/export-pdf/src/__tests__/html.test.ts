import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument } from "@sofer/core";
import { documentToHtml, documentToHtmlFragment, documentToJson } from "../html";

function frag(doc: LegacySerializedDocument): string {
  return documentToHtmlFragment(doc);
}

describe("documentToHtmlFragment", () => {
  it("renders paragraphs with text", () => {
    const html = frag([
      { type: "paragraph", text: "olá", delta: [{ insert: "olá" }], attrs: {} },
    ]);
    expect(html).toBe(`<p class="ed-paragraph ed-block">olá</p>`);
  });

  it("escapes HTML special characters", () => {
    const html = frag([
      {
        type: "paragraph",
        text: '<b>a & "b"</b>',
        delta: [{ insert: '<b>a & "b"</b>' }],
        attrs: {},
      },
    ]);
    expect(html).toContain("&lt;b&gt;a &amp; &quot;b&quot;&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("wraps marks innermost-first (bold inside italic inside link)", () => {
    const html = frag([
      {
        type: "paragraph",
        text: "hi",
        delta: [
          {
            insert: "hi",
            attributes: { bold: true, italic: true, link: { href: "https://x" } },
          },
        ],
        attrs: {},
      },
    ]);
    expect(html).toContain(
      `<a href="https://x" rel="noopener noreferrer" target="_blank"><em><strong>hi</strong></em></a>`,
    );
  });

  it("emits heading levels and clamps out-of-range", () => {
    const html = frag([
      { type: "heading", text: "A", delta: [{ insert: "A" }], attrs: { level: 2 as any } },
      { type: "heading", text: "B", delta: [{ insert: "B" }], attrs: { level: 99 as any } },
    ]);
    expect(html).toContain("<h2");
    expect(html).toContain("<h6"); // clamped
  });

  it("reconstructs nested lists from flat listItem blocks", () => {
    const html = frag([
      {
        type: "listItem",
        text: "a",
        delta: [{ insert: "a" }],
        attrs: { listKind: "bullet", listLevel: 0 },
      },
      {
        type: "listItem",
        text: "a1",
        delta: [{ insert: "a1" }],
        attrs: { listKind: "bullet", listLevel: 1 },
      },
      {
        type: "listItem",
        text: "b",
        delta: [{ insert: "b" }],
        attrs: { listKind: "bullet", listLevel: 0 },
      },
    ]);
    // outer ul > li (a) + nested ul > li (a1); then sibling li (b)
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>a<ul[^>]*>.*<li[^>]*>a1<\/li><\/ul><\/li><li[^>]*>b<\/li><\/ul>/);
  });

  it("renders tables and skips covered cells", () => {
    const html = frag([
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "x", delta: [{ insert: "x" }], attrs: { colspan: 2 } },
          { text: "", delta: [], attrs: { covered: true } },
        ],
      },
    ]);
    expect(html).toContain('colspan="2"');
    // exactly one td emitted
    const tdCount = (html.match(/<td/g) ?? []).length;
    expect(tdCount).toBe(1);
  });

  it("emits image embeds with data URL and dimensions", () => {
    const html = frag([
      {
        type: "paragraph",
        text: "",
        delta: [
          {
            insert: {
              type: "image",
              src: "data:image/png;base64,abc",
              width: 100,
              height: 50,
            } as any,
          },
        ],
        attrs: {},
      },
    ]);
    expect(html).toContain(`<img src="data:image/png;base64,abc"`);
    expect(html).toContain(`width="100"`);
    expect(html).toContain(`height="50"`);
  });

  it("blocks CSS injection in mark style values", () => {
    const html = frag([
      {
        type: "paragraph",
        text: "x",
        delta: [
          { insert: "x", attributes: { color: 'red";</style><script>alert(1)</script><style>"' } },
        ],
        attrs: {},
      },
    ]);
    // The dangerous chars should be stripped from the inline style.
    expect(html).not.toContain("</style>");
    expect(html).not.toContain("<script>");
  });

  it("puts align class on the block", () => {
    const html = frag([
      {
        type: "paragraph",
        text: "x",
        delta: [{ insert: "x" }],
        attrs: { align: "center" },
      },
    ]);
    expect(html).toContain("ed-align-center");
  });
});

describe("documentToHtml (standalone)", () => {
  it("wraps the fragment with a full html document and a stylesheet", () => {
    const html = documentToHtml([
      { type: "paragraph", text: "a", delta: [{ insert: "a" }], attrs: {} },
    ]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Documento</title>");
    expect(html).toContain("@page");
    expect(html).toContain("</body></html>");
  });

  it("escapes the title", () => {
    const html = documentToHtml([], { title: "<x>" });
    expect(html).toContain("<title>&lt;x&gt;</title>");
  });
});

describe("standalone HTML margins", () => {
  // Regression: previously, both `@page { margin: ... }` AND `body { padding: ... }`
  // declared the same offsets, doubling the printable margin when Chromium
  // honored `@page` (via `preferCSSPageSize` in puppeteer or `window.print`).
  it("declares margins via @page only — body padding never carries page offsets", () => {
    const html = documentToHtml(
      {
        blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
        pageSettings: {
          width: 794,
          height: 1123,
          marginTop: 96,
          marginBottom: 96,
          marginLeft: 96,
          marginRight: 96,
        },
      },
      { standalone: true },
    );
    expect(html).toMatch(/@page\s*\{[^}]*margin:\s*25\.40mm/);
    // No `body { ... padding: <Xmm> ... }` carrying the page margin (Xmm > 0).
    // `padding: 0` (CSS reset) is fine; anything in mm/cm/in would double the
    // page margin on top of `@page`.
    expect(html).not.toMatch(/body[^{]*\{[^}]*padding:\s*\d+(?:\.\d+)?(?:mm|cm|in|px)\b/i);
  });

  it("@page margin reflects custom pageSettings (Ofício + estreita)", () => {
    const html = documentToHtml(
      {
        blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
        pageSettings: {
          width: 816,
          height: 1248,
          marginTop: 48,
          marginBottom: 48,
          marginLeft: 48,
          marginRight: 48,
        },
      },
      { standalone: true },
    );
    // 48 px → 12.70mm; 816 px ≈ 215.90mm (Ofício preset); 1248 px ≈ 330.20mm
    expect(html).toMatch(/@page[^}]*size:\s*215\.90mm\s+330\.20mm/);
    expect(html).toMatch(/@page[^}]*margin:\s*12\.70mm\s+12\.70mm\s+12\.70mm\s+12\.70mm/);
  });
});

describe("documentToJson", () => {
  it("round-trips through JSON.parse", () => {
    const doc: LegacySerializedDocument = [
      { type: "paragraph", text: "ç", delta: [{ insert: "ç" }], attrs: {} },
    ];
    const round = JSON.parse(documentToJson(doc));
    expect(round).toEqual({ blocks: doc });
  });
});
