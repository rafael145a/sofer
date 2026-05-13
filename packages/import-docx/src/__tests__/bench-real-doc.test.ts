import { describe, it } from "vitest";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { EditorDocument } from "@editor/core";
import { docxBlobToDocument } from "../docx";

/**
 * Microbenchmark on the real "P1 - 1º SEMESTRE - MATEMÁTICA" exam (7 images,
 * ~2.16 MB raw). Run with `pnpm --filter @editor/import-docx test bench`.
 *
 * Skips silently when the file isn't present (CI / other developers).
 */
const DOC_PATH = path.resolve(
  // packages/import-docx → editor-monorepo → AlefPeretz → docs-auxiliares
  __dirname,
  "../../../../../docs-auxiliares/P1  -  1 º SEMESTRE - MATEMÁTICA_ok .docx",
);

describe("real-doc benchmark", () => {
  it("imports and measures toJSON cost", async () => {
    let buf: Buffer;
    try {
      buf = await readFile(DOC_PATH);
    } catch {
      console.warn(`[bench] file not found: ${DOC_PATH} — skipping`);
      return;
    }

    const importStart = performance.now();
    const serialized = await docxBlobToDocument(buf);
    const importMs = performance.now() - importStart;

    let imageCount = 0;
    let totalSrcChars = 0;
    for (const block of serialized.blocks) {
      for (const op of block.delta) {
        if (typeof op.insert === "object" && op.insert && (op.insert as { type?: string }).type === "image") {
          imageCount++;
          totalSrcChars += ((op.insert as { src: string }).src ?? "").length;
        }
      }
    }

    const fromJsonStart = performance.now();
    const doc = EditorDocument.fromJSON(serialized);
    const fromJsonMs = performance.now() - fromJsonStart;

    // Measure 10 toJSON calls to simulate 10 keystrokes worth of snapshot work.
    const N = 10;
    const toJsonStart = performance.now();
    for (let i = 0; i < N; i++) doc.toJSON();
    const toJsonMs = (performance.now() - toJsonStart) / N;

    // Measure JSON.stringify on the full snapshot — this is what the
    // playground's debug <pre> was doing on every keystroke (fix A).
    const snap = doc.toJSON();
    const stringifyStart = performance.now();
    for (let i = 0; i < N; i++) JSON.stringify(snap, null, 2);
    const stringifyMs = (performance.now() - stringifyStart) / N;

    console.log("[bench] real exam doc");
    console.log(`  blocks:           ${serialized.blocks.length}`);
    console.log(`  images:           ${imageCount}`);
    console.log(`  total base64 src: ${(totalSrcChars / 1024).toFixed(0)} KB`);
    console.log(`  docxBlobToDocument: ${importMs.toFixed(1)} ms`);
    console.log(`  EditorDocument.fromJSON: ${fromJsonMs.toFixed(1)} ms`);
    console.log(`  toJSON (avg of ${N}):   ${toJsonMs.toFixed(2)} ms / call`);
    console.log(`  JSON.stringify(snap):   ${stringifyMs.toFixed(2)} ms / call ← fix A removes this from keystroke hot path`);

    // Dump each image's metadata so we can correlate visual bugs with the
    // import output.
    console.log("\n[bench] image inventory:");
    let blockIdx = 0;
    for (const block of serialized.blocks) {
      let offsetInBlock = 0;
      for (const op of block.delta) {
        if (typeof op.insert === "object" && op.insert && (op.insert as { type?: string }).type === "image") {
          const img = op.insert as { width: number; height: number; layout?: string; align?: string; src: string };
          const aspect = (img.width / img.height).toFixed(3);
          console.log(
            `  block ${blockIdx} (${block.type}) offset ${offsetInBlock}: ` +
            `${img.width}×${img.height} (aspect ${aspect}) layout=${img.layout ?? "inline"} ` +
            `srcBytes=${img.src.length}`,
          );
        }
        offsetInBlock += typeof op.insert === "string" ? op.insert.length : 1;
      }
      blockIdx++;
    }
  });
});
