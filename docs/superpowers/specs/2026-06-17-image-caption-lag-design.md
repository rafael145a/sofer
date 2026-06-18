# Legenda de imagem "lagada" (bug #11) — Design

**Data:** 2026-06-17
**Status:** aprovado (design)
**Bug:** docs/bugs.md #11 — "quando coloca legenda na imagem fica lagada"

## Problema

Aplicar/remover uma legenda numa imagem grande trava momentaneamente a UI ("lag"). Acontece no **APLICAR** (e no remover), não na digitação dentro do modal — o modal é isolado.

### Causa-raiz (confirmada no código)

`ImageEmbedViewImpl` em `packages/react/src/renderInline.tsx`:

- **Sem legenda** (`renderInline.tsx:220`): retorna um `<img>` **nu** (o `outerStyle` de posicionamento vai direto no `<img>`).
- **Com legenda** (`renderInline.tsx:223-240`): retorna o **mesmo** `<img>` aninhado dentro de um `<figure>` (o `<figure>` carrega o `outerStyle`; o `<img>` fica com tamanho intrínseco).

Quando a legenda é aplicada, o **pai** do `<img>` muda de tipo (raiz → dentro de `<figure>`). O React **não consegue reconciliar** `<img>` na raiz com `<img>` dentro de `<figure>` — ele **desmonta e remonta** o nó DOM `<img>`. No remount, o browser precisa **re-decodificar** o `src` base64. Como o `<img>` tem `decoding="sync"` (`renderInline.tsx:208`), o decode é **síncrono** → trava a main thread → o "lag" em imagens grandes.

A `key` do `<ImageEmbedView>` é **posicional** (`${keyPrefix}-${offset}`, `renderInline.tsx:39,60`), então **nada upstream** força o remount — a **única** causa é a troca estrutural `<img>`↔`<figure>` dentro de `ImageEmbedViewImpl`.

Fator agravante (não é a causa do lag): `setImageAttrs` (`commands.ts:1709-1714`) apaga+reinsere o embed inteiro — incluindo o base64 `src` — a cada mudança de atributo. Isso é **bloat de CRDT/persistência**, não a trava. Ver "Fora de escopo".

## Objetivo

Aplicar/remover legenda numa imagem grande deve ser **instantâneo**, sem re-decode síncrono e sem remontar o `<img>`.

Não-objetivos:
- Não mudar `decoding="sync"` (ele evita o *piscar* da imagem quando a paginação remonta o `<img>` ao cruzar páginas — `renderInline.tsx:197-200`; o fix de estrutura elimina o remount da legenda **sem** tocar nesse comportamento).
- Não mudar `setImageAttrs`/core/Y.Doc (sem mudança de schema).
- Não mudar o export-pdf (`packages/export-pdf/src/html.ts`) — é HTML one-shot estático, sem reconciliação React nem decode em tempo de edição; mexer ali só arriscaria o layout do PDF sem benefício.

## Arquitetura

Tornar a **estrutura renderizada invariante**: `ImageEmbedViewImpl` **sempre** retorna um `<figure>` envolvendo o `<img>`, com o `<figcaption>` renderizado **somente quando `hasCaption`**.

- O `<figure>` **sempre** carrega o `outerStyle` (posicionamento: float / absolute / inline-block / block-com-align).
- O `<img>` **sempre** fica com o estilo de tamanho intrínseco (`{ width, height, display: "block" }`) — exatamente como já acontece hoje no caminho com legenda.
- O `<figcaption>` é renderizado condicionalmente (`hasCaption`).

Resultado: aplicar/remover legenda passa a só **adicionar/remover o `<figcaption>` irmão**. O `<img>` **nunca** desmonta → sem re-decode → sem trava. O `decoding="sync"` fica intacto.

### Por que é seguro generalizar o `<figure>`

- O caminho com legenda **já** prova que `<img display:block intrínseco>` dentro de `<figure outerStyle>` renderiza certo para todos os layouts.
- O reset de margem default do `<figure>` (UA: `margin: 1em 40px`) **já existe**: `.ed-figure { margin: 0; padding: 0 }` (`apps/playground/src/styles.css:635`). Sem ele, todo `<figure>` adicionaria margem e deslocaria as imagens.
- A `key` posicional não muda ao aplicar legenda (offset estável, sem `newOffset` em mudança de legenda) → React reconcilia `<figure>`→`<figure>` e `<img>`→`<img>` no lugar.

### Mudança pontual

`packages/react/src/renderInline.tsx` — `ImageEmbedViewImpl`:
- `imgStyle` passa a ser **sempre** `{ width: embed.width, height: embed.height, display: "block" }` (remove o ramo condicional que usava `outerStyle` quando sem legenda).
- O `return` passa a ser **sempre** o `<figure style={outerStyle}>` com `{img}` e `{hasCaption && <figcaption>…</figcaption>}` (remove o `if (!hasCaption) return img;`).
- `data-embed-figure` reflete `hasCaption` (mantém o significado "esta figure tem legenda") — embora hoje nenhum consumidor em `react`/`dom-bridge` consulte esse atributo (só `export-pdf/html.ts`, que não é alterado).

## Componentes e responsabilidades

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `ImageEmbedViewImpl` (react) | renderizar estrutura DOM **invariante** (sempre `<figure>`, `<figcaption>` condicional) | `embed.layout`/`align`/`offsetX/Y`/`caption`, `outerStyle` |
| `imageEmbedPropsEqual` (react) | memo por valor — inalterado (continua re-renderizando quando `caption` muda) | campos do embed |
| `.ed-figure` CSS (consumidor) | reset de margem/padding do `<figure>` para casar com o `<img>` nu de hoje | stylesheet do portal |

## Edge cases

- **Layout `inline` (sem align):** `outerStyle` = `inline-block; vertical-align:text-bottom` → vai no `<figure>`; o `<img display:block>` dentro flui inline como hoje.
- **Layout `inline` com align (left/right/center):** `outerStyle` = `display:block` + margens auto → no `<figure>`.
- **`front`/`behind` (absolute):** `outerStyle` = `position:absolute; left/top; zIndex` → no `<figure>`. A overlay/queries miram `img[data-embed="image"]` e leem `img.getBoundingClientRect()` → o `<img>` continua presente com os `data-*`; o ancestral posicionado passa a ser o `<figure>` (não muda a geometria do `<img>`).
- **`wrap-left`/`wrap-right` (float):** a imagem já é emitida via o caminho `wrapAnchor` + phantom span (`renderInline.tsx:46-58`); o `ImageEmbedViewImpl` continua sendo a mesma função → vira `<figure float>` com `<img>` dentro. O reset `.ed-figure { margin:0 }` + as margens explícitas do `outerStyle` (marginLeft/Right/Top) preservam o fluxo do float.
- **Imagem com comentário (`commentMarkId`):** caminho `renderInline.tsx:61-69` envolve o nó num `<span data-comment>`. Inalterado — ortogonal à legenda.
- **Remover a legenda:** `hasCaption` vira false → o `<figcaption>` some, o `<figure>` e o `<img>` permanecem montados (sem remount/decode).

## Dependência de CSS (verificação de release, não é mudança de código)

O fix depende de `.ed-figure { margin:0; padding:0 }` existir no stylesheet de **cada consumidor** (`portal2-next`, `portal-professores/frequencia-ocorrencia`). Como os portais **já** renderizam figures com legenda hoje, o reset provavelmente já está presente — mas **confirmar** em ambos antes do release. O CSS **não** é empacotado pelo `@sofereditor/react` (ver `editor-monorepo-pkg-resolution-dist-vs-src`).

## Testes / Verificação

Sem harness DOM automatizado no pacote `react` — verificação **manual** no `apps/playground` (`pnpm dev`, porta 5173):

1. Carregar imagem base64 **grande**.
2. Aplicar legenda → **sem trava**; imagem permanece no lugar; no DevTools, o nó `<img>` é o **mesmo** (não remontou — inspecionar identidade do elemento / breakpoint em "node removed").
3. Remover legenda → imagem permanece, sem trava.
4. Regressão de layout: confirmar `inline` / `inline+align` / `wrap-left` / `wrap-right` / `front` / `behind` posicionam **idêntico** ao comportamento atual (com e sem legenda).
5. Confirmar que o anti-piscar da paginação (cruzar páginas) continua funcionando (decoding=sync intacto).

## Deploy

Vive em `@sofereditor/react` → precisa **rebuild + republish** para chegar aos portais. Ver `editor-monorepo-pkg-resolution-dist-vs-src`.

## Fora de escopo

- **base64 reescrito no CRDT a cada mudança de atributo** (`setImageAttrs` delete+insert do embed inteiro). É um problema **separado** (bloat de update/undo/persistência), **não** a causa do lag. Corrigir de verdade exige mover `src`/atributos para um `Y.Map` (id-based) + **migração de documentos** — colide com a migração de persistência já pendente (`editor-colaborativo-persistencia-binaria`). **Decisão do usuário (2026-06-17): registrar como item daquela migração, não fazer agora.**
- #9 (imagem some entre páginas) — item separado, plano próprio.
