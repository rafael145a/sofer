# Fórmulas matemáticas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inserir fórmulas matemáticas no editor como embed de imagem SVG que carrega o LaTeX de origem, editável depois e fiel no PDF e no DOCX.

**Architecture:** A fórmula não é um tipo novo de embed — é um `ImageEmbed` com um campo `formula` opcional, o que faz paginação, clipboard, resize, PDF e delete funcionarem sem mudança. `@sofereditor/math` converte LaTeX em SVG auto-contido via MathJax `liteAdaptor` (sem DOM, testável em vitest). SVG e PNG de fallback são gerados na inserção e guardados no documento; o caminho de leitura e o de PDF nunca carregam MathJax.

**Tech Stack:** TypeScript, React 18, `mathjax-full@3.2.2` (tex-svg, liteAdaptor), vitest + `react-dom/server`, `docx@9.6.1`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-20-formulas-matematicas-design.md`. Ler antes de começar.
- **Branch:** `feat/formulas-matematicas`, já criada e ativa no `editor-monorepo`. Não fazer checkout, não criar branch.
- **`isImageEmbed` não muda.** É o que faz paginação, clipboard, overlay de resize, `getSelectedEmbed`, Backspace/Delete e `htmlToSlice` funcionarem sem tocar em nada.
- **`fontCache: 'local'`** no `SVG` do MathJax. O padrão `'global'` põe os glifos num `<defs>` fora do SVG; extraído do documento ele renderiza **em branco**.
- **Não importar `AllPackages`.** O import tem efeito colateral de carregar todos os pacotes TeX (mhchem, bussproofs, etc.). Usar o import por efeito colateral de `AmsConfiguration.js` + `packages: ['base', 'ams']`.
- **Erros do MathJax não lançam** — vêm como atributo `data-mjx-error="..."` no HTML gerado. Detectar por atributo, não por `try/catch`.
- **Clamp de largura:** `MAX_INSERT_WIDTH` (600) de `packages/react/src/imageConstraints.ts`, o mesmo que toda inserção de imagem já usa.
- **Rótulos exatos da paleta:** `Fração` / `Expoente` / `Índice` / `Raiz` / `Raiz n-ésima` / `Somatório` / `Integral` / `Matriz 2×2`.
- **Fórmula não recebe legenda.** O botão "Legenda" dá lugar a "Editar fórmula" quando o embed selecionado é fórmula.
- **`@sofereditor/math` passa a ser publicado**, saindo de `private: true`. Isso leva o conjunto de release coordenada de 6 para 7 pacotes.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/core/src/types.ts` | campos `formula` e `svgFallback` em `ImageEmbed`; `isFormulaEmbed` |
| `packages/math/src/render.ts` | **novo.** Puro, sem DOM: LaTeX → SVG + dimensões em `ex`. É o único lugar que conhece MathJax |
| `packages/math/src/browser.ts` | **novo.** Só DOM/canvas: medir `1ex` em px, rasterizar SVG→PNG |
| `packages/math/src/index.ts` | reexporta os dois |
| `packages/react/src/formulaSnippet.ts` | **novo.** Puro: inserir snippet da paleta na posição do cursor |
| `packages/react/src/FormulaDialog.tsx` | **novo.** Paleta, campo, preview |
| `packages/react/src/useEditor.ts` | `requestFormula` / `resolveFormulaRequest` |
| `packages/react/src/EditorContext.tsx` | monta o `FormulaDialog` (os consumidores herdam de graça) |
| `packages/react/src/Editor.tsx` | duplo clique reabre o modal |
| `packages/react/src/Toolbar.tsx` | botão de inserir; "Editar fórmula" no lugar de "Legenda" |
| `packages/react/src/renderInline.tsx` | `verticalAlign` do wrapper quando `formula.vAlign` existe |
| `packages/export-pdf/src/html.ts` | o mesmo `vertical-align` em `wrapperStyles` |
| `packages/export-docx/src/docx.ts` | `ImageRun` de SVG com `fallback` |
| `apps/playground/src/styles.css` | estilos do modal |
| `portal2-next` + `frequencia-ocorrencia` `CustomToolbar.tsx` | botão de inserir fórmula, espelhado |

Caminhos absolutos:

```
MONO=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
P2=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
FREQ=/Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
```

## A receita do MathJax, já provada

Este bloco foi executado e conferido antes deste plano ser escrito. Use-o
verbatim; cada linha existe por um motivo:

```ts
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
// Import POR EFEITO COLATERAL: é ele que registra os ambientes do ams
// (pmatrix, align...). A lista `packages` abaixo não basta sozinha —
// sem este import, `\begin{pmatrix}` falha com "Unknown environment".
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
```

Saída medida com `fontCache: 'local'`:

| LaTeX | width | height | container style | `<defs>` interno | `<use>` externo | bytes |
| --- | --- | --- | --- | --- | --- | --- |
| `\frac{1}{2}` | `1.795ex` | `2.737ex` | `vertical-align: -0.781ex;` | sim | não | 1459 |
| `\sum_{i=1}^{n} i^2` (display) | `5.412ex` | `6.354ex` | `vertical-align: -2.819ex;` | sim | não | 3998 |

Os oito itens da paleta renderizam sem erro. LaTeX inválido devolve
`data-mjx-error="Missing close brace"` / `"Undefined control sequence \\naoexiste"`.

---

### Task 1: Modelo no core

**Files:**
- Modify: `packages/core/src/types.ts:190-234` (interface `ImageEmbed`), `:238-246` (ao lado de `isImageEmbed`)
- Test: `packages/core/src/__tests__/formulaEmbed.test.ts` (criar)

**Interfaces:**
- Consumes: `isImageEmbed`, já existente.
- Produces:
  - `ImageEmbed["formula"]?: { latex: string; display: boolean; vAlign?: string }`
  - `ImageEmbed["svgFallback"]?: string`
  - `isFormulaEmbed(v: unknown): v is ImageEmbed & { formula: NonNullable<ImageEmbed["formula"]> }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/core/src/__tests__/formulaEmbed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isImageEmbed, isFormulaEmbed, type ImageEmbed } from "../types";

const imagem: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAA",
  width: 10,
  height: 10,
};

const formula: ImageEmbed = {
  type: "image",
  src: "data:image/svg+xml;base64,AAA",
  width: 20,
  height: 12,
  formula: { latex: "\\frac{1}{2}", display: false, vAlign: "-0.781ex" },
  svgFallback: "data:image/png;base64,BBB",
};

describe("isFormulaEmbed", () => {
  it("reconhece embed com campo formula", () => {
    expect(isFormulaEmbed(formula)).toBe(true);
  });

  it("não reconhece imagem comum", () => {
    expect(isFormulaEmbed(imagem)).toBe(false);
  });

  it("não reconhece string nem null", () => {
    expect(isFormulaEmbed("texto")).toBe(false);
    expect(isFormulaEmbed(null)).toBe(false);
  });

  it("uma fórmula CONTINUA sendo um embed de imagem", () => {
    // É o ponto todo do desenho: paginação, clipboard, resize e delete
    // narrowam por isImageEmbed e não podem passar a ignorar fórmula.
    expect(isImageEmbed(formula)).toBe(true);
  });

  it("imagem comum não vira fórmula por ter svgFallback", () => {
    // svgFallback é geral para SVG, não exclusivo de fórmula.
    const svg: ImageEmbed = { ...imagem, svgFallback: "data:image/png;base64,CCC" };
    expect(isFormulaEmbed(svg)).toBe(false);
    expect(isImageEmbed(svg)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/core
npx vitest run src/__tests__/formulaEmbed.test.ts
```

Esperado: FAIL — `isFormulaEmbed is not a function`.

- [ ] **Step 3: Acrescentar os campos e o helper**

Em `packages/core/src/types.ts`, dentro da interface `ImageEmbed`, depois de `captionAlign`:

```ts
  /**
   * Presente ⇒ este embed é uma fórmula. A imagem (`src`) é o RENDER; isto é
   * a fonte. Reabrir o editor de fórmula relê `latex` daqui.
   */
  formula?: {
    /** Fonte da verdade. O que o professor escreveu. */
    latex: string;
    /**
     * Bloco (`\displaystyle`, centrado) em vez de inline. Guardado explícito
     * em vez de derivado de `align === "center"`: derivar acoplaria o modo da
     * fórmula a um campo de layout que o usuário mexe pelos botões de
     * alinhamento da toolbar, e reabrir o modal cairia no modo errado.
     */
    display: boolean;
    /**
     * Alinhamento de base para fórmula inline, no formato que o MathJax
     * devolve (ex.: "-0.781ex"). Aplicado como `vertical-align` no WRAPPER
     * (<figure>) para a fórmula sentar na linha do texto. Ausente quando
     * `display` é true.
     */
    vAlign?: string;
  };
  /**
   * PNG data URL. Só o `export-docx` consome: o `ImageRun` de `type: "svg"`
   * exige um `fallback` raster. Vale para qualquer embed cujo `src` seja SVG —
   * não é exclusivo de fórmula.
   */
  svgFallback?: string;
```

E, logo depois de `isImageEmbed`:

```ts
/**
 * Um embed de fórmula é um embed de IMAGEM que carrega seu LaTeX. Só dois
 * lugares precisam distinguir: a toolbar (trocar "Legenda" por "Editar
 * fórmula") e o duplo clique que reabre o modal. Todo o resto trata como
 * imagem, de propósito.
 */
export function isFormulaEmbed(
  v: unknown,
): v is ImageEmbed & { formula: NonNullable<ImageEmbed["formula"]> } {
  return isImageEmbed(v) && (v as ImageEmbed).formula != null;
}
```

- [ ] **Step 4: Rodar para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/core
npx vitest run && npx tsc --noEmit
```

Esperado: todos passam, `tsc` sem saída.

- [ ] **Step 5: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/core/src/types.ts packages/core/src/__tests__/formulaEmbed.test.ts
git commit -m "feat(core): embed de imagem passa a carregar formula e fallback de svg"
```

---

### Task 2: `@sofereditor/math` — render puro

**Files:**
- Modify: `packages/math/package.json`
- Create: `packages/math/src/render.ts`, `packages/math/src/__tests__/render.test.ts`, `packages/math/tsup.config.ts`
- Modify: `packages/math/src/index.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `renderLatexToSvg(latex: string, display: boolean): FormulaRender`
  - `interface FormulaRender { ok: true; svg: string; widthEx: number; heightEx: number; vAlignEx: number } | { ok: false; error: string }`

- [ ] **Step 1: Preparar o pacote**

Substituir `packages/math/package.json` inteiro por (espelha `packages/core/package.json`, que é o formato dos pacotes publicados deste repo):

```json
{
  "name": "@sofereditor/math",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "module": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "require": "./src/index.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "mathjax-full": "3.2.2"
  },
  "devDependencies": {
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`private: true` sai — o `@sofereditor/react` vai depender dele e é publicado.

Criar `packages/math/tsup.config.ts` copiando `packages/core/tsup.config.ts` e trocando só o que apontar para o core.

Instalar:

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
pnpm install
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `packages/math/src/__tests__/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderLatexToSvg } from "../render";

describe("renderLatexToSvg", () => {
  it("converte LaTeX válido e devolve dimensões em ex", () => {
    const r = renderLatexToSvg("\\frac{1}{2}", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg.startsWith("<svg")).toBe(true);
    expect(r.widthEx).toBeGreaterThan(0);
    expect(r.heightEx).toBeGreaterThan(0);
  });

  it("O SVG É AUTO-CONTIDO — este é o teste que mais importa", () => {
    // fontCache 'global' (o padrão do MathJax) põe os glifos num <defs> FORA
    // do SVG. O preview funcionaria e o documento salvo, o PDF e o DOCX
    // sairiam EM BRANCO. Este teste é o único guardrail contra isso.
    const r = renderLatexToSvg("\\sum_{i=1}^{n} i^2", true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("<defs>");
    // Nenhum <use> apontando para fora do próprio SVG.
    const usesExternos = /<use[^>]*(?:xlink:)?href="#(?!MJX-)/.test(r.svg);
    expect(usesExternos).toBe(false);
  });

  it("fórmula inline devolve vAlignEx negativo (desce abaixo da base)", () => {
    const r = renderLatexToSvg("\\frac{1}{2}", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vAlignEx).toBeLessThan(0);
  });

  it("display muda o resultado em relação ao inline", () => {
    const inline = renderLatexToSvg("\\sum_{i=1}^{n} i", false);
    const bloco = renderLatexToSvg("\\sum_{i=1}^{n} i", true);
    expect(inline.ok && bloco.ok).toBe(true);
    if (!inline.ok || !bloco.ok) return;
    // Em display os limites vão acima/abaixo do sigma: fica mais alto e mais estreito.
    expect(bloco.heightEx).toBeGreaterThan(inline.heightEx);
  });

  it("os oito itens da paleta renderizam sem erro", () => {
    const paleta = [
      "\\frac{1}{2}",
      "x^{2}",
      "a_{n}",
      "\\sqrt{x}",
      "\\sqrt[3]{x}",
      "\\sum_{i=1}^{n} i",
      "\\int_{0}^{1} x dx",
      "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
    ];
    for (const tex of paleta) {
      expect(renderLatexToSvg(tex, false).ok, tex).toBe(true);
    }
  });

  it("LaTeX inválido devolve ok:false com a mensagem do MathJax", () => {
    const r = renderLatexToSvg("\\frac{1}{", false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Missing close brace");
  });

  it("macro desconhecida também é erro, não silêncio", () => {
    const r = renderLatexToSvg("\\naoexiste{x}", false);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/math
npx vitest run
```

Esperado: FAIL — `Failed to resolve import "../render"`.

- [ ] **Step 4: Escrever o renderer**

Criar `packages/math/src/render.ts`:

```ts
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
```

E `packages/math/src/index.ts`:

```ts
export { renderLatexToSvg, type FormulaRender } from "./render";
```

- [ ] **Step 5: Rodar para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/math
npx vitest run && npx tsc --noEmit
```

Esperado: 7 testes passando, `tsc` sem saída. Se `tsc` reclamar de tipos do
`mathjax-full`, acrescentar `"skipLibCheck": true` ao `packages/math/tsconfig.json`
— o `mathjax-full` publica tipos que não passam em `strict` e isso não é
trabalho desta task.

- [ ] **Step 6: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/math pnpm-lock.yaml
git commit -m "feat(math): renderiza LaTeX em SVG auto-contido com MathJax"
```

---

### Task 3: Alinhamento de base no editor e no HTML de servidor

**Files:**
- Modify: `packages/react/src/renderInline.tsx:195-205` (caso `inline` sem `align`)
- Modify: `packages/export-pdf/src/html.ts:388-394` (o mesmo caso)
- Test: `packages/react/src/__tests__/parity.test.tsx` (acrescentar caso)

**Interfaces:**
- Consumes: `ImageEmbed["formula"]` da Task 1.
- Produces: nada para tasks seguintes.

**Por que os dois arquivos:** `html.ts` NÃO serializa o DOM do editor — ele
gera HTML a partir do modelo, montando o próprio array de estilos. `parity.test.tsx`
compara os dois caminhos declaração a declaração. Mexer num só quebra o teste,
e com razão: é o guardrail da fidelidade editor↔exportações.

**Onde exatamente:** nos dois arquivos o `vertical-align` já existe, com valor
fixo `text-bottom`, no caso `inline` **sem** `align`, e está no **wrapper**
(`<figure>` / `wrapperStyles`), não no `<img>`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `packages/react/src/__tests__/parity.test.tsx`:

```tsx
describe("fórmula inline", () => {
  const formulaOp: DeltaOp[] = [
    {
      insert: {
        type: "image",
        src: "data:image/svg+xml;base64,AAA",
        width: 20,
        height: 12,
        formula: { latex: "\\frac{1}{2}", display: false, vAlign: "-0.781ex" },
      },
    },
  ];

  it("aplica o vertical-align da fórmula no lugar do text-bottom", () => {
    const editor = editorHtml(formulaOp);
    expect(editor).toContain("vertical-align:-0.781ex");
    expect(editor).not.toContain("text-bottom");
  });

  it("editor e HTML de servidor emitem as MESMAS declarações", () => {
    // Sem isto, a fórmula sentaria na base na tela e flutuaria no topo no PDF.
    expect(decls(editorHtml(formulaOp))).toEqual(decls(serverHtml(formulaOp)));
  });

  it("imagem comum continua com text-bottom", () => {
    const imagem: DeltaOp[] = [
      { insert: { type: "image", src: "data:image/png;base64,AAA", width: 20, height: 12 } },
    ];
    expect(editorHtml(imagem)).toContain("text-bottom");
    expect(decls(editorHtml(imagem))).toEqual(decls(serverHtml(imagem)));
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/parity.test.tsx
```

Esperado: FAIL — o editor emite `text-bottom` e não `-0.781ex`.

- [ ] **Step 3: Trocar nos dois lugares**

Em `packages/react/src/renderInline.tsx`, no caso `inline` sem `align`:

```tsx
        : {
            display: "inline-block",
            // Fórmula inline traz o deslocamento de base que o MathJax mediu;
            // sem ele a fórmula flutua no topo da linha em vez de sentar nela.
            verticalAlign: embed.formula?.vAlign ?? "text-bottom",
            width: embed.width,
          };
```

Em `packages/export-pdf/src/html.ts`, no mesmo caso:

```ts
      } else {
        wrapperStyles.push(
          "display:inline-block",
          // Espelha renderInline.tsx — parity.test.tsx trava a igualdade.
          `vertical-align:${embed.formula?.vAlign ?? "text-bottom"}`,
          `width:${embed.width}px`,
        );
      }
```

- [ ] **Step 4: Rodar para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
(cd packages/react && npx vitest run && npx tsc --noEmit)
(cd packages/export-pdf && npx vitest run && npx tsc --noEmit)
```

Esperado: tudo passa. A suíte inteira do `react` tem que continuar verde —
`printSnapshot.test.ts` e os testes de imagem tocam o mesmo código.

- [ ] **Step 5: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/renderInline.tsx packages/react/src/__tests__/parity.test.tsx packages/export-pdf/src/html.ts
git commit -m "feat(react,pdf): formula inline senta na linha de base nos dois caminhos"
```

---

### Task 4: Modal da fórmula

**Files:**
- Create: `packages/react/src/formulaSnippet.ts`, `packages/react/src/FormulaDialog.tsx`
- Create: `packages/react/src/__tests__/formulaSnippet.test.ts`
- Modify: `packages/react/src/index.ts` (exportar `FormulaDialog`)

**Só o helper tem teste unitário.** O `FormulaDialog` depende do contexto do
editor e do `import()` dinâmico do MathJax — render estática testaria a casca e
não o que pode quebrar. O gate dele é o roteiro de navegador da Task 5. A lógica
que dá para errar de verdade (onde o cursor cai depois de clicar na paleta) mora
no helper puro, de propósito.

**Interfaces:**
- Consumes: o **tipo** `FormulaRender` de `@sofereditor/math` (Task 2) e a
  função `renderLatexToSvg` por `import()` dinâmico em tempo de execução.
- Produces:
  - `PALETA: readonly { label: string; snippet: string }[]`
  - `applySnippet(text: string, selStart: number, selEnd: number, snippet: string): { text: string; cursor: number }`
  - `FormulaDialog(): JSX.Element | null`

`FormulaDialog` lê `formulaRequest` / `resolveFormulaRequest` do contexto — que
a Task 5 acrescenta.

- [ ] **Step 1: Escrever o teste do helper puro**

Criar `packages/react/src/__tests__/formulaSnippet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applySnippet, PALETA } from "../formulaSnippet";

describe("PALETA", () => {
  it("tem os oito itens, com os rótulos exatos", () => {
    expect(PALETA.map((p) => p.label)).toEqual([
      "Fração",
      "Expoente",
      "Índice",
      "Raiz",
      "Raiz n-ésima",
      "Somatório",
      "Integral",
      "Matriz 2×2",
    ]);
  });
});

describe("applySnippet", () => {
  it("insere na posição do cursor", () => {
    const r = applySnippet("ab", 1, 1, "\\frac{}{}");
    expect(r.text).toBe("a\\frac{}{}b");
  });

  it("põe o cursor DENTRO do primeiro par de chaves vazio", () => {
    // Sem isto o professor clica em "Fração" e tem que caçar onde digitar.
    const r = applySnippet("", 0, 0, "\\frac{}{}");
    expect(r.text).toBe("\\frac{}{}");
    expect(r.cursor).toBe("\\frac{".length);
  });

  it("substitui a seleção em vez de duplicar", () => {
    const r = applySnippet("axb", 1, 2, "\\sqrt{}");
    expect(r.text).toBe("a\\sqrt{}b");
  });

  it("snippet sem chaves vazias põe o cursor no fim do inserido", () => {
    const r = applySnippet("", 0, 0, "\\infty");
    expect(r.cursor).toBe("\\infty".length);
  });

  it("acha o primeiro {} mesmo quando o snippet tem colchetes antes", () => {
    const r = applySnippet("", 0, 0, "\\sqrt[]{}");
    expect(r.cursor).toBe("\\sqrt[]{".length);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/formulaSnippet.test.ts
```

Esperado: FAIL — `Failed to resolve import "../formulaSnippet"`.

- [ ] **Step 3: Escrever o helper**

Criar `packages/react/src/formulaSnippet.ts`:

```ts
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
```

- [ ] **Step 4: Rodar para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx vitest run src/__tests__/formulaSnippet.test.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 5: Escrever o modal**

Criar `packages/react/src/FormulaDialog.tsx`:

**O import do MathJax é DINÂMICO, e isto não é detalhe.** O spec proíbe import
estático em letras maiúsculas: `@sofereditor/math` puxa `mathjax-full`, e um
`import` no topo o joga no bundle principal — todo professor que abre uma prova
só para ler pagaria ~1,5MB. O modal carrega o módulo quando abre; o
`insertFormula` da Task 5 faz o mesmo, e como já é `async`, sai de graça.

```tsx
import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import type { FormulaRender } from "@sofereditor/math";
import { useEditorContext } from "./EditorContext";
import { DIALOG_CENTER_STYLE } from "./dialogCenterStyle";
import { PALETA, applySnippet } from "./formulaSnippet";

/**
 * Modal de fórmula. Espelha `ImageCaptionDialog` — dirigido por
 * `editor.formulaRequest`.
 *
 * O preview usa o MESMO renderer que a inserção vai usar. Se o preview falha,
 * o botão de inserir fica desabilitado: nunca inserir um embed cujo render
 * falhou, senão entra no documento um <img> quebrado.
 */
export function FormulaDialog(): JSX.Element | null {
  const { formulaRequest, resolveFormulaRequest } = useEditorContext();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [latex, setLatex] = useState("");
  const [display, setDisplay] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (formulaRequest) {
      setLatex(formulaRequest.initialLatex);
      setDisplay(formulaRequest.initialDisplay);
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => inputRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
  }, [formulaRequest]);

  // O renderer chega por import dinâmico quando o modal abre. Fica em ref, não
  // em state: trocá-lo não precisa re-renderizar, quem re-renderiza é o preview.
  const rendererRef = useRef<((l: string, d: boolean) => FormulaRender) | null>(null);
  const [preview, setPreview] = useState<FormulaRender | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!formulaRequest || rendererRef.current) return;
    setCarregando(true);
    // Import DINÂMICO: mantém o mathjax-full fora do bundle principal.
    void import("@sofereditor/math").then((m) => {
      rendererRef.current = m.renderLatexToSvg;
      setCarregando(false);
    });
  }, [formulaRequest]);

  // Sem debounce: o render é síncrono e leva menos de um milissegundo para as
  // fórmulas desta paleta, depois que o módulo já carregou.
  useEffect(() => {
    const render = rendererRef.current;
    if (!render || !latex.trim()) {
      setPreview(null);
      return;
    }
    setPreview(render(latex, display));
  }, [latex, display, carregando]);

  if (!formulaRequest) return null;

  const podeInserir = preview?.ok === true;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!podeInserir) return;
    resolveFormulaRequest({ latex, display });
  };
  const onCancel = () => resolveFormulaRequest(null);

  const onPaleta = (snippet: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? latex.length;
    const end = el?.selectionEnd ?? latex.length;
    const r = applySnippet(latex, start, end, snippet);
    setLatex(r.text);
    queueMicrotask(() => {
      el?.focus();
      el?.setSelectionRange(r.cursor, r.cursor);
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="ed-formula-dialog ed-link-dialog"
      style={DIALOG_CENTER_STYLE}
      onClose={onCancel}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={onSubmit} className="ed-formula-form">
        <div className="ed-formula-paleta">
          {PALETA.map((p) => (
            <button
              key={p.label}
              type="button"
              className="ed-formula-paleta-btn"
              title={p.label}
              onClick={() => onPaleta(p.snippet)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          ref={inputRef}
          className="ed-formula-input"
          rows={3}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          aria-label="Fórmula em LaTeX"
          placeholder="\frac{1}{2}"
        />
        <label className="ed-formula-display">
          <input
            type="checkbox"
            checked={display}
            onChange={(e) => setDisplay(e.target.checked)}
          />
          Fórmula em bloco (centralizada, limites acima e abaixo)
        </label>
        <div className="ed-formula-preview" aria-live="polite">
          {carregando ? (
            <span className="ed-formula-vazio">Carregando o renderizador…</span>
          ) : preview == null ? (
            <span className="ed-formula-vazio">O preview aparece aqui.</span>
          ) : preview.ok ? (
            <span
              className="ed-formula-preview-svg"
              // O SVG vem do nosso próprio renderer, não de entrada externa.
              dangerouslySetInnerHTML={{ __html: preview.svg }}
            />
          ) : (
            <span className="ed-formula-erro" role="alert">
              {preview.error}
            </span>
          )}
        </div>
        <div className="ed-formula-acoes">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={!podeInserir}>
            Inserir
          </button>
        </div>
      </form>
    </dialog>
  );
}
```

Exportar em `packages/react/src/index.ts`, junto das outras três:

```ts
export { FormulaDialog } from "./FormulaDialog";
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx tsc --noEmit
```

Esperado: **vai falhar**, por dois motivos, os dois previstos e os dois
fechados pela Task 5:

1. `formulaRequest` / `resolveFormulaRequest` ainda não existem no contexto.
2. `@sofereditor/math` ainda não é dependência do `packages/react`, então nem o
   `import type` nem o `import()` resolvem.

Registrar a saída literal no relatório e seguir. O commit desta task deixa o
pacote sem compilar por exatamente uma task — aceitável porque as duas vão na
mesma branch e a Task 5 é a próxima. **Não** inventar os campos do contexto nem
acrescentar a dependência aqui para "consertar" o typecheck: isso duplicaria
trabalho da Task 5 e mascararia se ela ficasse incompleta.

Confirme que os testes do helper puro continuam passando, que esses não
dependem de nada disso:

```bash
npx vitest run src/__tests__/formulaSnippet.test.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 7: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/formulaSnippet.ts packages/react/src/FormulaDialog.tsx packages/react/src/__tests__/formulaSnippet.test.ts packages/react/src/index.ts
git commit -m "feat(react): modal de formula com paleta e preview"
```

---

### Task 5: Ligação — pedir, gerar e inserir

**Files:**
- Create: `packages/math/src/browser.ts`
- Modify: `packages/math/src/index.ts`
- Modify: `packages/react/src/useEditor.ts` (tipos junto de `ImageCaptionRequest` na linha ~96; estado e callbacks junto de `requestImageCaption` na linha ~779; retorno na linha ~860)
- Modify: `packages/react/src/EditorContext.tsx:18-20`
- Modify: `packages/react/src/Toolbar.tsx` (grupo do botão de imagem, linha ~456)
- Modify: `packages/react/package.json` (dependência `@sofereditor/math`)
- Modify: `apps/playground/src/styles.css`

**Interfaces:**
- Consumes: `renderLatexToSvg` (Task 2), `PALETA`/`FormulaDialog` (Task 4), `isFormulaEmbed` (Task 1), `MAX_INSERT_WIDTH` de `./imageConstraints`.
- Produces:
  - `measureExInPx(root: HTMLElement): number`
  - `svgToPngDataUrl(svg: string, widthPx: number, heightPx: number, scale?: number): Promise<string>`
  - `requestFormula(initialLatex?: string, initialDisplay?: boolean): Promise<FormulaResult | null>`
  - `resolveFormulaRequest(result: FormulaResult | null): void`
  - `interface FormulaResult { latex: string; display: boolean }`
  - `insertFormula(latex: string, display: boolean): Promise<void>`

- [ ] **Step 1: Helpers de browser no pacote math**

Criar `packages/math/src/browser.ts`:

```ts
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
```

Acrescentar a `packages/math/src/index.ts`:

```ts
export { measureExInPx, svgToPngDataUrl, svgToDataUrl } from "./browser";
```

- [ ] **Step 2: Dependência no react**

Em `packages/react/package.json`, acrescentar em `dependencies`:

```json
    "@sofereditor/math": "workspace:*",
```

Depois:

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
pnpm install
```

- [ ] **Step 3: Tipos e plumbing no useEditor**

Em `packages/react/src/useEditor.ts`, junto de `ImageCaptionRequest` (~linha 96):

```ts
export interface FormulaResult {
  latex: string;
  display: boolean;
}

export interface FormulaRequest {
  initialLatex: string;
  initialDisplay: boolean;
  /** Resolve com a fórmula, ou null no cancelamento. */
  resolve: (result: FormulaResult | null) => void;
}
```

Na interface `UseEditorResult`, junto dos outros `request*`:

```ts
  formulaRequest: FormulaRequest | null;
  requestFormula: (
    initialLatex?: string,
    initialDisplay?: boolean,
  ) => Promise<FormulaResult | null>;
  resolveFormulaRequest: (result: FormulaResult | null) => void;
  /** Renderiza o LaTeX, gera SVG + PNG e insere como embed na seleção. */
  insertFormula: (latex: string, display: boolean) => Promise<void>;
```

No corpo, junto de `requestImageCaption` (~linha 779):

```ts
  // ---- Fórmula ----
  const [formulaRequest, setFormulaRequest] = useState<FormulaRequest | null>(null);
  const requestFormula = useCallback(
    (initialLatex = "", initialDisplay = false): Promise<FormulaResult | null> => {
      return new Promise((resolve) => {
        setFormulaRequest({ initialLatex, initialDisplay, resolve });
      });
    },
    [],
  );
  const resolveFormulaRequest = useCallback((result: FormulaResult | null) => {
    setFormulaRequest((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  const insertFormula = useCallback(
    async (latex: string, display: boolean): Promise<void> => {
      // Import DINÂMICO, pelo mesmo motivo do modal: manter o mathjax-full
      // fora do bundle principal. Como esta função já é async, não custa nada.
      const { renderLatexToSvg, measureExInPx, svgToDataUrl, svgToPngDataUrl } =
        await import("@sofereditor/math");
      const r = renderLatexToSvg(latex, display);
      if (!r.ok) return; // o modal já barra isto; aqui é cinto de segurança
      // `useEditor` não tem ref do elemento raiz — conferido. `.ed-root` é o
      // mesmo seletor que TableFloatingToolbar usa para achar a raiz do editor.
      // Medir no <body> daria o font-size do documento HTML, não o do editor.
      const root = document.querySelector<HTMLElement>(".ed-root");
      const exPx = root ? measureExInPx(root) : 8;
      let w = Math.round(r.widthEx * exPx);
      let h = Math.round(r.heightEx * exPx);
      if (w > MAX_INSERT_WIDTH) {
        h = Math.round((h * MAX_INSERT_WIDTH) / w);
        w = MAX_INSERT_WIDTH;
      }
      const src = svgToDataUrl(r.svg);
      let svgFallback: string | undefined;
      try {
        svgFallback = await svgToPngDataUrl(r.svg, w, h);
      } catch {
        // Sem PNG a fórmula ainda entra no documento e sai no PDF; só o DOCX
        // vai pular esse embed, contando em `skipped`. Melhor que não inserir.
        svgFallback = undefined;
      }
      cmdInsertImage(ctxRef.current, {
        type: "image",
        src,
        width: w,
        height: h,
        ...(display ? { align: "center" as const } : {}),
        formula: {
          latex,
          display,
          ...(display ? {} : { vAlign: `${r.vAlignEx}ex` }),
        },
        ...(svgFallback ? { svgFallback } : {}),
      });
    },
    [],
  );
```

Import no topo do arquivo — **só este**, e nenhum de `@sofereditor/math`:

```ts
import { MAX_INSERT_WIDTH } from "./imageConstraints";
```

E no objeto de retorno, junto dos outros:

```ts
    formulaRequest,
    requestFormula,
    resolveFormulaRequest,
    insertFormula,
```

- [ ] **Step 4: Montar o modal**

Em `packages/react/src/EditorContext.tsx`, junto dos outros três:

```tsx
import { FormulaDialog } from "./FormulaDialog";
```
```tsx
      <FormulaDialog />
```

Isto faz os consumidores (`portal2-next`, `frequencia-ocorrencia`) herdarem o
modal sem mudança nenhuma — eles usam `EditorProvider`.

- [ ] **Step 5: Botão na Toolbar**

Em `packages/react/src/Toolbar.tsx`, no `<Group>` do botão de imagem (~linha 456),
depois do `<input type="file" hidden>`:

```tsx
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Inserir fórmula"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            void editor.requestFormula().then((r) => {
              if (r) void editor.insertFormula(r.latex, r.display);
            });
          }}
        >
          √x
        </button>
```

- [ ] **Step 6: CSS do modal**

Em `apps/playground/src/styles.css`, no fim do arquivo:

```css
/* Modal de fórmula. */
.ed-formula-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 420px;
}
.ed-formula-paleta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.ed-formula-paleta-btn {
  padding: 6px 4px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
.ed-formula-paleta-btn:hover {
  background: #eef0f3;
}
.ed-formula-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  resize: vertical;
}
.ed-formula-display {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.ed-formula-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fafbfc;
}
.ed-formula-vazio {
  font-size: 12px;
  color: var(--muted);
}
.ed-formula-erro {
  font-size: 12px;
  color: #b91c1c;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ed-formula-acoes {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ed-formula-acoes button[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 7: Typecheck e testes**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
(cd packages/react && npx tsc --noEmit && npx vitest run)
(cd packages/math && npx tsc --noEmit && npx vitest run)
```

Esperado: o erro de `formulaRequest` da Task 4 some; tudo verde.

- [ ] **Step 8: Verificar no navegador — no clique de verdade**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
pnpm dev
```

Em `http://localhost:5173`, **clicando de verdade** (não disparar `change` por
script — num input controlado do React o `onChange` é engolido se o `value`
for setado direto):

1. Clicar em `√x` → o modal abre com o campo vazio e o preview dizendo "O preview aparece aqui.".
2. Clicar em "Fração" → o campo mostra `\frac{}{}` e o cursor está **entre as
   duas primeiras chaves**. Digitar `1`, seta direita duas vezes, digitar `2` →
   o preview mostra ½.
3. Apagar tudo e digitar `\frac{1{` → o preview mostra a mensagem de erro em
   vermelho e o botão **Inserir fica desabilitado**.
4. Corrigir para `\frac{1}{2}` → botão reabilita. Clicar em Inserir.
5. **A fórmula aparece no texto, sentada na linha de base** — não flutuando no
   topo nem afundada. É o teste do `vAlign`. Comparar com o texto ao lado.
6. Marcar "Fórmula em bloco", inserir `\sum_{i=1}^{n} i^2` → sai centralizada,
   com os limites acima e abaixo do sigma.
7. Selecionar a fórmula e arrastar uma alça de canto → redimensiona como
   imagem, sem distorcer. (Confirma que a infra de imagem pegou a fórmula.)
8. Backspace com a fórmula selecionada → apaga. Ctrl+Z → volta.
9. `Export PDF` → a fórmula aparece no PDF, nítida, na mesma posição.
10. **O teste do fontCache:** abrir o console e rodar
    `document.querySelector('img[data-embed="image"]').src` → copiar o data URL,
    abrir numa aba nova. **Os glifos têm que aparecer.** Se abrir em branco, o
    `fontCache` está errado e nada mais importa.
11. **O teste do bundle:** com a aba de rede aberta e o filtro em JS, recarregar
    a página e conferir que **nenhum chunk grande carrega antes** de clicar em
    `√x`. Ao clicar, um chunk de ~1,5MB aparece. Se ele já estiver lá no load,
    algum import estático de `@sofereditor/math` escapou e o custo caiu em cima
    de quem só abre a prova para ler — é o risco número três do spec.

- [ ] **Step 9: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/math packages/react apps/playground/src/styles.css pnpm-lock.yaml
git commit -m "feat(react): inserir formula pela toolbar, com SVG e PNG guardados no embed"
```

---

### Task 6: SVG no DOCX com fallback

**Files:**
- Modify: `packages/export-docx/src/docx.ts:485-498` (`buildImageRun`), `:585-596` (o skip)
- Test: `packages/export-docx/src/__tests__/docx.test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `ImageEmbed["svgFallback"]` da Task 1.
- Produces: nada para tasks seguintes.

- [ ] **Step 1: Escrever os testes que falham**

A API já usada pelo arquivo (conferida): `documentToDocxBuffer(doc)` devolve
`{ buffer, skippedImages }`, e `doc` é um `LegacySerializedDocument`, que é um
**array de blocos** — não um objeto com `blocks`. `PNG_1PX` já existe no
arquivo. Acrescentar ao fim de `packages/export-docx/src/__tests__/docx.test.ts`:

```ts
describe("SVG no DOCX", () => {
  const SVG_SRC =
    "data:image/svg+xml;base64," +
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>").toString("base64");

  const docComSvg = (svgFallback?: string): LegacySerializedDocument => [
    {
      type: "paragraph",
      text: "",
      attrs: {},
      delta: [
        {
          insert: {
            type: "image",
            src: SVG_SRC,
            width: 20,
            height: 12,
            ...(svgFallback ? { svgFallback } : {}),
          },
        },
      ],
    },
  ];

  it("SVG COM fallback entra no documento", async () => {
    // Antes desta mudança o export descartava TODO svg silenciosamente —
    // um defeito que já existia, independente de fórmulas.
    const { skippedImages } = await documentToDocxBuffer(docComSvg(PNG_1PX));
    expect(skippedImages).toBe(0);
  });

  it("SVG SEM fallback continua pulado — não inventamos raster no servidor", async () => {
    const { skippedImages } = await documentToDocxBuffer(docComSvg());
    expect(skippedImages).toBe(1);
  });

  it("PNG comum não mudou de comportamento", async () => {
    const doc: LegacySerializedDocument = [
      {
        type: "paragraph",
        text: "",
        attrs: {},
        delta: [{ insert: { type: "image", src: PNG_1PX, width: 10, height: 10 } }],
      },
    ];
    const { skippedImages } = await documentToDocxBuffer(doc);
    expect(skippedImages).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/export-docx
npx vitest run
```

Esperado: o primeiro caso falha com `skipped === 1`.

- [ ] **Step 3: Levar o fallback até o ImageRun**

**A decisão tem que ficar em `resolveAllImages`, não em `makeImageRun`.**
`skipped` é contado uma única vez, em `resolveAllImages:600-607`, testando
`!images.get(op.insert.src)`. Um `null` devolvido depois por `makeImageRun`
**não** é contado — o embed sumiria do DOCX sem aparecer em `skippedImages`,
que é pior que o defeito atual. O `svgFallback` é campo do embed e o mapa é
por `src`, então é preciso colhê-lo no mesmo passo em que os `src` são
colhidos.

Em `resolveAllImages` (linha ~574), trocar o `collect` para colher os dois:

```ts
  const srcs = new Set<string>();
  // svgFallback é campo do EMBED e o mapa de resolução é por SRC. Colher no
  // mesmo passo evita um segundo percurso do documento. Dois embeds com o
  // mesmo src e fallbacks diferentes é caso que não existe na prática (o src
  // é o próprio conteúdo em data URL); o primeiro ganha.
  const fallbacks = new Map<string, string>();
  const collect = (delta: DeltaOp[]) => {
    for (const op of delta) {
      if (!isImageEmbed(op.insert)) continue;
      srcs.add(op.insert.src);
      const fb = op.insert.svgFallback;
      if (fb && !fallbacks.has(op.insert.src)) fallbacks.set(op.insert.src, fb);
    }
  };
```

E trocar o descarte incondicional (linha ~591-595) por:

```ts
      // SVG deixa de ser descartado: o ImageRun aceita `type: "svg"` desde que
      // receba um `fallback` raster. Quem tem `svgFallback` passa; quem não
      // tem continua sendo pulado AQUI, para que `skipped` conte certo — não
      // inventamos um raster no servidor.
      if (resolved?.type === "svg" && !fallbacks.has(src)) resolved = null;
```

Em `makeImageRun` (linha ~484), o ramo de SVG. A função precisa do fallback
decodificado, então acrescente um terceiro parâmetro e repasse-o de quem
chama:

```ts
function makeImageRun(
  embed: ImageEmbed,
  images: Map<string, ResolvedImage | null>,
): ImageRun | null {
  const resolved = images.get(embed.src);
  if (!resolved) return null;
  if (resolved.type === "svg") {
    // resolveAllImages só deixa svg resolvido quando há fallback, então este
    // decode não falha; o guarda existe porque o tipo é opcional.
    const fb = embed.svgFallback ? decodeDataUrl(embed.svgFallback) : null;
    if (!fb) return null;
    return new ImageRun({
      type: "svg",
      data: resolved.data,
      fallback: { type: fb.kind, data: fb.bytes },
      transformation: {
        width: Math.max(1, Math.round(embed.width)),
        height: Math.max(1, Math.round(embed.height)),
      },
    } as ConstructorParameters<typeof ImageRun>[0]);
  }
  return new ImageRun({
    data: resolved.data,
    type: resolved.type,
    transformation: {
      width: Math.max(1, Math.round(embed.width)),
      height: Math.max(1, Math.round(embed.height)),
    },
  } as ConstructorParameters<typeof ImageRun>[0]);
}
```

`decodeDataUrl` é a função já existente no arquivo (linha ~506) que casa
`^data:image/(png|jpe?g|gif|bmp|svg\+xml);base64,` e devolve `{ bytes, kind }`.
Confirme o nome exato dela antes de usar — se o nome real for outro, use o
real; a lógica é a mesma.

- [ ] **Step 4: Rodar para ver passar**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/export-docx
npx vitest run && npx tsc --noEmit
```

Esperado: tudo verde. A suíte existente do `export-docx` tem que continuar
passando — imagens PNG/JPG não podem ter mudado de comportamento.

- [ ] **Step 5: Verificar num DOCX de verdade**

Abrir o playground, inserir uma fórmula, clicar em `Export DOCX`, abrir o
arquivo no Word ou no LibreOffice. **A fórmula tem que aparecer.** Se aparecer
em branco, o `fontCache` está errado (mesmo defeito do Step 8.10 da Task 5).

- [ ] **Step 6: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/export-docx
git commit -m "fix(docx): SVG deixa de ser descartado, entra com fallback raster"
```

---

### Task 7: Editar fórmula já inserida

**Files:**
- Modify: `packages/react/src/Editor.tsx:380-410` (junto do `pointerdown` que seleciona embed)
- Modify: `packages/react/src/Toolbar.tsx:475-515` (grupo do embed selecionado)

**Interfaces:**
- Consumes: `isFormulaEmbed` (Task 1), `requestFormula` / `insertFormula` (Task 5), `getSelectedEmbed` (já existente).
- Produces: nada.

- [ ] **Step 1: Duplo clique reabre o modal**

Em `packages/react/src/Editor.tsx`, depois do `useEffect` do `pointerdown` que
seleciona embed (linha ~409), acrescentar:

```tsx
  // Duplo clique numa fórmula reabre o modal com o LaTeX guardado. Em imagem
  // comum não faz nada — `isFormulaEmbed` é o que separa os dois.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onDoubleClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('img[data-embed="image"]')) return;
      const ed = ctxRef.current;
      const sel = ed.getSelectedEmbed();
      if (!sel || !isFormulaEmbed(sel.embed)) return;
      e.preventDefault();
      const { latex, display } = sel.embed.formula;
      void ed.requestFormula(latex, display).then((r) => {
        if (!r) return;
        // Substituir = apagar o embed antigo e inserir o novo na mesma posição.
        // A seleção ainda cobre o embed, então insertFormula sobrescreve.
        void ed.insertFormula(r.latex, r.display);
      });
    };
    root.addEventListener("dblclick", onDoubleClick);
    return () => root.removeEventListener("dblclick", onDoubleClick);
  }, []);
```

Import de `isFormulaEmbed` de `@sofereditor/core` no topo.

**Sobre a substituição:** `insertImage` (`core/commands.ts:1800-1806`) já faz
`deleteRange` quando a seleção não está colapsada. Com o embed selecionado (um
range de largura 1), o antigo é apagado e o novo entra no lugar — sem código
extra. Confirmar no navegador que é isso mesmo que acontece; se o antigo
sobrar, é aqui que está o defeito.

- [ ] **Step 2: Botão "Editar fórmula" no lugar de "Legenda"**

Em `packages/react/src/Toolbar.tsx`, no bloco `{selectedEmbed && (<Group>...)}`,
trocar o botão "Legenda" por um condicional:

```tsx
          {isFormulaEmbed(selectedEmbed.embed) ? (
            <button
              type="button"
              className="ed-toolbar-btn"
              title="Editar fórmula"
              onMouseDown={stop}
              onClick={(e) => {
                e.preventDefault();
                const f = selectedEmbed.embed.formula;
                if (!f) return;
                void editor.requestFormula(f.latex, f.display).then((r) => {
                  if (r) void editor.insertFormula(r.latex, r.display);
                });
              }}
            >
              Editar fórmula
            </button>
          ) : (
            <button
              type="button"
              className="ed-toolbar-btn"
              title="Legenda da imagem"
              aria-pressed={!!selectedEmbed.embed.caption}
              onMouseDown={stop}
              onClick={(e) => {
                /* … o corpo do botão Legenda existente, sem mudança … */
              }}
            >
              Legenda
            </button>
          )}
```

Copiar o corpo do `onClick` do botão "Legenda" atual verbatim para o ramo
`else` — não reescrever.

- [ ] **Step 3: Typecheck e testes**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo/packages/react
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 4: Verificar no navegador**

1. Inserir `\frac{1}{2}`. Dar **duplo clique** nela → o modal reabre **com
   `\frac{1}{2}` no campo**, não vazio.
2. Trocar para `\frac{3}{4}` e Inserir → a fórmula no texto vira ¾ e **não
   sobrou a antiga ao lado**.
3. Selecionar a fórmula com um clique → a toolbar mostra **"Editar fórmula"**,
   não "Legenda".
4. Inserir uma imagem comum e selecioná-la → a toolbar mostra **"Legenda"**, e
   duplo clique nela **não** abre o modal de fórmula.
5. Inserir uma fórmula de bloco, dar duplo clique → o checkbox "Fórmula em
   bloco" vem **marcado**.

- [ ] **Step 5: Commit**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo
git add packages/react/src/Editor.tsx packages/react/src/Toolbar.tsx
git commit -m "feat(react): duplo clique e botao da toolbar reabrem a formula"
```

---

### Task 8: Botão nos dois consumidores

**Files:**
- Modify: `portal2-next/src/components/ProvaEditor/CustomToolbar.tsx`
- Modify: `portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx`

**Interfaces:**
- Consumes: `requestFormula` / `insertFormula` (Task 5).
- Produces: nada.

**O modal não precisa ser montado.** `EditorProvider` já monta `FormulaDialog`
(Task 5, Step 4), e os dois apps usam `EditorProvider`. Só falta o botão.

- [ ] **Step 1: Botão na CustomToolbar do portal2-next**

Junto do botão de imagem (`FaImage`), acrescentar. Ícone: `TbMath` de
`react-icons/tb` — confirmar que existe antes de usar com
`grep -c "TbMath\b" node_modules/react-icons/tb/index.d.ts`; se não existir,
usar `TbSquareRoot2`, e se esse também não existir, o texto `√x` num
`<Button>` comum.

```tsx
              <Button
                isIconOnly
                size="sm"
                variant="light"
                disableRipple
                disableAnimation
                title="Inserir fórmula"
                aria-label="Inserir fórmula"
                onPress={() => {
                  void editor().requestFormula().then((r) => {
                    if (r) void editor().insertFormula(r.latex, r.display);
                  });
                }}
              >
                <TbMath />
              </Button>
```

Ajustar `editor()` para o acessor que a região do arquivo já usa (o arquivo
usa `editorRef.current` em alguns pontos e um helper `editor()` em outros —
copiar o do vizinho imediato, não misturar).

- [ ] **Step 2: Typecheck**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
./node_modules/.bin/tsc --noEmit
```

Critério: nenhum erro novo em `CustomToolbar.tsx`. O projeto tem ~25 erros
pré-existentes em outros arquivos (evolucional, vestibular,
calc-average-duolingo, use-week-licoesdadas, reunioes, useCoordenadorStore) —
não são desta task, não consertar.

- [ ] **Step 3: Espelhar no frequencia-ocorrencia**

Os dois `CustomToolbar.tsx` divergem em **uma linha só**, a do `as any` num
cast de `level`. Copiar e reverter só ela:

```bash
cp /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/CustomToolbar.tsx \
   /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx

cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
perl -pi -e 's/\Qopt.level !== undefined ? ({ level: opt.level } as any) : undefined,\E/opt.level !== undefined ? { level: opt.level } : undefined,/' \
  src/components/ProvaEditor/CustomToolbar.tsx
```

- [ ] **Step 4: Confirmar o invariante**

```bash
diff /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next/src/components/ProvaEditor/CustomToolbar.tsx \
     /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx
```

Esperado: **exatamente um hunk**, o do `as any`. Zero hunks = o `perl` não
casou e o `as any` vazou para o app errado — **PARAR e reportar BLOCKED**.

- [ ] **Step 5: Build do freq**

Este app não tem `tsc` local; `vite build` é a verificação disponível.

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores/frequencia-ocorrencia
npm run build
```

- [ ] **Step 6: Commits**

```bash
cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal2-next
git add src/components/ProvaEditor/CustomToolbar.tsx
git commit -m "feat(prova): botao de inserir formula na barra principal"

cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/portal-professores
git add frequencia-ocorrencia/src/components/ProvaEditor/CustomToolbar.tsx
git commit -m "feat(prova): espelha o botao de inserir formula"
```

**Atenção:** a raiz do repo git do freq é `portal-professores` (o app está num
subdiretório), e `git status` ali pode mostrar um `.claude/scheduled_tasks.lock`
deletado, alheio a este trabalho — **não** incluir no commit.

---

## Ordem e dependências

```
Task 1 (modelo core)
   ├─> Task 2 (math: render)  ─┐
   ├─> Task 3 (vAlign + parity) │
   └─> Task 6 (docx fallback)   │
                                │
Task 2 ─> Task 4 (modal) ───────┴─> Task 5 (ligação + navegador)
                                        └─> Task 7 (editar)
                                                └─> Task 8 (consumidores)
```

Tasks 3 e 6 são independentes de 4/5/7 e podem ir a qualquer momento depois da
1. A Task 4 deixa o `packages/react` sem compilar por uma task, de propósito —
a Task 5 fecha.

## Onde este plano difere do spec, e por quê

O spec foi escrito antes de eu executar o MathJax. Três pontos mudaram, todos
para melhor, e todos medidos:

1. **O spec dizia "renderizar num `<div>` fora da tela e ler
   `getBoundingClientRect()`".** O plano usa `liteAdaptor`, que não toca o DOM
   — o renderer vira puro e testável em vitest, e a conversão `ex`→px sai de
   medir `1ex` uma vez. Melhor separação e cobertura de teste que o spec previa.
2. **O spec dizia que o `vertical-align` vai no `<img>`.** Vai no **wrapper**
   (`<figure>` / `wrapperStyles`) — é onde o `text-bottom` já mora nos dois
   caminhos de render.
3. **O spec dizia que os consumidores precisam montar o `FormulaDialog`.** Não
   precisam: `EditorProvider` monta os modais, e os dois apps o usam. Só o
   botão da toolbar é trabalho deles.
