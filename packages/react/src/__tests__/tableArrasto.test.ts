// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { deltaPctDoArrasto } from "../TableResizeOverlay";
import { Editor } from "../Editor";
import { useEditor, type UseEditorResult } from "../useEditor";

describe("arrasto em px vira delta em pontos percentuais", () => {
  it("60px numa tabela de 600px são 10 pontos", () => {
    expect(deltaPctDoArrasto(60, 600)).toBeCloseTo(10, 6);
  });
  it("o sinal acompanha a direção", () => {
    expect(deltaPctDoArrasto(-30, 600)).toBeCloseTo(-5, 6);
  });
  it("tabela de largura zero não divide por zero", () => {
    expect(deltaPctDoArrasto(60, 0)).toBe(0);
  });
});

/**
 * A conversão pura acima não é o que produzia o defeito — era o overlay
 * acumular contra o modelo/DOM CORRENTE em vez do estado do `pointerdown`.
 * `deltaPctDoArrasto` sozinha não distingue "delta relativo ao pointerdown"
 * de "delta relativo ao último pointermove": as duas leituras produzem
 * exatamente o mesmo valor de delta quando o dx é o mesmo. A distinção só
 * aparece observando o EFEITO no modelo ao longo de múltiplos pointermove —
 * por isso este bloco monta o `<Editor>` de verdade e dispara pointer events
 * nativos na alça, em vez de só testar a função pura.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa `ResizeObserver` (usado por `TableResizeOverlay` pra
// remedir os handles) nem `Element#setPointerCapture`/`releasePointerCapture`
// (chamados sem guarda em `onPointerDown`/`onPointerUp`). Polyfills locais a
// este arquivo, mesmo padrão do polyfill de `HTMLDialogElement` em
// `Editor.formulaEdit.test.tsx` — não mexem em código de produção.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
if (typeof (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture !== "function") {
  (Element.prototype as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  (Element.prototype as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture =
    () => {};
}

// Tabela de 600px "renderizada": todo elemento devolve a mesma largura fixa.
// Isso deixa a posição visual dos handles incorreta (cosmético, não
// verificado aqui) mas dá ao `onPointerDown` o `tableWidthPx`/`containerWidthPx`
// determinístico que o teste precisa — sem isto, o retângulo zerado padrão do
// jsdom cairia no fallback `|| 1` e o `deltaPct` estouraria o piso da coluna,
// mascarando a diferença entre base congelada e base recalculada.
const rectoFixo = {
  width: 600,
  height: 100,
  top: 0,
  left: 0,
  right: 600,
  bottom: 100,
  x: 0,
  y: 0,
  toJSON() {
    return this;
  },
} as DOMRect;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

function tableDoc(colWidths: number[]): SerializedDocument {
  const cols = colWidths.length;
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols, colWidths },
        cells: Array.from({ length: cols }, () => ({ text: "", delta: [], attrs: {} })),
      },
    ],
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mountEditorDom(doc: SerializedDocument): { dom: HTMLElement; api: UseEditorResult } {
  const editorDoc = EditorDocument.fromJSON(doc);
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
    const editor = useEditor({ document: editorDoc });
    apiRef.current = editor;
    return createElement(Editor, { editor, pageGeometry: null });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return rectoFixo;
  };
  if (!apiRef.current) throw new Error("useEditor não inicializou");
  return { dom: container, api: apiRef.current };
}

function pointerEvent(type: string, init: PointerEventInit): Event {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
}

describe("o overlay congela o delta contra o modelo do pointerdown, não contra o corrente", () => {
  it("dois pointermove para o MESMO X produzem o MESMO resultado (idempotente)", async () => {
    const { dom } = mountEditorDom(tableDoc([25, 25, 25, 25]));
    const handle = dom.querySelector('[aria-label="Redimensionar coluna 1"]');
    if (!handle) throw new Error("alça da coluna 1 não encontrada");

    // `useEditor` agenda o recompute do snapshot exibido em `requestAnimationFrame`
    // (coalescing — ver comentário em `useEditor.ts`), então cada passo precisa
    // ceder um tick pra o React re-renderizar o `<colgroup>` com o modelo novo
    // antes de ler o DOM. Mesmo padrão de `await act(async () => { await new
    // Promise((r) => setTimeout(r, 10)); })` usado em `Editor.paste.test.tsx`.
    const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 100 }));
    });
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 106 }));
    });
    await tick();
    const apos1o = dom.querySelector("table.ed-table");
    const colsApos1o = [...(apos1o?.querySelectorAll("colgroup > col") ?? [])].map(
      (c) => (c as HTMLElement).style.width,
    );

    // Segundo pointermove para o MESMO clientX — dx é idêntico ao do
    // primeiro. Se o overlay reancorasse no modelo corrente (o defeito desta
    // tarefa), o segundo move ainda somaria +1 ponto em cima do resultado do
    // primeiro, e as duas colunas divergiriam do primeiro snapshot.
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 106 }));
    });
    await tick();
    const apos2o = dom.querySelector("table.ed-table");
    const colsApos2o = [...(apos2o?.querySelectorAll("colgroup > col") ?? [])].map(
      (c) => (c as HTMLElement).style.width,
    );

    expect(colsApos1o).toEqual(["26%", "24%", "25%", "25%"]);
    expect(colsApos2o).toEqual(colsApos1o);
  });
});
