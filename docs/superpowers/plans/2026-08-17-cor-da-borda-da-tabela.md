# Cor da borda da tabela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir escolher a cor das linhas da grade de uma tabela, uma cor por tabela, preservando toda a fidelidade editor↔PDF↔`.docx` já entregue.

**Architecture:** `BlockAttrs.borderColor` alimenta um quarto parâmetro opcional de `cellBorderColors`/`cellBorderStyle` em `@sofereditor/core`, consumido pelos dois renderizadores. A largura continua vindo do CSS do consumidor; o inline sobrescreve só a cor, como já faz hoje — a invariante de geometria se mantém sem trabalho extra.

**Tech Stack:** TypeScript, Y.js, React 18, vitest, `docx` (npm), pnpm workspaces.

## Global Constraints

- Spec de origem: `docs/superpowers/specs/2026-08-17-cor-da-borda-da-tabela-design.md`.
- **Nada é publicado** sem autorização explícita do usuário.
- **Só cor.** Espessura e estilo estão fora de escopo: espessura mudaria a geometria da célula e exigiria re-medir a paginação, destruindo a invariante "preset muda cor, nunca espessura".
- **Uma cor por tabela.** Cor por célula está fora: colide com `border-collapse: collapse`.
- Default quando o atributo está ausente: `TABLE_BORDER_COLOR` (`#cbd5e1`).
- **Lados desligados NUNCA recebem a cor escolhida** — continuam em `TABLE_GUIDE_COLOR` na tela e `transparent` na impressão.
- O parâmetro `color` entra **opcional e por último** nas assinaturas, para os testes existentes seguirem válidos sem edição.
- Testes: `pnpm --filter @sofereditor/<pkg> test`. Cada task termina com commit.

## Estrutura de arquivos

**Modificar:**
- `packages/core/src/types.ts` — `BlockAttrs.borderColor`
- `packages/core/src/table-borders.ts` — 4º parâmetro em `cellBorderColors` / `cellBorderStyle`
- `packages/core/src/__tests__/table-borders.test.ts`
- `packages/react/src/NodeView.tsx:~230` — passa `block.attrs.borderColor`
- `packages/react/src/useEditor.ts` — `setTableBorderColor` / `getTableBorderColor`
- `packages/react/src/Toolbar.tsx:~748` — controle no popover
- `packages/export-pdf/src/html.ts` — `renderTable` passa a cor
- `packages/export-pdf/src/__tests__/html.test.ts`
- `packages/export-docx/src/docx.ts:347` — `docxTableBorders(preset, color)`
- `packages/export-docx/src/__tests__/docx.test.ts`
- `packages/import-docx/src/tables.ts` — `readBorderColor`
- `packages/import-docx/src/__tests__/table-borders.test.ts`
- `packages/import-docx/src/__tests__/round-trip-features.test.ts`
- `packages/react/src/__tests__/parity.test.tsx`

**Não tocar:**
- `export-pdf/src/html.ts:531` e `apps/playground/src/styles.css:438` — o `#cbd5e1` ali acompanha a **largura** de 1px e é só cor de partida; o inline sobrescreve sempre. Virar parâmetro dessincronizaria o CSS do modelo.
- `export-docx/src/docx.ts:256` — é a borda esquerda de **blockquote**, sem relação com tabelas.

---

## Task 1: Cor no modelo e no helper puro

**Files:**
- Modify: `packages/core/src/types.ts` (`BlockAttrs`)
- Modify: `packages/core/src/table-borders.ts`
- Test: `packages/core/src/__tests__/table-borders.test.ts`

**Interfaces:**
- Produces:
  - `BlockAttrs.borderColor?: string`
  - `cellBorderColors(preset, pos, variant, color?): CellBorderColors`
  - `cellBorderStyle(preset, pos, variant, color?): StyleRecord`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `packages/core/src/__tests__/table-borders.test.ts`:

```ts
describe("cellBorderColors — cor customizada", () => {
  const PRETO = "#000000";

  it("cor ausente cai em TABLE_BORDER_COLOR", () => {
    expect(cellBorderColors("all", pos(), "print").top).toBe(TABLE_BORDER_COLOR);
    expect(cellBorderColors("all", pos(), "print", undefined).top).toBe(TABLE_BORDER_COLOR);
  });

  it("pinta os lados LIGADOS com a cor escolhida, em todos os presets", () => {
    expect(cellBorderColors("all", pos(), "print", PRETO)).toEqual({
      top: PRETO, right: PRETO, bottom: PRETO, left: PRETO,
    });
    expect(cellBorderColors("horizontal", pos(), "print", PRETO)).toMatchObject({
      top: PRETO, bottom: PRETO,
    });
    expect(cellBorderColors("vertical", pos(), "print", PRETO)).toMatchObject({
      left: PRETO, right: PRETO,
    });
    expect(cellBorderColors("outer", pos({ row: 0, col: 0 }), "print", PRETO)).toMatchObject({
      top: PRETO, left: PRETO,
    });
  });

  it("NÃO pinta os lados desligados — a guia é affordance de tela", () => {
    // Pintar a guia com a cor escolhida faria "Nenhuma" com borda preta
    // desenhar linhas na tela e nada no PDF.
    expect(cellBorderColors("horizontal", pos(), "print", PRETO)).toMatchObject({
      left: "transparent", right: "transparent",
    });
    expect(cellBorderColors("none", pos(), "screen", PRETO)).toEqual({
      top: TABLE_GUIDE_COLOR, right: TABLE_GUIDE_COLOR,
      bottom: TABLE_GUIDE_COLOR, left: TABLE_GUIDE_COLOR,
    });
  });

  it("aceita qualquer notação CSS de cor", () => {
    for (const c of ["#000", "#1a2b3c", "rgb(10, 20, 30)", "red"]) {
      expect(cellBorderColors("all", pos(), "print", c).top).toBe(c);
    }
  });

  it("string vazia cai no default em vez de apagar a borda", () => {
    expect(cellBorderColors("all", pos(), "print", "").top).toBe(TABLE_BORDER_COLOR);
  });
});

describe("cellBorderStyle — cor customizada", () => {
  it("propaga a cor e continua sem emitir espessura", () => {
    const s = cellBorderStyle("all", pos(), "print", "#ff0000");
    expect(s).toEqual({
      borderTopColor: "#ff0000",
      borderRightColor: "#ff0000",
      borderBottomColor: "#ff0000",
      borderLeftColor: "#ff0000",
    });
  });

  it("a geometria segue invariante com cor customizada", () => {
    const chaves = (c?: string) =>
      Object.keys(cellBorderStyle("all", pos(), "print", c)).sort().join(",");
    expect(chaves("#ff0000")).toBe(chaves(undefined));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- src/__tests__/table-borders.test.ts`
Expected: FAIL — a cor customizada é ignorada, os lados ligados voltam `#cbd5e1`.

- [ ] **Step 3: Implementar**

Em `packages/core/src/types.ts`, dentro de `BlockAttrs`, logo após `borderPreset`:

```ts
  /**
   * Só relevante quando `type === "table"`. Cor das linhas da grade.
   * Ausente = `TABLE_BORDER_COLOR` — documentos existentes não mudam.
   */
  borderColor?: string;
```

Em `packages/core/src/table-borders.ts`, trocar a assinatura e a primeira linha do corpo de `cellBorderColors`:

```ts
export function cellBorderColors(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
  color?: string,
): CellBorderColors {
  // String vazia cai no default: apagar a borda é papel do preset "none",
  // não de uma cor vazia.
  const on = color && color.length > 0 ? color : TABLE_BORDER_COLOR;
  const off = variant === "screen" ? TABLE_GUIDE_COLOR : "transparent";
  // …resto do switch inalterado
```

E em `cellBorderStyle`:

```ts
export function cellBorderStyle(
  preset: TableBorderPreset | undefined,
  pos: CellBorderPos,
  variant: "screen" | "print",
  color?: string,
): StyleRecord {
  const c = cellBorderColors(preset, pos, variant, color);
  // …resto inalterado
```

O `off` **não** muda: os lados desligados nunca recebem a cor escolhida.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test && pnpm --filter @sofereditor/core typecheck`
Expected: PASS nos dois, incluindo todos os testes de borda anteriores (o parâmetro é opcional e por último).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/table-borders.ts packages/core/src/__tests__/table-borders.test.ts
git commit -m "feat(core): cor da borda de tabela (borderColor)"
```

---

## Task 2: Cor aplicada no editor + API do useEditor

**Files:**
- Modify: `packages/react/src/NodeView.tsx` (chamada de `cellBorderStyle` em `TableView`)
- Modify: `packages/react/src/useEditor.ts`
- Test: `packages/react/src/__tests__/tableBorders.test.ts`

**Interfaces:**
- Consumes: `cellBorderStyle(preset, pos, variant, color?)` da Task 1.
- Produces:
  - `useEditor().setTableBorderColor(color: string | null): void` — `null` apaga o atributo
  - `useEditor().getTableBorderColor(): string | undefined`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `packages/react/src/__tests__/tableBorders.test.ts`:

```ts
describe("cellStyle com cor de borda customizada", () => {
  const posMeio = pos();

  it("propaga a cor escolhida para os lados ligados", () => {
    const s = cellStyle({}, cellBorderStyle("all", posMeio, "screen", "#ff0000"))!;
    expect(s.borderTopColor).toBe("#ff0000");
    expect(s.borderLeftColor).toBe("#ff0000");
  });

  it("mantém a guia nos lados desligados", () => {
    const s = cellStyle({}, cellBorderStyle("horizontal", posMeio, "screen", "#ff0000"))!;
    expect(s.borderTopColor).toBe("#ff0000");
    expect(s.borderLeftColor).toBe(TABLE_GUIDE_COLOR);
  });

  it("cor customizada convive com bgColor da célula", () => {
    const s = cellStyle({ bgColor: "#ffe58f" }, cellBorderStyle("all", posMeio, "screen", "#000000"))!;
    expect(s.backgroundColor).toBe("#ffe58f");
    expect(s.borderTopColor).toBe("#000000");
  });
});
```

Acrescentar `TABLE_GUIDE_COLOR` ao import de `@sofereditor/core` no topo do arquivo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/react test -- src/__tests__/tableBorders.test.ts`
Expected: FAIL — a cor é ignorada, volta `#cbd5e1`.

Nota: como `cellBorderStyle` já aceita o 4º parâmetro depois da Task 1, este teste pode passar direto. Se passar, confirme que é porque a Task 1 já cobre o helper, e siga para o Step 3 — o que ainda falta é o **renderizador** passar o atributo, coberto pelo Step 4.

- [ ] **Step 3: Implementar no renderizador**

Em `packages/react/src/NodeView.tsx`, na chamada dentro do `<td>`, acrescentar o quarto argumento:

```tsx
                    cellBorderStyle(
                      block.attrs.borderPreset,
                      { row: r, col: c, rowspan, colspan, cols, rowStart, rowEnd },
                      "screen",
                      block.attrs.borderColor,
                    ),
```

Em `packages/react/src/useEditor.ts`, junto de `setTableBorderPreset` / `getTableBorderPreset`:

```ts
  const setTableBorderColor = useCallback((color: string | null) => {
    const sel = selectionRef.current;
    if (!doc.isTable(sel.focus.blockIndex)) return;
    cmdSetBlockAttrAtIndex(ctxRef.current, sel.focus.blockIndex, "borderColor", color);
  }, [doc]);

  const getTableBorderColor = useCallback((): string | undefined => {
    const sel = selectionRef.current;
    if (!doc.isTable(sel.focus.blockIndex)) return undefined;
    return doc.getBlockAttrs(sel.focus.blockIndex).borderColor;
  }, [doc]);
```

Declarar no tipo `UseEditorResult`, junto das outras duas:

```ts
  /** Cor das linhas da grade da tabela focada. `null` restaura o padrão. No-op fora de tabela. */
  setTableBorderColor: (color: string | null) => void;
  /** Cor da tabela focada; undefined fora de tabela ou quando usa o padrão. */
  getTableBorderColor: () => string | undefined;
```

E acrescentar ambas ao objeto retornado.

- [ ] **Step 4: Escrever o teste do renderizador**

Em `packages/react/src/__tests__/tableBorders.test.ts`, um teste que prova que o atributo do bloco chega ao estilo — usando a mesma composição que o `TableView` faz:

```ts
it("o atributo borderColor do bloco chega ao estilo da célula", () => {
  const attrsDoBloco = { rows: 1, cols: 1, borderPreset: "all", borderColor: "#123456" } as const;
  const s = cellStyle(
    {},
    cellBorderStyle(
      attrsDoBloco.borderPreset,
      { row: 0, col: 0, rowspan: 1, colspan: 1, cols: 1, rowStart: 0, rowEnd: 1 },
      "screen",
      attrsDoBloco.borderColor,
    ),
  )!;
  expect(s.borderTopColor).toBe("#123456");
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/react test && pnpm --filter @sofereditor/react typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/NodeView.tsx packages/react/src/useEditor.ts packages/react/src/__tests__/tableBorders.test.ts
git commit -m "feat(react): cor da borda aplicada na tabela + API do useEditor"
```

---

## Task 3: Cor no HTML de servidor + paridade

**Files:**
- Modify: `packages/export-pdf/src/html.ts` (`renderTable`)
- Test: `packages/export-pdf/src/__tests__/html.test.ts`
- Test: `packages/react/src/__tests__/parity.test.tsx`

**Interfaces:**
- Consumes: `cellBorderStyle(preset, pos, variant, color?)` da Task 1.

- [ ] **Step 1: Escrever os testes que falham**

Em `packages/export-pdf/src/__tests__/html.test.ts`:

```ts
it("aplica a cor de borda escolhida", () => {
  const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
  const html = frag([
    {
      type: "table", text: "", delta: [],
      attrs: { rows: 2, cols: 2, borderPreset: "all", borderColor: "#000000" },
      cells,
    },
  ]);
  expect(html).toContain("border-top-color:#000000");
  expect(html).not.toContain("border-top-color:#cbd5e1");
});

it("cor escolhida não vaza para os lados desligados", () => {
  const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
  const html = frag([
    {
      type: "table", text: "", delta: [],
      attrs: { rows: 2, cols: 2, borderPreset: "horizontal", borderColor: "#000000" },
      cells,
    },
  ]);
  expect(html).toContain("border-top-color:#000000");
  expect(html).toContain("border-left-color:transparent");
});

it("sem borderColor mantém o padrão", () => {
  const cells = Array.from({ length: 1 }, () => ({ text: "", delta: [], attrs: {} }));
  const html = frag([
    { type: "table", text: "", delta: [], attrs: { rows: 1, cols: 1 }, cells },
  ]);
  expect(html).toContain("border-top-color:#cbd5e1");
});
```

Em `packages/react/src/__tests__/parity.test.tsx`, acrescentar um bloco de paridade de tabela:

```tsx
describe("paridade de tabela: cor da borda", () => {
  const cells = [{ text: "", delta: [], attrs: {} }];
  const attrs = { rows: 1, cols: 1, borderPreset: "all", borderColor: "#123456" } as const;

  it("editor e HTML de servidor concordam nas cores da grade", () => {
    const editor = cellBorderStyle(
      attrs.borderPreset,
      { row: 0, col: 0, rowspan: 1, colspan: 1, cols: 1, rowStart: 0, rowEnd: 1 },
      "print",
      attrs.borderColor,
    );
    const server = documentToHtmlFragment({
      blocks: [{ type: "table", text: "", delta: [], attrs, cells }],
    });
    for (const [k, v] of Object.entries(editor)) {
      expect(server).toContain(styleToCssText({ [k]: v }));
    }
  });
});
```

Acrescentar `cellBorderStyle` ao import de `@sofereditor/core` no topo do arquivo de paridade.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-pdf test && pnpm --filter @sofereditor/react test -- src/__tests__/parity.test.tsx`
Expected: FAIL — o HTML de servidor emite `#cbd5e1`.

- [ ] **Step 3: Implementar**

Em `packages/export-pdf/src/html.ts`, dentro de `renderTable`, ler a cor junto do preset:

```ts
  const preset = block.attrs.borderPreset;
  const borderColor = block.attrs.borderColor;
```

E acrescentar o quarto argumento nas **duas** chamadas de `cellBorderStyle` (a do ramo `if (!cell)` e a de `renderCell`):

```ts
        const style = styleToCssText(cellBorderStyle(preset, at(1, 1), "print", borderColor));
```

```ts
      tds.push(renderCell(cell, cellBorderStyle(preset, at(rowspan, colspan), "print", borderColor)));
```

Esquecer o ramo `if (!cell)` deixa uma célula ausente com a cor padrão no meio de uma grade colorida.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-pdf test && pnpm --filter @sofereditor/react test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/export-pdf/src/html.ts packages/export-pdf/src/__tests__/html.test.ts packages/react/src/__tests__/parity.test.tsx
git commit -m "feat(export-pdf): cor da borda no HTML de servidor + paridade"
```

---

## Task 4: Cor no export `.docx`

**Files:**
- Modify: `packages/export-docx/src/docx.ts:347` (`docxTableBorders`) e a chamada em `makeTable`
- Test: `packages/export-docx/src/__tests__/docx.test.ts`

**Interfaces:**
- Consumes: `cssColorToDocxHex(color?: string): string | undefined` (`docx.ts:659`, já existe).
- Produces: `docxTableBorders(preset: TableBorderPreset | undefined, color?: string)`.

- [ ] **Step 1: Escrever os testes que falham**

Em `packages/export-docx/src/__tests__/docx.test.ts`, dentro do describe "presets de borda de tabela", acrescentar um helper e os casos:

```ts
  async function corDaBorda(preset: string, borderColor?: string): Promise<string> {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const { buffer } = await documentToDocxBuffer([
      {
        type: "table", text: "", delta: [],
        attrs: { rows: 2, cols: 2, borderPreset: preset, ...(borderColor ? { borderColor } : {}) },
        cells,
      },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const xml = await documentXml(buffer);
    const tblBorders = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(xml)?.[1] ?? "";
    return /<w:top\b[^>]*w:color="([^"]+)"/.exec(tblBorders)?.[1] ?? "";
  }

  it("emite a cor escolhida no w:tblBorders", async () => {
    expect(await corDaBorda("all", "#000000")).toBe("000000");
  });

  it("sem cor escolhida emite o padrão CBD5E1", async () => {
    expect(await corDaBorda("all")).toBe("CBD5E1");
  });

  it("cor inválida cai no padrão em vez de emitir lixo", async () => {
    expect(await corDaBorda("all", "não-é-cor")).toBe("CBD5E1");
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/export-docx test -- src/__tests__/docx.test.ts`
Expected: FAIL no primeiro caso — sai `CBD5E1` em vez de `000000`.

- [ ] **Step 3: Implementar**

Em `docxTableBorders`, aceitar a cor e usá-la no `on`:

```ts
function docxTableBorders(preset: TableBorderPreset | undefined, color?: string) {
  // Cor inválida ou ausente cai no padrão: `cssColorToDocxHex` devolve undefined
  // para o que não souber converter.
  const hex = cssColorToDocxHex(color) ?? "CBD5E1";
  const on = { style: BorderStyle.SINGLE, size: 6, color: hex };
  const off = { style: BorderStyle.NONE, size: 0, color: "auto" };
  // …resto inalterado
```

E na chamada dentro de `makeTable`:

```ts
    borders: docxTableBorders(block.attrs.borderPreset, block.attrs.borderColor),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/export-docx test && pnpm --filter @sofereditor/export-docx typecheck`
Expected: PASS, incluindo os seis testes de tabela-verdade dos presets.

- [ ] **Step 5: Commit**

```bash
git add packages/export-docx/src/docx.ts packages/export-docx/src/__tests__/docx.test.ts
git commit -m "feat(export-docx): cor da borda no w:tblBorders"
```

---

## Task 5: Cor no import `.docx` + round-trip

**Files:**
- Modify: `packages/import-docx/src/tables.ts` (`tableToBlock`, novo `readBorderColor`)
- Test: `packages/import-docx/src/__tests__/table-borders.test.ts`
- Test: `packages/import-docx/src/__tests__/round-trip-features.test.ts`

**Interfaces:**
- Consumes: `docxHexToCssColor(hex?: string): string | undefined` (`import-docx/src/units.ts:14`), `findChild`, `attr`.

- [ ] **Step 1: Escrever os testes que falham**

Em `packages/import-docx/src/__tests__/table-borders.test.ts`, acrescentar (o arquivo já tem os helpers `tabela`, `docxFromBody` e `presetDe`):

```ts
async function corDe(bordersXml: string) {
  const doc = await docxBlobToDocument(await docxFromBody(tabela(bordersXml)));
  return doc.blocks.find((b) => b.type === "table")!.attrs.borderColor;
}

describe("import da cor da borda", () => {
  it("lê a cor do primeiro lado ligado", async () => {
    const xml =
      '<w:tblBorders><w:top w:val="single" w:color="000000"/>' +
      '<w:bottom w:val="single" w:color="000000"/>' +
      '<w:left w:val="single" w:color="000000"/><w:right w:val="single" w:color="000000"/>' +
      '<w:insideH w:val="single" w:color="000000"/><w:insideV w:val="single" w:color="000000"/>' +
      "</w:tblBorders>";
    expect(await corDe(xml)).toBe("#000000");
  });

  it("ignora a cor de lados DESLIGADOS", async () => {
    // O Word emite w:val="none" com w:color="auto"; ler dali gravaria lixo.
    const xml =
      '<w:tblBorders><w:top w:val="none" w:color="auto"/>' +
      '<w:bottom w:val="none" w:color="auto"/>' +
      '<w:left w:val="single" w:color="FF0000"/><w:right w:val="single" w:color="FF0000"/>' +
      '<w:insideH w:val="none" w:color="auto"/><w:insideV w:val="single" w:color="FF0000"/>' +
      "</w:tblBorders>";
    expect(await corDe(xml)).toBe("#ff0000");
  });

  it("cor auto não grava o atributo", async () => {
    const xml =
      '<w:tblBorders><w:top w:val="single" w:color="auto"/>' +
      '<w:bottom w:val="single" w:color="auto"/>' +
      '<w:left w:val="single" w:color="auto"/><w:right w:val="single" w:color="auto"/>' +
      '<w:insideH w:val="single" w:color="auto"/><w:insideV w:val="single" w:color="auto"/>' +
      "</w:tblBorders>";
    expect(await corDe(xml)).toBeUndefined();
  });

  it("sem w:color não grava o atributo", async () => {
    expect(await corDe(borders(["top", "bottom", "left", "right", "insideH", "insideV"])))
      .toBeUndefined();
  });

  it("tabela sem tblBorders não grava o atributo", async () => {
    expect(await corDe("")).toBeUndefined();
  });
});
```

Em `packages/import-docx/src/__tests__/round-trip-features.test.ts`, dentro do describe "round-trip: presets de borda":

```ts
  it("preserva a cor da borda", async () => {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const out = await roundTrip([
      {
        type: "table", text: "", delta: [],
        attrs: { rows: 2, cols: 2, borderPreset: "all", borderColor: "#000000" },
        cells,
      },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const t = out.find((b) => b.type === "table");
    expect(t!.attrs.borderColor?.toLowerCase()).toBe("#000000");
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/import-docx test`
Expected: FAIL — `borderColor` indefinido nos casos que esperam cor.

- [ ] **Step 3: Implementar**

Em `packages/import-docx/src/tables.ts`, dentro de `tableToBlock`, logo após a gravação do preset:

```ts
  const borderColor = readBorderColor(tbl);
  if (borderColor) attrs.borderColor = borderColor;
```

E, junto de `readBorderPreset`:

```ts
/**
 * Cor da grade, lida do PRIMEIRO lado LIGADO do `w:tblBorders`.
 *
 * Lados desligados são ignorados de propósito: o Word emite `w:val="none"` com
 * `w:color="auto"`, que não carrega informação de cor — ler dali gravaria lixo.
 * `auto` também não grava, para o documento cair no default do modelo.
 */
function readBorderColor(tbl: OoxmlNode): string | undefined {
  const tblPr = findChild(tbl, "w:tblPr");
  const b = tblPr ? findChild(tblPr, "w:tblBorders") : undefined;
  if (!b) return undefined;
  const LADOS = ["w:top", "w:bottom", "w:left", "w:start", "w:right", "w:end", "w:insideH", "w:insideV"];
  for (const nome of LADOS) {
    const n = findChild(b, nome);
    if (!n) continue;
    const val = (attr(n, "w:val") ?? "").toLowerCase();
    if (val === "" || val === "none" || val === "nil") continue;
    const hex = attr(n, "w:color");
    if (!hex || hex.toLowerCase() === "auto") continue;
    const css = docxHexToCssColor(hex);
    if (css) return css;
  }
  return undefined;
}
```

Acrescentar `docxHexToCssColor` ao import de `./units` no topo de `tables.ts` (conferir se o arquivo já importa algo de lá; se não, criar a linha de import).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/import-docx test && pnpm --filter @sofereditor/import-docx typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/import-docx/src/tables.ts packages/import-docx/src/__tests__/
git commit -m "feat(import-docx): lê a cor do w:tblBorders"
```

---

## Task 6: Controle na toolbar

**Files:**
- Modify: `packages/react/src/Toolbar.tsx` (popover de tabela, após o `<select>` de bordas)

**Interfaces:**
- Consumes: `setTableBorderColor` / `getTableBorderColor` da Task 2; `keepsOwnMouseDown` (já existe no arquivo).

- [ ] **Step 1: Implementar**

No popover de tabela, entre o `</label>` do seletor de bordas e o `<hr />` que precede "Excluir tabela":

```tsx
              <label className="ed-toolbar-label ed-table-bgcolor">
                <span
                  className="ed-toolbar-swatch"
                  aria-hidden
                  style={{ background: editor.getTableBorderColor() ?? TABLE_BORDER_COLOR }}
                />
                Cor da borda
                <input
                  type="color"
                  value={editor.getTableBorderColor() ?? TABLE_BORDER_COLOR}
                  onChange={(e) => editor.setTableBorderColor(e.target.value)}
                  aria-label="Cor da borda"
                />
              </label>
              <button type="button" onClick={() => { setOpen(false); editor.setTableBorderColor(null); }}>
                Restaurar cor padrão
              </button>
```

Importar `TABLE_BORDER_COLOR` de `@sofereditor/core` (junto de `ANSWER_LINE_MAX`, no import de valores).

**Não escreva nenhum handler novo de `mousedown`.** O popover já usa `keepsOwnMouseDown`, que cobre `INPUT` — foi a ausência dessa cobertura que deixou o `<select>` de bordas inerte na 0.4.0.

- [ ] **Step 2: Rodar a suíte**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Verificar no playground**

Run: `pnpm dev`

Roteiro obrigatório:
1. Inserir tabela 3×3, abrir o popover, **abrir o picker de cor** (clique real — não só disparar `change` por script; foi assim que o dropdown quebrado passou despercebido) e escolher preto. A grade fica preta.
2. Trocar entre os cinco presets com a cor preta: **nenhuma linha de texto pode se mover** — a invariante de geometria vale com cor customizada.
3. Preset `none` com cor preta: na tela aparecem as guias cinza-claro, **não** linhas pretas.
4. "Restaurar cor padrão" volta ao cinza `#cbd5e1`.
5. `⌘P`: a cor escolhida sai no PDF, e no preset `none` não sai guia nenhuma.
6. Exportar `.docx`, abrir no Word, conferir a cor. Reimportar e conferir que voltou.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/Toolbar.tsx
git commit -m "feat(react): picker de cor da borda no popover de tabela"
```

---

## Task 7: Verificação final e entrega

- [ ] **Step 1: Suíte completa**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS em tudo. Colar a saída real no relatório — nenhuma alegação de "passando" sem a saída.

- [ ] **Step 2: Relatar ao usuário e PARAR**

Apresentar o resultado e **aguardar autorização explícita** antes de publicar. Quando autorizado, a release é **coordenada nos seis pacotes** (`core` é dependência `workspace:*` de todos — deixar um para trás faz o npm instalar duas cópias do core): minor `0.5.0`, que absorve o fix do dropdown (`0.4.1`) se ele ainda não tiver sido publicado.

---

## Self-review

**Cobertura do spec:**
- `BlockAttrs.borderColor` → T1 ✓
- 4º parâmetro opcional em `cellBorderColors`/`cellBorderStyle` → T1 ✓
- Lados desligados nunca recebem a cor → travado por teste em T1 e T2, e por roteiro manual em T6 item 3 ✓
- Invariante de geometria → teste em T1 (`chaves`) e roteiro em T6 item 2 ✓
- Renderizador do editor → T2 ✓; HTML de servidor → T3 ✓ (incluindo o ramo `if (!cell)`)
- Export `.docx` → T4 ✓; import → T5 ✓; round-trip → T5 ✓; paridade → T3 ✓
- Toolbar com picker + reset → T6 ✓
- Não tocar no CSS nem no blockquote → registrado em "Estrutura de arquivos" ✓
- Não publicar sem autorização → T7 + Global Constraints ✓

**Consistência de tipos:** `borderColor?: string` (T1) é consumido por T2 (`block.attrs.borderColor`), T3 (idem), T4 (`docxTableBorders(preset, color)`) e T5 (grava o atributo). `setTableBorderColor(color: string | null)` / `getTableBorderColor(): string | undefined` (T2) são usados em T6. `TABLE_BORDER_COLOR` é o default em T1, T4 e T6.

**Nota de ordem:** o teste do Step 1 da Task 2 pode nascer verde, porque a Task 1 já entrega o helper. Isso está sinalizado no próprio passo, com a instrução de seguir para o passo do renderizador, que é o que ainda falta — em vez de deixar o implementador achar que errou o teste.
