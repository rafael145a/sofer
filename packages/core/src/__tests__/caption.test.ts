import { describe, it, expect } from "vitest";
import { EditorDocument } from "../document";
import type { ImageEmbed, SerializedDocument } from "../types";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

describe("image caption", () => {
  it("survives toJSON/fromJSON round-trip", () => {
    const embed: ImageEmbed = {
      type: "image",
      src: PNG_1PX,
      width: 100,
      height: 80,
      caption: "Figura 1: Mapa do Brasil",
    };
    const input: SerializedDocument = {
      blocks: [
        {
          type: "paragraph",
          text: "",
          delta: [{ insert: embed }],
          attrs: {},
        },
      ],
    };
    const doc = EditorDocument.fromJSON(input);
    const out = doc.toJSON();
    const outEmbed = out.blocks[0].delta[0].insert as ImageEmbed;
    expect(outEmbed.caption).toBe("Figura 1: Mapa do Brasil");
  });

  it("captionAlign survives toJSON/fromJSON round-trip", () => {
    const input: SerializedDocument = {
      blocks: [
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
      ],
    };
    const doc = EditorDocument.fromJSON(input);
    const out = doc.toJSON().blocks[0].delta[0].insert as ImageEmbed;
    expect(out.captionAlign).toBe("right");
  });

  it("caption is optional — embeds without it round-trip with no field set", () => {
    const embed: ImageEmbed = { type: "image", src: PNG_1PX, width: 50, height: 50 };
    const input: SerializedDocument = {
      blocks: [{ type: "paragraph", text: "", delta: [{ insert: embed }], attrs: {} }],
    };
    const doc = EditorDocument.fromJSON(input);
    const outEmbed = doc.toJSON().blocks[0].delta[0].insert as ImageEmbed;
    expect(outEmbed.caption).toBeUndefined();
  });
});
