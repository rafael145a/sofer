import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * O `FormulaDialog` é import ESTÁTICO em `EditorContext.tsx`. Um
 * `import "mathlive"` no topo de qualquer arquivo de `src/` arrasta 812 KB
 * para o bundle principal de todo app que usa o editor — sem erro, sem
 * warning, só mais lento para quem nunca abre uma fórmula.
 *
 * Medido em 21/08/2026: mathlive bundlado = 812 KB minificado / 219 KB gzip.
 */
describe("mathlive só entra por import dinâmico", () => {
  const dir = join(__dirname, "..");
  const arquivos = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));

  it.each(arquivos)("%s", (arquivo) => {
    const src = readFileSync(join(dir, arquivo), "utf8");
    // Casa `import ... from "mathlive"` e `import "mathlive"`.
    // NÃO casa duas formas, e as duas exceções são de propósito:
    //   `import("mathlive")`  → o dinâmico, que é o permitido;
    //   `import type ...`     → apagado na compilação, custo zero em runtime,
    //                           e é assim que se pega o tipo de MathfieldElement
    //                           sem cair no `any`.
    const estatico = /^\s*import\s+(?!type\s)(?:[^;]*?\s+from\s+)?["']mathlive["']/m;
    expect(
      estatico.test(src),
      `${arquivo} importa mathlive em runtime — use import("mathlive") para valor ` +
        `ou "import type" para tipo`,
    ).toBe(false);
  });
});
