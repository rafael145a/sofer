// @vitest-environment jsdom
/**
 * Fix round 1/5 da Task 5: nenhum dos três pontos de import dinâmico da
 * fórmula tratava falha de carregamento do chunk. Este teste cobre o pior
 * caso apontado na revisão — `FormulaDialog` ficando travado para sempre em
 * "Carregando o renderizador…", com o botão Inserir desabilitado e sem
 * nenhuma saída além de Cancelar, quando `import("@sofereditor/math")`
 * rejeita (caso real: `docker compose up -d --build` do portal2-next troca o
 * hash dos assets enquanto um professor está com a prova aberta).
 *
 * `@sofereditor/math` é mockado para SEMPRE rejeitar — este arquivo cobre só
 * o caminho de falha, não o caminho feliz (isso já é coberto por
 * `formulaSnippet.test.ts` e pela verificação manual no navegador).
 *
 * jsdom (29.1.1, a versão instalada aqui) não implementa
 * `HTMLDialogElement.prototype.showModal`/`.close` — só a reflexão do
 * atributo `open`. Sem o polyfill abaixo, `dialog.showModal()` dentro do
 * `useEffect` do `FormulaDialog` lança `TypeError: showModal is not a
 * function` e o teste nem chega a montar. O polyfill é local a este arquivo
 * (vitest isola globals por arquivo com `@vitest-environment`), não mexe em
 * código de produção.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@sofereditor/math", () => {
  // Simula o chunk falhando ao baixar (hash rotacionado por um deploy
  // enquanto a aba estava aberta). Fábrica que lança faz o `import(...)`
  // dinâmico (estático e dinâmico, ambos interceptados pelo mock) rejeitar.
  throw new Error("chunk indisponível (simulado)");
});

function Host({
  editorRef,
}: {
  editorRef: MutableRefObject<UseEditorResult | null>;
}) {
  const editor = useEditor();
  editorRef.current = editor;
  return createElement(EditorProvider, { editor, children: null });
}

describe("FormulaDialog — import(\"@sofereditor/math\") rejeitando (fix round 1/5)", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("sai de 'carregando', mostra a mensagem de erro e mantém Inserir desabilitado", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const editorRef: MutableRefObject<UseEditorResult | null> = { current: null };

    await act(async () => {
      root.render(createElement(Host, { editorRef }));
    });

    // Abre o modal — dispara o `useEffect` que faz `import("@sofereditor/math")`.
    act(() => {
      void editorRef.current!.requestFormula();
    });

    // Estado imediato: ainda carregando (o import rejeita num microtask, não
    // sincronamente).
    const vazio = () => container.querySelector(".ed-formula-vazio");
    expect(vazio()?.textContent).toBe("Carregando o renderizador…");

    // Deixa a promise do import rejeitar e o `.catch` do efeito rodar.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const erro = container.querySelector('[role="alert"]');
    expect(erro).not.toBeNull();
    expect(erro?.textContent).toMatch(/Recarregue a página/);
    expect(erro?.className).toBe("ed-formula-erro");

    // O "Carregando…" não fica preso pra sempre — some assim que o erro aparece.
    expect(vazio()).toBeNull();

    const inserirBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Inserir",
    ) as HTMLButtonElement | undefined;
    expect(inserirBtn).toBeDefined();
    expect(inserirBtn?.disabled).toBe(true);

    // A mensagem de erro sobrevive a digitação — não é limpa pelo efeito de
    // preview (que roda a cada mudança de `latex`/`display`), então o
    // professor não perde a explicação assim que tenta digitar algo.
    //
    // Setter nativo + evento "input", não `textarea.value = ...` direto: num
    // input controlado do React, escrever `.value` sem passar pelo setter
    // nativo do protótipo deixa o `onChange` "engolido" — mesma armadilha já
    // documentada neste projeto para não confiar em disparo de evento
    // sintético sobre valor setado direto.
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      nativeSetter.call(textarea, "x");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /Recarregue a página/,
    );
    expect(inserirBtn?.disabled).toBe(true);
  });
});
