# Consertar drag de imagem flutuante pós-#11 (figure posicionado) — Design

**Data:** 2026-06-18
**Status:** aprovado (design)
**Contexto:** regressão descoberta na verificação visual do #9.

## Problema

O fix do bug #11 (`renderInline.tsx`, commit `7431263`) passou a SEMPRE envolver a imagem num `<figure className="ed-figure">`, e moveu o `outerStyle` (posicionamento) do `<img>` para o `<figure>`. Resultado (confirmado no browser):
- `<figure>`: `position:absolute; top; left; width; z-index` (o elemento posicionado).
- `<img>`: `position:static`, só `width/height/display:block`.

O `ImageResizeOverlay` (MoveHandle, `onPointerMove`, ~linhas 298-327) muta **`img.style.left/top`** (behind/front) e **`img.style.margin*`** (wrap). Como o `<img>` agora é `position:static`, `top/left` são **ignorados** e as margens não afetam o float (que mora no figure). **Prova empírica:** `img.style.top='1500px'` não move a imagem; `figure.style.top='1500px'` move.

Consequências:
1. Arrastar imagem **behind/front/wrap** não move mais a imagem (regressão direta do #11, afeta toda imagem flutuante).
2. **#9 bloqueado:** a imagem não se move no drag → nunca cruza de página → o re-âncora do `finish` nunca dispara.

O handler de **resize** NÃO está funcionalmente quebrado: ele seta `img.style.width/height` (+ `img.width/height`), que se aplicam ao `<img>` independente de posição; a `width` do figure só atualiza no commit (lag visual menor de outline/fluxo, sem quebra). **Fora de escopo** deste fix.

## Objetivo

Restaurar o arrastar (move) de imagens flutuantes (`behind`/`front`/`wrap-left`/`wrap-right`), mantendo o fix do #11 intacto, e desbloquear a verificação do #9.

## Arquitetura

Em `packages/react/src/ImageResizeOverlay.tsx`, no `onPointerMove` do **MoveHandle** (não o do ResizeHandle), resolver o elemento que carrega o posicionamento e aplicar as mutações de estilo nele:

```ts
const styled = imgRef.current.closest<HTMLElement>(".ed-figure") ?? imgRef.current;
```

- `behind`/`front`: `styled.style.left/top = ...` (antes era `img.style.left/top`).
- `wrap-left`: `styled.style.marginRight/marginTop = ...`.
- `wrap-right`: `styled.style.marginLeft/marginTop = ...`.

Seletor é **`.ed-figure`** (classe sempre presente pós-#11). NÃO usar `[data-embed-figure]` — esse atributo só existe quando há legenda (decisão do #11: `data-embed-figure={hasCaption ? "true" : undefined}`). Fallback `?? imgRef.current` por robustez (se algum dia a estrutura mudar).

`finish` e `clampedCommit` continuam lendo `imgRef.current.getBoundingClientRect()`: o `<img>` preenche o `<figure>` (behind/front justos), então o rect/centro usados na detecção de página e no clamp seguem corretos. `d.liveOX/liveOY` (valores de modelo p/ commit) inalterados.

No commit (`onCommitMove`→`setImageAttrs` ou `onReanchor`→`moveEmbedAnchor`) o React re-renderiza e o `renderInline` reaplica o `outerStyle` no figure a partir do modelo, substituindo o estilo imperativo do drag — igual ao fluxo pré-#11.

## Componentes e responsabilidades

| Unidade | Responsabilidade | Muda |
|---|---|---|
| `MoveHandle.onPointerMove` (overlay) | mover o **elemento posicionado** (`.ed-figure`) durante o drag | sim |
| `MoveHandle.finish`/`clampedCommit` | detecção de página + clamp via rect do `<img>` | não (img segue o figure) |
| `ResizeHandle` | resize via `img.style.width/height` | não (fora de escopo) |
| `renderInline` (#11) | estrutura figure>img + outerStyle no figure | não |

## Edge cases

- **Sem legenda:** figure existe (`.ed-figure`) sem `data-embed-figure` → seletor `.ed-figure` acerta.
- **Com legenda:** mesmo figure; mover behind/front com legenda continua funcionando.
- **Tabela (cellIndex):** fora de escopo do #9; o move dentro de célula segue o caminho atual (o `closest('.ed-figure')` ainda acha o figure da imagem na célula, então o move visual também é corrigido — sem regressão).
- **Fallback:** se `closest('.ed-figure')` for null (estrutura inesperada), cai no `img` — comportamento pré-fix.

## Testes / Verificação

Sem harness DOM para interação de drag (convenção do pacote: manual). Verificação **manual no playground** (`apps/playground`, `window.__editor` debug hook temporário):
1. Imagem `behind` numa página → arrastar pelo move-handle → a imagem **acompanha** o cursor (move funciona de novo).
2. **#9:** documento com 2 páginas, imagem `behind` na página 1 → arrastar cruzando a borda, soltando na página 2 (com a página 2 visível no viewport) → a imagem **re-ancora** num bloco da página 2 e **fica visível** onde foi solta; modelo: `blockIndex` muda para um bloco da página 2.
3. Mesma-página → sem regressão (offsets mudam, sem re-âncora). Soltar além da última página → clamp.
4. `wrap-left/right` → arrastar ajusta as margens (gap ao texto) de novo.

## Deploy

`@sofereditor/react` → rebuild + republish p/ os portais (junto com o #11 e o #9). Ver `editor-monorepo-pkg-resolution-dist-vs-src`.

## Fora de escopo

- Polir o resize live (figure width acompanhar) — não está quebrado.
- Mudar o contrato do #11 ou o renderInline.
