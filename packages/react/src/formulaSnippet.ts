export interface CategoriaPaleta {
  /** Rótulo da aba. */
  nome: string;
  /** 4 para rótulos em palavra, 6 para rótulos em caractere. */
  colunas: 4 | 6;
  itens: readonly { label: string; snippet: string }[];
}

/**
 * Paleta do modal de fórmula: 76 itens em 7 categorias, cobrindo do 6º ano ao
 * pré-vestibular, mais física e química de prova.
 *
 * Todos os 76 foram verificados contra o renderer real com
 * `packages: ['base','ams']` + o import por efeito colateral do
 * `AmsConfiguration` — zero falhas. Nenhum exige extensão nova do MathJax.
 * Ao acrescentar um item, rode-o pelo `renderLatexToSvg` antes de commitar.
 *
 * NOTAÇÃO BRASILEIRA: `\sin` renderiza "sin" e `\tan` renderiza "tan". Prova
 * brasileira escreve "sen" e "tg". Por isso as três funções abaixo usam
 * `\operatorname{}`. NÃO troque para as formas nativas do LaTeX: a paleta
 * continuaria parecendo certa e a prova impressa sairia errada.
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
      { label: "Raiz n-ésima", snippet: "\\sqrt[]{}" },
      { label: "Somatório", snippet: "\\sum_{}^{}" },
      { label: "Produtório", snippet: "\\prod_{}^{}" },
      { label: "Integral", snippet: "\\int_{}^{}" },
      { label: "Limite", snippet: "\\lim_{ \\to }" },
      { label: "Derivada", snippet: "\\frac{d}{d}" },
      { label: "Matriz 2×2", snippet: "\\begin{pmatrix} & \\\\ & \\end{pmatrix}" },
      { label: "Sistema", snippet: "\\begin{cases}  \\\\  \\end{cases}" },
      { label: "Parênteses", snippet: "\\left( \\right)" },
      { label: "Binomial", snippet: "\\binom{}{}" },
    ],
  },
  {
    nome: "Símbolos",
    colunas: 6,
    itens: [
      { label: "±", snippet: "\\pm" },
      { label: "×", snippet: "\\times" },
      { label: "÷", snippet: "\\div" },
      { label: "·", snippet: "\\cdot" },
      { label: "∞", snippet: "\\infty" },
      { label: "°", snippet: "^\\circ" },
      { label: "%", snippet: "\\%" },
    ],
  },
  {
    nome: "Relações",
    colunas: 6,
    itens: [
      { label: "≠", snippet: "\\neq" },
      { label: "≈", snippet: "\\approx" },
      { label: "≡", snippet: "\\equiv" },
      { label: "≤", snippet: "\\leq" },
      { label: "≥", snippet: "\\geq" },
      { label: "∝", snippet: "\\propto" },
      { label: "⊥", snippet: "\\perp" },
      { label: "∥", snippet: "\\parallel" },
    ],
  },
  {
    nome: "Gregas",
    colunas: 6,
    itens: [
      { label: "α", snippet: "\\alpha" },
      { label: "β", snippet: "\\beta" },
      { label: "γ", snippet: "\\gamma" },
      { label: "δ", snippet: "\\delta" },
      { label: "ε", snippet: "\\varepsilon" },
      { label: "θ", snippet: "\\theta" },
      { label: "λ", snippet: "\\lambda" },
      { label: "μ", snippet: "\\mu" },
      { label: "π", snippet: "\\pi" },
      { label: "ρ", snippet: "\\rho" },
      { label: "σ", snippet: "\\sigma" },
      { label: "φ", snippet: "\\varphi" },
      { label: "ω", snippet: "\\omega" },
      { label: "Δ", snippet: "\\Delta" },
      { label: "Σ", snippet: "\\Sigma" },
      { label: "Π", snippet: "\\Pi" },
      { label: "Ω", snippet: "\\Omega" },
      { label: "Φ", snippet: "\\Phi" },
    ],
  },
  {
    nome: "Conjuntos",
    colunas: 6,
    itens: [
      { label: "∈", snippet: "\\in" },
      { label: "∉", snippet: "\\notin" },
      { label: "⊂", snippet: "\\subset" },
      { label: "⊆", snippet: "\\subseteq" },
      { label: "∪", snippet: "\\cup" },
      { label: "∩", snippet: "\\cap" },
      { label: "∅", snippet: "\\emptyset" },
      { label: "ℕ", snippet: "\\mathbb{N}" },
      { label: "ℤ", snippet: "\\mathbb{Z}" },
      { label: "ℚ", snippet: "\\mathbb{Q}" },
      { label: "ℝ", snippet: "\\mathbb{R}" },
      { label: "ℂ", snippet: "\\mathbb{C}" },
      { label: "∀", snippet: "\\forall" },
      { label: "∃", snippet: "\\exists" },
    ],
  },
  {
    nome: "Funções",
    colunas: 6,
    itens: [
      { label: "sen", snippet: "\\operatorname{sen}" },
      { label: "cos", snippet: "\\cos" },
      { label: "tg", snippet: "\\operatorname{tg}" },
      { label: "cotg", snippet: "\\operatorname{cotg}" },
      { label: "log", snippet: "\\log_{}" },
      { label: "ln", snippet: "\\ln" },
      { label: "exp", snippet: "\\exp" },
    ],
  },
  {
    nome: "Setas",
    colunas: 6,
    itens: [
      { label: "→", snippet: "\\to" },
      { label: "←", snippet: "\\leftarrow" },
      { label: "⇒", snippet: "\\Rightarrow" },
      { label: "⇔", snippet: "\\Leftrightarrow" },
      { label: "⇌", snippet: "\\rightleftharpoons" },
      { label: "vetor", snippet: "\\overrightarrow{}" },
      { label: "∠", snippet: "\\angle" },
      { label: "△", snippet: "\\triangle" },
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
