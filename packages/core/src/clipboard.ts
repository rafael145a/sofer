import type { EditorDocument } from "./document";
import type { DeltaOp, Selection, SerializedBlock } from "./types";
import { sliceDelta } from "./marks";
import { isCollapsed, orderedRange } from "./selection";

/** MIME custom que carrega o slice serializado no clipboard. */
export const SOFER_MIME = "application/x-sofer-slice";

export interface ClipboardSlice {
  /** 1..n blocos; cada delta carrega marks + embeds de imagem. */
  blocks: SerializedBlock[];
  /** 1º bloco é fragmento parcial → mescla inline no alvo da colagem. */
  openStart: boolean;
  /** último bloco é fragmento parcial → conteúdo após o caret continua nele. */
  openEnd: boolean;
}

/** Texto puro de um delta (embeds não contribuem caractere visível). */
function deltaToText(delta: DeltaOp[]): string {
  let s = "";
  for (const op of delta) if (typeof op.insert === "string") s += op.insert;
  return s;
}

/** Monta um SerializedBlock inline a partir de um delta já fatiado.
 *  Para conteúdo vindo de célula (cellIndex != null) o bloco vira "paragraph". */
function blockFromDelta(
  doc: EditorDocument,
  blockIndex: number,
  cellIndex: number | undefined,
  delta: DeltaOp[],
): SerializedBlock {
  if (cellIndex != null) {
    return { type: "paragraph", text: deltaToText(delta), delta, attrs: {} };
  }
  return {
    type: doc.getBlockType(blockIndex) ?? "paragraph",
    text: deltaToText(delta),
    delta,
    attrs: doc.getBlockAttrs(blockIndex),
  };
}

/**
 * Lê a seleção e produz um ClipboardSlice, ou null se:
 * - colapsada; - âncora/foco em células diferentes; - multi-bloco com tabela.
 */
export function serializeSelection(
  doc: EditorDocument,
  sel: Selection,
): ClipboardSlice | null {
  if (isCollapsed(sel)) return null;
  const { start, end } = orderedRange(sel);
  if ((start.cellIndex ?? -1) !== (end.cellIndex ?? -1)) return null;

  if (start.blockIndex === end.blockIndex) {
    const yText = doc.textAt(start.blockIndex, start.cellIndex);
    if (!yText) return null;
    const delta = sliceDelta(yText.toDelta() as DeltaOp[], start.offset, end.offset);
    return {
      blocks: [blockFromDelta(doc, start.blockIndex, start.cellIndex, delta)],
      openStart: start.offset > 0,
      openEnd: end.offset < yText.length,
    };
  }

  if (start.cellIndex != null || end.cellIndex != null) return null;
  for (let i = start.blockIndex; i <= end.blockIndex; i++) {
    if (doc.getBlockType(i) === "table") return null;
  }
  const startText = doc.getBlockText(start.blockIndex);
  const endText = doc.getBlockText(end.blockIndex);
  if (!startText || !endText) return null;

  const blocks: SerializedBlock[] = [];
  blocks.push(
    blockFromDelta(doc, start.blockIndex, undefined,
      sliceDelta(startText.toDelta() as DeltaOp[], start.offset, startText.length)),
  );
  for (let i = start.blockIndex + 1; i < end.blockIndex; i++) {
    const t = doc.getBlockText(i);
    blocks.push(blockFromDelta(doc, i, undefined, (t?.toDelta() as DeltaOp[]) ?? []));
  }
  blocks.push(
    blockFromDelta(doc, end.blockIndex, undefined,
      sliceDelta(endText.toDelta() as DeltaOp[], 0, end.offset)),
  );
  return {
    blocks,
    openStart: start.offset > 0,
    openEnd: end.offset < endText.length,
  };
}

/** Fallback texto puro: textos dos blocos unidos por "\n". */
export function sliceToText(slice: ClipboardSlice): string {
  return slice.blocks.map((b) => deltaToText(b.delta)).join("\n");
}

/** Achata o slice num único delta inline (para colar dentro de uma célula).
 *  Fronteiras de bloco viram quebra de linha "\n" (células renderizam pre-wrap),
 *  para não grudar palavras de parágrafos distintos. */
export function sliceToInlineDelta(slice: ClipboardSlice): DeltaOp[] {
  const out: DeltaOp[] = [];
  slice.blocks.forEach((b, i) => {
    if (i > 0) out.push({ insert: "\n" });
    out.push(...b.delta);
  });
  return out;
}
