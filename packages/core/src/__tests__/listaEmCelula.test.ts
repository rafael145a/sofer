import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  toggleList,
  type CommandContext,
  type Selection,
} from "../index";
import type { SerializedDocument } from "../types";

function harness() {
  const input: SerializedDocument = {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "um\ndois", delta: [{ insert: "um\ndois" }], attrs: {} },
          { text: "outra", delta: [{ insert: "outra" }], attrs: {} },
        ],
      },
    ],
  };
  const doc = EditorDocument.fromJSON(input);
  let selection: Selection = collapsedSelection({ blockIndex: 0, cellIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
  };
  return { ctx, doc, attrs: (cell: number) => doc.getCellAttrs(0, cell) };
}

describe("toggleList dentro de célula", () => {
  it("liga listKind na célula do cursor", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    expect(h.attrs(0).listKind).toBe("bullet");
  });

  it("não afeta as outras células", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    expect(h.attrs(1).listKind).toBeUndefined();
  });

  it("clicar o mesmo tipo de novo desliga", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    toggleList(h.ctx, "bullet");
    expect(h.attrs(0).listKind).toBeUndefined();
  });

  it("trocar de tipo substitui em vez de desligar", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    toggleList(h.ctx, "ordered");
    expect(h.attrs(0).listKind).toBe("ordered");
  });

  it("não converte a célula em bloco listItem", () => {
    const h = harness();
    toggleList(h.ctx, "ordered");
    expect(h.doc.getBlockType(0)).toBe("table");
    expect(h.doc.toJSON().blocks[0].cells![0].text).toBe("um\ndois");
  });
});

// Caso extra (não estava no brief): descoberto ao verificar leitura vs escrita
// em `setCellAttr` — foco pode pousar numa célula coberta por span, que não
// guarda `listKind` (só `covered: true`). A leitura de `toggleList` precisa
// redirecionar pro owner igual a escrita, senão o toggle-off nunca funciona
// em célula mesclada.
describe("toggleList em célula coberta por span (colspan)", () => {
  function mergedHarness() {
    const input: SerializedDocument = {
      blocks: [
        {
          type: "table",
          text: "",
          delta: [],
          attrs: { rows: 1, cols: 2 },
          cells: [
            { text: "um", delta: [{ insert: "um" }], attrs: { colspan: 2 } },
            { text: "", delta: [], attrs: { covered: true } },
          ],
        },
      ],
    };
    const doc = EditorDocument.fromJSON(input);
    let selection: Selection = collapsedSelection({ blockIndex: 0, cellIndex: 1, offset: 0 });
    const ctx: CommandContext = {
      doc,
      getSelection: () => selection,
      setSelection: (s) => {
        selection = s;
      },
    };
    return { ctx, doc, attrs: (cell: number) => doc.getCellAttrs(0, cell) };
  }

  it("liga listKind no owner mesmo com foco na célula coberta", () => {
    const h = mergedHarness();
    toggleList(h.ctx, "bullet");
    expect(h.attrs(0).listKind).toBe("bullet");
  });

  it("clicar de novo com foco na célula coberta desliga (não fica preso ligando)", () => {
    const h = mergedHarness();
    toggleList(h.ctx, "bullet");
    toggleList(h.ctx, "bullet");
    expect(h.attrs(0).listKind).toBeUndefined();
  });
});
