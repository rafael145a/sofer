# Redimensionamento de tabela por mouse — desenho

## Problema

Três pedidos do usuário que são o mesmo defeito visto de ângulos diferentes.

### O defeito de fundo: px do modelo vs. largura fixa do CSS

`.ed-table { width: 100%; table-layout: fixed }` — definido no CSS do editor e
repetido em `packages/export-pdf/src/html.ts:532`. A tabela SEMPRE ocupa a
largura do conteúdo da página.

`colWidths` é gravado como **px absolutos**. Medido numa tabela real:

```
tabela renderizada:  600px
colWidths modelo:    [120, 153, 120, 120]  = 513px
colunas renderizadas:[140, 179, 140, 140]  = 599px   (escaladas por 600/513)
```

Consequências:

1. **Arrasto de coluna não cola.** Grava 120, renderiza 140. E como cada
   `pointermove` parte da largura RENDERIZADA e grava no modelo, o erro se
   acumula durante o arrasto — é a sensação de emborrachado que o usuário
   relatou.
2. **DOCX sai com largura errada.** `export-docx` converte os px para twips e
   fixa `width: soma(colWidths)` com `layout: FIXED`
   (`packages/export-docx/src/docx.ts:310-330`). A tabela no Word sai com 513px
   de largura enquanto o professor vê 600px na tela e no PDF. É violação direta
   do norte do projeto (fidelidade editor↔exportações).
3. **Trocar o tamanho da página quebra a proporção.** px absolutos não sabem
   que a área útil mudou (A4 → Carta, ou margem alterada).

O PDF hoje bate com o editor por acidente: ele emite os mesmos px dentro do
mesmo `width:100%`, então sofre a mesma escala.

## Decisão do usuário

Ao arrastar a divisa entre duas colunas, **a divisa se move**: uma cresce, a
vizinha encolhe na mesma medida, a largura total não muda. Comportamento do
Word e do Docs.

## Desenho

### 1. `colWidths` passa a ser proporção, não px

Percentuais que **somam 100**. `<col style="width:23.5%">`.

- O que é gravado é o que renderiza — o arrasto passa a colar.
- Sobrevive a mudança de página e de margem.
- `export-docx` converte a proporção contra a largura útil real da página,
  então a tabela no Word passa a ter a mesma largura do editor.
- `export-pdf` emite o mesmo percentual — continua idêntico ao editor.

**Migração:** documento antigo tem px. Na leitura, quando a soma não for ~100,
normalizar proporcionalmente (`w / soma * 100`). Não é conversão destrutiva:
os px atuais já eram interpretados proporcionalmente pelo navegador, então a
normalização preserva exatamente o que o professor via.

### 2. Arrasto de coluna redistribui com a vizinha

`setColumnWidth` vira `setColumnBoundary(blockIndex, boundary, deltaPct)`:
tira da vizinha o que dá para a arrastada, respeitando um mínimo por coluna.
A soma permanece 100 por construção.

O handle da borda DIREITA da tabela não tem vizinha — ele passa a ser o
controle de largura total (item 3).

### 3. Largura total da tabela

Novo atributo `tableWidth?: number` — percentual da largura útil (padrão 100).
O handle da borda direita ajusta esse valor; as colunas mantêm as proporções
entre si. Limite: mínimo que caiba o conteúdo, máximo 100.

### 4. Altura de linha

Novo atributo `rowHeights?: number[]` em px, uma entrada por linha.
Altura é distância física — não sofre o problema de proporção das colunas.

- `<tr style="height: Npx">` com `min-height` implícito do conteúdo: o CSS de
  tabela trata `height` como MÍNIMO, então conteúdo maior empurra. É o
  comportamento do Word e não exige código extra.
- Handles horizontais na divisa entre linhas, mesma mecânica dos verticais.
- Arrastar para menos que o conteúdo não encolhe — o valor é gravado, mas a
  linha renderiza pelo conteúdo. Sem "some texto".
- `export-docx`: `w:trHeight` com `hRule="atLeast"`, que é exatamente a mesma
  semântica.
- **Paginação:** `usePagination` fatia tabela por linhas. Altura declarada entra
  na medição como qualquer altura de linha — não exige caminho novo. Linha mais
  alta que a página cai na regra já existente de bloco que não cabe.

## Fora de escopo

- Altura de linha em % (não existe no Word nem faz sentido em página paginada).
- Arrastar célula individual (o modelo não tem borda por célula).
- Auto-ajuste ao conteúdo por duplo clique.

## Onde mexe

| Arquivo | O quê |
| --- | --- |
| `packages/core/src/types.ts` | `colWidths` vira proporção; `tableWidth`; `rowHeights` |
| `packages/core/src/commands.ts` | `setColumnBoundary`, `setTableWidth`, `setRowHeight`; normalização na leitura |
| `packages/react/src/NodeView.tsx` | `<col style="width:%">`, `<tr style="height">` |
| `packages/react/src/TableResizeOverlay.tsx` | redistribuição, handle de largura total, handles horizontais |
| `packages/export-pdf/src/html.ts` | `renderColGroup` em %, altura de linha |
| `packages/export-docx/src/docx.ts` | proporção → twips contra a largura útil; `w:trHeight` |
| `packages/import-docx/src/tables.ts` | ler `w:gridCol`/`w:trHeight` para o formato novo |

## Riscos

- **Documentos em produção têm px.** A normalização na leitura tem que ser
  idempotente e nunca rodar quando o valor já é proporção. Teste obrigatório.
- **Paginação.** Fatiamento de tabela por linhas é código sensível; altura
  declarada muda a medição. Suíte de paginação tem que continuar verde.
- **DOCX vai MUDAR de largura** para documentos existentes — para melhor
  (passa a bater com o editor), mas é mudança visível. Vale avisar o usuário.
