// @vitest-environment jsdom
/**
 * Task 4 (redimensionamento de tabela) — evidência de execução para o
 * `<tr style="height:…px">` no editor, nos dois caminhos que a Task 4 toca:
 * o `TableView` completo (via `<Editor>`, mesmo padrão de
 * `tableProporcao.parity.test.tsx`) e o `NodeView` isolado com
 * `tableFragment` — para travar que a indexação `r = rowStart + i` lê
 * `rowHeights[r]` pelo índice ABSOLUTO da linha, não pelo índice relativo ao
 * fragmento (um off-by-one aqui corromperia a altura de tabelas quebradas
 * entre páginas, sem nenhum teste hoje capaz de flagrar via medição real —
 * `usePagination` mede `getBoundingClientRect`, que é sempre 0 em jsdom).
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { Editor } from "../Editor";
import { EditorProvider } from "../EditorContext";
import { NodeView } from "../NodeView";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa `ResizeObserver` — mesmo polyfill local de
// `tableProporcao.parity.test.tsx`.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function tableDoc(rows: number, cols: number, rowHeights?: number[]): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: {
          rows,
          cols,
          ...(rowHeights != null ? { rowHeights } : {}),
        },
        cells: Array.from({ length: rows * cols }, () => ({ text: "", delta: [], attrs: {} })),
      },
    ],
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mount(el: ReturnType<typeof createElement>): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(el);
  });
  return container;
}

function mountEditorDom(doc: SerializedDocument): HTMLElement {
  const editorDoc = EditorDocument.fromJSON(doc);
  function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
    const editor = useEditor({ document: editorDoc });
    apiRef.current = editor;
    return createElement(Editor, { editor, pageGeometry: null });
  }
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  return mount(createElement(Harness, { apiRef }));
}

describe("rowHeights no <tr> do editor", () => {
  it("linha com altura declarada ganha style height em px", () => {
    const dom = mountEditorDom(tableDoc(3, 2, [40, 60, 16]));
    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    expect(trs).toHaveLength(3);
    expect(trs[0]!.style.height).toBe("40px");
    expect(trs[1]!.style.height).toBe("60px");
    expect(trs[2]!.style.height).toBe("16px");
  });

  it("tabela sem rowHeights não recebe height inline em nenhuma linha", () => {
    const dom = mountEditorDom(tableDoc(2, 2));
    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    expect(trs).toHaveLength(2);
    for (const tr of trs) expect(tr.style.height).toBe("");
  });
});

describe("rowHeights e tableFragment — indexação absoluta, não relativa ao fragmento", () => {
  it("um fragmento que começa em rowStart=1 lê rowHeights[1] para a sua primeira linha renderizada", () => {
    const editorDoc = EditorDocument.fromJSON(tableDoc(3, 2, [11, 22, 33]));
    function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
      const editor = useEditor({ document: editorDoc });
      apiRef.current = editor;
      return (
        <EditorProvider editor={editor}>
          <NodeView
            block={editor.snapshot.blocks[0]!}
            index={0}
            tableFragment={{ index: 1, rowStart: 1, rowEnd: 3 }}
          />
        </EditorProvider>
      );
    }
    const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
    const dom = mount(createElement(Harness, { apiRef }));
    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    // Só as linhas [1, 3) do fragmento são renderizadas: 2 linhas, absolutas 1 e 2.
    expect(trs).toHaveLength(2);
    expect(trs[0]!.getAttribute("data-cell-row")).toBe("1");
    expect(trs[0]!.style.height).toBe("22px"); // rowHeights[1], não rowHeights[0] (11px)
    expect(trs[1]!.getAttribute("data-cell-row")).toBe("2");
    expect(trs[1]!.style.height).toBe("33px");
  });
});
