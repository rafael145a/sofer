import * as Y from "yjs";
import { defaultAttrsFor } from "./schema";
import {
  DEFAULT_PAGE_SETTINGS,
  detectPreset,
  type PageSettings,
} from "./page-settings";
import {
  isLegacySerializedDocument,
  type BlockAttrs,
  type BlockType,
  type CellAttrs,
  type DeltaOp,
  type LegacySerializedDocument,
  type SerializedBlock,
  type SerializedCell,
  type SerializedDocument,
} from "./types";

/**
 * Gera um id estável de bloco. Usado para ancorar cursores colaborativos
 * remotos (fallback) e para keying estável no overlay. Persistido no Y.Map do
 * bloco, então sobrevive a reload (binário Yjs). Docs antigos não têm — os
 * helpers de cursor lidam com a ausência (caem na RelativePosition).
 */
export function newBlockId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ambiente sem crypto.randomUUID — fallback abaixo */
  }
  return `b-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Lê o id de um bloco Y.Map (undefined em docs antigos sem id). */
export function getBlockId(block: Y.Map<unknown>): string | undefined {
  const id = block.get("id");
  return typeof id === "string" ? id : undefined;
}

/**
 * Y.js-backed document.
 *
 * Storage layout:
 *   ydoc.getArray("blocks") : Y.Array<Y.Map>
 *     each Y.Map ("block"):
 *       - type:  string ("paragraph" | "heading" | "blockquote" | "codeBlock" | "listItem" | "table")
 *       - text:  Y.Text  (NOT present on tables)
 *       - attrs: Y.Map<unknown> (align, dir, level, language… plus rows/cols for tables)
 *       - cells: Y.Array<Y.Map> (only on tables, length = rows * cols, row-major)
 *           each cell map: { text: Y.Text, attrs: Y.Map<unknown> }
 *
 * Block-level attrs live inside a nested Y.Map so concurrent edits (e.g. two users
 * changing alignment at once) reconcile through Yjs' last-write-wins per key.
 */
export class EditorDocument {
  readonly ydoc: Y.Doc;
  readonly blocks: Y.Array<Y.Map<unknown>>;
  /** Document-level settings (page size, margins). See `getPageSettings`. */
  readonly docSettings: Y.Map<unknown>;

  constructor(ydoc?: Y.Doc) {
    this.ydoc = ydoc ?? new Y.Doc();
    this.blocks = this.ydoc.getArray<Y.Map<unknown>>("blocks");
    this.docSettings = this.ydoc.getMap<unknown>("docSettings");

    if (this.blocks.length === 0) {
      this.ydoc.transact(() => {
        this.blocks.push([createBlock("paragraph")]);
      }, "init");
    }
  }

  /**
   * Returns the current page settings. Missing fields fall back to
   * `DEFAULT_PAGE_SETTINGS`. The returned object is a fresh snapshot — mutating
   * it does not write back to the Y.Doc. Use `setPageSettings` for that.
   */
  getPageSettings(): PageSettings {
    const m = this.docSettings;
    const pick = <K extends keyof PageSettings>(key: K): PageSettings[K] | undefined => {
      const v = m.get(key as string);
      return typeof v === "number" || typeof v === "string" ? (v as PageSettings[K]) : undefined;
    };
    const merged: PageSettings = {
      width: pick("width") ?? DEFAULT_PAGE_SETTINGS.width,
      height: pick("height") ?? DEFAULT_PAGE_SETTINGS.height,
      marginTop: pick("marginTop") ?? DEFAULT_PAGE_SETTINGS.marginTop,
      marginBottom: pick("marginBottom") ?? DEFAULT_PAGE_SETTINGS.marginBottom,
      marginLeft: pick("marginLeft") ?? DEFAULT_PAGE_SETTINGS.marginLeft,
      marginRight: pick("marginRight") ?? DEFAULT_PAGE_SETTINGS.marginRight,
      systemHeaderTitle: pick("systemHeaderTitle"),
      systemHeaderAuthor: pick("systemHeaderAuthor"),
    };
    merged.preset = detectPreset(merged.width, merged.height);
    return merged;
  }

  /**
   * Merge `partial` into the docSettings Y.Map. Runs in a `ydoc.transact` with
   * origin `"pageSettings"` (NOT tracked by the UndoManager, mirroring the
   * `"import"` convention from Fase 9.5).
   */
  setPageSettings(partial: Partial<PageSettings>): void {
    this.ydoc.transact(() => {
      for (const [k, v] of Object.entries(partial)) {
        if (k === "preset") continue; // derived, never stored
        if (v === undefined) continue;
        this.docSettings.set(k, v);
      }
    }, "pageSettings");
  }

  /** Listen for page-settings changes. Returns an unsubscribe function. */
  observePageSettings(cb: () => void): () => void {
    const handler = () => cb();
    this.docSettings.observe(handler);
    return () => this.docSettings.unobserve(handler);
  }

  getBlock(index: number): Y.Map<unknown> | undefined {
    if (index < 0 || index >= this.blocks.length) return undefined;
    return this.blocks.get(index);
  }

  getBlockText(index: number): Y.Text | undefined {
    const b = this.getBlock(index);
    return b?.get("text") as Y.Text | undefined;
  }

  getBlockType(index: number): BlockType | undefined {
    const b = this.getBlock(index);
    return b?.get("type") as BlockType | undefined;
  }

  getBlockAttrsMap(index: number): Y.Map<unknown> | undefined {
    const b = this.getBlock(index);
    return b?.get("attrs") as Y.Map<unknown> | undefined;
  }

  getBlockAttrs(index: number): BlockAttrs {
    const m = this.getBlockAttrsMap(index);
    if (!m) return {};
    return Object.fromEntries(m.entries()) as BlockAttrs;
  }

  blockCount(): number {
    return this.blocks.length;
  }

  // ---------- Table helpers ----------

  isTable(index: number): boolean {
    return this.getBlockType(index) === "table";
  }

  /** Returns rows/cols read from the block's attrs map. `{0,0}` for non-table blocks. */
  getTableSize(index: number): { rows: number; cols: number } {
    const attrs = this.getBlockAttrs(index);
    const rows = typeof attrs.rows === "number" ? attrs.rows : 0;
    const cols = typeof attrs.cols === "number" ? attrs.cols : 0;
    return { rows, cols };
  }

  getCells(index: number): Y.Array<Y.Map<unknown>> | undefined {
    const b = this.getBlock(index);
    return b?.get("cells") as Y.Array<Y.Map<unknown>> | undefined;
  }

  getCell(blockIndex: number, cellIndex: number): Y.Map<unknown> | undefined {
    const cells = this.getCells(blockIndex);
    if (!cells) return undefined;
    if (cellIndex < 0 || cellIndex >= cells.length) return undefined;
    return cells.get(cellIndex);
  }

  getCellText(blockIndex: number, cellIndex: number): Y.Text | undefined {
    const cell = this.getCell(blockIndex, cellIndex);
    return cell?.get("text") as Y.Text | undefined;
  }

  getCellAttrsMap(blockIndex: number, cellIndex: number): Y.Map<unknown> | undefined {
    const cell = this.getCell(blockIndex, cellIndex);
    return cell?.get("attrs") as Y.Map<unknown> | undefined;
  }

  getCellAttrs(blockIndex: number, cellIndex: number): CellAttrs {
    const m = this.getCellAttrsMap(blockIndex, cellIndex);
    if (!m) return {};
    return Object.fromEntries(m.entries()) as CellAttrs;
  }

  /**
   * Returns the editable Y.Text targeted by a position:
   * - When `cellIndex` is set: the cell's text (or the owner's text if the
   *   target cell is covered by a span — we treat the covered position as
   *   addressing the owner).
   * - Otherwise: the block's own text.
   */
  textAt(blockIndex: number, cellIndex: number | undefined): Y.Text | undefined {
    if (cellIndex == null) return this.getBlockText(blockIndex);
    const real = this.realCellIndex(blockIndex, cellIndex);
    if (real == null) return undefined;
    return this.getCellText(blockIndex, real);
  }

  /**
   * Returns the "real" (non-covered) cell index for a target cell. When the
   * target is already a real cell, returns it unchanged. When covered, walks
   * up-and-left to find the owner.
   *
   * The walk is robust to oversized or non-rectangular spans by skipping
   * candidates whose declared span doesn't actually cover the target.
   */
  realCellIndex(blockIndex: number, cellIndex: number): number | undefined {
    if (!this.isTable(blockIndex)) return undefined;
    const { rows, cols } = this.getTableSize(blockIndex);
    if (rows <= 0 || cols <= 0) return undefined;
    if (cellIndex < 0 || cellIndex >= rows * cols) return undefined;
    const targetAttrs = this.getCellAttrs(blockIndex, cellIndex);
    if (targetAttrs.covered !== true) return cellIndex;

    const tRow = Math.floor(cellIndex / cols);
    const tCol = cellIndex - tRow * cols;
    // Scan candidate owners — any real cell (or, oc) with or <= tRow, oc <= tCol,
    // spanning into (tRow, tCol). Walk from (tRow, tCol) up-and-left.
    for (let or = tRow; or >= 0; or--) {
      for (let oc = tCol; oc >= 0; oc--) {
        const idx = or * cols + oc;
        if (idx === cellIndex) continue;
        const a = this.getCellAttrs(blockIndex, idx);
        if (a.covered === true) continue;
        const rs = spanOf(a.rowspan);
        const cs = spanOf(a.colspan);
        if (or + rs - 1 >= tRow && oc + cs - 1 >= tCol) return idx;
      }
    }
    return undefined;
  }

  /**
   * Replace the document contents with a `SerializedDocument`. Runs in a single
   * `ydoc.transact` with origin `"import"` so the UndoManager can group or skip
   * the operation as one step.
   *
   * Reuses `createBlock` / `createTableBlock` so every block ends up with the
   * exact same Y.js shape produced by the rest of the editor.
   */
  loadFromJSON(serialized: SerializedDocument | LegacySerializedDocument): void {
    const { blocks: sourceBlocks, pageSettings } = normalizeSerialized(serialized);
    // Lock anti-concorrência: `loadFromJSON` é destrutivo (clear+push) e
    // dois imports concorrentes (especialmente entre clientes via CRDT)
    // historicamente produziram blocks duplicados em massa (caso 172k).
    // Marker em `docSettings.__importLock` com TTL 5s — se outro import
    // foi iniciado < 5s atrás, este aborta com warning ao invés de
    // sobrescrever. A janela de 5s cobre a latência de rede do Hocuspocus
    // entre clients durante imports humanos típicos.
    const LOCK_KEY = "__importLock";
    const LOCK_TTL_MS = 5_000;
    const existing = this.docSettings.get(LOCK_KEY);
    if (typeof existing === "number" && Date.now() - existing < LOCK_TTL_MS) {
      const ageMs = Date.now() - existing;
      console.warn(
        `[EditorDocument.loadFromJSON] import já em andamento (${ageMs}ms atrás, TTL ${LOCK_TTL_MS}ms) — ignorando esta chamada para evitar duplicação de blocks.`,
      );
      return;
    }
    this.docSettings.set(LOCK_KEY, Date.now());
    this.ydoc.transact(() => {
      if (this.blocks.length > 0) {
        this.blocks.delete(0, this.blocks.length);
      }
      // Build the Y structure in two passes: first create empty blocks (with
      // correct type/attrs/cells shape) and push them so their inner Y.Texts
      // get integrated into the document; only then apply each delta. Y.Text
      // requires an active transaction context that exists for integrated
      // instances — `applyDelta` on a detached Y.Text throws.
      const sources = sourceBlocks.length > 0 ? sourceBlocks : [makeEmptyParagraphSource()];
      const fresh: Y.Map<unknown>[] = sources.map((b) => buildEmptyBlockFromSerialized(b));
      this.blocks.push(fresh);

      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        const yBlock = this.blocks.get(i);
        applyDeltaIntoBlock(yBlock, src);
      }

      if (pageSettings) {
        for (const [k, v] of Object.entries(pageSettings)) {
          if (k === "preset") continue;
          if (v === undefined) continue;
          this.docSettings.set(k, v);
        }
      }
      // Limpa o lock no fim do import (mesma transaction "import"). Se
      // crashar antes daqui, o TTL de 5s expira a entrada e o doc volta a
      // aceitar imports.
      this.docSettings.delete(LOCK_KEY);
    }, "import");
  }

  /** Build a fresh `EditorDocument` from a `SerializedDocument`. */
  static fromJSON(serialized: SerializedDocument | LegacySerializedDocument): EditorDocument {
    const ydoc = new Y.Doc();
    // Touch the shared array before loadFromJSON so the constructor doesn't
    // insert its default paragraph — we replace the contents anyway.
    ydoc.getArray<Y.Map<unknown>>("blocks");
    const doc = new EditorDocument(ydoc);
    doc.loadFromJSON(serialized);
    return doc;
  }

  toJSON(): SerializedDocument {
    const blocks = this.blocks.toArray().map<SerializedBlock>((b) => {
      const type = (b.get("type") as BlockType) ?? "paragraph";
      const attrsMap = b.get("attrs") as Y.Map<unknown> | undefined;
      const attrs = attrsMap ? (Object.fromEntries(attrsMap.entries()) as BlockAttrs) : {};

      // NOTA: o `id` do bloco NÃO entra no serialized_json (mantém a forma do
      // JSON estável p/ bloat-check/API e os testes de round-trip). O id vive no
      // Y.Map e persiste no binário Yjs — é onde os cursores precisam dele.
      if (type === "table") {
        const cellsArray = b.get("cells") as Y.Array<Y.Map<unknown>> | undefined;
        const cells: SerializedCell[] = cellsArray
          ? cellsArray.toArray().map((c) => serializeCell(c))
          : [];
        return {
          type,
          text: "",
          delta: [],
          attrs,
          cells,
        };
      }

      const yText = b.get("text") as Y.Text | undefined;
      return {
        type,
        text: yText?.toString() ?? "",
        delta: (yText?.toDelta() as DeltaOp[] | undefined) ?? [],
        attrs,
      };
    });
    return { blocks, pageSettings: this.getPageSettings() };
  }
}

function normalizeSerialized(
  v: SerializedDocument | LegacySerializedDocument,
): { blocks: SerializedBlock[]; pageSettings?: PageSettings } {
  if (isLegacySerializedDocument(v)) {
    return { blocks: v };
  }
  return { blocks: v.blocks, pageSettings: v.pageSettings };
}

function serializeCell(c: Y.Map<unknown>): SerializedCell {
  const yText = c.get("text") as Y.Text | undefined;
  const attrsMap = c.get("attrs") as Y.Map<unknown> | undefined;
  return {
    text: yText?.toString() ?? "",
    delta: (yText?.toDelta() as DeltaOp[] | undefined) ?? [],
    attrs: attrsMap ? (Object.fromEntries(attrsMap.entries()) as Record<string, unknown>) : {},
  };
}

export function createBlock(
  type: BlockType,
  initialText = "",
  attrs?: BlockAttrs,
): Y.Map<unknown> {
  if (type === "table") {
    // Callers that need a table should use createTableBlock(rows, cols).
    // We honor any rows/cols passed via attrs but default to 1x1 to keep the
    // invariant `cells.length === rows * cols` non-zero.
    const merged = { ...defaultAttrsFor("table"), ...(attrs ?? {}) };
    const rows = typeof merged.rows === "number" && merged.rows > 0 ? Math.trunc(merged.rows) : 1;
    const cols = typeof merged.cols === "number" && merged.cols > 0 ? Math.trunc(merged.cols) : 1;
    return createTableBlock(rows, cols);
  }

  const block = new Y.Map<unknown>();
  block.set("id", newBlockId());
  block.set("type", type);
  const yText = new Y.Text();
  if (initialText.length > 0) yText.insert(0, initialText);
  block.set("text", yText);
  const attrsMap = new Y.Map<unknown>();
  const merged = { ...defaultAttrsFor(type), ...(attrs ?? {}) };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) attrsMap.set(k, v);
  }
  block.set("attrs", attrsMap);
  return block;
}

/**
 * Build a table block with `rows × cols` empty cells.
 * Cells are stored in row-major order: `cell[row * cols + col]`.
 */
export function createTableBlock(rows: number, cols: number): Y.Map<unknown> {
  const r = Math.max(1, Math.trunc(rows));
  const c = Math.max(1, Math.trunc(cols));
  const block = new Y.Map<unknown>();
  block.set("id", newBlockId());
  block.set("type", "table");
  const attrsMap = new Y.Map<unknown>();
  attrsMap.set("rows", r);
  attrsMap.set("cols", c);
  block.set("attrs", attrsMap);
  const cells = new Y.Array<Y.Map<unknown>>();
  const total = r * c;
  const fresh: Y.Map<unknown>[] = [];
  for (let i = 0; i < total; i++) fresh.push(createCell());
  cells.push(fresh);
  block.set("cells", cells);
  return block;
}

export function createCell(attrs?: CellAttrs): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("text", new Y.Text());
  const attrsMap = new Y.Map<unknown>();
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) continue;
      attrsMap.set(k, v);
    }
  }
  m.set("attrs", attrsMap);
  return m;
}

function makeEmptyParagraphSource(): SerializedBlock {
  return { type: "paragraph", text: "", delta: [], attrs: {} };
}

function buildEmptyBlockFromSerialized(block: SerializedBlock): Y.Map<unknown> {
  if (block.type === "table") {
    const rows =
      typeof block.attrs.rows === "number" ? Math.max(1, Math.trunc(block.attrs.rows)) : 1;
    const cols =
      typeof block.attrs.cols === "number" ? Math.max(1, Math.trunc(block.attrs.cols)) : 1;
    const yBlock = new Y.Map<unknown>();
    yBlock.set("id", typeof block.id === "string" ? block.id : newBlockId());
    yBlock.set("type", "table");
    const attrsMap = new Y.Map<unknown>();
    attrsMap.set("rows", rows);
    attrsMap.set("cols", cols);
    for (const [k, v] of Object.entries(block.attrs)) {
      if (k === "rows" || k === "cols") continue;
      if (v === undefined) continue;
      attrsMap.set(k, v);
    }
    yBlock.set("attrs", attrsMap);
    const cellsArr = new Y.Array<Y.Map<unknown>>();
    const total = rows * cols;
    const fresh: Y.Map<unknown>[] = [];
    const cells = block.cells ?? [];
    for (let i = 0; i < total; i++) {
      const src = cells[i];
      fresh.push(createCell((src?.attrs ?? undefined) as CellAttrs | undefined));
    }
    cellsArr.push(fresh);
    yBlock.set("cells", cellsArr);
    return yBlock;
  }
  const yb = createBlock(block.type, "", block.attrs);
  // Preserva o id serializado (round-trip JSON), senão usa o gerado em createBlock.
  if (typeof block.id === "string") yb.set("id", block.id);
  return yb;
}

function applyDeltaIntoBlock(yBlock: Y.Map<unknown> | undefined, src: SerializedBlock): void {
  if (!yBlock) return;
  if (src.type === "table") {
    const cellsArr = yBlock.get("cells") as Y.Array<Y.Map<unknown>> | undefined;
    if (!cellsArr) return;
    const cells = src.cells ?? [];
    for (let i = 0; i < cellsArr.length; i++) {
      const cellSrc = cells[i];
      if (!cellSrc || !cellSrc.delta || cellSrc.delta.length === 0) continue;
      const cell = cellsArr.get(i);
      const yText = cell.get("text") as Y.Text | undefined;
      if (!yText) continue;
      yText.applyDelta(cellSrc.delta as unknown as Array<{ insert: unknown; attributes?: unknown }>);
    }
    return;
  }
  if (!src.delta || src.delta.length === 0) return;
  const yText = yBlock.get("text") as Y.Text | undefined;
  if (!yText) return;
  yText.applyDelta(src.delta as unknown as Array<{ insert: unknown; attributes?: unknown }>);
}

/** Coerce a `rowspan`/`colspan` attribute value into a positive integer. */
export function spanOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}
