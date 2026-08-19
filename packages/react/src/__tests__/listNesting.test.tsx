// @vitest-environment jsdom
/**
 * Reprodução do bug real: lista colada do Word com tipo diferente por nível
 * (ordered nível 0, bullets nível 1) sai achatada — os bullets viram uma
 * lista IRMÃ do item numerado em vez de aninhada dentro do seu <li>.
 *
 * O modelo (`groupTopLevels` / `buildListTree`) já está correto — os bugs
 * são de renderização em dois pontos de `Editor.tsx`:
 *   1. `groupTopLevels` quebra o grupo por mudança de `listKind` mesmo
 *      quando o item é mais fundo que o líder do grupo.
 *   2. `renderNestedListTree` usa o `listKind` do TOPO para renderizar toda
 *      sublista, em vez do `listKind` dos próprios itens da sublista.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment } from "react";
import type { SerializedBlock, ListKind, ListStyleType } from "@sofereditor/core";
import { groupTopLevels, renderListFragment, renderTopLevel, topLevelItemRanges } from "../Editor";

function li(
  text: string,
  kind: ListKind,
  level: number,
  extra: { listStart?: number; listStyle?: ListStyleType } = {},
): SerializedBlock {
  return {
    type: "listItem",
    text,
    delta: [{ insert: text }],
    attrs: { listKind: kind, listLevel: level, ...extra },
  };
}

function renderBlocks(blocks: SerializedBlock[]): HTMLDivElement {
  const tops = groupTopLevels(blocks);
  const html = renderToStaticMarkup(
    createElement(Fragment, null, tops.map((t) => renderTopLevel(t))),
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

function directChildTags(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag.toUpperCase());
}

describe("groupTopLevels — agrupamento por nível, não só por tipo", () => {
  it("caso real: ordered nível 0 seguido de 3 bullets nível 1 forma UM único grupo", () => {
    const blocks = [
      li("Na Estação Faria Lima, ...", "ordered", 0),
      li("É um número de 3 ordens.", "bullet", 1),
      li("A maior ordem é ...", "bullet", 1),
      li("O algarismo das dezenas ...", "bullet", 1),
    ];
    const tops = groupTopLevels(blocks);
    expect(tops.length).toBe(1);
    expect(tops[0].kind).toBe("list");
    if (tops[0].kind === "list") {
      expect(tops[0].items.length).toBe(4);
      expect(tops[0].listKind).toBe("ordered");
    }
  });

  it("não-regressão: dois grupos irmãos nível 0 de tipos diferentes continuam separados", () => {
    const blocks = [
      li("num 1", "ordered", 0),
      li("num 2", "ordered", 0),
      li("bul 1", "bullet", 0),
      li("bul 2", "bullet", 0),
    ];
    const tops = groupTopLevels(blocks);
    expect(tops.length).toBe(2);
    expect(tops[0].kind === "list" && tops[0].listKind).toBe("ordered");
    expect(tops[0].kind === "list" && tops[0].items.length).toBe(2);
    expect(tops[1].kind === "list" && tops[1].listKind).toBe("bullet");
    expect(tops[1].kind === "list" && tops[1].items.length).toBe(2);
  });

  it("não-regressão: listStart numa continuação nível 0 ainda quebra o grupo", () => {
    const blocks = [
      li("a", "ordered", 0),
      li("b", "ordered", 0),
      li("c", "ordered", 0, { listStart: 1 }),
    ];
    const tops = groupTopLevels(blocks);
    expect(tops.length).toBe(2);
    expect(tops[0].kind === "list" && tops[0].items.length).toBe(2);
    expect(tops[1].kind === "list" && tops[1].items.length).toBe(1);
  });

  it("não-regressão: listStyle diferente numa continuação nível 0 ainda quebra o grupo", () => {
    const blocks = [
      li("a", "ordered", 0, { listStyle: "decimal" }),
      li("b", "ordered", 0, { listStyle: "lower-alpha" }),
    ];
    const tops = groupTopLevels(blocks);
    expect(tops.length).toBe(2);
  });

  it("borda: grupo cujo LÍDER começa em nível > 0 ainda quebra ao voltar pra um nível mais raso com tipo diferente", () => {
    // Um parágrafo colado que começa NO MEIO de uma sublista (líder em
    // nível 1) seguido de um item nível 0 de tipo diferente: o item nível 0
    // vira raiz em `buildListTree` (seu nível é <= o do líder), então tem
    // que abrir um NOVO grupo — senão `renderListTree` usaria `top.listKind`
    // (do líder bullet) pra um `<ol>` que na verdade é bullet.
    const blocks = [li("sub", "bullet", 1), li("topo", "ordered", 0)];
    const tops = groupTopLevels(blocks);
    expect(tops.length).toBe(2);
    expect(tops[0].kind === "list" && tops[0].listKind).toBe("bullet");
    expect(tops[0].kind === "list" && tops[0].items.length).toBe(1);
    expect(tops[1].kind === "list" && tops[1].listKind).toBe("ordered");
    expect(tops[1].kind === "list" && tops[1].items.length).toBe(1);
  });
});

describe("renderização — aninhamento real no DOM", () => {
  it("caso real: <ul> dos bullets é DESCENDENTE do <li> do item ordered, não irmão do <ol>", () => {
    const blocks = [
      li("Na Estação Faria Lima, ...", "ordered", 0),
      li("É um número de 3 ordens.", "bullet", 1),
      li("A maior ordem é ...", "bullet", 1),
      li("O algarismo das dezenas ...", "bullet", 1),
    ];
    const container = renderBlocks(blocks);

    // Uma única lista de topo.
    const topLists = [...directChildTags(container, "ol"), ...directChildTags(container, "ul")];
    expect(topLists.length).toBe(1);

    const ol = directChildTags(container, "ol")[0] as HTMLElement;
    expect(ol).toBeTruthy();
    expect(ol.getAttribute("data-list-kind")).toBe("ordered");

    // Exatamente 1 <li> filho direto do <ol> — o item nível 0.
    const directLis = directChildTags(ol, "li");
    expect(directLis.length).toBe(1);
    const li0 = directLis[0] as HTMLElement;

    // O <ul> não pode estar solto no nível raiz (irmão do <ol>).
    expect(directChildTags(container, "ul").length).toBe(0);

    // O <ul> dos bullets tem que ser descendente do <li> do item ordered.
    const nestedUl = li0.querySelector("ul");
    expect(nestedUl).not.toBeNull();
    expect(li0.contains(nestedUl)).toBe(true);
    expect(nestedUl!.getAttribute("data-list-kind")).toBe("bullet");

    // Os 3 bullets moram dentro desse <ul>.
    expect(directChildTags(nestedUl!, "li").length).toBe(3);
  });

  it("inverso: bullet nível 0 com filhos ordered nível 1 aninha dentro do <li>", () => {
    const blocks = [
      li("item bullet", "bullet", 0),
      li("sub 1", "ordered", 1),
      li("sub 2", "ordered", 1),
    ];
    const container = renderBlocks(blocks);
    const ul = directChildTags(container, "ul")[0] as HTMLElement;
    expect(ul).toBeTruthy();
    const li0 = directChildTags(ul, "li")[0] as HTMLElement;

    expect(directChildTags(container, "ol").length).toBe(0);

    const nestedOl = li0.querySelector("ol");
    expect(nestedOl).not.toBeNull();
    expect(li0.contains(nestedOl)).toBe(true);
    expect(nestedOl!.getAttribute("data-list-kind")).toBe("ordered");
    expect(directChildTags(nestedOl!, "li").length).toBe(2);
  });

  it("três níveis alternando: ordered 0 -> bullet 1 -> ordered 2, cada nível com seu próprio tipo", () => {
    const blocks = [li("n0", "ordered", 0), li("n1", "bullet", 1), li("n2", "ordered", 2)];
    const container = renderBlocks(blocks);

    const ol0 = directChildTags(container, "ol")[0] as HTMLElement;
    expect(ol0).toBeTruthy();
    const li0 = directChildTags(ol0, "li")[0] as HTMLElement;

    const ul1 = li0.querySelector(":scope > ul") as HTMLElement | null;
    expect(ul1).not.toBeNull();
    expect(ul1!.getAttribute("data-list-kind")).toBe("bullet");
    expect(li0.contains(ul1)).toBe(true);

    const li1 = directChildTags(ul1!, "li")[0] as HTMLElement;
    const ol2 = li1.querySelector(":scope > ol") as HTMLElement | null;
    expect(ol2).not.toBeNull();
    expect(ol2!.getAttribute("data-list-kind")).toBe("ordered");
    expect(li1.contains(ol2)).toBe(true);
  });

  it("não-regressão: dois grupos irmãos nível 0 de tipos diferentes renderizam como DUAS listas separadas", () => {
    const blocks = [
      li("num 1", "ordered", 0),
      li("num 2", "ordered", 0),
      li("bul 1", "bullet", 0),
      li("bul 2", "bullet", 0),
    ];
    const container = renderBlocks(blocks);
    const topLists = [...directChildTags(container, "ol"), ...directChildTags(container, "ul")];
    expect(topLists.length).toBe(2);
    expect(topLists[0].tagName).toBe("OL");
    expect(topLists[1].tagName).toBe("UL");
    expect(directChildTags(topLists[0], "li").length).toBe(2);
    expect(directChildTags(topLists[1], "li").length).toBe(2);
  });

  it("ordinal do <ol> pai não é afetado pelos filhos bullet aninhados", () => {
    const blocks = [
      li("a", "ordered", 0, { listStart: 5 }),
      li("b", "bullet", 1),
      li("c", "bullet", 1),
    ];
    const container = renderBlocks(blocks);
    const ol = directChildTags(container, "ol")[0] as HTMLElement;
    expect(ol.getAttribute("start")).toBe("5");
    // Apenas 1 <li> direto contribui pro <ol> pai — os bullets aninhados não contam.
    expect(directChildTags(ol, "li").length).toBe(1);
  });
});

describe("paginação — fatiamento por nível 0 continua correto com grupo de tipos mistos", () => {
  // Antes da correção, um grupo com filhos de tipo diferente do líder era
  // IMPOSSÍVEL de existir (o agrupamento quebrava ali). Agora que
  // `groupTopLevels` mantém esses filhos no mesmo grupo, `topLevelItemRanges`
  // e `renderListFragment` (usados por `placeFragmentedList` no paginador)
  // precisam continuar fatiando corretamente nas fronteiras de nível 0 —
  // cada item nível 0 "possui" seus descendentes de tipo estrangeiro.
  const blocks = [
    li("Questão 1", "ordered", 0), // idx 0 — nível 0
    li("1.a bullet", "bullet", 1), // idx 1
    li("1.b bullet", "bullet", 1), // idx 2
    li("Questão 2", "ordered", 0), // idx 3 — nível 0
    li("2.a bullet", "bullet", 1), // idx 4
  ];

  it("groupTopLevels mantém tudo em UM grupo (mesmo listKind nos dois níveis 0)", () => {
    const tops = groupTopLevels(blocks);
    expect(tops.length).toBe(1);
    expect(tops[0].kind === "list" && tops[0].items.length).toBe(5);
  });

  it("topLevelItemRanges: cada nível 0 possui seus descendentes de tipo estrangeiro", () => {
    const tops = groupTopLevels(blocks);
    const top = tops[0];
    if (top.kind !== "list") throw new Error("esperava grupo de lista");
    const ranges = topLevelItemRanges(top.items);
    expect(ranges).toEqual([
      [0, 3],
      [3, 5],
    ]);
  });

  it("renderListFragment: fragmento do 2º item nível 0 mantém <ol> pai e <ul> aninhado", () => {
    const tops = groupTopLevels(blocks);
    const top = tops[0];
    if (top.kind !== "list") throw new Error("esperava grupo de lista");

    // Simula o que `placeFragmentedList` produz quando o item nível-0 índice 1
    // (Questão 2 + seu bullet) vai para uma página de continuação: mediu 2
    // <li> diretos no <ol> desfragmentado, e o fragmento cobre o 2º deles.
    const html = renderToStaticMarkup(
      createElement(Fragment, null, renderListFragment(top, { index: 1, itemStart: 1, itemEnd: 2 })),
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    const ol = directChildTags(container, "ol")[0] as HTMLElement;
    expect(ol).toBeTruthy();
    expect(ol.getAttribute("data-list-kind")).toBe("ordered");
    // ordinalStart do grupo (1) + itemStart (1) = numeração continua em 2.
    expect(ol.getAttribute("start")).toBe("2");

    // Exatamente 1 <li> direto — "Questão 2" — não os 2 blocos que ela carrega.
    const directLis = directChildTags(ol, "li");
    expect(directLis.length).toBe(1);

    // O bullet aninhado dela viaja junto, dentro do <li>, não solto no topo.
    expect(directChildTags(container, "ul").length).toBe(0);
    const nestedUl = directLis[0].querySelector("ul");
    expect(nestedUl).not.toBeNull();
    expect(directLis[0].contains(nestedUl)).toBe(true);
    expect(directChildTags(nestedUl!, "li").length).toBe(1);
  });
});
