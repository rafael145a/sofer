// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement, act, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { documentToHtmlFragment } from "@sofereditor/export-pdf";
import {
  cellBorderStyle,
  styleToCssText,
  EditorDocument,
  type DeltaOp,
  type SerializedDocument,
} from "@sofereditor/core";
import { renderInline } from "../renderInline";
import { commonBlockProps, NodeView } from "../NodeView";
import { EditorProvider } from "../EditorContext";
import { useEditor, type UseEditorResult } from "../useEditor";

/**
 * A renderização inline existe DUAS vezes no monorepo: aqui
 * (`renderInline.tsx`, que produz o DOM do editor e, por clone, o PDF) e em
 * `@sofereditor/export-pdf` (`html.ts`, o caminho de HTML de servidor).
 *
 * Sem este teste, uma decoração nova funciona na tela e diverge silenciosamente
 * no HTML de servidor — o modo de falha exato que a fidelidade de impressão do
 * projeto existe para impedir.
 */

const editorHtml = (d: DeltaOp[]): string =>
  renderToStaticMarkup(createElement(Fragment, null, renderInline(d, "k")));

const serverHtml = (d: DeltaOp[]): string =>
  documentToHtmlFragment({
    blocks: [{ type: "paragraph", text: "", delta: d, attrs: {} }],
  });

/** Declarações CSS de cada atributo `style`, normalizadas para comparar por conteúdo. */
function decls(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)]
    .map((m) =>
      m[1]
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .join(";"),
    )
    .sort();
}

const stripTags = (h: string): string => h.replace(/<[^>]*>/g, "");

const CASES: Array<{ name: string; delta: DeltaOp[] }> = [
  { name: "marca-texto", delta: [{ insert: "oi", attributes: { highlight: "#fff176" } }] },
  { name: "lacuna", delta: [{ insert: "Nome: _______" }] },
  {
    name: "marca-texto + lacuna",
    delta: [{ insert: "a_____", attributes: { highlight: "#fff176" } }],
  },
  {
    name: "cor + tamanho + marca-texto",
    delta: [
      {
        insert: "x",
        attributes: { color: "#ff0000", fontSize: "14pt", highlight: "#00ff00" },
      },
    ],
  },
  {
    name: "lacuna dentro de negrito",
    delta: [{ insert: "R: ____", attributes: { bold: true } }],
  },
  { name: "múltiplas lacunas", delta: [{ insert: "Nome: ____ Turma: ___" }] },
];

describe("paridade de bloco: linha de resposta", () => {
  for (const spacing of [1, 1.5, 2] as const) {
    it(`entrelinha ${spacing} sai igual nos dois caminhos`, () => {
      const attrs = { answerLine: true, answerLineSpacing: spacing } as const;
      const editorStyle = commonBlockProps(attrs, 0, "paragraph", undefined).style as Record<
        string,
        string
      >;
      const server = documentToHtmlFragment({
        blocks: [{ type: "paragraph", text: "", delta: [], attrs }],
      });
      // Toda declaração que o editor emite precisa aparecer no HTML de servidor.
      for (const [k, v] of Object.entries(editorStyle)) {
        expect(server).toContain(`${styleToCssText({ [k]: v })}`);
      }
    });
  }

  it("parágrafo comum não ganha style em nenhum dos dois", () => {
    expect(commonBlockProps({}, 0, "paragraph", undefined).style).toBeUndefined();
    const server = documentToHtmlFragment({
      blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
    });
    expect(server).not.toContain("style=");
  });
});

describe("paridade editor ↔ HTML de servidor", () => {
  for (const c of CASES) {
    it(`declara os mesmos estilos: ${c.name}`, () => {
      const editor = decls(editorHtml(c.delta));
      const server = decls(serverHtml(c.delta));
      expect(server).toEqual(expect.arrayContaining(editor));
    });

    it(`preserva o mesmo texto visível: ${c.name}`, () => {
      expect(stripTags(serverHtml(c.delta))).toContain(stripTags(editorHtml(c.delta)));
    });

    it(`marca as lacunas nos dois caminhos: ${c.name}`, () => {
      const editorBlanks = (editorHtml(c.delta).match(/data-blank="true"/g) ?? []).length;
      const serverBlanks = (serverHtml(c.delta).match(/data-blank="true"/g) ?? []).length;
      expect(serverBlanks).toBe(editorBlanks);
    });
  }
});

describe("paridade de tabela: cor da borda", () => {
  const cells = [{ text: "", delta: [], attrs: {} }];
  const attrs = { rows: 1, cols: 1, borderPreset: "all", borderColor: "#123456" } as const;

  it("editor e HTML de servidor concordam nas cores da grade", () => {
    const editor = cellBorderStyle(
      attrs.borderPreset,
      { row: 0, col: 0, rowspan: 1, colspan: 1, cols: 1, rowStart: 0, rowEnd: 1 },
      "print",
      attrs.borderColor,
    );
    const server = documentToHtmlFragment({
      blocks: [{ type: "table", text: "", delta: [], attrs, cells }],
    });
    for (const [k, v] of Object.entries(editor)) {
      expect(server).toContain(styleToCssText({ [k]: v }));
    }
  });

  it("concordam também com preset parcial, onde os lados desligados divergiriam", () => {
    const pos = { row: 0, col: 0, rowspan: 1, colspan: 1, cols: 1, rowStart: 0, rowEnd: 1 };
    const editor = cellBorderStyle("horizontal", pos, "print", "#123456");
    const server = documentToHtmlFragment({
      blocks: [{
        type: "table", text: "", delta: [],
        attrs: { rows: 1, cols: 1, borderPreset: "horizontal", borderColor: "#123456" },
        cells,
      }],
    });
    for (const [k, v] of Object.entries(editor)) {
      expect(server).toContain(styleToCssText({ [k]: v }));
    }
  });
});

describe("fórmula inline", () => {
  const formulaOp: DeltaOp[] = [
    {
      insert: {
        type: "image",
        src: "data:image/svg+xml;base64,AAA",
        width: 20,
        height: 12,
        formula: { latex: "\\frac{1}{2}", display: false, vAlign: "-0.781ex" },
      },
    },
  ];

  it("aplica o vertical-align da fórmula no lugar do text-bottom", () => {
    const editor = editorHtml(formulaOp);
    expect(editor).toContain("vertical-align:-0.781ex");
    expect(editor).not.toContain("text-bottom");
  });

  it("editor e HTML de servidor emitem as MESMAS declarações", () => {
    // Sem isto, a fórmula sentaria na base na tela e flutuaria no topo no PDF.
    expect(decls(editorHtml(formulaOp))).toEqual(decls(serverHtml(formulaOp)));
  });

  it("imagem comum continua com text-bottom", () => {
    const imagem: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 20, height: 12 } },
    ];
    expect(editorHtml(imagem)).toContain("text-bottom");
    expect(decls(editorHtml(imagem))).toEqual(decls(serverHtml(imagem)));
  });

  it("behind emite as mesmas declarações", () => {
    const behind: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 20, height: 12, layout: "behind" } },
    ];
    expect(decls(editorHtml(behind))).toEqual(decls(serverHtml(behind)));
  });

  it("front emite as mesmas declarações", () => {
    const front: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 20, height: 12, layout: "front" } },
    ];
    expect(decls(editorHtml(front))).toEqual(decls(serverHtml(front)));
  });

  it("inline com align emite as mesmas declarações", () => {
    const inlineAlign: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 20, height: 12, align: "center" } },
    ];
    expect(decls(editorHtml(inlineAlign))).toEqual(decls(serverHtml(inlineAlign)));
  });

  it("wrap-left emite flutuação corretamente no servidor", () => {
    const wrapLeft: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 50, height: 40, layout: "wrap-left" } },
    ];
    const server = serverHtml(wrapLeft);
    // Verifica que o servidor emite float:left com as margens corretas
    expect(server).toContain("float:left");
    expect(server).toContain("margin-right:");
  });

  it("wrap-right emite flutuação corretamente no servidor", () => {
    const wrapRight: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 50, height: 40, layout: "wrap-right" } },
    ];
    const server = serverHtml(wrapRight);
    // Verifica que o servidor emite float:right com as margens corretas
    expect(server).toContain("float:right");
    expect(server).toContain("margin-left:");
  });
});

/**
 * Task 7 (célula-lista no PDF) — este arquivo existe pra impedir
 * `renderInline.tsx` divergir de `html.ts` em silêncio, mas as coberturas
 * acima só chamam `renderInline(...)` isolado; nenhuma monta `TableView` de
 * verdade (precisa de `EditorProvider`/`useEditor`, não de um delta solto).
 * Resultado: nada aqui travava `NodeView.renderCellContent` (a moldura
 * `<ul>`/`<ol>` de célula com `listKind`, adicionada em
 * `packages/export-pdf/src/__tests__/celulaLista.test.ts`) ficar fora de
 * sincronia com `renderCellContent` de `packages/export-pdf/src/html.ts` — o
 * `celulaLista.test.ts` só compara contra strings escritas à mão, não contra
 * o que o React realmente monta. Fecha essa lacuna montando os dois lados de
 * verdade (DOM real via `createRoot`, e o HTML de `documentToHtmlFragment`
 * parseado com `DOMParser`) e comparando a estrutura que importa pra
 * fidelidade: tag da lista, classes, `data-list-kind`, `data-cell-line` de
 * cada `<li>` e o texto de cada um.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa `ResizeObserver` (usado por `TableResizeOverlay`, que
// `TableView` sempre monta). Mesmo polyfill local de
// `celulaListaRender.test.tsx` — não mexe em código de produção.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function celulaListaDoc(texto: string, attrs: Record<string, unknown>): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 1 },
        cells: [{ text: texto, delta: [{ insert: texto }], attrs }],
      },
    ],
  } as SerializedDocument;
}

let celulaContainer: HTMLDivElement | null = null;
let celulaRoot: Root | null = null;

afterEach(() => {
  if (celulaRoot) {
    act(() => celulaRoot!.unmount());
    celulaRoot = null;
  }
  if (celulaContainer) {
    celulaContainer.remove();
    celulaContainer = null;
  }
});

/** Monta a célula de verdade via `NodeView` (mesmo padrão de `celulaListaRender.test.tsx`). */
function montarCelulaDom(doc: SerializedDocument): HTMLElement {
  const editorDoc = EditorDocument.fromJSON(doc);
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
  celulaContainer = document.createElement("div");
  document.body.appendChild(celulaContainer);
  celulaRoot = createRoot(celulaContainer);
  act(() => {
    celulaRoot!.render(createElement(Harness, { apiRef }));
  });
  return celulaContainer;
}

interface ListaStructure {
  tag: string | null;
  className: string | null;
  dataListKind: string | null;
  start: string | null;
  itens: Array<{ dataCellLine: string | null; texto: string | null }>;
}

/** Extrai só o que importa pra fidelidade — não o HTML inteiro (que diverge
 * em detalhes irrelevantes pro PDF, como `data-empty` de linha vazia). */
function extrairListaStructure(root: ParentNode): ListaStructure | null {
  const lista = root.querySelector("ul.ed-list, ol.ed-list");
  if (!lista) return null;
  return {
    tag: lista.tagName,
    className: lista.getAttribute("class"),
    dataListKind: lista.getAttribute("data-list-kind"),
    start: lista.getAttribute("start"),
    itens: [...lista.querySelectorAll("li")].map((li) => ({
      dataCellLine: li.getAttribute("data-cell-line"),
      texto: li.textContent,
    })),
  };
}

function servidorListaStructure(doc: SerializedDocument): ListaStructure | null {
  const html = documentToHtmlFragment(doc);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return extrairListaStructure(parsed);
}

describe("paridade real de DOM: célula-lista (tabela)", () => {
  it("bullet de 3 linhas: mesma tag, classes, data-list-kind e um <li> por linha", () => {
    const doc = celulaListaDoc("um\ndois\ntres", { listKind: "bullet" });
    const editor = extrairListaStructure(montarCelulaDom(doc));
    const servidor = servidorListaStructure(doc);
    expect(editor).not.toBeNull();
    expect(editor).toEqual(servidor);
    expect(editor!.itens).toHaveLength(3);
    expect(editor!.itens.map((i) => i.texto)).toEqual(["um", "dois", "tres"]);
  });

  it("ordered com listStart: mesmo <ol start> e mesmos data-cell-line", () => {
    const doc = celulaListaDoc("primeiro\nsegundo", {
      listKind: "ordered",
      listStart: 7,
    });
    const editor = extrairListaStructure(montarCelulaDom(doc));
    const servidor = servidorListaStructure(doc);
    expect(editor).not.toBeNull();
    expect(editor).toEqual(servidor);
    expect(editor!.start).toBe("7");
    expect(editor!.itens.map((i) => i.dataCellLine)).toEqual(["0", "1"]);
  });

  it("linha vazia no meio ('a\\n\\nb'): mesma contagem de <li> e mesmo texto (vazio no meio)", () => {
    const doc = celulaListaDoc("a\n\nb", { listKind: "bullet" });
    const editor = extrairListaStructure(montarCelulaDom(doc));
    const servidor = servidorListaStructure(doc);
    expect(editor).not.toBeNull();
    expect(editor).toEqual(servidor);
    expect(editor!.itens.map((i) => i.texto)).toEqual(["a", "", "b"]);
  });
});
