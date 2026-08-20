import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
// Import POR EFEITO COLATERAL: é ele que registra os ambientes do pacote ams
// (pmatrix, align, ...). A lista `packages` do TeX abaixo NÃO basta sozinha —
// sem esta linha, `\begin{pmatrix}` falha com "Unknown environment 'pmatrix'".
// Medido: com a linha, os oito itens da paleta passam; sem ela, matriz quebra.
//
// Não trocar por `AllPackages`: aquele import puxa mhchem, bussproofs, braket
// e mais 25 pacotes que uma prova de escola não usa, e vai tudo pro bundle.
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";

export type FormulaRender =
  | {
      ok: true;
      /** SVG auto-contido, pronto para virar data URL. */
      svg: string;
      /** Largura em unidades `ex` (relativa ao font-size de quem exibe). */
      widthEx: number;
      /** Altura em unidades `ex`. */
      heightEx: number;
      /** Deslocamento da linha de base em `ex`. Negativo desce. */
      vAlignEx: number;
    }
  | { ok: false; error: string };

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

/**
 * Um documento MathJax só, reusado entre chamadas. `liteAdaptor` não toca o
 * DOM, então isto roda igual em Node (vitest, export no servidor) e no browser.
 */
const doc = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams"] }),
  // fontCache 'local' põe os glifos num <defs> DENTRO do SVG. Com o padrão
  // 'global' eles vão para um <defs> compartilhado fora, e o SVG extraído do
  // documento renderiza EM BRANCO no PDF e no DOCX.
  OutputJax: new SVG({ fontCache: "local" }),
});

/** Extrai um número de "1.795ex" / "-0.781ex". Devolve 0 se não casar. */
function parseEx(v: string | undefined): number {
  if (!v) return 0;
  const m = /(-?[\d.]+)\s*ex/.exec(v);
  return m ? Number.parseFloat(m[1]) : 0;
}

/**
 * LaTeX → SVG auto-contido. Puro: sem DOM, sem canvas, sem rede.
 *
 * Erros do MathJax NÃO são lançados — vêm como atributo `data-mjx-error` no
 * HTML gerado. Por isso a detecção é por atributo, não por try/catch.
 */
export function renderLatexToSvg(latex: string, display: boolean): FormulaRender {
  let html: string;
  try {
    html = adaptor.outerHTML(doc.convert(latex, { display }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const erro = /data-mjx-error="([^"]*)"/.exec(html);
  if (erro) return { ok: false, error: erro[1] };

  const inicio = html.indexOf("<svg");
  const fim = html.lastIndexOf("</svg>");
  if (inicio < 0 || fim < 0) return { ok: false, error: "MathJax não devolveu SVG" };
  const svg = html.slice(inicio, fim + "</svg>".length);

  return {
    ok: true,
    svg,
    widthEx: parseEx(/width="([^"]+)"/.exec(svg)?.[1]),
    heightEx: parseEx(/height="([^"]+)"/.exec(svg)?.[1]),
    vAlignEx: parseEx(/vertical-align:\s*([^;"]+)/.exec(html)?.[1]),
  };
}
