/** O que o MathLive serializa numa caixa **nunca tocada**. */
export const PLACEHOLDER = "\\placeholder{}";

/**
 * Grupo vazio: `{}` ou `{ }`.
 *
 * É como volta uma caixa que o professor PREENCHEU e depois esvaziou —
 * `\frac{1}{}` de quem apertou Backspace no denominador para corrigir. O
 * `\placeholder{}` não cobre esse caso: ele marca só o que nunca foi tocado.
 */
const GRUPO_VAZIO = /\{\s*\}/;

/**
 * Célula vazia dentro de um ambiente de array (`pmatrix`, `cases`…).
 *
 * Célula esvaziada não volta como `{}` — volta como **nada**, entre dois
 * separadores: `\begin{pmatrix}1 & 2\\ 3 & \end{pmatrix}`. Nenhuma regex de
 * grupo alcança isso, e a matriz é o item da paleta com mais caixas.
 */
const CELULA_VAZIA = /(?:\\begin\{[a-zA-Z]+\*?\}|&|\\\\)\s*(?:&|\\\\|\\end\{)/;

type Preview = { ok: boolean; error?: string } | null;

/**
 * Três travas, porque uma fórmula pela metade **não** entra em branco no
 * documento — entra quebrada ou mutilada, e sem aviso.
 *
 * O caso que motivou as duas travas novas, medido: a professora clica em
 * Fração, preenche, e aperta Backspace uma vez para corrigir o denominador.
 * O campo vira `\frac{1}{}`, o MathJax renderiza com `ok: true` um SVG de
 * 919 bytes com um único glifo (o "1", sem barra e sem denominador), e o
 * botão Inserir ficava **habilitado, sem mensagem nenhuma**. Nove formas
 * passavam assim: `\frac{}{2}`, `x^{}`, `x_{}`, `\sqrt{}`, `\log_{}`,
 * `\left|{}\right|`, célula de matriz e linha de sistema.
 *
 * NÃO trocar por `getValue('latex-without-placeholders')`, que o MathLive
 * oferece: ele apaga a marca e devolve `\frac{}{}`, que renderiza vazio —
 * é exatamente o bug que este gate existe para fechar.
 */
export function podeInserir(latex: string, preview: Preview): boolean {
  if (motivoBloqueio(latex, preview) !== null) return false;
  return latex.trim() !== "" && preview?.ok === true;
}

export function motivoBloqueio(latex: string, preview: Preview): string | null {
  if (
    latex.includes(PLACEHOLDER) ||
    GRUPO_VAZIO.test(latex) ||
    CELULA_VAZIA.test(latex)
  ) {
    return "Preencha os campos em branco da fórmula.";
  }
  if (preview && !preview.ok) return preview.error ?? null;
  return null;
}
