# Cluster B — Comentários: realtime + trecho citado

**Data:** 2026-06-17
**Bugs:** #2 (caixas de comentário não aparecem em tempo real), #3 (resolver não reflete em tempo real), #5 (comentário resolvido perde o trecho citado)
**Repos afetados:** `portal2-next` (frontend) + `api-portal` (backend NestJS) + migração de banco.

## Contexto

Os comentários do editor de provas vivem em dois lugares:

- **Y.Doc**: cada comentário aplica um *mark* `comment` (com `markId`) no texto/imagem selecionado. Sincroniza em tempo real via Hocuspocus.
- **Backend**: a lista de comentários (`ProvaDocumentoComentario`) é carregada via React Query (`['prova-documento', idDocumento, 'comentarios']`) e renderizada na sidebar (cards "ativos" e "resolvidos").

O componente `@components/ProvaEditor` é **compartilhado** pelos dois fluxos espelhados (`processos-prova` e `tarefas-avaliativas`), ambos via `dynamic(import)` idêntico. Toda a lógica de comentários vive dentro de `ProvaEditor/index.tsx`, então uma única correção cobre os dois fluxos automaticamente — **sem trabalho de espelhamento**.

O sistema nunca foi para produção: **não há dados legados**. Nenhum fallback para comentários antigos é necessário.

## Workstream 1 — Sidebar em tempo real (#2 + #3)

### Causa-raiz

A query `comentarios` só é invalidada pelas *minhas próprias* mutations (add/update). Quando **outro usuário** adiciona (#2) ou resolve (#3) um comentário, a mudança chega como um **update remoto do Y.Doc** (mark adicionado; ou — no resolve — removido por `removeCommentMarkFromDoc`), mas nada refaz o fetch da lista. A sidebar fica desatualizada até dar reload.

### Mecanismo da correção

Em `ProvaEditor/index.tsx`, um observer no `editor.doc.ydoc` que dispara **apenas em updates remotos** e refaz o fetch da query de comentários (debounced).

Distinção remoto-vs-local confirmada: o `HocuspocusProvider` aplica todo update de sincronização recebido com `transactionOrigin = provider` (`@hocuspocus/provider` `hocuspocus-provider.cjs:1749`). Logo, em `ydoc.on('update', (update, origin) => …)`, updates remotos têm `origin === binding.provider`; edições locais não.

```ts
useEffect(() => {
  if (!binding) return;
  const ydoc = editor.doc.ydoc;
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== binding.provider) return; // só mudanças remotas
    scheduleComentariosRefresh();
  };
  ydoc.on('update', onUpdate);
  return () => ydoc.off('update', onUpdate);
}, [binding, editor]);
```

`scheduleComentariosRefresh` — debounce ~600ms:

1. `queryClient.invalidateQueries(['prova-documento', idDocumento, 'comentarios'])` (refetch imediato pós-debounce);
2. agenda **um** refetch de reconciliação ~2s depois, cobrindo a corrida em que o mark remoto chega antes do POST do par committar no backend.

Ambos os timers são limpos no cleanup do effect (e ao desmontar). O filtro por origem garante que minhas edições e mutations não disparam refetch redundante — o caminho de invalidação existente nas mutations permanece intacto.

### Por que resolve os dois

- **#2 (adicionar):** par aplica `comment` mark → update remoto → refetch → novo card aparece em "ativos".
- **#3 (resolver):** par chama `removeCommentMarkFromDoc` (remove o mark) → update remoto → refetch → `resolvido=true` move o card para "resolvidos".

Qualquer update remoto (até digitação do par) dispara o refetch debounced — over-fetch leve e aceitável, e evita ter que inspecionar o conteúdo do update (filtra por origem, não percorre o doc).

### Limitações

- Refetch dispara em qualquer edição remota, não só em mudanças de comentário. Custo: um refetch por rajada de ~600ms. Aceitável; mantém a implementação simples e robusta.

## Workstream 2 — Trecho citado sobrevive ao resolve (#5)

### Causa-raiz

Dois fatores combinados:

1. O snippet de texto é **capturado** na criação (`commentDraft.snippet`) mas **nunca persistido** no backend.
2. Resolver **remove o mark** do Y.Doc, então o `getCommentPreview` baseado em DOM não acha mais o texto → card resolvido renderiza vazio.

Observação: a **imagem** já é persistida hoje (`imageUrl` no `CriarComentarioDto` + coluna própria) e já sobrevive ao resolve independente do DOM. Só o **texto** se perde.

### Backend (api-portal) — coluna `trechoCitado`, imutável (create-only)

1. **Migração raw SQL** `prisma/portal/migrations/manual-comentario-trecho-citado.sql` (padrão `manual-*.sql`, não `prisma migrate dev`):
   ```sql
   ALTER TABLE ProvaDocumentoComentario ADD COLUMN trechoCitado TEXT NULL;
   ```
2. **schema.prisma** (`ProvaDocumentoComentario`, ~linha 705): adiciona `trechoCitado String? @db.Text`. Rodar `npx prisma generate --schema=prisma/portal/schema.prisma`.
3. **`CriarComentarioDto`**: adiciona `@IsOptional() @IsString() trechoCitado?: string`.
4. **`prova-documento.service.ts` `criarComentario`**: persiste `trechoCitado` no `create`. **Não** é tocado em `atualizarComentario` — o trecho é imutável; resolver nunca o altera.
5. O GET de comentários já retorna o registro inteiro → `trechoCitado` vem junto sem mudança no controller.

### Frontend (portal2-next)

1. **Tipo `ProvaDocumentoComentario`** (`queries/prova-documento/index.ts`): adiciona `trechoCitado?: string`.
2. **`useAddComentarioProva`**: o payload passa a incluir `trechoCitado`.
3. **`handleCommentConfirm`** (ProvaEditor): envia `commentDraft.snippet` como `trechoCitado` (o snippet já é capturado em `handleAddComment`, hoje só não é enviado).
4. **Render dos cards** (ativos e resolvidos): o card resolvido — que hoje não mostra nem texto nem imagem — passa a renderizar **ambos** a partir de campos persistidos:
   - **texto** → `comentario.trechoCitado`;
   - **imagem** → `comentario.imageUrl` (já persistido).
   - Nenhum dos dois depende do mark estar vivo no doc.

### Casos por tipo de comentário

| Tipo | `trechoCitado` | `imageUrl` | Card resolvido mostra |
|---|---|---|---|
| Seleção de texto | preenchido | vazio | trecho de texto |
| Seleção de imagem | vazio (imagem não tem `textContent`) | preenchido | miniatura |
| Texto + imagem | preenchido | preenchido | trecho + miniatura |

Comentário em imagem com `trechoCitado` vazio **não é perda** — é o comportamento correto (imagem não tem texto a citar); o card mostra a miniatura.

## Testes

- **Backend (`prova-documento.service.spec.ts`)** — prova mais forte do #5:
  - `criarComentario` persiste `trechoCitado` no `create`.
  - `atualizarComentario` (resolver) **não** apaga nem altera `trechoCitado`.
- **Frontend** — verificação no playground/portal driven via browser (Hocuspocus + duas sessões) para #2/#3 realtime e para o card resolvido exibindo trecho/miniatura. Não há harness de DOM para o ProvaEditor.

## Ordem de implementação

Dois planos, conforme recomendação do advisor:

1. **Plano 1 — Workstream 1 (#2/#3 realtime).** Isolado no frontend; verificável com duas sessões.
2. **Plano 2 — Workstream 2 (#5 trecho citado).** Backend (migração + schema + DTO + service + testes) e depois frontend (envio + render).
