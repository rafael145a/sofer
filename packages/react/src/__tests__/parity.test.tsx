import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import { documentToHtmlFragment } from "@sofereditor/export-pdf";
import type { DeltaOp } from "@sofereditor/core";
import { renderInline } from "../renderInline";

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
