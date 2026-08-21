# Redimensionamento de tabela por mouse — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrastar divisas de coluna e de linha, e redimensionar a tabela
inteira pela borda direita, pela borda de baixo e pelo canto — com a alça
colando no cursor, e com o DOCX passando a ter a mesma largura do editor.

**Architecture:** `colWidths` deixa de ser px absoluto e passa a ser
proporção somando 100, porque a tabela sempre renderiza em `width: 100%` e
é o descompasso entre os dois que produz o emborrachado. Altura de linha
entra como px, porque altura é distância física e não sofre esse problema.

**Tech Stack:** TypeScript, Y.js (modelo), React 18, Vitest, `docx` (export),
pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-19-redimensionamento-tabela-design.md`

## Global Constraints

- **`colWidths` é proporção somando 100**, não px. A migração na leitura é
  idempotente: normaliza só quando a soma não for ~100.
- **`insertTableColumn` e `deleteTableColumn` já existem e quebram a
  invariante.** Hoje inserem o literal `100` (`commands.ts:1191`) e cortam a
  entrada (`:1289`). Os dois passam a renormalizar para 100.
- **`rowHeights` precisa da mesma sincronia** em `insertTableRow` e
  `deleteTableRow`. Sem isso o overlay cai no `Shape mismatch — bail out`
  que ele já tem e as alças somem sem explicação.
- **Arrasto acumula contra o valor do MODELO lido no `pointerdown`**, nunca
  contra a largura/altura renderizada. É a leitura do renderizado que produz
  o defeito atual.
- **No `pointerup` a alça reancora na posição renderizada.**
- **Altura de linha é MÍNIMO, não fixo.** Encolher abaixo do conteúdo grava
  o valor e não muda o desenho. `w:trHeight` com `hRule="atLeast"`.
- **`tableWidth` vai por estilo inline no `<table>`.** NÃO editar as quatro
  cópias de `.ed-table { width: 100% }` (três `sofer-editor.css` mais
  `export-pdf/src/html.ts:530`) — o inline ganha da classe.
- **A suíte de paginação tem que continuar verde.** O fatiamento de tabela
  por linhas é código sensível e altura declarada muda a medição.
- **Bump coordenado** dos pacotes tocados quando o manifesto mudar.

---

### Task 1: O modelo passa a proporção

**Files:**
- Modify: `packages/core/src/types.ts:67-72`
- Modify: `packages/core/src/commands.ts` (`setColumnWidth` → `setColumnBoundary`, `insertTableColumn:1190`, `deleteTableColumn:1288`)
- Test: `packages/core/src/__tests__/tableProporcao.test.ts` (criar)

**Interfaces:**
- Produces: `normalizarLarguras(widths, cols): number[]` — idempotente,
  devolve proporções somando 100. `setColumnBoundary(ctx, blockIndex,
  boundary, deltaPct)`. `setTableWidth(ctx, blockIndex, pct)`.
- Consumes: nada.

- [ ] **Step 1: Escrever o teste da normalização**

```ts
// packages/core/src/__tests__/tableProporcao.test.ts
import { describe, it, expect } from "vitest";
import { normalizarLarguras } from "../commands";

describe("normalizarLarguras", () => {
  it("converte px de documento antigo em proporção", () => {
    // Os números medidos numa tabela real de produção.
    expect(normalizarLarguras([120, 153, 120, 120], 4)).toEqual([
      23.392, 29.825, 23.392, 23.392,
    ]);
  });

  it("é IDEMPOTENTE — rodar de novo não mexe", () => {
    // Esta é a asserção que protege documentos em produção: o carregamento
    // roda a cada abertura, e uma normalização que não fosse idempotente
    // encolheria a tabela um pouco mais a cada vez que o professor abrisse.
    const uma = normalizarLarguras([120, 153, 120, 120], 4);
    expect(normalizarLarguras(uma, 4)).toEqual(uma);
    expect(normalizarLarguras(normalizarLarguras(uma, 4), 4)).toEqual(uma);
  });

  it("deixa proporção já correta intacta", () => {
    expect(normalizarLarguras([25, 25, 25, 25], 4)).toEqual([25, 25, 25, 25]);
  });

  it("distribui igual quando o array falta ou tem tamanho errado", () => {
    expect(normalizarLarguras(undefined, 4)).toEqual([25, 25, 25, 25]);
    expect(normalizarLarguras([50, 50], 4)).toEqual([25, 25, 25, 25]);
  });

  it("sempre soma 100", () => {
    for (const entrada of [[120, 153, 120, 120], [1, 2, 3], [7], [10, 10]]) {
      const r = normalizarLarguras(entrada, entrada.length);
      expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/core && npx vitest run src/__tests__/tableProporcao.test.ts`
Expected: FAIL — `normalizarLarguras` não existe.

- [ ] **Step 3: Implementar**

```ts
/** Casa a soma com 100 dentro de meio ponto — folga para erro de float. */
const SOMA_OK = (s: number): boolean => Math.abs(s - 100) < 0.5;

/**
 * Devolve proporções somando 100.
 *
 * Documento antigo grava px absoluto. Como a tabela sempre renderiza em
 * `width: 100%`, esses px já eram interpretados PROPORCIONALMENTE pelo
 * navegador — então normalizar preserva exatamente o que o professor via.
 * Não é conversão destrutiva.
 *
 * A heurística "a soma já é ~100, então já é proporção" é segura na prática:
 * para uma tabela em px cair nela, a média por coluna teria que ser 100/n —
 * 25 px cada em 4 colunas. O código antigo gravava largura renderizada, que
 * numa A4 dá ~150 px por coluna. É heurística, não prova.
 */
export function normalizarLarguras(
  widths: number[] | undefined,
  cols: number,
): number[] {
  const igual = (): number[] => new Array<number>(cols).fill(100 / cols);
  if (!Array.isArray(widths) || widths.length !== cols || cols <= 0) {
    return igual();
  }
  if (!widths.every((w) => typeof w === "number" && isFinite(w) && w > 0)) {
    return igual();
  }
  const soma = widths.reduce((a, b) => a + b, 0);
  if (SOMA_OK(soma)) return widths.slice();
  return widths.map((w) => arredonda(w / soma * 100));
}

/** Três casas: suficiente para um px numa página A4, e estável no round-trip. */
const arredonda = (n: number): number => Math.round(n * 1000) / 1000;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd packages/core && npx vitest run src/__tests__/tableProporcao.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o teste dos dois comandos que quebram**

Este é o passo que mais importa desta tarefa. Os dois comandos existem, têm
testes hoje, e passam a violar a invariante nova sem que nada acuse.

```ts
describe("inserir e apagar coluna mantêm a soma em 100", () => {
  it("insertTableColumn não faz a soma virar 200", () => {
    // Hoje `insertTableColumn` insere o literal 100 (commands.ts:1191).
    // Com px isso era um placeholder razoável. Com proporção, faria a soma
    // saltar para 200 e a tabela inteira encolher pela metade na tela.
    // `harness()` é o padrão dos testes de tabela deste pacote — copie de
    // `__tests__/tables-rect.test.ts:17`. Não existe helper compartilhado.
    const h = harness();
    insertTable(h.ctx, 3, 4);
    setColumnBoundary(h.ctx, 1, 0, 0); // inicializa colWidths em [25,25,25,25]
    insertTableColumn(h.ctx, 1, 1, "right");
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(5);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it("deleteTableColumn não deixa a soma abaixo de 100", () => {
    const h = harness();
    insertTable(h.ctx, 3, 4);
    setColumnBoundary(h.ctx, 1, 0, 0);
    deleteTableColumn(h.ctx, 1, 1);
    const w = h.doc.getBlockAttrs(1).colWidths as number[];
    expect(w).toHaveLength(3);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it("a coluna nova nasce com fatia proporcional, não com sobra", () => {
    const h = harness();
    insertTable(h.ctx, 3, 4);
    setColumnBoundary(h.ctx, 1, 0, 0);
    insertTableColumn(h.ctx, 1, 1, "right");
    // 5 colunas iguais, porque as 4 eram iguais.
    for (const w of h.doc.getBlockAttrs(1).colWidths as number[]) {
      expect(w).toBeCloseTo(20, 3);
    }
  });
});
```

- [ ] **Step 6: Consertar os dois comandos**

Em `insertTableColumn`, o trecho de `colWidths` (linha ~1190):

```ts
    // A coluna nova entra com a média das existentes e o array é
    // renormalizado — inserir o literal 100, como era antes, fazia a soma
    // saltar para 200 assim que `colWidths` virou proporção.
    const widths = attrs.get("colWidths") as number[] | undefined;
    if (Array.isArray(widths) && widths.length === cols) {
      const base = normalizarLarguras(widths, cols);
      const media = 100 / (cols + 1);
      const next = base.slice();
      next.splice(C, 0, media);
      attrs.set("colWidths", normalizarLarguras(next, cols + 1));
    }
```

Em `deleteTableColumn` (linha ~1288), depois de cortar:

```ts
      attrs.set("colWidths", normalizarLarguras(next, cols - 1));
```

- [ ] **Step 7: `setColumnWidth` vira `setColumnBoundary`**

```ts
/** Mínimo por coluna, em pontos percentuais. Abaixo disso a coluna some. */
const MIN_COLUNA_PCT = 3;

/**
 * Move a divisa `boundary` (entre a coluna `boundary` e a `boundary+1`) por
 * `deltaPct` pontos percentuais: uma cresce, a vizinha encolhe na mesma
 * medida. A soma permanece 100 **por construção**, não por normalização —
 * é o que faz o arrasto colar no cursor.
 *
 * A divisa da última coluna não tem vizinha: ela é a borda direita da tabela
 * e é tratada por `setTableWidth`, não aqui.
 */
export function setColumnBoundary(
  ctx: CommandContext,
  blockIndex: number,
  boundary: number,
  deltaPct: number,
  /**
   * Proporções do início do arrasto. O overlay lê o modelo UMA vez no
   * `pointerdown` e passa aqui a cada movimento, para o delta ser sempre
   * relativo àquele instante. Sem a base, cada `pointermove` aplicaria o
   * delta sobre o resultado do anterior e o arrasto aceleraria.
   */
  base?: number[],
): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { cols } = ctx.doc.getTableSize(blockIndex);
  if (boundary < 0 || boundary >= cols - 1) return;
  transact(ctx.doc, () => {
    const attrsMap = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!attrsMap) return;
    const larguras = normalizarLarguras(
      base ?? (attrsMap.get("colWidths") as number[] | undefined),
      cols,
    );
    const a = larguras[boundary]!;
    const b = larguras[boundary + 1]!;
    // Trava o delta nos dois extremos antes de aplicar, para a soma nunca
    // sair de 100 nem uma coluna virar zero.
    const d = Math.max(MIN_COLUNA_PCT - a, Math.min(deltaPct, b - MIN_COLUNA_PCT));
    const next = larguras.slice();
    next[boundary] = arredonda(a + d);
    next[boundary + 1] = arredonda(b - d);
    attrsMap.set("colWidths", next);
  });
}
```

- [ ] **Step 8: `setTableWidth` e o atributo**

Em `types.ts`, junto de `colWidths` (o comentário de `colWidths` também
muda: não é mais px):

```ts
  /**
   * Só quando `type === "table"`. Largura de cada coluna em **proporção**,
   * somando 100. Documento antigo tem px absoluto e é normalizado na
   * leitura — ver `normalizarLarguras`.
   */
  colWidths?: number[];
  /**
   * Só quando `type === "table"`. Largura total da tabela em percentual da
   * largura útil. Ausente = 100, e documento existente não muda de aparência.
   */
  tableWidth?: number;
```

```ts
/** Piso arbitrário e assumido: com `table-layout: fixed` a tabela encolhe
 *  abaixo do conteúdo sem resistência, então não há "mínimo do conteúdo"
 *  para ancorar. */
const MIN_TABELA_PCT = 20;

export function setTableWidth(ctx: CommandContext, blockIndex: number, pct: number): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const v = Math.max(MIN_TABELA_PCT, Math.min(100, arredonda(pct)));
  transact(ctx.doc, () => {
    ctx.doc.getBlockAttrsMap(blockIndex)?.set("tableWidth", v);
  });
}
```

- [ ] **Step 9: Rodar a suíte inteira do core**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: verde. Testes existentes de `setColumnWidth` vão falhar — atualize
para `setColumnBoundary`, **sem afrouxar o que eles afirmam**.

- [ ] **Step 10: Commit**

```bash
git add packages/core
git commit -m "feat(core): colWidths vira proporcao; boundary e largura total"
```

---

### Task 2: Render em proporção nos dois caminhos

**Files:**
- Modify: `packages/react/src/NodeView.tsx:199-203`
- Modify: `packages/export-pdf/src/html.ts:244-250` (`renderColGroup`), `:207`
- Test: `packages/export-pdf/src/__tests__/tableProporcao.test.ts` (criar)

**Interfaces:**
- Consumes: `normalizarLarguras` da Task 1, exportada por
  `@sofereditor/core` (acrescente ao `index.ts` do core se ainda não estiver).
- Produces: `<col style="width:23.392%">` e `<table style="width:80%">` nos
  dois caminhos.

- [ ] **Step 1: Escrever o teste de paridade**

```ts
describe("editor e PDF emitem a MESMA proporção", () => {
  it("colgroup sai em % nos dois", () => {
    const html = documentToHtml(docComTabela([23.392, 29.825, 23.392, 23.392]));
    expect(html).toContain('<col style="width:23.392%">');
    expect(html).not.toContain("px");
  });

  it("tableWidth vai por estilo INLINE, não por CSS", () => {
    // A folha tem `.ed-table { width: 100% }` e ela NÃO muda — o inline é
    // que ganha. Se alguém "consertar" isso mexendo no CSS, quebra as
    // outras três cópias que existem nos apps.
    const html = documentToHtml(docComTabela([25, 25, 25, 25], 80));
    expect(html).toMatch(/<table[^>]*style="[^"]*width:\s*80%/);
    expect(html).toContain(".ed-table { width: 100%");
  });

  it("tableWidth ausente não emite estilo nenhum", () => {
    const html = documentToHtml(docComTabela([25, 25, 25, 25]));
    expect(html).not.toMatch(/<table[^>]*style="[^"]*width/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL — sai `px`.

- [ ] **Step 3: `renderColGroup` em %**

```ts
function renderColGroup(widths: number[] | undefined, cols: number): string {
  const pct = normalizarLarguras(widths, cols);
  const cells = pct.map((w) => `<col style="width:${w}%">`);
  return `<colgroup>${cells.join("")}</colgroup>`;
}
```

- [ ] **Step 4: O mesmo no `NodeView`**

```tsx
          <colgroup>
            {normalizarLarguras(widths, cols).map((w, c) => (
              <col key={c} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
```

e no `<table>`, nos dois caminhos, o estilo inline só quando o atributo
existe:

```tsx
style={attrs.tableWidth != null ? { width: `${attrs.tableWidth}%` } : undefined}
```

- [ ] **Step 5: Rodar tudo**

Run: `npx vitest run` em `packages/react` e `packages/export-pdf`, e
`npx tsc --noEmit` nos dois.
Expected: verde. **A suíte de paginação inteira precisa continuar passando** —
se ela quebrar aqui, pare e reporte: significa que a medição de tabela
dependia de px.

- [ ] **Step 6: Commit**

---

### Task 3: A alça de coluna cola no cursor

**Files:**
- Modify: `packages/react/src/TableResizeOverlay.tsx`
- Test: `packages/react/src/__tests__/tableArrasto.test.ts` (criar)

**Interfaces:**
- Consumes: `setColumnBoundary` (Task 1), render em % (Task 2).
- Produces: `deltaPctDoArrasto(dxPx, larguraTabelaPx): number`, pura.

- [ ] **Step 1: Escrever o teste da conversão e da ancoragem**

```ts
describe("arrasto em px vira delta em pontos percentuais", () => {
  it("60px numa tabela de 600px são 10 pontos", () => {
    expect(deltaPctDoArrasto(60, 600)).toBeCloseTo(10, 6);
  });
  it("o sinal acompanha a direção", () => {
    expect(deltaPctDoArrasto(-30, 600)).toBeCloseTo(-5, 6);
  });
  it("tabela de largura zero não divide por zero", () => {
    expect(deltaPctDoArrasto(60, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar a conversão**

```ts
/**
 * O arrasto chega em px de tela; o modelo é proporção. A conversão é contra
 * a largura RENDERIZADA da tabela, que é justamente o que torna o arrasto
 * exato: mover o dedo 60 px numa tabela de 600 px é mover a divisa 10 pontos,
 * e 10 pontos renderizam 60 px. Ida e volta fecham.
 */
export function deltaPctDoArrasto(dxPx: number, larguraTabelaPx: number): number {
  if (!(larguraTabelaPx > 0)) return 0;
  return (dxPx / larguraTabelaPx) * 100;
}
```

- [ ] **Step 4: Trocar o handler**

O `onPointerDown` atual lê `getBoundingClientRect().width` da coluna — a
largura **renderizada** — e o `onPointerMove` grava `startWidth + dx` no
modelo. É essa leitura que produz o salto de +17.6 px no instante do clique.
Passa a guardar o estado do MODELO:

```tsx
  const draggingRef = useRef<{
    boundary: number;
    startX: number;
    baseWidths: number[];   // proporções do MODELO, lidas UMA vez
    tableWidthPx: number;
  } | null>(null);
```

```tsx
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = draggingRef.current;
    if (!d) return;
    // Delta SEMPRE relativo ao estado do pointerdown, nunca ao atual —
    // acumular contra o que está na tela é o defeito que esta tarefa mata.
    const deltaPct = deltaPctDoArrasto(e.clientX - d.startX, d.tableWidthPx);
    editor.setColumnBoundary(blockIndex, d.boundary, deltaPct, d.baseWidths);
  }, [blockIndex, editor]);
```

O quinto argumento de `setColumnBoundary` é a base do `pointerdown` — já
está na assinatura da Task 1, não precisa ajustar nada.

- [ ] **Step 5: Reancorar no `pointerup`**

```tsx
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = null;
    // Remede: se a coluna bateu no mínimo, a divisa parou antes do dedo, e a
    // alça precisa voltar para onde a borda REALMENTE está. Sem isto ela
    // fica boiando longe da borda e o arrasto seguinte salta.
    measure();
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [measure]);
```

- [ ] **Step 6: A última alça vira largura total**

A alça de índice `cols - 1` está na borda direita e não tem vizinha. Ela
chama `setTableWidth`, não `setColumnBoundary`, e ganha `aria-label`
próprio ("Largura da tabela").

- [ ] **Step 7: Rodar tudo e verificar no navegador**

Run: `npx vitest run && npx tsc --noEmit` em `packages/react`.

No playground: criar tabela 3×4, arrastar a divisa 1 e conferir que **a
borda acompanha o cursor** — sem salto no clique. Depois arrastar até o
mínimo e soltar: a alça tem que voltar para a borda.

- [ ] **Step 8: Commit**

---

### Task 4: Altura de linha no modelo e no render

**Files:**
- Modify: `packages/core/src/types.ts`, `commands.ts` (`setRowHeight`, `insertTableRow`, `deleteTableRow`)
- Modify: `packages/react/src/NodeView.tsx` (`<tr>`), `packages/export-pdf/src/html.ts`
- Test: `packages/core/src/__tests__/tableAltura.test.ts` (criar)

**Interfaces:**
- Produces: `rowHeights?: number[]` em px; `setRowHeight(ctx, blockIndex, row, px)`.

- [ ] **Step 1: Escrever os testes**

```ts
describe("rowHeights acompanha o número de linhas", () => {
  it("insertTableRow cresce o array", () => {
    // Sem isto o TableResizeOverlay cai no `Shape mismatch — bail out` que
    // ele já tem, e as alças simplesmente somem, sem erro nenhum.
    const h = harness();
    insertTable(h.ctx, 3, 2);
    setRowHeight(h.ctx, 1, 0, 40);
    setRowHeight(h.ctx, 1, 1, 40);
    setRowHeight(h.ctx, 1, 2, 40);
    insertTableRow(h.ctx, 1, 1, "below");
    expect(h.doc.getBlockAttrs(1).rowHeights).toHaveLength(4);
  });

  it("deleteTableRow encolhe o array e tira a linha certa", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    setRowHeight(h.ctx, 1, 0, 40);
    setRowHeight(h.ctx, 1, 1, 99);
    setRowHeight(h.ctx, 1, 2, 40);
    deleteTableRow(h.ctx, 1, 1);
    expect(h.doc.getBlockAttrs(1).rowHeights).toEqual([40, 40]);
  });

  it("tabela sem rowHeights não ganha o atributo à toa", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    insertTableRow(h.ctx, 1, 1, "below");
    expect(h.doc.getBlockAttrs(1).rowHeights).toBeUndefined();
  });
});

describe("setRowHeight", () => {
  it("grava px e respeita o piso", () => {
    const h = harness();
    insertTable(h.ctx, 3, 2);
    setRowHeight(h.ctx, 1, 1, 5);
    expect((h.doc.getBlockAttrs(1).rowHeights as number[])[1]).toBe(MIN_LINHA_PX);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar**

```ts
/** Piso de altura de linha, em px. Abaixo disso a linha some da tela. */
export const MIN_LINHA_PX = 16;

export function setRowHeight(
  ctx: CommandContext, blockIndex: number, row: number, px: number,
): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { rows } = ctx.doc.getTableSize(blockIndex);
  if (row < 0 || row >= rows) return;
  transact(ctx.doc, () => {
    const attrsMap = ctx.doc.getBlockAttrsMap(blockIndex);
    if (!attrsMap) return;
    const atual = attrsMap.get("rowHeights") as number[] | undefined;
    const base = Array.isArray(atual) && atual.length === rows
      ? atual.slice()
      : new Array<number>(rows).fill(MIN_LINHA_PX);
    base[row] = Math.max(MIN_LINHA_PX, Math.round(px));
    attrsMap.set("rowHeights", base);
  });
}
```

Em `insertTableRow` e `deleteTableRow`, o mesmo padrão que `colWidths` já
usa — **só mexer quando o atributo existe**, para tabela que nunca foi
redimensionada não passar a carregar o array à toa.

- [ ] **Step 4: Rodar e ver passar**

- [ ] **Step 5: Render nos dois caminhos**

`<tr style={{ height: \`${h}px\` }}>` no `NodeView`, e o equivalente no
`export-pdf`. **O CSS de tabela trata `height` como MÍNIMO** — conteúdo
maior empurra, e é exatamente o comportamento que queremos. Não force
`max-height` nem `overflow: hidden`: texto sumindo da prova é pior que
linha mais alta que o pedido.

- [ ] **Step 6: A suíte de paginação**

Run: `npx vitest run` em `packages/react`.
A paginação fatia tabela por linhas e a medição agora vê altura declarada.
Se quebrar, **pare e reporte** em vez de afrouxar o teste.

- [ ] **Step 7: Commit**

---

### Task 5: Alças de linha, borda de baixo e canto

**Files:**
- Modify: `packages/react/src/TableResizeOverlay.tsx`
- Modify: as três cópias de CSS (playground + os dois apps são outra leva; aqui só o playground)
- Test: `packages/react/src/__tests__/tableAlturaTotal.test.ts` (criar)

**Interfaces:**
- Consumes: `setRowHeight` e `MIN_LINHA_PX` (Task 4) e `setTableWidth`
  (Task 1), todos de `@sofereditor/core`; `deltaPctDoArrasto` (Task 3).
- Produces: `distribuirAltura(base, deltaPx): number[]`, pura.

- [ ] **Step 1: Escrever o teste da distribuição**

```ts
describe("arrastar a base distribui igual entre as linhas", () => {
  it("divide o delta em partes iguais", () => {
    expect(distribuirAltura([40, 40, 40], 30)).toEqual([50, 50, 50]);
  });

  it("PRESERVA as diferenças que o professor ajustou à mão", () => {
    // É o motivo de a divisão ser igual e não proporcional: uma linha que
    // foi deixada alta de propósito continua alta.
    expect(distribuirAltura([40, 80, 40], 30)).toEqual([50, 90, 50]);
  });

  it("respeita o piso ao encolher, sem estourar para negativo", () => {
    expect(distribuirAltura([20, 20, 20], -300)).toEqual([16, 16, 16]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar**

```ts
export function distribuirAltura(base: number[], deltaPx: number): number[] {
  if (base.length === 0) return base;
  const fatia = deltaPx / base.length;
  return base.map((h) => Math.max(MIN_LINHA_PX, Math.round(h + fatia)));
}
```

- [ ] **Step 4: As alças novas**

O `measure()` da Task 3 passa a medir também as bordas de baixo das linhas
(`bottoms`), pelo mesmo caminho que já mede os `rights` das colunas — via
`getBoundingClientRect` de cada `<tr>`, acumulando.

Um estado de arrasto só, discriminado pelo tipo:

```tsx
type Arrasto =
  | { tipo: "coluna"; boundary: number; startX: number; baseWidths: number[]; tableWidthPx: number }
  | { tipo: "larguraTotal"; startX: number; baseWidthPct: number; utilPx: number }
  | { tipo: "linha"; row: number; startY: number; baseHeightPx: number }
  | { tipo: "alturaTotal"; startY: number; baseHeights: number[] }
  | { tipo: "canto"; startX: number; startY: number; baseWidthPct: number; utilPx: number; baseHeights: number[] };

const arrastoRef = useRef<Arrasto | null>(null);
```

```tsx
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = arrastoRef.current;
    if (!d) return;
    // Em TODOS os ramos o delta é contra o estado do pointerdown, nunca
    // contra o que está na tela. É a regra que mata o emborrachado, e ela
    // vale igual para as cinco famílias de alça.
    switch (d.tipo) {
      case "coluna": {
        const dPct = deltaPctDoArrasto(e.clientX - d.startX, d.tableWidthPx);
        editor.setColumnBoundary(blockIndex, d.boundary, dPct, d.baseWidths);
        break;
      }
      case "larguraTotal": {
        const dPct = deltaPctDoArrasto(e.clientX - d.startX, d.utilPx);
        editor.setTableWidth(blockIndex, d.baseWidthPct + dPct);
        break;
      }
      case "linha": {
        editor.setRowHeight(blockIndex, d.row, d.baseHeightPx + (e.clientY - d.startY));
        break;
      }
      case "alturaTotal": {
        aplicarAlturas(distribuirAltura(d.baseHeights, e.clientY - d.startY));
        break;
      }
      case "canto": {
        const dPct = deltaPctDoArrasto(e.clientX - d.startX, d.utilPx);
        editor.setTableWidth(blockIndex, d.baseWidthPct + dPct);
        aplicarAlturas(distribuirAltura(d.baseHeights, e.clientY - d.startY));
        break;
      }
    }
  }, [blockIndex, editor, aplicarAlturas]);
```

`aplicarAlturas` grava o array inteiro numa transação só — chamar
`setRowHeight` em laço geraria uma entrada de undo por linha, e desfazer um
arrasto passaria a exigir N cliques em Ctrl+Z:

```tsx
  const aplicarAlturas = useCallback((alturas: number[]) => {
    editor.setRowHeights(blockIndex, alturas);
  }, [blockIndex, editor]);
```

Isso pede um comando novo no core, irmão do `setRowHeight` da Task 4:

```ts
/** Grava o array inteiro numa transação só — ver o porquê no overlay. */
export function setRowHeights(ctx: CommandContext, blockIndex: number, alturas: number[]): void {
  if (!ctx.doc.isTable(blockIndex)) return;
  const { rows } = ctx.doc.getTableSize(blockIndex);
  if (alturas.length !== rows) return;
  transact(ctx.doc, () => {
    ctx.doc.getBlockAttrsMap(blockIndex)?.set(
      "rowHeights",
      alturas.map((h) => Math.max(MIN_LINHA_PX, Math.round(h))),
    );
  });
}
```

O `onPointerUp` é um só para as cinco: zera o ref, chama `measure()` e
solta a captura.

- [ ] **Step 5: A reancoragem importa MAIS aqui**

Altura de linha é mínimo. Encolher abaixo do conteúdo grava o valor e **não
muda o desenho** — a tabela para de encolher e a alça continuaria descendo
com o dedo. `measure()` no `pointerup` traz a alça de volta para a borda de
verdade.

Verifique isto à mão: tabela com texto longo numa célula, arrastar a base
para bem acima do conteúdo, soltar. A alça tem que voltar para a borda de
baixo real, não ficar onde o dedo largou.

- [ ] **Step 6: CSS do playground**

```css
.ed-row-resize-handle { cursor: row-resize; }
.ed-table-corner-handle { cursor: nwse-resize; }
```

- [ ] **Step 7: Verificação em navegador**

Tabela 3×4: arrastar divisa entre linhas; arrastar a base; arrastar o canto.
Em todos, a borda acompanha o cursor e a alça reancora ao soltar.

- [ ] **Step 8: Commit**

---

### Task 6: Exportações — DOCX e import

**Files:**
- Modify: `packages/export-docx/src/docx.ts:320-340`
- Modify: `packages/import-docx/src/tables.ts`
- Test: `packages/export-docx/src/__tests__/tableProporcao.test.ts` (criar)

**Interfaces:**
- Consumes: `colWidths` em proporção, `tableWidth`, `rowHeights`.

- [ ] **Step 1: Escrever o teste**

```ts
describe("a tabela no Word tem a MESMA largura do editor", () => {
  it("proporção vira twips contra a largura útil da página", async () => {
    // Este é o item que o norte do projeto cobra: hoje o DOCX fixa a soma
    // dos px do modelo (513 px) enquanto o professor vê 600 px na tela e no
    // PDF. Com proporção contra a largura útil, os três passam a bater.
    const doc = await gerar(docComTabela([25, 25, 25, 25]), { pageSettings: "a4" });
    const larguraUtilTwips = mmToTwip(210 - 25.4 - 25.4);
    expect(somaColunas(doc)).toBeCloseTo(larguraUtilTwips, -1);
  });

  it("tableWidth reduz a largura total proporcionalmente", async () => {
    const doc = await gerar(docComTabela([25, 25, 25, 25], 50));
    expect(somaColunas(doc)).toBeCloseTo(mmToTwip(210 - 50.8) / 2, -1);
  });

  it("rowHeights vira w:trHeight com hRule=atLeast", async () => {
    // `atLeast` e não `exact`: é a MESMA semântica de mínimo do editor.
    // Com `exact` o Word cortaria o conteúdo, e texto sumindo da prova é o
    // pior desfecho possível.
    const xml = await xmlDe(docComTabela([25, 25], undefined, [40, 80]));
    expect(xml).toContain('w:hRule="atLeast"');
    expect(xml).not.toContain('w:hRule="exact"');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: Implementar**

```ts
  const larguraUtilTwips = convertMillimetersToTwip(
    larguraPaginaMm(pageSettings) - margemEsqMm(pageSettings) - margemDirMm(pageSettings),
  );
  const tabelaTwips = Math.round(larguraUtilTwips * ((block.attrs.tableWidth ?? 100) / 100));

  // Proporção contra a largura útil REAL da página — é isto que faz a tabela
  // no Word ter a mesma largura do editor. Antes convertia a soma dos px do
  // modelo (513 px numa tabela que o professor via com 600).
  const pct = normalizarLarguras(block.attrs.colWidths, cols);
  const columnWidths = pct.map((p) => Math.round(tabelaTwips * (p / 100)));
```

O `layout: TableLayoutType.FIXED` permanece pelo mesmo motivo de antes: sem
ele o Word autoajusta ao conteúdo e trata `columnWidths` como sugestão.

A altura vai por linha:

```ts
  const alturas = block.attrs.rowHeights;
  const h = Array.isArray(alturas) && alturas.length === rows ? alturas[r] : undefined;
  rowsOut.push(new TableRow({
    children: cellsOut,
    // `atLeast` e NÃO `exact`: é a mesma semântica de mínimo do editor. Com
    // `exact` o Word cortaria o conteúdo, e texto sumindo da prova é o pior
    // desfecho possível.
    ...(h != null
      ? { height: { value: convertMillimetersToTwip(pxToMm(h)), rule: HeightRule.ATLEAST } }
      : {}),
  }));
```

- [ ] **Step 4: Import**

```ts
  // `w:gridCol` chega em twips absolutos. Vira proporção da própria soma —
  // `normalizarLarguras` já faz exatamente isso, então não duplique a conta.
  const twips = gridCols.map((g) => Number(attr(g, "w:w") ?? 0));
  const colWidths = normalizarLarguras(twips, cols);

  // `w:trHeight` também em twips; o editor guarda px.
  const trHeight = findChild(tr, "w:trPr", "w:trHeight");
  const alturaPx = trHeight ? mmToPx(twipToMillimeters(Number(attr(trHeight, "w:val")))) : undefined;
```

Grave `rowHeights` só quando **pelo menos uma** linha trouxer `w:trHeight` —
importar um DOCX sem altura declarada não pode fazer a tabela nascer com o
array preenchido de mínimos, que congelaria linhas que deveriam crescer com
o conteúdo.

- [ ] **Step 5: Round-trip**

Exportar um DOCX com colunas desiguais e altura de linha, reimportar, e
conferir que as proporções e alturas sobrevivem dentro da tolerância de
arredondamento. Este teste é o que pega conversão invertida.

- [ ] **Step 6: Rodar tudo**

Run: `npx vitest run && npx tsc --noEmit` em `export-docx` e `import-docx`.

- [ ] **Step 7: Commit**

---

## Depois das seis tarefas

- **Espelhar o CSS nos dois apps** (`.ed-row-resize-handle`,
  `.ed-table-corner-handle`), com a mesma regra de sempre: o `diff` entre as
  duas cópias tem que continuar reduzindo aos 4 hunks de `@font-face`.
- **Bump coordenado** de `core`, `react`, `export-pdf`, `export-docx` e
  `import-docx` — cinco manifestos mudam.
- **Avisar sobre o DOCX.** Prova já exportada e arquivada sai com largura
  diferente se for reexportada. É correção, mas é visível, e o usuário já
  foi avisado no spec.
