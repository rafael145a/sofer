// @vitest-environment jsdom
/**
 * Task 7, fix round 1/5 — cobertura do caminho da toolbar, que faltava (o
 * teste anterior só cobria o duplo clique em `Editor.tsx`). Cobre a decisão
 * de qual botão renderizar (`isFormulaEmbed(selectedEmbed.embed)` em
 * `Toolbar.tsx`) e o comportamento de clique do botão "Editar fórmula".
 *
 * Monta `<Toolbar>` de verdade dentro de `<EditorProvider>` (sem precisar do
 * `<Editor>` inteiro — `Toolbar` só lê `useEditorContext()`, não toca em
 * `rootRef`/DOM do corpo do editor). Insere embeds no Y.doc via o comando
 * `insertImage` real do core (um COM `formula`, outro SEM), seleciona via
 * `editor.setSelection` e verifica o texto do botão renderizado.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { insertImage, insertParagraph, type CommandContext } from "@sofereditor/core";
import { EditorProvider } from "../EditorContext";
import { Toolbar } from "../Toolbar";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `<EditorProvider>` monta `FormulaDialog` (entre outros) de verdade; clicar
// "Editar fórmula" preenche `formulaRequest` e o `useEffect` do modal chama
// `dialog.showModal()`. Mesmo polyfill de `FormulaDialog.loadFailure.test.tsx`
// (jsdom 29.1.1 não implementa `showModal`/`close`), local a este arquivo.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

const TINY_PNG = "data:image/png;base64,AAAA";

function Host({ editorRef }: { editorRef: MutableRefObject<UseEditorResult | null> }) {
  const editor = useEditor();
  editorRef.current = editor;
  return createElement(EditorProvider, {
    editor,
    children: createElement(Toolbar, {}),
  });
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

function mount(): { api: UseEditorResult; editorRef: MutableRefObject<UseEditorResult | null> } {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const editorRef: MutableRefObject<UseEditorResult | null> = { current: null };
  act(() => {
    root!.render(createElement(Host, { editorRef }));
  });
  const api = editorRef.current;
  if (!api) throw new Error("editor não inicializou");
  return { api, editorRef };
}

function ctxOf(api: UseEditorResult): CommandContext {
  return { doc: api.doc, getSelection: api.getSelection, setSelection: api.setSelection };
}

function selectEmbedAfterInsert(api: UseEditorResult): void {
  // `insertImage` deixa a seleção colapsada logo APÓS o embed — reconstrói a
  // seleção de largura 1 sobre o embed (o que o clique real produziria).
  const after = api.getSelection();
  const embedOffset = after.focus.offset - 1;
  act(() => {
    api.setSelection({
      anchor: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset },
      focus: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset + 1 },
    });
  });
}

function buttonByText(container_: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container_.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement | undefined;
}

describe("Toolbar — botão \"Editar fórmula\" vs \"Legenda\" (fix round 1/5)", () => {
  it("nenhum embed selecionado: nem 'Editar fórmula' nem 'Legenda' aparecem", () => {
    mount();
    expect(buttonByText(container!, "Editar fórmula")).toBeUndefined();
    expect(buttonByText(container!, "Legenda")).toBeUndefined();
  });

  it("embed COM formula selecionado: mostra 'Editar fórmula', não 'Legenda'; clique abre requestFormula com latex/display salvos", () => {
    const { api, editorRef } = mount();
    const ctx = ctxOf(api);
    act(() => {
      insertImage(ctx, {
        type: "image",
        src: TINY_PNG,
        width: 10,
        height: 10,
        formula: { latex: "\\sqrt{2}", display: false },
      });
    });
    selectEmbedAfterInsert(api);

    expect(buttonByText(container!, "Legenda")).toBeUndefined();
    const editBtn = buttonByText(container!, "Editar fórmula");
    expect(editBtn).toBeDefined();

    expect(editorRef.current?.formulaRequest).toBeNull();
    act(() => {
      editBtn!.click();
    });
    expect(editorRef.current?.formulaRequest).not.toBeNull();
    expect(editorRef.current?.formulaRequest?.initialLatex).toBe("\\sqrt{2}");
    expect(editorRef.current?.formulaRequest?.initialDisplay).toBe(false);
  });

  it("embed SEM formula (imagem comum) selecionado: mostra 'Legenda', não 'Editar fórmula'", () => {
    const { api } = mount();
    const ctx = ctxOf(api);
    act(() => {
      insertParagraph(ctx);
      insertImage(ctx, { type: "image", src: TINY_PNG, width: 10, height: 10 });
    });
    selectEmbedAfterInsert(api);

    expect(buttonByText(container!, "Editar fórmula")).toBeUndefined();
    expect(buttonByText(container!, "Legenda")).toBeDefined();
  });
});
