// @vitest-environment jsdom
/**
 * Fix round 1/5 do Task 2: O reset da aba ao reabrir o modal não tinha guarda
 * de regressão. Se alguém mover o `setAbaAtiva(0)` para um `useEffect` com `[]`,
 * pareceria inicialização, mas como o `FormulaDialog` nunca desmonta (fica
 * montado, controlado por `if (!formulaRequest) return null`), o reset passaria
 * a rodar só na montagem, e a aba ficaria onde o professor deixou.
 *
 * Este teste valida o ciclo completo: abre, muda de aba, fecha, reabre, confirma
 * que voltou para Estruturas (índice 0).
 *
 * jsdom (29.1.1) não implementa `HTMLDialogElement.prototype.showModal`/`.close`
 * — mesmo polyfill de `FormulaDialog.loadFailure.test.tsx` e `Toolbar.formulaButton.test.tsx`.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorProvider } from "../EditorContext";
import { useEditor, type UseEditorResult } from "../useEditor";

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

describe("FormulaDialog — ciclo de abas (fix round 1/5 do Task 2)", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("abre em Estruturas, muda de aba, fecha, reabre em Estruturas novamente", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const editorRef: MutableRefObject<UseEditorResult | null> = { current: null };

    await act(async () => {
      root.render(createElement(Host, { editorRef }));
    });

    // ─── Passo 1: Abre o modal
    act(() => {
      void editorRef.current!.requestFormula();
    });

    // Deixa o import dinâmico carregar.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // ─── Passo 2: Confirma que a aba ativa é Estruturas (índice 0)
    const abasButtons = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(abasButtons.length).toBeGreaterThan(0);

    const abaEstruturasAntes = abasButtons[0] as HTMLButtonElement;
    expect(abaEstruturasAntes.getAttribute("aria-selected")).toBe("true");
    expect(abaEstruturasAntes.textContent).toBe("Estruturas");

    const abaSímbolosAntes = abasButtons[1] as HTMLButtonElement;
    expect(abaSímbolosAntes.getAttribute("aria-selected")).toBe("false");
    expect(abaSímbolosAntes.textContent).toBe("Símbolos");

    // ─── Passo 3: Clica na aba Símbolos (índice 1)
    act(() => {
      abaSímbolosAntes.click();
    });

    // ─── Passo 4: Confirma que Símbolos virou a ativa
    expect(abaEstruturasAntes.getAttribute("aria-selected")).toBe("false");
    expect(abaSímbolosAntes.getAttribute("aria-selected")).toBe("true");

    // ─── Passo 5: Fecha o modal
    act(() => {
      editorRef.current!.resolveFormulaRequest(null);
    });

    // Deixa o close do dialog disparar.
    await act(async () => {
      await Promise.resolve();
    });

    // ─── Passo 6: Reabre o modal
    act(() => {
      void editorRef.current!.requestFormula();
    });

    // Deixa o import dinâmico carregar novamente.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // ─── Passo 7: CONFIRMA QUE VOLTOU PARA ESTRUTURAS
    const abasButtonsAposReabrir = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(abasButtonsAposReabrir.length).toBeGreaterThan(0);

    const abaEstruturasDepois = abasButtonsAposReabrir[0] as HTMLButtonElement;
    expect(abaEstruturasDepois.getAttribute("aria-selected")).toBe("true");
    expect(abaEstruturasDepois.textContent).toBe("Estruturas");

    const abaSímbolosDepois = abasButtonsAposReabrir[1] as HTMLButtonElement;
    expect(abaSímbolosDepois.getAttribute("aria-selected")).toBe("false");
    expect(abaSímbolosDepois.textContent).toBe("Símbolos");
  });
});
