import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * O `FormulaDialog` é import ESTÁTICO em `EditorContext.tsx`. Um
 * `import "mathlive"` no topo de qualquer arquivo de `src/` arrasta 806 KB
 * para o bundle principal de todo app que usa o editor — sem erro, sem
 * warning, só mais lento para quem nunca abre uma fórmula.
 *
 * Não existe ESLint neste pacote, então este teste é o guarda.
 *
 * Medido em 21/08/2026, no build do playground: com o import dinâmico, o
 * entry `index-*.js` fica com 882 KB e ZERO ocorrências de `ML__latex`,
 * `mathVirtualKeyboardPolicy`, `smartFence` e `KaTeX_Main`; os 806 KB do
 * mathlive ficam num `mathlive.min-*.js` separado.
 */

const RAIZ = join(__dirname, "..");

/** Recursivo de propósito: `readdirSync` raso deixaria subpasta sem guarda. */
function fontes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : fontes(caminho);
    return /\.tsx?$/.test(e.name) ? [caminho] : [];
  });
}

/**
 * Elide o que a compilação apaga, e só isso:
 *   - comentário de linha;
 *   - `import type ...`;
 *   - `import { type A, type B } from ...` — SÓ quando todo especificador é
 *     de tipo. Um único especificador de valor no meio mantém o import.
 */
function semTipos(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^[ \t]*import\s+type\s[\s\S]*?["'][^"']*["']\s*;?/gm, "")
    .replace(
      /^[ \t]*import\s*\{[^}]*\}\s*from\s*["']mathlive["']\s*;?/gm,
      (m) => {
        const dentro = /\{[^}]*\}/.exec(m)![0].slice(1, -1);
        const todosTipo = dentro
          .split(",")
          .filter((s) => s.trim())
          .every((s) => /^\s*type\s/.test(s));
        return todosTipo ? "" : m;
      },
    );
}

/**
 * Casa import/export estático de `mathlive` e NÃO casa `import("mathlive")`.
 *
 * O `(?:^|;)` na frente existe para pegar `import a from "x"; import b from
 * "mathlive";` na mesma linha — âncora só de início de linha deixava passar,
 * e isso foi medido, não suposto.
 * O `[^;()]*?` no meio é o que impede de casar o `import(` dinâmico.
 */
const ESTATICO =
  /(?:^|;)\s*(?:import|export)\s+(?:[^;()]*?\s+from\s+)?["']mathlive["']/m;

describe("mathlive só entra por import dinâmico", () => {
  const arquivos = fontes(RAIZ);

  it("a varredura achou arquivos", () => {
    // Sem isto o guarda vira verde vazio: `it.each([])` com o
    // `--passWithNoTests` do pacote sai com código 0 e "no tests". Se as
    // fontes mudarem de lugar ou o filtro quebrar, o teste some sem avisar.
    expect(arquivos.length).toBeGreaterThan(5);
  });

  it.each(arquivos.map((f) => relative(RAIZ, f)))("%s", (rel) => {
    const src = semTipos(readFileSync(join(RAIZ, rel), "utf8"));
    expect(
      ESTATICO.test(src),
      `${rel} importa mathlive em runtime — use import("mathlive") para valor ` +
        `ou "import type" para tipo`,
    ).toBe(false);
  });
});
