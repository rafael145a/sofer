# Listas dentro de célula de tabela — Design

Data: 2026-08-24

## Contexto / Problema

O professor clica no botão de lista com o cursor dentro de uma célula e **nada
acontece**. Reproduzido clicando de verdade no playground, com controle:

| Onde | Ação | Resultado |
| --- | --- | --- |
| Fora da tabela | clicar "Lista com marcadores" | vira `<ul><li>` ✅ |
| Dentro da célula | clicar o mesmo botão | **nada muda, nenhum erro** ❌ |

### Causa-raiz

**Célula de tabela é um `Y.Text` plano, sem estrutura de blocos.** Lista, neste
editor, é um *tipo de bloco* (`listItem`) com atributos de bloco (`listKind`,
`listLevel`, `listStart`, `listStyle` — `types.ts:47-70`). Célula não pode
conter bloco, logo não pode conter item de lista, e `CellAttrs`
(`types.ts:111`) não tem nenhum campo de lista.

O no-op é **deliberado, não esquecimento**: os três comandos guardam contra
célula.

- `toggleList` — `commands.ts:736`
- `indentList` — `commands.ts:763`
- `dedentList` — `commands.ts:784`

Todos com `if (sel.anchor.cellIndex != null || sel.focus.cellIndex != null) return;`

### Dois outros defeitos que a investigação desenterrou

O botão que não faz nada é o sintoma barulhento. Os dois abaixo são silenciosos
e, por isso, piores — ambos verificados empiricamente, não por leitura.

**1. O import de .docx descarta a numeração dentro de célula.**
`cellChildrenToDelta` (`import-docx/src/tables.ts`) achata todos os `<w:p>` da
célula num delta só, unido por `\n`, e **nunca lê `<w:numPr>`**. Medido com um
.docx construído para o teste:

| Onde | Entrada | Saída do import |
| --- | --- | --- |
| Fora da tabela | `1. um` `2. dois` | dois blocos `listItem`, `listKind: "ordered"` ✅ |
| Dentro da célula | `1. um` `2. dois` `3. três` | uma célula com `text: "um\ndois\ntres"`, `attrs: {}` ❌ |

O professor importa uma prova do Word com lista em tabela e perde os
marcadores, sem aviso.

**2. Célula multilinha exporta para DOCX como uma linha só.**
`makeCell` (`export-docx/src/docx.ts`) emite **um único `<w:p>` por célula** com
o delta inteiro, e `deltaToRuns` troca `\n` por espaço (`docx.ts:527`,
`text.replace(/\n/g, " ")`) porque o Word renderiza `\n` dentro de `<w:t>` como
espaço. Medido — XML gerado para a célula `"um\ndois\ntres"`:

```xml
<w:tc>…<w:p><w:r>…<w:t xml:space="preserve">um dois tres</w:t></w:r></w:p></w:tc>
```

Um `<w:p>`, texto `"um dois tres"`. Isso **já afeta qualquer célula multilinha
hoje**, com ou sem lista.

### Os três caminhos, hoje

| Caminho | Célula multilinha |
| --- | --- |
| Editor | `\n` quebra linha (`.ed-cell { white-space: pre-wrap }`, `sofer-editor.css:318`) ✅ |
| PDF | idem (`export-pdf/src/html.ts:539` tem o mesmo `pre-wrap`) ✅ |
| DOCX | vira uma linha só, `\n` → espaço ❌ |

O DOCX já diverge dos outros dois. Consertar a exportação de lista **exige**
consertar isso, porque a lista precisa de um `<w:p>` por item.

## Decisões (tomadas no brainstorming)

1. **Cada linha da célula vira um item.** A célula já guarda `\n`, e o import já
   junta os parágrafos do Word com `\n` — marcar a célula como lista faz cada
   linha virar item, o que conserta direto a perda na importação.
2. **Recuo por linha fica fora da v1.** `Y.Text` plano não guarda atributo por
   linha; `listLevel` seria um nível por célula, não por item.
3. **Sem blocos dentro de célula.** A alternativa arquiteturalmente correta
   (célula contendo lista de blocos) foi avaliada e descartada por escopo:
   mexeria em modelo, render, paginação, seleção, import, export-docx e
   export-pdf.

## Abordagem

A célula continua sendo um `Y.Text` plano. O que muda é a **interpretação** do
`\n` quando a célula carrega `listKind`: de quebra visual para separador de
item. O render passa a emitir `<ul>`/`<ol>` com um `<li>` por linha.

```
CellAttrs.listKind ausente  → render atual (texto com pre-wrap)
CellAttrs.listKind presente → <ul|ol> com um <li> por segmento entre \n
```

## Mudanças

### 1. `core` — modelo e comandos

**`types.ts`, `CellAttrs`** ganha os campos, espelhando os de bloco:

```ts
/** Quando presente, a célula renderiza como lista e cada linha separada por
 *  `\n` vira um item. Ausente = texto normal. */
listKind?: ListKind;
/** Só relevante com `listKind === "ordered"`. */
listStart?: number;
/** Só relevante com `listKind === "ordered"`. Sobrepõe o marcador padrão. */
listStyle?: ListStyleType;
```

**Não** ganha `listLevel` — ver decisão 2. Adicionar o campo sem suportar
recuo por item convidaria a um uso que o modelo não sustenta.

**`commands.ts`, `toggleList`** deixa de retornar cedo em célula. Quando a
seleção está numa célula, liga/desliga `listKind` **naquela célula**, delegando
para o `setCellAttr` que já existe (`commands.ts:436`, criado quando o
alinhamento em célula foi resolvido). Mantém a semântica de alternância do
caminho de bloco: se a célula já tem aquele `kind`, remove; senão aplica.

`setCellAttr` já resolve de graça dois casos que não precisam de código novo:
aplica a **todas as células de uma seleção retangular** (`commands.ts:449-455`)
e **pula células cobertas** por span (`:458`). Não reimplementar isso.

**`indentList` / `dedentList`** mantêm a guarda de célula, agora com comentário
dizendo **por quê** (v1 não tem nível por item), em vez de guarda muda.

### 2. `react` — render e seleção

**`NodeView.tsx`** — célula com `listKind` renderiza `<ul>`/`<ol>` dentro do
`<td>`, um `<li>` por segmento entre `\n`. Reaproveitar as classes `ed-list`
/`ed-list-{kind}` que o caminho de bloco já usa (`Editor.tsx:1386,1434`), para
o marcador ficar idêntico dentro e fora da tabela.

**`dom-bridge.ts` — a parte de risco, e a razão de este spec existir.**

Hoje o `\n` da célula existe **como caractere num text node** (o `pre-wrap`
renderiza), então offset do modelo ↔ offset do DOM é 1:1. Com `<li>`, os `\n`
**somem do texto do DOM** e o mapeamento quebra por N posições — a classe exata
do bug #1, que custou horas.

A correção é simétrica e **já tem precedente no arquivo**: embeds consomem um
caractere do modelo sem ter texto correspondente, nos dois sentidos.

| Direção | Função | Precedente de embed | O que fazer para `<li>` |
| --- | --- | --- | --- |
| modelo → DOM | `locatePoint` (`:313`) | `remaining -= 1` | ao entrar num `<li>` que não é o primeiro da lista, `remaining -= 1` |
| DOM → modelo | `textOffsetWithin` (`:182`) | `offset += 1` | ao sair de um `<li>` que não é o último, `offset += 1` |

As duas funções são espelhos exatos uma da outra; qualquer assimetria entre
elas é bug de cursor. Os testes têm que cobrir os dois sentidos e a
ida-e-volta.

### 3. `import-docx` — conserta a perda silenciosa

**`tables.ts`, `cellChildrenToDelta`** passa a ler o `<w:numPr>` de cada `<w:p>`
da célula, usando o `NumberingResolver` que já existe (`numbering.ts:91`,
`resolve(numPr)` devolve `{listKind, listLevel, ordinal?}`).

Regra: se **algum** `<w:p>` da célula resolve numeração, a célula recebe
`listKind` daquele parágrafo. O `listLevel` é descartado (decisão 2) — registrar
isso em comentário, como o `w:rFonts` faz, para o descarte ser deliberado e
não parecer esquecimento.

Célula mista (alguns parágrafos com marcador, outros sem) vira lista inteira: é
o comportamento menos surpreendente, e provas reais não misturam.

**Cuidado com efeito colateral no resolvedor.** `resolve()` **muta contador**
(`numbering.ts:113-116`): para lista ordenada ele incrementa o contador daquele
`numId` e grava de volta. Chamar `resolve()` nos parágrafos da célula portanto
**avança a numeração** e muda o ordinal de itens que venham depois da tabela
compartilhando o mesmo `numId`.

Avançar é provavelmente o certo — o Word também conta os parágrafos numerados
dentro da tabela —, mas tem que ser decisão consciente e coberta por teste:
documento com lista numerada, tabela com lista no meio, e lista continuando
depois, conferindo se os ordinais batem com o que o Word mostra. Listas
`bullet` não têm esse efeito: `resolve()` retorna antes de tocar o contador
(`numbering.ts:110`).

### 4. `export-docx` — um `<w:p>` por linha

**`docx.ts`, `makeCell`** passa a dividir o delta da célula por `\n` e emitir
**um `<w:p>` por segmento**, em vez de um `<w:p>` com tudo. Quando a célula tem
`listKind`, cada `<w:p>` recebe `numbering`/`bullet` conforme o kind.

Isso conserta de tabela o defeito 2 acima: célula multilinha **sem** lista
também passa a exportar com as quebras preservadas, em vez de virar uma linha
só. Não é escopo extra — é pré-requisito, porque a lista precisa de um `<w:p>`
por item de qualquer forma.

### 5. `export-pdf` — espelhar o editor

**`html.ts`** renderiza a célula com a mesma estrutura do `NodeView`, e o CSS
embutido ganha as regras de `ed-list` dentro de `.ed-cell`. O norte manda: o que
o professor vê é o que sai no PDF.

## Riscos

**Cursor dentro de célula-lista.** É o risco principal, tratado acima. Mitigação
concreta: testes de ida-e-volta (`modelo → DOM → modelo`) para posições no
começo, meio e fim de cada item, e atravessando fronteira de item.

**Paginação.** A altura da célula muda (marcadores e o espaçamento do `<ul>`).
A medição de linha da tabela já lê o DOM real (`usePagination.ts:557`,
`tr.getBoundingClientRect().height`), então se ajusta sozinha — mas provas
existentes com tabela alta podem repaginar. Verificar antes de fechar.

**Colisão de significado do `\n`.** Fora da tabela, `Shift+Enter` insere `\n`
como quebra suave **dentro** de um item (`Editor.tsx:573-580`). Dentro de uma
célula-lista, `\n` passa a significar **novo item**. Os dois sentidos coexistem
no mesmo caractere. Consequência prática: dentro de célula-lista não há como
fazer quebra suave dentro de um item. Aceito na v1; registrar em comentário no
`NodeView` para o próximo leitor não achar que é bug.

## Fora de escopo

- **Recuo/aninhamento por item** dentro de célula (decisão 2). Exigiria
  atributo por linha, que `Y.Text` plano não guarda.
- **Blocos de verdade dentro de célula** (decisão 3) — destravaria também
  título, linha de resposta e parágrafo múltiplo em célula. É a evolução
  natural quando isto apertar.
- **`listStart`/`listStyle` na UI.** Os campos entram no modelo por simetria com
  o caminho de bloco e para o import poder gravá-los, mas a v1 não expõe
  controle na toolbar.

## Testes e verificação

- **`core`:** `toggleList` numa célula liga e desliga `listKind`; não afeta
  outras células nem blocos; alternância respeita o `kind` corrente.
- **`import-docx`:** o fixture desta investigação (três `<w:p>` com `<w:numPr>`
  dentro de um `<w:tc>`) vira uma célula com `listKind: "ordered"` e
  `text: "um\ndois\ntres"`. Hoje esse teste falha — é o teste de regressão da
  perda silenciosa.
- **`import-docx`, contador:** lista numerada, tabela com lista numerada no
  meio, lista continuando depois — os ordinais de depois da tabela batem com o
  que o Word mostra.
- **`export-docx`:** célula com `listKind` emite um `<w:p>` por linha, cada um
  com numeração; célula multilinha **sem** `listKind` emite um `<w:p>` por linha
  **sem** numeração (regressão do defeito 2, que hoje falha).
- **`react`/`dom-bridge`:** ida-e-volta de offset em célula-lista — começo, meio
  e fim de item, e travessia de fronteira. Simetria entre `locatePoint` e
  `textOffsetWithin` verificada nos dois sentidos.
- **Manual, clicando de verdade** (não disparar evento por script — pula o
  caminho que quebra): inserir tabela, digitar várias linhas numa célula,
  clicar lista, conferir marcadores; posicionar o cursor no meio de um item e
  digitar; importar o .docx de teste; Baixar PDF; exportar DOCX e abrir no Word.
- **Comparar os três caminhos** — editor, PDF e DOCX — antes de declarar pronto.

## Sequenciamento

Ramificar de `feat/verdana`, não de `main`: os dois trabalhos tocam
`export-docx/src/docx.ts` e `export-pdf/src/html.ts`, e ramificar de `main`
criaria conflito à toa. Não muda nada sobre o publish da Verdana, que segue
parado aguardando decisão do usuário.
