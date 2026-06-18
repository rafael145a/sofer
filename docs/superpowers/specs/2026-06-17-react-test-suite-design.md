# Suite de testes `@sofereditor/react` (lógica pura) — Design

**Data:** 2026-06-17
**Status:** aprovado (design)
**Objetivo:** dar cobertura de teste à lógica pura/determinística do pacote `@sofereditor/react`, que hoje só tem `renderInline.caption.test.tsx` (do bug #11). O core já tem 13 arquivos de teste; o react quase nada.

## Escopo

Cobrir **apenas funções exportadas testáveis sem um reconciler React** (sem `@testing-library/react`). Hooks com estado/efeito (`usePageLayout`, `useEditor`, `usePageSettings`) e componentes (`Editor`, `Toolbar`, diálogos, overlays) ficam **fora** — exigiriam o escopo "amplo" não escolhido.

## Harness (mínimo, casa com o core)

- Única dependência nova: **`jsdom`** (devDep de `@sofereditor/react`).
- **Sem `vitest.config`**: usar o docblock `// @vitest-environment jsdom` na primeira linha dos arquivos que tocam o DOM. O resto roda no env **node** padrão (igual aos 13 testes do core). `react-dom/server` (já é devDep) cobre os render tests.
- Rodar: `pnpm --filter @sofereditor/react test` (todos) ou `pnpm --filter @sofereditor/react exec vitest run <arquivo>` (um).

## Arquivos de teste (alvos)

| Arquivo | Env | Funções exportadas cobertas |
|---|---|---|
| `renderInline.test.tsx` | node (`react-dom/server` `renderToStaticMarkup`) | `renderInline` — marcas (bold/itálico/sublinhado/strike/cor/fontFamily/fontSize), listas/headings via attrs do delta, comentário (`data-comment-id` + classe `ed-comment`), imagem `inline`/`align`/`front`/`behind`, wrap-left/right (anchor `data-wrap-anchor` no início + phantom span `data-embed-phantom`), delta vazio → `<br data-empty>`. (O `renderInline.caption.test.tsx` do #11 permanece.) |
| `dom-bridge.test.ts` | **jsdom** | `findBlockIndex`, `getBlockElement`, `getFragmentForOffset`, `getCellElement`, `textOffsetWithin` (offset↔DOM, incl. embed atômico = +1, `<figure>` transparente, wrap-anchor ignorado, phantom conta), `locatePoint` (round-trip com `textOffsetWithin`), `readDomSelection`/`applyDomSelection` (round-trip), `selectionsEqual` (puro), `isTableRectSelection` (puro). Pode dividir em `dom-bridge.test.ts` + `dom-bridge.selection.test.ts` se ficar grande — mesmo dono (Agente B). |
| `sliceDelta.test.ts` | node | `deltaLength` (texto + embeds atômicos), `sliceDelta` (corte no meio de op, preservação de `attributes`, embed indivisível, limites 0/len, start==end). |
| `usePagination.helpers.test.ts` | node | `contentHeight`/`contentWidth` (geometria A4, margens, `pageIndex`), `defaultPageLayout` (N blocos top-level), constante `A4_PAGE`. (Hook `usePageLayout` fora.) |

## Fixtures (dom-bridge)

Não há helper exportado que monte a árvore de páginas completa. Os testes constroem DOM representativo via `innerHTML` num `document.createElement("div")` (raiz `.ed-root`), espelhando o contrato que `renderInline`/`NodeView` emitem:
- bloco: elemento com `data-block-index` (e `data-block-type`); fragmentos com `data-fragment-start` quando paginados.
- célula de tabela: `data-cell-index`.
- embed de imagem: `<img data-embed="image" data-embed-offset=N>` (ou dentro de `<figure>` — o caret-mapping é nesting-agnostic, ver bug #11).
- phantom de wrap: `<span data-embed-phantom="true" data-embed-offset=N>`; anchor: `data-wrap-anchor="true"`.
Cada teste afirma o contrato lendo `dom-bridge.ts` (não chuta atributos).

## Execução (paralela, 3 agentes, arquivos disjuntos)

1. **Setup (sequencial, feito):** `jsdom` adicionado + `pnpm install` + stub jsdom validado.
2. **Agente A:** `renderInline.test.tsx`. **Agente B:** `dom-bridge` (todo — dono das fixtures). **Agente C:** `sliceDelta.test.ts` + `usePagination.helpers.test.ts`.
3. Cada agente: lê o source-alvo, escreve o teste, roda **só o próprio arquivo** com `vitest run <arquivo>` até verde. **Não commitar** (o orquestrador integra + roda a suite inteira + commita).

## Critério de sucesso

`pnpm --filter @sofereditor/react test` verde com todos os arquivos novos; cada função listada exercida com casos felizes + limites; sem `@testing-library`; sem `vitest.config` novo além do docblock.

## Fora de escopo

- Hooks com reconciler e componentes (escopo "amplo").
- Integração com #9 (que modifica `useEditor`/`ImageResizeOverlay`/`Editor` — source, não testes; roda em paralelo, arquivos disjuntos).
