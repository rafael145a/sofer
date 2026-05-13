import type { ImageEmbed } from "@sofer/core";
import { attr, childrenOf, tagOf, type OoxmlNode } from "./parse-xml";
import { parseIntAttr } from "./units";

/** 1 inch = 914400 EMU = 96 px → 1 px = 9525 EMU. */
const EMU_PER_PX = 9525;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export interface ImageContext {
  relationships: Map<string, string>;
  mediaBytes: Map<string, Uint8Array>;
}

/**
 * Walk a `<w:drawing>` node and return an `ImageEmbed` if it contains a
 * recognized inline picture. Returns null for unsupported drawings (shapes,
 * charts, etc.).
 */
export function extractImageFromDrawing(
  drawing: OoxmlNode,
  ctx: ImageContext,
): ImageEmbed | null {
  // The interesting bits live deep inside: a:blip carries `r:embed`, and
  // wp:extent carries cx/cy. We do a generic walk because the wrapping nodes
  // differ between inline (`wp:inline`) and anchored (`wp:anchor`) drawings.
  let embedId: string | undefined;
  let cx: number | undefined;
  let cy: number | undefined;

  walk(drawing, (n) => {
    const tag = tagOf(n);
    if (!tag) return;
    if (tag === "a:blip") {
      const id = attr(n, "r:embed") ?? attr(n, "r:link");
      if (id) embedId = id;
    } else if (tag === "wp:extent") {
      cx = parseIntAttr(attr(n, "cx"));
      cy = parseIntAttr(attr(n, "cy"));
    }
  });

  if (!embedId) return null;
  const target = ctx.relationships.get(embedId);
  if (!target) return null;
  // Relationship targets are typically "media/image1.png"; the zip lookup uses
  // the same path (we stored bytes keyed under "media/<file>").
  const bytes = ctx.mediaBytes.get(target);
  if (!bytes) return null;

  const ext = extensionOf(target);
  const mime = MIME_BY_EXT[ext] ?? "image/png";
  const src = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const widthPx = cx != null ? Math.max(1, Math.round(cx / EMU_PER_PX)) : 100;
  const heightPx = cy != null ? Math.max(1, Math.round(cy / EMU_PER_PX)) : 100;

  return { type: "image", src, width: widthPx, height: heightPx };
}

function walk(node: OoxmlNode, visit: (n: OoxmlNode) => void): void {
  visit(node);
  for (const child of childrenOf(node)) {
    if ("#text" in child) continue;
    walk(child, visit);
  }
}

function extensionOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

function bytesToBase64(bytes: Uint8Array): string {
  // Browser path.
  if (typeof btoa === "function") {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(bin);
  }
  // Node fallback.
  return Buffer.from(bytes).toString("base64");
}
