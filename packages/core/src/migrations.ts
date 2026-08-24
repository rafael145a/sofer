/**
 * Migrações de modelo — transformações one-shot sobre um documento existente.
 *
 * Regra do projeto: a fonte do editor mora no CSS (`.ed-root`), nunca no
 * modelo. Fonte inline fossiliza o documento e transforma "trocar a fonte"
 * numa migração de dados, que foi exatamente o que aconteceu com o
 * `forceArialOnImport` dos apps consumidores.
 */
import * as Y from "yjs";
import type { EditorDocument } from "./document";
import type { DeltaOp } from "./types";

/** Trecho contíguo de um `Y.Text` que carrega a marca. */
interface Alvo {
  yText: Y.Text;
  ranges: Array<[index: number, length: number]>;
}

function coletar(yText: Y.Text | undefined, alvos: Alvo[]): number {
  if (!yText) return 0;
  const delta = yText.toDelta() as DeltaOp[];
  const ranges: Array<[number, number]> = [];
  let index = 0;
  for (const op of delta) {
    // Embeds (imagem, fórmula) têm length 1 e nunca receberam a marca —
    // `forceArialOnImport` pulava insert não-string.
    const len = typeof op.insert === "string" ? op.insert.length : 1;
    if (typeof op.insert === "string" && op.attributes && "fontFamily" in op.attributes) {
      ranges.push([index, len]);
    }
    index += len;
  }
  if (ranges.length > 0) alvos.push({ yText, ranges });
  return ranges.length;
}

/**
 * Remove toda marca `fontFamily` do documento — de blocos e de células de
 * tabela. Remove **todas**, não só as de valor conhecido: com o dropdown de
 * fonte fora da toolbar, nenhuma marca legítima pode existir.
 *
 * Idempotente e observável: conta antes de escrever e só abre transação se
 * houver o que limpar. Documento já migrado não gera update no Y.Doc, logo não
 * dispara o autosave e não regrava o `htmlSnapshot`.
 *
 * A transação usa origin `"migration"`, seguindo a convenção de `"pageSettings"`
 * e `"import"` (`document.ts:106`) — origens que o `UndoManager` não rastreia.
 * Sem isso, o primeiro Ctrl+Z do professor desfaria a migração em vez da edição
 * dele.
 *
 * @returns número de runs que carregavam a marca. 0 = nenhuma escrita.
 */
export function stripFontFamilyMarks(
  doc: EditorDocument,
  opts?: { dryRun?: boolean },
): number {
  const alvos: Alvo[] = [];
  let total = 0;

  for (let i = 0; i < doc.blockCount(); i++) {
    total += coletar(doc.getBlockText(i), alvos);
    const cells = doc.getCells(i);
    if (cells) {
      for (let c = 0; c < cells.length; c++) {
        total += coletar(doc.getCellText(i, c), alvos);
      }
    }
  }

  if (total === 0 || opts?.dryRun) return total;

  doc.ydoc.transact(() => {
    for (const { yText, ranges } of alvos) {
      for (const [index, length] of ranges) {
        yText.format(index, length, { fontFamily: null });
      }
    }
  }, "migration");

  return total;
}
