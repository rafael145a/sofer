# Toolbar flutuante da tabela: painel de bordas e conflito com a imagem — desenho

## Problema

Dois defeitos na barra flutuante que cola no topo da tabela
(`TableFloatingToolbar.tsx`).

Grau de evidência, para não confundir o que foi visto com o que foi deduzido:
o defeito 1 está lido direto no código (os controles não têm rótulo, ponto). O
defeito 2 é **derivado do código de posicionamento**, não reproduzido — o
playground do monorepo não tem barras flutuantes, e o app não foi levantado
nesta sessão. A confirmação visual fica para a implementação.

### 1. Os controles de borda e de cor não se identificam

Na barra, três controles seguidos são **os únicos sem texto visível** — só têm
`title=`:

| Controle | Como aparece hoje |
| --- | --- |
| Cor de fundo da célula | `<input type="color">` nu, `h-7 w-9` |
| Preset de borda | `<select>` nu, sem rótulo |
| Cor da borda | `<input type="color">` nu, `h-7 w-9` — idêntico ao primeiro |

Os dois colorpickers são o mesmo quadradinho lado a lado. Não há como saber
qual é o fundo e qual é a borda sem parar o mouse em cima e esperar o tooltip
do navegador. O `<select>` não anuncia que é de bordas, e o preset ativo só
fica visível ao abri-lo.

Os mesmos controles na `CustomToolbar.tsx` (menu ▦ da barra principal) têm
rótulo em texto — por isso o problema não aparece lá. Só a barra flutuante
está afetada.

### 2. A barra da tabela cobre a barra da imagem

`ImageFloatingToolbar` e `TableFloatingToolbar` são ambos
`position: absolute; zIndex: 20`, e o de tabela é montado **depois**
(`index.tsx:1213` vs `index.tsx:1225`).

Com uma imagem numa célula da primeira linha:

- a barra da imagem ancora acima da **imagem**
  (`top = imgTop − TOOLBAR_HEIGHT − TOOLBAR_OFFSET`);
- a barra da tabela ancora acima da **tabela**, mas pela borda inferior
  (`top = tableTop − TOOLBAR_OFFSET` com `translateY(-100%)`);
- com a imagem na primeira linha, `imgTop ≈ tableTop + padding da célula`, e as
  duas caem a poucos pixels uma da outra.

Empate de `z-index` é resolvido pela ordem do DOM: a da tabela pinta por cima.
E ela é larga (`w-max flex-nowrap`, centrada na tabela), então engole a barra da
imagem inteira. As ações de imagem ficam inalcançáveis.

## Desenho

### Nova disposição da barra flutuante

```
[+↑ Linha │ +↓ Linha │ − Linha]  [+← Col. │ +→ Col. │ − Col.]  [Mesclar │ Dividir]
[🪣 ▮]  [Sem cor]  [▦ Bordas ▾]  [🗑 Excluir tabela]
```

### Botão de bordas com painel

Gatilho: botão-ícone `TbBorderAll` (o quadrado dividido em quatro do Word/Docs)
com caret. Abre um painel ancorado abaixo do botão:

```
┌──────────────────────────────────┐
│  ▦ Todas          ▣ Só externas  │
│  ▤ Só horizontais ▥ Só verticais │
│  ▢ Nenhuma                       │
├──────────────────────────────────┤
│  Cor da linha   [▮]   [Padrão]   │
└──────────────────────────────────┘
```

Presets como botões-ícone rotulados, o ativo em `variant="solid" color="primary"`.
Ícones de `react-icons/tb`, que traz o vocabulário do Word inteiro:

| Preset | Ícone |
| --- | --- |
| `all` | `TbBorderAll` |
| `outer` | `TbBorderOuter` |
| `horizontal` | `TbBorderHorizontal` |
| `vertical` | `TbBorderVertical` |
| `none` | `TbBorderNone` |

Ganhos sobre o `<select>`: o preset ativo fica visível sem abrir nada, e o
ícone diz o que cada opção faz sem depender da leitura do rótulo.

**O painel permanece aberto ao escolher um preset.** Trocar entre `all` →
`outer` → `none` vendo o resultado é o uso real; e a cor da linha costuma ser
ajustada logo em seguida. Fecha com clique fora ou `Esc`.

**Cor da linha** dentro do painel, com botão **Padrão** ao lado, que chama
`setTableBorderColor(null)` e restaura `TABLE_BORDER_COLOR`. Esse botão hoje
não existe na barra flutuante — existe só na `CustomToolbar`. Quem pintar a
borda pela barra flutuante hoje não tem como desfazer sem o Ctrl+Z.

### Cor de fundo da célula

Continua direto na barra — pintar célula é ação frequente e não deve custar dois
cliques. Ganha o ícone `TbBucketDroplet` à esquerda e uma tarja com a cor atual,
no padrão do Word. O botão "Sem cor" fica como está.

A confusão entre os dois colorpickers se resolve principalmente por
**separação**: a cor da borda sai de perto e passa a viver dentro do painel de
bordas. O ícone de balde é o reforço.

### O painel é um `<div>`, não o `Popover` do HeroUI

`PopoverContent` do HeroUI renderiza em portal, fora da árvore da barra. O
`onMouseDown` guard da barra flutuante —

```ts
onMouseDown={(e) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest('button, input, select, [role="button"], a')) return;
  e.preventDefault();
}}
```

— não alcança um portal. Clicar no fundo do painel colapsaria a seleção do
editor, `getTableLocation()` viraria `null`, a barra desmontaria e o painel
fecharia sozinho. É a mesma armadilha documentada em
`packages/react/src/Toolbar.tsx:60` ("foi exatamente assim que o seletor de
bordas da tabela nasceu morto").

Um `<div>` absoluto filho da própria barra já é coberto pelo guard existente,
sem trabalho extra. O fechamento por clique fora usa um listener de
`mousedown` no `document` com teste de `contains`, no mesmo formato do
`TableMenu` de `packages/react/src/Toolbar.tsx`.

O painel abre **para o lado oposto à tabela**, reaproveitando o `placeAbove` que
a barra já calcula: barra acima da tabela → painel abre para cima; barra abaixo
→ painel abre para baixo. Como o painel fica aberto enquanto se troca de preset,
ele não pode cobrir a tabela — é justamente o efeito que se está olhando.

O `Esc` fecha via listener de `keydown` no `document`, registrado junto com o de
clique fora e removido no mesmo cleanup.

### Conflito com a barra da imagem

`TableFloatingToolbar` não renderiza enquanto houver embed selecionado:

```ts
if (editor.getSelectedEmbed()) return null;
```

Colocado junto do `if (disabled) return null` já existente, antes de qualquer
leitura de `getTableLocation()` — a ordem dos hooks não muda
(`useEditorContext` e `useRef` vêm antes).

É o comportamento do Word e do Docs: selecionou a figura, aparecem as
ferramentas de figura. Nada fica inacessível — as ações de tabela continuam
todas no menu ▦ da `CustomToolbar`, e clicar no texto da célula desmarca a
imagem e traz a barra da tabela de volta no mesmo instante.

**Descartado:** empilhar as duas barras (a de tabela sobe acima da de imagem).
Resolve a colisão vertical, mas as duas continuam competindo em largura, e
acopla a medição de dois componentes que hoje não se conhecem.

## Onde mexe

O arquivo é **byte a byte idêntico** nos dois consumidores. O mesmo patch vai
nos dois; qualquer divergência entre eles é regressão.

| Arquivo | O quê |
| --- | --- |
| `portal2-next/src/components/ProvaEditor/TableFloatingToolbar.tsx` | painel de bordas, ícone de balde no fundo, guard do embed selecionado |
| `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/TableFloatingToolbar.tsx` | cópia idêntica do patch acima |

Nenhum pacote do `editor-monorepo` muda. `setTableBorderPreset`,
`setTableBorderColor`, `getTableBorderPreset`, `getTableBorderColor` e
`getSelectedEmbed` já existem em `useEditor.ts`.

Dependências conferidas nos dois consumidores (não é a mesma lockfile):

| | portal2-next | frequencia-ocorrencia |
| --- | --- | --- |
| `react-icons` | 5.5.0 | 5.5.0 |
| `@heroui/react` | 2.7.2 | 2.7.6 |
| `TbBorder{All,Outer,Horizontal,Vertical,None}` | presentes | presentes |
| `TbBucketDroplet` | presente | presente |

Nada a instalar. Só `Button`/`ButtonGroup` do HeroUI são usados, API estável
entre 2.7.2 e 2.7.6.

## Fora de escopo

- `CustomToolbar.tsx` e `packages/react/src/Toolbar.tsx`: os mesmos controles
  lá têm rótulo visível em texto e não foram reclamados.
- Extrair as barras flutuantes duplicadas para um pacote compartilhado. É a
  correção certa da duplicação, mas é outro trabalho.
- Espessura de borda por lado. O modelo não tem — o preset muda só a cor de
  cada lado, de propósito, para não refluir texto nem mover a paginação.
- Colisão entre `OrderedListFloatingToolbar` e as outras. Ela só aparece com o
  caret num `listItem` ordenado **fora** de tabela, então não empata com a de
  tabela; e não foi reclamada.

## Riscos

- **Seleção do editor ao clicar no painel.** É o risco principal e a razão de
  o painel não ser portal. Verificar no clique de verdade (abrir o painel,
  clicar em cada preset, mexer na cor) — disparar `change` por script pula
  justamente o caminho que quebra.
- **Troca de não-controlado para controlado.** O arquivo hoje é uncontrolled:
  `key={\`bp:${blockIndex}\`} defaultValue={borderPreset}` — o `<select>` só
  reflete o modelo quando remonta. Os botões-ícone são controlados
  (`variant = borderPreset === p.key ? 'solid' : 'flat'`), então dependem de
  `getTableBorderPreset()` já refletir a escrita no render seguinte. No mesmo
  clique de verificação, conferir **duas** coisas: o painel continua aberto
  **e** o destaque pulou para o preset novo. Se o destaque não mover, o botão
  está mentindo o estado — falha que o `defaultValue` antigo escondia.
- **`getSelectedEmbed()` a cada render.** É chamado no corpo do
  `TableFloatingToolbar`, que já lê `getTableLocation()`, `getCellBackground()`
  e mais três no mesmo lugar. Uma leitura a mais não muda o custo, e o
  `FloatingBody` memoizado continua sendo o que evita re-render.
- **Imagem `behind`/`front` fora da tabela.** Nesse caso `getTableLocation()`
  já é `null` e a barra da tabela não renderiza de qualquer jeito — o guard
  novo não muda nada. Confirmar que não some barra de tabela em situação
  legítima.
