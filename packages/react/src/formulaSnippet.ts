export interface CategoriaPaleta {
  /** Rótulo da aba. */
  nome: string;
  /** 4 para rótulos em palavra, 6 para rótulos em caractere. */
  colunas: 4 | 6;
  itens: readonly { label: string; snippet: string; titulo?: string }[];
}

/**
 * Paleta do modal de fórmula: 82 itens em 7 categorias, cobrindo do 6º ano ao
 * pré-vestibular, mais física e química de prova.
 *
 * Todos os 82 foram verificados contra o renderer real com
 * `packages: ['base','ams']` + o import por efeito colateral do
 * `AmsConfiguration` — zero falhas. Nenhum exige extensão nova do MathJax.
 * Ao acrescentar um item, rode-o pelo `renderLatexToSvg` antes de commitar.
 *
 * NOTAÇÃO BRASILEIRA: `\sin` renderiza "sin" e `\tan` renderiza "tan". Prova
 * brasileira escreve "sen" e "tg". Por isso as três funções abaixo usam
 * `\operatorname{}`. NÃO troque para as formas nativas do LaTeX: a paleta
 * continuaria parecendo certa e a prova impressa sairia errada.
 *
 * `titulo`: nome acessível/tooltip do botão quando `label` é um glifo solto
 * (símbolo, letra grega, seta) e não diz nada sozinho — o `title` do botão
 * usa `titulo ?? label`. Itens com rótulo em palavra (Estruturas) dispensam.
 */
export const PALETA: readonly CategoriaPaleta[] = [
  {
    nome: "Estruturas",
    colunas: 4,
    itens: [
      { label: "Fração", snippet: "\\frac{}{}" },
      { label: "Expoente", snippet: "^{}" },
      { label: "Índice", snippet: "_{}" },
      { label: "Raiz", snippet: "\\sqrt{}" },
      { label: "Raiz n-ésima", snippet: "\\sqrt[{}]{}" },
      { label: "Somatório", snippet: "\\sum_{}^{}" },
      { label: "Produtório", snippet: "\\prod_{}^{}" },
      { label: "Integral", snippet: "\\int_{}^{}" },
      { label: "Limite", snippet: "\\lim_{{} \\to {}}" },
      { label: "Derivada", snippet: "\\frac{d}{d{}}" },
      {
        label: "Matriz 2×2",
        snippet: "\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}",
      },
      { label: "Sistema", snippet: "\\begin{cases} {} \\\\  \\end{cases}" },
      { label: "Parênteses", snippet: "\\left({}\\right)" },
      { label: "Binomial", snippet: "\\binom{}{}" },
      { label: "Módulo", snippet: "\\left|{}\\right|" },
    ],
  },
  {
    nome: "Símbolos",
    colunas: 6,
    itens: [
      { label: "±", snippet: "\\pm", titulo: "mais ou menos" },
      { label: "×", snippet: "\\times", titulo: "multiplicação" },
      { label: "÷", snippet: "\\div", titulo: "divisão" },
      { label: "·", snippet: "\\cdot", titulo: "multiplicação (ponto)" },
      { label: "∞", snippet: "\\infty", titulo: "infinito" },
      { label: "°", snippet: "^\\circ", titulo: "grau" },
      { label: "%", snippet: "\\%", titulo: "porcento" },
      { label: ",", snippet: "{,}", titulo: "vírgula decimal" },
    ],
  },
  {
    nome: "Relações",
    colunas: 6,
    itens: [
      { label: "≠", snippet: "\\neq", titulo: "diferente de" },
      { label: "≈", snippet: "\\approx", titulo: "aproximadamente" },
      { label: "≡", snippet: "\\equiv", titulo: "idêntico a" },
      { label: "≤", snippet: "\\leq", titulo: "menor ou igual a" },
      { label: "≥", snippet: "\\geq", titulo: "maior ou igual a" },
      { label: "∝", snippet: "\\propto", titulo: "proporcional a" },
      { label: "⊥", snippet: "\\perp", titulo: "perpendicular a" },
      { label: "∥", snippet: "\\parallel", titulo: "paralelo a" },
      { label: "≅", snippet: "\\cong", titulo: "congruente a" },
      { label: "∼", snippet: "\\sim", titulo: "semelhante a" },
    ],
  },
  {
    nome: "Gregas",
    colunas: 6,
    itens: [
      { label: "α", snippet: "\\alpha", titulo: "alfa" },
      { label: "β", snippet: "\\beta", titulo: "beta" },
      { label: "γ", snippet: "\\gamma", titulo: "gama" },
      { label: "δ", snippet: "\\delta", titulo: "delta" },
      { label: "ε", snippet: "\\varepsilon", titulo: "épsilon" },
      { label: "θ", snippet: "\\theta", titulo: "teta" },
      { label: "λ", snippet: "\\lambda", titulo: "lambda" },
      { label: "μ", snippet: "\\mu", titulo: "mi" },
      { label: "π", snippet: "\\pi", titulo: "pi" },
      { label: "ρ", snippet: "\\rho", titulo: "rô" },
      { label: "σ", snippet: "\\sigma", titulo: "sigma" },
      { label: "φ", snippet: "\\varphi", titulo: "fi" },
      { label: "ω", snippet: "\\omega", titulo: "ômega" },
      { label: "Δ", snippet: "\\Delta", titulo: "delta maiúsculo" },
      {
        label: "Σ",
        snippet: "\\Sigma",
        titulo: "sigma maiúsculo — letra grega; para somatório use Estruturas",
      },
      {
        label: "Π",
        snippet: "\\Pi",
        titulo: "pi maiúsculo — letra grega; para produtório use Estruturas",
      },
      { label: "Ω", snippet: "\\Omega", titulo: "ômega maiúsculo" },
      { label: "Φ", snippet: "\\Phi", titulo: "fi maiúsculo" },
    ],
  },
  {
    nome: "Conjuntos",
    colunas: 6,
    itens: [
      { label: "∈", snippet: "\\in", titulo: "pertence a" },
      { label: "∉", snippet: "\\notin", titulo: "não pertence a" },
      { label: "⊂", snippet: "\\subset", titulo: "contido em" },
      { label: "⊆", snippet: "\\subseteq", titulo: "contido ou igual a" },
      { label: "∪", snippet: "\\cup", titulo: "união" },
      { label: "∩", snippet: "\\cap", titulo: "interseção" },
      { label: "∅", snippet: "\\varnothing", titulo: "conjunto vazio" },
      { label: "ℕ", snippet: "\\mathbb{N}", titulo: "conjunto dos naturais" },
      { label: "ℤ", snippet: "\\mathbb{Z}", titulo: "conjunto dos inteiros" },
      { label: "ℚ", snippet: "\\mathbb{Q}", titulo: "conjunto dos racionais" },
      { label: "ℝ", snippet: "\\mathbb{R}", titulo: "conjunto dos reais" },
      { label: "ℂ", snippet: "\\mathbb{C}", titulo: "conjunto dos complexos" },
      { label: "∀", snippet: "\\forall", titulo: "para todo" },
      { label: "∃", snippet: "\\exists", titulo: "existe" },
      { label: "{ }", snippet: "\\{{}\\}", titulo: "chaves de conjunto" },
    ],
  },
  {
    nome: "Funções",
    colunas: 6,
    itens: [
      { label: "sen", snippet: "\\operatorname{sen}", titulo: "seno" },
      { label: "cos", snippet: "\\cos", titulo: "cosseno" },
      { label: "tg", snippet: "\\operatorname{tg}", titulo: "tangente" },
      { label: "cotg", snippet: "\\operatorname{cotg}", titulo: "cotangente" },
      { label: "log", snippet: "\\log_{}", titulo: "logaritmo" },
      { label: "ln", snippet: "\\ln", titulo: "logaritmo natural" },
      { label: "exp", snippet: "\\exp", titulo: "exponencial" },
    ],
  },
  {
    nome: "Setas",
    colunas: 6,
    itens: [
      { label: "→", snippet: "\\to", titulo: "tende a / vai para" },
      { label: "←", snippet: "\\leftarrow", titulo: "seta para a esquerda" },
      { label: "⇒", snippet: "\\Rightarrow", titulo: "implica em" },
      { label: "⇔", snippet: "\\Leftrightarrow", titulo: "se e somente se" },
      { label: "⇌", snippet: "\\rightleftharpoons", titulo: "equilíbrio químico" },
      { label: "vetor AB", snippet: "\\overrightarrow{}", titulo: "vetor entre dois pontos (AB)" },
      { label: "vetor", snippet: "\\vec{}", titulo: "vetor (física)" },
      { label: "∠", snippet: "\\angle", titulo: "ângulo" },
      { label: "△", snippet: "\\triangle", titulo: "triângulo" },
    ],
  },
];

/**
 * Insere `snippet` no lugar da seleção e devolve onde o cursor deve ficar:
 * dentro do primeiro `{}` vazio do snippet, ou no fim do inserido quando não
 * há nenhum. Puro, para poder ser testado sem DOM.
 */
export function applySnippet(
  text: string,
  selStart: number,
  selEnd: number,
  snippet: string,
): { text: string; cursor: number } {
  const novo = text.slice(0, selStart) + snippet + text.slice(selEnd);
  const vazio = snippet.indexOf("{}");
  const cursor =
    vazio >= 0 ? selStart + vazio + 1 : selStart + snippet.length;
  return { text: novo, cursor };
}
