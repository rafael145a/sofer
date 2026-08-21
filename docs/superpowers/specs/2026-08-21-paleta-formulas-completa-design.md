# Paleta de fórmulas completa — desenho

## Problema

A paleta do modal de fórmula tem **oito** itens numa grade 4×2:

```ts
Fração · Expoente · Índice · Raiz · Raiz n-ésima · Somatório · Integral · Matriz 2×2
```

O comentário no código diz que são "os oito itens que uma prova de escola usa
de fato". Na prática não são: o editor atende do 6º ano ao pré-vestibular,
mais física e química. Um professor que precisa de `π`, `≤`, `∈`, `sen`, `Δ`
ou um sistema de equações tem que digitar LaTeX — exatamente o que a paleta
existe para evitar.

## Decisões do usuário

1. **Mais símbolos, organizados.** Continua paleta + campo de LaTeX + preview;
   o que muda é a quantidade e a navegação. Foi descartado trocar por um campo
   visual (MathLive) — decisão já tomada quando a feature nasceu.
2. **Escopo completo:** fundamental (6º–9º), médio, pré-vestibular, e física e
   química.

## O que a medição mudou no desenho

Antes de desenhar, os snippets propostos foram rodados contra o renderer
real (`packages: ['base','ams']` + o import por efeito colateral do
`AmsConfiguration`). **Zero falhas.**

Isso decide dois pontos que pareceriam abertos:

**Nenhuma mudança de configuração do MathJax, e nenhum crescimento de bundle.**
Tudo que a paleta precisa já renderiza com o pacote atual — incluindo o que
parecia exigir extensão: `\mathbb{R}`, `\begin{cases}`, `\binom`,
`\overrightarrow`, `\operatorname`, `\rightleftharpoons`, `\angle`.

**A química de prova já funciona sem `mhchem`.** Medido: `H_2SO_4`,
`2H_2 + O_2 \rightarrow 2H_2O`, `A \rightleftharpoons B`,
`\vec{F} = m\vec{a}` e unidade via `v = 9{,}8\,\text{m/s}^2` renderizam com o
pacote atual. Ver "Química" abaixo.

**Todo `{}` na tabela abaixo é destino de cursor, não enfeite.** O
`applySnippet` põe o cursor no **primeiro `{}` vazio** do snippet, e cai no
fim do inserido quando não há nenhum. Um snippet de estrutura sem `{}` — a
Matriz nasceu assim — deixa o professor com o cursor depois de
`\end{pmatrix}`, fora da matriz que ele acabou de pedir. Grupo vazio é
invisível na renderização (medido: a matriz com e sem os quatro `{}` tem a
mesma largura, 5.593ex), então o placeholder é de graça. Quem acrescentar
estrutura nova aqui: ponha o `{}` onde o professor vai digitar primeiro.

## Desenho

### 1. Conteúdo — 82 itens em 7 categorias

Todos verificados contra o renderer real. A tabela abaixo é a fonte da
implementação, e reflete o estado final da branch (inclui a rodada de
correções `13bdb40` e `b26aa1c`).

**Estruturas** (15, 4 colunas) — abre por padrão. Rótulo em palavra, sem
`titulo`: a palavra já é o nome.

| Rótulo | Snippet |
| --- | --- |
| Fração | `\frac{}{}` |
| Expoente | `^{}` |
| Índice | `_{}` |
| Raiz | `\sqrt{}` |
| Raiz n-ésima | `\sqrt[{}]{}` |
| Somatório | `\sum_{}^{}` |
| Produtório | `\prod_{}^{}` |
| Integral | `\int_{}^{}` |
| Limite | `\lim_{{} \to {}}` |
| Derivada | `\frac{d}{d{}}` |
| Matriz 2×2 | `\begin{pmatrix} {} & {} \\ {} & {} \end{pmatrix}` |
| Sistema | `\begin{cases} {} \\  \end{cases}` |
| Parênteses | `\left({}\right)` |
| Binomial | `\binom{}{}` |
| Módulo | `\left|{}\right|` |

Duas escolhas de cursor que não são óbvias: **Raiz n-ésima** usa
`\sqrt[{}]{}` e não `\sqrt[]{}` — quem clicou em *n-ésima* em vez de *Raiz*
fez isso por causa do índice, então o cursor vai para o índice. **Matriz**
leva um `{}` por célula, não só na primeira: as outras três também precisam
de destino para quem navegar.

As seis categorias abaixo têm **rótulo em caractere e 6 colunas**, e **todo
item leva `titulo`** — sem ele o nome acessível do botão é um glifo solto.

**Símbolos** (8)

| Rótulo | Snippet | `titulo` |
| --- | --- | --- |
| ± | `\pm` | mais ou menos |
| × | `\times` | multiplicação |
| ÷ | `\div` | divisão |
| · | `\cdot` | multiplicação (ponto) |
| ∞ | `\infty` | infinito |
| ° | `^\circ` | grau |
| % | `\%` | por cento |
| , | `{,}` | vírgula decimal |

**Relações** (10)

| Rótulo | Snippet | `titulo` |
| --- | --- | --- |
| ≠ | `\neq` | diferente de |
| ≈ | `\approx` | aproximadamente |
| ≡ | `\equiv` | idêntico a |
| ≤ | `\leq` | menor ou igual a |
| ≥ | `\geq` | maior ou igual a |
| ∝ | `\propto` | proporcional a |
| ⊥ | `\perp` | perpendicular a |
| ∥ | `\parallel` | paralelo a |
| ≅ | `\cong` | congruente a |
| ∼ | `\sim` | semelhante a |

**Gregas** (18)

| Rótulo | Snippet | `titulo` |
| --- | --- | --- |
| α | `\alpha` | alfa |
| β | `\beta` | beta |
| γ | `\gamma` | gama |
| δ | `\delta` | delta |
| ε | `\varepsilon` | épsilon |
| θ | `\theta` | teta |
| λ | `\lambda` | lambda |
| μ | `\mu` | mi |
| π | `\pi` | pi |
| ρ | `\rho` | rô |
| σ | `\sigma` | sigma |
| φ | `\varphi` | fi |
| ω | `\omega` | ômega |
| Δ | `\Delta` | delta maiúsculo |
| Σ | `\Sigma` | sigma maiúsculo — letra grega; para somatório use Estruturas |
| Π | `\Pi` | pi maiúsculo — letra grega; para produtório use Estruturas |
| Ω | `\Omega` | ômega maiúsculo |
| Φ | `\Phi` | fi maiúsculo |

Os `titulo` de `Σ` e `Π` carregam a desambiguação porque a confusão é real e
cara: `\Sigma` (1.633ex) e `\sum` (2.389ex) são glifos diferentes, e o
professor caçando somatório encontra o `Σ` grego primeiro, na grade de
símbolos, com o desenho parecido. Sem o aviso, a letra grega vai para a prova.

**Conjuntos** (15)

| Rótulo | Snippet | `titulo` |
| --- | --- | --- |
| ∈ | `\in` | pertence a |
| ∉ | `\notin` | não pertence a |
| ⊂ | `\subset` | contido em |
| ⊆ | `\subseteq` | contido ou igual a |
| ∪ | `\cup` | união |
| ∩ | `\cap` | interseção |
| ∅ | `\varnothing` | conjunto vazio |
| ℕ | `\mathbb{N}` | conjunto dos naturais |
| ℤ | `\mathbb{Z}` | conjunto dos inteiros |
| ℚ | `\mathbb{Q}` | conjunto dos racionais |
| ℝ | `\mathbb{R}` | conjunto dos reais |
| ℂ | `\mathbb{C}` | conjunto dos complexos |
| ∀ | `\forall` | para todo |
| ∃ | `\exists` | existe |
| { } | `\{{}\}` | chaves de conjunto |

`\varnothing` e não `\emptyset`: o rótulo do botão mostra `∅` (U+2205, o
círculo cortado) e o livro didático brasileiro imprime o círculo, mas
`\emptyset` renderiza um **zero** cortado, mais estreito (1.131ex contra
1.760ex). O botão prometia uma coisa e entregava outra.

**Funções** (7)

| Rótulo | Snippet | `titulo` |
| --- | --- | --- |
| sen | `\operatorname{sen}` | seno |
| cos | `\cos` | cosseno |
| tg | `\operatorname{tg}` | tangente |
| cotg | `\operatorname{cotg}` | cotangente |
| log | `\log_{}` | logaritmo |
| ln | `\ln` | logaritmo natural |
| exp | `\exp` | exponencial |

**Setas e geometria** (9)

| Rótulo | Snippet | `titulo` |
| --- | --- | --- |
| → | `\to` | tende a / vai para |
| ← | `\leftarrow` | vem de / sentido inverso |
| ⇒ | `\Rightarrow` | implica em |
| ⇔ | `\Leftrightarrow` | se e somente se |
| ⇌ | `\rightleftharpoons` | equilíbrio químico |
| vetor AB | `\overrightarrow{}` | vetor entre dois pontos (AB) |
| vetor | `\vec{}` | vetor (física) |
| ∠ | `\angle` | ângulo |
| △ | `\triangle` | triângulo |

Os dois "vetor" são formas diferentes e ambas de escola: `\overrightarrow`
é a de geometria (dois pontos, AB) e `\vec` a de física (uma letra). Os
rótulos precisam continuar distintos — o teste trava rótulo repetido dentro
de uma categoria.

**A vírgula decimal é o item de maior alcance da lista inteira.** Em modo
matemático a vírgula crua é átomo de pontuação e ganha espaço depois de si:
`3,14` mede 4.4ex e sai **"3, 14"** impresso; `3{,}14` mede 4.023ex e sai
certo. Atinge todo decimal de toda prova de matemática, física e química.

### 2. Notação brasileira — o detalhe que erra fácil

`\sin` do LaTeX renderiza **"sin"**. Prova brasileira escreve **"sen"**. O
mesmo vale para `tg` (não "tan") e `cotg` (não "cot").

Por isso a paleta insere `\operatorname{sen}`, `\operatorname{tg}` e
`\operatorname{cotg}` — verificados. Sem isso o professor clica em "sen" e sai
"sin" impresso na prova, que é pior que não ter o botão: parece certo na
paleta e sai errado no papel.

`\cos`, `\ln` e `\exp` ficam nativos: as três grafias coincidem em português.

### 3. Navegação — abas de categoria, grade abaixo

```
[Estruturas] [Símbolos] [Relações] [Gregas] [Conjuntos] [Funções] [Setas]
┌────────────────────────────────────────────────┐
│  Fração   Expoente   Índice   Raiz    ⁿ√       │
│  Σ        ∏          ∫        lim     d/dx     │
│  Matriz   Sistema    ( )      C(n,k)           │
└────────────────────────────────────────────────┘
[ campo de LaTeX ]
[ ] Fórmula em bloco
[ preview ]
                              [Cancelar] [Inserir]
```

**Duas larguras de coluna, uma altura só.** Botão de palavra ("Raiz n-ésima")
não cabe na largura de um botão de símbolo (π). Então:

- **Estruturas: 4 colunas** (rótulos em palavra) → 15 itens = 4 linhas.
- **As outras seis: 6 colunas** (rótulos em caractere) → no máximo 18 itens
  (Gregas) = 3 linhas.

Se a grade acompanhasse o conteúdo, trocar de aba mudaria a altura do modal e
os botões Cancelar/Inserir pulariam sob o cursor. Por isso a grade tem
**`min-height` fixo dimensionado para 4 linhas** — o pior caso, que é
Estruturas. As categorias de símbolo sobram espaço embaixo, e isso é o preço
de o modal não pular.

**"Estruturas" abre por padrão e contém os oito itens de hoje**, mais seis.
Quem já usa a paleta não perde velocidade nem precisa reaprender nada.

A aba ativa é estado local do modal e **reseta a cada abertura** — reabrir
sempre começa em Estruturas, que é o previsível.

Descartados: acordeão (cresce o modal e exige rolagem) e grade única com
cabeçalhos fixos (mesmo custo de rolagem, sem o ganho de compactação).

### 4. Rótulo dos botões

Símbolo mostra **o próprio caractere** (π, ≤, ∈, ⇒). Palavra não escala para
82 itens, e o caractere é o que o professor procura com o olho.

Estruturas mantêm **palavra curta** — não existe caractere Unicode para
"fração com dois campos vazios".

Todos os botões levam `title` com o nome por extenso, para o caso do caractere
ser ambíguo (`∝` propor­cional, `≡` idêntico) e para leitor de tela.

### 5. Química: `\ce{}` fica de fora

Medido, com o pacote atual: `H_2SO_4` ✓, `2H_2 + O_2 \rightarrow 2H_2O` ✓,
`A \rightleftharpoons B` ✓, `\vec{F} = m\vec{a}` ✓,
`v = 9{,}8\,\text{m/s}^2` ✓.

O `\ce{}` do `mhchem` custaria ~96 KB de fonte (12 KB de configuração + o
`mhchemparser`), dentro do chunk que já é carregado sob demanda — barato. Não
é o custo que decide, é isto: **`\ce{}` tem uma mini-sintaxe própria, que não é
LaTeX.** Isso trabalha contra a premissa da feature ("quem não sabe LaTeX
clica"): o professor teria que aprender uma segunda linguagem para usar o
único botão que a exige. Com paleta, escrever `H_2` é um clique.

É aditivo depois, se um professor de química pedir. Nada nesta decisão fecha
essa porta.

`\SI{}` (siunitx) **não existe no MathJax** em versão nenhuma — nenhum pacote
o traz. Unidade se escreve com `\text{}`.

## Onde mexe

| Arquivo | O quê |
| --- | --- |
| `packages/react/src/formulaSnippet.ts` | `PALETA` passa de lista plana a lista de categorias; `applySnippet` **não muda** |

A forma nova do dado, explícita para não ficar ambígua na implementação:

```ts
export interface CategoriaPaleta {
  /** Rótulo da aba. */
  nome: string;
  /** 4 para rótulos em palavra, 6 para rótulos em caractere. */
  colunas: 4 | 6;
  itens: readonly {
    label: string;
    snippet: string;
    /**
     * Nome por extenso, usado no `title` do botão. Obrigatório na prática
     * para rótulo em caractere — sem ele o nome acessível é um glifo solto
     * e o `title` só repete o que já está visível. Estruturas dispensam:
     * o rótulo já é palavra.
     */
    titulo?: string;
  }[];
}
export const PALETA: readonly CategoriaPaleta[];
```

`applySnippet(text, selStart, selEnd, snippet)` fica intacta — a mudança é
só de organização do dado e de render.
| `packages/react/src/__tests__/formulaSnippet.test.ts` | casos das categorias; o teste de cursor continua valendo |
| `packages/react/src/FormulaDialog.tsx` | estado da aba ativa; render das abas e da grade |
| `apps/playground/src/styles.css` | estilos das abas |
| `portal2-next/.../sofer-editor.css` | idem |
| `frequencia-ocorrencia/.../sofer-editor.css` | idem |

O modal vive no pacote e o `EditorProvider` o monta, então **os dois apps
herdam sem tocar em código deles**. Só o CSS é triplicado — e é o custo real
desta mudança: três edições que precisam ficar idênticas, num arquivo que já
divergiu entre as cópias antes.

## Fora de escopo

- **`mhchem` / `\ce{}`** — decisão acima, reversível.
- **Campo visual (MathLive)** — decisão do usuário na criação da feature.
- **Busca por nome de símbolo.** Com 7 categorias de até 18 itens, o olho
  acha. Uma caixa de busca vale quando a paleta passar de ~150 itens.
- **Símbolo mais usados / recentes.** Exige persistir preferência por usuário,
  o que hoje não existe no editor.
- **Renderizar o rótulo do botão pelo MathJax** (mostrar a fração desenhada em
  vez da palavra "Fração"). Elegante, mas são 82 renders a cada abertura do
  modal e complica o carregamento sob demanda.

## Riscos

- **`\operatorname{sen}` é o item que passa despercebido numa revisão.**
  Alguém "simplifica" para `\sin` porque é o idioma do LaTeX, e a prova sai com
  "sin". Precisa de teste que trave a string exata, não só que o snippet
  renderize.
- **A altura fixa da grade depende da categoria maior.** Gregas tem 18 itens;
  se alguém acrescentar um 19º sem olhar o layout, ou a grade rola ou o modal
  pula de altura ao trocar de aba. O teste deve travar o número de colunas e
  falhar quando uma categoria passar do que cabe.
- **CSS em três cópias.** Já divergiu antes neste projeto. As três edições
  precisam sair na mesma leva, e o `diff` entre as duas cópias dos apps tem
  que continuar dando exatamente o hunk conhecido.
- **`^{}` e `_{}` como itens de paleta, clicados e deixados vazios.** Isto NÃO
  gera LaTeX inválido: medido, `renderLatexToSvg("^{}", false)` devolve
  `ok: true` (0.188ex de largura). O preview renderiza um espaço em branco e o
  botão Inserir fica **habilitado** — o professor consegue inserir uma
  fórmula em branco na prova. O mesmo vale para qualquer estrutura da paleta
  clicada e deixada sem preencher (índice, expoente, fração, raiz, parênteses,
  vetor).

  Não estou corrigindo isso agora porque um guarda por largura mínima do SVG
  — a ideia óbvia — não funciona: medi as duas populações e elas se
  sobrepõem.

  ```
  estruturas vazias:    vetor 0.036 · expoente 0.188 · índice 0.188 · fração 0.995 · parênteses 1.76 · raiz 1.93
  símbolos legítimos:   cdot 0.629 · grau 0.988 · pi 1.29 · in 1.509 · pm 1.76 · % 1.885
  ```

  `\sqrt{}` vazio (1.93ex) é mais largo que `\%` legítimo (1.885ex) — não há
  limiar de largura que separe as duas populações. Um guarda de verdade
  precisaria inspecionar a árvore do MathJax por grupos `{}` vazios antes de
  render, não medir o SVG depois. Fica registrado como limitação conhecida
  até que valha a pena esse guarda.
