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

function tableDocRows(rows: number, cols: number): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows, cols },
        cells: Array.from({ length: rows * cols }, () => ({ text: "", delta: [], attrs: {} })),
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

// `useEditor` agenda o recompute do snapshot exibido em `requestAnimationFrame`
// (coalescing — ver comentário em `useEditor.ts`), então cada passo precisa
// ceder um tick pra o React re-renderizar o DOM com o modelo novo antes de
// ler o DOM. Mesmo padrão de `await act(async () => { await new
// Promise((r) => setTimeout(r, 10)); })` usado em `Editor.paste.test.tsx`.
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

describe("o overlay congela o delta contra o modelo do pointerdown, não contra o corrente", () => {
  it("dois pointermove para o MESMO X produzem o MESMO resultado (idempotente)", async () => {
    const { dom } = mountEditorDom(tableDoc([25, 25, 25, 25]));
    const handle = dom.querySelector('[aria-label="Redimensionar coluna 1"]');
    if (!handle) throw new Error("alça da coluna 1 não encontrada");

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

/**
 * Task 5 — as alças novas (linha, altura total, canto). Com `rectoFixo`
 * (todo elemento devolve 600×100 fixo), cada `<tr>` mede 100px, então uma
 * tabela de N linhas tem `bottoms = [100, 200, ..., 100*N]` — determinístico
 * o bastante pra travar a FIAÇÃO (qual alça chama qual comando do editor),
 * sem depender de layout real.
 */
describe("alça de linha — arrasta a divisa entre duas linhas", () => {
  it("move só a linha cuja divisa foi arrastada, colado no dedo", async () => {
    const { dom } = mountEditorDom(tableDocRows(3, 1));
    const handle = dom.querySelector('[aria-label="Redimensionar linha 1"]');
    if (!handle) throw new Error("alça da linha 1 não encontrada");

    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientY: 100 }));
    });
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientY: 125 }));
    });
    await tick();

    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    expect(trs).toHaveLength(3);
    // baseHeightPx (medido) = 100; dy = +25 → 125. `setRowHeight` inicializa
    // o array inteiro na primeira gravação (uma tabela sem `rowHeights`
    // ganha o piso MIN_LINHA_PX=16 em toda linha que não foi tocada) — só a
    // linha 0 recebe o valor arrastado, as outras duas ganham o piso.
    expect(trs[0]!.style.height).toBe("125px");
    expect(trs[1]!.style.height).toBe("16px");
    expect(trs[2]!.style.height).toBe("16px");

    // Idempotência: um segundo pointermove para o MESMO clientY não pode
    // somar mais 25 em cima do resultado anterior (mesmo defeito que a
    // coluna já cobre acima, agora do lado vertical).
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientY: 125 }));
    });
    await tick();
    expect(trs[0]!.style.height).toBe("125px");
  });
});

describe("alça de altura total — arrasta a base da tabela", () => {
  it("distribui o delta igualmente entre TODAS as linhas numa transação só", async () => {
    const { dom } = mountEditorDom(tableDocRows(3, 1));
    const handle = dom.querySelector('[aria-label="Altura da tabela"]');
    if (!handle) throw new Error("alça de altura total não encontrada");

    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientY: 300 }));
    });
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientY: 330 }));
    });
    await tick();

    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    // baseHeights medidas = [100, 100, 100]; dy = +30 → fatia +10 cada.
    expect(trs.map((tr) => tr.style.height)).toEqual(["110px", "110px", "110px"]);
  });
});

describe("alça de canto — arrasta largura e altura ao mesmo tempo", () => {
  it("um único pointermove aciona setTableWidth E setRowHeights", async () => {
    const { dom } = mountEditorDom(tableDocRows(2, 2));
    const handle = dom.querySelector('[aria-label="Redimensionar tabela"]');
    if (!handle) throw new Error("alça de canto não encontrada");

    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 600, clientY: 200 }));
    });
    await act(async () => {
      // Encolhe a largura (dx negativo evita o teto de 100% em setTableWidth)
      // e cresce a altura (dy positivo), no MESMO pointermove.
      handle.dispatchEvent(pointerEvent("pointermove", { clientX: 540, clientY: 230 }));
    });
    await tick();

    const table = dom.querySelector("table.ed-table") as HTMLTableElement | null;
    // dx=-60 numa referência de 600px → -10 pontos → 100 - 10 = 90%.
    expect(table?.style.width).toBe("90%");

    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    // baseHeights medidas = [100, 100]; dy=+30 → fatia +15 cada.
    expect(trs.map((tr) => tr.style.height)).toEqual(["115px", "115px"]);
  });
});

describe("reancoragem no pointerup — altura de linha é MÍNIMO, não fixo", () => {
  it("encolher abaixo do que o conteúdo exige grava o valor mas a alça reancora na borda real", async () => {
    const { dom } = mountEditorDom(tableDocRows(2, 1));

    // Simula uma linha cujo CONTEÚDO força uma altura mínima de 80px, não
    // importa o que o modelo grave em `rowHeights` — exatamente o cenário
    // descrito no brief da Task 5: altura é piso, não valor fixo, e o
    // `<tr>` real (fora do jsdom) renderizaria pelo maior dos dois.
    const trs = [...dom.querySelectorAll("tr[data-cell-row]")] as HTMLTableRowElement[];
    trs[0]!.dataset.contentMin = "80";
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      if (this.tagName === "TR") {
        const el = this as HTMLElement;
        const styleH = el.style.height ? parseFloat(el.style.height) : 0;
        const contentMin = Number(el.dataset.contentMin ?? 0);
        const h = Math.max(styleH, contentMin);
        return { width: 600, height: h, top: 0, left: 0, right: 600, bottom: h, x: 0, y: 0, toJSON() { return this; } } as DOMRect;
      }
      return rectoFixo;
    };

    const handle = dom.querySelector('[aria-label="Redimensionar linha 1"]');
    if (!handle) throw new Error("alça da linha 1 não encontrada");

    // baseHeightPx medido no pointerdown = max(0, 80) = 80 (o conteúdo, não
    // o piso de `setRowHeight`).
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerdown", { clientY: 80 }));
    });
    // Arrasta bem pra cima do que o conteúdo permite: dy = -300.
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointermove", { clientY: -220 }));
    });
    await tick();

    // O MODELO gravou o valor pedido, no piso de `setRowHeight` (16) — o
    // arrasto "funcionou" do ponto de vista do comando.
    expect(trs[0]!.style.height).toBe("16px");
    // Mas o DESENHO (mockado como conteúdo-mínimo de 80) não mudou: o
    // `<tr>` real continuaria a 80px porque altura é piso, não fixo.

    // No pointerup, `measure()` roda de novo e a alça reancora na borda
    // REAL (80px), não em onde o dedo largou. Sem essa reancoragem a alça
    // ficaria calculando a partir de baseHeightPx=80 + dy=-300 = -220,
    // um top negativo bem longe da borda de verdade.
    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerup", { clientY: -220 }));
    });
    await tick();

    const handleAfter = dom.querySelector('[aria-label="Redimensionar linha 1"]') as HTMLElement | null;
    if (!handleAfter) throw new Error("alça sumiu após o pointerup");
    // bottoms[0] real pós-medição = 80 → top = 80 - 3 = 77px.
    expect(handleAfter.style.top).toBe("77px");
  });
});
