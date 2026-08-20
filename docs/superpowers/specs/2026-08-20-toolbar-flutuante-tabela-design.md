# Bordas da tabela atrás de um ícone + conflito das barras flutuantes — desenho

## Problema

### 1. Os controles de borda estão soltos, e na barra flutuante nem se identificam

O par preset-de-borda + cor-da-borda existe em **três** superfícies, e em
nenhuma delas vem de um controle de bordas — está sempre solto no meio de
outras coisas:

| Superfície | Como está hoje |
| --- | --- |
| `TableFloatingToolbar.tsx` — barra que cola no topo da tabela | `<select>` nu + `<input type="color">` nu, **sem nenhum texto**, só `title=` |
| `CustomToolbar.tsx` — menu ▦ da barra principal | três linhas soltas: "Bordas" `<select>`, "Cor da borda", "Restaurar cor da borda" |
| `packages/react/src/Toolbar.tsx` — menu ▦ do playground | mesmas três linhas soltas |

Na barra flutuante o problema é agudo: esses são **os únicos controles sem
texto visível** da barra, e o colorpicker de borda é o mesmo quadradinho
`h-7 w-9` do colorpicker de fundo da célula, encostado nele. Não há como
distinguir sem parar o mouse em cima e esperar o tooltip do navegador. O
`<select>` não anuncia que é de bordas, e o preset ativo só aparece ao abri-lo.

Nas outras duas superfícies os rótulos existem, mas as configurações de borda
continuam espalhadas em três linhas no meio de inserir-linha, mesclar, cor de
fundo e excluir tabela — em vez de virem todas de um lugar só.

### 2. A barra da tabela cobre a barra da imagem

`ImageFloatingToolbar` e `TableFloatingToolbar` são ambos
`position: absolute; zIndex: 20`, e o de tabela é montado **depois**
(`index.tsx:1213` vs `index.tsx:1225`).

Com uma imagem numa célula da primeira linha:

- a barra da imagem ancora acima da **imagem**
  (`top = imgTop − TOOLBAR_HEIGHT − TOOLBAR_OFFSET`);
- a barra da tabela ancora acima da **tabela**, mas pela borda inferior
  (`top = tableTop − TOOLBAR_OFFSET` com `translateY(-100%)`);
- como `imgTop ≈ tableTop + padding da célula`, as duas caem a poucos pixels
  uma da outra.

Empate de `z-index` é resolvido pela ordem do DOM: a da tabela pinta por cima.
E ela é larga (`w-max flex-nowrap`, centrada na tabela), então engole a barra da
imagem inteira. As ações de imagem ficam inalcançáveis.

### Grau de evidência

Para não confundir o que foi visto com o que foi deduzido: o defeito 1 está
lido direto no código. O defeito 2 é **derivado do código de posicionamento**,
não reproduzido — o playground do monorepo não tem barras flutuantes, e o app
não foi levantado nesta sessão. A confirmação visual fica para a implementação.

## Desenho

### O painel de bordas — um só, nas três superfícies

Colapsado, as configurações de borda viram **uma linha só**: um ícone de bordas
(o quadrado dividido em quatro do Word/Docs) com o rótulo "Bordas" e um caret.
Expandido, tudo que é borda aparece logo abaixo dele:

```
▦ Bordas ▾
┌──────────────────────────────────┐
│  ▦ Todas          ▣ Só externas  │
│  ▤ Só horizontais ▥ Só verticais │
│  ▢ Nenhuma                       │
├──────────────────────────────────┤
│  Cor da linha   [▮]   [Padrão]   │
└──────────────────────────────────┘
```

Presets como botões-ícone rotulados, o ativo destacado. Ganhos sobre o
`<select>`: o preset ativo fica visível sem abrir nada, e o ícone diz o que
cada opção faz sem depender da leitura do rótulo.

**O painel permanece aberto ao escolher um preset.** Trocar entre `all` →
`outer` → `none` vendo o resultado é o uso real, e a cor da linha costuma ser
ajustada logo em seguida.

**Cor da linha** com botão **Padrão** ao lado (`setTableBorderColor(null)` →
`TABLE_BORDER_COLOR`). Na barra flutuante esse botão **hoje não existe** — quem
pinta a borda por lá não tem como voltar sem Ctrl+Z. Passa a existir nas três.

### Como o painel abre, superfície por superfície

O conteúdo é o mesmo; o mecanismo muda porque o hospedeiro muda.

**Menus verticais (`CustomToolbar`, `Toolbar.tsx` do playground):**
disclosure **inline** — o painel expande dentro do próprio menu, empurrando o
que vem depois. Sem segunda camada flutuante. É literalmente "abaixo do ícone",
e evita popover-dentro-de-popover, que no HeroUI significa portal aninhado
(ver risco abaixo). Colapsado, o menu ▦ fica três linhas mais curto do que hoje.

**Barra flutuante (horizontal):** não existe "inline abaixo" numa linha só, então
o painel é um `<div>` absoluto ancorado no botão, **filho da própria barra**.
Abre para o lado oposto à tabela, reaproveitando o `placeAbove` que a barra já
calcula: barra acima da tabela → painel para cima; barra abaixo → para baixo.
Como fica aberto enquanto se troca de preset, não pode cobrir a tabela — é
justamente o efeito que se está olhando.

Fecha com clique fora (listener de `mousedown` no `document` + `contains`) ou
`Esc` (`keydown` no `document`), registrados e removidos no mesmo cleanup. Mesmo
formato do `TableMenu` de `packages/react/src/Toolbar.tsx`.

### Ícones

Nos consumidores, `react-icons/tb` traz o vocabulário do Word inteiro:

| Preset | Ícone (consumidores) | Glifo (`Toolbar.tsx`) |
| --- | --- | --- |
| gatilho | `TbBorderAll` | `⊞` |
| `all` | `TbBorderAll` | `▦` |
| `outer` | `TbBorderOuter` | `□` |
| `horizontal` | `TbBorderHorizontal` | `▤` |
| `vertical` | `TbBorderVertical` | `▥` |
| `none` | `TbBorderNone` | `⬚` |

`packages/react/src/Toolbar.tsx` não tem biblioteca de ícones e usa glifos de
texto em toda a barra (`⇤ ≡ ⇥ ☰ • 🔗 ▦ 🖼 ⚙`). Manter o idioma do arquivo custa
menos que introduzir uma dependência de ícones num pacote publicado.

### Cor de fundo da célula (só na barra flutuante)

Continua direto na barra — pintar célula é ação frequente e não deve custar dois
cliques. Ganha o ícone `TbBucketDroplet` à esquerda e uma tarja com a cor atual,
no padrão do Word. O botão "Sem cor" fica como está.

A confusão entre os dois colorpickers se resolve principalmente por
**separação**: a cor da borda sai de perto e passa a viver dentro do painel de
bordas. O ícone de balde é o reforço.

Nova disposição da barra:

```
[+↑ Linha │ +↓ Linha │ − Linha]  [+← Col. │ +→ Col. │ − Col.]  [Mesclar │ Dividir]
[🪣 ▮]  [Sem cor]  [▦ Bordas ▾]  [🗑 Excluir tabela]
```

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

Seis arquivos, em três repositórios.

| Arquivo | O quê |
| --- | --- |
| `portal2-next/.../TableFloatingToolbar.tsx` | painel de bordas ancorado, balde no fundo da célula, guard do embed selecionado |
| `portal-professores/frequencia-ocorrencia/.../TableFloatingToolbar.tsx` | patch idêntico |
| `portal2-next/.../CustomToolbar.tsx` | as três linhas de borda do `TableMenu` viram disclosure inline |
| `portal-professores/frequencia-ocorrencia/.../CustomToolbar.tsx` | patch idêntico |
| `editor-monorepo/packages/react/src/Toolbar.tsx` | mesmo disclosure inline, com glifos |
| `editor-monorepo/apps/playground/src/styles.css` | classes do painel inline |

Estado da duplicação, medido:

- Os dois `TableFloatingToolbar.tsx` são **byte a byte idênticos**. Qualquer
  divergência depois do patch é regressão.
- Os dois `CustomToolbar.tsx` diferem em **uma linha só**, fora da nossa área
  (`as any` num cast de `level`, linha 734). Não encostar nela — não é sujeira
  a limpar de passagem, é divergência de config de TS entre os dois apps.

`Toolbar.tsx` do pacote é consumido **só pelo playground**
(`apps/playground/src/App.tsx`); os dois apps usam `CustomToolbar`. Por isso o
CSS novo entra apenas em `apps/playground/src/styles.css` — as cópias de
`sofer-editor.css` nos consumidores não precisam acompanhar. (Elas já estão 116
linhas atrás do playground; não é este trabalho que conserta isso.)

Nenhuma API de pacote muda. `setTableBorderPreset`, `setTableBorderColor`,
`getTableBorderPreset`, `getTableBorderColor` e `getSelectedEmbed` já existem em
`useEditor.ts`.

Dependências conferidas nos dois consumidores (lockfiles separados):

| | portal2-next | frequencia-ocorrencia |
| --- | --- | --- |
| `react-icons` | 5.5.0 | 5.5.0 |
| `@heroui/react` | 2.7.2 | 2.7.6 |
| `TbBorder{All,Outer,Horizontal,Vertical,None}` | presentes | presentes |
| `TbBucketDroplet` | presente | presente |

Nada a instalar. Só `Button`/`ButtonGroup` do HeroUI são usados, API estável
entre 2.7.2 e 2.7.6.

## Fora de escopo

- Extrair as barras flutuantes e a `CustomToolbar` duplicadas para um pacote
  compartilhado. É a correção certa da duplicação, mas é outro trabalho — e
  fazer junto misturaria um refactor grande com uma mudança de UI verificável.
- Espessura de borda por lado. O modelo não tem — o preset muda só a cor de
  cada lado, de propósito, para não refluir texto nem mover a paginação.
- Colisão entre `OrderedListFloatingToolbar` e as outras. Ela só aparece com o
  caret num `listItem` ordenado **fora** de tabela, então não empata com a de
  tabela; e não foi reclamada.
- Cor de fundo da célula nos menus ▦ (`CustomToolbar`, `Toolbar.tsx`). Lá ela já
  tem rótulo em texto e não fica encostada na cor da borda depois que esta se
  muda para dentro do painel.

## Riscos

- **Seleção do editor ao clicar no painel.** Risco principal, e a razão de o
  painel nunca ser portal. `PopoverContent` do HeroUI renderiza fora da árvore
  da barra, onde o guard de `onMouseDown` não alcança:

  ```ts
  onMouseDown={(e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest('button, input, select, [role="button"], a')) return;
    e.preventDefault();
  }}
  ```

  Clicar no fundo de um painel em portal colapsaria a seleção do editor,
  `getTableLocation()` viraria `null`, a barra desmontaria e o painel fecharia
  sozinho. É a armadilha documentada em `packages/react/src/Toolbar.tsx:60`
  ("foi exatamente assim que o seletor de bordas da tabela nasceu morto").
  Verificar **no clique de verdade** — abrir o painel, clicar em cada preset,
  mexer na cor. Disparar `change` por script pula justamente o caminho que
  quebra.
- **Troca de não-controlado para controlado.** Os arquivos hoje são
  uncontrolled: `key={\`bp:${blockIndex}\`} defaultValue={borderPreset}` — o
  `<select>` só reflete o modelo quando remonta. Os botões-ícone são
  controlados, então dependem de `getTableBorderPreset()` já refletir a escrita
  no render seguinte. No mesmo clique de verificação, conferir **duas** coisas:
  o painel continua aberto **e** o destaque pulou para o preset novo. Se o
  destaque não mover, o botão está mentindo o estado — falha que o
  `defaultValue` antigo escondia.
- **Altura do menu ▦ ao expandir.** O disclosure inline cresce o popover dentro
  de um `PopoverContent` do HeroUI, que tem posicionamento próprio. Conferir
  que expandir perto do rodapé da janela reposiciona em vez de cortar.
- **`getSelectedEmbed()` a cada render.** É chamado no corpo do
  `TableFloatingToolbar`, que já lê `getTableLocation()`, `getCellBackground()`
  e mais três no mesmo lugar. Uma leitura a mais não muda o custo, e o
  `FloatingBody` memoizado continua sendo o que evita re-render.
- **Imagem `behind`/`front` fora da tabela.** Nesse caso `getTableLocation()`
  já é `null` e a barra da tabela não renderiza de qualquer jeito — o guard
  novo não muda nada. Confirmar que não some barra de tabela em situação
  legítima.
