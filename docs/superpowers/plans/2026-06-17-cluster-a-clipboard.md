# Cluster A — Clipboard (copy/cut/paste) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar copy/cut/paste com fidelidade interna (marks + imagens) no editor Sofer, corrigindo #7 (copiar imagem), #8 (colar mantém formatação) e #14 (recortar de fato apaga).

**Architecture:** Um "slice" de clipboard reaproveita `SerializedBlock[]` (A1). `@sofereditor/core` ganha `clipboard.ts` (serialize/flatten) + comandos `insertSlice`/`deleteSelection` que usam as primitivas existentes `writeDeltaInto`/`deleteRange`/`sliceDelta`/`createBlock`. `@sofereditor/react` ganha handlers DOM `onCopy`/`onCut`/`onPaste` que ligam o clipboard ao core via MIME custom `application/x-sofer-slice` + fallback `text/plain`.

**Tech Stack:** TypeScript, Y.js (CRDT), Vitest, React, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-17-cluster-a-clipboard-design.md`.

**Convenções do repo:**
- Testes core em `packages/core/src/__tests__/*.test.ts`, vitest. `harness()` = `new EditorDocument()` (1 parágrafo vazio) + `CommandContext` com `getSelection`/`setSelection` sobre `selection` local. Comando de teste: `pnpm --filter @sofereditor/core test -- <substring>`.
- Exports do core são automáticos via `export * from "./..."` em `index.ts`.
- Primitivas (todas em `packages/core/src/commands.ts`, module-private salvo nota): `writeDeltaInto(yText, pos, delta): number` (reaplica delta com marks+embeds, retorna pos final), `deleteRange(doc, sel): Selection` (deleta range, retorna seleção colapsada). De `marks.ts`: `sliceDelta(delta, start, end)`, `deltaLength(delta)`. De `selection.ts`: `isCollapsed(sel)`, `orderedRange(sel)`, `collapsedSelection(pos)`. De `document.ts`: `createBlock(type, "", attrs)`, `doc.textAt(blockIndex, cellIndex)`, `doc.getBlockText(i)`, `doc.getBlockType(i)`, `doc.getBlockAttrs(i)`, `doc.blocks` (Y.Array).

---

## File Structure

- **Create** `packages/core/src/clipboard.ts` — tipo `ClipboardSlice`, `SOFER_MIME`, `serializeSelection`, `sliceToText`, `sliceToInlineDelta`. Sem dependência de `commands.ts` (evita ciclo).
- **Modify** `packages/core/src/commands.ts` — `insertSlice`, `deleteSelection` (usam `writeDeltaInto`/`deleteRange` locais + `sliceToInlineDelta` de clipboard.ts).
- **Create** `packages/core/src/__tests__/clipboard.test.ts` — testes de serialize + round-trip.
- **Modify** `packages/react/src/Editor.tsx` — handlers `onCopy`/`onCut`/`onPaste`; simplificar case `insertFromPaste`.
- `packages/core/src/index.ts` — sem edição (re-export automático).

---

## Task 1 — core `clipboard.ts`: serialização da seleção (TDD)

**Files:**
- Create: `packages/core/src/clipboard.ts`
- Test: `packages/core/src/__tests__/clipboard.test.ts`

- [ ] **Step 1: Escrever o arquivo `clipboard.ts`**

```ts
import type { EditorDocument } from "./document";
import type { DeltaOp, Selection, SerializedBlock } from "./types";
import { deltaLength, sliceDelta } from "./marks";
import { isCollapsed, orderedRange } from "./selection";

/** MIME custom que carrega o slice serializado no clipboard. */
export const SOFER_MIME = "application/x-sofer-slice";

export interface ClipboardSlice {
  /** 1..n blocos; cada delta carrega marks + embeds de imagem. */
  blocks: SerializedBlock[];
  /** 1º bloco é fragmento parcial → mescla inline no alvo da colagem. */
  openStart: boolean;
  /** último bloco é fragmento parcial → conteúdo após o caret continua nele. */
  openEnd: boolean;
}

/** Texto puro de um delta (embeds não contribuem caractere visível). */
function deltaToText(delta: DeltaOp[]): string {
  let s = "";
  for (const op of delta) if (typeof op.insert === "string") s += op.insert;
  return s;
}

/** Monta um SerializedBlock inline a partir de um delta já fatiado.
 *  Para conteúdo vindo de célula (cellIndex != null) o bloco vira "paragraph"
 *  (células não têm tipo de bloco próprio). */
function blockFromDelta(
  doc: EditorDocument,
  blockIndex: number,
  cellIndex: number | undefined,
  delta: DeltaOp[],
): SerializedBlock {
  if (cellIndex != null) {
    return { type: "paragraph", text: deltaToText(delta), delta, attrs: {} };
  }
  return {
    type: doc.getBlockType(blockIndex),
    text: deltaToText(delta),
    delta,
    attrs: doc.getBlockAttrs(blockIndex),
  };
}

/**
 * Lê a seleção e produz um ClipboardSlice, ou null se:
 * - a seleção está colapsada (nada a copiar);
 * - âncora e foco estão em células diferentes (multi-célula — fora da v1);
 * - a seleção multi-bloco inclui uma tabela (fora da v1).
 */
export function serializeSelection(
  doc: EditorDocument,
  sel: Selection,
): ClipboardSlice | null {
  if (isCollapsed(sel)) return null;
  const { start, end } = orderedRange(sel);
  if ((start.cellIndex ?? -1) !== (end.cellIndex ?? -1)) return null;

  // Mesmo text-run (mesmo bloco, ou mesma célula).
  if (start.blockIndex === end.blockIndex) {
    const yText = doc.textAt(start.blockIndex, start.cellIndex);
    if (!yText) return null;
    const delta = sliceDelta(yText.toDelta() as DeltaOp[], start.offset, end.offset);
    return {
      blocks: [blockFromDelta(doc, start.blockIndex, start.cellIndex, delta)],
      openStart: start.offset > 0,
      openEnd: end.offset < yText.length,
    };
  }

  // Multi-bloco: precisa ser texto de bloco normal (sem células) e sem tabela.
  if (start.cellIndex != null || end.cellIndex != null) return null;
  for (let i = start.blockIndex; i <= end.blockIndex; i++) {
    if (doc.getBlockType(i) === "table") return null;
  }
  const startText = doc.getBlockText(start.blockIndex);
  const endText = doc.getBlockText(end.blockIndex);
  if (!startText || !endText) return null;

  const blocks: SerializedBlock[] = [];
  blocks.push(
    blockFromDelta(
      doc,
      start.blockIndex,
      undefined,
      sliceDelta(startText.toDelta() as DeltaOp[], start.offset, startText.length),
    ),
  );
  for (let i = start.blockIndex + 1; i < end.blockIndex; i++) {
    const t = doc.getBlockText(i);
    blocks.push(blockFromDelta(doc, i, undefined, (t?.toDelta() as DeltaOp[]) ?? []));
  }
  blocks.push(
    blockFromDelta(
      doc,
      end.blockIndex,
      undefined,
      sliceDelta(endText.toDelta() as DeltaOp[], 0, end.offset),
    ),
  );
  return {
    blocks,
    openStart: start.offset > 0,
    openEnd: end.offset < endText.length,
  };
}

/** Fallback texto puro: textos dos blocos unidos por "\n". */
export function sliceToText(slice: ClipboardSlice): string {
  return slice.blocks.map((b) => deltaToText(b.delta)).join("\n");
}

/** Achata o slice num único delta inline (para colar dentro de uma célula,
 *  que não pode conter estrutura de bloco). Fronteiras de bloco somem. */
export function sliceToInlineDelta(slice: ClipboardSlice): DeltaOp[] {
  const out: DeltaOp[] = [];
  for (const b of slice.blocks) out.push(...b.delta);
  return out;
}

// `deltaLength` é reexportado implicitamente por index; usado por insertSlice em commands.ts.
export { deltaLength };
```

> Nota: o `export { deltaLength }` no fim é só conveniência; se causar conflito de re-export com `marks.ts` no `index.ts`, remova-o — `insertSlice` importa `deltaLength` direto de `./marks`. (Decida no Step 4 conforme o typecheck.)

- [ ] **Step 2: Escrever os testes de serialização**

Create `packages/core/src/__tests__/clipboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  insertImage,
  insertText,
  serializeSelection,
  setBlockType,
  sliceToText,
  toggleMark,
  type CommandContext,
  type ImageEmbed,
  type Selection,
} from "../index";

function harness() {
  const doc = new EditorDocument();
  let selection: Selection = collapsedSelection({ blockIndex: 0, offset: 0 });
  const ctx: CommandContext = {
    doc,
    getSelection: () => selection,
    setSelection: (s) => {
      selection = s;
    },
  };
  return { ctx, doc, get selection() { return selection; } };
}

const IMG: ImageEmbed = { type: "image", src: "data:image/png;base64,AAA", width: 10, height: 10 };

function select(ctx: CommandContext, sel: Selection) { ctx.setSelection(sel); }

describe("clipboard — serializeSelection", () => {
  it("returns null for a collapsed selection", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    expect(serializeSelection(h.doc, h.selection)).toBeNull();
  });

  it("serializes within-block rich text preserving marks", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    // bold the range [1,4] -> "bcd"
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    toggleMark(h.ctx, "bold");
    // select [1,4] again and serialize
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].delta).toEqual([{ insert: "bcd", attributes: { bold: true } }]);
    expect(slice.openStart).toBe(true);  // start offset 1 > 0
    expect(slice.openEnd).toBe(true);    // end offset 4 < 6
  });

  it("serializes a single image embed", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    insertImage(h.ctx, IMG); // embed at offset 1, occupies 1 char -> text is a[img]b
    // select the embed [1,2]
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 2 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(1);
    expect(slice.blocks[0].delta).toEqual([{ insert: IMG }]);
  });

  it("serializes a multi-block selection preserving block types and open flags", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);                       // block 1
    insertText(h.ctx, "world");
    setBlockType(h.ctx, "heading", { level: 2 }); // block 1 is now a heading
    select(h.ctx, { anchor: { blockIndex: 0, offset: 2 }, focus: { blockIndex: 1, offset: 3 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(slice.blocks).toHaveLength(2);
    expect(slice.blocks[0].type).toBe("paragraph");
    expect(slice.blocks[0].delta).toEqual([{ insert: "llo" }]);
    expect(slice.blocks[1].type).toBe("heading");
    expect(slice.blocks[1].delta).toEqual([{ insert: "wor" }]);
    expect(slice.openStart).toBe(true);
    expect(slice.openEnd).toBe(true);
  });

  it("sliceToText joins block texts with newlines", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 5 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    expect(sliceToText(slice)).toBe("hello\nworld");
  });
```

Add `insertParagraph` to the imports.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- clipboard`
Expected: FAIL — `serializeSelection is not exported` / module `clipboard` not found.

- [ ] **Step 4: Adicionar `export * from "./clipboard";` no index e typecheck**

Edit `packages/core/src/index.ts`: add a line `export * from "./clipboard";` (após `export * from "./commands";`). Run `pnpm --filter @sofereditor/core typecheck`. If it complains about a duplicate `deltaLength` re-export, remove the `export { deltaLength }` line from `clipboard.ts` (Step 1 nota).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test -- clipboard`
Expected: PASS (todos os testes de serialização).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/clipboard.ts packages/core/src/index.ts packages/core/src/__tests__/clipboard.test.ts
git commit -m "feat(core): clipboard.ts — serializeSelection + sliceToText/Inline (cluster A)"
```

---

## Task 2 — core `insertSlice` + `deleteSelection` (TDD)

**Files:**
- Modify: `packages/core/src/commands.ts`
- Test: `packages/core/src/__tests__/clipboard.test.ts`

- [ ] **Step 1: Escrever os testes de round-trip e cut**

Append to `clipboard.test.ts` (add imports `insertSlice`, `deleteSelection`):

```ts
describe("clipboard — insertSlice / deleteSelection", () => {
  it("pastes within-block rich text inline, preserving marks", () => {
    const h = harness();
    // source: "XbcdY" with "bcd" bold; copy [1,4]
    insertText(h.ctx, "XbcdY");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    toggleMark(h.ctx, "bold");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    // Build a clean empty paragraph target deterministically (do NOT use a
    // selection-respecting command here — the source selection is still the
    // non-collapsed [1,4] range and would be deleted).
    h.doc.blocks.insert(1, [createBlock("paragraph", "")]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 1, offset: 0 }));
    insertSlice(h.ctx, slice);
    const delta = h.doc.getBlockText(1)!.toDelta();
    expect(delta).toEqual([{ insert: "bcd", attributes: { bold: true } }]);
    expect(h.selection.focus).toEqual({ blockIndex: 1, offset: 3 });
  });

  it("pastes a single image embed", () => {
    const h = harness();
    insertText(h.ctx, "ab");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 1 }));
    insertImage(h.ctx, IMG);                 // a[img]b
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 2 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    // paste at offset 0 of the same block
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 0 }));
    insertSlice(h.ctx, slice);
    // now block 0 = [img] a [img] b  -> two embeds
    const delta = h.doc.getBlockText(0)!.toDelta() as { insert: unknown }[];
    const embeds = delta.filter((op) => typeof op.insert !== "string");
    expect(embeds).toHaveLength(2);
  });

  it("pastes a multi-block slice merging open ends", () => {
    const h = harness();
    // source: paragraph "hello" + heading "world"; copy [0:2 .. 1:3] = "llo"/"wor"
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    setBlockType(h.ctx, "heading", { level: 2 });
    select(h.ctx, { anchor: { blockIndex: 0, offset: 2 }, focus: { blockIndex: 1, offset: 3 } });
    const slice = serializeSelection(h.doc, h.selection)!;
    // Build a clean paragraph target "PQRS" as block 2 (deterministic — avoids
    // mutating via the still-non-collapsed source selection). Caret at offset 3.
    h.doc.blocks.insert(2, [createBlock("paragraph", "PQRS")]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 2, offset: 3 }));
    insertSlice(h.ctx, slice);
    // openStart -> "llo" merges into "PQR" => block2 = "PQRllo" (paragraph)
    // openEnd  -> "wor" + tail "S" on a new heading => "worS"
    expect(h.doc.getBlockText(2)!.toString()).toBe("PQRllo");
    expect(h.doc.getBlockType(2)).toBe("paragraph");
    expect(h.doc.getBlockText(3)!.toString()).toBe("worS");
    expect(h.doc.getBlockType(3)).toBe("heading");
    expect(h.selection.focus).toEqual({ blockIndex: 3, offset: 3 }); // end of "wor", before "S"
  });

  it("flattens a multi-block slice when pasting into a table cell", () => {
    const h = harness();
    insertText(h.ctx, "hello");
    insertParagraph(h.ctx);
    insertText(h.ctx, "world");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 0 }, focus: { blockIndex: 1, offset: 5 } });
    const slice = serializeSelection(h.doc, h.selection)!; // ["hello","world"]
    // Build a 1×1 table as block 2 deterministically and put caret in cell 0.
    h.doc.blocks.insert(2, [createTableBlock(1, 1)]);
    h.ctx.setSelection(collapsedSelection({ blockIndex: 2, cellIndex: 0, offset: 0 }));
    insertSlice(h.ctx, slice);
    // flattened: "helloworld" inline in the cell (block break dropped)
    expect(h.doc.getCellText(2, 0)!.toString()).toBe("helloworld");
  });

  it("deleteSelection removes the selected range and collapses the caret", () => {
    const h = harness();
    insertText(h.ctx, "abcdef");
    select(h.ctx, { anchor: { blockIndex: 0, offset: 1 }, focus: { blockIndex: 0, offset: 4 } });
    deleteSelection(h.ctx);
    expect(h.doc.getBlockText(0)!.toString()).toBe("aef");
    expect(h.selection.focus).toEqual({ blockIndex: 0, offset: 1 });
  });
});
```

Add to the test imports (from `"../index"`): `insertSlice`, `deleteSelection`, `createBlock`, `createTableBlock`. (`insertText`, `insertParagraph`, `toggleMark`, `setBlockType`, `insertImage`, `serializeSelection`, `collapsedSelection` já entraram no Task 1.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @sofereditor/core test -- clipboard`
Expected: FAIL — `insertSlice`/`deleteSelection` not exported.

- [ ] **Step 3: Implementar `deleteSelection` e `insertSlice` em `commands.ts`**

Add the import of the slice helper near the top of `commands.ts` (it already imports from `./marks`; add a new import line):
```ts
import { sliceToInlineDelta, type ClipboardSlice } from "./clipboard";
```
Also ensure `deltaLength` is imported from `./marks` (the file imports `sliceDelta` from `./marks` — extend that import to include `deltaLength`).

Add both commands (place them after `setCellAttr`, near the other top-level commands):
```ts
/** Delete the current selection range and collapse the caret. Used by cut. */
export function deleteSelection(ctx: CommandContext): void {
  transact(ctx.doc, () => {
    const s = deleteRange(ctx.doc, ctx.getSelection());
    ctx.setSelection(s);
  });
}

/**
 * Replace the current selection with a clipboard slice (A1).
 * - Single-block slice → inline splice (Dhead + S0 + Dtail), target keeps its type.
 * - Multi-block slice → openStart merges S0 inline; middle/last blocks inserted
 *   discretely; openEnd appends the post-caret tail onto the last pasted block.
 * - Target inside a table cell → slice flattened to inline (no block structure).
 */
export function insertSlice(ctx: CommandContext, slice: ClipboardSlice): void {
  if (!slice.blocks || slice.blocks.length === 0) return;
  transact(ctx.doc, () => {
    let sel = ctx.getSelection();
    if (!isCollapsed(sel)) sel = deleteRange(ctx.doc, sel);
    const { blockIndex, cellIndex, offset } = sel.focus;

    // Paste into a table cell: flatten to inline.
    if (cellIndex != null) {
      const cellText = ctx.doc.textAt(blockIndex, cellIndex);
      if (!cellText) return;
      const after = writeDeltaInto(cellText, offset, sliceToInlineDelta(slice));
      ctx.setSelection(collapsedSelection({ blockIndex, cellIndex, offset: after }));
      return;
    }

    const targetText = ctx.doc.getBlockText(blockIndex);
    if (!targetText) return;

    // Split target at caret: tailDelta = content after the caret; remove it from target.
    const full = targetText.toDelta() as DeltaOp[];
    const tailDelta = sliceDelta(full, offset, deltaLength(full));
    targetText.delete(offset, targetText.length - offset);

    const blocks = slice.blocks;

    // Single-block slice → pure inline splice.
    if (blocks.length === 1) {
      const afterS0 = writeDeltaInto(targetText, offset, blocks[0].delta);
      writeDeltaInto(targetText, afterS0, tailDelta);
      ctx.setSelection(collapsedSelection({ blockIndex, offset: afterS0 }));
      return;
    }

    // Multi-block.
    let insertAt = blockIndex;
    // First block.
    if (slice.openStart) {
      writeDeltaInto(targetText, offset, blocks[0].delta); // merge into target (keeps its type)
    } else {
      const b = createBlock(blocks[0].type, "", blocks[0].attrs);
      writeDeltaInto(b.get("text") as Y.Text, 0, blocks[0].delta);
      ctx.doc.blocks.insert(++insertAt, [b]);
    }
    // Middle blocks (whole).
    for (let i = 1; i < blocks.length - 1; i++) {
      const b = createBlock(blocks[i].type, "", blocks[i].attrs);
      writeDeltaInto(b.get("text") as Y.Text, 0, blocks[i].delta);
      ctx.doc.blocks.insert(++insertAt, [b]);
    }
    // Last block.
    const last = blocks[blocks.length - 1];
    if (slice.openEnd) {
      const b = createBlock(last.type, "", last.attrs);
      const t = b.get("text") as Y.Text;
      const caretPos = writeDeltaInto(t, 0, last.delta);
      writeDeltaInto(t, caretPos, tailDelta);
      ctx.doc.blocks.insert(++insertAt, [b]);
      ctx.setSelection(collapsedSelection({ blockIndex: insertAt, offset: caretPos }));
    } else {
      const b = createBlock(last.type, "", last.attrs);
      const lastLen = writeDeltaInto(b.get("text") as Y.Text, 0, last.delta);
      ctx.doc.blocks.insert(++insertAt, [b]);
      const lastIdx = insertAt;
      // Tail continues as its own block, with the target's original type.
      const tb = createBlock(
        ctx.doc.getBlockType(blockIndex),
        "",
        ctx.doc.getBlockAttrs(blockIndex),
      );
      writeDeltaInto(tb.get("text") as Y.Text, 0, tailDelta);
      ctx.doc.blocks.insert(++insertAt, [tb]);
      ctx.setSelection(collapsedSelection({ blockIndex: lastIdx, offset: lastLen }));
    }
  });
}
```

Confirm these are already imported in `commands.ts`: `Y` (`import * as Y from "yjs"`), `createBlock`, `collapsedSelection`, `isCollapsed`, `sliceDelta`. They are (lines 1–5, 18). Add `deltaLength` to the `./marks` import and the `clipboard` import shown above.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @sofereditor/core test -- clipboard`
Expected: PASS (round-trip, embed, multi-block merge, cell-flatten, deleteSelection).

- [ ] **Step 5: Typecheck + suíte completa do core**

Run: `pnpm --filter @sofereditor/core typecheck && pnpm --filter @sofereditor/core test`
Expected: sem erros; tudo verde (nenhuma regressão — `insertSlice`/`deleteSelection` são adições).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/commands.ts packages/core/src/__tests__/clipboard.test.ts
git commit -m "feat(core): insertSlice + deleteSelection (cluster A)"
```

---

## Task 3 — react handlers `onCopy`/`onCut`/`onPaste` (playground-verify)

> Sem unit test: `@sofereditor/react` roda `vitest run --passWithNoTests` e não tem harness de DOM. Verificação = typecheck + playground (controlador, após a task).

**Files:**
- Modify: `packages/react/src/Editor.tsx`

- [ ] **Step 1: Importar as APIs de clipboard do core**

No bloco de imports de `@sofereditor/core` em `Editor.tsx`, adicionar: `serializeSelection`, `insertSlice`, `deleteSelection`, `sliceToText`, `SOFER_MIME` (valores) e `type ClipboardSlice`.

- [ ] **Step 2: Adicionar um `useEffect` que registra copy/cut/paste**

Logo após o `useEffect` que registra o `beforeinput` (o que termina em `root.removeEventListener("beforeinput", handler)`), adicionar:

```ts
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const writeSlice = (e: ClipboardEvent): boolean => {
      const ctx = ctxRef.current;
      const slice = serializeSelection(ctx.doc, ctx.getSelection());
      if (!slice || !e.clipboardData) return false;
      e.clipboardData.setData(SOFER_MIME, JSON.stringify(slice));
      e.clipboardData.setData("text/plain", sliceToText(slice));
      return true;
    };

    const onCopy = (e: ClipboardEvent) => {
      if (writeSlice(e)) e.preventDefault();
    };

    const onCut = (e: ClipboardEvent) => {
      if (writeSlice(e)) {
        e.preventDefault();
        deleteSelection(ctxRef.current);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      const ctx = ctxRef.current;
      const cd = e.clipboardData;
      if (!cd) return;
      // 1) Our own rich slice.
      const raw = cd.getData(SOFER_MIME);
      if (raw) {
        try {
          const slice = JSON.parse(raw) as ClipboardSlice;
          if (slice && Array.isArray(slice.blocks)) {
            e.preventDefault();
            insertSlice(ctx, slice);
            return;
          }
        } catch {
          // fall through to plain handling
        }
      }
      // 2) Image files (OS paste).
      const images = Array.from(cd.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (images.length > 0) {
        e.preventDefault();
        void (async () => {
          for (const f of images) await editorRef.current.insertImageFromFile(f);
        })();
        return;
      }
      // 3) Plain text.
      const text = cd.getData("text/plain");
      if (text.length === 0) return;
      e.preventDefault();
      const lines = text.split(/\r\n|\r|\n/);
      lines.forEach((line, i) => {
        if (i > 0) insertParagraph(ctx);
        if (line.length > 0) insertText(ctx, line);
      });
    };

    root.addEventListener("copy", onCopy);
    root.addEventListener("cut", onCut);
    root.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("copy", onCopy);
      root.removeEventListener("cut", onCut);
      root.removeEventListener("paste", onPaste);
    };
  }, []);
```

`insertText`, `insertParagraph` já estão importados (usados no `beforeinput`). `ctxRef`, `rootRef`, `editorRef` já existem no componente.

- [ ] **Step 3: Neutralizar o case `insertFromPaste` do `beforeinput`**

Em `Editor.tsx`, no `switch (type)` do `beforeinput`, substituir o corpo do `case "insertFromPaste":` (linhas ~430-448) por:
```ts
        case "insertFromPaste": {
          // Paste é tratado pelo handler `paste` (onPaste no useEffect de clipboard),
          // que faz preventDefault antes deste beforeinput disparar. Mantido como
          // no-op defensivo caso algum navegador role o beforeinput mesmo assim.
          e.preventDefault();
          return;
        }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @sofereditor/react typecheck && pnpm --filter @sofereditor/core typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/Editor.tsx
git commit -m "feat(react): onCopy/onCut/onPaste com fidelidade de marks+imagens (cluster A #7/#8/#14)"
```

---

## Verificação final (controlador, no playground)

Sem cobertura automática do lado React — verificar em Chrome real:
- [ ] **#8 (paste mantém formatação):** digitar texto, deixar um trecho em negrito, selecionar e copiar (Ctrl/Cmd+C), colar noutro ponto → negrito preservado. Conferir o delta no SNAPSHOT/console.
- [ ] **#14 (cut recorta):** selecionar texto, Ctrl/Cmd+X → texto some do ponto original; colar noutro lugar → reaparece.
- [ ] **#7 (copiar imagem):** inserir imagem, selecioná-la, Ctrl/Cmd+C, colar → segunda imagem aparece (SNAPSHOT `images` incrementa).
- [ ] Probe: colar dentro de uma célula de tabela um conteúdo multi-bloco → vira texto inline na célula (sem quebrar a tabela).
- [ ] Probe: colar texto puro vindo de fora (ex.: outro app) → entra como parágrafos, sem erro.

---

## Self-review (preenchido)

- **Cobertura do spec:** `serializeSelection`/`sliceToText`/`sliceToInlineDelta` → Task 1. `insertSlice` (regra de merge + cell-flatten) + `deleteSelection` → Task 2. Handlers `onCopy`/`onCut`/`onPaste` + simplificação do `insertFromPaste` → Task 3. MIME `SOFER_MIME` + fallback `text/plain` → Tasks 1/3. Guardas (colapsada→null, multi-célula→null, tabela→null) → Task 1. Tratamento de erro de paste malformado → Task 3 (try/catch). Todos cobertos.
- **Sem placeholders:** o stub do teste multi-bloco no Task 1 Step 2 é explicitamente substituído pela versão concreta logo abaixo (instrução + código completo). Nenhum "TODO" remanescente.
- **Consistência de tipos:** `ClipboardSlice { blocks, openStart, openEnd }` e `SOFER_MIME` definidos no Task 1, usados em Tasks 2/3. `serializeSelection`/`insertSlice`/`deleteSelection`/`sliceToText`/`sliceToInlineDelta` com as mesmas assinaturas em todas as tasks. `writeDeltaInto` retorna `number` (pos final), usado para o caret. `deleteRange` retorna `Selection`.
- **Fronteiras:** tabela multi-bloco e multi-célula → `null` (fallback plain text); paste em célula → flatten. Coerente com o escopo aprovado.
