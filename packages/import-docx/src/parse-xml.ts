import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

/**
 * fast-xml-parser with `preserveOrder: true` produces a list of single-key
 * objects per element. Each element is either:
 *
 *   - A tag node: `{ "<tagName>": <children-array>, ":@"?: <attrs> }`
 *   - A text node: `{ "#text": <string> }`
 *
 * Attributes are prefixed with `@_`. The `:@` key holds attributes for the
 * surrounding tag. Children preserve original document order, which matters
 * for paragraph runs (bold word followed by italic word).
 */
export type OoxmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false, // keep whitespace inside <w:t>
  parseAttributeValue: false,
  parseTagValue: false,
});

export interface DocxFile {
  documentXml: OoxmlNode[];
  numberingXml?: OoxmlNode[];
  /** rId → target path (inside the zip), e.g. "media/image1.png". */
  relationships: Map<string, string>;
  /** zip path (without leading "word/") → bytes for embedded media. */
  mediaBytes: Map<string, Uint8Array>;
}

export async function readDocx(input: Blob | ArrayBuffer | Uint8Array): Promise<DocxFile> {
  const data =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(await (input as Blob).arrayBuffer());

  const zip = await JSZip.loadAsync(data);
  const documentXml = await readXml(zip, "word/document.xml");
  if (!documentXml) throw new Error("Invalid .docx: missing word/document.xml");

  const numberingXml = await readXml(zip, "word/numbering.xml");
  const relsXml = await readXml(zip, "word/_rels/document.xml.rels");
  const relationships = parseRelationships(relsXml);

  const mediaBytes = new Map<string, Uint8Array>();
  const mediaFolder = zip.folder("word/media");
  if (mediaFolder) {
    const promises: Promise<void>[] = [];
    mediaFolder.forEach((relativePath, file) => {
      if (file.dir) return;
      promises.push(
        file.async("uint8array").then((bytes) => {
          mediaBytes.set(`media/${relativePath}`, bytes);
        }),
      );
    });
    await Promise.all(promises);
  }

  return { documentXml, numberingXml, relationships, mediaBytes };
}

async function readXml(zip: JSZip, path: string): Promise<OoxmlNode[] | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  const text = await entry.async("string");
  return parser.parse(text) as OoxmlNode[];
}

function parseRelationships(nodes: OoxmlNode[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!nodes) return out;
  // <Relationships><Relationship Id="rId1" Type="..." Target="media/image1.png"/>...
  for (const top of nodes) {
    const children = top["Relationships"];
    if (!Array.isArray(children)) continue;
    for (const child of children as OoxmlNode[]) {
      if (!("Relationship" in child)) continue;
      const attrs = (child[":@"] ?? {}) as Record<string, unknown>;
      const id = attrs["@_Id"];
      const target = attrs["@_Target"];
      if (typeof id === "string" && typeof target === "string") {
        out.set(id, target);
      }
    }
  }
  return out;
}

// ---------- generic walkers over preserveOrder shape ----------

/** Returns the tag name (e.g. "w:p") of a preserveOrder element, or null for text. */
export function tagOf(node: OoxmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key === ":@") continue;
    return key;
  }
  return null;
}

/** Returns the children array of an element, or [] when none. */
export function childrenOf(node: OoxmlNode): OoxmlNode[] {
  const tag = tagOf(node);
  if (!tag) return [];
  const v = node[tag];
  return Array.isArray(v) ? (v as OoxmlNode[]) : [];
}

/** Returns the attribute bag (already with `@_` prefix) for an element. */
export function attrsOf(node: OoxmlNode): Record<string, unknown> {
  return ((node[":@"] ?? {}) as Record<string, unknown>) ?? {};
}

/** Read a single `@_key` attribute as a string. */
export function attr(node: OoxmlNode, key: string): string | undefined {
  const v = attrsOf(node)[`@_${key}`];
  return typeof v === "string" ? v : undefined;
}

/** Find the first direct child with the given tag name. */
export function findChild(node: OoxmlNode, tag: string): OoxmlNode | undefined {
  for (const child of childrenOf(node)) {
    if (tagOf(child) === tag) return child;
  }
  return undefined;
}

/** Find all direct children with the given tag name. */
export function findChildren(node: OoxmlNode, tag: string): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const child of childrenOf(node)) {
    if (tagOf(child) === tag) out.push(child);
  }
  return out;
}

/** Recursively collect text nodes' concatenated content. */
export function textOf(node: OoxmlNode): string {
  let out = "";
  for (const child of childrenOf(node)) {
    if ("#text" in child) {
      const t = child["#text"];
      if (typeof t === "string") out += t;
    } else {
      out += textOf(child);
    }
  }
  return out;
}
