// @vitest-environment jsdom
/**
 * Reprodução do bug real: cursor logo depois de uma imagem, Backspace não
 * apagava nada. Causa raiz (instrumentada no navegador, não reinvestigada
 * aqui): o `<figure>` do embed é `contenteditable=false`; quando a seleção
 * do DOM pousa nele — o que acontece depois de inserir ou clicar numa
 * imagem — o navegador nunca dispara `beforeinput`, e `Editor.tsx` só
 * tratava apagar por `beforeinput`. Corrigido tratando Backspace/Delete
 * também em `onKeyDown`, guardado por `getSelectedEmbed`/
 * `isEmbedAdjacentToCaret` (modelo, não DOM — ver o comentário em
 * `isEmbedAdjacentToCaret`, em `@sofereditor/core`).
 *
 * Este teste monta o `<Editor>` de verdade (sem `@testing-library`, que não
 * é dependência deste pacote) e dispara um `KeyboardEvent` real, pra cobrir
 * a fiação em `onKeyDown` — não só o predicado puro (que tem cobertura
 * própria em `packages/core/src/__tests__/deleteEmbed.test.ts`).
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { collapsedSelection, isImageEmbed, type ImageEmbed } from "@sofereditor/core";
import { Editor } from "../Editor";
import { useEditor, type UseEditorResult } from "../useEditor";

// `act` requer esta flag; sem ela os efeitos avisam que o ambiente "não está
// configurado" — não falha o teste, mas o aviso é ruído e mascara warnings
// de verdade.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE: ImageEmbed = { type: "image", src: "data:image/png;base64,AAA", width: 10, height: 10 };

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

function mount(): { api: UseEditorResult; rootEl: HTMLElement } {
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
  return { api, rootEl: rootEl as HTMLElement };
}

function fireBackspace(target: HTMLElement): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function hasEmbed(api: UseEditorResult): boolean {
  // Lê direto do Y.Doc, não de `api.snapshot`: o snapshot React é
  // recomputado num rAF coalescido (ver o comentário em `useEditor.ts`), que
  // não roda sincronamente dentro de `act()` neste teste.
  return api.doc.toJSON().blocks.some((b) => b.delta.some((op) => isImageEmbed(op.insert)));
}

describe("Editor onKeyDown — Backspace/Delete apagam a imagem selecionada", () => {
  it("caret colapsado logo DEPOIS da imagem: Backspace apaga o embed e preventDefault é chamado", () => {
    const { api, rootEl } = mount();
    act(() => {
      api.insertImage(SAMPLE);
    });
    expect(hasEmbed(api)).toBe(true);
    // insertImage já deixa o caret logo depois do embed (offset 1).
    expect(api.getSelection().focus.offset).toBe(1);

    const ev = fireBackspace(rootEl);
    expect(ev.defaultPrevented).toBe(true);
    expect(hasEmbed(api)).toBe(false);
  });

  it("embed SELECIONADO (range de 1 char, como depois de clicar na imagem): Backspace apaga", () => {
    const { api, rootEl } = mount();
    act(() => {
      api.insertImage(SAMPLE);
      api.setSelection({
        anchor: { blockIndex: 0, offset: 0 },
        focus: { blockIndex: 0, offset: 1 },
      });
    });
    expect(api.getSelectedEmbed()).not.toBeNull();

    const ev = fireBackspace(rootEl);
    expect(ev.defaultPrevented).toBe(true);
    expect(hasEmbed(api)).toBe(false);
  });

  it("caso normal — caret em texto, sem embed adjacente: onKeyDown NÃO intercepta (defaultPrevented continua false)", () => {
    const { api, rootEl } = mount();
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    });
    // Documento vazio — sem texto e sem embed, caso normal do dia a dia.
    const ev = fireBackspace(rootEl);
    // onKeyDown deixa o beforeinput cuidar disso (que não dispara sozinho
    // aqui porque jsdom não simula digitação real de contenteditable) — o
    // que importa é que ESTE handler não chamou preventDefault.
    expect(ev.defaultPrevented).toBe(false);
  });

  // B3: caret logo depois de uma imagem, acento morto (`´`) dispara
  // `compositionstart` (layout ABC-Extended) e o professor aperta Backspace
  // pra corrigir a composição. Sem a guarda, o predicado decide pelo MODELO
  // (que ainda não recebeu o texto em composição), enxerga o embed adjacente
  // e apaga a imagem em vez de deixar o IME continuar.
  it("composição ativa: Backspace com embed adjacente NÃO intercepta (não apaga a imagem, não trava o IME)", () => {
    const { api, rootEl } = mount();
    act(() => {
      api.insertImage(SAMPLE);
    });
    expect(hasEmbed(api)).toBe(true);
    expect(api.getSelection().focus.offset).toBe(1);

    act(() => {
      rootEl.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });

    const ev = fireBackspace(rootEl);
    expect(ev.defaultPrevented).toBe(false);
    expect(hasEmbed(api)).toBe(true);
  });
});
