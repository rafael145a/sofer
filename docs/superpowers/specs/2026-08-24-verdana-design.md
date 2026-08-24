# Fonte padrão do editor: Liberation Sans → Verdana — Design

Data: 2026-08-24

## Contexto / Problema

A escola comprou licença de webfont da Verdana (kit MyFonts "Editor_Prova",
Build ID 3867246) e quer trocar a fonte padrão do editor de provas.

**O ponto de partida do briefing estava errado e vale registrar.** O
`docs/ONBOARDING.md` afirma que a fonte é Arial. Não é desde 17/06/2026: a
migração para **Liberation Sans** aconteceu em
`docs/superpowers/specs/2026-06-17-pdf-fidelidade-total-design.md`, porque
Liberation Sans é clone métrico da Arial e é a fonte que o servidor embute em
base64 para o Puppeteer. Toda a implementação abaixo parte do estado real, não
do briefing.

Estado real hoje:

| Onde | Valor |
| --- | --- |
| `portal2-next/src/components/ProvaEditor/sofer-editor.css:34` | `"Liberation Sans", Arial, "Helvetica", sans-serif` + 4 `@font-face` |
| `frequencia-ocorrencia/.../sofer-editor.css:34` | idem (arquivo byte-idêntico) |
| `portal2-next/src/components/ProvaEditor/index.tsx:78` | `const ARIAL_FONT = 'Liberation Sans'` |
| `api-portal/src/prova-documento/shared-print-styles.ts:47` | `FONT_FAMILY = "'Liberation Sans', Arial, sans-serif"` |
| `editor-monorepo` | ainda diz `"Arial"`, mas só em caminho de playground/teste |

### O problema real não é a folha de estilo

`forceArialOnImport` (`portal2-next/.../index.tsx:84`) grava
`fontFamily: 'Liberation Sans'` **em cada op de texto** de todo documento
importado de `.docx`. Isso persiste no Y.js.

E é redundante desde sempre:

- `packages/import-docx/src/runs.ts:133` — `w:rFonts` é descartado de propósito;
  `import-docx` **nunca** emite `fontFamily`.
- `packages/react/src/htmlToSlice.ts:763` — `fontFamily` é descartada sempre, com
  teste travando o comportamento (`htmlToSlice.test.ts:708-806`).

Ou seja: o carimbo é aplicado a conteúdo que já chegava sem fonte nenhuma. Se a
troca fosse só de CSS, toda prova importada renderizaria **fonte misturada** —
trechos importados em Liberation Sans inline, o resto herdando Verdana — no
editor e no PDF.

### Bug latente encontrado durante a investigação

`packages/react/src/Toolbar.tsx:26` oferece `FONT_FAMILIES = ["Arial"]`, mas o
`.ed-root` renderiza Liberation Sans. Se um professor escolhe "Arial" nesse
dropdown, grava `fontFamily: Arial` inline: no Mac dele aparece Arial de
verdade, mas o Chrome do servidor Linux não tem Arial, cai em fallback com
métricas diferentes, e o PDF diverge do editor. A toolbar mente desde junho.

## Medições (Puppeteer, mesmo engine que gera o PDF)

Coluna de 718px (`CONTENT_WIDTH_PX`), 11pt, `line-height` 1.45.

| Métrica | Liberation Sans | Verdana |
| --- | --- | --- |
| Largura de avanço, texto corrido | — | **+14,4%** |
| Minúsculas `a-z` | — | +14,8% |
| Maiúsculas `A-Z` | — | +1,3% |
| Números `0-9` | — | +14,3% |
| Linhas totais (80 parágrafos variados) | 272 | **310 (+14,0%)** |
| Altura total | 6416px | **7224px (+12,6%)** |
| Páginas (1024px de conteúdo/página) | 7 | **8** |
| Parágrafos que ganharam uma linha | — | **38 de 80** |

`line-height` **não** muda (1,45 × 11pt = 21,27px nas duas). Todo o crescimento
vem de quebra de linha. Prova é quase toda minúscula, então o número que vale é
o de ~14%, não o de maiúsculas.

Armadilha de medição, registrada para quem repetir: com parágrafos sintéticos
de **comprimento uniforme** o resultado dá **0%**, porque todos caem no mesmo
número de linhas nas duas fontes. É preciso variar o comprimento e contar
caixas de linha (`Range.getClientRects()` agrupado por `top`), além de manter
uma sonda `white-space: nowrap` para provar que as duas fontes realmente
carregaram — sem a sonda a medição falha em silêncio.

### Riscos derivados, verificados e descartados

- **`rowHeights` de tabela** (`NodeView.tsx:218`, `html.ts:221`) — `height` em
  `<tr>` é tratado como **mínimo** em tabela CSS. Medido: linha de 32px com
  texto de 2 linhas cresce para 55,5px, sem corte. `.ed-cell` não tem
  `overflow: hidden`. Tabelas ficam mais altas; nada é truncado em silêncio.
- **Altura do cabeçalho da 1ª página** — medida do DOM
  (`index.tsx:501` → `headerHeightPx` → `firstPageExtraTop`). Se a Verdana
  quebrar linha no cabeçalho, o editor se ajusta sozinho.
- **`PDF_HEADER_H = 333` / `FIRST_PAGE_CONTENT_H = 691`** — constantes mortas,
  sem nenhum uso no monorepo nem nos apps.

## Decisões (tomadas no brainstorming)

1. **Licença é de webfont.** Servir por `@font-face` e embutir em base64 no HTML
   do Puppeteer estão cobertos. Ressalva registrada abaixo.
2. **Limpar as marcas `fontFamily` e herdar do CSS.** Corrige a causa-raiz; a
   próxima troca de fonte vira uma linha de CSS.
3. **11pt fica; as páginas a mais são aceitas.** Compensar com 10pt foi
   descartado — 11pt é prescrição da escola e mexer nisso é outra decisão de
   produto.

## Abordagem

A fonte passa a viver **exclusivamente no CSS** (`.ed-root`), em nenhum lugar do
modelo. Três consequências que estruturam o resto:

1. O dropdown de fonte da toolbar sai. Sua única função é `setMark("fontFamily")`
   — a marca que estamos eliminando. Mantê-lo com "Verdana" recriaria o fóssil e
   entraria em guerra com a limpeza no load, que apagaria a escolha do professor
   no próximo open. Dois mecanismos brigando.
2. A limpeza das marcas existentes é um helper **no monorepo**, chamado pelos
   dois apps — não duas cópias da mesma migração em dois repos.
3. O caminho legado do servidor não é tocado. Snapshot antigo nomeia Liberation
   Sans no CSS inlinado dele e continua resolvendo Liberation Sans, porque o
   servidor passa a embutir **as duas** famílias.

## Mudanças

### 1. `editor-monorepo` — a única parte que exige release

**`packages/react/src/Toolbar.tsx`** — remover o `<select>` de fonte, o handler
`onFontFamilyChange`, a variável `fontFamilyValue` e a constante
`FONT_FAMILIES`. `FONT_FAMILIES` é local do módulo, não exportada: não é quebra
de API pública.

O comentário em `:23` diz que o dropdown foi **mantido de propósito** para
"manter o UI de tamanho/cor balanceado". Remover continua certo, mas o motivo do
autor original não evapora: conferir visualmente como a barra fica sem aquele
`<select>` e, se desbalancear, decidir entre um rótulo estático ou aceitar o
reflow. Decisão a tomar olhando, não no papel.

**`packages/core`** — novo helper exportado. A assinatura sai da representação
real, verificada: o delta **não** é array de ops no Y.js, é `Y.Text` com
atributos de formatação. Bloco é `Y.Map` com `"text"` → `Y.Text`
(`document.ts:130`); tabela tem `"cells"` → `Y.Array<Y.Map>`, cada célula com seu
`Y.Text` (`document.ts:169,181`). Remoção de marca já tem padrão no repo:
`yText.format(inicio, len, { [nome]: null })` (`commands.ts:329`).

```ts
/** Remove toda marca `fontFamily` do documento. A fonte vem do CSS (`.ed-root`),
 *  nunca do modelo.
 *
 *  Varre cada `Y.Text` (bloco e célula de tabela), lê `toDelta()`, e para cada
 *  run que carregue `fontFamily` chama `format(i, len, { fontFamily: null })`.
 *
 *  Idempotente: conta primeiro e só abre transação se houver o que limpar.
 *  Retorna o número de runs limpos — 0 significa nenhuma escrita no Y.Doc.
 *
 *  `dryRun: true` conta sem escrever. */
export function stripFontFamilyMarks(
  doc: EditorDocument,
  opts?: { dryRun?: boolean },
): number
```

Recebe `EditorDocument`, não `Y.Doc` cru — é o que expõe `blockCount()`,
`getBlockText()`, `getCells()`, `getCellText()`.

A transação usa origin próprio (`"migration"`), seguindo a convenção de
`"pageSettings"` e `"import"` (`document.ts:106`): origens que o `UndoManager`
**não** rastreia. Sem isso, o primeiro Ctrl+Z do professor desfaz a migração em
vez da edição dele.

Remove **todas** as marcas `fontFamily`, não só as de valor conhecido: com o
dropdown fora, nenhuma marca legítima pode existir.

**Coerência, sem efeito em produção** (verificado: `documentToHtml` só é chamado
por `apps/playground/src/App.tsx:50`; produção usa apenas
`serializePaginatedHtml` e `exportPdfFromElement`, que clonam o DOM vivo e
inlinam o CSS real do app):

- `packages/export-pdf/src/html.ts:498` (`baseStylesheet`) — `"Arial"` → stack
  da Verdana.
- `apps/playground/src/styles.css:171` + `@font-face` das 4 faces no playground,
  para dar para testar clicando.
- Comentários desatualizados: `import-docx/src/runs.ts:133`,
  `react/src/htmlToSlice.ts:37` e `:764`, `react/src/Toolbar.tsx:23`.

**`packages/export-docx/src/docx.ts` — o terceiro caminho, e ele é obrigatório.**
`const ARIAL: RunDefaults = { font: "Arial" }` (`:218`) força Arial em 5 pontos
(`:228`, `:258`, `:272`, `:297`, `:425`). Hoje o DOCX diz "Arial" enquanto o
editor e o PDF renderizam Liberation Sans — e isso funciona **por acidente
feliz**: as duas são clones métricos, então a paginação bate mesmo com nomes
diferentes. Verdana acaba com o acidente. Deixar `Arial` ali faria o Word do
professor renderizar ~14% mais estreito que o PDF, com quebras de página
completamente diferentes. Renomear a constante para `VERDANA` e trocar o valor.

Ganho colateral real: Verdana já vem instalada no Windows e no macOS, então o
Word dos professores renderiza nativo — coisa que Liberation Sans nunca teve
(o DOCX pedia "Arial" justamente para não cair em fallback na máquina deles).

Ressalva de fidelidade do caminho DOCX: o Word usa a Verdana **instalada na
máquina do professor**, que pode ser uma versão diferente da do kit MyFonts que
o editor e o PDF usam. Divergência esperada é pequena (as duas são a Verdana da
Microsoft) e menor que a de hoje, mas o DOCX segue sendo o caminho de menor
garantia dos três — ele nunca embute a fonte, só a nomeia.

**Não mexer:** `renderInline.tsx:310` continua emitindo `font-family` quando a
marca existe, e `renderInline.test.tsx:52` continua passando — testa o
renderizador, não a política de fonte.

→ publica `@sofereditor/core`, `@sofereditor/react` e
`@sofereditor/export-docx` em **0.10.0**. Os três já existem no npm; não cai na
armadilha de primeiro publish de nome novo.

### 2. `api-portal` — sem mudar um pixel de prova antiga

**`src/prova-documento/assets/fonts/`** — adicionar as 4 faces WOFF2 da Verdana
e o aviso de licença do kit. **Manter** os 4 TTF da Liberation Sans.

**`getFontFaceCSS()`** (`shared-print-styles.ts:68`) — emitir **as duas
famílias**. Liberation Sans continua porque snapshot antigo a nomeia no CSS
inlinado dele; Verdana entra para os novos. Precisa de caminho WOFF2
(`format('woff2')`, mime `font/woff2`): o kit não tem TTF.

**`FONT_FAMILY`** — **não muda de valor**. Renomear para `FONT_FAMILY_LEGACY` e
documentar o alcance. Verificados os 4 usos, todos no caminho legado:
`pdf-export.service.ts:51,101,113` dentro de `SERVER_LEGACY_ED_CSS` e `:465` no
wrapper de snapshot `.ed-root` cru. Prova antiga em formato legado renderiza
byte-idêntica.

**Corrigir o cabeçalho mentiroso do arquivo** — `shared-print-styles.ts:5-8` diz
"copiado em 3 locais" e lista caminhos nos dois apps. Os arquivos **não existem
lá**; nenhum app importa `getContentCSS` ou `FONT_FAMILY`. O arquivo é
backend-only.

**Limpeza no arquivo tocado** — remover `PDF_HEADER_H` e `FIRST_PAGE_CONTENT_H`
(constantes mortas, ver acima).

### 3. `portal2-next` e `frequencia-ocorrencia` — idênticos

**`public/assets/fonts/`** — adicionar `Verdana-{Regular,Bold,Italic,BoldItalic}`
em WOFF2, com WOFF como fallback. **Manter** os arquivos da Liberation Sans: são
inertes depois que o CSS deixa de referenciá-los, e apagá-los não ganha nada que
justifique o risco de algum caminho não mapeado ainda pedi-los.

**`sofer-editor.css`** — os 4 `@font-face` reescritos numa **única família
`"Verdana"`** com descritores `font-weight`/`font-style`:

```css
@font-face { font-family:"Verdana"; font-weight:400; font-style:normal;  src: url(".../Verdana-Regular.woff2") format("woff2"), url(".../Verdana-Regular.woff") format("woff"); }
@font-face { font-family:"Verdana"; font-weight:700; font-style:normal;  src: url(".../Verdana-Bold.woff2") ... }
@font-face { font-family:"Verdana"; font-weight:400; font-style:italic;  src: url(".../Verdana-Italic.woff2") ... }
@font-face { font-family:"Verdana"; font-weight:700; font-style:italic;  src: url(".../Verdana-BoldItalic.woff2") ... }
```

O kit da MyFonts declara **quatro famílias separadas** (`VerdanaRegular`,
`VerdanaBold`, `VerdanaItalic`, `VerdanaBoldItalic`), sem descritores. Copiado
como veio, negrito e itálico viram síntese do Regular e as métricas medidas
acima não valem.

`@font-face` no frontend também, **nunca** a Verdana local do sistema: mesmos
bytes dos dois lados é a única resposta à prova de versão, e é o que o arranjo
da Liberation Sans já fazia. Não "otimizar" isso depois.

Declarações `font-family` nas linhas **34** (`.ed-root`), **577**
(`.prova-header__titulo`) e **589** (`.prova-header__campos`) → `"Verdana",
sans-serif`. Caminhos das URLs diferem entre os apps: `/portal2/assets/fonts/`
no portal2-next, `/assets/fonts/` no frequencia-ocorrencia.

**`index.tsx`** — deletar `ARIAL_FONT` (`:78`), `forceArialOnImport` (`:84-98`) e
a chamada (`:763`). Chamar `stripFontFamilyMarks(editorDoc)` uma vez, depois de
`synced` e antes de armar o autosave.

### Contenção da migração — ela é destrutiva

A migração roda **na abertura do documento**, muta o `Y.Doc` e o Hocuspocus
persiste. Sem contenção, um bug aqui não é falha visual: é conteúdo de prova
corrompido que sincroniza antes de alguém perceber. O repo já trata operações
destrutivas de Y.js como classe à parte (o `clear+push` do import tem lock e
guarda de tamanho).

Duas travas, ambas baratas:

1. **`dryRun` primeiro.** O helper entra em produção com a contagem antes da
   escrita. Rodar `dryRun` contra provas reais e conferir os números **antes** de
   ligar a escrita na abertura. Não ligar as duas coisas no mesmo deploy.
2. **Idempotência observável.** `stripFontFamilyMarks` retorna a contagem e o app
   loga quando `> 0`. Documento já limpo não abre transação, então não gera
   update, não dispara autosave e não regrava snapshot. É isso que garante que
   reabrir uma prova pela segunda vez não faça nada.

## Ordem de implantação

Não é arbitrária:

```
monorepo (publish 0.10.0) → api-portal → frontends
```

Se o frontend for antes do `api-portal`, um snapshot novo chega ao servidor
nomeando Verdana, o Chrome do Linux não tem a fonte, cai em fallback com métrica
diferente e sai **PDF errado, impresso e entregue**. É exatamente o cenário que
a regra do "PDF do servidor sem fallback" existe para impedir.

Lembrete de release: a lista de pacotes é fixa dentro do `publish.yml` e ele pula
quem já tem a versão no npm.

**`frequencia-ocorrencia` não tem gate de tipo nenhum no CI.** Esta mudança toca
o `index.tsx` dele duas vezes — remove `forceArialOnImport` e adiciona import
novo de `@sofereditor/core`. Erro de tipo lá só aparece em runtime, na frente do
professor. Rodar `tsc --noEmit` **localmente** nesse app é passo obrigatório da
implantação, não opcional.

## Consequências que o usuário precisa aceitar

**Prova antiga reaberta repagina.** O autosave escuta `ydoc.on('update')`
(`index.tsx:616`) e a migração gera um update; 2s depois o `htmlSnapshot` é
regravado em Verdana. Isso é forçado pelo norte — se o editor mostra Verdana, o
PDF tem que mostrar Verdana. Mas significa que "aceito páginas a mais" vale
**retroativamente**, para qualquer prova aberta em modo edição, não só para as
novas. O guarda `readOnly` protege quem só visualiza.

**Ressalva de licença.** Quando o Puppeteer gera o PDF, o Chrome embute um subset
da Verdana **dentro do arquivo PDF**, que depois vai por e-mail. Isso é *PDF
embedding*, direito distinto de "exibir num site" e que EULAs de webfont nem
sempre incluem. Com Liberation Sans (licença livre) a questão não existia. Vale
conferir a cláusula no contrato da MyFonts. Não é bloqueio técnico.

## Testes e verificação

- **Unitário, `core`:** `stripFontFamilyMarks` limpa delta de bloco e de célula;
  é idempotente; não abre transação quando não há marca.
- **Regressão, `api-portal`:** `pdf-export.service.spec.ts` — snapshot em formato
  legado continua resolvendo Liberation Sans; snapshot novo resolve Verdana;
  `getFontFaceCSS()` emite as duas famílias.
- **Harness de fonte (Puppeteer):** afirmar que as **4** faces carregam de fato
  (`[...document.fonts].filter(f => f.status === 'loaded')`). Sem isso o Chrome
  sintetiza negrito/itálico e a fidelidade medida não vale.
- **Manual, clicando de verdade** (não disparar `change` por script — isso pula o
  caminho que quebra): playground e um dos apps — digitar, negrito, itálico,
  negrito-itálico, tabela com `rowHeights`, importar um `.docx`, abrir uma prova
  antiga e conferir que a fonte fica uniforme, Baixar PDF, e comparar contra o
  PDF do servidor.
- **Comparar os três caminhos** — editor, PDF e DOCX — antes de declarar pronto.

## Fora de escopo

- Divergência de `line-height`: **1.5** em `baseStylesheet`
  (`export-pdf/src/html.ts`) contra **1.45** em `shared-print-styles.ts`.
  Divergência real, mas de caminho de playground e alheia a esta mudança.
- Fonte por documento (permitir que provas antigas fiquem congeladas em
  Liberation Sans). Exigiria atributo de fonte no modelo — é uma feature, não uma
  migração.

## Documentação a corrigir ao final

- `docs/ONBOARDING.md:78-79` — diz Arial; produção é Liberation Sans desde junho
  e passa a ser Verdana. Registrar **por que** a fonte agora é só CSS: essa é a
  lição durável do fóssil do `forceArialOnImport`.
- Memória `feedback_arial_only.md` — mesma correção.
