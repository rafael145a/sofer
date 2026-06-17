# Cluster B — Plano 2: Trecho citado sobrevive ao resolve (#5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O trecho de texto citado por um comentário é persistido na criação (coluna nova `trecho_citado`, imutável) e exibido nos cards — inclusive depois de resolvido, quando o mark já não existe no Y.Doc.

**Architecture:** api-portal ganha uma coluna `trecho_citado` (TEXT, NULL) em `prova_documento_comentario`, preenchida só no `criarComentario` e nunca alterada no `atualizarComentario`. portal2-next passa a enviar o snippet já capturado (`commentDraft.snippet`) como `trechoCitado` e renderiza `trechoCitado` + `imageUrl` (ambos persistidos) nos cards ativos e resolvidos, eliminando a dependência do DOM para o trecho.

**Tech Stack:** Backend: NestJS 11 + Prisma + MySQL + Jest. Frontend: Next.js 14 + React Query v4 (sem test runner → verificação no browser).

**Repos:** `api-portal` (Tasks 1-5) e `portal2-next` (Task 6).

---

## Contexto para o implementador

- A tabela usa **snake_case** nas colunas via `@map`. A coluna física é `trecho_citado`; o campo Prisma é `trechoCitado`.
- Migrações são **raw SQL manuais** (`prisma/portal/migrations/manual-*.sql`), aplicadas via `mysql < arquivo.sql`. **Não** usar `prisma migrate dev` (schema do main dessincronizado — ver cabeçalho dos `manual-*.sql`).
- `criarComentario` (service, linha ~494) faz `await this.obter(id)` antes do `create`. `obter` usa `this.prisma.provaDocumento.findUnique`.
- `atualizarComentario` (linha ~520) monta `data: { texto, resolvido, respostas, imageUrl }` — **não** inclui `trechoCitado`, então a imutabilidade já é garantida; a Task 5 só adiciona um teste-guarda.
- O spec de teste (`prova-documento.service.spec.ts`) mocka `prismaPortal` com apenas `provaDocumento: { findUnique, update }`. Será preciso estender o mock com `provaDocumentoComentario`.
- Frontend: o snippet é capturado em `handleAddComment` (linha ~678, `commentDraft.snippet`, truncado a 200 chars) mas **não** é enviado em `handleCommentConfirm` (linha ~705). O card ativo usa `getCommentPreview` (linha ~747); o card resolvido (linha ~1124) hoje **não** mostra trecho nem imagem.

---

### Task 1: Migração SQL da coluna `trecho_citado`

**Files:**
- Create: `api-portal/prisma/portal/migrations/manual-comentario-trecho-citado.sql`

- [ ] **Step 1: Criar o arquivo de migração**

```sql
-- Migration aditiva: trecho de texto citado por um comentário, persistido na
-- criação para sobreviver ao resolve (quando o mark some do Y.Doc).
-- Aplicar via: mysql --ssl=0 -h <host> -u <user> -p <db> < manual-comentario-trecho-citado.sql
-- NÃO usar prisma migrate dev (schema do main está dessincronizado).

ALTER TABLE `prova_documento_comentario`
  ADD COLUMN `trecho_citado` TEXT NULL AFTER `image_url`;
```

- [ ] **Step 2: Commit**

```bash
cd api-portal
git add prisma/portal/migrations/manual-comentario-trecho-citado.sql
git commit -m "feat(prova-documento): migracao manual coluna trecho_citado"
```

---

### Task 2: Campo `trechoCitado` no schema Prisma

**Files:**
- Modify: `api-portal/prisma/portal/schema.prisma:705` (model `ProvaDocumentoComentario`)

- [ ] **Step 1: Adicionar o campo**

Logo após a linha `imageUrl     String?        @map("image_url") @db.VarChar(1000)` (linha ~714), adicione:

```prisma
  trechoCitado String?        @map("trecho_citado") @db.Text
```

- [ ] **Step 2: Regenerar o client Prisma**

Run: `cd api-portal && npx prisma generate --schema=prisma/portal/schema.prisma`
Expected: `Generated Prisma Client` sem erros.

- [ ] **Step 3: Commit**

```bash
git add prisma/portal/schema.prisma
git commit -m "feat(prova-documento): campo trechoCitado no schema portal"
```

---

### Task 3: DTO aceita `trechoCitado`

**Files:**
- Modify: `api-portal/src/prova-documento/dto/comentario.dto.ts`

- [ ] **Step 1: Adicionar o campo opcional ao `CriarComentarioDto`**

Após o bloco do `imageUrl` (linhas ~18-21), antes do fechamento da classe:

```ts
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  trechoCitado?: string;
```

(`IsOptional`, `IsString`, `MaxLength` já são importados no topo do arquivo.)

- [ ] **Step 2: Commit**

```bash
git add src/prova-documento/dto/comentario.dto.ts
git commit -m "feat(prova-documento): CriarComentarioDto aceita trechoCitado"
```

---

### Task 4: Service persiste `trechoCitado` na criação (TDD)

**Files:**
- Modify: `api-portal/src/prova-documento/prova-documento.service.ts:494-510` (`criarComentario`)
- Test: `api-portal/src/prova-documento/prova-documento.service.spec.ts`

- [ ] **Step 1: Estender o mock do Prisma e escrever o teste que falha**

No `beforeEach` do spec, estenda o mock `prismaPortal` para incluir o model de comentário (acrescente a propriedade ao objeto e ao tipo do `let`):

```ts
prismaPortal = {
  provaDocumento: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  provaDocumentoComentario: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};
```

> Ajuste a anotação de tipo do `let prismaPortal` para incluir `provaDocumentoComentario: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }`.

Adicione o describe de criação:

```ts
describe('criarComentario', () => {
  const PROVA_ID = 'prova-1';

  beforeEach(() => {
    prismaPortal.provaDocumento.findUnique.mockResolvedValue({
      id: PROVA_ID,
      criadoPor: 'prof@x.com',
    });
    prismaPortal.provaDocumentoComentario.create.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: 'c1', ...data }),
    );
  });

  it('persiste trechoCitado no create', async () => {
    await service.criarComentario(
      PROVA_ID,
      {
        markId: 'm1',
        texto: 'comentário',
        trechoCitado: 'trecho citado do enunciado',
      } as any,
      'autor@x.com',
    );

    expect(prismaPortal.provaDocumentoComentario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        markId: 'm1',
        texto: 'comentário',
        trechoCitado: 'trecho citado do enunciado',
      }),
    });
  });

  it('grava trechoCitado = null quando ausente', async () => {
    await service.criarComentario(
      PROVA_ID,
      { markId: 'm2', texto: 'sem trecho' } as any,
      'autor@x.com',
    );

    expect(prismaPortal.provaDocumentoComentario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trechoCitado: null }),
    });
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd api-portal && npx jest src/prova-documento/prova-documento.service.spec.ts -t criarComentario`
Expected: FAIL — `create` é chamado sem `trechoCitado` (o service ainda não passa o campo).

- [ ] **Step 3: Implementar a persistência**

Em `criarComentario` (linha ~500), acrescente `trechoCitado` ao `data`:

```ts
return this.prisma.provaDocumentoComentario.create({
  data: {
    idDocumento: id,
    markId: dto.markId,
    texto: dto.texto,
    autorId,
    autorNome: dto.autorNome ?? null,
    imageUrl: dto.imageUrl ?? null,
    trechoCitado: dto.trechoCitado ?? null,
  },
});
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `cd api-portal && npx jest src/prova-documento/prova-documento.service.spec.ts -t criarComentario`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/prova-documento/prova-documento.service.ts src/prova-documento/prova-documento.service.spec.ts
git commit -m "feat(prova-documento): persiste trechoCitado na criacao de comentario (#5)"
```

---

### Task 5: Teste-guarda de imutabilidade no resolve (TDD)

**Files:**
- Test: `api-portal/src/prova-documento/prova-documento.service.spec.ts`

> `atualizarComentario` não inclui `trechoCitado` no `data`, então já é imutável. Este teste é um guarda de regressão — não deve exigir mudança de código de produção.

- [ ] **Step 1: Escrever o teste-guarda**

```ts
describe('atualizarComentario', () => {
  it('resolver NÃO altera trechoCitado (imutável)', async () => {
    prismaPortal.provaDocumentoComentario.findUnique.mockResolvedValue({
      id: 'c1',
      texto: 'comentário',
      resolvido: false,
      respostas: null,
      imageUrl: null,
      trechoCitado: 'trecho original',
    });
    prismaPortal.provaDocumentoComentario.update.mockImplementation(
      ({ data }: any) => Promise.resolve({ id: 'c1', ...data }),
    );

    await service.atualizarComentario('c1', { resolvido: true } as any);

    const updateArg = prismaPortal.provaDocumentoComentario.update.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty('trechoCitado');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que passa**

Run: `cd api-portal && npx jest src/prova-documento/prova-documento.service.spec.ts -t atualizarComentario`
Expected: PASS (sem mudança de código — guarda de regressão).

- [ ] **Step 3: Rodar o spec inteiro**

Run: `cd api-portal && npx jest src/prova-documento/prova-documento.service.spec.ts`
Expected: todos os testes do arquivo PASS.

- [ ] **Step 4: Commit**

```bash
git add src/prova-documento/prova-documento.service.spec.ts
git commit -m "test(prova-documento): guarda de imutabilidade de trechoCitado no resolve"
```

---

### Task 6: Frontend envia e exibe `trechoCitado`

**Files:**
- Modify: `portal2-next/src/queries/prova-documento/index.ts` (tipo + mutation)
- Modify: `portal2-next/src/components/ProvaEditor/index.tsx` (envio + render)

- [ ] **Step 1: Tipo e payload da mutation**

Em `src/queries/prova-documento/index.ts`:

No tipo `ProvaDocumentoComentario` (linhas ~46-58), após `imageUrl: string | null;`:

```ts
  trechoCitado: string | null;
```

Na `useAddComentarioProva`, no tipo de `vars` da `mutationFn` (linhas ~204-209), após `imageUrl?: string;`:

```ts
      trechoCitado?: string;
```

(O `vars` é repassado direto no POST, então nada mais muda na mutation.)

- [ ] **Step 2: Enviar o snippet em `handleCommentConfirm`**

Em `ProvaEditor/index.tsx`, na chamada `await addComentario({ ... })` dentro de `handleCommentConfirm` (linha ~705), acrescente `trechoCitado`:

```ts
await addComentario({
  markId,
  texto,
  autorNome: userName,
  imageUrl: commentDraft.imageUrl,
  trechoCitado: commentDraft.snippet || undefined,
});
```

- [ ] **Step 3: `getCommentPreview` lê o campo persistido**

Substitua o corpo de `getCommentPreview` (linhas ~747-768) para usar os campos persistidos em vez do DOM:

```ts
// Preview do trecho citado a partir de campos persistidos (sobrevive ao
// resolve, quando o mark já não existe no Y.Doc). Texto → trechoCitado;
// imagem → imageUrl. Nenhum depende do mark estar vivo.
const getCommentPreview = (
  c: ProvaDocumentoComentario,
): { text: string; imageUrl?: string } => {
  const text = (c.trechoCitado ?? '').trim();
  return {
    text: text.length > 100 ? `${text.slice(0, 100)}…` : text,
    imageUrl: c.imageUrl ?? undefined,
  };
};
```

- [ ] **Step 4: Card resolvido renderiza o preview**

No render dos resolvidos (linhas ~1124-1140), dentro do `<div className="prova-comment prova-comment--resolved">`, após `<strong>{c.autorNome ?? 'Anônimo'}</strong>` e antes de `<p>{c.texto}</p>`, insira o bloco de preview (espelhando o card ativo, linhas ~1075-1086):

```tsx
{(() => {
  const preview = getCommentPreview(c);
  return (
    <>
      {preview.imageUrl && (
        <img
          className="prova-comment__thumb"
          src={preview.imageUrl}
          alt="Trecho comentado"
        />
      )}
      {preview.text && (
        <blockquote className="prova-comment__snippet">
          {preview.text}
        </blockquote>
      )}
    </>
  );
})()}
```

- [ ] **Step 5: Sanidade de tipos/lint**

Run: `cd portal2-next && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ProvaEditor/index.tsx|queries/prova-documento" || echo "sem erros novos"`
Expected: `sem erros novos`.

Run: `cd portal2-next && npx next lint --file src/components/ProvaEditor/index.tsx 2>&1 | tail -20`
Expected: sem novos erros de lint.

- [ ] **Step 6: Commit**

```bash
cd portal2-next
git add src/queries/prova-documento/index.ts src/components/ProvaEditor/index.tsx
git commit -m "feat(prova-editor): envia e exibe trechoCitado em cards ativos e resolvidos (#5)"
```

---

### Task 7: Verificação ponta-a-ponta no app

**Files:** nenhum (verificação runtime). Use a skill **verify**.

> Requer api-portal com a coluna aplicada (`mysql < manual-comentario-trecho-citado.sql`) e Prisma client regenerado.

- [ ] **Step 1: Aplicar a migração e subir backend + frontend**

Run (backend): aplicar `manual-comentario-trecho-citado.sql` no MySQL de dev; `cd api-portal && npm run start:dev`.
Run (frontend): `cd portal2-next && node server.js` (ou `next dev`).

- [ ] **Step 2: Verificar persistência (#5 criação)**

Selecionar um trecho de texto → "Comentar" → salvar. Conferir no banco:

Run: `SELECT mark_id, trecho_citado FROM prova_documento_comentario ORDER BY criado_em DESC LIMIT 1;`
Expected: `trecho_citado` contém o texto selecionado (truncado a ≤200 chars).

- [ ] **Step 3: Verificar sobrevivência ao resolve (#5 núcleo)**

Resolver o comentário criado. Expandir "Resolvidos (N)".
Expected: o card resolvido exibe o **trecho citado** (blockquote) — que antes ficava vazio.

- [ ] **Step 4: Probe — comentário em imagem**

Selecionar uma imagem → "Comentar" → salvar → resolver.
Expected: `trecho_citado` vazio/null; o card resolvido mostra a **miniatura** (via `imageUrl` persistido), não fica em branco.

- [ ] **Step 5: Capturar evidência**

Screenshot do card resolvido com o trecho citado visível + o resultado do SELECT. Anexar no relatório.

---

## Self-Review (preencher na execução)

- Cobertura do spec: migração (Task 1), schema (Task 2), DTO (Task 3), service create-only (Task 4), imutabilidade no resolve (Task 5), frontend envio+render ativo/resolvido (Task 6), verificação incl. imagem (Task 7). ✓
- Sem placeholders de código. ✓
- Consistência de nomes: campo físico `trecho_citado` / campo Prisma+DTO+tipo TS `trechoCitado`, `getCommentPreview`, `commentDraft.snippet` usados consistentemente. ✓
- Imutabilidade: `atualizarComentario` não recebe `trechoCitado` (Task 5 guarda); só `criarComentario` grava (Task 4). ✓
