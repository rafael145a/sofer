// @vitest-environment jsdom
/**
 * Task 2 (redimensionamento de tabela) — paridade real de DOM entre o
 * editor (`NodeView`/`TableView`, montado de verdade via `<Editor>`, mesmo
 * padrão de `Editor.paste.test.tsx`) e o HTML de servidor
 * (`documentToHtmlFragment`, `@sofereditor/export-pdf`).
 *
 * `parity.test.tsx` cobre marcas inline via `renderToStaticMarkup`, que não
 * exercita `TableView` (precisa de `EditorProvider`/`useEditor` de verdade —
 * ver comentário em `cellStyle.test.ts`). Este arquivo existe pra fechar
 * exatamente essa lacuna: sem ele, "os dois emitem a MESMA proporção" seria
 * verificado só por leitura de código (os dois chamam `normalizarLarguras`),
 * não por evidência de execução.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { documentToHtmlFragment } from "@sofereditor/export-pdf";
import { Editor } from "../Editor";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa `ResizeObserver` (usado por `TableResizeOverlay` pra
// remedir os handles quando a tabela muda de tamanho). Local a este arquivo,
// mesmo padrão do polyfill de `HTMLDialogElement` em
// `Editor.formulaEdit.test.tsx` — não mexe em código de produção.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function tableDoc(colWidths: number[], tableWidth?: number): SerializedDocument {
  const cols = colWidths.length;
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: {
          rows: 1,
          cols,
          colWidths,
          ...(tableWidth != null ? { tableWidth } : {}),
        },
        cells: Array.from({ length: cols }, () => ({ text: "", delta: [], attrs: {} })),
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

function mountEditorDom(doc: SerializedDocument): HTMLElement {
  const editorDoc = EditorDocument.fromJSON(doc);
  function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
    const editor = useEditor({ document: editorDoc });
    apiRef.current = editor;
    return createElement(Editor, { editor, pageGeometry: null });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  return container;
}

describe("paridade real de DOM: colgroup e largura da tabela", () => {
  it("o <colgroup> montado pelo editor tem a MESMA proporção que o HTML de servidor", () => {
    const doc = tableDoc([23.392, 29.825, 23.392, 23.392]);
    const dom = mountEditorDom(doc);
    const table = dom.querySelector("table.ed-table");
    if (!table) throw new Error("tabela não montou");
    const editorWidths = [...table.querySelectorAll("colgroup > col")].map(
      (c) => (c as HTMLElement).style.width,
    );
    const server = documentToHtmlFragment(doc);
    const serverWidths = [...server.matchAll(/<col style="width:([^"]+)">/g)].map((m) => m[1]);
    // Real evidência de execução, não dedução: os dois vieram de renderizações
    // independentes (DOM montado de verdade vs. string de servidor) do MESMO
    // documento — se divergissem, um teria "px" ou um número diferente do outro.
    expect(editorWidths).toEqual(["23.392%", "29.825%", "23.392%", "23.392%"]);
    expect(serverWidths).toEqual(["23.392%", "29.825%", "23.392%", "23.392%"]);
  });

  it("o <table> montado pelo editor tem a MESMA largura inline que o HTML de servidor", () => {
    const doc = tableDoc([25, 25, 25, 25], 80);
    const dom = mountEditorDom(doc);
    const table = dom.querySelector("table.ed-table") as HTMLTableElement | null;
    if (!table) throw new Error("tabela não montou");
    expect(table.style.width).toBe("80%");
    const server = documentToHtmlFragment(doc);
    expect(server).toMatch(/<table[^>]*style="width:80%"/);
  });

  it("sem tableWidth, nem o editor nem o servidor emitem width no <table>", () => {
    const doc = tableDoc([25, 25, 25, 25]);
    const dom = mountEditorDom(doc);
    const table = dom.querySelector("table.ed-table") as HTMLTableElement | null;
    if (!table) throw new Error("tabela não montou");
    expect(table.style.width).toBe("");
    const server = documentToHtmlFragment(doc);
    expect(server).not.toMatch(/<table[^>]*style="[^"]*width/);
  });
});
