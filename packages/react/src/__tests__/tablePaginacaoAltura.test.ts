// @vitest-environment jsdom
/**
 * Task 5 — risco em aberto sinalizado no brief: a suíte de paginação está
 * verde por não medir. `usePagination.placeFragmentedTable` lê
 * `tr.getBoundingClientRect().height` e `elTotalHeight` lê `offsetHeight`;
 * os dois são SEMPRE 0 no jsdom (que não faz layout de verdade), então uma
 * tabela de qualquer tamanho "cabe" na página 1 e o branch de corte por
 * linha nunca roda em nenhum teste hoje — o mesmo aviso já está documentado
 * em `tableAltura.render.test.tsx` (Task 4).
 *
 * Este teste mocka as duas leituras para refletirem a altura DECLARADA em
 * `rowHeights` — o `style="height:Xpx"` que o `NodeView` já escreve no
 * `<tr>` — derivando tudo do markup real, sem atributos de teste inventados.
 * Isso NÃO simula altura de CONTEÚDO real (texto quebrando linha, que
 * exigiria um motor de layout de verdade — fora do alcance do jsdom), mas
 * exercita de ponta a ponta o corte de linhas do `placeFragmentedTable` com
 * uma medição determinística e não-zero: uma tabela cujas linhas declaradas
 * somam mais que o espaço útil da página REALMENTE quebra em duas páginas,
 * na linha certa.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { Editor } from "../Editor";
import { useEditor, type UseEditorResult } from "../useEditor";
import type { PageGeometry } from "../usePagination";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function tableDoc(rows: number, cols: number, rowHeights: number[]): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows, cols, rowHeights },
        cells: Array.from({ length: rows * cols }, () => ({ text: "", delta: [], attrs: {} })),
      },
    ],
  };
}

const originalGBCR = Element.prototype.getBoundingClientRect;
const originalOffsetHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

function rectFor(height: number): DOMRect {
  return {
    width: 700,
    height,
    top: 0,
    left: 0,
    right: 700,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

function trDeclaredHeight(tr: HTMLElement): number {
  return tr.style.height ? parseFloat(tr.style.height) : 0;
}

// Deriva a altura de `<tr>` e do `<table data-block-type="table">` a partir
// do `style.height` DECLARADO que o NodeView escreve (rowHeights do
// modelo) — nunca de um atributo inventado para o teste. `offsetHeight` do
// wrapper `.ed-table-wrap` (usado por `elTotalHeight`) fica igual à altura
// da tabela por dentro, com "chrome" (padding/margin) zero.
function installDeclaredHeightMocks(): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this.tagName === "TR") {
      return rectFor(trDeclaredHeight(this as HTMLElement));
    }
    if (this.tagName === "TABLE" && (this as HTMLElement).dataset.blockType === "table") {
      const trs = Array.from(this.querySelectorAll(":scope > tbody > tr")) as HTMLElement[];
      const total = trs.reduce((acc, tr) => acc + trDeclaredHeight(tr), 0);
      return rectFor(total);
    }
    return originalGBCR.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.classList.contains("ed-table-wrap")) {
        const table = this.querySelector("table");
        return table ? table.getBoundingClientRect().height : 0;
      }
      return 0;
    },
  });
}

function restoreHeightMocks(): void {
  Element.prototype.getBoundingClientRect = originalGBCR;
  if (originalOffsetHeightDesc) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeightDesc);
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  restoreHeightMocks();
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mountPaginated(doc: SerializedDocument, geometry: PageGeometry): HTMLElement {
  const editorDoc = EditorDocument.fromJSON(doc);
  function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
    const editor = useEditor({ document: editorDoc });
    apiRef.current = editor;
    return createElement(Editor, { editor, pageGeometry: geometry });
  }
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  return container;
}

describe("placeFragmentedTable corta linhas usando altura DECLARADA (rowHeights), não conteúdo real", () => {
  it("5 linhas de 100px numa página com 300px úteis quebra em 2 páginas, 3+2, sem reiniciar o índice", () => {
    installDeclaredHeightMocks();
    // content height = 400 - 50 - 50 = 300.
    const geometry: PageGeometry = {
      width: 800,
      height: 400,
      marginTop: 50,
      marginBottom: 50,
      marginLeft: 50,
      marginRight: 50,
    };
    const dom = mountPaginated(tableDoc(5, 1, [100, 100, 100, 100, 100]), geometry);

    const pages = dom.querySelectorAll(".ed-page");
    expect(pages).toHaveLength(2);

    const rowsPage1 = [...pages[0]!.querySelectorAll("tr[data-cell-row]")];
    const rowsPage2 = [...pages[1]!.querySelectorAll("tr[data-cell-row]")];
    expect(rowsPage1).toHaveLength(3);
    expect(rowsPage2).toHaveLength(2);
    // Índice absoluto: a página 2 continua em 3 e 4, não reinicia em 0.
    expect(rowsPage1.map((tr) => tr.getAttribute("data-cell-row"))).toEqual(["0", "1", "2"]);
    expect(rowsPage2.map((tr) => tr.getAttribute("data-cell-row"))).toEqual(["3", "4"]);
  });

  it("linhas que cabem inteiras não quebram (o mock não força split à toa)", () => {
    installDeclaredHeightMocks();
    const geometry: PageGeometry = {
      width: 800,
      height: 400,
      marginTop: 50,
      marginBottom: 50,
      marginLeft: 50,
      marginRight: 50,
    };
    const dom = mountPaginated(tableDoc(2, 1, [50, 50]), geometry);
    const pages = dom.querySelectorAll(".ed-page");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.querySelectorAll("tr[data-cell-row]")).toHaveLength(2);
  });
});
