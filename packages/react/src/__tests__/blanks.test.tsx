import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import { renderInline } from "../renderInline";
import type { DeltaOp } from "@sofereditor/core";

const html = (d: DeltaOp[]): string =>
  renderToStaticMarkup(createElement(Fragment, null, renderInline(d, "k")));

/** Texto visível, sem tags — o que o leitor de offsets do dom-bridge enxerga. */
const stripTags = (h: string): string => h.replace(/<[^>]*>/g, "");

describe("lacuna de underlines", () => {
  it("envolve corridas de 3+ num span de lacuna", () => {
    const out = html([{ insert: "Nome: _____" }]);
    expect(out).toContain("-webkit-text-fill-color:transparent");
    expect(out).toContain("text-decoration:underline");
  });

  it("preserva os caracteres literais no DOM (offsets do modelo)", () => {
    // dom-bridge soma textContent.length; sumir com um caractere quebraria o caret.
    expect(stripTags(html([{ insert: "a___b" }]))).toBe("a___b");
    expect(stripTags(html([{ insert: "Nome: " + "_".repeat(20) }]))).toBe(
      "Nome: " + "_".repeat(20),
    );
  });

  it("não decora 1 ou 2 underlines", () => {
    expect(html([{ insert: "a__b" }])).not.toContain("text-fill-color");
    expect(html([{ insert: "a_b" }])).not.toContain("text-fill-color");
  });

  it("texto sem underline nenhum sai sem wrapper extra", () => {
    expect(html([{ insert: "hello world" }])).toBe("hello world");
  });

  it("decora múltiplas corridas no mesmo run", () => {
    const out = html([{ insert: "Nome: ____ Turma: ___" }]);
    expect((out.match(/data-blank="true"/g) ?? [])).toHaveLength(2);
  });

  it("mantém a lacuna DENTRO das marks do run", () => {
    // A lacuna é decoração de texto; as marks continuam envolvendo tudo.
    const out = html([{ insert: "a___", attributes: { bold: true } }]);
    expect(out.indexOf("<strong>")).toBeLessThan(out.indexOf("text-fill-color"));
    expect(stripTags(out)).toBe("a___");
  });

  it("combina com highlight sem perder nenhum dos dois", () => {
    const out = html([{ insert: "___", attributes: { highlight: "#fff176" } }]);
    expect(out).toContain("background-color:#fff176");
    expect(out).toContain("-webkit-text-fill-color:transparent");
  });
});
