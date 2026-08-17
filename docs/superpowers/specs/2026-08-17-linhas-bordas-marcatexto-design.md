# Linhas de resposta, presets de borda de tabela e marca-texto

**Data:** 2026-08-17
**Status:** aprovado para planejamento

## Contexto

Três features pedidas para o editor, todas nascidas do caso de uso real de
autoria de provas por professores:

1. **Linhas de resposta** — o aluno precisa de espaço pautado para escrever.
2. **Controle de bordas da tabela** — escolher onde as linhas da grade aparecem.
3. **Marca-texto** — cor de fundo aplicada a um trecho de texto.

As três atravessam as mesmas cinco camadas: modelo (`core`) → renderizador React
→ HTML do PDF → `.docx` (export) → `.docx` (import).

### Risco arquitetural que domina o desenho

A renderização inline existe **duas vezes** no monorepo:

- `packages/react/src/renderInline.tsx` (editor)
- uma `renderInline` local dentro de `packages/export-pdf/src/html.ts`

O CSS de célula também: `apps/playground/src/styles.css:413-425` e
`packages/export-pdf/src/html.ts:473-476`.

Toda feature deste spec toca renderização inline, CSS de célula, ou ambos. Uma
feature que funciona na tela e diverge silenciosamente no PDF é exatamente o modo
de falha que o norte de fidelidade do projeto existe para impedir. Por isso:

> **Regra de arquitetura deste spec:** toda lógica de decoração nova é uma função
> **pura em `@sofereditor/core`**, chamada pelos dois renderizadores. Cada feature
> carrega um teste que afirma que editor e PDF produzem a mesma decoração para o
> mesmo documento.

## Ordem de entrega

**3 → 1 → 2.** Cada uma é independentemente entregável e avaliável no ambiente de
testes.

- Marca-texto é mecanicamente paralelo à mark `color` que já existe e exercita as
  cinco camadas — fixa o padrão.
- Linhas de resposta ficam contidas no modelo de bloco + toolbar.
- Bordas têm a maior superfície de design.

Fora de escopo (cortado explicitamente): régua horizontal separadora
(`___` + Enter → `<hr>`). Uma linha de resposta única já resolve visualmente.

---

## Feature 3 — Marca-texto (mark `highlight`)

### Modelo

`packages/core/src/types.ts`:

```ts
export type MarkName = … | "highlight";

export interface MarkAttrs {
  …
  /** Cor de fundo do texto (marca-texto). CSS color, ex. "#fff176". */
  highlight?: string;
}
```

`packages/core/src/marks.ts`: acrescentar `highlight: true` a `ALL_MARKS`. Como
`ALL_MARKS` é `Record<MarkName, true>`, o typecheck falha até isso ser feito —
proposital. `CLEAR_ALL_MARKS` passa a limpar a mark de graça.

### Renderização

Nos **dois** `renderInline`, a cor entra no mesmo `<span>` que já carrega
`color`/`fontFamily`/`fontSize` (`wrap()`, `renderInline.tsx:275-281`):

```ts
if (attrs.highlight) styleParts.backgroundColor = attrs.highlight;
```

Impressão já está coberta: `print-color-adjust: exact !important` é aplicado com
seletor universal `*` (`export-pdf/src/html.ts:434`, `pdf.ts:105`) — não é
escopado a `.ed-cell`.

### Export `.docx`

`shading: { type: ShadingType.CLEAR, color: "auto", fill: cssColorToDocxHex(m.highlight) }`
nos `TextRun` — o mesmo padrão que `docx.ts:322` já usa para o fundo de célula.

**Não usar `w:highlight`**: aceita apenas ~15 valores nomeados e não sobreviveria
a uma cor arbitrária do picker.

Existem **dois** sítios quase idênticos de props de `TextRun` (`docx.ts:~394` e
`~411`). Ambos precisam da mudança. Durante a implementação, apurar por que são
dois antes de editar um só.

### Import `.docx`

Hoje `import-docx` lê `w:shd` apenas em `pPr` (`paragraphs.ts:107`). Ambos os
caminhos de run são novos:

- `w:rPr/w:shd/@w:fill` → `highlight` (hex direto)
- `w:rPr/w:highlight/@w:val` → `highlight` via tabela de mapeamento dos ~15 nomes
  do OOXML para hex

`w:fill="auto"` ou ausente = sem highlight.

### Toolbar

Espelha o controle de cor de texto que já existe (`Toolbar.tsx:250-260`): swatch +
`<input type="color">` + botão de limpar chamando `removeMark("highlight")`.

### Testes

- `core`: `getMarksInRange` reporta `highlight`; `CLEAR_ALL_MARKS` inclui a chave.
- `react`: `renderInline` emite `backgroundColor`.
- `export-pdf`: HTML do mesmo delta carrega o mesmo `background-color`.
- `export-docx`: run com `highlight` emite `w:shd` com o fill esperado.
- `import-docx`: `w:shd` e `w:highlight` em run viram a mark.
- Round-trip: doc com highlight → docx → import → mesma cor.
- `clipboard.ts`: confirmar (não presumir) que a serialização é genérica sobre os
  atributos do delta; se não for, incluir `highlight`.

---

## Feature 1 — Linhas de resposta

Dois casos de uso distintos, com soluções distintas.

### 1a. Lacuna inline — `___` vira traço contínuo

**Comportamento:** uma sequência de **3 ou mais** `_` renderiza como um traço
contínuo, sem serrilhado, com a largura exata da sequência digitada. Vale desde o
3º caractere, sem Enter. Serve `Nome: ______  Turma: ____`.

**Estratégia: decoração em tempo de render. Os caracteres `_` permanecem no
Y.Text.** Consequências, todas desejáveis:

- offsets do modelo intactos → nada muda em `dom-bridge`, seleção, paginação
- apagar um `_` volta a 2 e o traço some sozinho — sem "desfazer autoformat"
- clipboard, `.docx` export/import não precisam de nada: exportam underline
  literal, que é o que o Word mostraria de qualquer forma (round-trip lossless)

**Helper puro** — `packages/core/src/blanks.ts`:

```ts
/** Segmenta um texto em trechos normais e corridas de 3+ underlines. */
export function splitUnderscoreRuns(text: string): Array<{ text: string; blank: boolean }>;
export const BLANK_MIN_RUN = 3;
```

**Renderização** (os dois renderizadores). O trecho `blank` é envolvido em:

```html
<span class="ed-blank" style="-webkit-text-fill-color: transparent; text-decoration: underline">___</span>
```

- `-webkit-text-fill-color: transparent` apaga o **glifo** mas preserva `color`,
  que é o que pinta o sublinhado — diferente de `color: transparent`, que apagaria
  os dois. Suportado em Chrome/Firefox/Safari; o PDF roda em Chrome (Puppeteer).
- `text-decoration: underline` fica na mesma posição vertical onde o glifo `_` já
  seria desenhado, e é contínuo por toda a extensão do span.
- **Proibido** no span: `display: inline-block`, `padding`, `margin`,
  `letter-spacing`. Qualquer um deles desloca métricas e a paginação diverge.
- O texto continua sendo **nó de texto real** dentro do span. `dom-bridge` soma
  `textContent.length` (`dom-bridge.ts:216,334`), então dividir uma run em
  sub-spans é seguro; introduzir ou remover caracteres não seria.

Se a run já tiver a mark `underline`, o `<u>` externo desenha no mesmo lugar —
sem diferença visível.

**Testes:** `splitUnderscoreRuns` (0, 1, 2, 3, 10 underlines; múltiplas corridas;
underlines nas bordas do texto); editor e PDF produzem o mesmo markup para o mesmo
delta; `.docx` exporta os underlines literais.

### 1b. Linhas para dissertação — botão na toolbar

Underline é a ferramenta errada aqui: exigiria ~70 `_` por linha e a largura
quebraria ao mudar margem, fonte ou tamanho de página.

**Modelo** — `BlockAttrs`:

```ts
/** Só relevante em `type === "paragraph"`. Parágrafo pautado para resposta. */
answerLine?: true;
/** Só relevante quando `answerLine`. Entrelinha. Ausente = 1. */
answerLineSpacing?: 1 | 1.5 | 2;
```

`answerLineSpacing` é deliberadamente escopado a linhas de resposta em vez de um
`lineSpacing` genérico de parágrafo: entrelinha geral mudaria a medição de
paginação de **todo** parágrafo do documento, e isso é outra feature com outro
raio de impacto.

**Comando** — `packages/core/src/commands.ts`:

```ts
export function insertAnswerLines(ctx, count: number, spacing: 1 | 1.5 | 2): void;
```

Insere `count` parágrafos vazios com os atributos acima, depois do bloco atual, em
uma única transação Y (um passo de undo). `count` limitado a 1..50.

**Renderização** (os dois renderizadores): classe `ed-answer-line` mais estilo
inline com a entrelinha. Borda inferior sólida ocupando a largura do conteúdo. O
parágrafo continua editável e vazio (renderiza o `<br data-empty>` de sempre), só
que com régua e altura de linha.

CSS precisa existir nos dois lugares (`playground/styles.css` e o `<style>` de
`export-pdf/html.ts`) com valores idênticos — coberto por teste.

**Toolbar:** botão "Linhas de resposta" abrindo popover com quantidade (numérico,
default 5) e entrelinha (simples / 1,5 / duplo), mais "Inserir".

**Export `.docx`:**

```ts
new Paragraph({
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } },
  spacing: { line: Math.round(240 * spacing), lineRule: LineRuleType.AUTO },
})
```

**Import `.docx`:** parágrafo com `w:pBdr/w:bottom` (estilo diferente de `none`) e
sem conteúdo de texto → `answerLine: true`. `w:spacing/@w:line` mapeado ao bucket
mais próximo entre 240 / 360 / 480; fora disso, 1.

**Paginação:** é um parágrafo comum, medido pelo caminho normal. Nenhum caso
especial.

---

## Feature 2 — Presets de borda de tabela

### Modelo

`BlockAttrs` (só relevante em `type === "table"`):

```ts
export type TableBorderPreset = "all" | "outer" | "horizontal" | "vertical" | "none";
/** Ausente = "all" — documentos existentes não mudam de aparência. */
borderPreset?: TableBorderPreset;
```

Mapeia 1:1 no vocabulário nativo de `w:tblBorders` (top / left / bottom / right /
insideH / insideV), que é exatamente o que o usuário quer dizer com "onde aparecem
as linhas".

### Invariante central: preset muda cor, nunca espessura

Toda célula mantém `border: 1px solid` nos quatro lados em **todos** os presets.
Os lados desligados recebem `border-*-color: transparent`.

Três consequências, e é por isso que o desenho é este:

1. **Geometria invariante.** Trocar de preset não reflui uma linha sequer; a
   paginação já validada não se mexe.
2. **Sem disputa de `border-collapse`.** Todas as bordas têm mesma espessura e
   mesmo estilo em toda a tabela — não há resolução de conflito para dar errado, e
   `border-collapse: collapse` continua como está.
3. **Guias de tela sem custo de fidelidade.** No preset `none` o editor pinta as
   bordas num cinza claríssimo (guia) e o PDF pinta `transparent`. Mesma caixa ao
   pixel; só a cor difere. Zero divergência de layout entre tela e impresso.

### Helper puro

`packages/core/src/table-borders.ts`:

```ts
export interface CellBorderPos {
  row: number; col: number;
  rowspan: number; colspan: number;
  cols: number;
  /** Limites do fragmento renderizado. Tabela inteira = 0 e `rows`. */
  rowStart: number; rowEnd: number;
}

export function cellBorderColors(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
): { top: string; right: string; bottom: string; left: string };
```

Decisões que a função encapsula:

- **Bordas de spans.** Uma célula toca a borda inferior quando
  `row + rowspan - 1 === rowEnd - 1`, e a direita quando
  `col + colspan - 1 === cols - 1`. Isso é robusto a `rowspan`/`colspan` e a
  células `covered` (que não renderizam `<td>`) — diferente de seletores CSS
  `:first-child`/`:last-child`, que quebram assim que um span pula uma célula.
- **Tabela quebrada entre páginas.** As bordas externas são desenhadas nos limites
  do **fragmento** (`rowStart`/`rowEnd`), não da tabela lógica. Para uma tabela não
  quebrada os dois coincidem; para uma quebrada, cada página fecha a própria caixa
  — o comportamento do Word.
- `variant` só muda o resultado no preset `none` (guia cinza vs `transparent`).

Chamado por `NodeView.tsx` (`variant: "screen"`) e por `export-pdf/html.ts`
(`variant: "print"`). Durante a implementação, **verificar como `html.ts`
fragmenta tabelas** e passar a mesma informação de fragmento — se ele não fragmenta
hoje, as bordas externas devem sair nos limites lógicos da tabela e isso vira uma
divergência conhecida a registrar.

### Toolbar

Um `<select>` "Bordas" dentro do popover de tabela que já existe (mesmo painel do
fundo de célula, `Toolbar.tsx:567`). Aplica via
`setBlockAttr(blockIndex, "borderPreset", value)`.

### Export `.docx`

`Table({ borders: { top, bottom, left, right, insideHorizontal, insideVertical } })`,
cada lado `BorderStyle.SINGLE` ou `BorderStyle.NONE` conforme o preset.

### Import `.docx`

`import-docx` hoje não lê `tblBorders` nem `tcBorders` — é uma lacuna de fidelidade
nova sob qualquer desenho. Ler `w:tblBorders` e reduzir ao preset mais próximo:

| tblBorders lido | preset |
|---|---|
| todos os 6 lados presentes | `all` |
| só os 4 externos | `outer` |
| top+bottom+insideH | `horizontal` |
| left+right+insideV | `vertical` |
| nenhum / todos `none` | `none` |
| qualquer outra combinação | `all` (fallback) |

`w:tcBorders` por célula continua ignorado — coerente com o modelo, que não tem
bordas por célula.

### Fora de escopo

Bordas por célula / por lado selecionado. Exigiriam `border-collapse: separate`,
que muda renderização **e** medição de paginação. Se o teste em produção mostrar
que os presets não bastam, vira fase seguinte.

---

## Estratégia de testes

Cada feature carrega, além dos testes unitários da própria camada:

1. **Teste de paridade editor↔PDF**: mesmo `SerializedDocument` renderizado pelos
   dois caminhos produz a mesma decoração (cores de borda, background, markup de
   lacuna).
2. **Round-trip `.docx`**: documento → export → import → atributos preservados.

## Fluxo de entrega

Implementar → apresentar no ambiente de testes → **aguardar avaliação e
autorização explícita do usuário** → só então publicar no ambiente de teste e no
npm. Nada é publicado antes dessa autorização.
