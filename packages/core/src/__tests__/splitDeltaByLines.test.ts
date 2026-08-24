import { describe, it, expect } from "vitest";
import { splitDeltaByLines } from "../index";
import type { DeltaOp } from "../types";

describe("splitDeltaByLines", () => {
  it("delta sem \\n devolve uma linha só", () => {
    expect(splitDeltaByLines([{ insert: "um" }])).toEqual([[{ insert: "um" }]]);
  });

  it("separa em uma linha por \\n", () => {
    expect(splitDeltaByLines([{ insert: "um\ndois\ntres" }])).toEqual([
      [{ insert: "um" }],
      [{ insert: "dois" }],
      [{ insert: "tres" }],
    ]);
  });

  it("preserva as marcas de cada trecho", () => {
    const delta: DeltaOp[] = [
      { insert: "um\ndo", attributes: { bold: true } },
      { insert: "is", attributes: { italic: true } },
    ];
    expect(splitDeltaByLines(delta)).toEqual([
      [{ insert: "um", attributes: { bold: true } }],
      [
        { insert: "do", attributes: { bold: true } },
        { insert: "is", attributes: { italic: true } },
      ],
    ]);
  });

  it("linha vazia vira delta vazio, sem sumir", () => {
    expect(splitDeltaByLines([{ insert: "um\n\ndois" }])).toEqual([
      [{ insert: "um" }],
      [],
      [{ insert: "dois" }],
    ]);
  });

  it("delta vazio devolve uma linha vazia (nunca zero linhas)", () => {
    expect(splitDeltaByLines([])).toEqual([[]]);
  });

  it("embed fica na linha corrente e não vira separador", () => {
    const img = { insert: { type: "image", src: "x", width: 1, height: 1 } } as unknown as DeltaOp;
    expect(splitDeltaByLines([{ insert: "a\n" }, img, { insert: "b" }])).toEqual([
      [{ insert: "a" }],
      [img, { insert: "b" }],
    ]);
  });
});
