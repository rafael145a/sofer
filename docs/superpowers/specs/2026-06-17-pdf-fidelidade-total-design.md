# PDF enviado = Baixar PDF (fidelidade total) — Design

Data: 2026-06-17

## Contexto / Problema

Hoje há **dois pipelines diferentes** de geração de PDF para a prova:

- **Baixar PDF** (coordenador/professor): `exportPdfFromElement(root)` →
  `serializePaginatedHtml(root)` (HTML standalone com TODO o CSS do editor
  inlinado) → `window.print()` no Chrome do usuário. É o **padrão ouro** de
  fidelidade para o usuário.
- **Enviar para impressão / e-mail**: servidor (`PdfExportService`) pega o
  `htmlSnapshot` (o `.ed-root.outerHTML` cru) e o **re-embrulha com
  `getContentCSS`** (Liberation Sans, tamanhos/margens próprios) → Puppeteer
  `page.pdf()`.

Como o servidor aplica um CSS diferente do editor, o PDF enviado **diverge** do
Baixar PDF (tipografia, quebras de página). O motor é o mesmo Chrome (o
`window.print` e o Puppeteer usam o mesmo print engine) — o gap é só o CSS/HTML.

**Objetivo:** o PDF enviado por impressão/e-mail deve ser **idêntico** ao
Baixar PDF.

## Decisões (tomadas no brainstorming)

1. **Puppeteer continua** no servidor (é o mesmo Chrome do `window.print`). O
   problema nunca foi o headless, e sim o CSS/HTML diferente.
2. **Fonte unificada em Liberation Sans** em todo lugar (tela do editor +
   Baixar PDF + servidor) → identidade total. (Liberation Sans é clone métrico
   da Arial e já é a fonte que o servidor embute; padronizar elimina a única
   divergência residual de glifos.)

## Abordagem

O servidor renderiza o **mesmo HTML** que o Baixar PDF imprime, verbatim, com o
mesmo Chrome. Como `serializePaginatedHtml` inlina o CSS real do editor, a
fidelidade é garantida **por construção** — nunca dessincroniza. A única coisa
que o headless precisa a mais é a **fonte embutida** (Chrome no Linux não tem a
fonte que o HTML referencia).

```
Baixar PDF:   serializePaginatedHtml(root) → window.print()        [Chrome do usuário]
Enviar (novo): serializePaginatedHtml(root) → snapshot no server
              → Puppeteer renderiza VERBATIM (+ @font-face) → page.pdf() → e-mail
```

## Mudanças

### 1. Unificar a fonte → Liberation Sans (tela + download)
- **`@font-face`** da Liberation Sans carregado nos 2 frontends, servindo
  `public/assets/fonts/LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf`.
  - portal2-next: precisa **adicionar** (hoje não há `@font-face`).
  - portal-professores: já há algo em `src/styles/global.js` — confirmar/ajustar
    para apontar às 4 variantes.
- **`sofer-editor.css`** (ambos): trocar as declarações Arial por
  `"Liberation Sans", Arial, sans-serif` em `.ed-root` (linha ~9) e no header da
  prova (`.prova-header__titulo`, `.prova-header__campos` — linhas ~500/512).
- **`forceArialOnImport`** (ProvaEditor, ambos): passar a forçar **Liberation
  Sans** no conteúdo importado de DOCX (renomear para `forceFontOnImport` ou
  ajustar o valor).

### 2. Cliente captura o HTML gold-standard
- `triggerSnapshot` (autosave do ProvaEditor, ambos) passa a gravar
  **`serializePaginatedHtml(root)`** (já exportado de `@sofereditor/export-pdf`)
  em vez do `root.outerHTML` embrulhado manualmente. Assim o snapshot que o
  servidor usa É o que o Baixar PDF imprimiria.
- Possível ajuste em `serializePaginatedHtml`: garantir que o `@font-face` da
  Liberation Sans entre no HTML clonado (via `collectStyles`, que já inlina os
  stylesheets do documento — o `@font-face` adicionado no item 1 será incluído).

### 3. Servidor renderiza verbatim
- `PdfExportService.buildHtml`: renderizar o HTML do snapshot **como está**
  (remover o wrap `getContentCSS('.conteudo')` e as regras `.ed-page`
  re-injetadas — já vêm no HTML do cliente).
- **Injetar `getFontFaceCSS()`** (Liberation Sans em base64) no `<head>` do HTML
  — o Chrome do Linux passa a ter a fonte que o HTML referencia.
- Manter: substituição do timbrado (URL relativa → data URL) e
  `page.pdf({ printBackground, preferCSSPageSize })`.
- `getContentCSS` fica órfão para o PDF — manter por ora (limpeza futura).

### 4. Back-compat (snapshots antigos)
Snapshots já gravados estão no formato cru (sem CSS inlinado). O servidor
**detecta o formato**: novo = self-contained (heurística confiável, ex.: contém
`@page` ou um marcador injetado por `serializePaginatedHtml`) → renderiza
verbatim; senão → cai no caminho atual (`getContentCSS`) como fallback. Qualquer
edição/autosave ou um Baixar PDF regrava no formato novo, então a migração é
automática.

## Arquivos afetados
- `editor-monorepo/packages/export-pdf/src/pdf.ts` — (talvez) garantir `@font-face` no clone.
- `portal2-next` e `portal-professores/.../`:
  - `src/components/ProvaEditor/sofer-editor.css` — fonte.
  - `@font-face` (portal2: novo; professores: `src/styles/global.js`).
  - `src/components/ProvaEditor/index.tsx` — `forceArialOnImport`, `triggerSnapshot`.
- `api-portal/src/prova-documento/pdf-export.service.ts` — render verbatim + font-face + back-compat.

## Verificação
Para o mesmo documento (texto + tabela + imagem + timbrado): gerar o PDF do
servidor (`POST /:id/pdf`) e o Baixar PDF; comparar visualmente — fonte,
tipografia, margens e **quebras de página** devem coincidir. Conferir também um
doc com snapshot antigo (back-compat: não quebra, usa o fallback).

## Fora de escopo
- Remover/limpar `getContentCSS` (vira órfão; limpeza posterior).
- Unificar a geração do "Baixar PDF" para também passar pelo servidor (não é
  necessário — basta o servidor usar o mesmo HTML; o download segue client-side).
