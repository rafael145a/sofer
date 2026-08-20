/**
 * Helpers que PRECISAM de DOM e canvas. Ficam separados de `render.ts` de
 * propósito: aquele é puro e roda em Node (vitest, export no servidor), este
 * só roda no browser e não tem teste unitário — o gate dele é a verificação
 * no navegador.
 */

/**
 * Quantos px vale 1 `ex` na cascata de `root`.
 *
 * O MathJax devolve as dimensões da fórmula em `ex`, unidade relativa ao
 * font-size de quem exibe. Converter com uma constante chutada dá fórmula
 * fora de escala com o texto ao redor, e o erro muda com o tamanho de fonte
 * do documento. Medir é a única forma correta.
 *
 * O nó de medição é filho de `root` para herdar a mesma cascata — solto no
 * <body> ele pegaria o font-size do documento HTML, não o do editor.
 */
export function measureExInPx(root: HTMLElement): number {
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;height:1ex;width:0;padding:0;margin:0;border:0";
  root.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  // Fallback defensivo: se a medição vier zero (nó ainda não no layout), 8px
  // é 1ex de um texto de 16px, que é o padrão do editor.
  return px > 0 ? px : 8;
}

/**
 * Rasteriza o SVG em PNG data URL, para o `fallback` do ImageRun no DOCX.
 *
 * `scale` de 3 é para a fórmula não borrar na impressão — o DOCX carrega o
 * SVG vetorial para Word 2016+, e este PNG só aparece em versões antigas,
 * mas quando aparece tem que estar legível.
 *
 * O canvas NÃO fica tainted porque o SVG é auto-contido (`fontCache: 'local'`
 * garante isso). Se algum dia o SVG passar a referenciar recurso externo,
 * `toDataURL` lança SecurityError — e é essa a pista.
 */
export function svgToPngDataUrl(
  svg: string,
  widthPx: number,
  heightPx: number,
  scale = 3,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(widthPx * scale));
      canvas.height = Math.max(1, Math.round(heightPx * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas 2d indisponível"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("SVG não carregou no <img>"));
    img.src = url;
  });
}

/** SVG string → data URL, o `src` do embed. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
