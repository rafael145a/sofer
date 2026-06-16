import * as Y from "yjs";
import type { EditorDocument } from "./document";
import { getBlockId } from "./document";
import type { Position, Selection } from "./types";

/**
 * Codificação de cursor colaborativo resiliente a edição concorrente.
 *
 * Posições do editor são ABSOLUTAS ({blockIndex, offset}) — quebram quando
 * blocos/texto são inseridos/removidos acima por outro usuário. Aqui usamos
 * `Y.RelativePosition`, que ancora no caractere exato dentro do `Y.Text` e
 * sobrevive a moves/edições (é o que o Google Docs faz). O `blockId` é um
 * fallback: se o caractere ancorado foi apagado, posicionamos no início do
 * bloco original.
 */

// ---------- base64 de Uint8Array (browser + node) ----------
function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Y.Text que contém a posição (texto do bloco, ou de uma célula de tabela). */
function yTextAt(doc: EditorDocument, pos: Position): Y.Text | null {
  const block = doc.blocks.get(pos.blockIndex);
  if (!block) return null;
  if (typeof pos.cellIndex === "number") {
    const cells = block.get("cells") as Y.Array<Y.Map<unknown>> | undefined;
    const cell = cells?.get(pos.cellIndex);
    const t = cell?.get("text");
    return t instanceof Y.Text ? t : null;
  }
  const t = block.get("text");
  return t instanceof Y.Text ? t : null;
}

/** Localiza {blockIndex, cellIndex?} de um Y.Text já resolvido. O(n) nos blocos. */
function locateYText(
  doc: EditorDocument,
  target: Y.Text,
): { blockIndex: number; cellIndex?: number } | null {
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks.get(i);
    if (block.get("text") === target) return { blockIndex: i };
    const cells = block.get("cells") as Y.Array<Y.Map<unknown>> | undefined;
    if (cells) {
      for (let c = 0; c < cells.length; c++) {
        if (cells.get(c)?.get("text") === target) {
          return { blockIndex: i, cellIndex: c };
        }
      }
    }
  }
  return null;
}

export interface EncodedCursorPoint {
  /** base64 de Y.encodeRelativePosition — rastreia o caractere exato. */
  rel: string;
  /** Fallback: id do bloco original (ancora no início se o char sumiu). */
  blockId?: string;
  /** Fallback: célula da tabela, se aplicável. */
  cellIndex?: number;
}

export interface EncodedCursor {
  anchor: EncodedCursorPoint;
  focus: EncodedCursorPoint;
}

function encodePoint(doc: EditorDocument, pos: Position): EncodedCursorPoint | null {
  const yText = yTextAt(doc, pos);
  if (!yText) return null;
  const offset = Math.max(0, Math.min(pos.offset, yText.length));
  const rel = Y.createRelativePositionFromTypeIndex(yText, offset);
  const block = doc.blocks.get(pos.blockIndex);
  const point: EncodedCursorPoint = { rel: toBase64(Y.encodeRelativePosition(rel)) };
  const blockId = block ? getBlockId(block) : undefined;
  if (blockId) point.blockId = blockId;
  if (typeof pos.cellIndex === "number") point.cellIndex = pos.cellIndex;
  return point;
}

function decodePoint(doc: EditorDocument, enc: EncodedCursorPoint): Position | null {
  // 1) Primário: RelativePosition (rastreia o char mesmo após edições/moves).
  try {
    const rel = Y.decodeRelativePosition(fromBase64(enc.rel));
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc.ydoc);
    if (abs && abs.type instanceof Y.Text) {
      const loc = locateYText(doc, abs.type);
      if (loc) return { ...loc, offset: abs.index };
    }
  } catch {
    /* cai no fallback */
  }
  // 2) Fallback: acha o bloco pelo id e ancora no início.
  if (enc.blockId) {
    for (let i = 0; i < doc.blocks.length; i++) {
      if (getBlockId(doc.blocks.get(i)) === enc.blockId) {
        const p: Position = { blockIndex: i, offset: 0 };
        if (typeof enc.cellIndex === "number") p.cellIndex = enc.cellIndex;
        return p;
      }
    }
  }
  return null;
}

/** Codifica a seleção local em um descritor portável (para o awareness). */
export function encodeSelection(
  doc: EditorDocument,
  sel: Selection,
): EncodedCursor | null {
  const anchor = encodePoint(doc, sel.anchor);
  const focus = encodePoint(doc, sel.focus);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}

/** Decodifica um descritor remoto para uma seleção absoluta no doc atual. */
export function decodeSelection(
  doc: EditorDocument,
  enc: EncodedCursor,
): Selection | null {
  const anchor = decodePoint(doc, enc.anchor);
  const focus = decodePoint(doc, enc.focus);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}
