// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DeltaOp, SerializedBlock } from "@sofereditor/core";
import { htmlToSlice } from "../htmlToSlice";

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

describe("htmlToSlice — fontFamily/fontSize sempre descartados", () => {
  it("font-family e font-size no style nunca viram marca no delta", () => {
    const html =
      `<p><span style="font-family:'Times New Roman';font-size:14pt;color:#ff0000">texto</span></p>`;
    const slice = htmlToSlice(html);
    const attrs = slice!.blocks[0].delta[0].attributes;
    expect(attrs?.fontFamily).toBeUndefined();
    expect(attrs?.fontSize).toBeUndefined();
    expect(attrs?.color).toBe("#ff0000"); // outras marcas do mesmo span continuam.
  });

  it("<font face=... size=...> não introduz fontFamily/fontSize", () => {
    const html = `<p><font face="Arial" size="4">texto</font></p>`;
    const slice = htmlToSlice(html);
    const attrs = slice!.blocks[0].delta[0]?.attributes;
    expect(attrs?.fontFamily).toBeUndefined();
    expect(attrs?.fontSize).toBeUndefined();
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
