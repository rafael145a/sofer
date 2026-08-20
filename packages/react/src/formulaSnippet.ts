/**
 * Paleta do modal de fórmula. Os oito itens que uma prova de escola usa de
 * fato — não é uma tentativa de cobrir LaTeX inteiro. Quem precisa de mais
 * digita no campo, que aceita qualquer coisa que o MathJax entenda.
 *
 * Todos foram verificados contra o renderer: renderizam sem erro com
 * `packages: ['base','ams']` + o import do AmsConfiguration.
 */
export const PALETA: readonly { label: string; snippet: string }[] = [
  { label: "Fração", snippet: "\\frac{}{}" },
  { label: "Expoente", snippet: "^{}" },
  { label: "Índice", snippet: "_{}" },
  { label: "Raiz", snippet: "\\sqrt{}" },
  { label: "Raiz n-ésima", snippet: "\\sqrt[]{}" },
  { label: "Somatório", snippet: "\\sum_{}^{}" },
  { label: "Integral", snippet: "\\int_{}^{}" },
  { label: "Matriz 2×2", snippet: "\\begin{pmatrix} & \\\\ & \\end{pmatrix}" },
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
