import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument } from "@sofereditor/core";
import { documentToHtmlFragment } from "../html";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

describe("image caption in HTML export", () => {
  it("emits <figure><img/><figcaption> when caption is set", () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        delta: [
          {
            insert: {
              type: "image",
              src: PNG_1PX,
              width: 100,
              height: 80,
              caption: "Figura 1",
            },
          },
        ],
        attrs: {},
      },
    ];
    const html = documentToHtmlFragment(doc);
    expect(html).toContain("<figure");
    expect(html).toContain("<figcaption");
    expect(html).toContain("Figura 1</figcaption>");
    expect(html).toContain('data-embed-figure="true"');
    // The img keeps its data-embed attribute for round-trip identification.
    expect(html).toContain('data-embed="image"');
  });

  it("emits <figure><img/> without figcaption when caption is absent", () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        delta: [
          { insert: { type: "image", src: PNG_1PX, width: 50, height: 50 } },
        ],
        attrs: {},
      },
    ];
    const html = documentToHtmlFragment(doc);
    // Agora emite <figure> mesmo sem legenda para manter paridade com o editor.
    expect(html).toContain("<figure");
    expect(html).not.toContain("<figcaption");
    expect(html).not.toContain('data-embed-figure="true"');
    expect(html).toContain('data-embed="image"');
  });

  it("respects captionAlign in <figcaption> inline style", () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        delta: [
          {
            insert: {
              type: "image",
              src: PNG_1PX,
              width: 50,
              height: 50,
              caption: "à direita",
              captionAlign: "right",
            },
          },
        ],
        attrs: {},
      },
    ];
    const html = documentToHtmlFragment(doc);
    expect(html).toContain('data-caption-align="right"');
    expect(html).toContain("text-align:right");
  });

  it("defaults captionAlign to center when omitted", () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        delta: [
          {
            insert: {
              type: "image",
              src: PNG_1PX,
              width: 50,
              height: 50,
              caption: "sem alinhamento",
            },
          },
        ],
        attrs: {},
      },
    ];
    const html = documentToHtmlFragment(doc);
    expect(html).toContain('data-caption-align="center"');
    expect(html).toContain("text-align:center");
  });

  it("escapes HTML special chars in caption", () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        delta: [
          {
            insert: {
              type: "image",
              src: PNG_1PX,
              width: 50,
              height: 50,
              caption: "<script>alert('x')</script>",
            },
          },
        ],
        attrs: {},
      },
    ];
    const html = documentToHtmlFragment(doc);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
