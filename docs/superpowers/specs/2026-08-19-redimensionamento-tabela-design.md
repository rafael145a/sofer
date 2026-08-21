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

1. **Arrasto de coluna não cola.** Grava 120, renderiza 140. O
   `TableResizeOverlay` lê a largura **renderizada** no `pointerdown`
   (`startWidth` de `getBoundingClientRect`) e grava `startWidth + dx` no
   modelo, que é interpretado na escala do modelo. Calculado sobre a tabela
   medida acima:

   ```
     cursor   modelo   soma  escala  renderiza     erro
        140      140    533  1.1257      157.6    +17.6
        150      150    543  1.1050      165.7    +15.7
        160      160    553  1.0850      173.6    +13.6
        180      180    573  1.0471      188.5     +8.5
        200      200    593  1.0118      202.4     +2.4
   ```

   Ou seja: a coluna **salta +17.6 px no instante do clique**, antes de o
   dedo se mover, e depois o erro vai *diminuindo* conforme arrasta — porque
   a escala muda junto, já que a soma mudou. Não é erro que acumula: é
   elástico, e é exatamente a palavra que o usuário usou.
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

Por que a heurística "soma ≈ 100" é segura na prática: para uma tabela em px
cair nela, a média por coluna teria que ser 100/n — 25 px cada em 4 colunas,
50 px em 2. O código atual grava largura renderizada, que numa página A4 dá
~150 px por coluna. Não existe tabela de prova com coluna de 25 px. É
heurística, não prova; está registrada como tal.

**Dois comandos que já existem quebram a invariante e precisam mudar junto.**
`insertTableColumn` insere **`100`** em `colWidths` (`commands.ts:1191`) e
`deleteTableColumn` apenas corta a entrada (`:1289`). Com px isso funciona.
Com proporção que soma 100, inserir coluna faria a soma virar **200**, e
apagar deixaria abaixo de 100 — a tabela inteira encolheria ou explodiria a
cada linha/coluna mexida. Os dois passam a **renormalizar para 100** depois
de mexer na lista. É o defeito mais fácil de não enxergar nesta mudança,
porque não está em nenhum arquivo que o desenho cita.

### 2. Arrasto de coluna redistribui com a vizinha

`setColumnWidth` vira `setColumnBoundary(blockIndex, boundary, deltaPct)`:
tira da vizinha o que dá para a arrastada, respeitando um mínimo por coluna.
A soma permanece 100 por construção.

O handle da borda DIREITA da tabela não tem vizinha — ele passa a ser o
controle de largura total (item 3).

### 3. Redimensionar a tabela inteira — três alças

Decisão do usuário em 21/08: as três, não só a largura.

**Borda direita — largura total.** Novo atributo `tableWidth?: number`,
percentual da largura útil (padrão 100). As colunas mantêm as proporções
entre si.

Limites: **máximo 100** (a tabela não passa da margem) e **mínimo 20**.
O 20 é um piso arbitrário e assumido: com `table-layout: fixed` a tabela
encolhe abaixo do conteúdo sem resistência — o texto quebra e transborda em
vez de empurrar —, então não existe "mínimo que caiba o conteúdo" para
ancorar. Piso fixo é honesto; "mínimo do conteúdo" seria uma regra que o
layout não sustenta.

**Borda de baixo — altura total.** Distribui o delta **igualmente entre as
linhas**: cada uma recebe `delta / n`. Divisão igual preserva as diferenças
que o professor já tenha ajustado à mão — linhas `[40, 80, 40]` com `+30`
viram `[50, 90, 50]`, e não `[57, 57, 57]`.

(Não afirmo que é o que o Word faz: não verifiquei. A justificativa é a
propriedade acima, que dá para conferir lendo, não a autoridade do Word.)

**Canto inferior direito — as duas juntas.** Composição das duas de cima: o
delta horizontal vai para `tableWidth`, o vertical para as linhas. Sem regra
nova.

Contagem de alças, para não sobrar nem faltar: `n` colunas dão `n-1` divisas
internas mais a borda direita; `m` linhas dão `m-1` divisas internas mais a
borda de baixo; mais uma de canto.

**O `tableWidth` NÃO exige mexer nas quatro cópias de CSS.** Existe
`.ed-table { width: 100% }` em três `sofer-editor.css` mais o
`export-pdf/src/html.ts:530`. O valor vai por **estilo inline** no
`<table>`, que ganha da classe por especificidade. Quem for implementar:
não abra os quatro arquivos.

### 3.1. O arrasto da base NÃO pode ser exato — e é o mesmo defeito de novo

Altura de linha é **mínimo**, não valor fixo (ver item 4). Então encolher
abaixo do que o conteúdo ocupa grava o número mas não muda o desenho:

```
modelo depois do arrasto   [30, 70, 30]  = 130px
conteúdo exige             [40, 70, 40]
renderiza                  [40, 70, 40]  = 150px
```

Se o próximo `pointermove` partir da altura **renderizada** e gravar no
modelo, o erro se acumula — que é literalmente o emborrachado do item 1,
transposto para o eixo vertical. Seria irônico reintroduzir ao consertar.

Duas regras, e as duas são obrigatórias:

1. **O arrasto acumula contra o valor do MODELO no `pointerdown`**, nunca
   contra o que está na tela. O ponto de partida é lido uma vez e o delta é
   sempre relativo a ele.
2. **No `pointerup`, a alça reancora na posição renderizada.** Se a tabela
   não encolheu o quanto foi arrastado, a alça volta para onde a borda de
   fato está — em vez de ficar boiando longe dela e sugerindo que o próximo
   arrasto continua de onde o dedo parou.

Sem a regra 2 o professor arrasta, nada acontece visivelmente, ele arrasta
de novo, e na terceira vez a tabela salta. Vale para a largura também, que
tem mínimo de conteúdo pelo mesmo motivo.

### 4. Altura de linha

Novo atributo `rowHeights?: number[]` em px, uma entrada por linha.

`insertTableRow` e `deleteTableRow` precisam manter o array em sincronia com
o número de linhas, como `insertTableColumn` já faz com `colWidths`. Sem
isso o overlay cai no `Shape mismatch — bail out` que ele já tem, e as alças
simplesmente somem sem explicação.
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
| `packages/react/src/TableResizeOverlay.tsx` | redistribuição; alças de borda direita, borda de baixo e canto; alças horizontais entre linhas; reancoragem no `pointerup` |
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
- **A alça que não acompanha o dedo.** Encolher tabela abaixo do conteúdo
  grava o valor sem mudar o desenho. Sem a reancoragem do item 3.1, a alça
  fica boiando longe da borda e o próximo arrasto salta. É o mesmo defeito
  que este trabalho existe para consertar, e o jeito mais fácil de
  reintroduzi-lo.
