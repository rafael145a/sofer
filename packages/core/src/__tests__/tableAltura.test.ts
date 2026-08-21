import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  deleteTableRow,
  insertTable,
  insertTableRow,
  MIN_LINHA_PX,
  setRowHeight,
  type CommandContext,
  type Selection,
} from "../index";

function harness() {
  const doc = new EditorDocument();
  let selection: Selection = collapsedSelection({ blockIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => { selection = s; },
  };
  return {
    doc, ctx,
    get selection() { return selection; },
    setSel(s: Selection) { selection = s; },
  };
}

describe("rowHeights acompanha o número de linhas", () => {
  it("insertTableRow cresce o array", () => {
    // Sem isto o TableResizeOverlay cai no `Shape mismatch — bail out` que
    // ele já tem, e as alças simplesmente somem, sem erro nenhum.
    const h = harness();
    insertTable(h.ctx, 3, 2);
    setRowHeight(h.ctx, 1, 0, 40);
    setRowHeight(h.ctx, 1, 1, 40);
    setRowHeight(h.ctx, 1, 2, 40);
    // Nota: o brief usa "below" aqui, mas o tipo real de `where` é
    // "before" | "after" — não existe "below"/"above". "after" é o
    // equivalente semântico (insere abaixo da linha 1), igual ao que
    // tableProporcao.test.ts já documentou para insertTableColumn.
    insertTableRow(h.ctx, 1, 1, "after");
    expect(h.doc.getBlockAttrs(1).rowHeights).toHaveLength(4);
  });

  it("deleteTableRow encolhe o array e tira a linha certa", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    setRowHeight(h.ctx, 1, 0, 40);
    setRowHeight(h.ctx, 1, 1, 99);
    setRowHeight(h.ctx, 1, 2, 40);
    deleteTableRow(h.ctx, 1, 1);
    expect(h.doc.getBlockAttrs(1).rowHeights).toEqual([40, 40]);
  });

  it("tabela sem rowHeights não ganha o atributo à toa", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    insertTableRow(h.ctx, 1, 1, "after");
    expect(h.doc.getBlockAttrs(1).rowHeights).toBeUndefined();
  });
});

describe("setRowHeight", () => {
  it("grava px e respeita o piso", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    setRowHeight(h.ctx, 1, 1, 5);
    expect((h.doc.getBlockAttrs(1).rowHeights as number[])[1]).toBe(MIN_LINHA_PX);
  });
});
