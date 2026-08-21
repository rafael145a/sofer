// @vitest-environment jsdom
/**
 * Task 7, fix round 1/5 — o gap assíncrono dentro de `insertFormula`
 * (`useEditor.ts`) entre o snapshot de seleção e `cmdInsertImage`.
 *
 * `insertFormula` é `async` com um `await import("@sofereditor/math")` e
 * outro `await svgToPngDataUrl(...)` NO MEIO do próprio corpo — o chamador
 * (duplo clique em `Editor.tsx`, botão em `Toolbar.tsx`) só controla a
 * seleção na ENTRADA da chamada, não durante esse gap. Se a seleção do
 * modelo mudar enquanto o `await` está em voo (cenário real: o fechamento do
 * `<dialog>` do modal devolve o foco ao editor e a seleção nativa colapsa —
 * bug #6, ver `LinkRequest.selection`), `cmdInsertImage` (que lê a seleção AO
 * VIVO) erraria o alvo do `deleteRange` e a fórmula antiga sobreviveria ao
 * lado da nova.
 *
 * Este teste MOCKA `@sofereditor/math` para controlar precisamente esse gap:
 * `svgToPngDataUrl` (o segundo `await` real dentro de `insertFormula`,
 * depois do snapshot de seleção e antes de `cmdInsertImage`) devolve uma
 * promise represada (`deferred`). Enquanto `insertFormula` está pendurada
 * nela, o teste move a seleção ao vivo para outro lugar do documento
 * (simulando o colapso do bug #6) e só então resolve a promise — exatamente
 * o cenário que o fix existe para cobrir.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collapsedSelection, isFormulaEmbed } from "@sofereditor/core";
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

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Controlado pelo teste: quando definido, `svgToPngDataUrl` devolve esta
// promise represada em vez de resolver na hora — é o gancho que reproduz o
// `await` real de `insertFormula`.
let pngGate: { promise: Promise<string>; resolve: (v: string) => void } | null = null;

vi.mock("@sofereditor/math", () => ({
  renderLatexToSvg: (latex: string, display: boolean) => ({
    ok: true as const,
    svg: `<svg data-latex="${latex}"></svg>`,
    widthEx: 2,
    heightEx: 1,
    vAlignEx: display ? 0 : -0.5,
  }),
  measureExInPx: () => 8,
  svgToDataUrl: (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  svgToPngDataUrl: () => (pngGate ? pngGate.promise : Promise.resolve("data:image/png;base64,AAAA")),
}));

function Host({ editorRef }: { editorRef: MutableRefObject<UseEditorResult | null> }) {
  const editor = useEditor();
  editorRef.current = editor;
  return createElement(EditorProvider, { editor, children: null });
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
  pngGate = null;
});

function mount(): { api: UseEditorResult } {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const editorRef: MutableRefObject<UseEditorResult | null> = { current: null };
  act(() => {
    root!.render(createElement(Host, { editorRef }));
  });
  const api = editorRef.current;
  if (!api) throw new Error("editor não inicializou");
  return { api };
}

function formulaEmbeds(api: UseEditorResult): Array<{ latex: string; display: boolean }> {
  return api.doc
    .toJSON()
    .blocks.flatMap((b) =>
      b.delta
        .filter((op) => isFormulaEmbed(op.insert))
        .map((op) => {
          const embed = op.insert as { formula: { latex: string; display: boolean } };
          return { latex: embed.formula.latex, display: embed.formula.display };
        }),
    );
}

describe("insertFormula — substituição através do gap assíncrono (fix round 1/5)", () => {
  it("caminho feliz (sem colapso): editar substitui, documento fica com UMA fórmula", async () => {
    const { api } = mount();

    await act(async () => {
      await api.insertFormula("\\alpha", false);
    });
    expect(formulaEmbeds(api)).toEqual([{ latex: "\\alpha", display: false }]);

    // Seleciona o embed (o que o duplo clique / botão da toolbar fazem antes
    // de chamar `requestFormula`/`insertFormula`).
    const after = api.getSelection();
    const embedOffset = after.focus.offset - 1;
    act(() => {
      api.setSelection({
        anchor: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset },
        focus: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset + 1 },
      });
    });

    await act(async () => {
      await api.insertFormula("\\beta", true);
    });

    // UMA fórmula no documento — a nova, não duas.
    expect(formulaEmbeds(api)).toEqual([{ latex: "\\beta", display: true }]);
  });

  it("seleção colapsa DURANTE o await de insertFormula (bug #6 simulado): ainda assim UMA fórmula, a nova", async () => {
    const { api } = mount();

    // Fórmula original.
    await act(async () => {
      await api.insertFormula("\\alpha", false);
    });
    expect(formulaEmbeds(api)).toEqual([{ latex: "\\alpha", display: false }]);

    const after = api.getSelection();
    const embedOffset = after.focus.offset - 1;
    const embedSelection = {
      anchor: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset },
      focus: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset + 1 },
    };
    act(() => {
      api.setSelection(embedSelection);
    });

    // Arma o portão: `svgToPngDataUrl` (o `await` real dentro de
    // `insertFormula`, depois do snapshot de seleção) fica pendurado até o
    // teste liberar.
    pngGate = deferred<string>();

    await act(async () => {
      const pending = api.insertFormula("\\beta", true);

      // Deixa a promise mockada de `import("@sofereditor/math")` resolver e
      // a execução síncrona de `insertFormula` avançar até o `await
      // svgToPngDataUrl(...)` — onde ela fica pendurada no `pngGate`.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // AQUI está o gap: `insertFormula` já capturou `selectionAtCall` (a
      // seleção do embed, no fio de execução síncrono ANTES do primeiro
      // `await`) mas ainda não chegou em `cmdInsertImage`. Simula o bug #6 —
      // o fechamento do modal devolvendo o foco ao editor e colapsando a
      // seleção nativa — mexendo na seleção AO VIVO agora, no meio do gap.
      api.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));

      // Libera o portão — `insertFormula` retoma e chama `cmdInsertImage`.
      pngGate!.resolve("data:image/png;base64,BBBB");
      await pending;
    });

    // Mesmo com a seleção ao vivo adulterada durante o gap, o snapshot
    // capturado ANTES do `await` é o que `cmdInsertImage` usa — o embed
    // antigo foi apagado e o novo entrou no lugar dele. UMA fórmula, a nova.
    expect(formulaEmbeds(api)).toEqual([{ latex: "\\beta", display: true }]);
  });
});
