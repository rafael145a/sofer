# Listas dentro de célula de tabela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o botão de lista funcionar dentro de célula de tabela, consertando junto duas perdas silenciosas de dados que a investigação desenterrou (import de .docx descarta numeração em célula; célula multilinha exporta para DOCX como uma linha só).

**Architecture:** A célula continua sendo um `Y.Text` plano — nada de blocos dentro dela. `CellAttrs` ganha `listKind`, e quando ele está presente o `\n` deixa de ser quebra visual e passa a separar itens: o render emite `<ul>`/`<ol>` com um `<li>` por linha. O ponto de risco é o `dom-bridge`, porque os `\n` somem do texto do DOM e o mapeamento offset-modelo ↔ offset-DOM deixa de ser 1:1.

**Tech Stack:** TypeScript, Y.js, React, vitest, JSZip (fixtures .docx), biblioteca `docx` (export), Puppeteer (verificação).

**Spec:** `docs/superpowers/specs/2026-08-24-listas-em-tabela-design.md`

## Global Constraints

- **Nada de blocos dentro de célula.** A célula é e continua sendo um `Y.Text` plano.
- **Sem `listLevel` em `CellAttrs`.** Recuo por item está fora da v1; adicionar o campo sem suportar o comportamento convida a um uso que o modelo não sustenta.
- **`locatePoint` e `textOffsetWithin` são espelhos exatos.** Qualquer assimetria entre os dois é bug de cursor. Toda mudança num exige a mudança correspondente no outro, e teste nos dois sentidos.
- **Precedente a imitar, não reinventar:** embeds já consomem 1 caractere do modelo sem ter texto no DOM — `remaining -= 1` em `locatePoint`, `offset += 1` em `textOffsetWithin`.
- **`indentList`/`dedentList` mantêm a guarda de célula**, agora com comentário dizendo por quê.
- **Verificar clicando de verdade.** Disparar evento por script pula exatamente o caminho que quebra.
- **Comparar os três caminhos** — editor, PDF e DOCX — antes de declarar pronto.
- **Branch:** ramificar de `feat/verdana`, não de `main` (os dois trabalhos tocam `export-docx/src/docx.ts` e `export-pdf/src/html.ts`).

---

## Estrutura de arquivos

**Modificar (monorepo):**
- `packages/core/src/types.ts:111` — `CellAttrs` ganha `listKind`/`listStart`/`listStyle`
- `packages/core/src/marks.ts` — novo `splitDeltaByLines`, ao lado de `sliceDelta` (`:156`)
- `packages/core/src/commands.ts:733` — `toggleList` cell-aware; `:763`,`:784` ganham comentário
- `packages/react/src/NodeView.tsx:258` — render do `<td>`
- `packages/react/src/dom-bridge.ts:182,313` — mapeamento de offset
- `apps/playground/src/styles.css` — CSS de lista dentro de célula
- `packages/export-pdf/src/html.ts` — `renderCell` + CSS embutido
- `packages/export-docx/src/docx.ts` — `makeCell`
- `packages/import-docx/src/tables.ts` — `tableToBlock` + `cellChildrenToDelta`
- `packages/import-docx/src/docx.ts:47` — passa o `NumberingResolver` para `tableToBlock`

**Modificar (apps, repos separados — Task 9):**
- `portal2-next/src/components/ProvaEditor/sofer-editor.css`
- `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css`

---

## Task 1: Modelo e helper de linhas (core)

**Files:**
- Modify: `packages/core/src/types.ts:111`
- Modify: `packages/core/src/marks.ts`
- Test: `packages/core/src/__tests__/splitDeltaByLines.test.ts` (criar)

**Interfaces:**
- Consumes: `DeltaOp` (`types.ts:300`), `ListKind`/`ListStyleType` (`types.ts:17,19`).
- Produces: `splitDeltaByLines(delta: DeltaOp[]): DeltaOp[][]` — usado pelas Tasks 2, 5 e 6. E os campos novos de `CellAttrs`, usados por todas as tasks seguintes.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/core/src/__tests__/splitDeltaByLines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitDeltaByLines } from "../index";
import type { DeltaOp } from "../types";

describe("splitDeltaByLines", () => {
  it("delta sem \\n devolve uma linha só", () => {
    expect(splitDeltaByLines([{ insert: "um" }])).toEqual([[{ insert: "um" }]]);
  });

  it("separa em uma linha por \\n", () => {
    expect(splitDeltaByLines([{ insert: "um\ndois\ntres" }])).toEqual([
      [{ insert: "um" }],
      [{ insert: "dois" }],
      [{ insert: "tres" }],
    ]);
  });

  it("preserva as marcas de cada trecho", () => {
    const delta: DeltaOp[] = [
      { insert: "um\ndo", attributes: { bold: true } },
      { insert: "is", attributes: { italic: true } },
    ];
    expect(splitDeltaByLines(delta)).toEqual([
      [{ insert: "um", attributes: { bold: true } }],
      [
        { insert: "do", attributes: { bold: true } },
        { insert: "is", attributes: { italic: true } },
      ],
    ]);
  });

  it("linha vazia vira delta vazio, sem sumir", () => {
    expect(splitDeltaByLines([{ insert: "um\n\ndois" }])).toEqual([
      [{ insert: "um" }],
      [],
      [{ insert: "dois" }],
    ]);
  });

  it("delta vazio devolve uma linha vazia (nunca zero linhas)", () => {
    expect(splitDeltaByLines([])).toEqual([[]]);
  });

  it("embed fica na linha corrente e não vira separador", () => {
    const img = { insert: { type: "image", src: "x", width: 1, height: 1 } } as unknown as DeltaOp;
    expect(splitDeltaByLines([{ insert: "a\n" }, img, { insert: "b" }])).toEqual([
      [{ insert: "a" }],
      [img, { insert: "b" }],
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/core
npx vitest run src/__tests__/splitDeltaByLines.test.ts
```

Esperado: FAIL — `splitDeltaByLines` não é exportado.

- [ ] **Step 3: Implementar**

Acrescentar ao final de `packages/core/src/marks.ts`:

```ts
/**
 * Fatia um delta em uma lista por linha, quebrando nos `\n`.
 *
 * Usado pelo render de célula-lista: a célula é um `Y.Text` plano, e quando ela
 * carrega `listKind` cada linha vira um `<li>`. As marcas de cada trecho são
 * preservadas; embeds ficam na linha corrente e nunca separam.
 *
 * Devolve SEMPRE ao menos uma linha — delta vazio vira `[[]]`, não `[]`.
 * Linha vazia no meio (`"a\n\nb"`) é preservada como delta vazio, senão o
 * número de itens da lista não bateria com o número de `\n` do modelo, e o
 * mapeamento de cursor do `dom-bridge` sairia do lugar.
 */
export function splitDeltaByLines(delta: DeltaOp[]): DeltaOp[][] {
  const lines: DeltaOp[][] = [[]];
  for (const op of delta) {
    if (typeof op.insert !== "string") {
      lines[lines.length - 1].push(op);
      continue;
    }
    const parts = op.insert.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      const part = parts[i];
      if (part.length === 0) continue;
      lines[lines.length - 1].push(
        op.attributes ? { insert: part, attributes: op.attributes } : { insert: part },
      );
    }
  }
  return lines;
}
```

Em `packages/core/src/types.ts`, dentro de `interface CellAttrs` (linha 111), acrescentar antes do fechamento:

```ts
  /**
   * Quando presente, a célula renderiza como lista e cada linha separada por
   * `\n` vira um item. Ausente = texto normal com quebras visuais.
   *
   * Não existe `listLevel` aqui de propósito: `Y.Text` plano não guarda
   * atributo por linha, então recuo seria um nível para a célula inteira, não
   * por item. Aninhamento dentro de célula exigiria blocos de verdade dentro
   * dela — ver o spec de 2026-08-24.
   */
  listKind?: ListKind;
  /** Só relevante com `listKind === "ordered"`. Primeiro número da lista. */
  listStart?: number;
  /** Só relevante com `listKind === "ordered"`. Sobrepõe o marcador padrão. */
  listStyle?: ListStyleType;
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/core
npx vitest run
```

Esperado: PASS, incluindo os 6 testes novos e toda a suíte já existente.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/core/src/types.ts packages/core/src/marks.ts packages/core/src/__tests__/splitDeltaByLines.test.ts
git commit -m "feat(core): CellAttrs.listKind e splitDeltaByLines

A celula segue sendo um Y.Text plano. Com listKind presente, o \n deixa de
ser quebra visual e passa a separar itens.

splitDeltaByLines preserva linha vazia no meio de proposito: o numero de
itens tem que bater com o numero de \n do modelo, senao o mapeamento de
cursor do dom-bridge sai do lugar."
```

---

## Task 2: `toggleList` funciona dentro de célula (core)

**Files:**
- Modify: `packages/core/src/commands.ts:733-758` (`toggleList`), `:760`, `:781`
- Test: `packages/core/src/__tests__/listaEmCelula.test.ts` (criar)

**Interfaces:**
- Consumes: `CellAttrs.listKind` (Task 1); `setCellAttr` (`commands.ts:436`, já existe).
- Produces: `toggleList(ctx, kind)` passa a operar em célula.

**Contexto:** `setCellAttr` já resolve de graça dois casos — aplica a **todas as células de uma seleção retangular** (`commands.ts:449-455`) e **pula células cobertas** por span (`:458`). Não reimplementar isso.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/core/src/__tests__/listaEmCelula.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  toggleList,
  type CommandContext,
  type Selection,
} from "../index";
import type { SerializedDocument } from "../types";

function harness() {
  const input: SerializedDocument = {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 2 },
        cells: [
          { text: "um\ndois", delta: [{ insert: "um\ndois" }], attrs: {} },
          { text: "outra", delta: [{ insert: "outra" }], attrs: {} },
        ],
      },
    ],
  };
  const doc = EditorDocument.fromJSON(input);
  let selection: Selection = collapsedSelection({ blockIndex: 0, cellIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
  };
  return { ctx, doc, attrs: (cell: number) => doc.getCellAttrs(0, cell) };
}

describe("toggleList dentro de célula", () => {
  it("liga listKind na célula do cursor", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    expect(h.attrs(0).listKind).toBe("bullet");
  });

  it("não afeta as outras células", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    expect(h.attrs(1).listKind).toBeUndefined();
  });

  it("clicar o mesmo tipo de novo desliga", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    toggleList(h.ctx, "bullet");
    expect(h.attrs(0).listKind).toBeUndefined();
  });

  it("trocar de tipo substitui em vez de desligar", () => {
    const h = harness();
    toggleList(h.ctx, "bullet");
    toggleList(h.ctx, "ordered");
    expect(h.attrs(0).listKind).toBe("ordered");
  });

  it("não converte a célula em bloco listItem", () => {
    const h = harness();
    toggleList(h.ctx, "ordered");
    expect(h.doc.getBlockType(0)).toBe("table");
    expect(h.doc.toJSON().blocks[0].cells![0].text).toBe("um\ndois");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/core
npx vitest run src/__tests__/listaEmCelula.test.ts
```

Esperado: FAIL — `listKind` fica `undefined`, porque `toggleList` retorna cedo em célula.

- [ ] **Step 3: Implementar**

Em `packages/core/src/commands.ts`, dentro de `toggleList`, substituir a linha de guarda:

```ts
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
```

por:

```ts
    // Dentro de tabela a lista é um atributo da CÉLULA, não um tipo de bloco:
    // a célula é um Y.Text plano e cada linha separada por `\n` vira um item.
    // `setCellAttr` já cuida de seleção retangular e de pular célula coberta.
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) {
      const atual = ctx.doc.getCellAttrs(sel.focus.blockIndex, sel.focus.cellIndex!).listKind;
      setCellAttr(ctx, "listKind", atual === kind ? null : kind);
      return;
    }
```

> `setCellAttr` abre a própria transação. Chamá-la de dentro do `transact` de `toggleList` é seguro: `Y.Doc.transact` é reentrante e a interna vira parte da externa.

Em `indentList` (`:760`) e `dedentList` (`:781`), trocar a guarda muda pela guarda comentada — **as duas com o mesmo texto**:

```ts
    // Recuo não existe dentro de célula: `Y.Text` plano não guarda atributo por
    // linha, então o nível seria da célula inteira e não do item. Aninhamento em
    // célula exigiria blocos de verdade dentro dela — ver o spec de 2026-08-24.
    if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/core
npx vitest run
```

Esperado: PASS. Atenção especial aos testes já existentes de `toggleList` fora de tabela — o caminho de bloco não pode ter mudado.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/core/src/commands.ts packages/core/src/__tests__/listaEmCelula.test.ts
git commit -m "feat(core): toggleList deixa de ser no-op dentro de celula

Era guarda deliberada, nao esquecimento: lista e tipo de BLOCO e celula nao
contem bloco. Agora, dentro de tabela, lista vira atributo da celula.

indentList/dedentList mantem a guarda, mas agora ela diz por que."
```

---

## Task 3: Mapeamento de cursor no `dom-bridge` (react)

**Files:**
- Modify: `packages/react/src/dom-bridge.ts:182` (`textOffsetWithin`), `:313` (`locatePoint`)
- Test: `packages/react/src/__tests__/domBridgeCelulaLista.test.ts` (criar)

**Interfaces:**
- Consumes: nada das tasks anteriores (opera sobre DOM).
- Produces: mapeamento correto de offset em célula-lista. A Task 4 (render) depende deste contrato: **cada `<li>` a partir do segundo carrega `data-cell-line` com seu índice**.

**Esta é a task de risco do plano.** Hoje o `\n` da célula existe como caractere num text node (o `pre-wrap` renderiza), então offset do modelo ↔ offset do DOM é 1:1. Com `<li>`, os `\n` somem do texto do DOM. Sem esta task, o cursor pula de lugar — a classe exata do bug #1.

A aritmética, para a célula `"um\ndois"` renderizada como `<li data-cell-line="0">um</li><li data-cell-line="1">dois</li>`:

| offset do modelo | onde fica no DOM |
| --- | --- |
| 0, 1, 2 | dentro de `"um"` em 0, 1, 2 (2 = fim de "um") |
| 3 | início de `"dois"` (offset 0) |
| 4..7 | dentro de `"dois"` em 1..4 |

O `\n` ocupa a passagem de 2 para 3. Como o texto de `li[0]` tem comprimento 2, o offset 2 resolve **antes** de o walker chegar em `li[1]` — então a regra "ao entrar num `<li>` com `data-cell-line` maior que 0, consome 1" não conflita com o fim da linha anterior.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/react/src/__tests__/domBridgeCelulaLista.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { locatePoint, textOffsetWithin, getCellElement } from "../dom-bridge";

/** `.ed-root` com uma tabela de 1 célula renderizada como lista de 2 itens. */
function montarRoot(): HTMLElement {
  const root = document.createElement("div");
  root.className = "ed-root";
  root.innerHTML = `
    <table class="ed-block ed-table" data-block-index="0" data-block-type="table">
      <tbody><tr data-cell-row="0">
        <td class="ed-cell" data-cell-index="0" data-cell-row="0" data-cell-col="0">
          <ul class="ed-list ed-list-bullet"><li class="ed-listitem" data-cell-line="0">um</li><li class="ed-listitem" data-cell-line="1">dois</li></ul>
        </td>
      </tr></tbody>
    </table>`;
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/domBridgeCelulaLista.test.ts
```

Esperado: FAIL nos offsets a partir de 3 — sem a contagem da fronteira, `locatePoint(3)` cai em `"dois"@1` e `textOffsetWithin("dois",0)` devolve 2.

- [ ] **Step 3: Implementar**

Acrescentar o helper perto dos outros predicados de nó em `dom-bridge.ts` (junto de `isPhantomEmbed`, `:146`):

```ts
/**
 * `true` para um `<li>` de célula-lista que NÃO é o primeiro da lista.
 *
 * A célula é um `Y.Text` plano: `"um\ndois"` vira dois `<li>`, e o `\n` some do
 * texto do DOM. Cada `<li>` a partir do segundo, portanto, consome um caractere
 * do modelo que não tem texto correspondente — mesma situação dos embeds, e
 * tratado do mesmo jeito nos dois sentidos.
 */
function isCellLineBoundary(n: Node): boolean {
  if (n.nodeType !== Node.ELEMENT_NODE) return false;
  const line = (n as HTMLElement).dataset.cellLine;
  return line != null && Number(line) > 0;
}
```

**⚠️ CORRIGIDO em 2026-08-24, depois de a execução expor dois defeitos neste
trecho. A versão anterior deste plano trazia dois one-liners que NÃO funcionam.
Não os reintroduza.**

**Em `locatePoint`** não basta `remaining -= 1`. Esse decremento pelado só é
seguro quando toda linha antes da fronteira tem texto: com linha vazia (que o
render emite como `<li><br data-empty="true"/></li>`, sem text node) ele produz
**offset negativo** — `"\na"`@0 vira `{node: "a", offset: -1}` — e colapsa
posições distintas em `"a\n"`@2 e `"\n"`@1. Medido, não suposto.

É preciso o precedente **completo** de embed, não metade dele: guarda de entrada
quando `remaining === 0` e fallback de fronteira ao final do walk, espelhando o
que o código já faz com `lastImg`.

E a guarda tem que resolver **dentro** do `<li>` anterior, não em `(ul, k)`. Um
embed é inline, então `(parent, index)` é visualmente o mesmo ponto que "fim do
texto anterior"; um `<li>` é limite de **bloco**, e `(ul, k)` é uma posição
*entre* itens, que o navegador pinta na linha errada.

**Mas o ponto tem que vir do estado do walk, não da topologia de irmãos do DOM.**
Prescrever `(previousElementSibling, 0)` está errado e foi medido: se a linha
anterior **termina em embed**, o ramo de embed já saiu sem resolver, e apontar
para o começo da linha anterior joga o caret vários caracteres para trás. Com
`"ab⟦img⟧\nc"`, o offset 3 ida-e-volta em 0 em vez de 3 — três caracteres para
trás, em silêncio. Imagem dentro de célula é feature suportada hoje
(`insertImage` lê `pos.cellIndex`, `commands.ts:2023`).

A guarda precisa triar pelo estado que ela já carrega, do mesmo jeito que o
fallback de saída faz: se houver um `lastImg`, o ponto é logo **depois** dele
(`(lastImg.parentNode, indexInParent(lastImg) + 1)`); só quando não houver é que
a linha anterior é de fato vazia e o ponto é o começo dela.

**Em `textOffsetWithin`** a contagem precisa ficar **acima** do check
`n === target`, não junto do bloco de embed. Se ficar abaixo, uma âncora cujo
**nó é** o próprio `<li>` de fronteira não ganha o `+1` — e é exatamente essa a
forma que o navegador produz ao clicar numa linha vazia, num triple-click, ou
numa seleção normalizada para elemento.

Isso não é hipotético: `textOffsetWithin` é alimentado por `readDomSelection`, a
partir do navegador — **não** por `locatePoint`. Com a contagem no lugar errado,
o professor clica na linha vazia, o modelo grava o offset da linha de cima,
`selectionsEqual` dá `true`, `applyDomSelection` nunca corrige, e o próximo
caractere que ele digitar **sai na linha errada**, sem nenhum aviso.

> Os dois são espelhos. Se você mexer em um e não no outro, o cursor sai do
> lugar — e nenhum teste de render pega isso. Um teste de ida-e-volta também
> não: a aritmética se cancela. Pine cada lado com asserção **absoluta**
> (identidade do nó + offset), e acrescente
> `expect(p!.offset).toBeGreaterThanOrEqual(0)` no helper de ida-e-volta —
> sozinha, essa asserção já teria pego o `-1`.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run
```

Esperado: PASS, incluindo toda a suíte de `dom-bridge` já existente (célula sem lista, embeds, blocos fragmentados) — nenhum desses tem `data-cell-line`, então nada deve ter mudado para eles.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/dom-bridge.ts packages/react/src/__tests__/domBridgeCelulaLista.test.ts
git commit -m "fix(react): offset de cursor em celula-lista

Com <li>, os \n da celula somem do texto do DOM e o mapeamento deixa de ser
1:1 — cursor pularia de lugar, a classe do bug #1.

Fronteira de <li> passa a consumir 1 caractere do modelo nos DOIS sentidos,
mesmo padrao que embeds ja usam. Teste cobre ida, volta e ida-e-volta."
```

---

## Task 4: Render da célula-lista (react + playground CSS)

**Files:**
- Modify: `packages/react/src/NodeView.tsx:258`
- Modify: `apps/playground/src/styles.css`
- Test: `packages/react/src/__tests__/celulaListaRender.test.tsx` (criar)

**Interfaces:**
- Consumes: `splitDeltaByLines` (Task 1), `CellAttrs.listKind` (Task 1), e o contrato de `data-cell-line` da Task 3.
- Produces: `<td>` com `<ul>`/`<ol>` quando a célula tem `listKind`.

**Contrato com a Task 3, obrigatório:** **todo** `<li>` carrega `data-cell-line` com seu índice (`0`, `1`, `2`…). O `dom-bridge` só conta os de índice maior que zero, mas emitir em todos mantém o atributo legível e o teste simples.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/react/src/__tests__/celulaListaRender.test.tsx`.

**Siga o padrão de `tableAltura.render.test.tsx`** — `NodeView` de tabela
delega para `TableView`, que usa contexto do editor: renderizar solto com
`renderToStaticMarkup` **não funciona**, precisa de `EditorProvider` e do
polyfill de `ResizeObserver` que o jsdom não tem.

```tsx
// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { EditorProvider } from "../EditorContext";
import { NodeView } from "../NodeView";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

let container: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function celulaDoc(attrs: Record<string, unknown>): SerializedDocument {
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

function montar(attrs: Record<string, unknown>): HTMLElement {
  const editorDoc = EditorDocument.fromJSON(celulaDoc(attrs));
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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  return container;
}

describe("render de célula-lista", () => {
  it("sem listKind não emite lista", () => {
    const dom = montar({});
    expect(dom.querySelector("ul")).toBeNull();
    expect(dom.querySelector("ol")).toBeNull();
    expect(dom.querySelector(".ed-cell")!.textContent).toBe("um\ndois");
  });

  it("listKind bullet emite <ul> com um <li> por linha", () => {
    const dom = montar({ listKind: "bullet" });
    const ul = dom.querySelector("ul.ed-list.ed-list-bullet");
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll("li")).toHaveLength(2);
    expect([...ul!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["um", "dois"]);
  });

  it("listKind ordered emite <ol>", () => {
    const dom = montar({ listKind: "ordered" });
    expect(dom.querySelector("ol.ed-list.ed-list-ordered")).not.toBeNull();
  });

  it("todo <li> carrega data-cell-line com seu índice", () => {
    const dom = montar({ listKind: "bullet" });
    expect(
      [...dom.querySelectorAll("li")].map((li) => li.getAttribute("data-cell-line")),
    ).toEqual(["0", "1"]);
  });

  it("listStart vira o atributo start do <ol>", () => {
    const dom = montar({ listKind: "ordered", listStart: 5 });
    expect(dom.querySelector("ol")!.getAttribute("start")).toBe("5");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/celulaListaRender.test.tsx
```

Esperado: FAIL — nenhum `<ul>` é emitido.

- [ ] **Step 3: Implementar**

Em `packages/react/src/NodeView.tsx`, substituir a linha do conteúdo do `<td>`:

```tsx
                  {renderInline(delta, `t${index}-c${flat}`)}
```

por:

```tsx
                  {renderCellContent(cell?.attrs, delta, `t${index}-c${flat}`)}
```

E acrescentar a função no mesmo arquivo, acima do componente da tabela:

```tsx
/**
 * Conteúdo de um `<td>`. Sem `listKind`, é o delta cru (o `\n` quebra linha via
 * `white-space: pre-wrap`). Com `listKind`, cada linha separada por `\n` vira
 * um item.
 *
 * `data-cell-line` em TODO `<li>` é contrato com o `dom-bridge`: ele conta os
 * de índice maior que zero como um caractere do modelo (o `\n` que sumiu do
 * texto do DOM). Mexer aqui sem mexer lá desloca o cursor.
 */
function renderCellContent(
  attrs: CellAttrs | undefined,
  delta: DeltaOp[],
  keyPrefix: string,
): ReactNode {
  const kind = attrs?.listKind;
  if (!kind) return renderInline(delta, keyPrefix);
  const linhas = splitDeltaByLines(delta);
  const Tag = kind === "ordered" ? "ol" : "ul";
  return (
    <Tag
      className={`ed-list ed-list-${kind}`}
      data-list-kind={kind}
      start={kind === "ordered" && typeof attrs?.listStart === "number" ? attrs.listStart : undefined}
      style={attrs?.listStyle ? { listStyleType: attrs.listStyle } : undefined}
    >
      {linhas.map((linha, i) => (
        <li key={i} className="ed-listitem" data-cell-line={i}>
          {renderInline(linha, `${keyPrefix}-l${i}`)}
        </li>
      ))}
    </Tag>
  );
}
```

Acrescentar aos imports do arquivo: `splitDeltaByLines` e os tipos `CellAttrs`, `DeltaOp` de `@sofereditor/core`, e `ReactNode` de `react` (conferir quais já estão importados antes de duplicar).

Em `apps/playground/src/styles.css`, acrescentar depois das regras de `.ed-cell`:

```css
/* Lista dentro de célula. Margem zerada e recuo menor que o da lista de bloco:
   célula é apertada, e o padrão de 28px come a largura útil da coluna. */
.ed-cell .ed-list {
  margin: 0;
  padding-inline-start: 20px;
}
.ed-cell .ed-listitem {
  margin: 0;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run
```

Esperado: PASS, suíte inteira do `react` incluída.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/NodeView.tsx apps/playground/src/styles.css packages/react/src/__tests__/celulaListaRender.test.tsx
git commit -m "feat(react): celula com listKind renderiza <ul>/<ol>

Um <li> por linha separada por \n. Todo <li> carrega data-cell-line, que e
contrato com o dom-bridge: mexer no render sem mexer la desloca o cursor."
```

---

## Task 5: Import de .docx lê a numeração dentro de célula

**Files:**
- Modify: `packages/import-docx/src/tables.ts` (`tableToBlock`, `cellChildrenToDelta` e o chamador em `:105`)
- Modify: `packages/import-docx/src/docx.ts:47` (passar o resolvedor para `tableToBlock`)
- Test: `packages/import-docx/src/__tests__/lista-em-celula.test.ts` (criar)

**Interfaces:**
- Consumes: `CellAttrs.listKind` (Task 1); `NumberingResolver.resolve(numPr)` (`numbering.ts:91`), que devolve `{ listKind, listLevel, ordinal?, listStyle? } | null`.
- Produces: células importadas com `listKind`.

**Este é o conserto da perda silenciosa.** Hoje três parágrafos numerados numa célula viram `"um\ndois\ntres"` com `attrs: {}` — os marcadores somem sem aviso.

**Cuidado com efeito colateral, verificado:** `resolve()` **muta contador** (`numbering.ts:113-116`) para lista ordenada — incrementa o contador daquele `numId` e grava de volta. Chamá-lo nos parágrafos da célula avança a numeração e muda o ordinal de itens depois da tabela com o mesmo `numId`. Avançar é o comportamento certo (o Word também conta os parágrafos numerados dentro da tabela), mas precisa de teste. `bullet` não tem esse efeito — `resolve()` retorna antes de tocar o contador (`numbering.ts:110`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/import-docx/src/__tests__/lista-em-celula.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { docxBlobToDocument } from "../docx";

async function docxFrom(bodyXml: string, numberingXml?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`,
  );
  if (numberingXml) zip.file("word/numbering.xml", numberingXml);
  return zip.generateAsync({ type: "uint8array" });
}

const NUMBERING = `<?xml version="1.0"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:start w:val="1"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const listP = (t: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const plainP = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const tbl = (inner: string) => `<w:tbl><w:tr><w:tc>${inner}</w:tc></w:tr></w:tbl>`;

describe("import de lista dentro de célula", () => {
  it("célula com parágrafos numerados vira célula com listKind ordered", async () => {
    const doc = await docxBlobToDocument(
      await docxFrom(tbl(listP("um") + listP("dois") + listP("tres")), NUMBERING),
    );
    const t = doc.blocks.find((b) => b.type === "table")!;
    expect(t.cells![0].attrs.listKind).toBe("ordered");
    expect(t.cells![0].text).toBe("um\ndois\ntres");
  });

  it("célula sem numeração continua sem listKind", async () => {
    const doc = await docxBlobToDocument(await docxFrom(tbl(plainP("a") + plainP("b"))));
    const t = doc.blocks.find((b) => b.type === "table")!;
    expect(t.cells![0].attrs.listKind).toBeUndefined();
    expect(t.cells![0].text).toBe("a\nb");
  });

  it("o contador de numeração avança através da tabela", async () => {
    // No Word:  1. antes  |  tabela com 2. e 3.  |  4. depois
    const doc = await docxBlobToDocument(
      await docxFrom(listP("antes") + tbl(listP("na") + listP("tabela")) + listP("depois"), NUMBERING),
    );
    const itens = doc.blocks.filter((b) => b.type === "listItem");
    expect(itens.map((b) => b.text)).toEqual(["antes", "depois"]);

    // `paragraphs.ts:54` grava o ordinal do Word em `listStart` de cada item, e
    // `docx.ts` mantém o valor nos líderes de grupo. A tabela separa os dois
    // itens em grupos distintos, então os dois preservam o número.
    //
    // Esta é a asserção que morde: se `resolve()` NÃO fosse chamado para os
    // parágrafos da célula, o contador não avançaria e "depois" viria como 2
    // em vez de 4 — divergindo do que o Word mostra.
    expect(itens[0].attrs.listStart).toBe(1);
    expect(itens[1].attrs.listStart).toBe(4);

    const t = doc.blocks.find((b) => b.type === "table")!;
    expect(t.cells![0].attrs.listKind).toBe("ordered");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/import-docx
npx vitest run src/__tests__/lista-em-celula.test.ts
```

Esperado: FAIL no primeiro teste — `listKind` vem `undefined`.

- [ ] **Step 3: Implementar**

Em `packages/import-docx/src/tables.ts`, trocar `cellChildrenToDelta` por uma versão que também devolve o `listKind` detectado:

```ts
/**
 * Delta da célula + o tipo de lista, se os parágrafos dela vierem numerados.
 *
 * A célula no modelo é um único `Y.Text`, então achatamos os `<w:p>` com `\n`
 * entre eles. Quando ALGUM parágrafo traz `<w:numPr>`, a célula inteira vira
 * lista: cada linha passa a ser um item. Célula mista (alguns com marcador,
 * outros sem) vira lista inteira — é o menos surpreendente, e prova real não
 * mistura.
 *
 * O `listLevel` do Word é descartado de propósito: `CellAttrs` não tem nível
 * (`Y.Text` plano não guarda atributo por linha). Aninhamento dentro de célula
 * exigiria blocos de verdade — ver o spec de 2026-08-24.
 *
 * `numbering.resolve()` MUTA o contador de ordinais para listas ordenadas
 * (`numbering.ts:113-116`). Chamamos mesmo assim, e de propósito: o Word também
 * conta os parágrafos numerados de dentro da tabela, então não chamar
 * dessincronizaria a numeração dos itens que vêm depois dela.
 */
function cellChildrenToDelta(
  tc: OoxmlNode,
  ctx: RunContext,
  numbering: NumberingResolver,
): { delta: DeltaOp[]; listKind?: ListKind } {
  const out: DeltaOp[] = [];
  let listKind: ListKind | undefined;
  let first = true;
  for (const child of childrenOf(tc)) {
    if (tagOf(child) !== "w:p") continue;
    if (!first) out.push({ insert: "\n" });
    first = false;
    const pPr = findChild(child, "w:pPr");
    const numPr = pPr ? findChild(pPr, "w:numPr") : undefined;
    const resolvido = numbering.resolve(numPr);
    if (resolvido && !listKind) listKind = resolvido.listKind;
    out.push(...paragraphChildrenToDelta(childrenOf(child), ctx));
  }
  return { delta: out, listKind };
}
```

E no chamador (`tables.ts:105-106`):

```ts
      const delta = cellChildrenToDelta(tc, ctx);
      const text = textOfDelta(delta);
      const cellAttrs: CellAttrs = {};
```

vira:

```ts
      const { delta, listKind } = cellChildrenToDelta(tc, ctx, numbering);
      const text = textOfDelta(delta);
      const cellAttrs: CellAttrs = {};
      if (listKind) cellAttrs.listKind = listKind;
```

**Fiação do resolvedor — verificado, e é a parte que o brief não pode errar.**
`RunContext` **não** carrega o resolvedor (`runs.ts:12`, ele é só
`extends ImageContext`). O caminho de bloco recebe o resolvedor como
**terceiro parâmetro**: `docx.ts:23` cria
`const numbering = new NumberingResolver(file.numberingXml)` e chama
`paragraphToBlock(child, ctx, numbering)` (`docx.ts:45`). Mas
`tableToBlock(child, ctx, larguraUtilTwips)` (`docx.ts:47`) **não recebe**.

Então esta task também precisa passar o resolvedor até a célula:

1. `tables.ts` — `tableToBlock` ganha um quarto parâmetro
   `numbering: NumberingResolver` e o repassa para `cellChildrenToDelta(tc, ctx, numbering)`.
2. `tables.ts` — `cellChildrenToDelta` passa a receber `numbering` e chamar
   `numbering.resolve(numPr)` (no lugar do `ctx.numbering` que **não existe**).
3. `docx.ts:47` — a chamada vira `tableToBlock(child, ctx, larguraUtilTwips, numbering)`.
4. `tables.ts` — imports: acrescentar `ListKind` ao `import type { … } from "@sofereditor/core"`
   (hoje traz `BlockAttrs, CellAttrs, DeltaOp, SerializedBlock, SerializedCell, TableBorderPreset`)
   e `import { NumberingResolver } from "./numbering"` como tipo. `findChild` já está
   importado de `./parse-xml`, não duplicar.

A ordem do contador sai correta de graça: `docx.ts` percorre os blocos na ordem
do documento, então parágrafos antes da tabela, células da tabela e parágrafos
depois avançam o contador na sequência que o Word usa.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/import-docx
npx vitest run
```

Esperado: PASS, incluindo os testes de round-trip já existentes.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/import-docx/src/tables.ts packages/import-docx/src/__tests__/lista-em-celula.test.ts
git commit -m "fix(import-docx): lista dentro de celula deixa de sumir

cellChildrenToDelta nunca lia <w:numPr>: tres paragrafos numerados numa
celula viravam 'um\ndois\ntres' sem marcador, em silencio. O professor
importava a prova do Word e perdia a numeracao sem aviso.

resolve() e chamado de proposito mesmo mutando o contador — o Word tambem
conta os paragrafos numerados de dentro da tabela."
```

---

## Task 6: Export DOCX — um `<w:p>` por linha

**Files:**
- Modify: `packages/export-docx/src/docx.ts` (`makeCell`)
- Test: `packages/export-docx/src/__tests__/docx.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `splitDeltaByLines` (Task 1), `CellAttrs.listKind` (Task 1).
- Produces: DOCX com um parágrafo por linha de célula.

**Conserta um defeito que já existe hoje, medido:** `makeCell` emite **um único `<w:p>`** por célula e `deltaToRuns` troca `\n` por espaço (`docx.ts:527`), então `"um\ndois\ntres"` sai como `"um dois tres"` numa linha só. Não é escopo extra — a lista precisa de um `<w:p>` por item de qualquer forma, e sem isso o DOCX continuaria divergindo do editor e do PDF.

A API de numeração já usada pelo caminho de bloco (`makeListItem`): `new Paragraph({ numbering: { reference, level } })`, com `ORDERED_REF`/`BULLET_REF` e `level` — reaproveitar as mesmas constantes, nível `0`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `packages/export-docx/src/__tests__/docx.test.ts`:

```ts
describe("célula multilinha e célula-lista", () => {
  const celula = (attrs: Record<string, unknown>): LegacySerializedDocument => [
    {
      type: "table",
      text: "",
      delta: [],
      attrs: { rows: 1, cols: 1 },
      cells: [{ text: "um\ndois\ntres", delta: [{ insert: "um\ndois\ntres" }], attrs }],
    },
  ];

  it("célula multilinha SEM lista emite um <w:p> por linha (hoje vira uma linha só)", async () => {
    const { buffer } = await documentToDocxBuffer(celula({}));
    const xml = await documentXml(buffer);
    const tc = /<w:tc>[\s\S]*?<\/w:tc>/.exec(xml)![0];
    expect((tc.match(/<w:p[ >]/g) ?? []).length).toBe(3);
    expect(tc).not.toContain("um dois tres");
    expect(tc).toContain(">um<");
    expect(tc).toContain(">dois<");
    expect(tc).toContain(">tres<");
  });

  it("célula com listKind emite numeração em cada parágrafo", async () => {
    const { buffer } = await documentToDocxBuffer(celula({ listKind: "ordered" }));
    const xml = await documentXml(buffer);
    const tc = /<w:tc>[\s\S]*?<\/w:tc>/.exec(xml)![0];
    expect((tc.match(/<w:numPr>/g) ?? []).length).toBe(3);
  });

  it("célula sem lista não emite numeração", async () => {
    const { buffer } = await documentToDocxBuffer(celula({}));
    const xml = await documentXml(buffer);
    const tc = /<w:tc>[\s\S]*?<\/w:tc>/.exec(xml)![0];
    expect(tc).not.toContain("<w:numPr>");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/export-docx
npx vitest run src/__tests__/docx.test.ts -t "célula multilinha"
```

Esperado: FAIL no primeiro teste — sai 1 `<w:p>` e o texto `"um dois tres"`.

- [ ] **Step 3: Implementar**

Em `packages/export-docx/src/docx.ts`, substituir o corpo de `makeCell`:

```ts
function makeCell(cell: SerializedCell, images: Map<string, ResolvedImage | null>): TableCell {
  const span = cell.attrs?.colspan && cell.attrs.colspan > 1 ? cell.attrs.colspan : 1;
  const rowSpan = cell.attrs?.rowspan && cell.attrs.rowspan > 1 ? cell.attrs.rowspan : 1;
  const fill = cssColorToDocxHex(cell.attrs?.bgColor);
  const kind = cell.attrs?.listKind;
  // Uma célula é um Y.Text plano com `\n`. O Word renderiza `\n` dentro de
  // <w:t> como espaço (ver deltaToRuns), então uma célula multilinha virava
  // UMA linha. Um <w:p> por linha resolve — e é o que a lista precisa também.
  const linhas = splitDeltaByLines(cell.delta);
  return new TableCell({
    columnSpan: span,
    rowSpan,
    verticalAlign: VerticalAlign.TOP,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    children: linhas.map(
      (linha) =>
        new Paragraph({
          alignment: alignFor(cell.attrs?.align),
          numbering: kind
            ? { reference: kind === "ordered" ? ORDERED_REF : BULLET_REF, level: 0 }
            : undefined,
          children: deltaToRuns(linha, VERDANA, images),
        }),
    ),
  });
}
```

Acrescentar `splitDeltaByLines` aos imports de `@sofereditor/core` no topo do arquivo.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/export-docx
npx vitest run
```

Esperado: PASS. Atenção ao teste da Task 3 do plano da Verdana (`todo <w:r> tem <w:rFonts>`): os parágrafos novos continuam passando por `deltaToRuns` com `VERDANA`, então o invariante se mantém. Se ele quebrar, é porque uma linha vazia gerou run sem fonte — conferir o fallback de delta vazio.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/export-docx/src/docx.ts packages/export-docx/src/__tests__/docx.test.ts
git commit -m "fix(export-docx): celula multilinha deixa de virar uma linha so

makeCell emitia UM <w:p> por celula, e deltaToRuns troca \n por espaco, entao
'um\ndois\ntres' saia como 'um dois tres'. Isso ja afetava qualquer celula
multilinha, com ou sem lista — o DOCX divergia do editor e do PDF.

Um <w:p> por linha, com numeracao quando a celula tem listKind."
```

---

## Task 7: Export PDF — espelhar o editor

**Files:**
- Modify: `packages/export-pdf/src/html.ts` (`renderCell` e o CSS embutido, `:526-539`)
- Test: `packages/export-pdf/src/__tests__/` (acrescentar ao arquivo de tabela existente; se não houver, criar `celulaLista.test.ts`)

**Interfaces:**
- Consumes: `splitDeltaByLines` (Task 1), `CellAttrs.listKind` (Task 1).
- Produces: HTML de PDF com a mesma estrutura do editor.

**O norte manda:** o que o professor vê é o que sai no PDF. Este HTML e o `NodeView` da Task 4 precisam produzir a mesma estrutura de `<ul>`/`<li>`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
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

  it("o CSS embutido tem regra de lista dentro de célula", () => {
    const out = documentToHtml(doc({ listKind: "bullet" }), { title: "t" });
    expect(out).toContain(".ed-cell .ed-list");
  });
});
```

> `documentToHtml(doc, options)` é a assinatura real (`html.ts:72`) — a chamada acima já está correta.

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/export-pdf
npx vitest run
```

Esperado: FAIL — nenhum `<ul>` e nenhuma regra `.ed-cell .ed-list`.

- [ ] **Step 3: Implementar**

Em `renderCell` (`html.ts:260`), onde hoje o conteúdo do `<td>` é montado a partir de `cell.delta`, passar a emitir a lista quando `cell.attrs?.listKind` existir — mesma estrutura do `NodeView`:

```ts
  const kind = cell.attrs?.listKind;
  const conteudo = kind
    ? `<${kind === "ordered" ? "ol" : "ul"} class="ed-list ed-list-${kind}"${
        kind === "ordered" && typeof cell.attrs?.listStart === "number"
          ? ` start="${cell.attrs.listStart}"`
          : ""
      }>${splitDeltaByLines(cell.delta)
        .map((linha, i) => `<li class="ed-listitem" data-cell-line="${i}">${inlineToHtml(linha)}</li>`)
        .join("")}</${kind === "ordered" ? "ol" : "ul"}>`
    : inlineToHtml(cell.delta);
```

e usar `conteudo` no lugar da renderização atual do delta. Conferir o nome real da função que converte delta em HTML inline neste arquivo (procurar por como o `<td>` monta o conteúdo hoje) e usar essa — **não** criar uma nova.

No CSS embutido, depois de `.ed-listitem` (`:534`), acrescentar:

```css
.ed-cell .ed-list { margin: 0; padding-inline-start: 20px; }
.ed-cell .ed-listitem { margin: 0; }
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo && pnpm test
```

Esperado: verde nos 7 pacotes.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/export-pdf/src/html.ts packages/export-pdf/src/__tests__/
git commit -m "feat(export-pdf): celula-lista no HTML do PDF

Mesma estrutura do NodeView: <ul>/<ol> com um <li> por linha. O que o
professor ve tem que ser o que sai no PDF."
```

---

## Task 8: Verificação nos três caminhos

**Files:** nenhum de produção. Scripts ficam em `$CLAUDE_JOB_DIR/tmp`, não são commitados.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: evidência. Nada vai para os apps antes disto.

- [ ] **Step 1: Reproduzir o bug original, agora consertado**

Subir o playground (`cd apps/playground && nohup npx vite --port 5173 &`), e **clicando de verdade** (não disparar evento por script — pula o caminho que quebra):

1. Inserir uma tabela.
2. Clicar numa célula, digitar `um`, `Enter`, `dois`, `Enter`, `tres`.
3. Clicar em "Lista com marcadores".

Esperado: três itens com marcador dentro da célula. Antes desta mudança, o clique não fazia nada.

- [ ] **Step 2: Testar o cursor — é a parte de risco**

Ainda no playground, na célula-lista:

1. Clicar no meio do segundo item e digitar — o texto tem que entrar onde o cursor está, sem pular.
2. Posicionar o cursor no fim do primeiro item e apertar `→` — tem que ir para o começo do segundo.
3. Posicionar no começo do segundo e apertar `←` — tem que voltar para o fim do primeiro.
4. Selecionar do meio do primeiro ao meio do terceiro e digitar — tem que substituir o trecho certo.

Qualquer salto de cursor aqui é a assimetria entre `locatePoint` e `textOffsetWithin`. **Parar e reportar**, não contornar.

- [ ] **Step 3: Importar o .docx de teste**

Gerar um .docx com três parágrafos numerados dentro de uma célula (o fixture da Task 5 serve como referência de XML), importar pelo playground, e conferir que a célula chega com marcadores — não como três linhas soltas.

- [ ] **Step 4: Comparar os três caminhos**

Para a **mesma prova**, com uma tabela contendo uma célula-lista de três itens:

- **Editor:** contar itens e conferir os marcadores na tela.
- **PDF:** Baixar PDF, conferir que os marcadores aparecem e que a quebra de página não mudou de lugar sem motivo.
- **DOCX:** exportar, abrir no Word, conferir que são três parágrafos numerados dentro da célula — não uma linha só.

Registrar os três resultados. Divergência entre editor e PDF é o que o norte proíbe: **parar e reportar**.

- [ ] **Step 5: Conferir que prova antiga não repaginou à toa**

Abrir uma prova existente com tabela alta (sem célula-lista) e conferir que a contagem de páginas não mudou. Célula sem `listKind` não passa pelo caminho novo, então não deveria mudar nada — se mudou, o render de célula comum foi afetado por engano.

- [ ] **Step 6: Registrar a evidência**

Escrever os resultados dos Steps 1-5 no commit de fechamento. "Funciona" sem número não conta.

---

## Task 9: CSS dos apps consumidores

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/sofer-editor.css`
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css`

**Interfaces:**
- Consumes: as classes emitidas pela Task 4 (`ed-list`, `ed-list-{kind}`, `ed-listitem` dentro de `.ed-cell`).
- Produces: a lista aparece certa em produção e no `serializePaginatedHtml`, que inlina o CSS real do app.

**Por que esta task existe:** o CSS de produção **não** está neste monorepo. `apps/playground/src/styles.css` é só do playground. Sem esta task, a lista renderiza sem recuo adequado em produção e no PDF do servidor, que herda o CSS do app.

**Pré-requisito:** os pacotes `@sofereditor/core` e `@sofereditor/react` precisam estar publicados com estas mudanças — os apps instalam do npm, não do workspace. Isso se junta ao publish já pendente do trabalho de Verdana; ver "Sequenciamento" abaixo.

- [ ] **Step 1: Acrescentar as regras nos dois apps**

Em **cada** um dos dois `sofer-editor.css`, depois do bloco `.ed-cell { … }`:

```css
/* Lista dentro de célula. Margem zerada e recuo menor que o da lista de bloco:
   célula é apertada, e o padrão de 28px come a largura útil da coluna. */
.ed-cell .ed-list {
  margin: 0;
  padding-inline-start: 20px;
}
.ed-cell .ed-listitem {
  margin: 0;
}
```

- [ ] **Step 2: Confirmar que os dois arquivos continuam equivalentes**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz
diff <(sed 's#/portal2/assets#/assets#g' portal2-next/src/components/ProvaEditor/sofer-editor.css) \
     portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css
```

Esperado: **nenhuma diferença**. Qualquer saída aqui é divergência entre os apps e precisa ser resolvida antes de seguir.

- [ ] **Step 3: Typecheck e build dos dois apps**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/portal2-next && npx tsc --noEmit && npm run build
cd ~/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia && npx tsc --noEmit && npm run build
```

O `frequencia-ocorrencia` **não tem gate de tipo nenhum no CI** — erro de tipo lá só aparece em runtime, na frente do professor. O `tsc --noEmit` local é obrigatório, não opcional.

- [ ] **Step 4: Commit em cada repo**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/portal2-next
git add src/components/ProvaEditor/sofer-editor.css
git commit -m "style(prova): recuo de lista dentro de celula de tabela"

cd ~/Desktop/marreca-dev/AlefPeretz/portal-professores
git add frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css
git commit -m "style(prova): recuo de lista dentro de celula de tabela"
```

---

## Task 10: Fechar a documentação de bugs

**Files:**
- Modify: `docs/bugs.md`

- [ ] **Step 1: Acrescentar a entrada**

Ao final de `docs/bugs.md`, na lista de itens:

```
✅ 18 - listas dentro de tabela não funcionam — causa-raiz: célula é um `Y.Text` plano sem estrutura de blocos, e lista é um tipo de BLOCO; os comandos guardavam contra célula de propósito (`commands.ts:736/763/784`). Fix: `CellAttrs.listKind` + cada linha separada por `\n` vira um item. A investigação desenterrou DOIS defeitos silenciosos que ninguém tinha reportado: o import de .docx descartava `<w:numPr>` dentro de célula (três parágrafos numerados viravam texto sem marcador), e célula multilinha exportava para DOCX como UMA linha (`"um dois tres"`), porque `makeCell` emitia um único `<w:p>` e `deltaToRuns` troca `\n` por espaço — este último já afetava qualquer célula multilinha, com ou sem lista. Sem recuo por item na v1 (`Y.Text` plano não guarda atributo por linha).
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add docs/bugs.md
git commit -m "docs(bugs): #18 listas em tabela — e os dois defeitos silenciosos junto"
```

---

## Sequenciamento e publish

As Tasks 1-8 e 10 são locais ao monorepo, na branch. A **Task 9 depende de publish**, porque os apps instalam do npm e não do workspace.

Este trabalho ramifica de `feat/verdana`, que já tem um publish pendente do aval do usuário. As duas mudanças devem sair **numa release só** (as duas tocam `export-docx/src/docx.ts` e `export-pdf/src/html.ts`), com um bump único de `@sofereditor/core`, `@sofereditor/react`, `@sofereditor/export-docx` e `@sofereditor/export-pdf`.

Lembretes de release: a lista de pacotes é fixa dentro do `publish.yml`, ele pula quem já tem a versão no npm, e **pacote com nome novo trava a fila inteira** — não é o caso aqui, os quatro já existem.

---

## Self-review

**Cobertura do spec:**

| Requisito do spec | Task |
| --- | --- |
| `CellAttrs` ganha `listKind`/`listStart`/`listStyle`, sem `listLevel` | 1 |
| `toggleList` cell-aware via `setCellAttr` | 2 |
| `indentList`/`dedentList` mantêm guarda, agora comentada | 2 |
| Fronteira de `<li>` nos dois sentidos do `dom-bridge` | 3 |
| Render `<ul>`/`<ol>` com `<li>` por linha, classes `ed-list` | 4 |
| Import lê `<w:numPr>` da célula; `listLevel` descartado | 5 |
| Efeito colateral do contador de `resolve()` coberto por teste | 5 (Step 1, 3º teste) |
| `makeCell` emite um `<w:p>` por linha, com numeração | 6 |
| PDF espelha o editor + CSS de lista em célula | 7 |
| Verificação clicando, cursor, três caminhos | 8 |
| CSS de produção (apps) | 9 |
| Documentação | 10 |

**Consistência de tipos:** `splitDeltaByLines(delta: DeltaOp[]): DeltaOp[][]` é definida na Task 1 e consumida com essa assinatura nas Tasks 4, 6 e 7. `CellAttrs.listKind?: ListKind` é definida na Task 1 e lida nas Tasks 2, 4, 5, 6 e 7. O contrato `data-cell-line` é produzido pela Task 4 e consumido pela Task 3 — **a Task 3 vem antes no plano de propósito**, para o mapeamento existir antes de o render passar a depender dele; os testes da Task 3 montam o DOM à mão e não dependem da Task 4.

**Fora do plano, de propósito** (registrado no spec): recuo/aninhamento por item dentro de célula; blocos de verdade dentro de célula; controle de `listStart`/`listStyle` na toolbar.
