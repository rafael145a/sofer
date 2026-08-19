// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  collapsedSelection,
  EditorDocument,
  insertSlice,
  insertText,
  setBlockType,
  type CommandContext,
  type DeltaOp,
  type Selection,
  type SerializedBlock,
} from "@sofereditor/core";
import { htmlToSlice } from "../htmlToSlice";

function harness() {
  const doc = new EditorDocument();
  let selection: Selection = collapsedSelection({ blockIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
  };
  return { ctx, doc, get selection() { return selection; } };
}

// As fixtures abaixo copiam a FORMA real que Word e Google Docs emitem no
// clipboard HTML (mso-*, class=MsoNormal, o wrapper <b style="font-weight:
// normal"> do Docs, <o:p>), não HTML idealizado — é essa forma que quebra os
// parsers ingênuos.

function textOf(block: SerializedBlock): string {
  return block.text;
}

function marksAt(block: SerializedBlock, index: number): DeltaOp["attributes"] {
  return block.delta[index]?.attributes;
}

describe("htmlToSlice — Google Docs: wrapper docs-internal-guid", () => {
  it("o wrapper <b style='font-weight:normal'> do documento inteiro não deixa tudo negrito", () => {
    const html =
      `<meta charset="utf-8">` +
      `<b style="font-weight:normal;" id="docs-internal-guid-abc123">` +
      `<p dir="ltr" style="line-height:1.38;margin-top:0;margin-bottom:0;">` +
      `<span style="font-size:11pt;">texto normal</span></p>` +
      `</b>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    expect(slice!.blocks).toHaveLength(1);
    expect(textOf(slice!.blocks[0])).toBe("texto normal");
    expect(marksAt(slice!.blocks[0], 0)?.bold).toBeUndefined();
  });

  it("negrito real dentro do wrapper (font-weight:700 explícito) continua negrito", () => {
    const html =
      `<b style="font-weight:normal;" id="docs-internal-guid-xyz">` +
      `<p><span style="font-weight:700;">isto é negrito</span> isto não é</p>` +
      `</b>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    const block = slice!.blocks[0];
    expect(block.delta[0].insert).toBe("isto é negrito");
    expect(block.delta[0].attributes?.bold).toBe(true);
    const rest = block.delta.slice(1).map((o) => o.insert).join("");
    expect(rest).toContain("isto não é");
    expect(block.delta[block.delta.length - 1].attributes?.bold).toBeUndefined();
  });

  it("o wrapper preserva múltiplos parágrafos (não achata tudo numa linha só)", () => {
    const html =
      `<b style="font-weight:normal;" id="docs-internal-guid-multi">` +
      `<p>Primeiro parágrafo</p><p>Segundo parágrafo</p>` +
      `</b>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    expect(slice!.blocks).toHaveLength(2);
    expect(textOf(slice!.blocks[0])).toBe("Primeiro parágrafo");
    expect(textOf(slice!.blocks[1])).toBe("Segundo parágrafo");
  });
});

describe("htmlToSlice — negrito/itálico/sublinhado por style em <span> (Docs)", () => {
  it("span com font-weight:700 vira bold, font-style:italic vira italic", () => {
    const html =
      `<p><span style="font-weight:700">negrito</span> ` +
      `<span style="font-style:italic">itálico</span></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    expect(delta[0].insert).toBe("negrito");
    expect(delta[0].attributes?.bold).toBe(true);
    const italicOp = delta.find((o) => o.insert === "itálico");
    expect(italicOp?.attributes?.italic).toBe(true);
  });

  it("text-decoration:underline em span vira underline", () => {
    const html = `<p><span style="text-decoration:underline">sublinhado</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.underline).toBe(true);
  });
});

describe("htmlToSlice — Word: <b>/<i>/<u> por tag", () => {
  it("tags b/i/u simples viram bold/italic/underline", () => {
    const html = `<p class=MsoNormal><b>negrito</b> <i>itálico</i> <u>sublinhado</u></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    const bold = delta.find((o) => o.insert === "negrito");
    const italic = delta.find((o) => o.insert === "itálico");
    const underline = delta.find((o) => o.insert === "sublinhado");
    expect(bold?.attributes?.bold).toBe(true);
    expect(italic?.attributes?.italic).toBe(true);
    expect(underline?.attributes?.underline).toBe(true);
  });

  it("tachado por <strike> e <del>", () => {
    const html = `<p><strike>a</strike><del>b</del></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    expect(delta.every((o) => o.attributes?.strike)).toBe(true);
  });
});

describe("htmlToSlice — font-weight:normal dentro de <b> cancela", () => {
  it("um <b> com filho font-weight:normal explícito não herda negrito no filho", () => {
    const html = `<p><b>negrito <span style="font-weight:normal">não negrito</span> negrito de novo</b></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    const first = delta.find((o) => (o.insert as string).includes("negrito "));
    const middle = delta.find((o) => o.insert === "não negrito");
    const last = delta.find((o) => (o.insert as string).includes("negrito de novo"));
    expect(first?.attributes?.bold).toBe(true);
    expect(middle?.attributes?.bold).toBeUndefined();
    expect(last?.attributes?.bold).toBe(true);
  });

  it("um <b> aninhado dentro de outro <b> continua negrito (não é problema)", () => {
    const html = `<p><b>fora <b>dentro</b> fora de novo</b></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    expect(delta.every((o) => o.attributes?.bold)).toBe(true);
  });
});

describe("htmlToSlice — Word: mso-list vira listItem com nível certo, sem o marcador no texto", () => {
  it("parágrafo com mso-list:l0 level1 vira listItem nível 0, sem o número no texto", () => {
    const html =
      `<p class=MsoListParagraphCxSpFirst style='margin-left:36.0pt;mso-list:l0 level1 lfo1'>` +
      `<span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span>` +
      `Primeiro item<o:p></o:p></p>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    const block = slice!.blocks[0];
    expect(block.type).toBe("listItem");
    expect(block.attrs.listLevel).toBe(0);
    expect(block.text).toBe("Primeiro item");
    expect(block.text).not.toMatch(/^\s*1\./);
  });

  it("mso-list level3 vira listLevel 2 (level é 1-based no Word)", () => {
    const html =
      `<p style='mso-list:l1 level3 lfo2'>` +
      `<span style='mso-list:Ignore'>o<span style='font-family:Symbol'>&nbsp;</span></span>` +
      `item aninhado</p>`;
    const slice = htmlToSlice(html);
    const block = slice!.blocks[0];
    expect(block.attrs.listLevel).toBe(2);
  });
});

describe("htmlToSlice — Word: mso-list nível pela indentação (margin-left), não só por levelN", () => {
  // Dado real capturado do clipboard de um documento Word: um <li> pai
  // (mso-list:l0 level1) seguido de quatro <p> irmãos (mso-list:l1 level1,
  // margin-left:72.0pt) — duas listas mso-list DIFERENTES (l0/lfo1 e
  // l1/lfo2), ambas "level1". O Word representa a profundidade dos filhos
  // só pela margem, não pelo levelN. Sem considerar a margem, os quatro
  // filhos caem em listLevel 0 igual ao pai (bug real).
  it("caso real: <li> pai (level1, sem margem) + 4 <p> filhos (level1, margin-left:72pt) → pai nível 0, filhos nível 1", () => {
    const filho = (texto: string) =>
      `<p class=MsoNormal style='margin-top:0cm;margin-right:0cm;margin-bottom:0cm;` +
      `margin-left:72.0pt;text-align:justify;text-indent:-18.0pt;line-height:150%;` +
      `mso-list:l1 level1 lfo2'>` +
      `<span style='mso-list:Ignore'>●<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;</span></span>` +
      `${texto}</p>`;
    const html =
      `<li class=MsoNormal style='color:#2F222A;margin-top:12.0pt;margin-bottom:0cm;` +
      `text-align:justify;line-height:150%;mso-list:l0 level1 lfo1'>Item pai</li>` +
      filho("Sub-item 1") +
      filho("Sub-item 2") +
      filho("Sub-item 3") +
      filho("Sub-item 4");
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    expect(slice!.blocks).toHaveLength(5);

    const [pai, ...filhos] = slice!.blocks;
    expect(pai.type).toBe("listItem");
    expect(pai.attrs.listLevel).toBe(0);
    expect(pai.text).toBe("Item pai");

    expect(filhos).toHaveLength(4);
    filhos.forEach((f, i) => {
      expect(f.type).toBe("listItem");
      expect(f.attrs.listLevel).toBe(1);
      expect(f.attrs.listKind).toBe("bullet");
      expect(f.text).toBe(`Sub-item ${i + 1}`);
      expect(f.text).not.toContain("●");
    });
  });

  it("não-regressão: mso-list:l0 level1 sem margin-left continua nível 0", () => {
    const html = `<p style='mso-list:l0 level1 lfo1'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBe(0);
  });

  it("não-regressão: mso-list:l0 level2 sem margin-left continua nível 1", () => {
    const html = `<p style='mso-list:l0 level2 lfo1'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBe(1);
  });

  it("margin-left em cm (2.54cm ≈ 72pt) dá o mesmo nível que 72.0pt", () => {
    const htmlPt = `<p style='margin-left:72.0pt;mso-list:l1 level1 lfo2'>item</p>`;
    const htmlCm = `<p style='margin-left:2.54cm;mso-list:l1 level1 lfo2'>item</p>`;
    const sliceCm = htmlToSlice(htmlCm);
    const slicePt = htmlToSlice(htmlPt);
    expect(sliceCm!.blocks[0].attrs.listLevel).toBe(slicePt!.blocks[0].attrs.listLevel);
    expect(sliceCm!.blocks[0].attrs.listLevel).toBe(1);
  });

  it("margin-left:36.0pt dá nível 0 (primeiro nível, não o segundo)", () => {
    const html = `<p style='margin-left:36.0pt;mso-list:l0 level1 lfo1'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBe(0);
  });

  it("margin-left:108.0pt dá nível 2", () => {
    const html = `<p style='margin-left:108.0pt;mso-list:l0 level1 lfo1'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBe(2);
  });

  it("text-indent:-18.0pt sozinho, sem margin-left, não cria nível", () => {
    const html = `<p style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBe(0);
  });

  it("margin-left ausente ou 'auto' → nível vem só do levelN", () => {
    const htmlAusente = `<p style='mso-list:l1 level3 lfo2'>item</p>`;
    const htmlAuto = `<p style='margin-left:auto;mso-list:l1 level3 lfo2'>item</p>`;
    const sliceAusente = htmlToSlice(htmlAusente);
    const sliceAuto = htmlToSlice(htmlAuto);
    expect(sliceAusente!.blocks[0].attrs.listLevel).toBe(2);
    expect(sliceAuto!.blocks[0].attrs.listLevel).toBe(2);
  });

  it("levelN alto com margem pequena continua vencendo (max funciona nos dois sentidos)", () => {
    const html = `<p style='margin-left:5.0pt;mso-list:l1 level3 lfo2'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBe(2);
  });

  it("nível acima do teto (MAX_LIST_LEVEL) é limitado, não estoura", () => {
    const html = `<p style='margin-left:999.0pt;mso-list:l0 level1 lfo1'>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listLevel).toBeLessThanOrEqual(5);
    expect(slice!.blocks[0].attrs.listLevel).toBe(5);
  });
});

describe("htmlToSlice — Word: marcador numérico vs símbolo", () => {
  it("marcador '1.' vira ordered", () => {
    const html =
      `<p style='mso-list:l0 level1 lfo1'>` +
      `<span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listKind).toBe("ordered");
  });

  it("marcador 'a)' vira ordered", () => {
    const html =
      `<p style='mso-list:l0 level1 lfo1'>` +
      `<span style='mso-list:Ignore'>a)<span>&nbsp;&nbsp;</span></span>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listKind).toBe("ordered");
  });

  it("marcador símbolo (font-family Symbol, glifo '·') vira bullet", () => {
    const html =
      `<p style='mso-list:l0 level1 lfo1'>` +
      `<span style='mso-list:Ignore'><span style='font-family:Symbol'>&#183;</span>` +
      `<span style='font:7.0pt "Times New Roman"'>&nbsp;</span></span>item</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.listKind).toBe("bullet");
  });
});

describe("htmlToSlice — Docs: <ul>/<ol> aninhado, nível pela profundidade", () => {
  it("ul simples vira listItem nível 0, kind bullet", () => {
    const html = `<ul><li>um</li><li>dois</li></ul>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks).toHaveLength(2);
    for (const b of slice!.blocks) {
      expect(b.type).toBe("listItem");
      expect(b.attrs.listKind).toBe("bullet");
      expect(b.attrs.listLevel).toBe(0);
    }
  });

  it("ol aninhado dentro de li de ul sobe o nível corretamente", () => {
    const html =
      `<ul><li>nível 0` +
      `<ol><li>nível 1</li><li>nível 1 também` +
      `<ul><li>nível 2</li></ul>` +
      `</li></ol>` +
      `</li></ul>`;
    const slice = htmlToSlice(html);
    const levels = slice!.blocks.map((b) => b.attrs.listLevel);
    const kinds = slice!.blocks.map((b) => b.attrs.listKind);
    expect(levels).toEqual([0, 1, 1, 2]);
    expect(kinds).toEqual(["bullet", "ordered", "ordered", "bullet"]);
  });
});

describe("htmlToSlice — Docs: <ul> aninhado como IRMÃO de <li> (forma real do Google Docs)", () => {
  it("defeito A: <ul><li>A1</li><ul><li>A2</li></ul></ul> não perde A2", () => {
    const html = `<ul><li>A1</li><ul><li>A2</li></ul></ul>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    const texts = slice!.blocks.map((b) => b.text);
    expect(texts).toEqual(["A1", "A2"]);
    expect(slice!.blocks[0].attrs.listLevel).toBe(0);
    expect(slice!.blocks[1].attrs.listLevel).toBe(1);
    for (const b of slice!.blocks) expect(b.type).toBe("listItem");
  });

  it("defeito B: <ul><li>B1<ul><li>B2</li></ul></li></ul> (forma canônica) não duplica/corrompe B1", () => {
    const html = `<ul><li>B1<ul><li>B2</li></ul></li></ul>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    const texts = slice!.blocks.map((b) => b.text);
    expect(texts).toEqual(["B1", "B2"]);
    expect(slice!.blocks[0].attrs.listLevel).toBe(0);
    expect(slice!.blocks[1].attrs.listLevel).toBe(1);
  });

  it("formas misturadas (irmã e canônica) no mesmo HTML", () => {
    const html =
      `<ul>` +
      `<li>A1</li><ul><li>A2</li></ul>` +
      `<li>B1<ul><li>B2</li></ul></li>` +
      `</ul>`;
    const slice = htmlToSlice(html);
    const texts = slice!.blocks.map((b) => b.text);
    const levels = slice!.blocks.map((b) => b.attrs.listLevel);
    expect(texts).toEqual(["A1", "A2", "B1", "B2"]);
    expect(levels).toEqual([0, 1, 0, 1]);
  });

  it("três níveis de profundidade, misturando forma irmã e canônica", () => {
    const html =
      `<ul><li>N0` +
      `<ul><li>N1</li>` +
      `<ul><li>N2</li></ul>` +
      `</ul>` +
      `</li></ul>`;
    const slice = htmlToSlice(html);
    const texts = slice!.blocks.map((b) => b.text);
    const levels = slice!.blocks.map((b) => b.attrs.listLevel);
    expect(texts).toEqual(["N0", "N1", "N2"]);
    expect(levels).toEqual([0, 1, 2]);
  });

  it("<ol> dentro de <ul> (irmão de li): listKind segue a lista mais próxima, não a raiz", () => {
    const html = `<ul><li>bullet</li><ol><li>ordered</li></ol></ul>`;
    const slice = htmlToSlice(html);
    const kinds = slice!.blocks.map((b) => b.attrs.listKind);
    expect(kinds).toEqual(["bullet", "ordered"]);
  });

  it("<p> dentro de <li> (forma do Docs) continua funcionando — não regride", () => {
    const html = `<ul><li><p>parágrafo dentro do item</p></li></ul>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks).toHaveLength(1);
    expect(slice!.blocks[0].type).toBe("listItem");
    expect(slice!.blocks[0].text).toBe("parágrafo dentro do item");
  });

  it("outro container (<div>) dentro de <li> envolvendo a lista aninhada não vaza o texto do filho pro pai", () => {
    const html = `<ul><li><div>B1<ul><li>B2</li></ul></div></li></ul>`;
    const slice = htmlToSlice(html);
    const texts = slice!.blocks.map((b) => b.text);
    const levels = slice!.blocks.map((b) => b.attrs.listLevel);
    expect(texts).toEqual(["B1", "B2"]);
    expect(levels).toEqual([0, 1]);
  });

  it("<li> fora de <ul>/<ol> (caminho defensivo) também exclui a lista aninhada do texto do pai", () => {
    const html = `<li>X<ul><li>Y</li></ul></li>`;
    const slice = htmlToSlice(html);
    const texts = slice!.blocks.map((b) => b.text);
    const levels = slice!.blocks.map((b) => b.attrs.listLevel);
    expect(texts).toEqual(["X", "Y"]);
    expect(levels).toEqual([0, 1]);
  });

  it("tabela dentro de <li> não faz a lista da célula vazar pra fora da tabela (limitação preexistente, não piora)", () => {
    const html =
      `<ul><li>text<table><tr><td><ul><li>inner</li></ul></td></tr></table></li></ul>`;
    const slice = htmlToSlice(html);
    // Tabela dentro de item de lista não é suportada (handleTable não é
    // chamado neste caminho) — o texto sobrevive todo, só a estrutura de
    // tabela/lista interna se perde, igual já acontecia antes desta rodada.
    expect(slice!.blocks).toHaveLength(1);
    expect(slice!.blocks[0].text).toBe("textinner");
  });
});

describe("htmlToSlice — headings, blockquote, link", () => {
  it("h1..h6 viram heading com o level certo", () => {
    for (let i = 1; i <= 6; i++) {
      const html = `<h${i}>Título ${i}</h${i}>`;
      const slice = htmlToSlice(html);
      expect(slice!.blocks[0].type).toBe("heading");
      expect(slice!.blocks[0].attrs.level).toBe(i);
      expect(slice!.blocks[0].text).toBe(`Título ${i}`);
    }
  });

  it("blockquote vira bloco blockquote", () => {
    const html = `<blockquote>uma citação</blockquote>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].type).toBe("blockquote");
    expect(slice!.blocks[0].text).toBe("uma citação");
  });

  it("link vira mark link com href", () => {
    const html = `<p>veja <a href="https://alefperetz.org.br">o portal</a> aqui</p>`;
    const slice = htmlToSlice(html);
    const linkOp = slice!.blocks[0].delta.find((o) => o.insert === "o portal");
    expect(linkOp?.attributes?.link).toEqual({ href: "https://alefperetz.org.br" });
  });
});

describe("htmlToSlice — C1: blockLevel só quando o bloco único NÃO é parágrafo", () => {
  // As três formas reais que o clipboard emite ao copiar um trecho curto
  // (duas palavras) de cada origem — sem <p>/<div> em volta na maioria dos
  // casos, só nós inline soltos que `flushLoose` junta num único parágrafo.
  it("site/Chrome: span solto com meta charset na frente não marca blockLevel", () => {
    const html = `<meta charset='utf-8'><span style="color:#000">duas palavras</span>`;
    const slice = htmlToSlice(html)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].type).toBe("paragraph");
    expect(slice.blocks[0].text).toBe("duas palavras");
    expect(slice.blockLevel).toBeFalsy();
  });

  it("Word: <div class=WordSection1><p class=MsoNormal><span>...</span></p></div> não marca blockLevel", () => {
    const html = `<div class=WordSection1><p class=MsoNormal><span>duas palavras</span></p></div>`;
    const slice = htmlToSlice(html)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].type).toBe("paragraph");
    expect(slice.blockLevel).toBeFalsy();
  });

  it("Google Docs: wrapper <b style='font-weight:normal' id=docs-internal-guid-...> não marca blockLevel", () => {
    const html = `<b style="font-weight:normal" id="docs-internal-guid-abc123"><span>duas palavras</span></b>`;
    const slice = htmlToSlice(html)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].type).toBe("paragraph");
    expect(slice.blockLevel).toBeFalsy();
  });

  it("via insertSlice: colar no MEIO de um parágrafo resulta em UM bloco só (não três)", () => {
    const h = harness();
    insertText(h.ctx, "Antes  depois");
    // "Antes " tem 6 chars — caret entre "Antes " e " depois".
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 6 }));
    const slice = htmlToSlice(`<span>duas palavras</span>`)!;
    expect(slice.blockLevel).toBeFalsy();
    insertSlice(h.ctx, slice);
    expect(h.doc.blockCount()).toBe(1);
    expect(h.doc.getBlockText(0)!.toString()).toBe("Antes duas palavras depois");
  });

  it("via insertSlice: colar no INÍCIO de um <h1> não rebaixa o título a paragraph", () => {
    const h = harness();
    insertText(h.ctx, "Título");
    setBlockType(h.ctx, "heading", { level: 1 });
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    const slice = htmlToSlice(`<span>duas palavras</span>`)!;
    insertSlice(h.ctx, slice);
    expect(h.doc.getBlockType(0)).toBe("heading");
    expect(h.doc.getBlockText(0)!.toString()).toBe("duas palavrasTítulo");
  });

  it("não-regressão: <h1> sozinho continua adotando o tipo (blockLevel true)", () => {
    const slice = htmlToSlice(`<h1>Título</h1>`)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blockLevel).toBe(true);
  });

  it("não-regressão: <li> sozinho continua adotando o tipo (blockLevel true)", () => {
    const slice = htmlToSlice(`<ul><li>item</li></ul>`)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].type).toBe("listItem");
    expect(slice.blockLevel).toBe(true);
  });

  it("não-regressão: <blockquote> sozinho continua adotando o tipo (blockLevel true)", () => {
    const slice = htmlToSlice(`<blockquote>citação</blockquote>`)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blockLevel).toBe(true);
  });
});

describe("htmlToSlice — alinhamento", () => {
  it("text-align no style de um parágrafo vira attrs.align", () => {
    const html = `<p style="text-align:center">centralizado</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.align).toBe("center");
  });

  it("text-align funciona também em heading", () => {
    const html = `<h2 style="text-align:right">título à direita</h2>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.align).toBe("right");
  });

  it("justify e start/end mapeiam para justify/left/right", () => {
    expect(htmlToSlice(`<p style="text-align:justify">x</p>`)!.blocks[0].attrs.align).toBe("justify");
    expect(htmlToSlice(`<p style="text-align:start">x</p>`)!.blocks[0].attrs.align).toBe("left");
    expect(htmlToSlice(`<p style="text-align:end">x</p>`)!.blocks[0].attrs.align).toBe("right");
  });

  it("sem text-align, attrs.align fica ausente", () => {
    const html = `<p>sem alinhamento</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].attrs.align).toBeUndefined();
  });
});

describe("htmlToSlice — text-decoration acumula e 'none' cancela (armadilha #4)", () => {
  it("text-decoration:underline line-through liga os dois", () => {
    const html = `<p><span style="text-decoration:underline line-through">x</span></p>`;
    const slice = htmlToSlice(html);
    const attrs = slice!.blocks[0].delta[0].attributes;
    expect(attrs?.underline).toBe(true);
    expect(attrs?.strike).toBe(true);
  });

  it("<u style='text-decoration:none'> cancela o sublinhado que a própria tag ligaria", () => {
    const html = `<p><u style="text-decoration:none">sem sublinhado</u></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.underline).toBeUndefined();
  });

  it("text-decoration:none dentro de um ancestral sublinhado cancela para o descendente", () => {
    const html = `<p><u>fora<span style="text-decoration:none">dentro sem sublinhado</span></u></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    const fora = delta.find((o) => o.insert === "fora");
    const dentro = delta.find((o) => o.insert === "dentro sem sublinhado");
    expect(fora?.attributes?.underline).toBe(true);
    expect(dentro?.attributes?.underline).toBeUndefined();
  });
});

describe("htmlToSlice — documento completo do Word (com <style> no <head>)", () => {
  it("o <style> do <head> nunca vaza como texto — só o conteúdo do <body> sobrevive", () => {
    const html =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">` +
      `<head><meta charset="utf-8"><title>Documento</title>` +
      `<style>p.MsoNormal{margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;} span.hyperlink{color:blue;}</style>` +
      `</head>` +
      `<body lang=PT-BR style='tab-interval:36.0pt'>` +
      `<p class=MsoNormal>Conteúdo real do documento.</p>` +
      `</body></html>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    expect(slice!.blocks).toHaveLength(1);
    expect(slice!.blocks[0].text).toBe("Conteúdo real do documento.");
  });
});

describe("htmlToSlice — cor e marca-texto", () => {
  it("cor preta (#000000, #000, rgb(0,0,0), black) é descartada", () => {
    const variants = ["#000000", "#000", "rgb(0, 0, 0)", "black"];
    for (const v of variants) {
      const html = `<p><span style="color:${v}">texto</span></p>`;
      const slice = htmlToSlice(html);
      expect(slice!.blocks[0].delta[0].attributes?.color).toBeUndefined();
    }
  });

  it("cor não-preta é mantida", () => {
    const html = `<p><span style="color:#ff0000">texto vermelho</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.color).toBe("#ff0000");
  });

  it("background colorido vira highlight", () => {
    const html = `<p><span style="background-color:#fff176">marcado</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.highlight).toBe("#fff176");
  });

  it("background branco/transparente não vira highlight", () => {
    for (const v of ["#ffffff", "white", "transparent", "none"]) {
      const html = `<p><span style="background-color:${v}">texto</span></p>`;
      const slice = htmlToSlice(html);
      expect(slice!.blocks[0].delta[0].attributes?.highlight).toBeUndefined();
    }
  });
});

describe("htmlToSlice — fontFamily sempre descartada; fontSize preservado quando resolvível", () => {
  it("font-family no style nunca vira marca; font-size em pt vira marca fontSize", () => {
    const html =
      `<p><span style="font-family:'Times New Roman';font-size:14pt;color:#ff0000">texto</span></p>`;
    const slice = htmlToSlice(html);
    const attrs = slice!.blocks[0].delta[0].attributes;
    expect(attrs?.fontFamily).toBeUndefined();
    expect(attrs?.fontSize).toBe("14pt");
    expect(attrs?.color).toBe("#ff0000"); // outras marcas do mesmo span continuam.
  });

  it("<font face=... size=...> não introduz fontFamily/fontSize (atributo HTML legado, não style)", () => {
    const html = `<p><font face="Arial" size="4">texto</font></p>`;
    const slice = htmlToSlice(html);
    const attrs = slice!.blocks[0].delta[0]?.attributes;
    expect(attrs?.fontFamily).toBeUndefined();
    expect(attrs?.fontSize).toBeUndefined();
  });

  it("caso real: título do Google Docs — span de 37.5pt em negrito dentro do wrapper docs-internal-guid", () => {
    // HTML real copiado de um título colado do Google Docs: não é <h1>, é um
    // <span> de 37.5pt em negrito, sem nenhum elemento de bloco/heading.
    const html =
      `<b style="font-weight:normal" id="docs-internal-guid-7acd8e83-abcd">` +
      `<span style="font-size:37.5pt;font-family:'Times New Roman',serif;color:#000000;` +
      `background-color:transparent;font-weight:700;font-style:normal;` +
      `text-decoration:none;vertical-align:baseline;white-space:pre-wrap;">Artigo Engenharia</span>` +
      `</b>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    expect(slice!.blocks).toHaveLength(1);
    const block = slice!.blocks[0];
    expect(block.text).toBe("Artigo Engenharia");
    const attrs = block.delta[0].attributes;
    expect(attrs?.fontSize).toBe("37.5pt");
    expect(attrs?.bold).toBe(true);
    expect(attrs?.fontFamily).toBeUndefined();
  });

  it("font-size:11pt simples vira fontSize '11pt'", () => {
    const html = `<p><span style="font-size:11pt">texto</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.fontSize).toBe("11pt");
  });

  it("font-size:16px converte para pt (×0.75) → '12pt'", () => {
    const html = `<p><span style="font-size:16px">texto</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.fontSize).toBe("12pt");
  });

  it("font-size:1in converte para pt (×72) → '72pt'", () => {
    const html = `<p><span style="font-size:1in">texto</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.fontSize).toBe("72pt");
  });

  it("unidades relativas ao contexto de herança (em/%/larger) não emitem fontSize — sem heurística de adivinhação", () => {
    for (const size of ["1.5em", "120%", "larger", "smaller", "medium"]) {
      const html = `<p><span style="font-size:${size}">texto</span></p>`;
      const slice = htmlToSlice(html);
      expect(slice!.blocks[0].delta[0].attributes?.fontSize).toBeUndefined();
    }
  });

  it("valores absurdos (<=0 ou >200pt) não emitem fontSize — defesa contra CSS malformado", () => {
    for (const size of ["0pt", "0px", "-5pt", "500pt", "0.04pt"]) {
      const html = `<p><span style="font-size:${size}">texto</span></p>`;
      const slice = htmlToSlice(html);
      expect(slice!.blocks[0].delta[0].attributes?.fontSize).toBeUndefined();
    }
  });

  it("herança: tamanho no ancestral vale no descendente; descendente com tamanho próprio sobrescreve", () => {
    const html =
      `<p><span style="font-size:18pt">herdado<span style="font-size:24pt">próprio</span></span></p>`;
    const slice = htmlToSlice(html);
    const delta = slice!.blocks[0].delta;
    const herdado = delta.find((o) => o.insert === "herdado");
    const proprio = delta.find((o) => o.insert === "próprio");
    expect(herdado?.attributes?.fontSize).toBe("18pt");
    expect(proprio?.attributes?.fontSize).toBe("24pt");
  });

  it("Word: <span style='font-size:14.0pt'> vira '14pt' (sem zero à toa)", () => {
    const html = `<p><span style='font-size:14.0pt'>texto</span></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].delta[0].attributes?.fontSize).toBe("14pt");
  });

  it("não-regressão: fontFamily continua fora mesmo quando fontSize é emitido", () => {
    const variants = [
      `<p><span style="font-family:Arial;font-size:11pt">a</span></p>`,
      `<p><span style="font-size:37.5pt;font-family:'Times New Roman'">b</span></p>`,
      `<p><span style="font-size:1.5em;font-family:Calibri">c</span></p>`,
    ];
    for (const html of variants) {
      const slice = htmlToSlice(html);
      expect(slice!.blocks[0].delta[0].attributes?.fontFamily).toBeUndefined();
    }
  });
});

describe("htmlToSlice — tabela", () => {
  it("texto das células sobrevive como parágrafos, em ordem de leitura, nada é perdido", () => {
    const html =
      `<table><tbody>` +
      `<tr><td>A1</td><td>B1</td></tr>` +
      `<tr><td>A2</td><td>B2</td></tr>` +
      `</tbody></table>`;
    const slice = htmlToSlice(html);
    expect(slice).not.toBeNull();
    const texts = slice!.blocks.map((b) => b.text);
    expect(texts).toEqual(["A1", "B1", "A2", "B2"]);
    for (const b of slice!.blocks) expect(b.type).toBe("paragraph");
  });

  it("célula com múltiplos <p> internos vira múltiplos parágrafos, com marcas preservadas", () => {
    const html =
      `<table><tr><td><p><b>negrito</b></p><p>normal</p></td></tr></table>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks).toHaveLength(2);
    expect(slice!.blocks[0].delta[0].attributes?.bold).toBe(true);
    expect(slice!.blocks[1].text).toBe("normal");
  });
});

describe("htmlToSlice — <img>, <style>/<script>/<o:p>, &nbsp;", () => {
  it("<img> é ignorado sem quebrar o texto ao redor", () => {
    const html = `<p>antes <img src="data:image/png;base64,xyz"> depois</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].text).toBe("antes depois");
  });

  it("<style>/<script> dentro do body (Docs) não viram texto", () => {
    const html =
      `<style type="text/css">.c0{font-weight:700}</style>` +
      `<script>alert(1)</script>` +
      `<p>conteúdo real</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks).toHaveLength(1);
    expect(slice!.blocks[0].text).toBe("conteúdo real");
  });

  it("<o:p> não vira texto", () => {
    const html = `<p>texto real<o:p>&nbsp;</o:p></p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].text).toBe("texto real");
  });

  it("&nbsp; vira espaço normal", () => {
    const html = `<p>uma&nbsp;palavra</p>`;
    const slice = htmlToSlice(html);
    expect(slice!.blocks[0].text).toBe("uma palavra");
  });
});

describe("htmlToSlice — vazio / sem conteúdo aproveitável", () => {
  it("string vazia retorna null", () => {
    expect(htmlToSlice("")).toBeNull();
  });

  it("HTML só com espaço em branco retorna null", () => {
    expect(htmlToSlice("   \n\t  ")).toBeNull();
  });

  it("HTML sem nada aproveitável (só meta/style, sem texto nem lista) retorna null", () => {
    const html = `<meta charset="utf-8"><style>.c0{color:red}</style>`;
    expect(htmlToSlice(html)).toBeNull();
  });

  it("HTML com apenas uma imagem solta (sem texto) retorna null", () => {
    const html = `<img src="data:image/png;base64,xyz">`;
    expect(htmlToSlice(html)).toBeNull();
  });
});

describe("htmlToSlice — openStart/openEnd", () => {
  it("são sempre false — conteúdo externo é bloco inteiro, não fragmento", () => {
    const slice = htmlToSlice("<p>qualquer coisa</p>");
    expect(slice!.openStart).toBe(false);
    expect(slice!.openEnd).toBe(false);
  });
});
