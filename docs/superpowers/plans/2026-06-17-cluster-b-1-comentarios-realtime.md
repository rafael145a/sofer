# Cluster B — Plano 1: Sidebar de comentários em tempo real (#2/#3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando outro usuário adiciona (#2) ou resolve (#3) um comentário, a sidebar do `ProvaEditor` atualiza em tempo real, sem reload.

**Architecture:** Um observer no `editor.doc.ydoc` dentro de `ProvaEditor/index.tsx` dispara apenas em updates remotos (`origin === binding.provider`, convenção do HocuspocusProvider), com debounce (~600ms) + um refetch de reconciliação (~2s), invalidando a query React Query `provaDocumentoKeys.comentarios(documentoId)`. O componente é compartilhado por `processos-prova` e `tarefas-avaliativas`, então a correção cobre os dois fluxos.

**Tech Stack:** Next.js 14 (Pages Router) · React 18 · TanStack React Query v4 · Y.js · @hocuspocus/provider · @sofereditor/collab.

**Repo:** `portal2-next`. Não há test runner no projeto (só `node server.js` / `next build` / `next lint`) — a verificação é feita no app rodando, com duas sessões do navegador conectadas ao mesmo documento (Hocuspocus).

---

## Contexto para o implementador

- `ProvaEditor/index.tsx` tem **dois** componentes: `ProvaEditorInner` (a lógica) e `ProvaEditor` (wrapper que cria o `Y.Doc`, linha ~1208). Todo o trabalho é em `ProvaEditorInner`.
- `documentoId` é prop de `ProvaEditorInner`.
- `comentarios` vem de `useComentariosProva(documentoId)` (linha ~624).
- `binding` vem de `useCollab({ ydoc, ... })` (linha ~346); `binding.provider` é o `HocuspocusProvider`.
- `ydoc` é prop estável (criada no wrapper com `useMemo`).
- Já existe um observer Y.Doc no mesmo arquivo (linhas ~525-536: `ydoc.on('update', scheduleSave)` gated por `synced`) — **espelhe esse padrão** (registro único, cleanup com `off()` + clearTimeout).
- A query key helper é `provaDocumentoKeys.comentarios(id)` exportada de `@/queries/prova-documento` (arquivo `src/queries/prova-documento/index.ts`). Confirme o import path usado no projeto (alias `@components`, etc. — a query é importada hoje como `useComentariosProva` no topo do arquivo; siga o mesmo specifier).
- As mutations existentes (`useAddComentarioProva`, `useUpdateComentarioProva`) já invalidam a query `comentarios` no `onSuccess` — **não altere** esse caminho. O observer cobre apenas mudanças de **outros** usuários.

---

### Task 1: Imports e queryClient

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/index.tsx`

- [ ] **Step 1: Garantir os imports necessários**

No topo do arquivo, no import de `@tanstack/react-query` (se não existir, criar), garanta `useQueryClient`:

```ts
import { useQueryClient } from '@tanstack/react-query';
```

No import já existente que traz `useComentariosProva` (da camada `queries/prova-documento`), acrescente `provaDocumentoKeys`:

```ts
import {
  useComentariosProva,
  provaDocumentoKeys,
  // ...demais imports já presentes deste módulo
} from '<mesmo specifier já usado para useComentariosProva>';
```

> Verifique o specifier real onde `useComentariosProva` é importado hoje (linha ~36) e adicione `provaDocumentoKeys` ao mesmo bloco. Não duplique o import.

- [ ] **Step 2: Instanciar o queryClient dentro de `ProvaEditorInner`**

Logo após a linha `const { data: comentarios = [] } = useComentariosProva(documentoId);` (linha ~624), adicione:

```ts
const queryClient = useQueryClient();
```

- [ ] **Step 3: Commit**

```bash
cd portal2-next
git add src/components/ProvaEditor/index.tsx
git commit -m "chore(prova-editor): import useQueryClient e provaDocumentoKeys p/ realtime de comentarios"
```

---

### Task 2: Debounce + reconciliação (`scheduleComentariosRefresh`)

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/index.tsx`

- [ ] **Step 1: Refs dos timers**

Junto aos outros `useRef` do componente (ex.: perto de `saveTimerRef`/`triggerSnapshotRef`, linhas ~515-523), adicione:

```ts
const comentariosRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const comentariosReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 2: Callback de refresh debounced**

Adicione (perto dos demais `useCallback` do componente):

```ts
// Refetch da lista de comentários após mudança remota no Y.Doc.
// Debounce coalesce rajadas; o refetch de reconciliação (~2s) cobre a
// corrida em que o mark remoto chega antes do POST do par committar.
const scheduleComentariosRefresh = useCallback(() => {
  if (!documentoId) return;
  if (comentariosRefreshTimerRef.current) {
    clearTimeout(comentariosRefreshTimerRef.current);
  }
  comentariosRefreshTimerRef.current = setTimeout(() => {
    queryClient.invalidateQueries({
      queryKey: provaDocumentoKeys.comentarios(documentoId),
    });
    if (comentariosReconcileTimerRef.current) {
      clearTimeout(comentariosReconcileTimerRef.current);
    }
    comentariosReconcileTimerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({
        queryKey: provaDocumentoKeys.comentarios(documentoId),
      });
    }, 2000);
  }, 600);
}, [documentoId, queryClient]);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ProvaEditor/index.tsx
git commit -m "feat(prova-editor): scheduleComentariosRefresh (debounce + reconciliação)"
```

---

### Task 3: Observer remoto do Y.Doc

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/index.tsx`

- [ ] **Step 1: useEffect com gate em `synced` + filtro de origin Symbol**

Adicione um novo `useEffect` (logo após o observer existente de `scheduleSave`, linha ~536). **Gateie em `synced`, NÃO em `binding`**: `binding` vem de um `ref` do `useCollab` que pode ficar `null` transitoriamente num re-bind sem re-render, fazendo o effect nunca re-anexar o observer (verificado ao vivo: o handler ficava ausente de `ydoc._observers`). `synced` é `useState` confiável — mesmo gate do `scheduleSave`. Edições locais do editor chegam com `origin` = **Symbol**; remotas trazem o provider (objeto) — por isso o filtro `typeof origin === 'symbol'`.

```ts
// Atualiza a sidebar de comentários quando OUTRO usuário adiciona/resolve
// um comentário. Gate em `synced` (não em `binding`, que é ref e pode ficar
// null num re-bind sem re-render, deixando o observer sem re-anexar).
// Edições locais do editor chegam com origin Symbol; remotas trazem o
// provider. Failsafe: se o origin mudar, no pior caso há refetch extra.
useEffect(() => {
  if (!synced) return;
  const onRemoteUpdate = (_update: Uint8Array, origin: unknown) => {
    if (typeof origin === 'symbol') return;
    scheduleComentariosRefresh();
  };
  ydoc.on('update', onRemoteUpdate);
  return () => {
    ydoc.off('update', onRemoteUpdate);
    if (comentariosRefreshTimerRef.current) {
      clearTimeout(comentariosRefreshTimerRef.current);
    }
    if (comentariosReconcileTimerRef.current) {
      clearTimeout(comentariosReconcileTimerRef.current);
    }
  };
}, [ydoc, synced, scheduleComentariosRefresh]);
```

- [ ] **Step 2: Sanidade de tipos/lint**

Run: `cd portal2-next && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "ProvaEditor/index.tsx" || echo "sem erros novos no arquivo"`
Expected: `sem erros novos no arquivo` (o projeto tem `ignoreBuildErrors`, mas não introduza erro novo no arquivo).

Run: `cd portal2-next && npx next lint --file src/components/ProvaEditor/index.tsx 2>&1 | tail -20`
Expected: sem novos erros de lint atribuíveis às mudanças.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProvaEditor/index.tsx
git commit -m "feat(prova-editor): realtime da sidebar de comentarios (#2/#3) via observer remoto"
```

---

### Task 4: Verificação no app (duas sessões)

**Files:** nenhum (verificação runtime).

> Sem test runner no projeto. Verifique no app rodando com **duas sessões** apontando para o mesmo `documentoId` (duas abas/janelas, ou dois perfis), ambas conectadas ao Hocuspocus. Use a skill **verify**.

- [ ] **Step 1: Subir o app**

Run: `cd portal2-next && node server.js` (ou `next dev` se faltar certificado — ver `.env.example`).
Abrir o mesmo documento de prova em duas sessões A e B.

- [ ] **Step 2: Verificar #2 (adicionar em tempo real)**

Na sessão A, selecionar um trecho → "Comentar" → salvar.
Expected: na sessão B, **sem reload**, o novo card aparece em "Comentários (ativos)" em ~1-3s.

- [ ] **Step 3: Verificar #3 (resolver em tempo real)**

Na sessão A, clicar "Resolver" num comentário ativo.
Expected: na sessão B, **sem reload**, o card sai de "ativos" e passa para "Resolvidos (N)" em ~1-3s.

- [ ] **Step 4: Verificar que não há refetch local redundante (probe)**

Na sessão A, digitar texto comum no editor (sem mexer em comentário).
Expected: a aba Network da sessão A **não** dispara GET `/comentarios` por causa da própria digitação (o filtro de origem barra updates locais). Updates remotos na sessão B podem disparar refetch debounced — isso é esperado.

- [ ] **Step 5: Capturar evidência**

Screenshot da sessão B mostrando o card novo/resolvido aparecendo sem reload. Anexar no relatório de verificação.

---

## Self-Review (preencher na execução)

- Cobertura do spec: Workstream 1 (#2 add realtime, #3 resolve realtime) → Tasks 2-3; verificação → Task 4. ✓
- Sem placeholders de código (todos os blocos completos). ✓
- Consistência de nomes: `comentariosRefreshTimerRef`, `comentariosReconcileTimerRef`, `scheduleComentariosRefresh`, `provaDocumentoKeys.comentarios` usados de forma idêntica em todas as tasks. ✓
