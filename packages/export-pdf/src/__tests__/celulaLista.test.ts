import { describe, it, expect } from "vitest";
import { documentToHtml } from "../html";
import type { SerializedDocument } from "@sofereditor/core";

function doc(attrs: Record<string, unknown>): SerializedDocument {
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

describe("célula-lista no HTML do PDF", () => {
  it("sem listKind não emite lista", () => {
    const out = documentToHtml(doc({}), { title: "t" });
    expect(out).not.toContain("<ul");
  });

  it("com listKind bullet emite <ul> e um <li> por linha", () => {
    const out = documentToHtml(doc({ listKind: "bullet" }), { title: "t" });
    expect(out).toContain("ed-list-bullet");
    expect((out.match(/<li/g) ?? []).length).toBe(2);
  });

  it("com listKind ordered emite <ol> com start quando houver listStart", () => {
    const out = documentToHtml(doc({ listKind: "ordered", listStart: 3 }), { title: "t" });
    expect(out).toContain("<ol");
    expect(out).toContain('start="3"');
    expect(out).not.toContain("<ul");
  });

  it("emite um único <ul>/<ol> por célula (não um por linha)", () => {
    const out = documentToHtml(doc({ listKind: "bullet" }), { title: "t" });
    expect((out.match(/<ul/g) ?? []).length).toBe(1);
  });

  it("cada <li> carrega data-cell-line com o índice da linha", () => {
    const out = documentToHtml(doc({ listKind: "bullet" }), { title: "t" });
    expect(out).toContain('data-cell-line="0"');
    expect(out).toContain('data-cell-line="1"');
  });

  it("o CSS embutido tem regra de lista dentro de célula", () => {
    const out = documentToHtml(doc({ listKind: "bullet" }), { title: "t" });
    expect(out).toContain(".ed-cell .ed-list");
  });

  it("linha vazia entre itens vira <li><br></li>, sem quebrar a contagem de linhas", () => {
    const vazio: SerializedDocument = {
      blocks: [
        {
          type: "table",
          text: "",
          delta: [],
          attrs: { rows: 1, cols: 1 },
          cells: [
            {
              text: "um\n\ndois",
              delta: [{ insert: "um\n\ndois" }],
              attrs: { listKind: "bullet" },
            },
          ],
        },
      ],
    } as SerializedDocument;
    const out = documentToHtml(vazio, { title: "t" });
    expect((out.match(/<li/g) ?? []).length).toBe(3);
    expect(out).toContain('<li class="ed-listitem" data-cell-line="1"><br></li>');
  });

  it("listStyle sobrepõe o marcador padrão via style inline", () => {
    const out = documentToHtml(
      doc({ listKind: "ordered", listStyle: "lower-alpha" }),
      { title: "t" },
    );
    expect(out).toContain("list-style-type:lower-alpha");
  });
});
