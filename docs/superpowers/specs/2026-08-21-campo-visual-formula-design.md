# Campo visual de fórmula (MathLive) — desenho

## Problema

O modal de fórmula mostra LaTeX cru. O professor clica em "Matriz 2×2" e
aparece isto num `<textarea>`:

```
\begin{pmatrix} {} & {} \\ {} & {} \end{pmatrix}
```

com o resultado renderizado **embaixo**, num preview separado. A queixa do
usuário foi direta: *"não dá pra ser algo mais intuitivo igual o Docs?"*

No Google Docs você nunca vê código. A fórmula se monta na tela enquanto
você digita, e o Tab anda entre as caixinhas vazias. Nenhuma reorganização
de paleta conserta isso — **o problema é o campo, não o menu**. A paleta de
82 itens entregue na semana passada resolveu o alcance do conteúdo; não
resolveu, nem podia, o fato de a entrada ser código.

## Decisão que isto reverte

O spec da paleta registra: *"Foi descartado trocar por um campo visual
(MathLive) — decisão já tomada quando a feature nasceu."*

Reverter está certo. Aquela escolha foi feita no abstrato, antes de existir
qualquer coisa para olhar. O usuário agora viu o modal pronto e disse que
não serve. **Ver vale mais que supor**, e este é o caso exato em que uma
decisão antiga merece cair.

## O que a medição resolveu antes do desenho

Dois riscos derrubariam a troca. Medi os dois primeiro.

### 1. O round-trip da notação brasileira — passou, 20/20

Este era o risco que importava. O editor grava `\operatorname{sen}` e não
`\sin` porque prova brasileira imprime **"sen"**; há teste travando a string
exata e o spec da paleta lista isso como o item que mais provavelmente seria
"simplificado" por engano. Se o MathLive normalizasse `\operatorname{sen}`
para `\sin` ao serializar, a garantia morreria **em silêncio**, na primeira
vez que alguém reabrisse uma fórmula existente para editar.

`setValue()` → `getValue('latex')` nos 20 casos de escola, todos idênticos à
entrada:

```
\operatorname{sen}  ·  \operatorname{tg}  ·  \operatorname{cotg}
\operatorname{sen} x  ·  3{,}14  ·  \varnothing  ·  \emptyset
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\begin{cases} x \\ y \end{cases}
\frac{1}{2} · \sqrt[3]{8} · \left|x\right| · \vec{F} · \mathbb{R}
\rightleftharpoons · \cong · \sim · H_2SO_4
9{,}8\,\text{m/s}^2  ·  \lim_{x \to 0}
```

A vírgula em grupo (`3{,}14`) sobrevive como grupo — importa porque vírgula
crua vira `3, 14` impresso.

**O que a medição NÃO cobre:** ida e volta sem edição no meio. Digitar
dentro do campo pode normalizar de outro jeito. A verificação em navegador
está no plano, com os mesmos 20 casos.

### 2. O bundle — 812K min / 219K gzip, sem o compute-engine

O `mathlive` declara `@cortex-js/compute-engine` como dependência, que
sozinho tem mais de 1 MB minificado. Bundlei um arquivo que importa só o
`MathfieldElement`:

```
812K minificado · 219K gzip · compute-engine NÃO entra
```

O motor simbólico fica fora porque o MathLive o trata como opcional em tempo
de execução (o bundle carrega a string `compute-engine-not-available`). Não
usamos nada dele — não resolvemos equação, só editamos.

Isso entra no **mesmo chunk sob demanda** onde o MathJax (992K) já mora: o
modal é `import()` dinâmico. O bundle principal não muda.

### 3. `\placeholder{}` sobrevive à serialização — e isso fecha um buraco

Medido: `\frac{\placeholder{}}{\placeholder{}}` volta intacto do
`getValue()`.

O spec da paleta registra como limitação conhecida que uma estrutura clicada
e deixada vazia entra na prova em branco, e que um guarda por largura mínima
do SVG **não funciona** — as populações se sobrepõem (`\sqrt{}` vazio mede
1.93ex, `\%` legítimo mede 1.885ex). Lá eu escrevi que um guarda de verdade
precisaria inspecionar a estrutura, não medir o resultado.

É exatamente o que o `\placeholder{}` dá: uma marca **estrutural** e
textual. `getValue().includes('\\placeholder{}')` é o guarda que faltava.
Ver "Guarda de fórmula incompleta" abaixo.

## Desenho

### 1. O campo

O `<textarea>` de LaTeX e o `<div>` de preview viram **um** elemento: o
`<math-field>` do MathLive. A fórmula se monta ali, e é ali que o cursor
fica.

```
┌─ Inserir fórmula ─────────────────────┐
│ [Estruturas][Símbolos][Gregas] …      │
│  ┌─┐   □          □      ⌐‾‾          │
│  │□│  □           □     √ □           │
│  └─┘                                  │
│                                       │
│   ┌───────────────────────────────┐   │
│   │      1                        │   │
│   │  x = ─  ▮                     │   │  ← digita aqui, já renderizado
│   │      2                        │   │
│   └───────────────────────────────┘   │
│   [ ] Fórmula em bloco                │
│                  [Cancelar] [Inserir] │
└───────────────────────────────────────┘
```

Some o preview separado: o campo **é** o preview. Some também a caixa de
LaTeX — quem sabe LaTeX continua atendido, porque o MathLive interpreta
comando digitado (`\frac` + espaço vira fração) e aceita colar LaTeX.

### 2. `applySnippet` morre

Hoje o clique na paleta faz splice de string e calcula onde o cursor cai —
é `applySnippet`, com seus testes de posição de cursor. Toda essa mecânica é
do MathLive agora: `mf.insert(snippet)` insere no cursor e leva o foco ao
primeiro placeholder.

Os snippets trocam `{}` por `#?`, que é como o MathLive marca placeholder na
inserção:

| Hoje | Depois |
| --- | --- |
| `\frac{}{}` | `\frac{#?}{#?}` |
| `\sqrt[{}]{}` | `\sqrt[#?]{#?}` |
| `\begin{pmatrix} {} & {} \\ {} & {} \end{pmatrix}` | `\begin{pmatrix} #? & #? \\ #? & #? \end{pmatrix}` |
| `\left({}\right)` | `\left(#?\right)` |
| `\operatorname{sen}` | `\operatorname{sen}` (sem placeholder, igual) |

**A regra de ouro da paleta não muda, só muda de dono:** todo destino de
digitação continua marcado explicitamente. Era `{}` para o `applySnippet`,
agora é `#?` para o MathLive. Quem acrescentar estrutura nova: marque onde o
professor digita primeiro. A Matriz nasceu sem marca nenhuma e o cursor caía
fora dela — foi o bloqueador da última review.

Deleta-se `applySnippet` e seus testes de cursor. Entra teste de que todo
snippet de estrutura contém `#?`.

### 3. Botões desenhados

Os botões de estrutura param de mostrar a palavra "Fração" e passam a
mostrar a fração desenhada, como no Docs. Isso estava descartado no spec da
paleta por custo — 82 renders de MathJax a cada abertura do modal. Com o
`convertLatexToMarkup` do MathLive o custo cai: é markup HTML+CSS síncrono,
sem o pipeline de SVG (medido: ~1 KB de markup para uma fração).

**Uma via só, não duas.** Todos os 82 botões renderizam pelo mesmo caminho,
inclusive os de símbolo. Manter "estrutura desenha, símbolo mostra o
caractere" seria dois códigos de render e duas larguras de botão para
manter em três cópias de CSS.

**O `titulo` deixa de ser conforto e vira obrigação.** Um botão cujo conteúdo
é uma pilha de `<span>` do KaTeX **não tem nome acessível nenhum** — hoje ao
menos o caractere é lido. Então `aria-label={titulo ?? label}` em todo botão,
e o `label` continua no dado como texto de fallback e como chave dos testes.
Os ~67 títulos escritos na rodada passada entram inteiros aqui.

**A grade precisa ser remedida, não deduzida.** Botão desenhado tem outra
proporção, e as larguras de coluna de hoje (4 para Estruturas, 6 para as
demais) e o `min-height: 128px` foram medidos para rótulo em texto. Medir no
navegador as 7 abas e reajustar antes de fechar — a regra que sustenta o
número é que **o modal não pode mudar de altura ao trocar de aba**, senão os
botões Cancelar/Inserir pulam sob o cursor.

### 4. Configuração do campo

| Opção | Valor | Por quê |
| --- | --- | --- |
| `mathVirtualKeyboardPolicy` | `"manual"` | Decisão do usuário: teclado virtual desligado. Em desktop rouba altura e duplica a paleta, em inglês e sem `sen`/`tg`/`cotg`. Reversível se aparecer demanda de tablet. |
| `soundsDirectory` | `null` | O pacote traz 240 KB de sons de tecla. Editor de prova não apita. |
| `fontsDirectory` | por app | Ver abaixo. |
| `inlineShortcuts` | `+ sen, tg, cotg` | Digitar "sen" vira `\operatorname{sen}`. Sem isso o atalho embutido de "sin" é o único caminho rápido, e ele imprime "sin". |
| `smartFence` | padrão (ligado) | Digitar `(` fecha sozinho — comportamento de Docs. |

### 5. Fontes: 20 arquivos, 296 KB, e três caminhos-base diferentes

O MathLive renderiza com as fontes do KaTeX: 20 `.woff2`, 296 KB, servidos
por `MathfieldElement.fontsDirectory`. Sem elas o campo desenha com fallback
do sistema e a fórmula fica visivelmente errada.

Este projeto já tem esse problema exato e resolvido para a Liberation Sans:
é a única divergência legítima entre as duas cópias de `sofer-editor.css` —
`/portal2/assets/fonts/…` contra `/assets/fonts/…`. O `fontsDirectory` segue
o mesmo padrão e a mesma divergência esperada: **um valor por app**, não uma
constante no pacote.

O `@sofereditor/react` não pode cravar o caminho. Ele expõe a configuração e
cada app passa o seu.

### 6. Guarda de fórmula incompleta

Com `\placeholder{}` detectável, o botão **Inserir fica desabilitado**
enquanto houver placeholder não preenchido, com o motivo visível ("preencha
os campos em branco"). Isso fecha a limitação registrada no Risco #4 do spec
da paleta, pelo caminho que eu mesmo apontei lá como o único que funcionaria:
inspecionar a estrutura, não medir o resultado.

Campo inteiramente vazio também não insere — é o caso trivial do mesmo
guarda.

## Onde mexe

| Arquivo | O quê |
| --- | --- |
| `packages/react/package.json` | dependência `mathlive`; **bump obrigatório** (manifesto mudou) |
| `packages/react/src/FormulaDialog.tsx` | `<textarea>`+preview → `<math-field>`; botões renderizados; guarda de placeholder |
| `packages/react/src/formulaSnippet.ts` | `{}` → `#?`; `applySnippet` deletado; `PALETA` e os `titulo` intactos |
| `packages/react/src/__tests__/formulaSnippet.test.ts` | testes de cursor saem; entra "todo snippet de estrutura tem `#?`" |
| `packages/react/src/__tests__/formulaPaleta.render.test.ts` | continua valendo — é o MathJax que gera o SVG do documento, e ele não muda |
| `apps/playground` + as 2 cópias de `sofer-editor.css` | CSS do campo e da grade remedida; `fontsDirectory` por app |

**O que não encosta, e é o motivo de a troca ser aceitável:** o modelo já
guarda `formula.latex`, e o MathLive fala LaTeX na entrada e na saída. Ficam
intactos `packages/core` (o embed), `packages/math` (o SVG do documento via
MathJax), `export-docx`, `export-pdf`, paginação, clipboard, colaboração.

O MathJax **continua**: ele gera o SVG que vai para o documento e o PNG que
vai para o DOCX. O MathLive só edita.

## Fora de escopo

- **Edição dentro do documento**, sem modal, que é o que o Docs faz de fato.
  Mexe em seleção e paginação do core — outra ordem de grandeza. A queixa
  ("vejo código") é resolvida sem isso.
- **Teclado virtual** — decisão do usuário, reversível por configuração.
- **`compute-engine`** — não resolvemos equação, só editamos.
- **Trocar o MathJax pelo MathLive na saída.** O MathLive renderiza
  HTML+CSS; o documento precisa de SVG e o DOCX de PNG. São papéis
  diferentes e as duas bibliotecas ficam.

## Riscos

- **Round-trip com edição no meio não foi medido.** O que medi foi
  `setValue` → `getValue`. Digitar dentro do campo pode serializar
  diferente, e o caso que dói é `\operatorname{sen}`. Verificação em
  navegador, com os 20 casos, é passo de plano e não opcional.
- **`insert()` com `#?` não pôde ser verificado fora do navegador.** No
  jsdom devolveu vazio, o que é artefato do ambiente e não resultado. Toda a
  paleta depende desse comportamento: verificar cedo, não no fim.
- **Fontes ausentes degradam em silêncio.** Sem as 20 `.woff2` no caminho
  certo, o campo desenha com fonte do sistema — feio, mas funcional, e
  ninguém percebe em dev se o caminho de dev estiver certo e o de produção
  não. O caminho difere por app, que é exatamente onde este projeto já
  errou antes com a Liberation Sans. Conferir nos três.
- **Duas bibliotecas de matemática no mesmo chunk** (MathJax 992K +
  MathLive 812K). Sob demanda, mas quem abre o modal baixa os dois. Aceito:
  é um modal de composição de prova, não um caminho quente.
- **A grade remedida atravessa três cópias de CSS.** Já divergiram antes
  neste projeto. As três edições saem na mesma leva, e o `diff` entre as
  duas cópias dos apps tem que continuar reduzindo aos 4 hunks conhecidos de
  `@font-face`.
- **Os apps só recebem isto depois de publicar.** `portal2-next` e
  `frequencia-ocorrencia` consomem do npm, não do workspace. O
  `frequencia-ocorrencia` não tem gate de tipo nenhum — incompatibilidade
  aparece só em runtime.
