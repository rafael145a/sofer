# Re-ancorar imagem flutuante ao mover entre páginas (bug #9) — Design

**Data:** 2026-06-17
**Status:** aprovado (design), pendente spec-review do usuário
**Bug:** docs/bugs.md #9 — "quando move a imagem de uma página para outra ela some atrás da paginação"

## Problema

Imagens não-inline (`behind`/`front`) são renderizadas com `position: absolute; left: offsetX; top: offsetY`, relativas ao fragmento `.ed-block` da sua âncora (o positioned ancestor). A âncora é um caractere no `Y.Text` do bloco, num `offset`; a imagem **segue o parágrafo** durante a repaginação.

Mover a imagem (arrastar pelo `MoveHandle`) altera **apenas `offsetX/offsetY`** no mesmo bloco-âncora. Como `.ed-page` e `.ed-page-content` têm `overflow: hidden`, quando o `offsetY` empurra a imagem para além da caixa de conteúdo da página-âncora, a imagem é **clipada** — continua no DOM mas não é pintada. A overlay de seleção sobrevive (mora no `.ed-root`, fora do clip), produzindo a assinatura "some a imagem, fica o contorno".

### Causa-raiz (confirmada empiricamente)

Repro no playground (A4, imagem `behind` ancorada num bloco no topo, `offsetY: 1050`):
- imagem em `top:1352..1495`; `.ed-page-content` termina em `bottom:1327`.
- ancestrais `.ed-page-content` e `.ed-page` com `overflow:hidden` cortam a imagem.
- `document.elementFromPoint(centro)` → `null` (não pintada). Print: imagem cortada na borda inferior, junto ao rodapé.

## Objetivo

Quando o usuário arrasta uma imagem flutuante e solta numa região visualmente pertencente a **outra página**, a imagem deve **re-ancorar** a um bloco daquela página (comportamento Word-like) e permanecer visível onde foi solta — em vez de ser clipada.

Não-objetivo: mudar `overflow:hidden` das páginas (necessário para clipar fragmentos de texto), nem mudar a semântica de ancoragem por bloco (a imagem deve continuar seguindo reflow do seu parágrafo).

## Arquitetura

### 1. Core — novo comando `moveEmbedAnchor`

`packages/core/src/commands.ts`:

```
moveEmbedAnchor(
  ctx,
  from: { blockIndex: number; offset: number; cellIndex?: number },
  to:   { blockIndex: number; offset: number; cellIndex?: number },
  newOffsetX: number,
  newOffsetY: number,
): void
```

Numa **única transação** Y.Doc:
1. Lê o embed do `Y.Text` de origem (`ctx.doc.textAt(from.blockIndex, from.cellIndex)`), localizando-o em `from.offset` (mesma varredura de delta do `setImageAttrs`).
2. Guard: só prossegue se `isImageEmbed` **e** `layout` ∈ {`front`,`behind`,`wrap-left`,`wrap-right`} (não-inline). Caso contrário, no-op.
3. `merged = { ...embed, offsetX: newOffsetX, offsetY: newOffsetY }`.
4. `srcYText.delete(from.offset, 1)`.
5. `dstYText.insert(clamp(to.offset, 0, dstYText.length), merged)`.
   - Quando `from` e `to` apontam o **mesmo** `Y.Text`, ajustar `to.offset` se for > `from.offset` (a deleção desloca índices) — ou delegar ao `setImageAttrs` existente (mesma-âncora) para evitar o caso degenerado.

Transação única garante atomicidade CRDT (delete em A + insert em B sem estado intermediário observável por outros peers).

### 2. React — detecção do destino no drop

`packages/react/src/ImageResizeOverlay.tsx` (`MoveHandle.finish`) já tem `imgRef.current.getBoundingClientRect()`. Ao soltar:

1. **Página destino:** `document.elementFromPoint(imgCenterX, imgCenterY)?.closest('.ed-page')`. Se `null` (soltou fora de qualquer página) → cair na rede de segurança (item 3).
2. **Página atual da âncora:** `getFragmentForOffset(root, blockIndex, offset)?.closest('.ed-page')`.
3. **Mesma página** → caminho atual: `onCommitMove(offsetX, offsetY)` (= `setImageAttrs`). Sem mudança de comportamento.
4. **Página diferente** → re-ancorar:
   - **Bloco-âncora destino:** `findBlockIndex(elAtDropPoint, root)` no canto superior-esquerdo da imagem. Se `null` (soltou em espaço vazio da página), fallback: o **último** fragmento de bloco renderizado naquela página (`[data-block-index]` dentro da `.ed-page` destino, o de maior `data-block-index`/posição).
   - **Offset destino:** o `fragmentStart` do fragmento escolhido (primeiro offset que renderiza naquela página) — garante que a âncora cai na fração do bloco que vive na página destino.
   - **Recálculo de coordenadas:** `newOffsetX = imgRect.left - fragPaddingBox.left`; `newOffsetY = imgRect.top - fragPaddingBox.top` (padding-box do fragmento destino), para a imagem ficar visualmente onde foi solta.
   - Chama um callback novo `onReanchor(to, newOffsetX, newOffsetY)` exposto pelo `Editor` → `editor.moveEmbedAnchor(...)`.

`Editor.tsx` passa `onReanchor` à overlay (análogo ao `onCommitMove` atual) e atualiza a seleção.

### 3. Rede de segurança (clamp)

Se não houver página destino válida (soltou além da última página / fora das páginas), faz **clamp** do `offsetY` (e re-âncora à última página, se aplicável) para manter a imagem dentro da caixa de conteúdo da página mais próxima. Invariante: **a imagem nunca fica clipada/invisível** após um move.

### 4. Seleção

Após `moveEmbedAnchor`, o `(blockIndex, offset)` do embed muda. `Editor` atualiza a seleção para o novo embed (cobrindo o caractere do embed: `anchor=offset`, `focus=offset+1`) para a overlay continuar grudada.

## Componentes e responsabilidades

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `moveEmbedAnchor` (core) | mover o embed entre `Y.Text`s numa transação, atualizando offsets | `doc.textAt`, `isImageEmbed`, `transact` |
| `MoveHandle.finish` (react) | calcular página/bloco destino + novas coords no drop | `elementFromPoint`, `findBlockIndex`, `getFragmentForOffset` |
| `Editor` (react) | fiar `onReanchor` → `moveEmbedAnchor` + atualizar seleção | `useEditor` |
| `useEditor` (react) | expor `moveEmbedAnchor` no objeto editor | core command |

## Edge cases

- **Imagem maior que a página / cruzando 2 páginas:** ancora pela página do **centro** da imagem.
- **Bloco destino fragmentado (multi-página):** offset = `fragmentStart` do fragmento na página destino (não offset 0 do bloco) → âncora na fração certa.
- **Soltar em espaço vazio da página:** fallback para o último fragmento de bloco da página.
- **Página destino sem blocos (vazia):** sem fragmento → cai no clamp (mantém na página de origem, sem sumir).
- **Tabelas (`cellIndex`):** imagens flutuantes dentro de célula estão fora de escopo deste fix (re-âncora só entre blocos top-level). Manter caminho atual.
- **Export PDF/DOCX:** leem o modelo; o embed só mudou de bloco/offsets → consistente. Sem mudança no export.
- **Collab (Hocuspocus):** delete+insert em uma transação → CRDT-safe; origin do comando filtrado pelo UndoManager como hoje.

## Testes

- **Core (jsdom, `packages/core/src/__tests__/`):** unit tests de `moveEmbedAnchor`:
  - move embed de bloco A→B preservando atributos (src, width, height, layout, caption) e aplicando novos offsets;
  - guard inline (no-op para `layout: inline`/sem layout);
  - caso mesma-âncora (from===to) não duplica nem perde o embed;
  - tudo numa única transação (1 entrada de undo).
- **React/UX (browser — `apps/playground`, sem harness de DOM no pacote):** verificação manual dirigindo Chrome:
  - arrastar imagem `front`/`behind` cruzando a borda da página → re-ancora na página destino e **permanece visível** onde foi solta;
  - mesma-página → sem regressão (offsets mudam, sem re-âncora);
  - soltar além da última página → clamp, imagem não some;
  - overlay continua grudada após re-âncora.

## Deploy

Vive em `@sofereditor/core` + `@sofereditor/react` → precisa **rebuild + republish** dos pacotes para chegar aos portais (`portal2-next`, `portal-professores/frequencia-ocorrencia`). Ver memória `editor-monorepo-pkg-resolution-dist-vs-src`.

## Fora de escopo

- #6 (link) e #11 (legenda lagada) — itens separados.
- Imagens flutuantes ancoradas em células de tabela.
- Mudar `overflow` das páginas ou a semântica de ancoragem por bloco.
