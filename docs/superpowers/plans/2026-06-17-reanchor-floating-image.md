# Re-anchor Floating Image When Moved Between Pages (bug #9) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an absolutely-positioned floating image (`behind`/`front`) is dragged from one page to another, re-anchor it to a block on the destination page so it stays visible where it was dropped instead of being clipped by the page's `overflow:hidden`. (`wrap-left`/`wrap-right` are float-positioned and are EXCLUDED from re-anchoring — see RESOLVED DECISION.)

**Architecture:** Add a core CRDT command `moveEmbedAnchor` that moves an embed between `Y.Text`s (or within the same `Y.Text`) in a single Y.Doc transaction and sets the selection to the embed's new home. The React `MoveHandle.finish` handler detects the destination page/block from the dropped image's geometry and either keeps the current same-page path (`onCommitMove` → `setImageAttrs`) or invokes a new `onReanchor` callback (→ `moveEmbedAnchor`). A clamp safety net guarantees the image is never dropped into clipped/invisible space.

**Tech Stack:** TypeScript, Yjs (Y.Doc / Y.Text), React 18, Vitest (jsdom), pnpm monorepo (`@sofereditor/core`, `@sofereditor/react`, `apps/playground`).

---

## ✅ RESOLVED DECISION (2026-06-17)

Re-anchoring applies ONLY to `front` and `behind` layouts. `wrap-left`/`wrap-right` are **EXCLUDED**: those layouts are governed by float margins (`marginLeft`/`marginRight`/`marginTop`), not absolute `left`/`top`, so re-anchoring them does not make sense. They keep the same-page `setImageAttrs` path, and `moveEmbedAnchor` is a no-op for them.

**Effect on this plan:**
- Task 1, Step 3: `REANCHORABLE_LAYOUTS` is `new Set(["front", "behind"])`.
- The React side in Task 3 already gates on `layout !== "inline"` for the move handle; the narrowed core guard makes `moveEmbedAnchor` a no-op for wraps, so they fall back to the same-page `setImageAttrs` path.
- Task 1's guard test asserts a wrap layout is a no-op (it does NOT re-anchor).

---

## Global Constraints

- Branch: all work is on `feat/collab-cursors`. Do not create new branches.
- Single CRDT transaction: `moveEmbedAnchor` must perform delete + insert inside ONE `doc.ydoc.transact(fn, COMMAND_ORIGIN)` so Y.UndoManager coalesces it into one undo step and collab peers never observe an intermediate state. Use the existing `transact()` helper in `commands.ts` (line 29) — do NOT call `ydoc.transact` directly.
- Command origin: all mutations go through `COMMAND_ORIGIN` (the `transact` helper already applies it). This is what `TRACKED_ORIGINS` / the UndoManager filter on.
- Embeds count as exactly **1 char** in offset arithmetic (Y.Text length-1 inserts). Mirror `setImageAttrs`'s delta-scan to locate an embed at an offset.
- `core` tests run with: `cd packages/core && pnpm test` (Vitest, jsdom). Test files live in `packages/core/src/__tests__/` and import from `../index`.
- The `core` package re-exports `commands.ts` wholesale via `packages/core/src/index.ts:8` (`export * from "./commands"`), so a new exported function is automatically available from `@sofereditor/core` — no index edit needed.
- React/drag behavior has NO automated DOM harness in the package; it is verified manually in `apps/playground` (`pnpm dev`, port 5173 — `strictPort:false`, so confirm the actual port in the Vite banner).
- Deploy reminder (out of scope for this plan but note it): shipping to the portals requires `pnpm -r build` + republish of `@sofereditor/core` and `@sofereditor/react`. See memory `editor-monorepo-pkg-resolution-dist-vs-src`.

---

## File Structure

- `packages/core/src/commands.ts` — ADD `moveEmbedAnchor` (place it directly after `setImageAttrs`, which ends at line 1716, before `isCommandOrigin` at line 1719). Reuses the existing `transact`, `isImageEmbed`, `ctx.doc.textAt`, `collapsedSelection`-style selection patterns.
- `packages/core/src/__tests__/moveEmbedAnchor.test.ts` — CREATE. Unit tests (jsdom) mirroring the harness style of `images.test.ts`.
- `packages/react/src/useEditor.ts` — ADD `moveEmbedAnchor` to the `EditorAPI` interface (near the image methods around lines 193-201) and to the implementation/return (near `setImageAttrs` at lines 581-592 and the return object near line 742).
- `packages/react/src/ImageResizeOverlay.tsx` — MODIFY: extend `ImageResizeOverlayProps` and `MoveHandleProps`, thread destination-detection inputs into `MoveHandle`, and implement destination-page/block detection + coordinate recompute in `finish`. Add a `findBlockIndex` import.
- `packages/react/src/Editor.tsx` — MODIFY: wire a new `onReanchor` prop on `<ImageResizeOverlay>` (near lines 816-839) that calls `editor.moveEmbedAnchor(...)`. Selection is set inside the core command, so Editor does not re-derive it.
- `packages/react/src/dom-bridge.ts` — (read-only reference) `findBlockIndex` (line 47), `getFragmentForOffset` (line 82). `readFragmentStart` is module-private (line 62) — Task 3 reads `dataset.fragmentStart` inline instead of exporting it.
- `apps/playground/src/App.tsx` — (Task 6 only, temporary) optionally expose `window.__editor = editor` for manual verification; revert before finishing.

---

## Task 1: Core `moveEmbedAnchor` command + unit tests

**Files:**
- Modify: `packages/core/src/commands.ts` (insert new function after `setImageAttrs`, i.e. after line 1716, before `isCommandOrigin` at line 1719)
- Test: `packages/core/src/__tests__/moveEmbedAnchor.test.ts` (create)

**Interfaces:**
- Consumes (existing, already in `commands.ts`):
  - `transact(doc, fn)` — line 29; wraps `doc.ydoc.transact(fn, COMMAND_ORIGIN)`.
  - `CommandContext` — line 23: `{ doc, getSelection, setSelection }`.
  - `ctx.doc.textAt(blockIndex, cellIndex)` — `document.ts:202` returns `Y.Text | undefined`.
  - `isImageEmbed(v)` — `types.ts:201`.
  - `DeltaOp`, `ImageEmbed`, `Position`, `Selection` types (already imported in `commands.ts`, lines 7-18).
  - `collapsedSelection` — imported at `commands.ts:6` (used only for shape reference; here we build an explicit range selection).
- Produces (later tasks rely on this):
  - `export function moveEmbedAnchor(ctx: CommandContext, from: EmbedLoc, to: EmbedLoc, newOffsetX: number, newOffsetY: number): void`
  - `export interface EmbedLoc { blockIndex: number; offset: number; cellIndex?: number }`
  - Side effect: sets selection to the moved embed's new home as a 1-char range (`anchor=landedOffset`, `focus=landedOffset+1`).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/moveEmbedAnchor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  insertImage,
  insertText,
  isImageEmbed,
  moveEmbedAnchor,
  setImageAttrs,
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

function embedAt(doc: EditorDocument, blockIndex: number, offset: number): ImageEmbed | null {
  const yText = doc.textAt(blockIndex, undefined);
  if (!yText) return null;
  const delta = yText.toDelta() as { insert: unknown }[];
  let cursor = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      cursor += op.insert.length;
      continue;
    }
    if (cursor === offset && isImageEmbed(op.insert)) return op.insert as ImageEmbed;
    cursor += 1;
  }
  return null;
}

/** Count image embeds in a block's Y.Text. */
function countEmbeds(doc: EditorDocument, blockIndex: number): number {
  const yText = doc.textAt(blockIndex, undefined);
  if (!yText) return 0;
  const delta = yText.toDelta() as { insert: unknown }[];
  return delta.filter((op) => isImageEmbed(op.insert)).length;
}

/** Add a second paragraph block so we have a real destination block index 1. */
function addSecondBlock(doc: EditorDocument): void {
  doc.blocks.push([
    (function () {
      // Reuse createBlock through the doc's public API by inserting a paragraph
      // via the model. EditorDocument exposes `blocks` (Y.Array of Y.Map). We
      // mirror the shape used elsewhere: a paragraph with an empty Y.Text.
      return doc.makeParagraph();
    })(),
  ]);
}

const BEHIND: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAA",
  width: 100,
  height: 50,
  layout: "behind",
  offsetX: 10,
  offsetY: 20,
  caption: "fig 1",
};

describe("moveEmbedAnchor", () => {
  it("moves a behind embed from block A to block B, preserving attrs and applying new offsets", () => {
    const h = harness();
    // Block 0: "abc" + embed at offset 3
    insertText(h.ctx, "abc");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertImage(h.ctx, BEHIND);
    // Create block 1 = "xyz"
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 4 }));
    // (offset 4 = end of "abc" + 1 embed); split into a new block:
    // simplest: directly insert a second block + text.
    insertText(h.ctx, " "); // placeholder removed below — see note
  });
});
```

> **NOTE on test scaffolding:** `EditorDocument`'s exact paragraph-creation helper must be confirmed against `packages/core/src/document.ts` before finalizing (the `addSecondBlock`/`makeParagraph` lines above are illustrative). The robust, API-agnostic way to get a two-block doc is to use the existing `insertParagraph` command (exported from `commands.ts`) at the caret, which the editor already relies on. Replace the scaffolding with the concrete tests below, which use only confirmed exports (`insertText`, `insertImage`, `insertParagraph`, `moveEmbedAnchor`, `setImageAttrs`).

Replace the file body with these concrete tests (use only confirmed exports — add `insertParagraph` to the import list):

```typescript
import { describe, it, expect } from "vitest";
import {
  EditorDocument,
  collapsedSelection,
  insertImage,
  insertParagraph,
  insertText,
  isImageEmbed,
  moveEmbedAnchor,
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

function embedAt(doc: EditorDocument, blockIndex: number, offset: number): ImageEmbed | null {
  const yText = doc.textAt(blockIndex, undefined);
  if (!yText) return null;
  const delta = yText.toDelta() as { insert: unknown }[];
  let cursor = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      cursor += op.insert.length;
      continue;
    }
    if (cursor === offset && isImageEmbed(op.insert)) return op.insert as ImageEmbed;
    cursor += 1;
  }
  return null;
}

function countEmbeds(doc: EditorDocument, blockIndex: number): number {
  const yText = doc.textAt(blockIndex, undefined);
  if (!yText) return 0;
  const delta = yText.toDelta() as { insert: unknown }[];
  return delta.filter((op) => isImageEmbed(op.insert)).length;
}

const BEHIND: ImageEmbed = {
  type: "image",
  src: "data:image/png;base64,AAA",
  width: 100,
  height: 50,
  layout: "behind",
  offsetX: 10,
  offsetY: 20,
  caption: "fig 1",
};

/** Build a 2-block doc: block 0 = "abc"+embed@3, block 1 = "xyz". */
function twoBlockDoc() {
  const h = harness();
  insertText(h.ctx, "abc");                         // block 0 = "abc"
  insertParagraph(h.ctx);                           // block 1 (empty), caret at (1,0)
  insertText(h.ctx, "xyz");                         // block 1 = "xyz"
  h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
  insertImage(h.ctx, BEHIND);                       // block 0 = "abc"+embed@3
  return h;
}

describe("moveEmbedAnchor", () => {
  it("moves a behind embed from block 0 to block 1, preserving attrs + new offsets", () => {
    const h = twoBlockDoc();
    moveEmbedAnchor(
      h.ctx,
      { blockIndex: 0, offset: 3 },
      { blockIndex: 1, offset: 1 },
      77,
      88,
    );
    // Removed from block 0
    expect(countEmbeds(h.doc, 0)).toBe(0);
    // Landed in block 1 at offset 1 ("x" + embed)
    const e = embedAt(h.doc, 1, 1);
    expect(e).not.toBeNull();
    expect(e?.src).toBe(BEHIND.src);
    expect(e?.width).toBe(100);
    expect(e?.height).toBe(50);
    expect(e?.layout).toBe("behind");
    expect(e?.caption).toBe("fig 1");
    expect(e?.offsetX).toBe(77);
    expect(e?.offsetY).toBe(88);
    // Selection covers the moved embed (anchor=1, focus=2) in block 1
    expect(h.selection.anchor).toMatchObject({ blockIndex: 1, offset: 1 });
    expect(h.selection.focus).toMatchObject({ blockIndex: 1, offset: 2 });
  });

  it("no-ops for an inline embed (no layout)", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    insertParagraph(h.ctx);
    insertText(h.ctx, "xyz");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertImage(h.ctx, {
      type: "image",
      src: "data:image/png;base64,BBB",
      width: 40,
      height: 40,
    }); // no layout => inline
    moveEmbedAnchor(
      h.ctx,
      { blockIndex: 0, offset: 3 },
      { blockIndex: 1, offset: 0 },
      5,
      5,
    );
    // Unchanged: still in block 0, none in block 1
    expect(countEmbeds(h.doc, 0)).toBe(1);
    expect(countEmbeds(h.doc, 1)).toBe(0);
  });

  it("same-Y.Text move with to.offset > from.offset lands at to.offset-1, no dup/loss", () => {
    // block 0 = "ab" + embed@2 + "cde"  (length 6: a b [embed] c d e)
    const h = harness();
    insertText(h.ctx, "abcde");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 2 }));
    insertImage(h.ctx, BEHIND); // now "ab"+embed+"cde", embed at offset 2
    expect(countEmbeds(h.doc, 0)).toBe(1);
    // Move within the same block to offset 5 (past the embed).
    moveEmbedAnchor(
      h.ctx,
      { blockIndex: 0, offset: 2 },
      { blockIndex: 0, offset: 5 },
      33,
      44,
    );
    // Exactly one embed, no duplication, no loss.
    expect(countEmbeds(h.doc, 0)).toBe(1);
    // After deleting at offset 2, text is "abcde"(5) — wait: deleting the embed
    // leaves "abcde" again. Inserting at to.offset-1 = 4 => "abcd"+embed+"e".
    const e = embedAt(h.doc, 0, 4);
    expect(e).not.toBeNull();
    expect(e?.offsetX).toBe(33);
    expect(e?.offsetY).toBe(44);
    expect(h.selection.anchor).toMatchObject({ blockIndex: 0, offset: 4 });
    expect(h.selection.focus).toMatchObject({ blockIndex: 0, offset: 5 });
  });

  it("no-ops for a wrap-left embed (wraps are not re-anchorable — see RESOLVED DECISION at top of plan)", () => {
    const h = harness();
    insertText(h.ctx, "abc");
    insertParagraph(h.ctx);
    insertText(h.ctx, "xyz");
    h.ctx.setSelection(collapsedSelection({ blockIndex: 0, offset: 3 }));
    insertImage(h.ctx, { ...BEHIND, layout: "wrap-left" });
    moveEmbedAnchor(
      h.ctx,
      { blockIndex: 0, offset: 3 },
      { blockIndex: 1, offset: 0 },
      12,
      13,
    );
    // Unchanged: the embed stays put in block 0 and never lands in block 1.
    expect(countEmbeds(h.doc, 0)).toBe(1);
    expect(countEmbeds(h.doc, 1)).toBe(0);
    const e = embedAt(h.doc, 0, 3);
    expect(e?.layout).toBe("wrap-left");
    // Offsets are untouched (the no-op never applies the new coordinates).
    expect(e?.offsetX).toBe(BEHIND.offsetX);
    expect(e?.offsetY).toBe(BEHIND.offsetY);
  });

  it("coalesces into a single undo step", async () => {
    const { EditorHistory } = await import("../history");
    const h = twoBlockDoc();
    const history = new EditorHistory(h.doc);
    moveEmbedAnchor(
      h.ctx,
      { blockIndex: 0, offset: 3 },
      { blockIndex: 1, offset: 1 },
      77,
      88,
    );
    expect(countEmbeds(h.doc, 1)).toBe(1);
    history.undo();
    // One undo restores the embed to block 0 and clears it from block 1.
    expect(countEmbeds(h.doc, 1)).toBe(0);
    expect(countEmbeds(h.doc, 0)).toBe(1);
  });
});
```

> **NOTE:** Before running, confirm `EditorHistory` is the export name in `packages/core/src/history.ts` (the `page-settings.test.ts` undo test at line 67 imports `EditorHistory` from `../history` and calls `history.undo()` — reuse that exact pattern). If the constructor or method differs, mirror whatever `page-settings.test.ts` does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm test -- moveEmbedAnchor`
Expected: FAIL — `moveEmbedAnchor` is not exported (`SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Implement `moveEmbedAnchor`**

In `packages/core/src/commands.ts`, insert immediately after `setImageAttrs` (after line 1716, before `isCommandOrigin` at line 1719):

```typescript
/** Location of an embed in the model (block or table cell). */
export interface EmbedLoc {
  blockIndex: number;
  offset: number;
  cellIndex?: number;
}

/**
 * Layouts whose embed is re-anchorable between Y.Texts. Only `front`/`behind`
 * use absolute `left`/`top`, so only they can be re-anchored. Inline embeds are
 * not positioned absolutely, and `wrap-left`/`wrap-right` are governed by float
 * margins (not absolute coordinates) — both are EXCLUDED and stay on the
 * same-page `setImageAttrs` path (see RESOLVED DECISION at plan header).
 */
const REANCHORABLE_LAYOUTS: ReadonlySet<string> = new Set(["front", "behind"]);

/**
 * Move a floating image embed from `from` to `to` in a SINGLE Y.Doc
 * transaction, applying new positional offsets. Atomic delete+insert keeps the
 * CRDT consistent for collab peers and coalesces into one undo step.
 *
 * Guard: only non-inline (re-anchorable) image embeds are moved; everything
 * else is a no-op. When `from` and `to` resolve to the SAME Y.Text, the insert
 * index is adjusted for the prior delete (mirrors `setImageAttrs`'s clamp at
 * lines 1709-1714). Sets the selection to the embed's new 1-char home so the
 * resize overlay stays attached.
 */
export function moveEmbedAnchor(
  ctx: CommandContext,
  from: EmbedLoc,
  to: EmbedLoc,
  newOffsetX: number,
  newOffsetY: number,
): void {
  transact(ctx.doc, () => {
    const srcText = ctx.doc.textAt(from.blockIndex, from.cellIndex);
    if (!srcText) return;

    // Locate the embed at from.offset via the same delta scan as setImageAttrs.
    const delta = srcText.toDelta() as DeltaOp[];
    let cursor = 0;
    let prev: ImageEmbed | null = null;
    for (const op of delta) {
      if (typeof op.insert === "string") {
        cursor += op.insert.length;
        continue;
      }
      if (cursor === from.offset && isImageEmbed(op.insert)) {
        prev = op.insert;
        break;
      }
      cursor += 1;
    }
    if (!prev) return;

    // Guard: only re-anchor non-inline layouts.
    const layout = prev.layout ?? "inline";
    if (!REANCHORABLE_LAYOUTS.has(layout)) return;

    const dstText = ctx.doc.textAt(to.blockIndex, to.cellIndex);
    if (!dstText) return;

    const merged: ImageEmbed = { ...prev, offsetX: newOffsetX, offsetY: newOffsetY };

    const sameRun = srcText === dstText;

    // Delete the source slot first.
    srcText.delete(from.offset, 1);

    // Compute the landing offset. When same run, the delete shifts indices that
    // were AFTER from.offset down by one. Clamp to the (post-delete) length.
    let landed = to.offset;
    if (sameRun && to.offset > from.offset) {
      landed = to.offset - 1;
    }
    landed = Math.max(0, Math.min(landed, dstText.length));

    dstText.insert(landed, merged as unknown as string);

    ctx.setSelection({
      anchor: { blockIndex: to.blockIndex, cellIndex: to.cellIndex, offset: landed },
      focus: { blockIndex: to.blockIndex, cellIndex: to.cellIndex, offset: landed + 1 },
    });
  });
}
```

> **Same-run note:** `ctx.doc.textAt` returns the same `Y.Text` instance for equal `(blockIndex, cellIndex)`, so `srcText === dstText` correctly identifies the degenerate case. This is consistent with how `setImageAttrs` handles in-place moves via `newOffset`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && pnpm test -- moveEmbedAnchor`
Expected: PASS (all 5 tests).

Then run the full core suite to confirm no regressions:
Run: `cd packages/core && pnpm test`
Expected: PASS (no broken existing tests, e.g. `images.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/commands.ts packages/core/src/__tests__/moveEmbedAnchor.test.ts
git commit -m "feat(core): add moveEmbedAnchor command to re-anchor floating embeds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Expose `moveEmbedAnchor` via `useEditor`

**Files:**
- Modify: `packages/react/src/useEditor.ts` (interface near lines 193-201; import near line 16; implementation near lines 581-592; return object near line 742)

**Interfaces:**
- Consumes: `moveEmbedAnchor` + `EmbedLoc` from `@sofereditor/core` (Task 1).
- Produces: `editor.moveEmbedAnchor(from: EmbedLoc, to: EmbedLoc, newOffsetX: number, newOffsetY: number): void` on the `EditorAPI` object — Task 4 calls this.

> This task has no automated DOM test (it's a thin pass-through inside a React hook with no package test harness). Its correctness is verified by TypeScript compilation (`pnpm -r build` / `tsc`) and exercised in Task 6's manual verification.

- [ ] **Step 1: Import the core command and its type**

In `packages/react/src/useEditor.ts`, near the existing image-command import at line 16 (`setImageAttrs as cmdSetImageAttrs,`), add to the same import block from `@sofereditor/core`:

```typescript
  moveEmbedAnchor as cmdMoveEmbedAnchor,
```

And ensure `EmbedLoc` is imported as a type (in the type import block from `@sofereditor/core`):

```typescript
  type EmbedLoc,
```

- [ ] **Step 2: Add to the `EditorAPI` interface**

In the `EditorAPI` interface, immediately after the `setImageAttrs` signature (ends at line 201), add:

```typescript
  /**
   * Move a floating image embed from one anchor to another (re-anchor across
   * blocks/pages) in a single transaction. No-op for inline embeds.
   */
  moveEmbedAnchor: (
    from: EmbedLoc,
    to: EmbedLoc,
    newOffsetX: number,
    newOffsetY: number,
  ) => void;
```

- [ ] **Step 3: Implement the callback**

In the hook body, immediately after the `setImageAttrs` `useCallback` (ends at line 592), add:

```typescript
  const moveEmbedAnchor = useCallback(
    (from: EmbedLoc, to: EmbedLoc, newOffsetX: number, newOffsetY: number) => {
      cmdMoveEmbedAnchor(ctxRef.current, from, to, newOffsetX, newOffsetY);
    },
    [],
  );
```

- [ ] **Step 4: Add to the returned API object**

In the object returned by `useEditor` (the entry `setImageAttrs,` near line 742), add on the next line:

```typescript
    moveEmbedAnchor,
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/react && pnpm build`
Expected: PASS (TypeScript compiles; `moveEmbedAnchor` and `EmbedLoc` resolve from core).

> If `pnpm build` for `react` depends on `core`'s build output (dist vs src — see memory `editor-monorepo-pkg-resolution-dist-vs-src`), build core first: `cd packages/core && pnpm build`, then `cd packages/react && pnpm build`.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/useEditor.ts
git commit -m "feat(react): expose moveEmbedAnchor on the editor API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Destination-page/block detection in `MoveHandle.finish`

**Files:**
- Modify: `packages/react/src/ImageResizeOverlay.tsx` (import line 12; `ImageResizeOverlayProps` lines 14-27; `MoveHandle` render at lines 184-193; `MoveHandleProps` lines 230-237; `MoveHandle` signature lines 239-246; `finish` lines 299-309)

**Interfaces:**
- Consumes:
  - `findBlockIndex(node, root)` — `dom-bridge.ts:47` → `number | null`.
  - `getFragmentForOffset(root, blockIndex, offset)` — `dom-bridge.ts:82` → `HTMLElement | null` (already imported).
  - `imgRef.current.getBoundingClientRect()` — the live image box after the drag.
  - DOM fragments carry `data-block-index` and `data-fragment-start`; the destination `.ed-page` is the `.ed-page` ancestor of the element under the image center.
  - `embed.layout` (`behind`/`front` use absolute `left`/`top` relative to the `.ed-block` fragment's box — confirmed in `renderInline.tsx:163-171`, with `.ed-page-content .ed-block { position: relative }` in `styles.css:580`).
- Produces:
  - New prop `onReanchor?: (to: { blockIndex: number; offset: number; cellIndex?: number }, newOffsetX: number, newOffsetY: number) => void` on `ImageResizeOverlayProps` and `MoveHandleProps`.
  - `MoveHandle` now also receives `rootRef`, `blockIndex`, `offset`, `cellIndex`.
  - `finish` decides same-page (`onCommit` → existing `onCommitMove`/`setImageAttrs`) vs different-page (`onReanchor`).

> No automated test (no DOM/drag harness in the package). Verified manually in Task 6. Correctness here is structural — the code must compile and the branching logic must match the spec.

- [ ] **Step 1: Add the `findBlockIndex` import**

In `packages/react/src/ImageResizeOverlay.tsx`, change line 12:

```typescript
import { findBlockIndex, getFragmentForOffset } from "./dom-bridge";
```

- [ ] **Step 2: Add `onReanchor` to `ImageResizeOverlayProps`**

In the `ImageResizeOverlayProps` interface (lines 14-27), after `onCommitMove?` (ends at line 26), add:

```typescript
  /**
   * Called once on pointer-up after a move-drag when the image was dropped on a
   * DIFFERENT page than its current anchor. Re-anchors the embed to a block on
   * the destination page. Only fired for non-inline layouts.
   */
  onReanchor?: (
    to: { blockIndex: number; offset: number; cellIndex?: number },
    newOffsetX: number,
    newOffsetY: number,
  ) => void;
```

- [ ] **Step 3: Accept and forward `onReanchor` + context in the overlay**

In the `ImageResizeOverlay` destructured params (lines 44-52), add `onReanchor` to the list:

```typescript
export function ImageResizeOverlay({
  rootRef,
  blockIndex,
  offset,
  cellIndex,
  embed,
  onCommit,
  onCommitMove,
  onReanchor,
}: ImageResizeOverlayProps): JSX.Element | null {
```

Then in the `<MoveHandle ... />` render (lines 185-192), pass the new props:

```typescript
        <MoveHandle
          layout={layout}
          startOffsetX={embed.offsetX ?? 0}
          startOffsetY={embed.offsetY ?? 0}
          imgRef={imgRef}
          onCommit={onCommitMove!}
          onLiveChange={measure}
          rootRef={rootRef}
          blockIndex={blockIndex}
          offset={offset}
          cellIndex={cellIndex}
          onReanchor={onReanchor}
        />
```

> Keep the existing `movable` gate (line 176) unchanged: `const movable = layout !== "inline" && onCommitMove !== undefined;`. `onReanchor` is optional; when absent, `finish` falls back to the same-page commit.

- [ ] **Step 4: Extend `MoveHandleProps` and the `MoveHandle` signature**

Replace `MoveHandleProps` (lines 230-237) with:

```typescript
interface MoveHandleProps {
  layout: "wrap-left" | "wrap-right" | "behind" | "front" | "inline";
  startOffsetX: number;
  startOffsetY: number;
  imgRef: RefObject<HTMLImageElement | null>;
  onCommit: (ox: number, oy: number) => void;
  onLiveChange: () => void;
  rootRef: RefObject<HTMLDivElement>;
  blockIndex: number;
  offset: number;
  cellIndex?: number;
  onReanchor?: (
    to: { blockIndex: number; offset: number; cellIndex?: number },
    newOffsetX: number,
    newOffsetY: number,
  ) => void;
}
```

And update the `MoveHandle` destructure (lines 239-246):

```typescript
function MoveHandle({
  layout,
  startOffsetX,
  startOffsetY,
  imgRef,
  onCommit,
  onLiveChange,
  rootRef,
  blockIndex,
  offset,
  cellIndex,
  onReanchor,
}: MoveHandleProps): JSX.Element {
```

- [ ] **Step 5: Implement destination detection in `finish`**

Replace the `finish` function (lines 299-309) with:

```typescript
  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const img = imgRef.current;
    const root = rootRef.current;
    const liveOX = Math.round(d.liveOX);
    const liveOY = Math.round(d.liveOY);

    // Tables / wrap-anchors-in-cell are out of scope: keep the current path.
    // Re-anchoring only happens for non-inline embeds dropped on a DIFFERENT
    // top-level page, with onReanchor wired.
    if (!img || !root || onReanchor === undefined || cellIndex != null) {
      onCommit(liveOX, liveOY);
      return;
    }

    const imgRect = img.getBoundingClientRect();
    const centerX = imgRect.left + imgRect.width / 2;
    const centerY = imgRect.top + imgRect.height / 2;

    // Destination page = the .ed-page under the image CENTER (handles images
    // spanning two pages — anchor by the center).
    const dropEl = document.elementFromPoint(centerX, centerY) as HTMLElement | null;
    const destPage = dropEl?.closest<HTMLElement>(".ed-page") ?? null;

    // Current anchor page = the page owning the current fragment.
    const currentFrag = getFragmentForOffset(root, blockIndex, offset);
    const currentPage = currentFrag?.closest<HTMLElement>(".ed-page") ?? null;

    // Same page (or no destination page resolved) → existing same-anchor path.
    if (destPage == null || destPage === currentPage) {
      onCommit(liveOX, liveOY);
      return;
    }

    // ---- Re-anchor to a block on the destination page ----
    // Pick the destination anchor fragment:
    //  1) the block fragment under the image's TOP-LEFT corner, if it's inside
    //     the destination page;
    //  2) else the LAST block fragment rendered on the destination page.
    let destFrag: HTMLElement | null = null;
    const cornerEl = document.elementFromPoint(imgRect.left, imgRect.top) as HTMLElement | null;
    const cornerBlock = cornerEl
      ? cornerEl.closest<HTMLElement>("[data-block-index]")
      : null;
    if (cornerBlock && destPage.contains(cornerBlock)) {
      destFrag = cornerBlock;
    } else {
      const frags = destPage.querySelectorAll<HTMLElement>("[data-block-index]");
      destFrag = frags.length > 0 ? frags[frags.length - 1] : null;
    }

    // Empty destination page (no block fragments) → safety net (Task 5): keep
    // the same-anchor path with the live offsets (clamp handles visibility).
    if (!destFrag) {
      onCommit(liveOX, liveOY);
      return;
    }

    const destBlockIndex = findBlockIndex(destFrag, root);
    if (destBlockIndex == null) {
      onCommit(liveOX, liveOY);
      return;
    }

    // Destination offset = the fragment's first rendered offset (fragmentStart),
    // so the anchor lands in the FRACTION of the block that lives on this page.
    const destOffset = destFrag.dataset.fragmentStart
      ? Number.parseInt(destFrag.dataset.fragmentStart, 10) || 0
      : 0;

    // Recompute absolute coordinates relative to the destination fragment box.
    // behind/front render position:absolute; left:ox; top:oy relative to the
    // .ed-block fragment (position:relative). So ox = imgLeft - fragLeft.
    const fragRect = destFrag.getBoundingClientRect();
    const newOffsetX = Math.round(imgRect.left - fragRect.left);
    const newOffsetY = Math.round(imgRect.top - fragRect.top);

    onReanchor(
      { blockIndex: destBlockIndex, offset: destOffset, cellIndex: undefined },
      newOffsetX,
      newOffsetY,
    );
  };
```

> **Coordinate note:** For `behind`/`front` the wrapper is `position:absolute; left:ox; top:oy` relative to the `.ed-block` fragment's padding-box (`.ed-page-content .ed-block { position: relative }`, no border on `.ed-block`, so padding-box top-left == `getBoundingClientRect()` top-left). `imgRect.left - fragRect.left` therefore reproduces the dropped position. `wrap-left`/`wrap-right` are EXCLUDED from re-anchoring (see RESOLVED DECISION): their offsets are float margins, not absolute, so the core guard makes `moveEmbedAnchor` a no-op for them and they stay on the same-page `setImageAttrs` path — `finish` never reaches the re-anchor branch for a wrap because `onReanchor` resolves to a no-op in core.

- [ ] **Step 6: Typecheck**

Run: `cd packages/react && pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/ImageResizeOverlay.tsx
git commit -m "feat(react): detect destination page/block on image drop in MoveHandle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire `onReanchor` in `Editor.tsx`

**Files:**
- Modify: `packages/react/src/Editor.tsx` (`<ImageResizeOverlay>` props at lines 816-839)

**Interfaces:**
- Consumes: `editor.moveEmbedAnchor` (Task 2); `selectedEmbed` (`{ blockIndex, offset, cellIndex?, embed }`, already used at lines 819-822).
- Produces: nothing for later tasks — this completes the React wiring.

> No automated test. Selection is set INSIDE `moveEmbedAnchor` (Task 1), so Editor must NOT re-derive or overwrite the selection after the call — doing so would drift from the clamped landing offset and detach the overlay. Verified manually in Task 6.

- [ ] **Step 1: Pass `onReanchor` to the overlay**

In `packages/react/src/Editor.tsx`, in the `<ImageResizeOverlay ... />` element (lines 817-839), after the `onCommitMove={...}` prop (ends at line 838), add:

```typescript
          onReanchor={(to, ox, oy) =>
            editor.moveEmbedAnchor(
              {
                blockIndex: selectedEmbed.blockIndex,
                offset: selectedEmbed.offset,
                cellIndex: selectedEmbed.cellIndex,
              },
              to,
              ox,
              oy,
            )
          }
```

> Do not add any `setSelection` call here. `moveEmbedAnchor` already sets the selection to the moved embed's new 1-char home (`anchor=landed`, `focus=landed+1`), which keeps the resize overlay attached after re-anchor.

- [ ] **Step 2: Typecheck**

Run: `cd packages/react && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/Editor.tsx
git commit -m "feat(react): wire onReanchor to moveEmbedAnchor in Editor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Clamp safety net (no clipped/invisible image)

**Files:**
- Modify: `packages/react/src/ImageResizeOverlay.tsx` (`finish`, the no-destination-page and empty-page fallback branches added in Task 3)

**Interfaces:**
- Consumes: the destination-page detection from Task 3; the destination `.ed-page-content` content box.
- Produces: an invariant — after any move, the committed `offsetY` keeps the image's top within the anchor page's content box, so the image is never clipped by `overflow:hidden`.

> No automated test (geometry depends on real layout). Verified manually in Task 6 (drop beyond the last page).

- [ ] **Step 1: Add a clamp helper inside `finish` for the same-page / fallback path**

In `ImageResizeOverlay.tsx`, the same-page commit path currently calls `onCommit(liveOX, liveOY)` with the raw live offsets. Replace the bare `onCommit(liveOX, liveOY)` calls in the SAME-PAGE / fallback branches of `finish` (added in Task 3) with a clamped variant. Add this helper just above `finish` (inside the `MoveHandle` function body, alongside the other handlers):

```typescript
  // Clamp the live vertical offset so the image's top stays within the anchor
  // page's content box (never clipped by .ed-page-content overflow:hidden).
  // For behind/front the offset is relative to the .ed-block fragment, so we
  // translate the content-box bounds into fragment-local coordinates.
  const clampedCommit = (ox: number, oy: number) => {
    const img = imgRef.current;
    const root = rootRef.current;
    if (!img || !root || (layout !== "behind" && layout !== "front")) {
      onCommit(ox, oy);
      return;
    }
    const frag = getFragmentForOffset(root, blockIndex, offset);
    const page = frag?.closest<HTMLElement>(".ed-page");
    const content = page?.querySelector<HTMLElement>(".ed-page-content");
    if (!frag || !content) {
      onCommit(ox, oy);
      return;
    }
    const fragRect = frag.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const imgH = img.getBoundingClientRect().height;
    // Allowed top range in fragment-local px: [contentTop, contentBottom-imgH].
    const minLocalTop = contentRect.top - fragRect.top;
    const maxLocalTop = contentRect.bottom - fragRect.top - imgH;
    const clampedY = Math.max(minLocalTop, Math.min(oy, maxLocalTop));
    onCommit(ox, Math.round(clampedY));
  };
```

- [ ] **Step 2: Route the same-page / fallback commits through `clampedCommit`**

In `finish` (from Task 3), replace each same-page / fallback `onCommit(liveOX, liveOY)` (the early-return guards, the same-page branch, the empty-page fallback, and the `destBlockIndex == null` fallback) with `clampedCommit(liveOX, liveOY)`.

> Keep the cross-page `onReanchor(...)` call unclamped — re-anchoring already moves the image to a fragment on the destination page where the dropped coordinates are valid by construction. (A future enhancement could clamp there too, but it is out of scope.)

- [ ] **Step 3: Typecheck**

Run: `cd packages/react && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/ImageResizeOverlay.tsx
git commit -m "feat(react): clamp same-page image drop to page content box (safety net)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Manual browser verification in `apps/playground`

**Files:**
- (Optional, temporary) Modify: `apps/playground/src/App.tsx` — expose `window.__editor` for inspection; REVERT before finishing.

**Interfaces:** none (manual). This is the acceptance gate for the React/drag behavior the package cannot unit-test.

> **IMPORTANT — spec ambiguity:** the task brief says the playground "uses `window.__editor`", but `apps/playground/src/App.tsx` does NOT currently expose it (only `window.__lastSnapshotHtml` exists, set in `saveSnapshot`/App). The steps below add a temporary `window.__editor` to make model inspection possible, then revert it. If you prefer purely-visual verification, skip the temporary exposure and rely on the screenshots.

- [ ] **Step 1: (Optional) Temporarily expose the editor for inspection**

In `apps/playground/src/App.tsx`, inside `App()` after `const editor = useEditor();` (line 37), add a dev-only effect:

```typescript
  if (typeof window !== "undefined") {
    (window as unknown as { __editor?: typeof editor }).__editor = editor;
  }
```

> This is a throwaway debugging aid. It MUST be reverted in Step 7.

- [ ] **Step 2: Start the playground**

Run: `cd /Users/rafaelmarreca/Desktop/marreca-dev/AlefPeretz/editor-monorepo && pnpm --filter playground dev`
(or `cd apps/playground && pnpm dev`)
Expected: Vite serves on port 5173 (or the next free port — read the banner). Open the URL in Chrome.

> If `react`/`core` resolve to built `dist` rather than live `src`, build them first: `pnpm --filter @sofereditor/core build && pnpm --filter @sofereditor/react build`. See memory `editor-monorepo-pkg-resolution-dist-vs-src` — `core`/`react` typically load `src` live, so a plain `pnpm dev` usually suffices.

- [ ] **Step 3: Reproduce the bug fix — cross-page re-anchor (`behind`)**

1. Insert enough paragraphs to fill page 1 and spill onto page 2 (A4).
2. Insert an image, set its layout to **behind** (or **front**), anchored to a block near the top of page 1.
3. Drag the image (via the move handle) DOWN across the page-1/page-2 boundary and drop it visually onto page 2.

Expected:
- The image REMAINS VISIBLE where you dropped it on page 2 (no disappearing-behind-pagination).
- `document.elementFromPoint(center)` at the drop point returns the `<img>`, not `null`.
- Inspect via `window.__editor.snapshot` (or `getSelectedEmbed`): the embed's `blockIndex` now points to a block on page 2, and `offsetX/offsetY` reflect the drop position.
- The resize overlay (handles + outline) stays attached to the image after the drop.

- [ ] **Step 4: No regression — same-page move**

Drag a `behind`/`front` image WITHIN a single page and drop it.

Expected:
- The image moves to the new spot; offsets change.
- The embed's `blockIndex`/`offset` are UNCHANGED (no re-anchor — `onCommitMove` → `setImageAttrs` path).

- [ ] **Step 5: Clamp — drop beyond the last page**

Drag a `behind`/`front` image and drop it past the bottom of the last page (into empty space below all pages).

Expected:
- The image does NOT disappear: its `offsetY` is clamped so the top stays within the nearest page's content box and it remains painted.

- [ ] **Step 6: Take confirmation screenshots**

Use Chrome DevTools (or the chrome-devtools MCP) to capture:
- before drag (image on page 1),
- after cross-page re-anchor (image visible on page 2 with overlay attached),
- after drop-beyond-last-page (image clamped, still visible).

Attach these to the task review.

- [ ] **Step 7: Revert the temporary `window.__editor` exposure**

Remove the snippet added in Step 1 from `apps/playground/src/App.tsx`.

Run: `git diff apps/playground/src/App.tsx`
Expected: empty (no residual debug code).

- [ ] **Step 8: Final verification + commit (no app changes expected)**

Run: `cd packages/core && pnpm test`
Expected: PASS.

If `App.tsx` is clean (Step 7), there is nothing to commit for this task. If you made any non-debug fixes during manual verification, commit them with a descriptive message and `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Self-Review

**Spec coverage:**
- §Arquitetura 1 (core `moveEmbedAnchor`, single transaction, delta scan, guard, same-anchor handling) → Task 1.
- §Arquitetura 2 (destination detection: `elementFromPoint`+`.ed-page`, current page via `getFragmentForOffset`, same vs different page, `findBlockIndex` fallback to last fragment, `fragmentStart` offset, coordinate recompute, `onReanchor`) → Task 3; `Editor` wiring → Task 4.
- §Arquitetura 3 (clamp safety net) → Task 5.
- §Arquitetura 4 (selection update to the moved embed) → handled in-core in Task 1 (`ctx.setSelection` to `anchor=landed, focus=landed+1`); Editor deliberately does not re-derive (Task 4 note).
- §Componentes table (`useEditor` exposes the command) → Task 2.
- §Edge cases: image spanning 2 pages → center anchoring (Task 3 Step 5); fragmented destination block → `fragmentStart` offset (Task 3); empty space drop → last fragment fallback (Task 3); empty destination page → clamp (Task 5); tables/`cellIndex` out of scope → `cellIndex != null` keeps current path (Task 3 Step 5); export/collab unaffected (model-only change, single transaction).
- §Testes (core unit tests; React manual) → Task 1 (5 unit tests) + Task 6 (manual).

**Type consistency:** `EmbedLoc` defined in Task 1 is imported and used in Task 2 and referenced structurally in Tasks 3-4 (the React layer uses the inline `{ blockIndex; offset; cellIndex? }` shape, structurally compatible with `EmbedLoc`). `moveEmbedAnchor(from, to, newOffsetX, newOffsetY)` signature is identical across Tasks 1, 2, 4. `onReanchor(to, newOffsetX, newOffsetY)` signature is identical across Tasks 3 and 4.

**Placeholder scan:** No TBD/TODO. Two scaffolding `NOTE`s in Task 1 flag exact things to confirm against `document.ts`/`history.ts` before running (paragraph creation helper and `EditorHistory` name) — the final concrete test code uses only confirmed exports (`insertText`, `insertParagraph`, `insertImage`, `moveEmbedAnchor`).

## Execution Handoff

Plan complete and saved. Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
