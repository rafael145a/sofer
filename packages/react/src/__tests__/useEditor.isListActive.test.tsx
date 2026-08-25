// @vitest-environment jsdom
/**
 * Conserto 2 (revisão final de feat/listas-em-tabela): `isListActive` só
 * olhava `doc.getBlockType(i) !== "listItem"`. Dentro de tabela o bloco é
 * sempre "table" (a célula é um `Y.Text` plano com `CellAttrs.listKind`),
 * então `isListActive` devolvia `false` mesmo com a lista ligada e os
 * marcadores visíveis — o botão da toolbar nunca acendia (`aria-pressed`
 * vem de `isListActive`, `styles.css:80`).
 *
 * A Task 2 já tornou `toggleList` ciente de célula; faltava a mesma
 * consciência na LEITURA de estado.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  type SerializedDocument,
} from "@sofereditor/core";
import { EditorProvider } from "../EditorContext";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function doc(): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "um\ndois", delta: [{ insert: "um\ndois" }], attrs: {} },
          { text: "outra", delta: [{ insert: "outra" }], attrs: {} },
        ],
      },
      { type: "paragraph", text: "fora da tabela", delta: [{ insert: "fora da tabela" }], attrs: {} },
    ],
  } as SerializedDocument;
}

// Célula 1 é coberta por um colspan=2 na célula 0: não guarda `listKind`
// próprio, só `covered: true` — a leitura tem que redirecionar pro owner
// real (índice 0), mesmo redirecionamento que `toggleList` já faz na
// escrita/leitura (`commands.ts`).
function docComColunaMesclada(): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "um", delta: [{ insert: "um" }], attrs: { colspan: 2 } },
          { text: "", delta: [], attrs: { covered: true } },
        ],
      },
    ],
  } as SerializedDocument;
}

function Host({
  editorRef,
  editorDoc,
}: {
  editorRef: MutableRefObject<UseEditorResult | null>;
  editorDoc: EditorDocument;
}) {
  const editor = useEditor({ document: editorDoc });
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
});

function mount(build: () => SerializedDocument = doc): UseEditorResult {
  // `document` PRECISA ser a mesma referência entre renders: `useEditor`
  // faz `useMemo(() => opts.document ?? ..., [opts.document])`, então criar
  // um `EditorDocument.fromJSON(...)` novo a cada render do Host trocaria o
  // Y.Doc inteiro debaixo do editor a cada re-render (setSelection dispara
  // um). Construir UMA VEZ fora do componente, como os demais harnesses
  // deste pacote (`celulaListaRender.test.tsx`).
  const editorDoc = EditorDocument.fromJSON(build());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const editorRef: MutableRefObject<UseEditorResult | null> = { current: null };
  act(() => {
    root!.render(createElement(Host, { editorRef, editorDoc }));
  });
  const api = editorRef.current;
  if (!api) throw new Error("editor não inicializou");
  return api;
}

describe("isListActive dentro de célula de tabela (conserto 2)", () => {
  it("célula com listKind bullet → isListActive('bullet') é true (botão acende)", () => {
    const api = mount();
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 0, cellIndex: 0, offset: 0 }));
    });
    expect(api.isListActive("bullet")).toBe(false);
    act(() => {
      api.toggleList("bullet");
    });
    // toggleList troca a seleção internamente mas o foco continua na mesma célula
    expect(api.doc.getCellAttrs(0, 0).listKind).toBe("bullet");
    expect(api.isListActive("bullet")).toBe(true);
    expect(api.isListActive("ordered")).toBe(false);
  });

  it("célula sem listKind → isListActive é false para os dois tipos", () => {
    const api = mount();
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 0, cellIndex: 1, offset: 0 }));
    });
    expect(api.isListActive("bullet")).toBe(false);
    expect(api.isListActive("ordered")).toBe(false);
  });

  it("ligar lista numa célula não acende o botão para a OUTRA célula", () => {
    const api = mount();
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 0, cellIndex: 0, offset: 0 }));
      api.toggleList("ordered");
    });
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 0, cellIndex: 1, offset: 0 }));
    });
    expect(api.isListActive("ordered")).toBe(false);
  });

  it("fora de tabela continua olhando BlockAttrs.listKind (comportamento antigo intacto)", () => {
    const api = mount();
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 1, offset: 0 }));
    });
    expect(api.isListActive("bullet")).toBe(false);
    act(() => {
      api.toggleList("bullet");
    });
    expect(api.doc.getBlockType(1)).toBe("listItem");
    expect(api.isListActive("bullet")).toBe(true);
  });

  it("foco numa célula coberta por colspan → isListActive redireciona pro owner real", () => {
    const api = mount(docComColunaMesclada);
    act(() => {
      // foco na célula 1 (coberta), que é a que o cursor visualmente ocupa
      // dentro da mesclagem — só a célula 0 (owner) guarda `listKind`.
      api.setSelection(collapsedSelection({ blockIndex: 0, cellIndex: 1, offset: 0 }));
      api.toggleList("ordered");
    });
    expect(api.doc.getCellAttrs(0, 0).listKind).toBe("ordered");
    act(() => {
      api.setSelection(collapsedSelection({ blockIndex: 0, cellIndex: 1, offset: 0 }));
    });
    expect(api.isListActive("ordered")).toBe(true);
  });
});
