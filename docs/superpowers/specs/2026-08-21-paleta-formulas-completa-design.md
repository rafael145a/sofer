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

Antes de desenhar, os 76 snippets propostos foram rodados contra o renderer
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

## Desenho

### 1. Conteúdo — 76 itens em 7 categorias

Todos verificados. A tabela abaixo é a fonte da implementação.

**Estruturas** (14) — abre por padrão

| Rótulo | Snippet |
| --- | --- |
| Fração | `\frac{}{}` |
| Expoente | `^{}` |
| Índice | `_{}` |
| Raiz | `\sqrt{}` |
| Raiz n-ésima | `\sqrt[]{}` |
| Somatório | `\sum_{}^{}` |
| Produtório | `\prod_{}^{}` |
| Integral | `\int_{}^{}` |
| Limite | `\lim_{ \to }` |
| Derivada | `\frac{d}{d}` |
| Matriz 2×2 | `\begin{pmatrix} & \\ & \end{pmatrix}` |
| Sistema | `\begin{cases}  \\  \end{cases}` |
| Parênteses | `\left( \right)` |
| Binomial | `\binom{}{}` |

**Símbolos** (7): `\pm` `\times` `\div` `\cdot` `\infty` `^\circ` `\%`

**Relações** (8): `\neq` `\approx` `\equiv` `\leq` `\geq` `\propto` `\perp` `\parallel`

**Gregas** (18): `\alpha` `\beta` `\gamma` `\delta` `\varepsilon` `\theta`
`\lambda` `\mu` `\pi` `\rho` `\sigma` `\varphi` `\omega` `\Delta` `\Sigma`
`\Pi` `\Omega` `\Phi`

**Conjuntos** (14): `\in` `\notin` `\subset` `\subseteq` `\cup` `\cap`
`\emptyset` `\mathbb{N}` `\mathbb{Z}` `\mathbb{Q}` `\mathbb{R}` `\mathbb{C}`
`\forall` `\exists`

**Funções** (7): `\operatorname{sen}` `\cos` `\operatorname{tg}`
`\operatorname{cotg}` `\log_{}` `\ln` `\exp`

**Setas e geometria** (8): `\to` `\leftarrow` `\Rightarrow` `\Leftrightarrow`
`\rightleftharpoons` `\overrightarrow{}` `\angle` `\triangle`

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

- **Estruturas: 4 colunas** (rótulos em palavra) → 14 itens = 4 linhas.
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
76 itens, e o caractere é o que o professor procura com o olho.

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
  itens: readonly { label: string; snippet: string }[];
}
export const PALETA: readonly CategoriaPaleta[];
```

`applySnippet(text, selStart, selEnd, snippet)` fica intacta — a mudança é
só de organização do dado e de render.
| `packages/react/src/formulaSnippet.test.ts` | casos das categorias; o teste de cursor continua valendo |
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
  vez da palavra "Fração"). Elegante, mas são 76 renders a cada abertura do
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
- **`^{}` e `_{}` como itens de paleta.** Inseridos com a seleção vazia, geram
  LaTeX inválido isolado (`^{}` sozinho não compila). O preview vai acusar
  erro e o botão Inserir fica desabilitado — comportamento correto, mas pode
  parecer defeito. Vale confirmar no navegador que a mensagem de erro do
  MathJax é compreensível nesse caso.
