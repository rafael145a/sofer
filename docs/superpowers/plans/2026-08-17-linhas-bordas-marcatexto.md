# Linhas de resposta, bordas de tabela e marca-texto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar três features de autoria de prova no editor Sofer — marca-texto (mark `highlight`), linhas de resposta (lacuna inline `___` + parágrafos pautados), e presets de borda de tabela — com fidelidade idêntica entre editor, PDF e `.docx`.

**Architecture:** Toda lógica de decoração nova é uma função **pura em `@sofereditor/core`**, consumida pelos dois renderizadores (`react/src/NodeView.tsx` + `renderInline.tsx` e `export-pdf/src/html.ts`). Nenhuma feature depende de CSS do consumidor: os estilos saem **inline do renderizador**, seguindo a convenção que o pacote já usa (`LINK_STYLE`, `cellStyle`).

**Tech Stack:** TypeScript, Y.js, React 18, vitest, `docx` (npm), pnpm workspaces.

## Global Constraints

- Spec de origem: `docs/superpowers/specs/2026-08-17-linhas-bordas-marcatexto-design.md`.
- **Nada é publicado** (ambiente de teste ou npm) sem autorização explícita do usuário após a avaliação dele.
- **Presets de borda mudam apenas `border-color`, nunca `border-width`.** Toda célula mantém 1px nos quatro lados em todos os presets. Geometria invariante ⇒ paginação não se mexe.
- Fonte padrão da escola é Arial; nenhuma task introduz seleção de fonte.
- Cor de borda de tabela em uso hoje: `#cbd5e1` (`apps/playground/src/styles.css:419`, `export-pdf/src/html.ts:476`).
- Corrida mínima de underlines que vira lacuna: **3**.
- `answerLineSpacing` aceita exatamente `1 | 1.5 | 2`.
- `insertAnswerLines` limita `count` a 1..50.
- Testes rodam com `pnpm --filter @sofereditor/<pkg> test`. Cada task termina com commit.

## Descoberta que corrige uma premissa do spec

O spec assumia que o PDF é gerado por `export-pdf/src/html.ts`. **Não é.** O caminho principal é `serializePaginatedHtml` (`export-pdf/src/pdf.ts:72`), que **clona o DOM paginado vivo do editor**. Consequências que valem para todas as tasks:

1. O que o renderizador React emite **é** o PDF. Estilo que vive só no CSS do consumidor (`apps/playground/src/styles.css`) não acompanha o pacote publicado — por isso tudo é **inline**.
2. `documentToHtml` (`html.ts:60`) é o caminho secundário (HTML de servidor a partir de um `SerializedDocument`, **sem paginação**). Precisa ficar em sincronia; cada feature tem teste de paridade.
3. Guias visíveis só na tela usam `var(--ed-guide-color, transparent)`: sem a variável definida, o valor cai em `transparent` e o PDF sai limpo por padrão.

## Estrutura de arquivos

**Criar:**
- `packages/core/src/decorations.ts` — helpers puros de decoração inline e de bloco: `splitUnderscoreRuns`, `BLANK_STYLE`, `answerLineStyle`, `styleToCssText`.
- `packages/core/src/table-borders.ts` — `TableBorderPreset`, `cellBorderColors`, constantes de cor.
- `packages/core/src/__tests__/decorations.test.ts`
- `packages/core/src/__tests__/table-borders.test.ts`
- `packages/core/src/__tests__/answer-lines.test.ts`
- `packages/react/src/__tests__/answerLine.test.ts`
- `packages/react/src/__tests__/blanks.test.tsx`
- `packages/react/src/__tests__/tableBorders.test.ts`
- `packages/export-pdf/src/__tests__/parity.test.ts` — paridade editor↔HTML de servidor para as três features.

**Modificar:**
- `packages/core/src/types.ts` — `MarkName`, `MarkAttrs`, `BlockAttrs`.
- `packages/core/src/marks.ts:14-24` — `ALL_MARKS`.
- `packages/core/src/commands.ts` — `insertAnswerLines`.
- `packages/core/src/index.ts` — exportar os dois módulos novos.
- `packages/react/src/renderInline.tsx:266-318` (`wrap`) e o laço de `renderInline`.
- `packages/react/src/NodeView.tsx:96-116` (`blockAttrsBase`), `132-139` (`cellStyle`), `155-235` (`TableView`).
- `packages/react/src/useEditor.ts` — API `insertAnswerLines`, `setTableBorderPreset`, `getTableBorderPreset`.
- `packages/react/src/Toolbar.tsx:248-264` (grupo de cor), `~566-585` (popover de tabela).
- `packages/export-pdf/src/html.ts:190-284` (`renderTable`, `renderCell`, `renderInline`, `applyMarks`) e o `<style>` em `~434-480`.
- `packages/export-docx/src/docx.ts:~200-215` (parágrafo), `~280-312` (`makeTable`), `~380-416` (`makeTextRun`).
- `packages/import-docx/src/runs.ts:68-108` (`runMarks`), `packages/import-docx/src/paragraphs.ts`, `packages/import-docx/src/tables.ts`.
- `apps/playground/src/styles.css` — `--ed-guide-color` + override de impressão.

---

# FEATURE 3 — Marca-texto (mark `highlight`)

Entregue primeiro: é mecanicamente paralela à mark `color` que já existe e exercita as cinco camadas.

## Task 1: Mark `highlight` no modelo

**Files:**
- Modify: `packages/core/src/types.ts` (`MarkName`, `MarkAttrs`)
- Modify: `packages/core/src/marks.ts:14-24`
- Test: `packages/core/src/__tests__/marks.test.ts`

**Interfaces:**
- Produces: `MarkName` passa a incluir `"highlight"`; `MarkAttrs.highlight?: string`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `packages/core/src/__tests__/marks.test.ts`:

```ts
import { CLEAR_ALL_MARKS, getMarksInRange } from "../marks";

describe("highlight mark", () => {
  it("aparece em CLEAR_ALL_MARKS", () => {
    expect(CLEAR_ALL_MARKS).toHaveProperty("highlight", null);
  });

  it("é lida por getMarksInRange", () => {
    const doc = new Y.Doc();
    const t = doc.getText("t");
    t.insert(0, "abcdef");
    t.format(2, 2, { highlight: "#fff176" });
    expect(getMarksInRange(t, 2, 4)).toEqual({ highlight: "#fff176" });
    expect(getMarksInRange(t, 0, 6).highlight).toBe("mixed");
  });
});
```

O `import * as Y from "yjs"` já existe no topo do arquivo; se não existir, acrescentar.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- marks`
Expected: FAIL — `CLEAR_ALL_MARKS` não tem a chave `highlight`.

- [ ] **Step 3: Implementar**

Em `packages/core/src/types.ts`, no union `MarkName`, acrescentar `| "highlight"` após `"color"`. E em `MarkAttrs`:

```ts
  color?: string;
  /** Cor de fundo do texto (marca-texto). CSS color, ex. "#fff176". */
  highlight?: string;
```

Em `packages/core/src/marks.ts`, dentro de `ALL_MARKS`:

```ts
  color: true,
  highlight: true,
```

`ALL_MARKS` é `Record<MarkName, true>`: o typecheck falha até essa linha existir — é proposital, e é por isso que nenhum outro lugar precisa de lista manual.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test -- marks && pnpm --filter @sofereditor/core typecheck`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/marks.ts packages/core/src/__tests__/marks.test.ts
git commit -m "feat(core): mark highlight (marca-texto)"
```

## Task 2: Renderizar highlight no editor e no HTML de servidor

**Files:**
- Modify: `packages/react/src/renderInline.tsx:275-281`
- Modify: `packages/export-pdf/src/html.ts:271-275`
- Test: `packages/react/src/__tests__/renderInline.test.tsx`, `packages/export-pdf/src/__tests__/html.test.ts`

**Interfaces:**
- Consumes: `MarkAttrs.highlight` da Task 1.

- [ ] **Step 1: Escrever os dois testes que falham**

Em `packages/react/src/__tests__/renderInline.test.tsx`:

```ts
it("aplica highlight como backgroundColor no mesmo span de color/fonte", () => {
  const html = renderToStaticMarkup(
    <>{renderInline([{ insert: "oi", attributes: { highlight: "#fff176" } }], "k")}</>,
  );
  expect(html).toContain("background-color:#fff176");
});
```

Em `packages/export-pdf/src/__tests__/html.test.ts`:

```ts
it("emite background-color para a mark highlight", () => {
  const html = documentToHtmlFragment({
    blocks: [
      { type: "paragraph", text: "oi", delta: [{ insert: "oi", attributes: { highlight: "#fff176" } }], attrs: {} },
    ],
  });
  expect(html).toContain("background-color:#fff176");
});
```

Conferir no topo de cada arquivo de teste quais helpers já estão importados (`renderToStaticMarkup`, `documentToHtmlFragment`) e completar os imports.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/react test -- renderInline && pnpm --filter @sofereditor/export-pdf test -- html`
Expected: FAIL nos dois — a string não aparece.

- [ ] **Step 3: Implementar nos dois renderizadores**

`packages/react/src/renderInline.tsx`, dentro de `wrap()` logo após a linha `if (attrs.color) styleParts.color = attrs.color;`:

```ts
  if (attrs.highlight) styleParts.backgroundColor = attrs.highlight;
```

`packages/export-pdf/src/html.ts`, dentro de `applyMarks()` logo após `if (attrs.color) styles.push(...)`:

```ts
  if (attrs.highlight) styles.push(`background-color:${cssValue(attrs.highlight)}`);
```

Ordem importa: entrar no **mesmo** `<span>` que já carrega `color`/`font-family`/`font-size`, não num span novo — span extra muda a árvore DOM e o teste de paridade da Task 12 compara estrutura.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/react test && pnpm --filter @sofereditor/export-pdf test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/renderInline.tsx packages/export-pdf/src/html.ts packages/react/src/__tests__/renderInline.test.tsx packages/export-pdf/src/__tests__/html.test.ts
git commit -m "feat(render): highlight como background-color no editor e no HTML"
```

## Task 3: Export `.docx` do highlight

**Files:**
- Modify: `packages/export-docx/src/docx.ts:~380-416` (`makeTextRun`, os **dois** sítios de props)
- Test: `packages/export-docx/src/__tests__/docx.test.ts`

**Interfaces:**
- Consumes: `MarkAttrs.highlight`, `cssColorToDocxHex` (`docx.ts:597`), `ShadingType` (já importado, `docx.ts:29`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("emite w:shd para a mark highlight", async () => {
  const buf = await documentToDocxBuffer([
    { type: "paragraph", text: "oi", delta: [{ insert: "oi", attributes: { highlight: "#fff176" } }], attrs: {} },
  ] as LegacySerializedDocument);
  const xml = await documentXml(buf);
  expect(xml).toContain('w:fill="FFF176"');
});

it("não emite w:shd quando não há highlight", async () => {
  const buf = await documentToDocxBuffer([
    { type: "paragraph", text: "oi", delta: [{ insert: "oi" }], attrs: {} },
  ] as LegacySerializedDocument);
  const xml = await documentXml(buf);
  expect(xml).not.toContain("w:shd");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-docx test -- docx`
Expected: FAIL no primeiro teste.

- [ ] **Step 3: Implementar**

`makeTextRun` tem **dois** blocos `new TextRun({...})` quase idênticos (caminho de linha única e caminho multi-linha, que troca `\n` por espaço). Ambos precisam da mudança — se só um for alterado, texto com quebra perde o marca-texto silenciosamente.

Extrair a duplicação primeiro, para não deixar a armadilha para o próximo:

```ts
function runProps(text: string, m: MarkAttrs, defaults: RunDefaults) {
  const fill = cssColorToDocxHex(m.highlight);
  return {
    text,
    bold: m.bold || defaults.bold,
    italics: m.italic || defaults.italics,
    underline: m.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: m.strike,
    color: cssColorToDocxHex(m.color),
    font: m.fontFamily ?? defaults.font,
    size: parseFontSizeToHalfPoints(m.fontSize) ?? defaults.size,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
  };
}

function makeTextRun(text: string, marks: MarkAttrs | undefined, defaults: RunDefaults): TextRun {
  const m = marks ?? {};
  const segments = text.split("\n");
  if (segments.length === 1) return new TextRun(runProps(text, m, defaults));
  return new TextRun(runProps(text.replace(/\n/g, " "), m, defaults));
}
```

Preservar os comentários existentes sobre o tratamento de `\n`.

**Não usar `w:highlight`**: aceita só ~15 valores nomeados e não sobreviveria a uma cor arbitrária do picker.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-docx test`
Expected: PASS (suíte inteira — a extração mexe em todo run).

- [ ] **Step 5: Commit**

```bash
git add packages/export-docx/src/docx.ts packages/export-docx/src/__tests__/docx.test.ts
git commit -m "feat(export-docx): highlight via w:shd em run"
```

## Task 4: Import `.docx` do highlight

**Files:**
- Modify: `packages/import-docx/src/runs.ts:68-108` (`runMarks`)
- Test: `packages/import-docx/src/__tests__/` (seguir o padrão do arquivo de runs existente)

**Interfaces:**
- Consumes: `attr`, `docxHexToCssColor` (já usados em `runMarks`).
- Produces: nenhum símbolo novo exportado.

- [ ] **Step 1: Escrever o teste que falha**

Localizar o teste de runs existente (`ls packages/import-docx/src/__tests__/`) e seguir o padrão dele para montar o XML de entrada. Casos:

```ts
it("lê w:shd de run como highlight", async () => {
  // <w:r><w:rPr><w:shd w:val="clear" w:fill="FFF176"/></w:rPr><w:t>oi</w:t></w:r>
  // esperado: delta[0].attributes.highlight === "#fff176"
});

it("ignora w:shd com fill auto ou ausente", async () => {
  // w:fill="auto" → sem highlight
});

it("lê w:highlight nomeado como highlight", async () => {
  // <w:highlight w:val="yellow"/> → "#ffff00"
  // <w:highlight w:val="none"/>   → sem highlight
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: FAIL — `highlight` indefinido.

- [ ] **Step 3: Implementar**

No `switch (tag)` de `runMarks`, acrescentar dois casos:

```ts
      case "w:shd": {
        const fill = attr(child, "w:fill");
        if (fill && fill.toLowerCase() !== "auto") {
          const css = docxHexToCssColor(fill);
          if (css) m.highlight = css;
        }
        break;
      }
      case "w:highlight": {
        const css = DOCX_HIGHLIGHT_COLORS[(attr(child, "w:val") ?? "").toLowerCase()];
        if (css) m.highlight = css;
        break;
      }
```

E, no topo do arquivo:

```ts
/** Os 15 valores nomeados de `w:highlight` do OOXML. "none" ausente = sem marca. */
const DOCX_HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkblue: "#000080",
  darkcyan: "#008080",
  darkgreen: "#008000",
  darkmagenta: "#800080",
  darkred: "#800000",
  darkyellow: "#808000",
  darkgray: "#808080",
  lightgray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};
```

`w:shd` vem **depois** de `w:highlight` na ordem de leitura do `switch`? Não — a ordem é a dos filhos do XML. Se um run trouxer os dois, o último lido vence. É aceitável: o Word não emite os dois com valores conflitantes.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/import-docx/src/runs.ts packages/import-docx/src/__tests__/
git commit -m "feat(import-docx): w:shd e w:highlight de run viram mark highlight"
```

## Task 5: Toolbar do marca-texto

**Files:**
- Modify: `packages/react/src/Toolbar.tsx:248-264`
- Modify: `apps/playground/src/styles.css` (só se o swatch precisar de regra nova — reaproveitar `.ed-toolbar-swatch`)

**Interfaces:**
- Consumes: `setMark(name, value)` e `removeMark(name)` de `useEditor` — **já são genéricos sobre `MarkName`**, nada a mudar lá.

- [ ] **Step 1: Implementar o controle**

Em `Toolbar.tsx`, junto às leituras existentes (perto da linha 181):

```ts
  const highlightValue = typeof active.highlight === "string" ? active.highlight : "#fff176";
  const onHighlightChange = (e: ChangeEvent<HTMLInputElement>) => {
    setMark("highlight", e.target.value);
  };
```

E, dentro do mesmo `<Group>` da cor de texto (após o botão "Remover cor"):

```tsx
        <label className="ed-toolbar-label">
          <span className="ed-toolbar-swatch" aria-hidden style={{ background: highlightValue }} />
          <input
            type="color"
            value={highlightValue}
            onChange={onHighlightChange}
            onMouseDown={stop}
            aria-label="Marca-texto"
          />
        </label>
        <button
          type="button"
          className="ed-toolbar-btn"
          title="Remover marca-texto"
          onMouseDown={stop}
          onClick={(e) => {
            e.preventDefault();
            removeMark("highlight");
          }}
        >
          ⌫
        </button>
```

- [ ] **Step 2: Verificar no playground**

Run: `pnpm dev`
Verificar manualmente: selecionar texto → escolher cor → o fundo aparece; botão limpar remove; `⌘P` (ou export PDF) mostra o fundo impresso.

- [ ] **Step 3: Rodar a suíte**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/Toolbar.tsx apps/playground/src/styles.css
git commit -m "feat(react): controle de marca-texto na toolbar"
```

---

# FEATURE 1a — Lacuna inline (`___` vira traço contínuo)

## Task 6: Helper puro `splitUnderscoreRuns`

**Files:**
- Create: `packages/core/src/decorations.ts`
- Create: `packages/core/src/__tests__/decorations.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `BLANK_MIN_RUN: 3`
  - `splitUnderscoreRuns(text: string): Array<{ text: string; blank: boolean }>`
  - `BLANK_STYLE: StyleRecord`
  - `type StyleRecord = Record<string, string>`
  - `styleToCssText(style: StyleRecord): string`

- [ ] **Step 1: Escrever o teste que falha**

`packages/core/src/__tests__/decorations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitUnderscoreRuns, styleToCssText, BLANK_STYLE } from "../decorations";

describe("splitUnderscoreRuns", () => {
  it("não segmenta texto sem corrida de 3+", () => {
    expect(splitUnderscoreRuns("a_b__c")).toEqual([{ text: "a_b__c", blank: false }]);
  });

  it("segmenta uma corrida de exatamente 3", () => {
    expect(splitUnderscoreRuns("a___b")).toEqual([
      { text: "a", blank: false },
      { text: "___", blank: true },
      { text: "b", blank: false },
    ]);
  });

  it("preserva o comprimento exato de corridas longas", () => {
    const r = splitUnderscoreRuns("Nome: " + "_".repeat(20));
    expect(r[1].text).toHaveLength(20);
    expect(r[1].blank).toBe(true);
  });

  it("lida com corridas nas bordas e múltiplas corridas", () => {
    expect(splitUnderscoreRuns("___a____")).toEqual([
      { text: "___", blank: true },
      { text: "a", blank: false },
      { text: "____", blank: true },
    ]);
  });

  it("devolve lista vazia para string vazia", () => {
    expect(splitUnderscoreRuns("")).toEqual([]);
  });

  it("soma dos segmentos reconstrói o texto original", () => {
    const src = "a___b_c______d__";
    expect(splitUnderscoreRuns(src).map((s) => s.text).join("")).toBe(src);
  });
});

describe("styleToCssText", () => {
  it("converte camelCase em kebab-case", () => {
    expect(styleToCssText({ borderBottomColor: "red", lineHeight: "2" }))
      .toBe("border-bottom-color:red;line-height:2");
  });

  it("preserva propriedades customizadas -- intactas", () => {
    expect(styleToCssText({ WebkitTextFillColor: "transparent" }))
      .toBe("-webkit-text-fill-color:transparent");
  });
});

describe("BLANK_STYLE", () => {
  it("não carrega nenhuma propriedade que desloque métricas", () => {
    const keys = Object.keys(BLANK_STYLE);
    for (const forbidden of ["display", "padding", "margin", "letterSpacing", "width"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- decorations`
Expected: FAIL — módulo `../decorations` não existe.

- [ ] **Step 3: Implementar**

`packages/core/src/decorations.ts`:

```ts
/**
 * Helpers puros de decoração visual, compartilhados pelos DOIS renderizadores
 * (`@sofereditor/react` e `@sofereditor/export-pdf`). Ficam aqui, e não em cada
 * renderizador, porque decoração divergente entre editor e PDF é exatamente o
 * modo de falha que a fidelidade de impressão do projeto existe para impedir.
 */

/** Estilo CSS em camelCase — compatível com `CSSProperties` do React. */
export type StyleRecord = Record<string, string>;

/** Mínimo de underlines consecutivos que viram lacuna. */
export const BLANK_MIN_RUN = 3;

const BLANK_RE = /_{3,}/g;

/**
 * Segmenta um texto em trechos normais e corridas de `BLANK_MIN_RUN`+ underlines.
 * A concatenação dos segmentos reconstrói o texto original caractere a caractere —
 * invariante obrigatória: os offsets do modelo dependem disso.
 */
export function splitUnderscoreRuns(text: string): Array<{ text: string; blank: boolean }> {
  if (text.length === 0) return [];
  const out: Array<{ text: string; blank: boolean }> = [];
  let last = 0;
  BLANK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLANK_RE.exec(text)) !== null) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), blank: false });
    out.push({ text: match[0], blank: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), blank: false });
  return out;
}

/**
 * Estilo da lacuna. Apaga o GLIFO mas preserva `color` — que é o que pinta o
 * sublinhado. `color: transparent` apagaria os dois.
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
  if (prop.startsWith("--")) return prop;
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
```

Nota sobre `WebkitTextFillColor` → `-webkit-text-fill-color`: `kebab` produz `-webkit-text-fill-color` porque o `W` maiúsculo inicial vira `-w`. É o comportamento desejado e está travado por teste.

Em `packages/core/src/index.ts`, acrescentar:

```ts
export * from "./decorations";
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test -- decorations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/decorations.ts packages/core/src/__tests__/decorations.test.ts packages/core/src/index.ts
git commit -m "feat(core): helpers de decoração (splitUnderscoreRuns, styleToCssText)"
```

## Task 7: Lacuna renderizada no editor

**Files:**
- Modify: `packages/react/src/renderInline.tsx:266-318` (`wrap`)
- Create: `packages/react/src/__tests__/blanks.test.tsx`

**Interfaces:**
- Consumes: `splitUnderscoreRuns`, `BLANK_STYLE` da Task 6.

- [ ] **Step 1: Escrever o teste que falha**

`packages/react/src/__tests__/blanks.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInline } from "../renderInline";

describe("lacuna de underlines", () => {
  it("envolve corridas de 3+ num span de lacuna", () => {
    const html = renderToStaticMarkup(<>{renderInline([{ insert: "Nome: _____" }], "k")}</>);
    expect(html).toContain("-webkit-text-fill-color:transparent");
    expect(html).toContain("text-decoration:underline");
  });

  it("preserva os caracteres literais no DOM (offsets do modelo)", () => {
    const html = renderToStaticMarkup(<>{renderInline([{ insert: "a___b" }], "k")}</>);
    // 3 underlines continuam presentes como texto — dom-bridge soma textContent.
    expect(html.replace(/<[^>]*>/g, "")).toBe("a___b");
  });

  it("não decora 1 ou 2 underlines", () => {
    const html = renderToStaticMarkup(<>{renderInline([{ insert: "a__b" }], "k")}</>);
    expect(html).not.toContain("text-fill-color");
  });

  it("mantém a lacuna DENTRO das marks do run", () => {
    const html = renderToStaticMarkup(
      <>{renderInline([{ insert: "a___", attributes: { bold: true } }], "k")}</>,
    );
    expect(html.indexOf("<strong>")).toBeLessThan(html.indexOf("text-fill-color"));
  });
});
```

Conferir se o pacote `react` já tem `react-dom/server` disponível nos testes (`renderInline.test.tsx` usa o mesmo); se não, seguir o mecanismo que aquele arquivo usa.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/react test -- blanks`
Expected: FAIL — nenhum span de lacuna.

- [ ] **Step 3: Implementar**

Em `renderInline.tsx`, no topo do arquivo acrescentar ao import de `@sofereditor/core`: `splitUnderscoreRuns`, `BLANK_STYLE`.

Substituir a **primeira linha** de `wrap()`:

```ts
function wrap(text: string, attrs?: MarkAttrs): ReactNode {
  let node: ReactNode = decorateBlanks(text);
  if (!attrs) return node;
  // …resto igual
```

E acrescentar, abaixo de `wrap`:

```ts
/**
 * Corridas de 3+ underlines viram um traço contínuo. Os caracteres PERMANECEM
 * no DOM como nós de texto — `dom-bridge` mapeia offset somando
 * `textContent.length`, então dividir a run em sub-spans é seguro, mas
 * introduzir ou remover caracteres NÃO seria.
 */
function decorateBlanks(text: string): ReactNode {
  const segs = splitUnderscoreRuns(text);
  if (segs.length <= 1 && !segs[0]?.blank) return text;
  return segs.map((s, i) =>
    s.blank ? (
      <span key={i} data-blank="true" style={BLANK_STYLE as CSSProperties}>
        {s.text}
      </span>
    ) : (
      <Fragment key={i}>{s.text}</Fragment>
    ),
  );
}
```

`CSSProperties` e `Fragment` já estão importados no arquivo.

A lacuna fica **dentro** dos wrappers de mark (`<strong>`, `<u>`, span de cor) porque `decorateBlanks` roda antes deles — é o que o quarto teste trava.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/react test`
Expected: PASS na suíte inteira, incluindo `dom-bridge.test.ts` (a mudança não deve alterar mapeamento de offsets).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/renderInline.tsx packages/react/src/__tests__/blanks.test.tsx
git commit -m "feat(react): corrida de 3+ underlines vira traço contínuo"
```

## Task 8: Lacuna no HTML de servidor

**Files:**
- Modify: `packages/export-pdf/src/html.ts` (`applyMarks` e o ponto onde o texto é escapado, `renderInline` ~linha 258)
- Test: `packages/export-pdf/src/__tests__/html.test.ts`

**Interfaces:**
- Consumes: `splitUnderscoreRuns`, `BLANK_STYLE`, `styleToCssText` da Task 6.

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("decora corridas de 3+ underlines como lacuna", () => {
  const html = documentToHtmlFragment({
    blocks: [{ type: "paragraph", text: "Nome: _____", delta: [{ insert: "Nome: _____" }], attrs: {} }],
  });
  expect(html).toContain("-webkit-text-fill-color:transparent");
  expect(html.replace(/<[^>]*>/g, "")).toContain("Nome: _____");
});

it("não decora 1 ou 2 underlines", () => {
  const html = documentToHtmlFragment({
    blocks: [{ type: "paragraph", text: "a__b", delta: [{ insert: "a__b" }], attrs: {} }],
  });
  expect(html).not.toContain("text-fill-color");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-pdf test -- html`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `html.ts`, importar de `@sofereditor/core`: `splitUnderscoreRuns`, `BLANK_STYLE`, `styleToCssText`.

Trocar, dentro de `renderInline`, a linha:

```ts
      parts.push(applyMarks(escapeHtml(op.insert), op.attributes));
```

por:

```ts
      parts.push(applyMarks(decorateBlanks(op.insert), op.attributes));
```

E acrescentar, junto de `applyMarks`:

```ts
/**
 * Espelha `decorateBlanks` de `@sofereditor/react`: corridas de 3+ underlines
 * viram traço contínuo, com os caracteres preservados. A segmentação vem do
 * mesmo helper puro em `@sofereditor/core` — se divergir daqui, o teste de
 * paridade quebra.
 */
function decorateBlanks(text: string): string {
  const segs = splitUnderscoreRuns(text);
  if (segs.length <= 1 && !segs[0]?.blank) return escapeHtml(text);
  const css = styleToCssText(BLANK_STYLE);
  return segs
    .map((s) =>
      s.blank
        ? `<span data-blank="true" style="${css}">${escapeHtml(s.text)}</span>`
        : escapeHtml(s.text),
    )
    .join("");
}
```

`applyMarks` recebe HTML já escapado — a assinatura não muda, só o valor passado.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-pdf test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/export-pdf/src/html.ts packages/export-pdf/src/__tests__/html.test.ts
git commit -m "feat(export-pdf): lacuna de underlines no HTML de servidor"
```

---

# FEATURE 1b — Linhas de resposta (parágrafos pautados)

## Task 9: Modelo e comando `insertAnswerLines`

**Files:**
- Modify: `packages/core/src/types.ts` (`BlockAttrs`)
- Modify: `packages/core/src/decorations.ts` (`answerLineStyle`)
- Modify: `packages/core/src/commands.ts`
- Create: `packages/core/src/__tests__/answer-lines.test.ts`

**Interfaces:**
- Produces:
  - `type AnswerLineSpacing = 1 | 1.5 | 2`
  - `BlockAttrs.answerLine?: true`, `BlockAttrs.answerLineSpacing?: AnswerLineSpacing`
  - `answerLineStyle(attrs: BlockAttrs): StyleRecord | undefined`
  - `insertAnswerLines(ctx: CommandContext, count: number, spacing: AnswerLineSpacing): void`
  - `ANSWER_LINE_MAX = 50`

- [ ] **Step 1: Escrever o teste que falha**

`packages/core/src/__tests__/answer-lines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorDocument, createTableBlock } from "../document";
import { insertAnswerLines } from "../commands";
import { answerLineStyle } from "../decorations";
import type { Selection } from "../types";

function ctxFor(doc: EditorDocument) {
  let sel: Selection = {
    anchor: { blockIndex: 0, offset: 0 },
    focus: { blockIndex: 0, offset: 0 },
  };
  return { doc, getSelection: () => sel, setSelection: (s: Selection) => { sel = s; } };
}

describe("insertAnswerLines", () => {
  it("insere N parágrafos pautados depois do bloco focado", () => {
    const doc = new EditorDocument();
    const ctx = ctxFor(doc);
    insertAnswerLines(ctx, 3, 1.5);
    const json = doc.toJSON();
    expect(json.blocks).toHaveLength(4); // 1 original + 3
    for (const b of json.blocks.slice(1)) {
      expect(b.type).toBe("paragraph");
      expect(b.attrs.answerLine).toBe(true);
      expect(b.attrs.answerLineSpacing).toBe(1.5);
      expect(b.text).toBe("");
    }
  });

  it("limita count a 1..50", () => {
    const a = new EditorDocument();
    insertAnswerLines(ctxFor(a), 0, 1);
    expect(a.toJSON().blocks).toHaveLength(2);

    const b = new EditorDocument();
    insertAnswerLines(ctxFor(b), 999, 1);
    expect(b.toJSON().blocks).toHaveLength(51);
  });

  it("coloca o caret na primeira linha inserida", () => {
    const doc = new EditorDocument();
    const ctx = ctxFor(doc);
    insertAnswerLines(ctx, 2, 1);
    expect(ctx.getSelection().focus.blockIndex).toBe(1);
  });

  it("com o caret dentro de uma célula, insere DEPOIS da tabela inteira", () => {
    const doc = new EditorDocument();
    doc.blocks.insert(1, [createTableBlock(2, 2)]);
    let sel: Selection = {
      anchor: { blockIndex: 1, cellIndex: 0, offset: 0 },
      focus: { blockIndex: 1, cellIndex: 0, offset: 0 },
    };
    const ctx = {
      doc,
      getSelection: () => sel,
      setSelection: (s: Selection) => { sel = s; },
    };
    insertAnswerLines(ctx, 2, 1);
    const json = doc.toJSON();
    expect(json.blocks[1].type).toBe("table");
    expect(json.blocks[2].attrs.answerLine).toBe(true);
    expect(json.blocks[3].attrs.answerLine).toBe(true);
    // A tabela continua com 4 células — nada foi inserido dentro dela.
    expect(json.blocks[1].cells).toHaveLength(4);
  });
});

describe("answerLineStyle", () => {
  it("devolve undefined quando o bloco não é linha de resposta", () => {
    expect(answerLineStyle({})).toBeUndefined();
    expect(answerLineStyle({ align: "center" })).toBeUndefined();
  });

  it("desenha régua inferior e entrelinha", () => {
    expect(answerLineStyle({ answerLine: true, answerLineSpacing: 2 })).toEqual({
      borderBottom: "1px solid #000000",
      lineHeight: "2",
    });
  });

  it("entrelinha ausente vale 1", () => {
    expect(answerLineStyle({ answerLine: true })).toEqual({
      borderBottom: "1px solid #000000",
      lineHeight: "1",
    });
  });
});
```

Conferir o construtor real de `EditorDocument` (`packages/core/src/document.ts:60-80`) e o shape de `CommandContext` (topo de `commands.ts`) e ajustar o helper `ctxFor` ao que existir — outros testes em `packages/core/src/__tests__/commands.test.ts` já montam esse contexto; reaproveitar o padrão de lá em vez de inventar.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- answer-lines`
Expected: FAIL — `insertAnswerLines` e `answerLineStyle` não existem.

- [ ] **Step 3: Implementar**

`packages/core/src/types.ts`, em `BlockAttrs` (após `colWidths`):

```ts
  /**
   * Só relevante quando `type === "paragraph"`. Parágrafo pautado para o aluno
   * escrever a resposta: renderiza com régua inferior de largura total.
   */
  answerLine?: true;
  /** Só relevante quando `answerLine`. Entrelinha. Ausente = 1. */
  answerLineSpacing?: AnswerLineSpacing;
```

E, antes de `BlockAttrs`:

```ts
/** Entrelinha de uma linha de resposta: simples, 1,5 ou dupla. */
export type AnswerLineSpacing = 1 | 1.5 | 2;
```

`packages/core/src/decorations.ts`:

```ts
import type { BlockAttrs } from "./types";

/** Cor da régua da linha de resposta. Preto: é uma linha para escrever à caneta. */
export const ANSWER_LINE_COLOR = "#000000";

/**
 * Estilo do parágrafo pautado. `undefined` quando o bloco não é linha de
 * resposta, para o renderizador não emitir atributo `style` à toa.
 */
export function answerLineStyle(attrs: BlockAttrs): StyleRecord | undefined {
  if (attrs.answerLine !== true) return undefined;
  return {
    borderBottom: `1px solid ${ANSWER_LINE_COLOR}`,
    lineHeight: String(attrs.answerLineSpacing ?? 1),
  };
}
```

`packages/core/src/commands.ts` (junto de `insertTable`, ~linha 767):

```ts
/** Teto de linhas por inserção — protege contra digitar 5000 no popover. */
export const ANSWER_LINE_MAX = 50;

/**
 * Insere `count` parágrafos pautados depois do bloco focado, numa única
 * transação (um passo de undo). Se o caret estiver dentro de uma célula, as
 * linhas entram depois da tabela inteira.
 */
export function insertAnswerLines(
  ctx: CommandContext,
  count: number,
  spacing: AnswerLineSpacing,
): void {
  const n = Math.max(1, Math.min(ANSWER_LINE_MAX, Math.trunc(count)));
  transact(ctx.doc, () => {
    const sel = ctx.getSelection();
    const focusBlock = Math.max(0, Math.min(sel.focus.blockIndex, ctx.doc.blockCount() - 1));
    const insertAt = focusBlock + 1;
    const attrs: BlockAttrs = { answerLine: true, answerLineSpacing: spacing };
    const blocks = Array.from({ length: n }, () => createBlock("paragraph", "", attrs));
    ctx.doc.blocks.insert(insertAt, blocks);
    ctx.setSelection(collapsedSelection({ blockIndex: insertAt, offset: 0 }));
  });
}
```

`createBlock`, `transact` e `collapsedSelection` já estão importados no arquivo; acrescentar `AnswerLineSpacing` ao import de `./types`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test && pnpm --filter @sofereditor/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/decorations.ts packages/core/src/commands.ts packages/core/src/__tests__/answer-lines.test.ts
git commit -m "feat(core): linhas de resposta (attrs + insertAnswerLines)"
```

## Task 10: Linha de resposta renderizada no editor

**Files:**
- Modify: `packages/react/src/NodeView.tsx:96-116` (`blockAttrsBase`)
- Modify: `packages/react/src/useEditor.ts`
- Create: `packages/react/src/__tests__/answerLine.test.ts`

**Interfaces:**
- Consumes: `answerLineStyle`, `insertAnswerLines`, `AnswerLineSpacing` da Task 9.
- Produces: `useEditor().insertAnswerLines(count: number, spacing: AnswerLineSpacing): void`.

- [ ] **Step 1: Escrever o teste que falha**

`packages/react/src/__tests__/answerLine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blockAttrsBase } from "../NodeView";

describe("blockAttrsBase — linha de resposta", () => {
  it("não emite estilo de régua em parágrafo comum", () => {
    const a = blockAttrsBase({}, 0, "paragraph", undefined);
    expect(a.style).toBeUndefined();
  });

  it("emite régua inferior e entrelinha", () => {
    const a = blockAttrsBase({ answerLine: true, answerLineSpacing: 2 }, 0, "paragraph", undefined);
    expect(a.style).toMatchObject({
      borderBottom: "1px solid #000000",
      lineHeight: "2",
    });
  });

  it("combina com alinhamento", () => {
    const a = blockAttrsBase({ answerLine: true, align: "center" }, 0, "paragraph", undefined);
    expect(a.style).toMatchObject({ textAlign: "center", borderBottom: "1px solid #000000" });
  });
});
```

`blockAttrsBase` hoje não é exportada — a task exporta (é o mesmo padrão de `cellStyle`, exportada em `NodeView.tsx:132` justamente para poder ser testada sem montar o `EditorProvider`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/react test -- answerLine`
Expected: FAIL — `blockAttrsBase` não é exportada.

- [ ] **Step 3: Implementar**

Em `NodeView.tsx`: trocar `function blockAttrsBase(` por `export function blockAttrsBase(` e, dentro dela, logo após `if (attrs.align) style.textAlign = attrs.align;`:

```ts
  Object.assign(style, answerLineStyle(attrs) ?? {});
```

Importar `answerLineStyle` de `@sofereditor/core`.

Em `useEditor.ts`, acrescentar ao tipo da API e à implementação (seguir exatamente o padrão de `insertTable`, que já está lá):

```ts
  insertAnswerLines: (count: number, spacing: AnswerLineSpacing) => void;
```

```ts
    insertAnswerLines: (count, spacing) => cmdInsertAnswerLines(ctx(), count, spacing),
```

usando o mesmo esquema de import/aliasing que `insertTable` usa no arquivo.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/react test && pnpm --filter @sofereditor/react typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/NodeView.tsx packages/react/src/useEditor.ts packages/react/src/__tests__/answerLine.test.ts
git commit -m "feat(react): renderiza linha de resposta + API insertAnswerLines"
```

## Task 11: Linha de resposta no HTML de servidor

**Files:**
- Modify: `packages/export-pdf/src/html.ts` (`blockAttrs`)
- Test: `packages/export-pdf/src/__tests__/html.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("emite régua inferior e entrelinha em linha de resposta", () => {
  const html = documentToHtmlFragment({
    blocks: [{ type: "paragraph", text: "", delta: [], attrs: { answerLine: true, answerLineSpacing: 2 } }],
  });
  expect(html).toContain("border-bottom:1px solid #000000");
  expect(html).toContain("line-height:2");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-pdf test -- html`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Localizar `function blockAttrs(` em `html.ts` e, no ponto em que monta a lista de estilos do bloco, acrescentar:

```ts
  const answer = answerLineStyle(attrs);
  if (answer) styles.push(styleToCssText(answer));
```

Importar `answerLineStyle` (`styleToCssText` já foi importado na Task 8).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-pdf test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/export-pdf/src/html.ts packages/export-pdf/src/__tests__/html.test.ts
git commit -m "feat(export-pdf): linha de resposta no HTML de servidor"
```

## Task 12: Teste de paridade editor ↔ HTML de servidor

**Files:**
- Create: `packages/export-pdf/src/__tests__/parity.test.ts`

**Interfaces:**
- Consumes: `documentToHtmlFragment` de `../html`, `renderInline`/`NodeView` de `@sofereditor/react`.

Esta task existe porque a renderização inline vive em **dois** lugares. Sem ela, uma feature funciona na tela e diverge silenciosamente no PDF.

- [ ] **Step 1: Escrever o teste**

```ts
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInline } from "@sofereditor/react";
import { documentToHtmlFragment } from "../html";
import type { DeltaOp } from "@sofereditor/core";

/** Normaliza aspas/ordem de atributos para comparar as duas saídas por conteúdo. */
function decls(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)]
    .map((m) => m[1].split(";").map((s) => s.trim()).filter(Boolean).sort().join(";"))
    .sort();
}

const CASES: Array<{ name: string; delta: DeltaOp[] }> = [
  { name: "highlight", delta: [{ insert: "oi", attributes: { highlight: "#fff176" } }] },
  { name: "lacuna", delta: [{ insert: "Nome: _______" }] },
  { name: "highlight + lacuna", delta: [{ insert: "a_____", attributes: { highlight: "#fff176" } }] },
  { name: "cor + fonte + highlight", delta: [{ insert: "x", attributes: { color: "#ff0000", fontSize: "14pt", highlight: "#00ff00" } }] },
];

describe("paridade editor ↔ HTML de servidor", () => {
  for (const c of CASES) {
    it(`declara os mesmos estilos: ${c.name}`, () => {
      const editor = renderToStaticMarkup(<>{renderInline(c.delta, "k")}</>);
      const server = documentToHtmlFragment({
        blocks: [{ type: "paragraph", text: "", delta: c.delta, attrs: {} }],
      });
      expect(decls(server)).toEqual(expect.arrayContaining(decls(editor)));
    });

    it(`preserva o mesmo texto visível: ${c.name}`, () => {
      const strip = (h: string) => h.replace(/<[^>]*>/g, "");
      const editor = strip(renderToStaticMarkup(<>{renderInline(c.delta, "k")}</>));
      const server = strip(documentToHtmlFragment({
        blocks: [{ type: "paragraph", text: "", delta: c.delta, attrs: {} }],
      }));
      expect(server).toContain(editor);
    });
  }
});
```

Se `renderInline` não estiver no `index.ts` de `@sofereditor/react`, exportá-lo lá (é um helper puro, exportá-lo é legítimo). Conferir também que `@sofereditor/export-pdf` tem `react`/`react-dom` como devDependency para o teste rodar; se não tiver, acrescentar em `devDependencies` do `package.json` do pacote e o arquivo de teste precisa da extensão `.tsx`.

- [ ] **Step 2: Rodar**

Run: `pnpm --filter @sofereditor/export-pdf test -- parity`
Expected: PASS. Se falhar, o bug está numa das duas implementações — corrigir a divergência, não afrouxar o teste.

- [ ] **Step 3: Commit**

```bash
git add packages/export-pdf/src/__tests__/parity.test.tsx packages/export-pdf/package.json packages/react/src/index.ts
git commit -m "test(export-pdf): paridade de decoração entre editor e HTML de servidor"
```

## Task 13: Export `.docx` da linha de resposta

**Files:**
- Modify: `packages/export-docx/src/docx.ts` (função que monta o parágrafo padrão, ~linha 259 e o `default` do switch de blocos)
- Test: `packages/export-docx/src/__tests__/docx.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("emite pBdr inferior e entrelinha em linha de resposta", async () => {
  const buf = await documentToDocxBuffer([
    { type: "paragraph", text: "", delta: [], attrs: { answerLine: true, answerLineSpacing: 2 } },
  ] as LegacySerializedDocument);
  const xml = await documentXml(buf);
  expect(xml).toContain("w:pBdr");
  expect(xml).toContain('w:line="480"');
});

it("não emite pBdr em parágrafo comum", async () => {
  const buf = await documentToDocxBuffer([
    { type: "paragraph", text: "oi", delta: [{ insert: "oi" }], attrs: {} },
  ] as LegacySerializedDocument);
  expect(await documentXml(buf)).not.toContain("w:pBdr");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-docx test -- docx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Importar `BorderStyle` (já importado) e `LineRuleType` de `docx`. Na função que monta o parágrafo comum, acrescentar:

```ts
const spacing = block.attrs.answerLineSpacing ?? 1;
const answer = block.attrs.answerLine === true;
return new Paragraph({
  alignment: alignFor(block.attrs.align),
  ...(answer
    ? {
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 },
        },
        spacing: { line: Math.round(240 * spacing), lineRule: LineRuleType.AUTO },
      }
    : {}),
  children: deltaToRuns(block.delta, ARIAL, images),
});
```

240 twips = uma linha simples no OOXML; 1,5 → 360; 2 → 480.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-docx test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/export-docx/src/docx.ts packages/export-docx/src/__tests__/docx.test.ts
git commit -m "feat(export-docx): linha de resposta via w:pBdr + w:spacing"
```

## Task 14: Import `.docx` da linha de resposta

**Files:**
- Modify: `packages/import-docx/src/paragraphs.ts`
- Test: `packages/import-docx/src/__tests__/`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("parágrafo vazio com pBdr inferior vira linha de resposta", async () => {
  // <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr>
  //   <w:spacing w:line="480" w:lineRule="auto"/></w:pPr></w:p>
  // esperado: attrs.answerLine === true, attrs.answerLineSpacing === 2
});

it("ignora pBdr com val none", async () => {
  // <w:bottom w:val="none"/> → sem answerLine
});

it("parágrafo COM texto e pBdr não vira linha de resposta", async () => {
  // é um título com régua, não uma linha para responder
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `paragraphs.ts`, junto da leitura de `pPr` que já existe (o `w:shd` está em `paragraphs.ts:107`):

```ts
/**
 * Parágrafo SEM texto e com borda inferior = linha de resposta. Com texto, é um
 * título com régua — outra coisa, e converter destruiria o conteúdo.
 */
function readAnswerLine(pPr: OoxmlNode | undefined, hasText: boolean): Partial<BlockAttrs> {
  if (!pPr || hasText) return {};
  const pBdr = findChild(pPr, "w:pBdr");
  if (!pBdr) return {};
  const bottom = findChild(pBdr, "w:bottom");
  if (!bottom) return {};
  const val = (attr(bottom, "w:val") ?? "").toLowerCase();
  if (val === "" || val === "none" || val === "nil") return {};
  return { answerLine: true, answerLineSpacing: readSpacing(pPr) };
}

/** 240 twips = 1 linha. Arredonda para o bucket suportado mais próximo. */
function readSpacing(pPr: OoxmlNode): AnswerLineSpacing {
  const sp = findChild(pPr, "w:spacing");
  const line = Number.parseFloat(attr(sp, "w:line") ?? "");
  if (!Number.isFinite(line)) return 1;
  const buckets: AnswerLineSpacing[] = [1, 1.5, 2];
  let best: AnswerLineSpacing = 1;
  let bestDist = Infinity;
  for (const b of buckets) {
    const d = Math.abs(line - 240 * b);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}
```

Chamar `readAnswerLine` no ponto onde os `attrs` do parágrafo são montados, mesclando o resultado. Se `attr` não aceitar `undefined` no primeiro parâmetro, guardar com `sp ? attr(sp, "w:line") : undefined`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/import-docx/src/paragraphs.ts packages/import-docx/src/__tests__/
git commit -m "feat(import-docx): w:pBdr inferior em parágrafo vazio vira linha de resposta"
```

## Task 15: Toolbar das linhas de resposta

**Files:**
- Modify: `packages/react/src/Toolbar.tsx`
- Modify: `apps/playground/src/styles.css`

- [ ] **Step 1: Implementar o popover**

Seguir o padrão do popover de tabela que já existe (`.ed-table-popover`, estado `open` via `useState`, `onMouseDown={stop}`). Acrescentar um `<Group>`:

```tsx
function AnswerLinesMenu(): JSX.Element {
  const editor = useEditorContext();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(5);
  const [spacing, setSpacing] = useState<AnswerLineSpacing>(1.5);
  return (
    <div className="ed-toolbar-tablemenu">
      <button
        type="button"
        className="ed-toolbar-btn"
        title="Linhas de resposta"
        onMouseDown={stop}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
      >
        ☰
      </button>
      {open && (
        <div className="ed-table-popover" onMouseDown={stop}>
          <label className="ed-toolbar-label">
            Quantidade
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <label className="ed-toolbar-label">
            Entrelinha
            <select
              value={String(spacing)}
              onChange={(e) => setSpacing(Number(e.target.value) as AnswerLineSpacing)}
            >
              <option value="1">Simples</option>
              <option value="1.5">1,5</option>
              <option value="2">Duplo</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => { setOpen(false); editor.insertAnswerLines(count, spacing); }}
          >
            Inserir
          </button>
        </div>
      )}
    </div>
  );
}
```

`stop` e `useEditorContext` já existem no arquivo; conferir os nomes exatos antes de usar.

- [ ] **Step 2: Verificar no playground**

Run: `pnpm dev`

1. Inserir 5 linhas com entrelinha dupla → 5 réguas espaçadas; um único `⌘Z` desfaz todas as 5.
2. A régua acompanha a margem ao trocar o tamanho de página em Configurar página.
3. **Paginação com entrelinha alterada.** Diferente das bordas de tabela (onde a geometria é invariante por construção), `answerLineStyle` muda `line-height` de propósito — logo muda a altura medida do bloco. Inserir 40 linhas de resposta em cada uma das três entrelinhas, o suficiente para atravessar duas quebras de página, e conferir: nenhuma régua órfã sobre a margem, nenhuma sobreposta ao rodapé, e a última linha de cada página fechando dentro da caixa de conteúdo. Se `usePagination` medir por `getBoundingClientRect`, isso passa naturalmente; se houver qualquer altura estimada a partir de um `line-height` presumido, é aqui que aparece — e o conserto é na medição, não na feature.

- [ ] **Step 3: Rodar a suíte**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/Toolbar.tsx apps/playground/src/styles.css
git commit -m "feat(react): popover de linhas de resposta na toolbar"
```

---

# FEATURE 2 — Presets de borda de tabela

## Task 16: Helper puro `cellBorderColors`

**Files:**
- Create: `packages/core/src/table-borders.ts`
- Create: `packages/core/src/__tests__/table-borders.test.ts`
- Modify: `packages/core/src/types.ts` (`BlockAttrs.borderPreset`)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `type TableBorderPreset = "all" | "outer" | "horizontal" | "vertical" | "none"`
  - `TABLE_BORDER_COLOR = "#cbd5e1"`, `TABLE_GUIDE_COLOR = "var(--ed-guide-color, transparent)"`
  - `interface CellBorderPos { row; col; rowspan; colspan; cols; rowStart; rowEnd }`
  - `cellBorderColors(preset, pos, variant: "screen" | "print"): { top; right; bottom; left }`
  - `cellBorderStyle(preset, pos, variant): StyleRecord`
  - `BlockAttrs.borderPreset?: TableBorderPreset`

- [ ] **Step 1: Escrever o teste que falha**

`packages/core/src/__tests__/table-borders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  cellBorderColors,
  cellBorderStyle,
  TABLE_BORDER_COLOR,
  TABLE_GUIDE_COLOR,
  type CellBorderPos,
} from "../table-borders";

const ON = TABLE_BORDER_COLOR;
const OFF_PRINT = "transparent";

function pos(p: Partial<CellBorderPos> = {}): CellBorderPos {
  return { row: 1, col: 1, rowspan: 1, colspan: 1, cols: 3, rowStart: 0, rowEnd: 3, ...p };
}

describe("cellBorderColors", () => {
  it("preset ausente vale 'all' — nenhum documento existente muda de aparência", () => {
    expect(cellBorderColors(undefined, pos(), "print")).toEqual({
      top: ON, right: ON, bottom: ON, left: ON,
    });
  });

  it("outer: célula do miolo não tem nenhuma borda visível", () => {
    expect(cellBorderColors("outer", pos(), "print")).toEqual({
      top: OFF_PRINT, right: OFF_PRINT, bottom: OFF_PRINT, left: OFF_PRINT,
    });
  });

  it("outer: célula do canto superior esquerdo tem topo e esquerda", () => {
    const c = cellBorderColors("outer", pos({ row: 0, col: 0 }), "print");
    expect(c).toEqual({ top: ON, right: OFF_PRINT, bottom: OFF_PRINT, left: ON });
  });

  it("outer: colspan que alcança a última coluna ganha a borda direita", () => {
    const c = cellBorderColors("outer", pos({ row: 0, col: 1, colspan: 2 }), "print");
    expect(c.right).toBe(ON);
  });

  it("outer: rowspan que alcança a última linha ganha a borda inferior", () => {
    const c = cellBorderColors("outer", pos({ row: 1, col: 0, rowspan: 2 }), "print");
    expect(c.bottom).toBe(ON);
  });

  it("outer: numa tabela quebrada, a borda externa segue o fragmento", () => {
    // fragmento com as linhas 2..4 de uma tabela de 6 linhas
    const p = pos({ row: 2, col: 0, rowStart: 2, rowEnd: 5 });
    expect(cellBorderColors("outer", p, "print").top).toBe(ON);
    const last = pos({ row: 4, col: 0, rowStart: 2, rowEnd: 5 });
    expect(cellBorderColors("outer", last, "print").bottom).toBe(ON);
  });

  it("horizontal: só topo e base", () => {
    expect(cellBorderColors("horizontal", pos(), "print")).toEqual({
      top: ON, right: OFF_PRINT, bottom: ON, left: OFF_PRINT,
    });
  });

  it("vertical: só laterais", () => {
    expect(cellBorderColors("vertical", pos(), "print")).toEqual({
      top: OFF_PRINT, right: ON, bottom: OFF_PRINT, left: ON,
    });
  });

  it("none: nada visível na impressão", () => {
    expect(cellBorderColors("none", pos(), "print")).toEqual({
      top: OFF_PRINT, right: OFF_PRINT, bottom: OFF_PRINT, left: OFF_PRINT,
    });
  });

  it("na tela, lados desligados viram guia — mesma geometria, cor diferente", () => {
    expect(cellBorderColors("none", pos(), "screen")).toEqual({
      top: TABLE_GUIDE_COLOR, right: TABLE_GUIDE_COLOR,
      bottom: TABLE_GUIDE_COLOR, left: TABLE_GUIDE_COLOR,
    });
  });
});

describe("cellBorderStyle", () => {
  it("emite SEMPRE os quatro lados, só cor — nunca espessura", () => {
    const s = cellBorderStyle("none", pos(), "print");
    expect(Object.keys(s).sort()).toEqual([
      "borderBottomColor", "borderLeftColor", "borderRightColor", "borderTopColor",
    ]);
    expect(JSON.stringify(s)).not.toContain("width");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- table-borders`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`packages/core/src/table-borders.ts`:

```ts
import type { StyleRecord } from "./decorations";

/** Onde as linhas da grade aparecem. Vocabulário nativo de `w:tblBorders`. */
export type TableBorderPreset = "all" | "outer" | "horizontal" | "vertical" | "none";

/** Cor da grade. Mesmo valor que o CSS de `.ed-cell` já usa. */
export const TABLE_BORDER_COLOR = "#cbd5e1";

/**
 * Guia de tela para lados desligados. É uma custom property com fallback
 * `transparent`: sem a variável definida (consumidor sem CSS, ou dentro de
 * `@media print`), a borda simplesmente não aparece. Nunca muda a geometria —
 * o lado continua com 1px, só sem cor.
 */
export const TABLE_GUIDE_COLOR = "var(--ed-guide-color, transparent)";

export interface CellBorderPos {
  /** Linha absoluta da célula na tabela lógica. */
  row: number;
  /** Coluna absoluta. */
  col: number;
  rowspan: number;
  colspan: number;
  /** Total de colunas da tabela. */
  cols: number;
  /** Primeira linha do fragmento renderizado. Tabela inteira = 0. */
  rowStart: number;
  /** Fim exclusivo do fragmento. Tabela inteira = `rows`. */
  rowEnd: number;
}

/**
 * Cor de cada lado da célula. NUNCA devolve espessura: o preset muda só cor,
 * então trocar de preset não reflui uma linha e a paginação não se mexe.
 *
 * As bordas externas seguem os limites do FRAGMENTO, não da tabela lógica —
 * numa tabela quebrada entre páginas, cada página fecha a própria caixa, que é
 * o comportamento do Word.
 *
 * O teste de "toca a borda" usa row/col + spans em vez de `:first-child`/
 * `:last-child` do CSS, que quebram assim que uma célula `covered` some do DOM.
 */
export function cellBorderColors(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
): { top: string; right: string; bottom: string; left: string } {
  const on = TABLE_BORDER_COLOR;
  const off = variant === "screen" ? TABLE_GUIDE_COLOR : "transparent";
  switch (preset ?? "all") {
    case "all":
      return { top: on, right: on, bottom: on, left: on };
    case "horizontal":
      return { top: on, right: off, bottom: on, left: off };
    case "vertical":
      return { top: off, right: on, bottom: off, left: on };
    case "none":
      return { top: off, right: off, bottom: off, left: off };
    case "outer": {
      const isTop = pos.row === pos.rowStart;
      const isBottom = pos.row + Math.max(1, pos.rowspan) - 1 === pos.rowEnd - 1;
      const isLeft = pos.col === 0;
      const isRight = pos.col + Math.max(1, pos.colspan) - 1 === pos.cols - 1;
      return {
        top: isTop ? on : off,
        right: isRight ? on : off,
        bottom: isBottom ? on : off,
        left: isLeft ? on : off,
      };
    }
  }
}

/** `cellBorderColors` no formato de estilo inline consumido pelos renderizadores. */
export function cellBorderStyle(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
): StyleRecord {
  const c = cellBorderColors(preset, pos, variant);
  return {
    borderTopColor: c.top,
    borderRightColor: c.right,
    borderBottomColor: c.bottom,
    borderLeftColor: c.left,
  };
}
```

Em `types.ts`, dentro de `BlockAttrs` (junto de `colWidths`):

```ts
  /**
   * Só relevante quando `type === "table"`. Onde as linhas da grade aparecem.
   * Ausente = "all" — documentos existentes não mudam de aparência.
   */
  borderPreset?: TableBorderPreset;
```

com `import type { TableBorderPreset } from "./table-borders";` no topo — ou, se isso criar ciclo com `decorations.ts`, mover o `type TableBorderPreset` para `types.ts` e importá-lo em `table-borders.ts`. Verificar qual das duas direções o `tsc` aceita e seguir.

Em `index.ts`: `export * from "./table-borders";`

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test && pnpm --filter @sofereditor/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/table-borders.ts packages/core/src/__tests__/table-borders.test.ts packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): presets de borda de tabela (cellBorderColors)"
```

## Task 17: Bordas aplicadas no editor

**Files:**
- Modify: `packages/react/src/NodeView.tsx:132-139` (`cellStyle`), `155-235` (`TableView`)
- Modify: `packages/react/src/useEditor.ts`
- Create: `packages/react/src/__tests__/tableBorders.test.ts`

**Interfaces:**
- Consumes: `cellBorderStyle` da Task 16.
- Produces:
  - `cellStyle(attrs, border?: StyleRecord): CSSProperties | undefined` — assinatura estendida, parâmetro opcional para não quebrar os testes existentes em `cellStyle.test.ts`.
  - `useEditor().setTableBorderPreset(preset: TableBorderPreset): void`
  - `useEditor().getTableBorderPreset(): TableBorderPreset`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { cellStyle } from "../NodeView";
import { cellBorderStyle, TABLE_BORDER_COLOR } from "@sofereditor/core";

describe("cellStyle com bordas", () => {
  const border = cellBorderStyle("horizontal", {
    row: 1, col: 1, rowspan: 1, colspan: 1, cols: 3, rowStart: 0, rowEnd: 3,
  }, "screen");

  it("mescla as cores de borda com os atributos visuais da célula", () => {
    expect(cellStyle({ bgColor: "#ffe58f" }, border)).toMatchObject({
      backgroundColor: "#ffe58f",
      borderTopColor: TABLE_BORDER_COLOR,
    });
  });

  it("devolve o estilo de borda mesmo sem atributos visuais", () => {
    expect(cellStyle({}, border)).toMatchObject({ borderTopColor: TABLE_BORDER_COLOR });
  });

  it("sem borda passada, mantém o comportamento antigo", () => {
    expect(cellStyle({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/react test -- tableBorders`
Expected: FAIL — `cellStyle` só aceita um argumento.

- [ ] **Step 3: Implementar**

`cellStyle` em `NodeView.tsx`:

```ts
export function cellStyle(
  attrs?: CellAttrs,
  border?: StyleRecord,
): CSSProperties | undefined {
  const style: CSSProperties = { ...(border as CSSProperties | undefined) };
  if (attrs?.align) style.textAlign = attrs.align;
  if (attrs?.bgColor) style.backgroundColor = attrs.bgColor;
  return Object.keys(style).length > 0 ? style : undefined;
}
```

Em `TableView`, no `<td>` (`NodeView.tsx:~219`):

```tsx
                  style={cellStyle(
                    cell?.attrs,
                    cellBorderStyle(
                      block.attrs.borderPreset,
                      {
                        row: r,
                        col: c,
                        rowspan,
                        colspan,
                        cols,
                        rowStart,
                        rowEnd,
                      },
                      "screen",
                    ),
                  )}
```

`rowStart`/`rowEnd` já estão calculados em `TableView` (linhas ~163-165) — é exatamente a informação de fragmento que o helper precisa, e é por isso que ele a recebe em vez de deduzir.

Em `useEditor.ts`, seguindo o padrão de `setCellBackground`/`getCellBackground`:

```ts
    setTableBorderPreset: (preset) => {
      const loc = editorApi.getTableLocation();
      if (!loc) return;
      setBlockAttrAtIndex(ctx(), loc.blockIndex, "borderPreset", preset);
    },
    getTableBorderPreset: () => {
      const loc = editorApi.getTableLocation();
      if (!loc) return "all";
      return (docRef.current.getBlockAttrs(loc.blockIndex).borderPreset ?? "all");
    },
```

`setBlockAttr` de `commands.ts` opera sobre a seleção e é inerte quando o caret está dentro de uma célula (`commands.ts:346-348`) — que é exatamente o caso aqui. Ler a implementação e usar o caminho que escreve no bloco por índice; se não existir um, acrescentar em `commands.ts`:

```ts
/** Como `setBlockAttr`, mas em um bloco específico — funciona com o caret dentro de uma célula. */
export function setBlockAttrAtIndex<K extends keyof BlockAttrs>(
  ctx: CommandContext,
  blockIndex: number,
  key: K,
  value: BlockAttrs[K] | null,
): void {
  transact(ctx.doc, () => {
    const block = ctx.doc.getBlock(blockIndex);
    if (!block) return;
    const attrsMap = (block.get("attrs") as Y.Map<unknown> | undefined) ?? new Y.Map<unknown>();
    if (!block.get("attrs")) block.set("attrs", attrsMap);
    if (value === null || value === undefined) attrsMap.delete(key as string);
    else attrsMap.set(key as string, value);
  });
}
```

e cobrir com um teste em `packages/core/src/__tests__/commands.test.ts` (caret dentro de célula → o attr da tabela muda).

Conferir os nomes reais (`docRef`, `editorApi`, `getBlockAttrs`) no arquivo antes de escrever — o padrão exato está em `setCellBackground`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/react test && pnpm --filter @sofereditor/core test && pnpm typecheck`
Expected: PASS (incluindo `cellStyle.test.ts` original, intocado).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/NodeView.tsx packages/react/src/useEditor.ts packages/react/src/__tests__/tableBorders.test.ts packages/core/src/commands.ts packages/core/src/__tests__/commands.test.ts
git commit -m "feat(react): presets de borda aplicados por célula na tabela"
```

## Task 18: Bordas no HTML de servidor + CSS de guia

**Files:**
- Modify: `packages/export-pdf/src/html.ts` (`renderTable`, `renderCell`, bloco `<style>`)
- Modify: `packages/export-pdf/src/pdf.ts` (`serializePaginatedHtml`, bloco `<style>` ~linha 100)
- Modify: `apps/playground/src/styles.css`
- Test: `packages/export-pdf/src/__tests__/html.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it("aplica cores de borda por célula segundo o preset", () => {
  const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
  const html = documentToHtmlFragment({
    blocks: [{ type: "table", text: "", delta: [], attrs: { rows: 2, cols: 2, borderPreset: "horizontal" }, cells }],
  });
  expect(html).toContain("border-top-color:#cbd5e1");
  expect(html).toContain("border-left-color:transparent");
});

it("no HTML de servidor, lados desligados são transparent — nunca a guia de tela", () => {
  const cells = Array.from({ length: 1 }, () => ({ text: "", delta: [], attrs: {} }));
  const html = documentToHtmlFragment({
    blocks: [{ type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1, borderPreset: "none" }, cells }],
  });
  expect(html).not.toContain("--ed-guide-color");
});

it("preset ausente mantém a grade completa", () => {
  const cells = Array.from({ length: 1 }, () => ({ text: "", delta: [], attrs: {} }));
  const html = documentToHtmlFragment({
    blocks: [{ type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1 }, cells }],
  });
  expect(html).toContain("border-top-color:#cbd5e1");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-pdf test -- html`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`renderTable` não fragmenta (renderiza `rows` inteiras) — então `rowStart: 0, rowEnd: rows`. Passar o preset e a posição para `renderCell`:

```ts
      tds.push(renderCell(cell, {
        row: r,
        col: c,
        rowspan: cell.attrs?.rowspan ?? 1,
        colspan: cell.attrs?.colspan ?? 1,
        cols,
        rowStart: 0,
        rowEnd: rows,
      }, block.attrs.borderPreset));
```

O ramo `if (!cell)` que hoje empurra `<td class="ed-cell"></td>` também precisa das bordas — senão uma célula ausente vira um buraco na grade. Emitir com o mesmo `cellBorderStyle`.

`renderCell` ganha os dois parâmetros e acrescenta às `styles`:

```ts
  styles.push(styleToCssText(cellBorderStyle(preset, pos, "print")));
```

**`variant: "print"`** aqui, sempre: este HTML é para servidor/PDF, nunca para a tela do editor.

No `<style>` de `html.ts` (~linha 475), manter `.ed-cell { border: 1px solid #cbd5e1 }` — é ele que fornece a **espessura**; o inline só sobrescreve cor.

Em `apps/playground/src/styles.css`, junto de `.ed-cell`:

```css
.ed-root {
  /* Guia de tela para lados de borda desligados por preset. Sem esta variável,
     `var(--ed-guide-color, transparent)` cai em transparent — que é o correto
     para impressão e para consumidores sem CSS próprio. */
  --ed-guide-color: #e9edf2;
}
@media print {
  .ed-root { --ed-guide-color: transparent; }
}
```

Em `serializePaginatedHtml` (`pdf.ts`), dentro do `@media print` que já existe, acrescentar a mesma neutralização — o snapshot clona o DOM vivo e levaria a guia junto:

```css
        .ed-root, .ed-page { --ed-guide-color: transparent !important; }
```

**Este é o único ponto do plano onde tela e PDF divergem por design, e a neutralização depende de CSS que não vem do renderizador.** O override no `styles.css` do playground protege só o playground: um consumidor como `portal2-next` que definir `--ed-guide-color` e não tiver o `@media print` correspondente imprimiria as guias. Quem protege todo mundo é o override em `pdf.ts`, porque ele viaja dentro do snapshot — desde que a custom property **herde** de `.ed-root` até o `<td>` no clone.

- [ ] **Step 4: Travar a herança com teste, não com inspeção visual**

Em `packages/export-pdf/src/__tests__/` (arquivo de `pdf.ts`, ou novo):

```ts
it("o snapshot neutraliza --ed-guide-color dentro de @media print", () => {
  const root = document.createElement("div");
  root.className = "ed-root";
  root.innerHTML = '<div class="ed-page"><table class="ed-table"><tbody><tr><td class="ed-cell"></td></tr></tbody></table></div>';
  document.body.appendChild(root);
  const html = serializePaginatedHtml(root);
  expect(html).toMatch(/@media print[\s\S]*--ed-guide-color:\s*transparent\s*!important/);
});
```

Se `serializePaginatedHtml` precisar de `getComputedStyle`, o teste roda no ambiente jsdom que o pacote já usa; conferir o `environment` no `vitest.config` do pacote antes de escrever.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-pdf test && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/export-pdf/src/html.ts packages/export-pdf/src/pdf.ts apps/playground/src/styles.css packages/export-pdf/src/__tests__/
git commit -m "feat(export-pdf): bordas por preset no HTML e guia de tela neutralizada na impressão"
```

## Task 19: Export `.docx` das bordas

**Files:**
- Modify: `packages/export-docx/src/docx.ts:~298-312` (`makeTable`)
- Test: `packages/export-docx/src/__tests__/docx.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
async function tableXmlFor(preset?: string): Promise<string> {
  const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
  const buf = await documentToDocxBuffer([
    { type: "table", text: "", delta: [], attrs: { rows: 2, cols: 2, borderPreset: preset }, cells },
    { type: "paragraph", text: "", delta: [], attrs: {} },
  ] as LegacySerializedDocument);
  return documentXml(buf);
}

it("preset horizontal emite insideH mas não insideV", async () => {
  const xml = await tableXmlFor("horizontal");
  expect(xml).toContain("w:insideH");
  expect(xml).toMatch(/w:insideV[^>]*w:val="none"/);
});

it("preset none zera os seis lados", async () => {
  const xml = await tableXmlFor("none");
  expect(xml).not.toMatch(/w:top[^>]*w:val="single"/);
});

it("preset ausente mantém a grade completa", async () => {
  const xml = await tableXmlFor(undefined);
  expect(xml).toMatch(/w:insideH[^>]*w:val="single"/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-docx test -- docx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `makeTable`, acrescentar às props do `new Table({...})`:

```ts
    borders: docxTableBorders(block.attrs.borderPreset),
```

E, junto de `makeTable`:

```ts
/**
 * Traduz o preset para `w:tblBorders`. Lado desligado = BorderStyle.NONE.
 *
 * A tabela-verdade sai direto de `cellBorderColors`: o que aquele helper liga
 * em TODA célula vira o par externo + o interno correspondente. Ex.: em
 * `vertical`, toda célula tem left/right ligados — logo as laterais externas
 * (left/right) E as internas (insideV) ficam ligadas, e topo/base (top/bottom/
 * insideH) desligados.
 */
function docxTableBorders(preset: TableBorderPreset | undefined) {
  const on = { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" };
  const off = { style: BorderStyle.NONE, size: 0, color: "auto" };
  const s = (visible: boolean) => (visible ? on : off);

  // [top/bottom, left/right, insideH, insideV]
  const TRUTH: Record<TableBorderPreset, [boolean, boolean, boolean, boolean]> = {
    all:        [true,  true,  true,  true],
    outer:      [true,  true,  false, false],
    horizontal: [true,  false, true,  false],
    vertical:   [false, true,  false, true],
    none:       [false, false, false, false],
  };
  const [tb, lr, iH, iV] = TRUTH[preset ?? "all"];
  return {
    top: s(tb),
    bottom: s(tb),
    left: s(lr),
    right: s(lr),
    insideHorizontal: s(iH),
    insideVertical: s(iV),
  };
}
```

A tabela-verdade é a especificação; escrever a função a partir dela, não o contrário. Um teste por linha:

| preset | top/bottom | left/right | insideH | insideV |
|---|---|---|---|---|
| all | on | on | on | on |
| outer | on | on | off | off |
| horizontal | on | off | on | off |
| vertical | off | on | off | on |
| none | off | off | off | off |

Importar `TableBorderPreset` de `@sofereditor/core`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-docx test`
Expected: PASS, com um teste por linha da tabela-verdade.

- [ ] **Step 5: Commit**

```bash
git add packages/export-docx/src/docx.ts packages/export-docx/src/__tests__/docx.test.ts
git commit -m "feat(export-docx): w:tblBorders a partir do preset de borda"
```

## Task 20: Import `.docx` das bordas

**Files:**
- Modify: `packages/import-docx/src/tables.ts`
- Test: `packages/import-docx/src/__tests__/`

- [ ] **Step 1: Escrever o teste que falha**

Um teste por linha da tabela de redução:

| tblBorders lido | preset |
|---|---|
| os 6 lados em `single` | `all` |
| só os 4 externos | `outer` |
| top+bottom+insideH | `horizontal` |
| left+right+insideV | `vertical` |
| nenhum, ou todos `none` | `none` |
| qualquer outra combinação | `all` (fallback) |

```ts
it("os 6 lados presentes viram preset all", async () => { /* … */ });
it("só externos viram preset outer", async () => { /* … */ });
it("top+bottom+insideH viram preset horizontal", async () => { /* … */ });
it("left+right+insideV viram preset vertical", async () => { /* … */ });
it("todos none viram preset none", async () => { /* … */ });
it("combinação não mapeável cai em all", async () => { /* … */ });
it("tabela sem tblBorders não define borderPreset", async () => { /* … */ });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `tables.ts`, dentro de `tableToBlock`:

```ts
/**
 * Reduz `w:tblBorders` ao preset mais próximo. O modelo não tem borda por
 * célula, então `w:tcBorders` continua ignorado — deliberadamente.
 */
function readBorderPreset(tbl: OoxmlNode): TableBorderPreset | undefined {
  const tblPr = findChild(tbl, "w:tblPr");
  const b = tblPr ? findChild(tblPr, "w:tblBorders") : undefined;
  if (!b) return undefined;
  const has = (name: string): boolean => {
    const n = findChild(b, name);
    if (!n) return false;
    const val = (attr(n, "w:val") ?? "").toLowerCase();
    return val !== "" && val !== "none" && val !== "nil";
  };
  const top = has("w:top"), bottom = has("w:bottom");
  const left = has("w:left"), right = has("w:right");
  const iH = has("w:insideH"), iV = has("w:insideV");
  if (top && bottom && left && right && iH && iV) return "all";
  if (top && bottom && left && right && !iH && !iV) return "outer";
  if (top && bottom && !left && !right && iH && !iV) return "horizontal";
  if (!top && !bottom && left && right && !iH && iV) return "vertical";
  if (!top && !bottom && !left && !right && !iH && !iV) return "none";
  return "all";
}
```

Mesclar o resultado em `attrs` só quando não for `undefined`, para não gravar a chave em tabelas sem `tblBorders`.

Se `w:left`/`w:right` vierem como `w:start`/`w:end` (OOXML estrito), aceitar os dois nomes.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/import-docx/src/tables.ts packages/import-docx/src/__tests__/
git commit -m "feat(import-docx): w:tblBorders reduzido a preset de borda"
```

## Task 21: Toolbar dos presets de borda

**Files:**
- Modify: `packages/react/src/Toolbar.tsx:~566-585` (popover de tabela)

- [ ] **Step 1: Implementar**

No popover de tabela, entre o bloco de cor de fundo e o `<hr>` final:

```tsx
              <hr />
              <label className="ed-toolbar-label">
                Bordas
                <select
                  value={editor.getTableBorderPreset()}
                  onChange={(e) =>
                    editor.setTableBorderPreset(e.target.value as TableBorderPreset)
                  }
                  aria-label="Bordas da tabela"
                >
                  <option value="all">Todas</option>
                  <option value="outer">Só externas</option>
                  <option value="horizontal">Só horizontais</option>
                  <option value="vertical">Só verticais</option>
                  <option value="none">Nenhuma</option>
                </select>
              </label>
```

Importar `TableBorderPreset` de `@sofereditor/core`.

- [ ] **Step 2: Verificar no playground**

Run: `pnpm dev`

Roteiro obrigatório:
1. Inserir tabela 3×3, escrever em algumas células, trocar entre os cinco presets. **Nenhuma linha de texto pode se mover** — é a invariante de geometria.
2. Mesclar duas células e repetir com preset `outer`: a caixa externa continua fechada.
3. Preset `none`: guias cinza claras aparecem na tela.
4. `⌘P` com preset `none`: **nenhuma guia no PDF**.
5. Tabela longa que quebra entre páginas com preset `outer`: cada página fecha a própria caixa.

- [ ] **Step 3: Rodar tudo**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/Toolbar.tsx
git commit -m "feat(react): seletor de presets de borda no popover de tabela"
```

## Task 22: Round-trip `.docx` das três features

**Files:**
- Test: `packages/import-docx/src/__tests__/` (novo arquivo de round-trip)

Verifica o que os testes por camada não pegam: que export e import concordam.

- [ ] **Step 1: Escrever o teste**

```ts
import { describe, it, expect } from "vitest";
import { documentToDocxBuffer } from "@sofereditor/export-docx";
import { docxToDocument } from "../docx";

describe("round-trip docx", () => {
  it("preserva highlight", async () => {
    const src = {
      blocks: [{ type: "paragraph", text: "oi", delta: [{ insert: "oi", attributes: { highlight: "#fff176" } }], attrs: {} }],
    };
    const back = await docxToDocument(await documentToDocxBuffer(src));
    expect(back.blocks[0].delta[0].attributes?.highlight?.toLowerCase()).toBe("#fff176");
  });

  it("preserva linha de resposta com entrelinha dupla", async () => {
    const src = {
      blocks: [{ type: "paragraph", text: "", delta: [], attrs: { answerLine: true, answerLineSpacing: 2 } }],
    };
    const back = await docxToDocument(await documentToDocxBuffer(src));
    const b = back.blocks.find((x) => x.attrs.answerLine === true);
    expect(b).toBeDefined();
    expect(b!.attrs.answerLineSpacing).toBe(2);
  });

  it("preserva os cinco presets de borda", async () => {
    for (const preset of ["all", "outer", "horizontal", "vertical", "none"] as const) {
      const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
      const src = {
        blocks: [
          { type: "table", text: "", delta: [], attrs: { rows: 2, cols: 2, borderPreset: preset }, cells },
          { type: "paragraph", text: "", delta: [], attrs: {} },
        ],
      };
      const back = await docxToDocument(await documentToDocxBuffer(src));
      const t = back.blocks.find((x) => x.type === "table");
      expect(t?.attrs.borderPreset ?? "all").toBe(preset);
    }
  });

  it("underlines sobrevivem literais (a lacuna é decoração, não modelo)", async () => {
    const src = { blocks: [{ type: "paragraph", text: "Nome: _____", delta: [{ insert: "Nome: _____" }], attrs: {} }] };
    const back = await docxToDocument(await documentToDocxBuffer(src));
    expect(back.blocks[0].text).toBe("Nome: _____");
  });
});
```

Conferir o nome real da função de import (`docxToDocument` ou similar) em `packages/import-docx/src/index.ts` e se `@sofereditor/export-docx` já é devDependency de `@sofereditor/import-docx`; acrescentar se faltar.

- [ ] **Step 2: Rodar**

Run: `pnpm --filter @sofereditor/import-docx test -- round-trip`
Expected: PASS. Falha aqui = export e import discordam; corrigir o lado errado, não o teste.

- [ ] **Step 3: Commit**

```bash
git add packages/import-docx/src/__tests__/ packages/import-docx/package.json
git commit -m "test: round-trip docx de highlight, linhas de resposta e bordas"
```

## Task 23: Verificação final e entrega para avaliação

- [ ] **Step 1: Suíte completa**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS em tudo. Colar a saída real no relatório — nenhuma alegação de "passando" sem a saída.

- [ ] **Step 2: Roteiro manual no playground**

Run: `pnpm dev`

1. Marca-texto: aplicar, trocar cor, limpar; conferir no PDF.
2. `Nome: ` + 15 underlines: traço contínuo; apagar até sobrar 2 → o traço some.
3. Inserir 5 linhas de resposta com entrelinha dupla; `⌘Z` desfaz as 5 de uma vez.
4. Tabela: os cinco presets, sem deslocamento de texto; `none` sem guia no PDF.
5. Exportar `.docx`, abrir no Word, conferir as três features.
6. Reimportar o `.docx` exportado e conferir que nada se perdeu.

- [ ] **Step 3: Relatar ao usuário e PARAR**

Apresentar o resultado e **aguardar autorização explícita** antes de publicar no ambiente de teste ou no npm. Nenhum `npm publish`, nenhum bump de versão, nenhuma tag até essa autorização.

---

## Self-review

**Cobertura do spec:**
- Marca-texto: modelo (T1), render editor+HTML (T2), export docx (T3), import docx (T4), toolbar (T5), round-trip (T22). ✓
- Lacuna inline: helper (T6), editor (T7), HTML (T8), paridade (T12), docx literal (T22). ✓
- Linhas de resposta: modelo+comando (T9), editor (T10), HTML (T11), export docx (T13), import docx (T14), toolbar (T15), round-trip (T22). ✓
- Presets de borda: helper (T16), editor (T17), HTML+guia (T18), export docx (T19), import docx (T20), toolbar (T21), round-trip (T22). ✓
- Regra de arquitetura (helpers puros em core, dois renderizadores): T6, T9, T16 criam os helpers; T12 trava a paridade. ✓
- Invariante "só cor, nunca espessura": travada por teste em T16 e por roteiro manual em T21. ✓
- `clipboard.ts`: **verificado durante o planejamento** — não referencia `attributes` nem `MarkAttrs`; copia `DeltaOp` inteiro. Genérico, nenhuma task necessária.
- Não publicar sem autorização: T23 Step 3 + Global Constraints. ✓

**Consistência de tipos:** `StyleRecord` (T6) é consumido por `answerLineStyle` (T9), `cellBorderStyle` (T16), `cellStyle` (T17) e `styleToCssText` (T6/T8/T11/T18). `AnswerLineSpacing` (T9) é usado em T10, T13, T14, T15. `TableBorderPreset` (T16) em T17, T18, T19, T20, T21. `CellBorderPos` (T16) em T17 e T18. Nomes conferidos e uniformes.

**Pontos onde o implementador precisa ler o código antes de escrever** (sinalizados na própria task, não deixados como TODO): shape de `CommandContext` (T9), nomes internos de `useEditor` (T10/T17), nome da função de import (T22), e a tabela-verdade de `docxTableBorders` (T19), cujo esboço é deliberadamente redundante para forçar revisão.
