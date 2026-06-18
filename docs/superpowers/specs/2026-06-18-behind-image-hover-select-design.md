# Selecionar imagem "atrás do texto" via affordance de hover — Design

**Data:** 2026-06-18
**Status:** aprovado (design)
**Problema:** uma imagem `behind` (`z-index:-1`) é difícil de selecionar quando há texto por cima — o clique cai no bloco/texto (`elementFromPoint` retorna o `.ed-paragraph`), e o handler de clique em imagem (`Editor.tsx`, `closest('img[data-embed="image"]')`) dá `null`. Hoje só dá pra selecionar clicando num ponto da imagem SEM texto.

## Objetivo

Dar um jeito **descobrível e confiável** de selecionar uma imagem `behind` mesmo sobre o texto, **sem roubar** o clique normal de edição de texto.

Escopo: só `behind`. `front` já fica por cima (clicável); `wrap`/`inline` fluem com o texto.

## Arquitetura

### 1. Detecção de hover (`Editor.tsx`)
Estado `hoveredBehind: { blockIndex: number; offset: number; cellIndex?: number } | null`.

`useEffect` com listener de `pointermove` no `.ed-root` (throttle por `requestAnimationFrame` — 1 checagem por frame):
- por **geometria**, percorre `root.querySelectorAll('img[data-embed="image"][data-embed-layout="behind"]')` e acha a primeira cujo `getBoundingClientRect` contém `(clientX, clientY)`;
- se achou, calcula `blockIndex` (do `[data-block-index]` ancestral) e `offset = fragmentStart + dataset.embedOffset` (mesma conta do handler de clique em imagem), e `cellIndex` se houver; seta `hoveredBehind`;
- se não achou, `setHoveredBehind(null)`.
- `pointerleave` no root → `setHoveredBehind(null)`.

Não renderiza a affordance quando `hoveredBehind` é o **embed já selecionado** (o `ImageResizeOverlay` já cobre esse caso).

### 2. Componente `BehindImageSelectAffordance` (novo arquivo `packages/react/src/BehindImageSelectAffordance.tsx`)
Props: `{ blockIndex, offset, cellIndex?, rootRef, onSelect }`.
- **Localiza** o `<img>` por `blockIndex`/`offset` (mesma lógica do `ImageResizeOverlay.locateImage`: `getFragmentForOffset` → `img[data-embed="image"][data-embed-offset="<local>"]`) e **mede** o rect relativo ao `.ed-root` (igual ao `measure` do overlay: `r.top - rootRect.top + root.scrollTop`, etc.). Re-mede em `scroll`/`resize` (listeners) e num `rAF` pós-mount. Se não localizar → renderiza `null`.
- **Renderiza** (estilos **inline**, sem dep de CSS), `contentEditable={false}`:
  - **contorno** tracejado no box (`position:absolute`, top/left/width/height, `border: 1.5px dashed <accent>`, `borderRadius: 2px`, **`pointerEvents:"none"`** — não bloqueia o texto embaixo);
  - **alça/badge** clicável no canto sup. esquerdo (~22px, fundo accent, ícone SVG inline de "mover/selecionar", `cursor:pointer`, **`pointerEvents:"auto"`**, `contentEditable={false}`). `onPointerDown`: `e.preventDefault()` + `e.stopPropagation()` + `onSelect()`.

### 3. Seleção (`onSelect` em `Editor.tsx`)
`setSelection({ anchor:{blockIndex,cellIndex,offset}, focus:{blockIndex,cellIndex,offset:offset+1} })` — mesma seleção que o clique em imagem produz. O `ImageResizeOverlay` aparece (imagem selecionada) e a affordance some (deixa de ser hover/passa a ser a selecionada).

## Componentes e responsabilidades

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| hover effect (Editor) | achar a behind-image sob o ponteiro por geometria; setar `hoveredBehind` | `rootRef`, geometria |
| `BehindImageSelectAffordance` | localizar+medir o `<img>` e renderizar contorno + alça | `getFragmentForOffset`, `rootRef` |
| `onSelect` (Editor) | selecionar o embed | `setSelection` |

## Edge cases

- **Clique no texto (fora da alça):** o contorno é `pointer-events:none` → o clique passa pro texto → edição normal. Só a alça seleciona.
- **Imagem já selecionada:** não renderiza a affordance (overlay cobre).
- **Durante arraste:** a imagem está selecionada (overlay) → affordance não aparece.
- **Múltiplas behind-images sobrepostas:** pega a primeira na ordem do DOM cujo box contém o ponteiro (suficiente; raro).
- **Scroll/repaginação:** re-mede via listeners + rAF; se o `<img>` sumir/realocar, re-localiza por `blockIndex`/`offset`.
- **`front`/`wrap`/`inline`:** fora de escopo (já clicáveis).
- **Tabela (`cellIndex`):** suportado pela mesma conta (cellIndex passado adiante); behind dentro de célula é raro mas não quebra.

## Testes / Verificação

Sem harness de hover automatizado (convenção: manual). Verificação no **playground** (`window.__editor`):
1. Texto **denso** sobre uma behind-image → passar o mouse sobre ela → aparece contorno + alça.
2. Clicar a **alça** → imagem selecionada (`ImageResizeOverlay` aparece; `getSelectedEmbed` truthy).
3. Clicar no **texto** (fora da alça, sobre a imagem) → cursor vai pro texto (edição), imagem NÃO selecionada.
4. Tirar o mouse → affordance some.
(Detecção via geometria é o cerne; checo `hoveredBehind` e o efeito do clique na alça programaticamente + screenshot.)

## Deploy

`@sofereditor/react` → chega nos portais por alias do source (reiniciar dev server; sem republish).

## Fora de escopo

- Affordance para `front`/`wrap`/`inline`.
- Tornar todo o contorno clicável (só a alça, pra não bloquear o texto). Pode evoluir depois.
- Mudar `z-index`/stacking das imagens.
