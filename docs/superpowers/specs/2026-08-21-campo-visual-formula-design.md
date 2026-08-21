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

### 1. O round-trip da notação brasileira — passou, 20/20

Este era o risco que podia matar a ideia. O editor grava `\operatorname{sen}`
e não `\sin` porque prova brasileira imprime **"sen"**; há teste travando a
string exata, e o spec da paleta lista isso como o item que mais
provavelmente seria "simplificado" por engano. Se o MathLive normalizasse
`\operatorname{sen}` para `\sin` ao serializar, a garantia morreria **em
silêncio**, na primeira vez que alguém reabrisse uma fórmula para editar.

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
dentro do campo pode normalizar de outro jeito. Verificação em navegador,
com estes mesmos 20 casos, é passo de plano e não opcional.

### 2. Os dois LaTeX não são o mesmo LaTeX — e isso molda o desenho inteiro

O MathLive e o MathJax falam dialetos diferentes, e os dois tokens que
importam **quebram** do outro lado. Medido contra o `renderLatexToSvg` real:

| Token | No MathJax | Erro |
| --- | --- | --- |
| `#?` (placeholder de inserção do MathLive) | **falha** | `You can't use 'macro parameter character #' in math mode` |
| `\placeholder{}` (o que o MathLive serializa) | **falha** | `Undefined control sequence \placeholder` |
| `{}` (o que a paleta usa hoje) | ok | — |

Isto não é detalhe de implementação, é a restrição central:

**a) O dado da paleta continua em `{}`.** A tradução para `#?` acontece na
inserção, e só ali. Se o `#?` fosse armazenado, o
`formulaPaleta.render.test.ts` — que passa os 82 itens pelo MathJax de
verdade — falharia em toda estrutura. Esse teste é a única garantia de que
um item novo da paleta é LaTeX válido, e ele fica **sem uma linha de
mudança**.

Considerei guardar `#?` e o teste remover o token antes de renderizar. Medi:
não funciona. Remover `#?` de `\frac{#?}{#?}` dá `\frac`, e o MathJax
responde `Missing argument for \frac` — 12 dos 82 quebram assim. Qualquer
uma das duas direções exige tradução de verdade, e então é melhor que o
**dado seja a forma renderável**, a que um humano pode colar num renderer
para conferir.

**b) O guarda de fórmula incompleta é carga estrutural, não polimento.** Como
`\placeholder{}` é erro de compilação no MathJax, uma fórmula com caixa em
branco não entra "em branco" no documento: ela **não renderiza**. O botão
Inserir desabilitado enquanto houver placeholder é o que impede isso de
chegar ao modelo.

De quebra, isso fecha a limitação registrada no Risco #4 do spec da paleta —
estrutura vazia entrando na prova — e fecha pelo único caminho que eu tinha
apontado lá como viável: inspecionar a estrutura, não medir a largura do
SVG. `getValue().includes('\\placeholder{}')` é a inspeção que faltava.

### 3. O bundle — 812K min / 219K gzip, e ele NÃO pode ser import estático

Bundlei um arquivo que importa só o `MathfieldElement`:

```
812K minificado · 219K gzip · compute-engine NÃO entra
```

O `@cortex-js/compute-engine` (1 MB+ minificado) é dependência declarada,
mas o MathLive o trata como opcional em tempo de execução — o bundle carrega
a string `compute-engine-not-available`. Não usamos nada dele: não
resolvemos equação, só editamos.

**A parte que quase me escapou:** o `FormulaDialog` é import **estático** em
`EditorContext.tsx:5`. Um `import "mathlive"` no topo dele põe os 812K no
**bundle principal**, não num chunk sob demanda — e destrói a propriedade
que eu verifiquei no app real depois da feature de fórmulas (zero recursos
carregados antes do clique, um chunk de 992K depois).

Então o MathLive entra por `import()` dinâmico dentro do diálogo, do mesmo
jeito que o `@sofereditor/math` já entra (`FormulaDialog.tsx:54`). O diálogo
já tem estado de carregando e ramo de erro para esse import; o MathLive
entra na mesma promise, não numa segunda. **Isto é requisito, não
preferência**, e o plano precisa de verificação de bundle que falhe se
alguém tornar o import estático depois.

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
comando digitado e traz atalhos embutidos (digitar `sqrt`, `sum`, `int`,
`oo` vira `\sqrt{#?}`, `\sum_{#?}^{#?}`, `\int_{#?}^{#?}`, `\infty`), além
de aceitar LaTeX colado.

### 2. `applySnippet` morre; entra uma tradução de uma linha

Hoje o clique na paleta faz splice de string e calcula onde o cursor cai —
é `applySnippet`, com seus testes de posição de cursor. Toda essa mecânica
passa a ser do MathLive: `mf.insert(snippet)` insere no cursor e leva o foco
ao primeiro placeholder.

O **dado não muda** (ver §2 das medições): a `PALETA` continua com `{}`. Só
a chamada de inserção traduz:

```ts
mf.insert(snippet.replaceAll("{}", "#?"));
```

Conferido nos 82 itens: nenhum snippet tem `{}` que não seja destino de
digitação. `\begin{pmatrix}`, `\operatorname{sen}` e `\mathbb{R}` têm
conteúdo entre as chaves e não são tocados; `\{{}\}` vira `\{#?\}`, correto.

**A regra de ouro da paleta não muda, só muda de dono:** todo destino de
digitação continua marcado explicitamente. Era `{}` para o `applySnippet`,
agora é `{}` traduzido em `#?` para o MathLive. Quem acrescentar estrutura
nova: marque onde o professor digita primeiro. A Matriz nasceu sem marca
nenhuma e o cursor caía fora dela — foi o bloqueador da última review.

Testes: saem os de posição de cursor (a mecânica não é mais nossa); entram
dois, ambos sobre o dado real — todo snippet de estrutura tem pelo menos um
`{}`, e a tradução produz um `#?` para cada `{}` que existia.

### 3. Botões desenhados

Os botões de estrutura param de mostrar a palavra "Fração" e passam a
mostrar a fração desenhada, como no Docs. Isso estava descartado no spec da
paleta por custo. O custo é menor do que aquele spec supôs: só a aba ativa
renderiza (`PALETA[abaAtiva].itens.map`), então são **no máximo 18 por aba**
(Gregas), não 82 por abertura. E o `convertLatexToMarkup` é markup HTML+CSS
síncrono, sem o pipeline de SVG — medido: ~1 KB para uma fração.

**Uma via só, não duas.** Todos os 82 botões renderizam pelo mesmo caminho,
inclusive os de símbolo. Manter "estrutura desenha, símbolo mostra o
caractere" seria dois códigos de render e duas larguras de botão para manter
em três cópias de CSS.

O botão renderiza o snippet **sem** tradução — `{}` de novo, porque o
`convertLatexToMarkup` é o renderer, não o campo. É o mesmo motivo de o dado
ficar em `{}`.

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

Nomes conferidos nos `.d.ts` do pacote, não de memória.

| Opção | Onde | Valor | Por quê |
| --- | --- | --- | --- |
| `mathVirtualKeyboardPolicy` | instância | `"manual"` | Decisão do usuário: teclado virtual desligado. Em desktop rouba altura e duplica a paleta, em inglês e sem `sen`/`tg`/`cotg`. Reversível. |
| `MathfieldElement.soundsDirectory` | **estático** | `null` | O pacote traz 240 KB de sons de tecla. Editor de prova não apita. |
| `MathfieldElement.fontsDirectory` | **estático** | por app | Ver §5. |
| `inlineShortcuts` | instância | `+ sen, tg, cotg` | Digitar "sen" vira `\operatorname{sen}`. Sem isso o atalho embutido de "sin" é o único caminho rápido, e ele imprime "sin". |
| `smartFence` | instância | padrão (ligado) | Digitar `(` fecha sozinho — comportamento de Docs. |

`fontsDirectory` e `soundsDirectory` são **estáticos na classe**, não opções
por campo: configuram-se uma vez, na inicialização, e valem para todo
`<math-field>` da página.

### 5. Fontes e CSS: 20 arquivos, 296 KB, e três caminhos-base diferentes

O MathLive renderiza com as fontes do KaTeX: 20 `.woff2`, 296 KB, servidos
por `MathfieldElement.fontsDirectory`. Sem elas o campo desenha com fallback
do sistema e a fórmula fica visivelmente errada.

Este projeto já tem esse problema exato e resolvido para a Liberation Sans:
é a única divergência legítima entre as duas cópias de `sofer-editor.css` —
`/portal2/assets/fonts/…` contra `/assets/fonts/…`. O `fontsDirectory` segue
o mesmo padrão e a mesma divergência esperada: **um valor por app**, não uma
constante no pacote. O `@sofereditor/react` expõe a configuração; cada app
passa o seu.

**Além das fontes, o `mathlive-static.css` (12.8 KB).** O `<math-field>`
carrega o próprio estilo no shadow DOM e se vira sozinho — mas o markup do
`convertLatexToMarkup` dos botões da paleta vai para o **light DOM** e não
tem estilo nenhum sem esse arquivo. Sem ele os 82 botões viram pilha de
texto sem formatação. É fácil de perder porque o campo, que é o que se olha
primeiro, funciona sem ele.

### 6. Guarda de fórmula incompleta

O botão **Inserir fica desabilitado** enquanto o `getValue()` contiver
`\placeholder{}`, com o motivo visível ("preencha os campos em branco").
Campo inteiramente vazio também não insere — caso trivial do mesmo guarda.

Como estabelecido em §2 das medições, isto é correção e não conforto: o
`\placeholder{}` é erro de compilação no MathJax, então uma fórmula com caixa
em branco não chega ao documento em branco, chega quebrada.

## Onde mexe

| Arquivo | O quê |
| --- | --- |
| `packages/react/package.json` | dependência `mathlive`; **bump obrigatório** (manifesto mudou) |
| `packages/react/src/FormulaDialog.tsx` | `<textarea>`+preview → `<math-field>`; `import()` dinâmico do mathlive na promise que já existe; botões renderizados; guarda de placeholder |
| `packages/react/src/formulaSnippet.ts` | `applySnippet` deletado; `PALETA` e os `titulo` **intactos** |
| `packages/react/src/__tests__/formulaSnippet.test.ts` | testes de cursor saem; entram os dois de `{}`/tradução |
| `packages/react/src/__tests__/formulaPaleta.render.test.ts` | **zero mudanças** — é o que a decisão de guardar `{}` compra |
| `apps/playground` + as 2 cópias de `sofer-editor.css` | CSS do campo e da grade remedida; `mathlive-static.css`; `fontsDirectory` por app |

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
  navegador, com os 20 casos, é passo de plano.
- **`insert()` com `#?` não pôde ser verificado fora do navegador.** No jsdom
  devolveu vazio, o que é artefato do ambiente e não resultado. O token é
  real — o próprio MathLive define seus atalhos embutidos com ele
  (`"sum": "\\sum_{#?}^{#?}"`) e constrói `pmatrix` com ele — mas **`#?` não
  aparece em nenhum `.d.ts`**, então o TypeScript não protege e ninguém vai
  tropeçar nele lendo tipo. Verificar cedo: a paleta inteira depende disso.
- **Import estático do mathlive mata o carregamento sob demanda.** É a única
  linha que separa 812K no chunk preguiçoso de 812K no bundle principal, e
  não dá erro nenhum — só fica mais lento para todo mundo que abre o editor.
  Precisa de verificação automatizada, não de vigilância.
- **Fontes ou `mathlive-static.css` ausentes degradam em silêncio.** Sem as
  20 `.woff2` no caminho certo o campo desenha com fonte do sistema; sem o
  CSS estático os botões da paleta perdem a formatação. O caminho difere por
  app, que é exatamente onde este projeto já errou antes com a Liberation
  Sans. Conferir nos três.
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
