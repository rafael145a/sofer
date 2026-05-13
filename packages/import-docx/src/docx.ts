import { EditorDocument, type SerializedBlock, type SerializedDocument } from "@editor/core";
import { readDocx, childrenOf, tagOf, findChild, type OoxmlNode } from "./parse-xml";
import { paragraphToBlock } from "./paragraphs";
import { tableToBlock } from "./tables";
import { NumberingResolver } from "./numbering";
import { sectPrToPageSettings } from "./page-settings";
import type { RunContext } from "./runs";

/**
 * Read a `.docx` (OOXML) Blob/ArrayBuffer/Uint8Array and produce a
 * `SerializedDocument` ready to feed `EditorDocument.fromJSON` (or
 * `loadFromJSON` on an existing instance).
 *
 * The mapping is the inverse of `@editor/export-docx`. Round-trip is exact for
 * documents the editor produced; documents authored externally (Word, Google
 * Docs export) load with marks/lists/tables/images recognized and unsupported
 * features dropped silently.
 */
export async function docxBlobToDocument(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<SerializedDocument> {
  const file = await readDocx(input);
  const numbering = new NumberingResolver(file.numberingXml);
  const ctx: RunContext = {
    relationships: file.relationships,
    mediaBytes: file.mediaBytes,
  };

  const body = findBody(file.documentXml);
  if (!body) return { blocks: [{ type: "paragraph", text: "", delta: [], attrs: {} }] };

  const blocks: SerializedBlock[] = [];
  for (const child of childrenOf(body)) {
    const tag = tagOf(child);
    if (tag === "w:p") {
      blocks.push(paragraphToBlock(child, ctx, numbering));
    } else if (tag === "w:tbl") {
      blocks.push(tableToBlock(child, ctx));
    }
    // w:sectPr is parsed below (page settings); other body-level metadata ignored.
  }

  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", text: "", delta: [], attrs: {} });
  }

  const pageSettings = sectPrToPageSettings(findChild(body, "w:sectPr"));
  return pageSettings ? { blocks, pageSettings } : { blocks };
}

/** Convenience: parse → instantiate a fresh `EditorDocument`. */
export async function docxBlobToEditorDocument(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<EditorDocument> {
  const serialized = await docxBlobToDocument(input);
  return EditorDocument.fromJSON(serialized);
}

function findBody(documentXml: OoxmlNode[]): OoxmlNode | undefined {
  for (const top of documentXml) {
    if (tagOf(top) === "w:document") {
      const body = findChild(top, "w:body");
      if (body) return body;
    }
  }
  return undefined;
}
