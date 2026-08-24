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

  /** Prova a ida-e-volta de offset para todo offset válido de `texto`. */
  function verificaIdaEVolta(root: HTMLElement, texto: string): void {
    const cell = getCellElement(root, 0, 0)!;
    for (let o = 0; o <= texto.length; o++) {
      const p = locatePoint(root, { blockIndex: 0, cellIndex: 0, offset: o });
      expect(p, `offset ${o} não localizou`).not.toBeNull();
      expect(textOffsetWithin(cell, p!.node, p!.offset), `offset ${o}`).toBe(o);
    }
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
