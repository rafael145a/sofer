// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { locatePoint, textOffsetWithin, getCellElement } from "../dom-bridge";

/**
 * `.ed-root` com uma tabela de 1 célula renderizada como lista de 2 itens.
 *
 * Sem quebra de linha/indentação entre as tags: um `innerHTML` multi-linha
 * insere text nodes de espaço em branco entre `<td>` e `<ul>` (regra normal
 * de parsing HTML), e a aritmética de offset soma QUALQUER text node dentro
 * do container — inclusive esses. O React nunca produz esse whitespace (JSX
 * com filhos só-elemento não emite texto de indentação), e o resto deste
 * arquivo de teste em `dom-bridge.test.ts` já segue essa convenção de HTML
 * numa linha só; mantido aqui pelo mesmo motivo.
 */
function montarRoot(): HTMLElement {
  const root = document.createElement("div");
  root.className = "ed-root";
  root.innerHTML =
    `<table class="ed-block ed-table" data-block-index="0" data-block-type="table">` +
    `<tbody><tr data-cell-row="0">` +
    `<td class="ed-cell" data-cell-index="0" data-cell-row="0" data-cell-col="0">` +
    `<ul class="ed-list ed-list-bullet"><li class="ed-listitem" data-cell-line="0">um</li><li class="ed-listitem" data-cell-line="1">dois</li></ul>` +
    `</td>` +
    `</tr></tbody>` +
    `</table>`;
  document.body.appendChild(root);
  return root;
}

describe("dom-bridge — offset em célula-lista", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    root = montarRoot();
  });

  // modelo -> DOM
  it.each([
    [0, "um", 0],
    [1, "um", 1],
    [2, "um", 2],
    [3, "dois", 0],
    [4, "dois", 1],
    [7, "dois", 4],
  ])("locatePoint: offset %i cai em %s@%i", (offset, texto, dentro) => {
    const p = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset });
    expect(p).not.toBeNull();
    expect(p!.node.textContent).toBe(texto);
    expect(p!.offset).toBe(dentro);
  });

  // DOM -> modelo
  it.each([
    ["um", 0, 0],
    ["um", 2, 2],
    ["dois", 0, 3],
    ["dois", 4, 7],
  ])("textOffsetWithin: %s@%i vira offset %i", (texto, dentro, esperado) => {
    const cell = getCellElement(root, 0, 0)!;
    const li = [...cell.querySelectorAll("li")].find((l) => l.textContent === texto)!;
    expect(textOffsetWithin(cell, li.firstChild!, dentro)).toBe(esperado);
  });

  it("ida e volta é identidade para todo offset do modelo", () => {
    const cell = getCellElement(root, 0, 0)!;
    for (let o = 0; o <= 7; o++) {
      const p = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: o });
      expect(p, `offset ${o} não localizou`).not.toBeNull();
      expect(textOffsetWithin(cell, p!.node, p!.offset), `offset ${o}`).toBe(o);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariante "número de linhas === número de \n + 1" — casos de borda.
//
// splitDeltaByLines (Task 4, ainda não existe neste pacote) é quem vai decidir
// quantos <li> uma célula produz a partir do seu Y.Text. Os quatro casos
// abaixo são exatamente os que corrompem o mapeamento de cursor se essa
// contagem, ou a aritmética de fronteira em locatePoint/textOffsetWithin,
// tiver um off-by-one: \n no começo, \n no fim, célula com só um \n, e um \n
// que cai na fronteira entre duas ops de delta (a concatenação ainda produz
// um único \n — o DOM final é indistinguível de uma string simples).
//
// Uma linha vazia é renderizada como `<li ...><br data-empty="true"></li>` —
// não como um <li> vazio nem como um text node vazio. Esse é o padrão já
// usado pelo renderer para conteúdo totalmente vazio (renderInline.tsx:28 e
// :85, `if (...) return <br data-empty="true" />`), e é o formato real que a
// Task 4 vai emitir para uma linha vazia dentro de uma lista. Testar com um
// <li></li> sem filhos, ou com um text node vazio, provaria a aritmética
// contra um DOM que o renderer nunca produz — ver task-3-report.md para a
// trilha completa de por que isso importa aqui.
// ---------------------------------------------------------------------------
describe("dom-bridge — invariante linhas === \\n + 1 (casos de borda)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Monta `.ed-root` com uma tabela de 1 célula cujo `<ul>` é passado pronto.
   * HTML numa linha só — ver comentário de `montarRoot` acima sobre por quê.
   */
  function montarComLista(ulInnerHtml: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "ed-root";
    root.innerHTML =
      `<table class="ed-block ed-table" data-block-index="0" data-block-type="table">` +
      `<tbody><tr data-cell-row="0">` +
      `<td class="ed-cell" data-cell-index="0" data-cell-row="0" data-cell-col="0">` +
      `<ul class="ed-list ed-list-bullet">${ulInnerHtml}</ul>` +
      `</td>` +
      `</tr></tbody>` +
      `</table>`;
    document.body.appendChild(root);
    return root;
  }

  /**
   * Prova a ida-e-volta de offset para todo offset válido de `texto`, e que
   * todo ponto de DOM devolvido é válido (offset não-negativo). A identidade
   * (`textOffsetWithin(locatePoint(o)) === o`) sozinha é cega a um offset de
   * DOM inválido quando a aritmética cancela por acidente — foi assim que o
   * `-1` produzido por um decremento incondicional na fronteira passou
   * despercebido por essa mesma checagem antes desta rodada de correção.
   */
  function verificaIdaEVolta(root: HTMLElement, texto: string): void {
    const cell = getCellElement(root, 0, 0)!;
    for (let o = 0; o <= texto.length; o++) {
      const p = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: o });
      expect(p, `offset ${o} não localizou`).not.toBeNull();
      expect(p!.offset, `offset ${o}: ponto de DOM com offset negativo`).toBeGreaterThanOrEqual(0);
      expect(textOffsetWithin(cell, p!.node, p!.offset), `offset ${o}`).toBe(o);
    }
  }

  /** `<li data-cell-line="i">` dentro da célula única da tabela montada. */
  function pegaLi(root: HTMLElement, i: number): HTMLElement {
    const cell = getCellElement(root, 0, 0)!;
    return cell.querySelector<HTMLElement>(`li[data-cell-line="${i}"]`)!;
  }

  it('"\\na" (\\n no começo) — 2 linhas === 1 \\n + 1', () => {
    const texto = "\na";
    const numLinhas = texto.split("\n").length;
    expect(numLinhas).toBe(texto.split("").filter((c) => c === "\n").length + 1);
    expect(numLinhas).toBe(2);

    // linha 0 = "" (vazia -> <br data-empty>), linha 1 = "a"
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0"><br data-empty="true" /></li>` +
        `<li class="ed-listitem" data-cell-line="1">a</li>`,
    );
    verificaIdaEVolta(root, texto);

    // Asserção absoluta (não só ida-e-volta): offset 0 é a guarda de entrada
    // disparando ao ENTRAR em li[1] com `remaining` já em 0 — resolve dentro
    // de li[0] (a linha vazia anterior), não em (ul, índice de li[1]).
    const li0 = pegaLi(root, 0);
    const p0 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 0 });
    expect(p0!.node).toBe(li0);
    expect(p0!.offset).toBe(0);
  });

  it('"a\\n" (\\n no fim) — 2 linhas === 1 \\n + 1', () => {
    const texto = "a\n";
    const numLinhas = texto.split("\n").length;
    expect(numLinhas).toBe(texto.split("").filter((c) => c === "\n").length + 1);
    expect(numLinhas).toBe(2);

    // linha 0 = "a", linha 1 = "" (vazia -> <br data-empty>)
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0">a</li>` +
        `<li class="ed-listitem" data-cell-line="1"><br data-empty="true" /></li>`,
    );
    verificaIdaEVolta(root, texto);

    // Asserção absoluta: offset 2 (fim da célula) é o fallback de SAÍDA —
    // o walk termina dentro de li[1] (a última linha, vazia) sem nada pra
    // absorver `remaining`. Resolve dentro do próprio li[1], não em
    // (ul, índice de li[1] + 1).
    const li1 = pegaLi(root, 1);
    const p2 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 2 });
    expect(p2!.node).toBe(li1);
    expect(p2!.offset).toBe(0);
  });

  it('"\\n" sozinho — 2 linhas === 1 \\n + 1', () => {
    const texto = "\n";
    const numLinhas = texto.split("\n").length;
    expect(numLinhas).toBe(texto.split("").filter((c) => c === "\n").length + 1);
    expect(numLinhas).toBe(2);

    // ambas as linhas vazias -> <br data-empty> nos dois <li>
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0"><br data-empty="true" /></li>` +
        `<li class="ed-listitem" data-cell-line="1"><br data-empty="true" /></li>`,
    );
    verificaIdaEVolta(root, texto);

    // Asserção absoluta nos dois offsets — exercitam os dois mecanismos:
    // offset 0 é a guarda de ENTRADA (entra em li[1] com remaining=0,
    // resolve dentro de li[0]); offset 1 é o fallback de SAÍDA (walk
    // termina dentro do próprio li[1], resolve nele mesmo).
    const li0 = pegaLi(root, 0);
    const li1 = pegaLi(root, 1);
    const p0 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 0 });
    expect(p0!.node).toBe(li0);
    expect(p0!.offset).toBe(0);
    const p1 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 1 });
    expect(p1!.node).toBe(li1);
    expect(p1!.offset).toBe(0);
  });

  it('[{insert:"a\\n"},{insert:"b"}] (\\n na fronteira entre duas ops) — 2 linhas === 1 \\n + 1', () => {
    // O delta nunca chega a este teste (splitDeltaByLines é da Task 4) — o
    // que importa aqui é o texto concatenado que ele produziria: "a\nb". O \n
    // cai exatamente na fronteira entre a primeira op ("a\n") e a segunda
    // ("b"), mas o DOM resultante é indistinguível de uma string simples com
    // um \n no meio: prova que a fronteira entre ops de delta não introduz
    // nenhum caractere extra nem nenhuma linha a mais.
    const delta = [{ insert: "a\n" }, { insert: "b" }];
    const texto = delta.map((op) => op.insert).join("");
    expect(texto).toBe("a\nb");
    const numLinhas = texto.split("\n").length;
    expect(numLinhas).toBe(texto.split("").filter((c) => c === "\n").length + 1);
    expect(numLinhas).toBe(2);

    // linha 0 = "a", linha 1 = "b" — nenhuma das duas é vazia.
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0">a</li>` +
        `<li class="ed-listitem" data-cell-line="1">b</li>`,
    );
    verificaIdaEVolta(root, texto);
  });
});

// ---------------------------------------------------------------------------
// Guarda de entrada + embed no fim da linha anterior (regressão da rodada 2).
//
// A guarda de entrada de `locatePoint` resolve `remaining === 0` ao ENTRAR
// num `<li>` de fronteira. A rodada 1 inferia o ponto pela TOPOLOGIA de
// irmãos do DOM (`previousElementSibling`, offset 0) — correto só quando a
// linha anterior é de fato vazia. Quando a linha anterior termina em
// `<img data-embed="image">` (ou no phantom span de wrap-float — mesmo
// ramo, `isImgEmbed(el) || isPhantomEmbed(el)`), o walk já consumiu o embed
// e chega na fronteira com `remaining === 0` sem a linha anterior estar
// vazia; a topologia de irmãos não distingue os dois casos. Nenhum teste do
// repo cruzava `data-embed` com `data-cell-line` antes desta rodada —
// `insertImage` (`packages/core/src/commands.ts`) lê `pos.cellIndex`
// explicitamente e a célula renderiza com o mesmo `renderInline` do
// parágrafo (`NodeView.tsx`), então imagem dentro de célula é alcançável
// hoje; fica latente só até a Task 4 emitir `data-cell-line`.
// ---------------------------------------------------------------------------
describe("dom-bridge — guarda de entrada quando a linha anterior termina em embed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Monta `.ed-root` com uma tabela de 1 célula cujo `<ul>` é passado pronto.
   * HTML numa linha só — ver comentário de `montarRoot` no topo do arquivo.
   */
  function montarComLista(ulInnerHtml: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "ed-root";
    root.innerHTML =
      `<table class="ed-block ed-table" data-block-index="0" data-block-type="table">` +
      `<tbody><tr data-cell-row="0">` +
      `<td class="ed-cell" data-cell-index="0" data-cell-row="0" data-cell-col="0">` +
      `<ul class="ed-list ed-list-bullet">${ulInnerHtml}</ul>` +
      `</td>` +
      `</tr></tbody>` +
      `</table>`;
    document.body.appendChild(root);
    return root;
  }

  /** `<li data-cell-line="i">` dentro da célula única da tabela montada. */
  function pegaLi(root: HTMLElement, i: number): HTMLElement {
    const cell = getCellElement(root, 0, 0)!;
    return cell.querySelector<HTMLElement>(`li[data-cell-line="${i}"]`)!;
  }

  /**
   * Como `verificaIdaEVolta` do bloco acima, mas por COMPRIMENTO do modelo
   * em vez de string literal — uma célula com embed não tem uma string cujo
   * `.length` bata com o tamanho do modelo (o embed conta 1 char sem ter
   * texto correspondente no DOM).
   */
  function verificaIdaEVoltaPorTamanho(root: HTMLElement, tamanhoModelo: number): void {
    const cell = getCellElement(root, 0, 0)!;
    for (let o = 0; o <= tamanhoModelo; o++) {
      const p = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: o });
      expect(p, `offset ${o} não localizou`).not.toBeNull();
      expect(p!.offset, `offset ${o}: ponto de DOM com offset negativo`).toBeGreaterThanOrEqual(0);
      expect(textOffsetWithin(cell, p!.node, p!.offset), `offset ${o}`).toBe(o);
    }
  }

  it('"ab⟦img⟧\\nc" — linha anterior termina em texto + imagem', () => {
    // modelo: 'a','b',img(1 char),'\n'(fronteira, não é char),'c' — tamanho 5
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0">ab<img data-embed="image" /></li>` +
        `<li class="ed-listitem" data-cell-line="1">c</li>`,
    );
    verificaIdaEVoltaPorTamanho(root, 5);

    // Asserção absoluta no offset exato onde a rodada 1 regrediu: offset 3
    // é "logo depois da imagem, antes do \n". A guarda de entrada dispara
    // ENTRANDO em li[1] com remaining=0 (o \n só decrementou; não é texto
    // real). Ponto certo: dentro de li[0], DEPOIS da imagem — não no
    // começo de li[0] (o bug da rodada 1 devolvia `(li[0], 0)`, que ida-e-
    // volta em 0, não 3).
    const cell = getCellElement(root, 0, 0)!;
    const li0 = pegaLi(root, 0);
    const p3 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 3 });
    expect(p3!.node).toBe(li0);
    expect(p3!.offset).toBe(2); // depois de "ab" (índice 0) e da <img> (índice 1)
    expect(textOffsetWithin(cell, p3!.node, p3!.offset)).toBe(3);
  });

  it('"⟦img⟧\\nc" — linha anterior é só uma imagem, sem texto nenhum', () => {
    // modelo: img(1 char),'\n'(fronteira),'c' — tamanho 2
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0"><img data-embed="image" /></li>` +
        `<li class="ed-listitem" data-cell-line="1">c</li>`,
    );
    verificaIdaEVoltaPorTamanho(root, 2);

    // Sem texto algum antes da imagem, `remaining` chega em 0 dentro do
    // PRÓPRIO li[0] ao processar a imagem (resolvido pela guarda de embed
    // já existente, não pela guarda de fronteira) — o offset 1 é quem
    // exercita a guarda de fronteira, entrando em li[1].
    const cell = getCellElement(root, 0, 0)!;
    const li0 = pegaLi(root, 0);
    const p1 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 1 });
    expect(p1!.node).toBe(li0);
    expect(p1!.offset).toBe(1); // depois da única imagem (índice 0)
    expect(textOffsetWithin(cell, p1!.node, p1!.offset)).toBe(1);
  });

  it('"a⟦phantom⟧\\nb" — mesmo ramo (isImgEmbed || isPhantomEmbed) via wrap-float phantom', () => {
    // O phantom span de wrap-float (`data-embed-phantom="true"`) passa pelo
    // MESMO branch que a imagem normal (`isImgEmbed(el) || isPhantomEmbed(el)`)
    // e seta o mesmo `lastImg`, então a mesma correção cobre os dois sem
    // código extra — este teste prova isso, não só assume.
    // modelo: 'a',phantom(1 char),'\n'(fronteira),'b' — tamanho 3
    const root = montarComLista(
      `<li class="ed-listitem" data-cell-line="0">a<span data-embed-phantom="true"></span></li>` +
        `<li class="ed-listitem" data-cell-line="1">b</li>`,
    );
    verificaIdaEVoltaPorTamanho(root, 3);

    const cell = getCellElement(root, 0, 0)!;
    const li0 = pegaLi(root, 0);
    const p2 = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: 2 });
    expect(p2!.node).toBe(li0);
    expect(p2!.offset).toBe(2); // depois de "a" (índice 0) e do phantom (índice 1)
    expect(textOffsetWithin(cell, p2!.node, p2!.offset)).toBe(2);
  });
});
