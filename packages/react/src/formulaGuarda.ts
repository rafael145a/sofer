/** O que o MathLive serializa numa caixa não preenchida. */
export const PLACEHOLDER = "\\placeholder{}";

type Preview = { ok: boolean; error?: string } | null;

/**
 * O MathLive e o MathJax falam dialetos diferentes de LaTeX. `\placeholder{}`
 * é `Undefined control sequence` do lado do MathJax, então uma fórmula com
 * caixa em branco não chega ao documento em branco: chega quebrada.
 *
 * NÃO trocar por `getValue('latex-without-placeholders')`, que o MathLive
 * oferece: ele apaga a marca e devolve `\frac{}{}`, que renderiza vazio —
 * é exatamente o bug que este gate existe para fechar.
 */
export function podeInserir(latex: string, preview: Preview): boolean {
  if (latex.trim() === "") return false;
  if (latex.includes(PLACEHOLDER)) return false;
  return preview?.ok === true;
}

export function motivoBloqueio(latex: string, preview: Preview): string | null {
  if (latex.includes(PLACEHOLDER)) {
    return "Preencha os campos em branco da fórmula.";
  }
  if (preview && !preview.ok) return preview.error ?? null;
  return null;
}
