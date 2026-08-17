# Cor da borda da tabela

**Data:** 2026-08-17
**Status:** aprovado para planejamento

## Contexto

Os presets de borda (`all` / `outer` / `horizontal` / `vertical` / `none`) foram
entregues em `@sofereditor/*@0.4.0` — ver
`2026-08-17-linhas-bordas-marcatexto-design.md`. A cor da grade continua fixa em
`#cbd5e1`. Esta feature deixa o professor escolher a cor.

## Escopo

**Dentro:** cor da borda, uma por tabela.

**Fora, e por quê:**

- **Espessura.** Mudaria a geometria da célula: a caixa cresce, o texto reflui e
  a paginação precisa ser re-medida. Isso destruiria a invariante que hoje
  protege a fidelidade do PDF — "preset muda cor, nunca espessura". Se um dia
  entrar, entra como feature própria, com re-verificação de paginação.
- **Estilo (tracejada/pontilhada).** Mesmo problema de geometria em alguns
  estilos, mais superfície de UI e de mapeamento OOXML, sem demanda declarada.
- **Cor por célula.** Colide com `border-collapse: collapse`: duas células
  vizinhas com cores diferentes disputam a mesma linha e quem vence é regra do
  CSS, não a escolha do usuário. Escapar disso exige `border-collapse: separate`,
  que muda renderização **e** medição de paginação.

## Modelo

`packages/core/src/types.ts`, em `BlockAttrs` (só relevante quando
`type === "table"`, ao lado de `borderPreset`):

```ts
/**
 * Só relevante quando `type === "table"`. Cor das linhas da grade.
 * Ausente = TABLE_BORDER_COLOR — documentos existentes não mudam de aparência.
 */
borderColor?: string;
```

## Helper

`cellBorderColors` e `cellBorderStyle` ganham um **quarto parâmetro opcional**:

```ts
export function cellBorderColors(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
  color?: string,
): CellBorderColors;
```

`color` substitui o valor "ligado"; ausente cai em `TABLE_BORDER_COLOR`.
Opcional e por último para os testes existentes continuarem válidos sem edição.

**Os lados DESLIGADOS não mudam.** Continuam em `TABLE_GUIDE_COLOR`
(`var(--ed-guide-color, transparent)`) na tela e `transparent` na impressão. A
guia é uma affordance de tela — pintá-la com a cor escolhida faria um preset
"nenhuma" com borda preta desenhar linhas pretas claras na tela e nada no PDF,
que é justamente a divergência tela↔papel que o projeto evita.

## A invariante de geometria se mantém de graça

A **largura** vem do CSS do consumidor (`.ed-cell { border: 1px solid … }`); o
estilo inline sempre sobrescreveu apenas a cor, em todos os presets. Trocar de
cor não reflui nada, exatamente como trocar de preset. Nenhuma medição de
paginação muda.

## Renderizadores

Ambos passam `block.attrs.borderColor` ao helper:

- `packages/react/src/NodeView.tsx` — `TableView`, `variant: "screen"`
- `packages/export-pdf/src/html.ts` — `renderTable`, `variant: "print"`

## Export `.docx`

`docxTableBorders(preset, color)` alimenta o campo `color` de cada lado ligado,
via o `cssColorToDocxHex` que já existe em `docx.ts`. Cor inválida ou ausente cai
no default `CBD5E1`.

## Import `.docx`

`readBorderColor(tbl)` lê `w:color` do **primeiro lado ligado** do
`w:tblBorders`. `auto`, vazio ou ausente não grava o atributo — o documento cai
no default. Lados desligados são ignorados: o Word costuma emitir
`w:val="none"` com `w:color="auto"`, que não carrega informação de cor.

## Toolbar

No popover de tabela, logo abaixo do seletor de presets, seguindo exatamente o
padrão do controle de cor de fundo da célula que já existe:

- swatch + `<input type="color">` com `aria-label="Cor da borda"`
- botão "Restaurar cor padrão" que apaga o atributo (`setBlockAttrAtIndex(…, null)`)

O `<select>` e o `<input type="color">` já são cobertos por `keepsOwnMouseDown`,
o predicado único introduzido no fix do dropdown (`0.4.1`) — nenhum handler novo
de `mousedown` deve ser escrito.

## Cuidado: quatro lugares com a cor hardcoded, dois papéis diferentes

| Local | Papel | Vira parâmetro? |
|---|---|---|
| `core/src/table-borders.ts:5` (`TABLE_BORDER_COLOR`) | default do modelo | **sim** — é o fallback |
| `export-docx/src/docx.ts:348` (`docxTableBorders`) | cor emitida no OOXML | **sim** |
| `export-pdf/src/html.ts:531` (`.ed-cell`) | CSS: **largura** + cor default | **não** |
| `apps/playground/src/styles.css:438` (`.ed-cell`) | idem | **não** |

As duas últimas fornecem a largura de 1px e uma cor de partida; o inline
sobrescreve a cor sempre. Tratar as quatro como a mesma coisa dessincronizaria o
CSS do modelo.

Nota: `export-docx/src/docx.ts:256` também usa `CBD5E1`, mas é a borda esquerda
de **blockquote** — não tem relação com tabelas e não deve ser tocada.

## Testes

- `core`: cor customizada aparece nos lados ligados em todos os presets; lados
  desligados permanecem guia/transparent; cor ausente cai em `TABLE_BORDER_COLOR`.
- `react` / `export-pdf`: a cor sai no estilo inline dos dois renderizadores.
- `export-docx`: `w:tblBorders` carrega a cor; cor ausente emite `CBD5E1`.
- `import-docx`: lê a cor do primeiro lado ligado; `auto` não grava.
- Round-trip `.docx` da cor.
- Paridade editor↔HTML de servidor com cor customizada.

## Release

Toca `core`, `react`, `export-pdf`, `export-docx`, `import-docx`. Como `core` é
dependência `workspace:*` de todos, a release é **coordenada nos seis pacotes**
(ver [[project_release_pipeline]]): minor, `0.5.0`. Isso absorve o fix do
dropdown (`0.4.1`) caso ele ainda não tenha sido publicado.

Publicação só após avaliação e autorização explícita do usuário.
