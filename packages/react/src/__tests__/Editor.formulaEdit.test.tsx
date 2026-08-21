// @vitest-environment jsdom
/**
 * Task 7 — duplo clique reabre o modal de fórmula.
 *
 * `isFormulaEmbed` é o único jeito de o duplo clique em `Editor.tsx`
 * distinguir uma fórmula (deve reabrir o modal, `editor.formulaRequest`
 * fica preenchido com o LaTeX/display guardados) de uma imagem comum (não
 * deve fazer nada). Este teste cobre só essa decisão — monta o `<Editor>` de
 * verdade (mesmo padrão de `Editor.paste.test.tsx`, sem `@testing-library`)
 * e dispara um `dblclick` real no `<img>`, sem passar por `FormulaDialog`
 * nem pelo import dinâmico de `@sofereditor/math` (nenhum dos dois entra
 * nesse caminho — só `getSelectedEmbed` + `requestFormula`).
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { insertImage, insertParagraph, type CommandContext } from "@sofereditor/core";
import { Editor } from "../Editor";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `<Editor>` monta `FormulaDialog` de verdade via `EditorProvider`. Quando o
// dblclick chama `requestFormula` e o modal reage, `useEffect` chama
// `dialog.showModal()` — jsdom (29.1.1, a versão instalada aqui) não
// implementa `HTMLDialogElement.prototype.showModal`/`.close`, só a reflexão
// do atributo `open`. Mesmo polyfill de `FormulaDialog.loadFailure.test.tsx`,
// local a este arquivo (vitest isola globals por arquivo com
// `@vitest-environment`) — não mexe em código de produção.
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

function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
  const editor = useEditor();
  apiRef.current = editor;
  return createElement(Editor, { editor, pageGeometry: null });
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

function mount(): {
  api: UseEditorResult;
  apiRef: MutableRefObject<UseEditorResult | null>;
  rootEl: HTMLElement;
} {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  const api = apiRef.current;
  if (!api) throw new Error("editor não inicializou");
  const rootEl = container.querySelector('[contenteditable="true"]');
  if (!rootEl) throw new Error("root contentEditable não encontrado");
  return { api, apiRef, rootEl: rootEl as HTMLElement };
}

function ctxOf(api: UseEditorResult): CommandContext {
  return { doc: api.doc, getSelection: api.getSelection, setSelection: api.setSelection };
}

// `snapshot` (o que o DOM renderiza) é recalculado em `useEditor` num rAF
// coalescido a partir do evento `afterTransaction` do Y.doc (ver
// `useEditor.ts`, comentário "Coalesce snapshot recomputation") — não é
// síncrono com o comando que mutou o doc. Sem este flush, o DOM ainda mostra
// o snapshot anterior (bloco vazio) quando o teste tenta achar o `<img>`.
async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function fireDoubleClick(target: Element): void {
  const ev = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(ev);
  });
}

describe("Editor — duplo clique numa fórmula reabre o modal (Task 7)", () => {
  it("embed COM formula: dblclick abre requestFormula com o latex/display guardados", async () => {
    const { api, apiRef, rootEl } = mount();
    const ctx = ctxOf(api);

    act(() => {
      insertImage(ctx, {
        type: "image",
        src: TINY_PNG,
        width: 10,
        height: 10,
        formula: { latex: "\\frac{1}{2}", display: true },
      });
    });
    await flushAsync();

    // `insertImage` deixa a seleção colapsada logo APÓS o embed — usamos essa
    // posição pra reconstruir a seleção de largura 1 que o clique real teria
    // produzido (mesma coisa que o pointerdown de seleção de embed faz).
    const after = api.getSelection();
    const embedOffset = after.focus.offset - 1;
    act(() => {
      api.setSelection({
        anchor: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset },
        focus: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset + 1 },
      });
    });

    const img = rootEl.querySelector('img[data-embed="image"]');
    expect(img).not.toBeNull();

    expect(apiRef.current?.formulaRequest).toBeNull();
    fireDoubleClick(img!);

    expect(apiRef.current?.formulaRequest).not.toBeNull();
    expect(apiRef.current?.formulaRequest?.initialLatex).toBe("\\frac{1}{2}");
    expect(apiRef.current?.formulaRequest?.initialDisplay).toBe(true);
  });

  it("embed SEM formula (imagem comum): dblclick não abre o modal de fórmula", async () => {
    const { api, apiRef, rootEl } = mount();
    const ctx = ctxOf(api);

    act(() => {
      insertParagraph(ctx); // garante que o embed não fica no bloco 0 vazio-só-embed por acidente
      insertImage(ctx, { type: "image", src: TINY_PNG, width: 10, height: 10 });
    });
    await flushAsync();

    const after = api.getSelection();
    const embedOffset = after.focus.offset - 1;
    act(() => {
      api.setSelection({
        anchor: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset },
        focus: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset + 1 },
      });
    });

    const img = rootEl.querySelector('img[data-embed="image"]');
    expect(img).not.toBeNull();

    fireDoubleClick(img!);

    // Nenhuma fórmula guardada no embed — `isFormulaEmbed` barra e o modal
    // nunca é solicitado.
    expect(apiRef.current?.formulaRequest).toBeNull();
  });
});
