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
import { collapsedSelection, isFormulaEmbed, isImageEmbed, type ImageEmbed } from "@sofereditor/core";
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
    // "wide" é um gancho de teste (Item 2 — clamp escala o vAlign): dispara
    // widthEx grande o bastante para estourar MAX_INSERT_WIDTH (600px em
    // packages/react/src/imageConstraints.ts) com exPx=8, sem afetar as
    // fórmulas normais (\alpha, \beta, …) usadas no resto do arquivo.
    widthEx: latex.includes("wide") ? 100 : 2,
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

/** Primeiro embed de imagem (fórmula ou não) no documento, com os campos crus. */
function firstImageEmbed(api: UseEditorResult): ImageEmbed | undefined {
  for (const b of api.doc.toJSON().blocks) {
    for (const op of b.delta) {
      if (isImageEmbed(op.insert)) return op.insert;
    }
  }
  return undefined;
}

/** Seleciona o embed no offset logo antes de `focus` (mesmo padrão dos testes acima). */
function selectEmbedBeforeFocus(api: UseEditorResult) {
  const after = api.getSelection();
  const embedOffset = after.focus.offset - 1;
  act(() => {
    api.setSelection({
      anchor: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset },
      focus: { blockIndex: after.focus.blockIndex, cellIndex: after.focus.cellIndex, offset: embedOffset + 1 },
    });
  });
}

describe("insertFormula — herda layout/posição na EDIÇÃO, nunca na inserção nova (final-fix Item 1)", () => {
  it("editar uma fórmula em wrap-left preserva o wrap-left (regressão: editar não pode devolver a fórmula para inline/origem)", async () => {
    const { api } = mount();

    await act(async () => {
      await api.insertFormula("\\alpha", false);
    });
    selectEmbedBeforeFocus(api);
    const embedOffset = api.getSelection().anchor.offset;

    // Professor arrasta a fórmula para wrap-left, com um offset específico —
    // o mesmo `setImageAttrs` que o resize/drag do embed usa de verdade.
    act(() => {
      api.setImageAttrs(0, embedOffset, { layout: "wrap-left", offsetX: 12, offsetY: 7 });
    });
    const afterLayout = firstImageEmbed(api);
    expect(afterLayout?.layout).toBe("wrap-left");

    // A seleção do embed sobrevive ao `setImageAttrs` (mesmo offset, sem
    // `newOffset`) — reseleciona por segurança antes de editar, como o
    // duplo clique real faz via `getSelectedEmbed()`.
    selectEmbedBeforeFocus(api);

    await act(async () => {
      await api.insertFormula("\\beta", false);
    });

    const afterEdit = firstImageEmbed(api);
    expect(afterEdit && isFormulaEmbed(afterEdit) ? afterEdit.formula.latex : undefined).toBe(
      "\\beta",
    );
    // O ponto central do Item 1: layout/offset sobrevivem à edição do LaTeX.
    expect(afterEdit?.layout).toBe("wrap-left");
    expect(afterEdit?.offsetX).toBe(12);
    expect(afterEdit?.offsetY).toBe(7);
  });

  it("wrap-left sobrevive mesmo quando a seleção colapsa DURANTE o gap assíncrono (pin: getSelectedEmbed() tem que rodar ANTES do primeiro await, não depois)", async () => {
    // Este teste existe para o requisito mais específico do Item 1: não
    // basta o merge existir, `embedAtCall = getSelectedEmbed()` tem que ser
    // lido no MESMO instante síncrono que `selectionAtCall` — antes do
    // `await import("@sofereditor/math")`. Se a leitura acontecesse depois
    // do gap (ex.: logo antes de `cmdInsertImage`), o teste
    // "editar preserva wrap-left" acima passaria do mesmo jeito, porque lá
    // nada perturba a seleção durante o `await`. Aqui, igual ao teste de bug
    // #6 no topo do arquivo, a seleção É perturbada no meio do gap
    // (`pngGate`) — só um `embedAtCall` capturado cedo sobrevive a isso.
    const { api } = mount();

    await act(async () => {
      await api.insertFormula("\\alpha", false);
    });
    selectEmbedBeforeFocus(api);
    const embedOffset = api.getSelection().anchor.offset;
    act(() => {
      api.setImageAttrs(0, embedOffset, { layout: "wrap-left", offsetX: 12, offsetY: 7 });
    });
    selectEmbedBeforeFocus(api);
    const embedSelection = api.getSelection();

    pngGate = deferred<string>();

    await act(async () => {
      const pending = api.insertFormula("\\beta", false);

      // Deixa `insertFormula` avançar de forma síncrona até o `await
      // svgToPngDataUrl(...)` — mesma técnica do teste de bug #6 acima.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Colapsa a seleção AO VIVO no meio do gap. Se `embedAtCall` fosse lido
      // aqui (ou depois), `getSelectedEmbed()` devolveria null — nada para
      // herdar. O fix lê ANTES do gap, então isto não deveria mudar nada.
      api.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));

      pngGate!.resolve("data:image/png;base64,BBBB");
      await pending;
    });

    // Sanidade: a seleção usada por `cmdInsertImage` foi a original (mesmo
    // efeito do teste de bug #6) — a fórmula editada substituiu a antiga, na
    // MESMA posição, não na posição colapsada (block 0, offset 0) que o
    // teste forjou durante o gap.
    expect(embedSelection.anchor.blockIndex).toBe(api.getSelection().focus.blockIndex);

    const afterEdit = firstImageEmbed(api);
    expect(afterEdit && isFormulaEmbed(afterEdit) ? afterEdit.formula.latex : undefined).toBe(
      "\\beta",
    );
    expect(afterEdit?.layout).toBe("wrap-left");
    expect(afterEdit?.offsetX).toBe(12);
    expect(afterEdit?.offsetY).toBe(7);
  });

  it("inserir uma fórmula NOVA com uma imagem comum em wrap-left selecionada NÃO herda o layout dela", async () => {
    const { api } = mount();

    act(() => {
      api.insertImage({
        type: "image",
        src: "data:image/png;base64,AAAA",
        width: 40,
        height: 20,
        layout: "wrap-left",
        offsetX: 99,
        offsetY: 88,
      });
    });
    const commonImage = firstImageEmbed(api);
    expect(commonImage?.layout).toBe("wrap-left");
    expect(isFormulaEmbed(commonImage)).toBe(false);

    // Seleciona a imagem comum, exatamente como o botão "Inserir fórmula" da
    // toolbar encontraria a seleção se o professor tivesse clicado nela antes.
    selectEmbedBeforeFocus(api);

    await act(async () => {
      await api.insertFormula("\\gamma", false);
    });

    const embeds = api.doc
      .toJSON()
      .blocks.flatMap((b) => b.delta.filter((op) => isImageEmbed(op.insert)).map((op) => op.insert as ImageEmbed));
    // A imagem comum foi substituída (a seleção sobre ela era um range de 1
    // char; `cmdInsertImage`/`insertImage` em `commands.ts` apaga a seleção
    // não-colapsada antes de inserir — o mesmo comportamento de digitar por
    // cima de um texto selecionado). Isso é esperado e não é o que este teste
    // verifica: o ponto é que a fórmula nova NÃO carrega o `layout` da imagem
    // que ali estava.
    const formulaEmbed = embeds.find((e) => isFormulaEmbed(e));
    expect(formulaEmbed).toBeDefined();
    expect(formulaEmbed?.layout).toBeUndefined();
    expect(formulaEmbed?.offsetX).toBeUndefined();
    expect(formulaEmbed?.offsetY).toBeUndefined();
  });

  it("clampa a largura de uma fórmula inline muito larga e escala o vAlign pelo MESMO fator (Item 2)", async () => {
    const { api } = mount();

    // "wide" dispara widthEx: 100 no mock (ver vi.mock acima) — com
    // exPx=8 (fallback quando `.ed-root` não existe no DOM do teste) dá
    // w = 800px, acima de MAX_INSERT_WIDTH (600px). Fator de clamp: 600/800
    // = 0.75. vAlignEx do mock para display=false é -0.5, então o vAlign
    // esperado é -0.5 * 0.75 = -0.375.
    await act(async () => {
      await api.insertFormula("\\text{wide}", false);
    });

    const embed = firstImageEmbed(api);
    expect(embed?.width).toBe(600);
    expect(isFormulaEmbed(embed) ? embed.formula.vAlign : undefined).toBe("-0.375ex");
  });
});
