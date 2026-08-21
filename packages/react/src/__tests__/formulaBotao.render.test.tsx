// @vitest-environment jsdom
/**
 * Task 4, Step 4/5: o botão da paleta passou de texto (`{p.label}`) para
 * markup do KaTeX via `dangerouslySetInnerHTML`. `formulaBotao.test.ts`
 * garante que a PALETA tem nome acessível para todo item — mas não toca no
 * componente, então não prova que o `aria-label` chega de fato ao DOM. Sem
 * este teste, um refactor que apagasse o `aria-label={p.titulo ?? p.label}`
 * do JSX passaria despercebido: os 82 testes de dado continuariam verdes.
 *
 * Mesmo harness (`EditorProvider` + `useEditor`) e mesmo polyfill de
 * `HTMLDialogElement` de `FormulaDialog.abas.test.tsx`.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorProvider } from "../EditorContext";
import { useEditor, type UseEditorResult } from "../useEditor";
import { PALETA } from "../formulaSnippet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function Host({
  editorRef,
}: {
  editorRef: MutableRefObject<UseEditorResult | null>;
}) {
  const editor = useEditor();
  editorRef.current = editor;
  return createElement(EditorProvider, { editor, children: null });
}

describe("FormulaDialog — botão da paleta mantém nome acessível", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("todo botão de .ed-formula-paleta-btn na aba Estruturas tem aria-label não vazio", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const editorRef: MutableRefObject<UseEditorResult | null> = { current: null };

    await act(async () => {
      root.render(createElement(Host, { editorRef }));
    });

    act(() => {
      void editorRef.current!.requestFormula();
    });

    // Deixa o import dinâmico (Promise.all de @sofereditor/math + mathlive)
    // resolver — mesma técnica de FormulaDialog.abas.test.tsx.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const botoes = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".ed-formula-paleta-btn"),
    );
    const itensEstruturas = PALETA[0].itens;
    expect(botoes.length).toBe(itensEstruturas.length);

    botoes.forEach((btn, i) => {
      const esperado = itensEstruturas[i].titulo ?? itensEstruturas[i].label;
      expect(btn.getAttribute("aria-label")).toBe(esperado);
      expect((btn.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(0);
    });
  });
});
