/**
 * Helpers puros de decoração visual, compartilhados pelos DOIS renderizadores
 * (`@sofereditor/react` e `@sofereditor/export-pdf`).
 *
 * Ficam aqui, e não dentro de cada renderizador, porque decoração divergente
 * entre editor e PDF é exatamente o modo de falha que a fidelidade de impressão
 * do projeto existe para impedir.
 */

/** Estilo CSS em camelCase — compatível com `CSSProperties` do React. */
export type StyleRecord = Record<string, string>;

/** Mínimo de underlines consecutivos que viram lacuna. */
export const BLANK_MIN_RUN = 3;

/**
 * Segmenta um texto em trechos normais e corridas de `BLANK_MIN_RUN`+ underlines.
 *
 * INVARIANTE: a concatenação dos segmentos reconstrói o texto original
 * caractere a caractere. Os offsets do modelo dependem disso — `dom-bridge`
 * mapeia posição de DOM para offset somando `textContent.length`, então dividir
 * uma run em sub-spans é seguro, mas introduzir ou remover caracteres não é.
 */
export function splitUnderscoreRuns(text: string): Array<{ text: string; blank: boolean }> {
  if (text.length === 0) return [];
  // Regex local: `lastIndex` de um literal com /g é estado compartilhado entre
  // chamadas se a instância for reaproveitada.
  const re = new RegExp(`_{${BLANK_MIN_RUN},}`, "g");
  const out: Array<{ text: string; blank: boolean }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), blank: false });
    out.push({ text: match[0], blank: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), blank: false });
  return out;
}

/**
 * Estilo da lacuna: uma corrida de underlines vira um traço contínuo, sem
 * serrilhado, com a largura exata da sequência digitada.
 *
 * `-webkit-text-fill-color` apaga o GLIFO mas preserva `color`, que é o que
 * pinta o sublinhado — `color: transparent` apagaria os dois.
 *
 * PROIBIDO acrescentar aqui: `display`, `padding`, `margin`, `letterSpacing`,
 * `width`. Qualquer um desloca métricas e a paginação diverge do PDF.
 */
export const BLANK_STYLE: StyleRecord = {
  WebkitTextFillColor: "transparent",
  textDecoration: "underline",
};

/** Converte um `StyleRecord` camelCase em texto CSS (`a:b;c:d`). */
export function styleToCssText(style: StyleRecord): string {
  return Object.entries(style)
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(";");
}

function kebab(prop: string): string {
  // Custom properties (`--x`) já vêm no formato final.
  if (prop.startsWith("--")) return prop;
  // `WebkitTextFillColor` → `-webkit-text-fill-color` (o W inicial vira `-w`).
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
