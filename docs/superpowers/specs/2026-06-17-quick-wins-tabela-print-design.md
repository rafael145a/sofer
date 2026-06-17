# Spec — Quick wins: alinhamento em célula, parágrafo após tabela, cursores no print

**Data:** 2026-06-17
**Bugs:** #15, #16, #17 (de `docs/bugs.md`)
**Origem:** `docs/bugs-root-cause.md` (cluster "isolados", confiança 🟢)
**Escopo:** três correções pequenas, independentes e de baixo risco. Cada uma toca poucos arquivos e não altera arquitetura.

---

## Contexto

O editor Sofer tem o documento como Y.Doc: blocos num `Y.Array`, cada bloco com `Y.Text` + `Y.Map` de attrs; tabelas com células row-major `Y.Array<Y.Map>`. Os três bugs são gaps localizados, já confirmados por leitura do código.

---

## #17 — Remover cursores remotos ao imprimir/exportar

### Causa (confirmada)
`serializePaginatedHtml` (`packages/export-pdf/src/pdf.ts:72-114`) clona o DOM vivo do editor e remove apenas `.ed-image-overlay` (linha 81). A overlay de cursores remotos (`.ed-remote-cursors`, renderizada por `RemoteCursorsOverlay`) permanece no clone, indo para o PDF. Os dois caminhos de saída usam essa função: print local (`exportPdfFromElement`) e snapshot para o servidor (`saveSnapshot.ts`).

### Fix
Após a linha 81 de `pdf.ts`, remover a overlay de cursores do clone:

```ts
clone.querySelectorAll(".ed-remote-cursors").forEach((el) => el.remove());
```

Remover do DOM (não esconder por CSS) — sai do arquivo final, menor e sem risco de vazar em outro media query.

### Arquivos
- `packages/export-pdf/src/pdf.ts`

### Critério de aceite
- O HTML retornado por `serializePaginatedHtml` não contém nenhum nó com classe `ed-remote-cursors`.
- Ambos os caminhos (print + snapshot) ficam limpos, por compartilharem a função.

> **Testabilidade:** `serializePaginatedHtml` opera sobre o DOM (`cloneNode`/`querySelectorAll`) e o repo não tem ambiente jsdom/happy-dom nem testes de DOM (mesmo a linha vizinha `.ed-image-overlay` não tem teste). Para não inflar infra, este fix é verificado **manualmente no playground** (imprimir com cursor remoto presente → confirmar ausência), não por unit test.

---

## #16 — Permitir escrever abaixo da tabela

### Causa (confirmada)
`insertTable` (`packages/core/src/commands.ts:617-631`) insere a tabela em `focusBlock + 1` e posiciona o caret na célula 0, mas **nunca acrescenta um bloco depois**. Se a tabela for inserida no fim do documento, vira o último bloco e o caret não tem destino editável abaixo dela. O padrão "garantir parágrafo" já existe em `deleteTable` (linha 638).

### Fix
Dentro da mesma transação, depois do `ctx.doc.blocks.insert(insertAt, ...)`, garantir que o documento não termine em tabela:

```ts
ctx.doc.blocks.insert(insertAt, [createTableBlock(r, c)]);
// Invariante: documento nunca termina em tabela — caret precisa de destino abaixo.
if (insertAt === ctx.doc.blockCount() - 1) {
  ctx.doc.blocks.insert(insertAt + 1, [createBlock("paragraph")]);
}
ctx.setSelection(
  collapsedSelection({ blockIndex: insertAt, cellIndex: 0, offset: 0 }),
);
```

`createBlock` e `createTableBlock` já estão importados em `commands.ts`. O caret permanece na célula 0 da tabela — só passamos a ter um parágrafo vazio abaixo quando necessário.

### Arquivos
- `packages/core/src/commands.ts`

### Critério de aceite
- Inserir tabela no fim do documento deixa exatamente um parágrafo vazio depois dela.
- Inserir tabela no meio (já há bloco depois) **não** adiciona parágrafo extra.
- Caret final fica em `{ blockIndex: insertAt, cellIndex: 0, offset: 0 }` nos dois casos.

> **Fronteira documentada:** a invariante é garantida só no momento do `insertTable`. Uma tabela que chegue à última posição por outro caminho (deleção do bloco seguinte, carga de doc legado terminando em tabela) ainda não teria parágrafo abaixo. Escopo aprovado é o insert; reforçar a invariante na normalização fica para depois, se necessário.
>
> **Impacto em testes existentes:** muda `blockCount` após `insertTable` em `tables.test.ts` (6 asserções). São atualizações mecânicas — comportamento novo esperado, não regressão. O plano lista cada uma.

---

## #15 — Alinhamento de texto dentro de célula de tabela (Opção A)

### Causa (confirmada — três camadas)
1. **Comando:** `setBlockAttr` (`commands.ts:340-362`) retorna cedo quando a seleção está numa célula (`if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;`, linha 347). O Toolbar chama `setBlockAttr("align", value)` (`Toolbar.tsx:136`), então o clique não escreve nada.
2. **Storage:** `CellAttrs` (`types.ts:66-83`) não tem campo `align`.
3. **Render:** `TableView` (`NodeView.tsx:197-209`) monta o `<td>` sem `style.textAlign`, embora `cell.attrs` já chegue ao componente (linhas 188-190 leem `covered`/`rowspan`/`colspan`).

### Design — Opção A: comando de célula dedicado + roteamento por seleção

Mantém `setBlockAttr` puro (o early-return continua protegendo as outras keys) e cria base para futuros atributos de célula.

**1. Tipo — `packages/core/src/types.ts`**
Adicionar `align` a `CellAttrs`, reusando o tipo de alinhamento de bloco:

```ts
export interface CellAttrs {
  rowspan?: number;
  colspan?: number;
  covered?: true;
  /** Alinhamento horizontal do texto da célula. Espelha BlockAttrs["align"]. */
  align?: BlockAttrs["align"];
}
```

**2. Comando — `packages/core/src/commands.ts`**
Novo `setCellAttr`, escrevendo no `Y.Map` de attrs da célula via o helper existente `doc.getCellAttrsMap(blockIndex, cellIndex)` (`document.ts:184`). Aplica a **todas as células reais da seleção retangular** (reusa `tableRectSelection`, já definido neste arquivo na linha 1021). Pula células `covered`.

```ts
export function setCellAttr<K extends keyof CellAttrs>(
  ctx: CommandContext,
  key: K,
  value: CellAttrs[K] | null,
): void {
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    const { blockIndex, cellIndex } = sel.focus;
    if (cellIndex == null || !ctx.doc.isTable(blockIndex)) return;
    const { cols } = ctx.doc.getTableSize(blockIndex); // document.ts:160
    if (cols <= 0) return;
    // Seleção multi-célula → todas as células do rect; caret numa só célula
    // (tableRectSelection retorna null p/ seleção colapsada) → só a focada.
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

> **Caso base é célula única.** `tableRectSelection` retorna `null` para seleção colapsada (commands.ts:1034), então o caminho `else` cobre o clique-e-alinha numa célula. O rect só entra quando há seleção de várias células. `rect.{top,bottom,left,right}` são índices 0-based; `cols` de `doc.getTableSize`.
> **Serialização OK:** `serializeCell` (document.ts:365) copia o map de attrs inteiro via `Object.fromEntries`, então `align` chega ao `<td>` sem mudança extra.

**3. Roteamento — `packages/react/src/useEditor.ts`**
Expor um `setAlign(value)` que decide o destino pela seleção:

```ts
const setAlign = useCallback((value: AlignValue) => {
  const sel = selectionRef.current; // seleção corrente já usada pelos outros comandos
  const inCell =
    sel.anchor.cellIndex != null || sel.focus.cellIndex != null;
  if (inCell) cmdSetCellAttr(ctx, "align", value);
  else cmdSetBlockAttr(ctx, "align", value);
}, [...]);
```

Exportar `setAlign` no objeto do editor (junto de `setBlockAttr`, linha 688).

**4. Toolbar — `packages/react/src/Toolbar.tsx`**
`onAlign` (linhas 121-136) passa a chamar `setAlign(value)` em vez de `setBlockAttr("align", value)`. O ramo de imagem-embed (linhas 123-131) permanece como está. `getBlockAttr("align")` para o estado ativo do botão deve, quando o caret está em célula, ler `cell.attrs.align` — ajuste menor de leitura (detalhado no plano).

**5. Render — `packages/react/src/NodeView.tsx`**
No `<td>` (linha 197), aplicar o alinhamento da célula:

```tsx
<td
  ...
  style={cell?.attrs.align ? { textAlign: cell.attrs.align } : undefined}
  className={inRect ? "ed-cell ed-cell--selected" : "ed-cell"}
>
```

`cell.attrs.align` já flui pela serialização (`serializeCell`, `document.ts:359`, copia o map de attrs — mesmo caminho de `covered`).

### Arquivos
- `packages/core/src/types.ts`
- `packages/core/src/commands.ts`
- `packages/react/src/useEditor.ts`
- `packages/react/src/Toolbar.tsx`
- `packages/react/src/NodeView.tsx`

### Critério de aceite
- Com o caret numa célula, clicar left/center/right/justify escreve `align` no(s) attrs da(s) célula(s) e o `<td>` renderiza `text-align` correspondente.
- Seleção retangular de múltiplas células aplica a todas as células reais (covered são puladas).
- Fora de tabela, `setAlign` continua escrevendo no bloco (comportamento atual preservado).
- `setBlockAttr` permanece no-op para seleção em célula (não regrediu).
- O botão de alinhamento ativo reflete o estado da célula quando o caret está dentro dela.

---

## Estratégia de testes

Projeto usa TDD. Cada fix tem teste antes da implementação.

**Unit (core):**
- `insertTable`: (a) no fim do doc → parágrafo vazio aparece depois; (b) no meio → sem parágrafo extra; (c) caret na célula 0 nos dois casos.
- `setCellAttr`: escreve `align` na célula focada; aplica à seleção retangular; pula `covered`; `value=null` apaga a key.
- `setBlockAttr`: continua no-op para seleção em célula (regressão).

**Unit (export-pdf):**
- `serializePaginatedHtml`: dado um root com `.ed-remote-cursors`, o HTML retornado não contém a classe. Confirmar que `.ed-image-overlay` continua removido (regressão).

**Verificação visual (playground, ao final):**
- #15: alinhar texto numa célula e ver o `text-align` aplicar na tela.
- #16: inserir tabela no fim e conseguir clicar/escrever abaixo dela.

---

## Fora de escopo
- #11 (legenda lagada), cluster A clipboard (#7/#8/#14), cluster B comentários (#2/#3/#5), cluster C/D imagem e seleção. Cada um terá seu próprio spec.
- Alinhamento vertical de célula, background de célula e outros atributos futuros (o `setCellAttr` apenas abre o caminho).

---

## Ordem de implementação sugerida
1. #17 (1 linha + teste) — destrava confiança.
2. #16 (poucas linhas + teste) — independente.
3. #15 (5 arquivos) — maior, isolado no fim.
