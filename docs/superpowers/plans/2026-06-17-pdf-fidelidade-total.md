# PDF enviado = Baixar PDF (fidelidade total) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o PDF enviado por impressão/e-mail ser idêntico ao "Baixar PDF", unificando a fonte em Liberation Sans e fazendo o servidor renderizar o mesmo HTML que o Baixar PDF imprime.

**Architecture:** O cliente já produz o HTML gold-standard via `serializePaginatedHtml(root)` (CSS do editor inlinado) para o Baixar PDF. Passamos a (a) gravar esse mesmo HTML como snapshot e (b) fazer o servidor renderizá-lo verbatim no Puppeteer (só injetando a fonte embutida), em vez de re-embrulhar o snapshot cru com `getContentCSS`. Tudo usa Liberation Sans (tela + download + servidor).

**Tech Stack:** TypeScript; editor custom Yjs (`@sofereditor/*`); Vite (portal-professores) + Next.js (portal2-next); NestJS + Puppeteer + Prisma (api-portal); Vitest (editor-monorepo) / Jest (api-portal).

Spec: `editor-monorepo/docs/superpowers/specs/2026-06-17-pdf-fidelidade-total-design.md`

---

## File Structure

- `editor-monorepo/packages/export-pdf/src/pdf.ts` — adiciona um marcador no HTML do `serializePaginatedHtml` para o servidor detectar o formato novo.
- `api-portal/src/prova-documento/pdf-export.service.ts` — `buildHtmlDocument` detecta o formato: novo → renderiza verbatim + injeta `@font-face`; antigo → caminho atual (`getContentCSS`).
- `api-portal/src/prova-documento/pdf-export.service.spec.ts` — **novo** — testa o branch.
- `portal2-next` e `portal-professores/frequencia-ocorrencia`:
  - `public/assets/fonts/LiberationSans-*.ttf` — professores precisa receber as fontes.
  - `src/components/ProvaEditor/sofer-editor.css` — `@font-face` + trocar Arial → Liberation Sans.
  - `src/styles/global.js` (professores) — `@font-face` via styled-components.
  - `src/components/ProvaEditor/index.tsx` — `ARIAL_FONT` → Liberation Sans; `triggerSnapshot` → `serializePaginatedHtml`.

---

### Task 1: Marcador de formato no HTML do Baixar PDF

**Files:**
- Modify: `editor-monorepo/packages/export-pdf/src/pdf.ts` (dentro de `serializePaginatedHtml`)

- [ ] **Step 1: Adicionar o marcador no `<head>`**

Em `serializePaginatedHtml`, no array de retorno, trocar a linha do `<head>`:

```ts
    `<html><head><meta charset="utf-8"><title>${title}</title>`,
```

por:

```ts
    `<html><head><meta charset="utf-8"><meta name="ed-print-snapshot" content="1"><title>${title}</title>`,
```

- [ ] **Step 2: Typecheck do pacote**

Run: `cd editor-monorepo/packages/export-pdf && npx tsc --noEmit`
Expected: sem erros (exit 0).

- [ ] **Step 3: Commit**

```bash
cd editor-monorepo
git add packages/export-pdf/src/pdf.ts
git commit -m "feat(export-pdf): marca o HTML do serializePaginatedHtml (ed-print-snapshot)"
```

---

### Task 2: Servidor renderiza o formato novo verbatim (back-compat)

**Files:**
- Modify: `api-portal/src/prova-documento/pdf-export.service.ts` (método `buildHtmlDocument`)
- Test: `api-portal/src/prova-documento/pdf-export.service.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `api-portal/src/prova-documento/pdf-export.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PdfExportService } from './pdf-export.service';
import { PrismaService as PrismaPortalService } from '../prisma/prisma-portal.service';
import { PrismaService as PrismaSAAService } from '../prisma/prisma-saa.service';
import { StorageService } from '../storage/storage.service';

describe('PdfExportService.buildHtmlDocument', () => {
  let service: PdfExportService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PdfExportService,
        { provide: PrismaPortalService, useValue: {} },
        { provide: PrismaSAAService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(PdfExportService);
  });

  const build = (contentHtml: string) =>
    (service as any).buildHtmlDocument({ titulo: 'Prova', contentHtml }) as string;

  it('formato NOVO (com marcador): renderiza verbatim, sem o wrap .conteudo', () => {
    const snapshot =
      '<!doctype html><html><head><meta name="ed-print-snapshot" content="1"><title>X</title><style>.ed-root{font-family:"Liberation Sans"}</style></head><body><div class="ed-root">oi</div></body></html>';
    const out = build(snapshot);
    expect(out).toContain('<div class="ed-root">oi</div>');
    expect(out).not.toContain('class="conteudo"');
    // injeta a fonte embutida no <head>
    expect(out).toContain('</head>');
  });

  it('formato ANTIGO (sem marcador): mantém o wrap .conteudo (fallback)', () => {
    const snapshot =
      '<!doctype html><html><head><title>X</title></head><body><div class="ed-root">oi</div></body></html>';
    const out = build(snapshot);
    expect(out).toContain('class="conteudo"');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd api-portal && npx jest src/prova-documento/pdf-export.service.spec.ts`
Expected: FAIL no 1º teste — o output atual SEMPRE embrulha em `class="conteudo"`.

- [ ] **Step 3: Implementar o branch em `buildHtmlDocument`**

Substituir o início do método `buildHtmlDocument` (até antes do `return` do template antigo). O método passa a ser:

```ts
  private buildHtmlDocument(ctx: {
    titulo: string;
    contentHtml: string;
  }): string {
    const timbradoData = this.getTimbradoDataUrl();
    const withTimbrado = (html: string): string =>
      timbradoData
        ? html.replace(
            /src=["']\/v1\/prova-documentos\/assets\/timbrado-prova\.png["']/g,
            `src="${timbradoData}"`,
          )
        : html;

    // Formato NOVO (fidelidade total): o cliente envia o HTML standalone do
    // serializePaginatedHtml (o MESMO do Baixar PDF), com o CSS do editor
    // inlinado. Renderiza VERBATIM, só injetando a fonte embutida — o Chrome do
    // Linux não tem a .ttf que o @font-face do frontend referencia por URL.
    if (ctx.contentHtml.includes('name="ed-print-snapshot"')) {
      return withTimbrado(ctx.contentHtml).replace(
        '</head>',
        `<style>${getFontFaceCSS()}</style></head>`,
      );
    }

    // Fallback (snapshots antigos, .ed-root cru): embrulha com getContentCSS.
    const fontFaceCSS = getFontFaceCSS();
    const contentHtml = withTimbrado(ctx.contentHtml);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(ctx.titulo)}</title>
<style>
  ${fontFaceCSS}
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    font-family: ${FONT_FAMILY};
    color: #000;
    font-size: ${FONT_SIZE};
    line-height: ${LINE_HEIGHT};
    margin: 0;
    padding: 0;
  }
  ${SERVER_LEGACY_ED_CSS}
  ${getContentCSS('.conteudo')}
</style>
</head>
<body>
  <div class="conteudo">
    ${contentHtml}
  </div>
</body>
</html>`;
  }
```

NOTA: o bloco grande de regras `.ed-root`/`.ed-page`/`.prova-header` que está hoje hardcoded no template **permanece igual** — apenas extraia-o para uma const `SERVER_LEGACY_ED_CSS` (string) no topo do arquivo OU mantenha o bloco inline no template do fallback (sem extrair). O importante: **não alterar o fallback**, só envolvê-lo no `else`. Se preferir não extrair a const, cole o bloco CSS atual (linhas ~241-334 do arquivo original) no lugar de `${SERVER_LEGACY_ED_CSS}`.

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd api-portal && npx jest src/prova-documento/pdf-export.service.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Build do api-portal**

Run: `cd api-portal && npm run build`
Expected: `Successfully compiled`.

- [ ] **Step 6: Commit**

```bash
cd api-portal
git add src/prova-documento/pdf-export.service.ts src/prova-documento/pdf-export.service.spec.ts
git commit -m "feat(pdf): renderiza snapshot novo verbatim (= Baixar PDF) + fallback antigo"
```

---

### Task 3: Copiar as fontes Liberation Sans para o professores

**Files:**
- Create: `portal-professores/frequencia-ocorrencia/public/assets/fonts/LiberationSans-*.ttf`

- [ ] **Step 1: Copiar as 4 variantes + LICENSE do portal2**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz
mkdir -p portal-professores/frequencia-ocorrencia/public/assets/fonts
cp portal2-next/public/assets/fonts/LiberationSans-Regular.ttf \
   portal2-next/public/assets/fonts/LiberationSans-Bold.ttf \
   portal2-next/public/assets/fonts/LiberationSans-Italic.ttf \
   portal2-next/public/assets/fonts/LiberationSans-BoldItalic.ttf \
   portal2-next/public/assets/fonts/LICENSE-LiberationSans \
   portal-professores/frequencia-ocorrencia/public/assets/fonts/
```

- [ ] **Step 2: Verificar**

Run: `ls portal-professores/frequencia-ocorrencia/public/assets/fonts/ | grep -i liberation`
Expected: as 4 `.ttf`.

- [ ] **Step 3: Commit**

```bash
cd portal-professores/frequencia-ocorrencia
git add public/assets/fonts/
git commit -m "chore: fontes Liberation Sans (fidelidade PDF)"
```

---

### Task 4: portal2 — @font-face + Liberation Sans no editor

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/sofer-editor.css`

- [ ] **Step 1: Adicionar @font-face no topo do `sofer-editor.css`**

Inserir ANTES da regra `.ed-root` (no início do arquivo):

```css
@font-face {
  font-family: "Liberation Sans";
  font-weight: 400;
  font-style: normal;
  src: url("/portal2/assets/fonts/LiberationSans-Regular.ttf") format("truetype");
}
@font-face {
  font-family: "Liberation Sans";
  font-weight: 700;
  font-style: normal;
  src: url("/portal2/assets/fonts/LiberationSans-Bold.ttf") format("truetype");
}
@font-face {
  font-family: "Liberation Sans";
  font-weight: 400;
  font-style: italic;
  src: url("/portal2/assets/fonts/LiberationSans-Italic.ttf") format("truetype");
}
@font-face {
  font-family: "Liberation Sans";
  font-weight: 700;
  font-style: italic;
  src: url("/portal2/assets/fonts/LiberationSans-BoldItalic.ttf") format("truetype");
}
```

- [ ] **Step 2: Trocar Arial → Liberation Sans nas 3 declarações**

`.ed-root` (font-family):
```css
  font-family: "Liberation Sans", Arial, "Helvetica", sans-serif;
```
`.prova-header__titulo`:
```css
  font-family: "Liberation Sans", Arial, sans-serif;
```
`.prova-header__campos`:
```css
  font-family: "Liberation Sans", Arial, sans-serif;
```

- [ ] **Step 3: Commit**

```bash
cd portal2-next
git add src/components/ProvaEditor/sofer-editor.css
git commit -m "feat(ProvaEditor): editor em Liberation Sans (@font-face + fonte)"
```

---

### Task 5: professores — @font-face + Liberation Sans no editor

**Files:**
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/sofer-editor.css`

- [ ] **Step 1: Adicionar @font-face no topo do `sofer-editor.css`** (URLs servidas pela raiz do Vite, sem basePath)

```css
@font-face {
  font-family: "Liberation Sans";
  font-weight: 400;
  font-style: normal;
  src: url("/assets/fonts/LiberationSans-Regular.ttf") format("truetype");
}
@font-face {
  font-family: "Liberation Sans";
  font-weight: 700;
  font-style: normal;
  src: url("/assets/fonts/LiberationSans-Bold.ttf") format("truetype");
}
@font-face {
  font-family: "Liberation Sans";
  font-weight: 400;
  font-style: italic;
  src: url("/assets/fonts/LiberationSans-Italic.ttf") format("truetype");
}
@font-face {
  font-family: "Liberation Sans";
  font-weight: 700;
  font-style: italic;
  src: url("/assets/fonts/LiberationSans-BoldItalic.ttf") format("truetype");
}
```

- [ ] **Step 2: Trocar Arial → Liberation Sans** nas mesmas 3 declarações (`.ed-root`, `.prova-header__titulo`, `.prova-header__campos`), com o valor:
```css
  font-family: "Liberation Sans", Arial, sans-serif;
```
(em `.ed-root`, manter `"Helvetica"` como no portal2: `"Liberation Sans", Arial, "Helvetica", sans-serif`.)

- [ ] **Step 3: Commit**

```bash
cd portal-professores/frequencia-ocorrencia
git add src/components/ProvaEditor/sofer-editor.css
git commit -m "feat(ProvaEditor): editor em Liberation Sans (@font-face + fonte)"
```

---

### Task 6: forceArialOnImport → Liberation Sans (ambos os frontends)

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/index.tsx` (linha ~63)
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/index.tsx` (linha ~64)

- [ ] **Step 1: Trocar a const em portal2**

De:
```ts
const ARIAL_FONT = 'Arial';
```
Para:
```ts
// Fonte aplicada ao conteúdo importado de DOCX — unificada com o editor/PDF.
const ARIAL_FONT = 'Liberation Sans';
```

- [ ] **Step 2: Trocar a const em professores** (idêntico ao Step 1).

- [ ] **Step 3: Commit (cada repo)**

```bash
cd portal2-next && git add src/components/ProvaEditor/index.tsx && git commit -m "fix(ProvaEditor): import DOCX usa Liberation Sans"
cd ../portal-professores/frequencia-ocorrencia && git add src/components/ProvaEditor/index.tsx && git commit -m "fix(ProvaEditor): import DOCX usa Liberation Sans"
```

---

### Task 7: triggerSnapshot grava o HTML gold-standard (ambos)

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/index.tsx`
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/index.tsx`

- [ ] **Step 1: Importar `serializePaginatedHtml` (ambos)**

Trocar:
```ts
import { exportPdfFromElement } from '@sofereditor/export-pdf';
```
por:
```ts
import { exportPdfFromElement, serializePaginatedHtml } from '@sofereditor/export-pdf';
```

- [ ] **Step 2: Usar `serializePaginatedHtml` no `triggerSnapshot` (professores)**

Substituir o corpo que monta `html`:
```ts
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      (titulo || 'Prova') +
      '</title></head><body>' +
      root.outerHTML +
      '</body></html>';
```
por:
```ts
    // HTML gold-standard: o MESMO que o Baixar PDF imprime (CSS do editor
    // inlinado). O servidor renderiza isto verbatim → PDF enviado = baixado.
    const html = serializePaginatedHtml(root, { title: titulo || 'Prova' });
```

- [ ] **Step 3: Mesmo ajuste no portal2** (o bloco está em ~`502-510`; trocar a mesma construção manual de `html` por `serializePaginatedHtml(root, { title: titulo || 'Prova' })`).

- [ ] **Step 4: Build dos dois frontends**

Run: `cd portal-professores/frequencia-ocorrencia && npx vite build`
Expected: `✓ built`.

Run: `cd portal2-next && npm run build`
Expected: build OK (EXIT 0).

- [ ] **Step 5: Commit (cada repo)**

```bash
cd portal2-next && git add src/components/ProvaEditor/index.tsx && git commit -m "feat(ProvaEditor): snapshot usa serializePaginatedHtml (gold-standard p/ servidor)"
cd ../portal-professores/frequencia-ocorrencia && git add src/components/ProvaEditor/index.tsx && git commit -m "feat(ProvaEditor): snapshot usa serializePaginatedHtml (gold-standard p/ servidor)"
```

---

### Task 8: Verificação end-to-end (visual)

**Files:** nenhum (validação)

- [ ] **Step 1: Subir api-portal + um frontend** (dev), abrir uma prova com texto + tabela + imagem + timbrado.

- [ ] **Step 2: Disparar autosave** (editar algo) para gravar o snapshot no formato novo.

- [ ] **Step 3: Gerar os dois PDFs**
  - Baixar PDF (botão) → salvar.
  - Enviar/gerar PDF do servidor (`POST /v1/prova-documentos/:id/pdf`) → baixar o PDF retornado.

- [ ] **Step 4: Comparar** lado a lado: fonte (Liberation Sans nos dois), tipografia, margens e **quebras de página** devem coincidir.

- [ ] **Step 5: Back-compat** — gerar o PDF do servidor para um doc cujo snapshot é antigo (sem o marcador) e confirmar que **não quebra** (usa o fallback `getContentCSS`).

---

## Self-Review

- **Cobertura do spec:** unificação de fonte (Tasks 3–6) ✓; cliente grava gold-standard (Task 7) ✓; servidor renderiza verbatim + font-face (Task 2) ✓; back-compat por detecção de marcador (Tasks 1+2) ✓; verificação (Task 8) ✓.
- **Placeholders:** nenhum — todo step tem o código/comando exato. (O `SERVER_LEGACY_ED_CSS` do Task 2 Step 3 traz nota explícita: extrair a const OU colar o bloco CSS atual; o fallback não muda.)
- **Consistência de tipos/nomes:** o marcador `name="ed-print-snapshot"` é o mesmo no Task 1 (escrita) e Task 2 (detecção); `serializePaginatedHtml` é a mesma assinatura em Task 7.
