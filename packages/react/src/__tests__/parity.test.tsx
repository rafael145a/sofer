import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import { documentToHtmlFragment } from "@sofereditor/export-pdf";
import { cellBorderStyle, styleToCssText, type DeltaOp } from "@sofereditor/core";
import { renderInline } from "../renderInline";
import { commonBlockProps } from "../NodeView";

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
