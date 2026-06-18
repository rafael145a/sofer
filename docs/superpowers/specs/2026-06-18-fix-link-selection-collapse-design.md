# Consertar link que "não gruda" no portal (bug #6) — Design

**Data:** 2026-06-18
**Status:** aprovado (design) — implementado e verificado
**Bug:** docs/bugs.md #6 — "inserir link vinculado a texto não funciona" (usuário: "nada vira link") no portal.

## Causa-raiz (confirmada no código + repro)

O link é aplicado pelo **consumidor** (toolbar) em `requestLink().then(href => setMark("link", {href}))`. O `requestLink`/`resolveLinkRequest` do `useEditor` eram puro request/response da URL — **nunca capturavam nem aplicavam a seleção**. E `setMark`/`removeMark` (core `commands.ts`) dão `return` se `isCollapsed(sel)`.

Sequência que quebra (no portal):
1. Selecionar texto → seleção do modelo `{6,11}`.
2. Clicar 🔗 → modal abre, foco vai pro input. Durante o modal, `activeElement = input ≠ root` → o handler de `selectionchange` é **suprimido** → modelo `{6,11}` sobrevive.
3. Clicar **Aplicar** → modal fecha → foco volta pro editor (`activeElement === root`) com a seleção DOM **colapsada** → `selectionchange` NÃO suprimido → `setSelection(colapsada)` → **modelo colapsa**.
4. A promise resolve → consumidor roda `setMark("link", …)` → lê o modelo (colapsado) → **no-op**.

No **playground funciona** porque o botão da `Toolbar` tem `onMouseDown preventDefault` → o editor não perde foco → a seleção DOM sobrevive o round-trip. **Bold/Itálico funcionam no portal** porque aplicam `toggleMark` **síncrono** no passo 2 (antes do colapso) — esse foi o discriminador confirmado pelo usuário.

## Decisão de fix: B (core robusto)

Descartado **A (portal-only `onMouseDown preventDefault` no IconBtn)**: o `IconBtn` é um HeroUI `<Button>` (react-aria `usePress`) que pode **ignorar** `onMouseDown preventDefault`, e só consertaria os portais.

**B:** capturar a seleção do modelo no `requestLink` e **restaurá-la** no `resolveLinkRequest` antes de resolver a promise. O consumidor continua aplicando `setMark` (contrato inalterado), mas agora sobre a seleção restaurada. Imune ao comportamento do botão/modal, conserta **todos** os consumidores. O custo (rebuild/republish do pacote) já é pago pelo #9/#11.

## Arquitetura

`packages/react/src/useEditor.ts`:
1. `LinkRequest` ganha `selection: Selection` (a seleção capturada).
2. `requestLink` captura `selectionRef.current` no momento do pedido e guarda em `linkRequestRef` (ref, p/ ler no resolve sem fechar sobre estado stale) + no estado (p/ renderizar o modal).
3. `resolveLinkRequest(href)`: lê o `linkRequestRef`, limpa estado/ref, **`setSelection(req.selection)`** (restaura o modelo), e então `req.resolve(href)`.

Timing: `resolveLinkRequest` roda síncrono e seta `selectionRef.current = capturada`; o `.then(setMark)` do consumidor roda como **microtask** logo depois (antes de qualquer `selectionchange` macrotask), então `setMark` vê a seleção restaurada. Aplica no Y.Text (modelo), independente da seleção DOM.

Cancelar (`href === null`): restaura a seleção (UX: mantém o texto selecionado) e resolve `null`; o consumidor não aplica nada.

## Verificação (red → green, no playground via `window.__editor`)

Repro do colapso do portal: selecionar `{6,11}` ("world") → `requestLink` → colapsar o modelo (`setSelection {16,16}`) → consumidor `.then(setMark)` ← `resolveLinkRequest("http://example.com")`.
- **RED (sem o fix):** `world` sem link (`linkApplied:false`).
- **GREEN (com o fix):** `world` → `http://example.com`.
- **Sem regressão:** caminho normal (sem colapso) aplica; cancelar (`null`, mesmo com colapso) não aplica e não lança.

(Hooks não têm harness automatizado no pacote — verificação manual no playground, convenção do repo.)

## Deploy

`@sofereditor/react` → rebuild + republish p/ os portais (junto com #9/#11/drag). Ver `editor-monorepo-pkg-resolution-dist-vs-src`.

## Fora de escopo

- Mudar o contrato (consumidor continua aplicando o mark).
- Tocar os portais (fix A descartado).
