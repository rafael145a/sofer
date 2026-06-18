# #9 Tier 1 — detecção de página por geometria + clamp no re-âncora — Design

**Data:** 2026-06-18
**Status:** aprovado (design)
**Bug:** docs/bugs.md #9. A 1ª implementação (re-âncora no drop) foi reaberta: na verificação visual frame-a-frame a imagem clipava/voltava pro fundo da página 1.

## Causa-raiz (reconfirmada com drag frame-a-frame)

1. **Detecção não-confiável:** `finish` usava `document.elementFromPoint(centerX, centerY)` p/ achar a `.ed-page` de destino. No **vão entre páginas** (área cinza) o topo é o `.ed-root` (não uma `.ed-page`) → `destPage = null` → cai no `clampedCommit` (mesma-página) → a imagem é presa no fundo da página 1 em vez de ir pra página 2. Também falha fora do viewport. Idem o `elementFromPoint` do canto p/ achar o bloco-âncora.
2. **Re-âncora sem clamp:** o caminho de re-âncora computava `newOffsetY = imgRect.top − destFragRect.top` sem clampar → podia posicionar a imagem clipada na página destino.

(O "some no meio do arraste" — imagem `behind` clipada pelo `overflow:hidden` da página durante o drag — é o **Tier 2**, fora deste escopo. O Tier 1 garante que o RESULTADO final fica visível na página certa.)

## Objetivo

Soltar uma imagem flutuante (`behind`/`front`) sobre/perto de outra página re-ancora de forma confiável num bloco daquela página, com a imagem **sempre visível** (nunca clipada) no destino — independente de viewport, vão entre páginas, ou o que está pintado no ponto de soltura.

## Arquitetura

Tudo em `packages/react/src/ImageResizeOverlay.tsx`. Remove os dois `elementFromPoint`.

### 1. Helper de clamp compartilhado
`clampOffsetToFragment(frag, oy): number` — limita o offset vertical (fragment-local) a `[contentTop − fragTop, contentBottom − fragTop − imgH]` do `.ed-page-content` da página do `frag`. Usado tanto no caminho mesma-página quanto no re-âncora. (Refatora a lógica que estava inline no `clampedCommit`.)

### 2. `clampedCommit` (refatorado)
Mantém o guard (behind/front; senão `onCommit` cru), pega o fragmento atual via `getFragmentForOffset`, e chama `onCommit(ox, clampOffsetToFragment(frag, oy))`.

### 3. `finish` — detecção por geometria
- **Página destino:** percorre `root.querySelectorAll('.ed-page')`; se `centerY ∈ [rect.top, rect.bottom]` → contida (break); senão acumula a distância e no fim escolhe a **mais próxima**. Nunca `null` (a não ser sem páginas → fallback `clampedCommit`). `getBoundingClientRect` e `imgRect` estão na mesma base de coords (viewport-relativa) → comparação válida em qualquer scroll.
- **Mesma página / sem página** → `clampedCommit(liveOX, liveOY)` (inalterado).
- **Página diferente → re-âncora:**
  - **Bloco-âncora por geometria:** entre os `[data-block-index]` da página destino, o de topo mais próximo do `imgRect.top` (sem `elementFromPoint`). Sem blocos → `clampedCommit` (rede de segurança).
  - `destOffset = destFrag.dataset.fragmentStart` (offset do fragmento na página destino).
  - `newOffsetX = imgRect.left − destFragRect.left`; `newOffsetY = clampOffsetToFragment(destFrag, imgRect.top − destFragRect.top)` ← **clampado**.
  - `onReanchor({ blockIndex: destBlockIndex, offset: destOffset }, newOffsetX, newOffsetY)`.

`onReanchor` → `editor.moveEmbedAnchor` (core, guard `{front,behind}`; no-op p/ wrap, inalterado).

## Edge cases

- **Soltar no vão entre páginas:** página mais próxima do centro (arrastou pra baixo passando do fim da pág. 1 → pág. 2). Word-like.
- **Fora do viewport:** geometria funciona (não depende de pintura).
- **Imagem maior que o conteúdo da página:** clamp degenera p/ topo do conteúdo (base clipada inevitável) — sem crash.
- **Página destino vazia (sem blocos):** `clampedCommit` (mantém na origem, clampado, visível).
- **wrap-left/right:** `finish` ainda chama `onReanchor`, mas o core no-opa (não-reancorável) — sem mudança de comportamento.
- **Tabela (`cellIndex`):** guard no topo do `finish` mantém o caminho atual.

## Testes / Verificação

Sem harness de drag automatizado (convenção do pacote: manual). Verificação **frame-a-frame** no playground (`window.__editor`, drag com `requestAnimationFrame` entre os moves, deixando assentar vários frames):
1. Drop **dentro** da página 2 → re-ancora num bloco da pág. 2, **totalmente visível** (topo E base no conteúdo).
2. Drop **no vão** perto da borda → re-ancora na página mais próxima, visível.
3. Drop **perto do fim** da página 2 → visível (clamp).
4. **Mesma página** → sem regressão (offsets mudam, sem re-âncora, clampado visível).
Critério: em todos, `clipped === false` após assentar, e `blockIndex` na página esperada.

## Deploy

`@sofereditor/react` → chega nos portais por alias do source (reiniciar dev server; sem republish). Ver `editor-monorepo-pkg-resolution-dist-vs-src`.

## Fora de escopo

- **Tier 2:** manter a imagem visível DURANTE o arraste (camada sem clip). Item separado.
- Mudar `overflow` das páginas, a ancoragem por bloco, ou o `renderInline`.
