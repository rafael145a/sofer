# Quick wins #15/#16/#17 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir três bugs isolados do editor Sofer — alinhamento de texto em célula de tabela (#15), conseguir escrever abaixo de uma tabela recém-inserida (#16) e remover cursores remotos do print/PDF (#17).

**Architecture:** A lógica nova vive no `@sofereditor/core` (pura, testável com vitest): nova invariante no `insertTable` e novo comando `setCellAttr`. O lado React (`@sofereditor/react`) só roteia o comando e renderiza o atributo; o fix de print é uma linha no `@sofereditor/export-pdf`. Partes de DOM/React não têm harness de teste no repo — são verificadas no playground (padrão existente do projeto).

**Tech Stack:** TypeScript, Y.js (CRDT doc model), Vitest, React, pnpm workspaces.

**Ordem:** núcleo testável primeiro (#16, #15-core), depois a fiação React (#15) e o print (#17), ambos verificados no playground.

**Convenção de teste do repo:** `harness()` cria `new EditorDocument()` (já vem com 1 parágrafo vazio) + um `CommandContext` com `getSelection`/`setSelection` sobre uma variável `selection`. Ver `packages/core/src/__tests__/tables.test.ts:20-39`.

---

## File Structure

- **Modify** `packages/core/src/commands.ts` — `insertTable` (append parágrafo final) + novo `setCellAttr`.
- **Modify** `packages/core/src/types.ts` — `CellAttrs.align`.
- **Modify** `packages/core/src/__tests__/tables.test.ts` — atualizar 6 asserções de `blockCount`; novo `describe` para `setCellAttr`.
- **Modify** `packages/react/src/useEditor.ts` — novo `setAlign` (roteia bloco vs célula) + export no objeto e na interface.
- **Modify** `packages/react/src/Toolbar.tsx` — `onAlign` chama `setAlign`; estado ativo lê align da célula.
- **Modify** `packages/react/src/NodeView.tsx` — `<td>` aplica `style.textAlign`.
- **Modify** `packages/export-pdf/src/pdf.ts` — remover `.ed-remote-cursors` do clone.

Não é preciso editar `packages/core/src/index.ts`: usa `export * from "./commands"` e `"./types"`, então `setCellAttr`/`CellAttrs` saem automaticamente.

---

## Task 1 — #16: `insertTable` garante parágrafo abaixo (TDD core)

**Files:**
- Modify: `packages/core/src/commands.ts:617-631`
- Test: `packages/core/src/__tests__/tables.test.ts`

- [ ] **Step 1: Escrever o teste novo (falha)**

Adicionar dentro do `describe("tables — model + insertion", ...)` em `tables.test.ts`:

```ts
it("insertTable at end of doc appends a trailing empty paragraph", () => {
  const h = harness();
  // doc default = [paragraph]; insere em índice 1 → vira último bloco
  insertTable(h.ctx, 2, 2);
  expect(h.doc.blockCount()).toBe(3); // [paragraph, table, paragraph]
  expect(h.doc.getBlockType(1)).toBe("table");
  expect(h.doc.getBlockType(2)).toBe("paragraph");
  expect(h.doc.getBlockText(2)?.toString()).toBe("");
  // caret continua na célula 0 da tabela
  expect(h.selection.focus).toEqual({ blockIndex: 1, cellIndex: 0, offset: 0 });
});

it("insertTable in the middle does NOT add an extra paragraph", () => {
  const h = harness();
  // cria [p, p] e posiciona o caret no primeiro parágrafo
  h.doc.blocks.insert(1, [createBlockForTest("paragraph")]);
  h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
  const before = h.doc.blockCount(); // 2
  insertTable(h.ctx, 1, 1);
  // tabela entra no índice 1; já havia bloco depois → só +1 bloco (a tabela)
  expect(h.doc.blockCount()).toBe(before + 1); // [p, table, p]
  expect(h.doc.getBlockType(1)).toBe("table");
  expect(h.doc.getBlockType(2)).toBe("paragraph");
});
```

No topo do arquivo, garantir que `collapsedSelection` está importado (já está em `tables.test.ts`). Para criar um parágrafo no teste do meio, importar `createBlock` do core e referenciá-lo como `createBlockForTest`:

```ts
import { createBlock as createBlockForTest } from "../index";
```

(adicionar à lista de imports existente no topo do arquivo).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- tables`
Expected: FAIL — `insertTable at end of doc appends a trailing empty paragraph` espera `blockCount` 3 mas recebe 2.

- [ ] **Step 3: Implementar o fix**

Em `packages/core/src/commands.ts`, dentro de `insertTable`, logo após o `ctx.doc.blocks.insert(insertAt, [createTableBlock(r, c)]);`:

```ts
ctx.doc.blocks.insert(insertAt, [createTableBlock(r, c)]);
// Invariante: documento nunca termina em tabela — o caret precisa de um
// destino editável abaixo dela. Só acrescenta quando a tabela virou o último bloco.
if (insertAt === ctx.doc.blockCount() - 1) {
  ctx.doc.blocks.insert(insertAt + 1, [createBlock("paragraph")]);
}
ctx.setSelection(
  collapsedSelection({ blockIndex: insertAt, cellIndex: 0, offset: 0 }),
);
```

`createBlock` e `createTableBlock` já estão importados em `commands.ts:2`.

- [ ] **Step 4: Rodar e ver passar (novos testes)**

Run: `pnpm --filter @sofereditor/core test -- tables`
Expected: os dois testes novos PASSAM; alguns testes antigos AINDA FALHAM (corrigidos no Step 5).

- [ ] **Step 5: Atualizar as 6 asserções existentes afetadas**

Em `packages/core/src/__tests__/tables.test.ts`:

**(a) linha ~45** — teste "insertTable creates a rows×cols table and lands the caret in cell 0":
```ts
// trocar:
expect(h.doc.blockCount()).toBe(2);
// por:
expect(h.doc.blockCount()).toBe(3); // [paragraph, table, paragraph]
expect(h.doc.getBlockType(2)).toBe("paragraph");
```

**(b) linha ~76** — teste "backspace at offset 0 of a cell is a no-op":
```ts
// trocar:
expect(h.doc.blockCount()).toBe(2);
// por:
expect(h.doc.blockCount()).toBe(3); // [paragraph, table, paragraph]
```

**(c) linha ~156** — teste "deleteTableRow drops a row; deleting the last row deletes the table". Após deletar a última linha, a tabela some, sobrando `[paragraph, paragraph]`:
```ts
// trocar:
expect(h.doc.blockCount()).toBe(1);
expect(h.doc.getBlockType(0)).toBe("paragraph");
// por (assertiva significativa: a tabela sumiu):
expect(h.doc.blockCount()).toBe(2);
expect(h.doc.getBlockType(0)).toBe("paragraph");
expect(h.doc.getBlockType(1)).toBe("paragraph");
```

**(d) linha ~168** — teste "deleteTableColumn drops a column; deleting the last column deletes the table". Mesmo padrão:
```ts
// trocar:
expect(h.doc.blockCount()).toBe(1);
expect(h.doc.getBlockType(0)).toBe("paragraph");
// por:
expect(h.doc.blockCount()).toBe(2);
expect(h.doc.getBlockType(0)).toBe("paragraph");
expect(h.doc.getBlockType(1)).toBe("paragraph");
```

**(e) linhas ~172-183** — teste "deleteTable replaces the table with a paragraph when it was the only block". Com o fix, `insertTable(1,1)` produz `[p, table, p]`; para simular "só uma tabela" é preciso remover OS DOIS parágrafos:
```ts
it("deleteTable replaces the table with a paragraph when it was the only block", () => {
  const h = harness();
  insertTable(h.ctx, 1, 1); // [p, table, p]
  h.doc.blocks.delete(2, 1); // drop trailing paragraph → [p, table]
  h.doc.blocks.delete(0, 1); // drop leading paragraph → [table]
  expect(h.doc.blockCount()).toBe(1);
  expect(h.doc.getBlockType(0)).toBe("table");

  deleteTable(h.ctx, 0);
  expect(h.doc.blockCount()).toBe(1);
  expect(h.doc.getBlockType(0)).toBe("paragraph");
});
```

- [ ] **Step 6: Rodar a suíte de tabelas completa**

Run: `pnpm --filter @sofereditor/core test -- tables`
Expected: PASS (todos, incluindo `tables-spans` e `tables-rect`, que não asseguram `blockCount`).

- [ ] **Step 7: Rodar a suíte inteira do core (regressão)**

Run: `pnpm --filter @sofereditor/core test`
Expected: PASS. Se algum outro teste assumir estrutura pós-`insertTable`, ajustar pela mesma lógica (tabela + parágrafo final).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/commands.ts packages/core/src/__tests__/tables.test.ts
git commit -m "fix(core): insertTable garante parágrafo após tabela final (#16)"
```

---

## Task 2 — #15-core: `CellAttrs.align` + comando `setCellAttr` (TDD core)

**Files:**
- Modify: `packages/core/src/types.ts:66-83`
- Modify: `packages/core/src/commands.ts` (novo `setCellAttr`)
- Test: `packages/core/src/__tests__/tables.test.ts`

- [ ] **Step 1: Adicionar `align` em `CellAttrs`**

Em `packages/core/src/types.ts`, dentro de `interface CellAttrs` (após `covered?: true;`):

```ts
  /** Alinhamento horizontal do texto da célula. Mesmos valores de bloco. */
  align?: AlignValue;
```

`AlignValue` já é declarado neste arquivo (types.ts:15) — não precisa importar.

- [ ] **Step 2: Escrever os testes (falham)**

Novo bloco em `tables.test.ts`. Importar `setCellAttr` na lista de imports do topo (`from "../index"`):

```ts
describe("tables — cell alignment (setCellAttr)", () => {
  it("writes align on the focused single cell", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2); // caret em {block:1, cell:0}
    setCellAttr(h.ctx, "align", "center");
    expect(h.doc.getCellAttrs(1, 0).align).toBe("center");
    // demais células intactas
    expect(h.doc.getCellAttrs(1, 1).align).toBeUndefined();
    expect(h.doc.getCellAttrs(1, 3).align).toBeUndefined();
  });

  it("applies align to all real cells of a rectangular multi-cell selection", () => {
    const h = harness();
    insertTable(h.ctx, 2, 2);
    // selecionar de (0,0) a (1,1): anchor cell 0, focus cell 3
    h.ctx.setSelection({
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 3, offset: 0 },
    });
    setCellAttr(h.ctx, "align", "right");
    expect(h.doc.getCellAttrs(1, 0).align).toBe("right");
    expect(h.doc.getCellAttrs(1, 1).align).toBe("right");
    expect(h.doc.getCellAttrs(1, 2).align).toBe("right");
    expect(h.doc.getCellAttrs(1, 3).align).toBe("right");
  });

  it("value null removes the align key", () => {
    const h = harness();
    insertTable(h.ctx, 1, 1);
    setCellAttr(h.ctx, "align", "justify");
    expect(h.doc.getCellAttrs(1, 0).align).toBe("justify");
    setCellAttr(h.ctx, "align", null);
    expect(h.doc.getCellAttrs(1, 0).align).toBeUndefined();
  });

  it("is a no-op when the caret is not inside a table", () => {
    const h = harness();
    // caret no parágrafo default (block 0, sem cellIndex)
    expect(() => setCellAttr(h.ctx, "align", "center")).not.toThrow();
    // setBlockAttr segue no-op para célula — regressão complementar:
    insertTable(h.ctx, 1, 1);
    setBlockAttr(h.ctx, "align", "center");
    expect(h.doc.getBlockAttrs(1).align).toBeUndefined(); // bloco-tabela não recebe
  });
});
```

Importar também `setBlockAttr` na lista de imports do topo se ainda não estiver.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- tables`
Expected: FAIL — `setCellAttr is not exported` / `is not a function`.

- [ ] **Step 4: Implementar `setCellAttr`**

Em `packages/core/src/commands.ts`, logo após `setBlockAttr` (depois da linha 362):

```ts
/**
 * Set a single attribute on the table cell(s) under the selection.
 * - Caret numa única célula → essa célula (tableRectSelection retorna null
 *   para seleção colapsada, então usamos a célula focada).
 * - Seleção retangular de várias células → todas as células reais do rect.
 * Células `covered` são puladas. `value === null` apaga a key.
 * No-op se a seleção não estiver dentro de uma tabela.
 */
export function setCellAttr<K extends keyof CellAttrs>(
  ctx: CommandContext,
  key: K,
  value: CellAttrs[K] | null,
): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    const { blockIndex, cellIndex } = sel.focus;
    if (cellIndex == null || !ctx.doc.isTable(blockIndex)) return;
    const { cols } = ctx.doc.getTableSize(blockIndex);
    if (cols <= 0) return;
    const rect = tableRectSelection(ctx.doc, sel);
    const targets: number[] = [];
    if (rect) {
      for (let r = rect.top; r <= rect.bottom; r++)
        for (let c = rect.left; c <= rect.right; c++) targets.push(r * cols + c);
    } else {
      targets.push(cellIndex);
    }
    for (const flat of targets) {
      if (ctx.doc.getCellAttrs(blockIndex, flat).covered) continue;
      const m = ctx.doc.getCellAttrsMap(blockIndex, flat);
      if (!m) continue;
      if (value === null || value === undefined) m.delete(key as string);
      else m.set(key as string, value);
    }
    ctx.setSelection(sel);
  });
}
```

Garantir que `CellAttrs` está no bloco de `import type` do topo de `commands.ts` (junto de `BlockAttrs`/`Selection`/`Position`). `tableRectSelection`, `getTableSize`, `getCellAttrs`, `getCellAttrsMap` já existem (mesmo arquivo / `EditorDocument`).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test -- tables`
Expected: PASS (incluindo o no-op de `setBlockAttr` em célula).

- [ ] **Step 6: Typecheck do core**

Run: `pnpm --filter @sofereditor/core typecheck`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/commands.ts packages/core/src/__tests__/tables.test.ts
git commit -m "feat(core): setCellAttr + CellAttrs.align p/ alinhamento em célula (#15)"
```

---

## Task 3 — #15-react: roteamento `setAlign` + render no `<td>` (playground-verify)

> Sem unit test: o pacote `@sofereditor/react` roda `vitest run --passWithNoTests` e não tem testes de DOM/React (padrão do repo). Validação é no playground (Step 6). O typecheck cobre a corretude de tipos.

**Files:**
- Modify: `packages/react/src/useEditor.ts` (novo `setAlign` + export + interface)
- Modify: `packages/react/src/Toolbar.tsx` (`onAlign` usa `setAlign`; estado ativo lê célula)
- Modify: `packages/react/src/NodeView.tsx:197-209` (`<td>` aplica `textAlign`)

- [ ] **Step 1: Adicionar `setAlign` em `useEditor.ts`**

Importar o comando no topo do arquivo (junto dos outros `cmd*`):
```ts
import { setCellAttr as cmdSetCellAttr } from "@sofereditor/core";
```
(o import existente já é de `@sofereditor/core`; adicionar o nome à lista, ou nova linha no mesmo estilo de `setBlockAttr as cmdSetBlockAttr`).

Adicionar o callback junto de `setBlockAttr` (perto da linha 439). Usa `ctxRef`/`selectionRef`, os mesmos refs dos outros comandos:
```ts
const setAlign = useCallback((value: AlignValue) => {
  const sel = selectionRef.current;
  const inCell = sel.anchor.cellIndex != null || sel.focus.cellIndex != null;
  if (inCell) cmdSetCellAttr(ctxRef.current, "align", value);
  else cmdSetBlockAttr(ctxRef.current, "align", value);
}, []);
```
Importar `AlignValue` do core no `import type` do topo, se ainda não estiver.

Adicionar `setAlign` ao objeto retornado (perto da linha 688, junto de `setBlockAttr`):
```ts
  setBlockAttr,
  setAlign,
```

Adicionar à interface pública do editor (onde `setBlockAttr` é declarado, ~linha 118):
```ts
  setAlign: (value: AlignValue) => void;
```

- [ ] **Step 2: Adicionar leitura de align de célula em `useEditor.ts`**

Para o botão ativo refletir a célula, adicionar um helper `getAlign` ao lado de `getBlockAttr`:
```ts
const getAlign = useCallback((): AlignValue | "mixed" | undefined => {
  const sel = selectionRef.current;
  if (sel.focus.cellIndex != null && doc.isTable(sel.focus.blockIndex)) {
    return doc.getCellAttrs(sel.focus.blockIndex, sel.focus.cellIndex).align;
  }
  return doc.getBlockAttrs(sel.focus.blockIndex).align;
}, [doc]);
```
Exportar `getAlign` no objeto e na interface (junto de `getBlockAttr`):
```ts
  getAlign: () => AlignValue | "mixed" | undefined;
```

- [ ] **Step 3: Fiar o Toolbar (`Toolbar.tsx`)**

Puxar os novos métodos do editor (no destructuring ~linha 62) e usar:
```ts
const { /* ...existentes..., */ setAlign, getAlign } = editor;
```
Trocar a leitura do estado ativo (linha ~80):
```ts
// de:
const blockAlign = getBlockAttr("align");
// para:
const blockAlign = getAlign();
```
No fim de `onAlign` (linha ~136), trocar a chamada:
```ts
// de:
setBlockAttr("align", value);
// para:
setAlign(value);
```
O ramo de imagem-embed (linhas 123-131) fica inalterado.

- [ ] **Step 4: Renderizar o alinhamento no `<td>` (`NodeView.tsx`)**

No `<td>` dentro de `TableView` (linha ~197), adicionar a prop `style`:
```tsx
<td
  key={c}
  data-cell-index={flat}
  data-cell-row={r}
  data-cell-col={c}
  data-cell-rowspan={rowspan}
  data-cell-colspan={colspan}
  rowSpan={rowspan > 1 ? rowspan : undefined}
  colSpan={colspan > 1 ? colspan : undefined}
  style={cell?.attrs.align ? { textAlign: cell.attrs.align } : undefined}
  className={inRect ? "ed-cell ed-cell--selected" : "ed-cell"}
>
```
`cell.attrs.align` já chega via serialização (confirmado em `document.ts:365`).

- [ ] **Step 5: Typecheck dos pacotes React e core**

Run: `pnpm --filter @sofereditor/react typecheck && pnpm --filter @sofereditor/core typecheck`
Expected: sem erros (em especial `AlignValue` e `getAlign` consistentes).

- [ ] **Step 6: Verificação visual no playground**

Run: `pnpm --filter @sofereditor/playground dev` (ou o script de dev do app; ver `apps/playground/package.json`).
Passos:
1. Inserir uma tabela.
2. Clicar numa célula, digitar texto, clicar nos botões de alinhamento (esquerda/centro/direita/justificar) → o texto da célula deve mover; o botão ativo deve refletir o alinhamento da célula.
3. Selecionar várias células e alinhar → todas mudam.
4. Fora da tabela, alinhar um parágrafo → comportamento atual preservado.
Expected: todos os passos OK.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/useEditor.ts packages/react/src/Toolbar.tsx packages/react/src/NodeView.tsx
git commit -m "feat(react): alinhamento de texto em célula de tabela (#15)"
```

---

## Task 4 — #17: remover cursores remotos do print/PDF (playground-verify)

> Sem unit test: `serializePaginatedHtml` opera sobre o DOM e o repo não tem ambiente jsdom (a linha vizinha `.ed-image-overlay` também não tem teste). Validação no playground (Step 3).

**Files:**
- Modify: `packages/export-pdf/src/pdf.ts:81`

- [ ] **Step 1: Remover a overlay de cursores do clone**

Em `packages/export-pdf/src/pdf.ts`, logo após a linha que remove `.ed-image-overlay` (linha 81):
```ts
clone.querySelectorAll(".ed-image-overlay").forEach((el) => el.remove());
clone.querySelectorAll(".ed-remote-cursors").forEach((el) => el.remove());
```

- [ ] **Step 2: Build + typecheck do pacote**

Run: `pnpm --filter @sofereditor/export-pdf typecheck && pnpm --filter @sofereditor/export-pdf test`
Expected: sem erros; os testes existentes de `documentToHtmlFragment` continuam passando (não tocamos nesse caminho).

- [ ] **Step 3: Verificação visual no playground**

Com dois participantes (ou simulando um cursor remoto via awareness), imprimir/exportar PDF:
1. Garantir que um cursor remoto está visível na tela (overlay `.ed-remote-cursors`).
2. Acionar o print local (botão que chama `exportPdfFromElement`) e/ou o snapshot (`saveSnapshot`).
3. Conferir que o PDF/preview não contém nenhum cursor remoto.
Expected: cursores ausentes na saída; conteúdo e paginação intactos.

- [ ] **Step 4: Commit**

```bash
git add packages/export-pdf/src/pdf.ts
git commit -m "fix(export-pdf): remove cursores remotos do print/snapshot (#17)"
```

---

## Verificação final

- [ ] Rodar o core inteiro: `pnpm --filter @sofereditor/core test` → PASS.
- [ ] Typecheck dos três pacotes tocados: core, react, export-pdf → sem erros.
- [ ] Conferir os três critérios de aceite do spec (`docs/superpowers/specs/2026-06-17-quick-wins-tabela-print-design.md`).

---

## Self-review (preenchido)

- **Cobertura do spec:** #15 (CellAttrs.align + setCellAttr + setAlign + `<td>`) → Tasks 2 e 3. #16 (parágrafo após tabela) → Task 1. #17 (cursores no print) → Task 4. Todos cobertos.
- **Sem placeholders:** todo passo de código tem o código real; todo comando de teste tem o `pnpm --filter` exato e o resultado esperado.
- **Consistência de tipos:** `AlignValue` (core types.ts:15) usado em `CellAttrs.align`, `setCellAttr`, `setAlign`, `getAlign`. Comando `setCellAttr` com a mesma assinatura genérica `<K extends keyof CellAttrs>` de `setBlockAttr`. `cell?.attrs.align` no render casa com `CellAttrs.align`.
- **Ripple de teste tratado:** as 6 asserções de `blockCount` em `tables.test.ts` estão listadas individualmente no Task 1 Step 5.
