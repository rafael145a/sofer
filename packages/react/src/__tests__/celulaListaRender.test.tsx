// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { EditorProvider } from "../EditorContext";
import { NodeView } from "../NodeView";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

let container: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

const IMG_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageOp(embed: Partial<Record<string, unknown>> = {}): { insert: unknown } {
  return { insert: { type: "image", src: IMG_SRC, width: 40, height: 30, ...embed } };
}

function celulaDoc(attrs: Record<string, unknown>): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 1 },
        cells: [{ text: "um\ndois", delta: [{ insert: "um\ndois" }], attrs }],
      },
    ],
  } as SerializedDocument;
}

function celulaDocComDelta(
  attrs: Record<string, unknown>,
  delta: unknown[],
): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 1 },
        cells: [{ text: "", delta, attrs }],
      },
    ],
  } as SerializedDocument;
}

function montarDoc(editorDoc: EditorDocument): HTMLElement {
  function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
    const editor = useEditor({ document: editorDoc });
    apiRef.current = editor;
    return (
      <EditorProvider editor={editor}>
        <NodeView block={editor.snapshot.blocks[0]!} index={0} />
      </EditorProvider>
    );
  }
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  return container;
}

function montar(attrs: Record<string, unknown>): HTMLElement {
  return montarDoc(EditorDocument.fromJSON(celulaDoc(attrs)));
}

function montarComDelta(attrs: Record<string, unknown>, delta: unknown[]): HTMLElement {
  return montarDoc(EditorDocument.fromJSON(celulaDocComDelta(attrs, delta)));
}

describe("render de célula-lista", () => {
  it("sem listKind não emite lista", () => {
    const dom = montar({});
    expect(dom.querySelector("ul")).toBeNull();
    expect(dom.querySelector("ol")).toBeNull();
    expect(dom.querySelector(".ed-cell")!.textContent).toBe("um\ndois");
  });

  it("listKind bullet emite <ul> com um <li> por linha", () => {
    const dom = montar({ listKind: "bullet" });
    const ul = dom.querySelector("ul.ed-list.ed-list-bullet");
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll("li")).toHaveLength(2);
    expect([...ul!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["um", "dois"]);
  });

  it("listKind ordered emite <ol>", () => {
    const dom = montar({ listKind: "ordered" });
    expect(dom.querySelector("ol.ed-list.ed-list-ordered")).not.toBeNull();
  });

  it("todo <li> carrega data-cell-line com seu índice", () => {
    const dom = montar({ listKind: "bullet" });
    expect(
      [...dom.querySelectorAll("li")].map((li) => li.getAttribute("data-cell-line")),
    ).toEqual(["0", "1"]);
  });

  it("listStart vira o atributo start do <ol>", () => {
    const dom = montar({ listKind: "ordered", listStart: 5 });
    expect(dom.querySelector("ol")!.getAttribute("start")).toBe("5");
  });
});

// Conserto 1 (revisão final de feat/listas-em-tabela): `renderCellContent`
// chamava `renderInline(linha, ...)` com o delta de CADA LINHA, e `renderInline`
// numera embeds a partir de 0 no delta que recebe — então numa célula-lista o
// `data-embed-offset` saía relativo à linha, não à célula. Consequência real:
// `Editor.tsx` e `ImageResizeOverlay`/`BehindImageSelectAffordance` interpretam
// esse atributo em coordenadas da CÉLULA (mesmo mecanismo do fragmento de
// página), então um embed fora da 1ª linha nunca era selecionável.
//
// Estes testes cruzam `data-embed` com `data-cell-line`: o offset de cada
// imagem tem que bater com sua posição na célula inteira, não com sua posição
// dentro do próprio <li>.
describe("data-embed-offset em célula-lista (conserto 1: offset é da célula, não da linha)", () => {
  it('embed na 2ª linha de "um\\n[img]x" → data-embed-offset="3" (posição na CÉLULA), não "0"', () => {
    // um(0) m(1) \n(2) [img](3) x(4)
    const dom = montarComDelta({ listKind: "bullet" }, [
      { insert: "um\n" },
      imageOp(),
      { insert: "x" },
    ]);
    const lis = [...dom.querySelectorAll("li")];
    expect(lis).toHaveLength(2);
    const img = lis[1]!.querySelector('img[data-embed="image"]');
    expect(img).not.toBeNull();
    expect(img!.closest("li")!.getAttribute("data-cell-line")).toBe("1");
    expect(img!.getAttribute("data-embed-offset")).toBe("3");
  });

  it("duas imagens em linhas diferentes saem com offsets distintos (e batendo com data-cell-line)", () => {
    // [imgA](0) \n(1) [imgB](2)
    const dom = montarComDelta({ listKind: "bullet" }, [
      imageOp({ width: 11 }),
      { insert: "\n" },
      imageOp({ width: 22 }),
    ]);
    const lis = [...dom.querySelectorAll("li")];
    expect(lis).toHaveLength(2);
    const imgA = lis[0]!.querySelector('img[data-embed="image"]')!;
    const imgB = lis[1]!.querySelector('img[data-embed="image"]')!;
    expect(imgA.getAttribute("data-embed-offset")).toBe("0");
    expect(imgB.getAttribute("data-embed-offset")).toBe("2");
    expect(imgA.getAttribute("data-embed-offset")).not.toBe(
      imgB.getAttribute("data-embed-offset"),
    );
  });

  it("embed no meio de texto já presente na 2ª linha (não só abrindo linha nova)", () => {
    // first(0-4) \n(5) a(6) b(7) [img](8) c(9) d(10)
    const dom = montarComDelta({ listKind: "bullet" }, [
      { insert: "first\n" },
      { insert: "ab" },
      imageOp(),
      { insert: "cd" },
    ]);
    const lis = [...dom.querySelectorAll("li")];
    expect(lis).toHaveLength(2);
    const img = lis[1]!.querySelector('img[data-embed="image"]')!;
    expect(img.closest("li")!.getAttribute("data-cell-line")).toBe("1");
    expect(img.getAttribute("data-embed-offset")).toBe("8");
  });

  it("não-regressão: célula SEM listKind com embed mantém offset igual ao de antes desta branch", () => {
    // Sem listKind, renderInline recebe o delta INTEIRO (nunca foi fatiado
    // por linha) — o offset já era correto na célula antes desta branch, e
    // baseOffset default 0 não pode mudar isso.
    const dom = montarComDelta({}, [{ insert: "um\n" }, imageOp(), { insert: "x" }]);
    expect(dom.querySelectorAll("li")).toHaveLength(0);
    const img = dom.querySelector('img[data-embed="image"]')!;
    expect(img.getAttribute("data-embed-offset")).toBe("3");
  });
});
