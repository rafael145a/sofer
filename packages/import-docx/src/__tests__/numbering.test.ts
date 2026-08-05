import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SerializedBlock } from "@sofereditor/core";
import { docxBlobToDocument, pruneNonLeaderListStarts } from "../docx";

// Reconstrói os rótulos como o RENDERER: grupos por adjacência; listStart no
// líder semeia o <ol start>; itens de continuação incrementam. Espelha a
// mesma convenção do extract-prova-texto dos portais.
function rotulosOrdenados(blocks: SerializedBlock[]): string[] {
  const out: string[] = [];
  const counters: number[] = [];
  let prevIsItem = false;
  for (const b of blocks) {
    if (b.type !== "listItem" || (b.attrs.listKind ?? "bullet") !== "ordered") {
      prevIsItem = b.type === "listItem";
      continue;
    }
    const level = b.attrs.listLevel ?? 0;
    counters[level] =
      typeof b.attrs.listStart === "number" ? b.attrs.listStart : (counters[level] ?? 0) + 1;
    counters.length = level + 1;
    const style = b.attrs.listStyle ?? "decimal";
    const n = counters[level];
    const label =
      style === "lower-alpha" ? String.fromCharCode(96 + n)
      : style === "upper-alpha" ? String.fromCharCode(64 + n)
      : String(n);
    out.push(`${label}. ${b.text.slice(0, 30)}`);
    prevIsItem = true;
  }
  return out;
}

const item = (
  text: string,
  attrs: SerializedBlock["attrs"],
): SerializedBlock => ({ type: "listItem", text, delta: [], attrs });
const para = (text: string): SerializedBlock => ({ type: "paragraph", text, delta: [], attrs: {} });

describe("pruneNonLeaderListStarts", () => {
  it("mantém a numeração Word através de parágrafos comuns (linhas de resposta)", () => {
    const blocks = [
      item("Q um", { listKind: "ordered", listLevel: 0, listStart: 1, listStyle: "decimal" }),
      para("R: ______"),
      item("Q dois", { listKind: "ordered", listLevel: 0, listStart: 2, listStyle: "decimal" }),
      para("R: ______"),
      item("Q três", { listKind: "ordered", listLevel: 0, listStart: 3, listStyle: "decimal" }),
    ];
    pruneNonLeaderListStarts(blocks);
    // Cada item vira líder do próprio grupo (parágrafo quebra a adjacência) —
    // todos preservam o listStart com o número Word.
    expect(blocks.filter((b) => b.type === "listItem").map((b) => b.attrs.listStart)).toEqual([1, 2, 3]);
    expect(rotulosOrdenados(blocks)).toEqual(["1. Q um", "2. Q dois", "3. Q três"]);
  });

  it("itens consecutivos da mesma lista fundem num grupo (listStart só no líder)", () => {
    const blocks = [
      item("Q um", { listKind: "ordered", listLevel: 0, listStart: 1, listStyle: "decimal" }),
      item("Q dois", { listKind: "ordered", listLevel: 0, listStart: 2, listStyle: "decimal" }),
      item("Q três", { listKind: "ordered", listLevel: 0, listStart: 3, listStyle: "decimal" }),
    ];
    pruneNonLeaderListStarts(blocks);
    expect(blocks.map((b) => b.attrs.listStart)).toEqual([1, undefined, undefined]);
    expect(rotulosOrdenados(blocks)).toEqual(["1. Q um", "2. Q dois", "3. Q três"]);
  });

  it("subitens alfabéticos entre questões decimais não resetam a numeração principal", () => {
    const blocks = [
      item("Q três", { listKind: "ordered", listLevel: 0, listStart: 3, listStyle: "decimal" }),
      item("sub a", { listKind: "ordered", listLevel: 0, listStart: 1, listStyle: "lower-alpha" }),
      item("sub b", { listKind: "ordered", listLevel: 0, listStart: 2, listStyle: "lower-alpha" }),
      item("Q quatro", { listKind: "ordered", listLevel: 0, listStart: 4, listStyle: "decimal" }),
    ];
    pruneNonLeaderListStarts(blocks);
    expect(rotulosOrdenados(blocks)).toEqual(["3. Q três", "a. sub a", "b. sub b", "4. Q quatro"]);
  });

  it("duas listas Word independentes coladas NÃO fundem (sequência não contígua)", () => {
    const blocks = [
      item("A um", { listKind: "ordered", listLevel: 0, listStart: 1, listStyle: "decimal" }),
      item("A dois", { listKind: "ordered", listLevel: 0, listStart: 2, listStyle: "decimal" }),
      item("B um", { listKind: "ordered", listLevel: 0, listStart: 1, listStyle: "decimal" }),
      item("B dois", { listKind: "ordered", listLevel: 0, listStart: 2, listStyle: "decimal" }),
    ];
    pruneNonLeaderListStarts(blocks);
    expect(rotulosOrdenados(blocks)).toEqual(["1. A um", "2. A dois", "1. B um", "2. B dois"]);
  });
});

describe("prova real de Matemática (numeração Word preservada)", () => {
  const DOC_PATH = path.resolve(
    __dirname,
    "../../../../../docs-auxiliares/P1  -  1 º SEMESTRE - MATEMÁTICA_ok .docx",
  );

  it("questões 1..8 contínuas apesar das linhas de resposta; subitens em letras", async () => {
    let buf: Buffer;
    try {
      buf = await readFile(DOC_PATH);
    } catch {
      console.warn(`[numbering] arquivo não encontrado: ${DOC_PATH} — pulando`);
      return;
    }
    const doc = await docxBlobToDocument(buf);
    const rotulos = rotulosOrdenados(doc.blocks);

    const decimais = rotulos.filter((r) => /^\d+\./.test(r));
    expect(decimais.map((r) => r.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(decimais[3]).toContain("4. Em uma estação");
    expect(decimais[7]).toContain("8. Na estação Alto da Boa Vista");

    const alfabeticos = rotulos.filter((r) => /^[a-z]\./.test(r));
    expect(alfabeticos.slice(0, 3).map((r) => r.split(".")[0])).toEqual(["a", "b", "c"]);
  });
});
