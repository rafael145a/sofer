# #9 Tier 2 — preview da imagem visível durante o arraste — Design

**Data:** 2026-06-18
**Status:** aprovado (design)
**Bug:** docs/bugs.md #9 (Tier 2). Após o Tier 1 (re-âncora confiável), a imagem ainda **some durante o arraste** — uma imagem `behind`/`front` vive dentro do `.ed-page-content` (`overflow:hidden`), então é clipada assim que cruza a borda da página de origem. O usuário arrasta "às cegas".

## Insight que torna o fix simples

O overlay (`.ed-image-overlay`, em `ImageResizeOverlay`) **já segue o cursor durante o arraste**: ele mora no `.ed-root` (NÃO é clipado por página), e o `MoveHandle.onPointerMove` chama `onLiveChange = measure` a cada movimento, que re-lê o rect geométrico do `<figure>` (mesmo clipado) e reposiciona a caixa do overlay. Ou seja, já existe um elemento não-clipado rastreando o arraste — só está vazio (só as alças).

## Approach (B1, aprovado)

Renderizar um `<img>` **preview translúcido** dentro do `.ed-image-overlay` enquanto um arraste de MOVE está ativo. Como o overlay segue o cursor e não é clipado, o preview fica visível o tempo todo. No drop, o preview some e a imagem real (já re-ancorada/clampada/visível pelo Tier 1) reaparece.

Para não haver "imagem fantasma dupla" (o `<figure>` real continua sendo movido — clipado — por baixo), **esconder o `<figure>` real durante o move** (opacidade 0 imperativa) e restaurar no fim. O `<figure>` continua sendo movido (para alimentar a posição do overlay via `measure`), só fica invisível; quem aparece é o preview.

## Arquitetura

Tudo em `packages/react/src/ImageResizeOverlay.tsx`. Sem dependência de CSS (estilos inline — CSS não é empacotado pelo pacote).

### `MoveHandle`
- Props novas: `onMoveStart?: () => void`, `onMoveEnd?: () => void`.
- `onPointerDown`: após montar o `dragRef`, resolver `styled = imgRef.current.closest('.ed-figure') ?? imgRef.current`, setar `styled.style.opacity = "0"` (esconde a imagem real durante o move) e chamar `onMoveStart?.()`.
- `finish`: logo após `dragRef.current = null`, restaurar `styled.style.opacity = ""` e chamar `onMoveEnd?.()` (em UMA vez, antes do branching de commit, cobrindo todos os caminhos). A restauração imperativa evita flicker entre o commit e o re-render do React (que também reseta a opacidade).

### `ImageResizeOverlay`
- Estado `const [isMoving, setIsMoving] = useState(false)`.
- Passar ao `MoveHandle`: `onMoveStart={() => setIsMoving(true)}`, `onMoveEnd={() => setIsMoving(false)}`.
- Dentro do `.ed-image-overlay`, como PRIMEIRO filho (as alças/handle ficam por cima): `{isMoving && <img src={embed.src} alt="" aria-hidden draggable={false} style={{position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"fill", opacity:0.8, pointerEvents:"none"}} />}`. A caixa do overlay tem o tamanho da imagem durante o move, então o preview preenche = tamanho correto. `pointerEvents:"none"` para não atrapalhar o `MoveHandle` (que tem pointer capture).

## Edge cases

- **Só MOVE** (não resize): `isMoving` só liga no `MoveHandle`, não nos `Handle` de resize.
- **`behind` durante o arraste:** o preview aparece POR CIMA do texto (z-index do overlay) — esperado/útil ao arrastar; no drop volta para trás. (Decisão aprovada.)
- **Pointer cancel:** `onPointerCancel = finish` → restaura opacidade + `onMoveEnd`. Sem imagem presa invisível.
- **wrap-left/right:** o MoveHandle também roda para wrap; o preview aparece igual (a imagem de wrap não é clipada por página, mas o preview não atrapalha). Aceitável.
- **Tabela/inline:** o MoveHandle só renderiza para `layout !== "inline"` e `onCommitMove` definido; inline não tem move → sem preview.

## Testes / Verificação

Sem harness de drag automatizado (convenção: manual). Verificação **frame-a-frame** no playground (`window.__editor`, drag com `requestAnimationFrame` entre os moves):
1. Durante um arraste cross-page, em frames intermediários (imagem já passou da borda da pág.1): existe um `<img>` de preview dentro do `.ed-image-overlay`, **visível** (rect não-clipado), e o `<figure>` real está com `opacity:0`.
2. No drop: o preview some (`isMoving=false`), a imagem real reaparece visível na página destino (Tier 1), e `figure` opacity restaurada.
3. Sem regressão: re-âncora/clamp do Tier 1 continuam (overlay aparece de imediato — fix anterior).

## Deploy

`@sofereditor/react` → chega nos portais por alias do source (reiniciar dev server; sem republish).

## Fora de escopo

- Mudar `overflow` das páginas ou a ancoragem por bloco.
- Animações/efeitos além da translucidez do preview.
