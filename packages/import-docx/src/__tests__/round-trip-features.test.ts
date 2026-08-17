import { describe, it, expect } from "vitest";
import type { LegacySerializedDocument, SerializedBlock } from "@sofereditor/core";
import { documentToDocxBuffer } from "@sofereditor/export-docx";
import { docxBlobToDocument } from "../docx";

/**
 * Round-trip das três features de autoria de prova. Pega o que os testes por
 * camada não pegam: que export e import concordam entre si.
 */
async function roundTrip(input: LegacySerializedDocument): Promise<SerializedBlock[]> {
  const { buffer } = await documentToDocxBuffer(input);
  const result = await docxBlobToDocument(buffer);
  return result.blocks;
}

describe("round-trip: marca-texto", () => {
  it("preserva a cor do marca-texto", async () => {
    const out = await roundTrip([
      {
        type: "paragraph",
        text: "oi",
        delta: [{ insert: "oi", attributes: { highlight: "#fff176" } }],
        attrs: {},
      },
    ]);
    expect(out[0].delta[0].attributes?.highlight?.toLowerCase()).toBe("#fff176");
  });

  it("preserva marca-texto junto de cor de texto e negrito", async () => {
    const out = await roundTrip([
      {
        type: "paragraph",
        text: "x",
        delta: [
          { insert: "x", attributes: { bold: true, color: "#ff0000", highlight: "#a5d6a7" } },
        ],
        attrs: {},
      },
    ]);
    expect(out[0].delta[0].attributes).toMatchObject({
      bold: true,
      color: "#ff0000",
      highlight: "#a5d6a7",
    });
  });

  it("texto sem marca-texto não ganha a mark na volta", async () => {
    const out = await roundTrip([
      { type: "paragraph", text: "oi", delta: [{ insert: "oi" }], attrs: {} },
    ]);
    expect(out[0].delta[0].attributes?.highlight).toBeUndefined();
  });
});

describe("round-trip: linhas de resposta", () => {
  it("preserva a linha e as três entrelinhas", async () => {
    for (const spacing of [1, 1.5, 2] as const) {
      const out = await roundTrip([
        {
          type: "paragraph",
          text: "",
          delta: [],
          attrs: { answerLine: true, answerLineSpacing: spacing },
        },
      ]);
      const linha = out.find((b) => b.attrs.answerLine === true);
      expect(linha, `entrelinha ${spacing}`).toBeDefined();
      expect(linha!.attrs.answerLineSpacing).toBe(spacing);
    }
  });

  it("preserva várias linhas seguidas", async () => {
    const input = Array.from({ length: 5 }, () => ({
      type: "paragraph" as const,
      text: "",
      delta: [],
      attrs: { answerLine: true as const, answerLineSpacing: 2 as const },
    }));
    const out = await roundTrip(input);
    expect(out.filter((b) => b.attrs.answerLine === true)).toHaveLength(5);
  });

  it("parágrafo comum não vira linha de resposta na volta", async () => {
    const out = await roundTrip([
      { type: "paragraph", text: "oi", delta: [{ insert: "oi" }], attrs: {} },
    ]);
    expect(out[0].attrs.answerLine).toBeUndefined();
  });
});

describe("round-trip: presets de borda", () => {
  it("preserva os cinco presets", async () => {
    for (const preset of ["all", "outer", "horizontal", "vertical", "none"] as const) {
      const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
      const out = await roundTrip([
        {
          type: "table",
          text: "",
          delta: [],
          attrs: { rows: 2, cols: 2, borderPreset: preset },
          cells,
        },
        { type: "paragraph", text: "", delta: [], attrs: {} },
      ] as unknown as LegacySerializedDocument);
      const t = out.find((b) => b.type === "table");
      expect(t, `preset ${preset}`).toBeDefined();
      expect(t!.attrs.borderPreset ?? "all", `preset ${preset}`).toBe(preset);
    }
  });

  it("preserva a cor da borda", async () => {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const out = await roundTrip([
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 2, cols: 2, borderPreset: "all", borderColor: "#000000" },
        cells,
      },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const t = out.find((b) => b.type === "table");
    expect(t!.attrs.borderColor?.toLowerCase()).toBe("#000000");
  });

  it("tabela sem cor volta sem o atributo — cai no padrão", async () => {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const out = await roundTrip([
      { type: "table", text: "", delta: [], attrs: { rows: 2, cols: 2, borderPreset: "all" }, cells },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const t = out.find((b) => b.type === "table");
    // O export emite CBD5E1 (o default), e o import lê de volta — o valor bate
    // com o padrão, então o documento renderiza igual de qualquer forma.
    expect((t!.attrs.borderColor ?? "#cbd5e1").toLowerCase()).toBe("#cbd5e1");
  });

  it("tabela sem preset volta como all (o padrão visual)", async () => {
    const cells = Array.from({ length: 4 }, () => ({ text: "", delta: [], attrs: {} }));
    const out = await roundTrip([
      { type: "table", text: "", delta: [], attrs: { rows: 2, cols: 2 }, cells },
      { type: "paragraph", text: "", delta: [], attrs: {} },
    ] as unknown as LegacySerializedDocument);
    const t = out.find((b) => b.type === "table");
    expect(t!.attrs.borderPreset ?? "all").toBe("all");
  });
});

describe("round-trip: lacuna de underlines", () => {
  it("underlines sobrevivem literais — a lacuna é decoração, não modelo", async () => {
    const out = await roundTrip([
      {
        type: "paragraph",
        text: "Nome: _____",
        delta: [{ insert: "Nome: _____" }],
        attrs: {},
      },
    ]);
    expect(out[0].text).toBe("Nome: _____");
  });

  it("corridas longas mantêm o comprimento exato", async () => {
    const src = "R: " + "_".repeat(40);
    const out = await roundTrip([
      { type: "paragraph", text: src, delta: [{ insert: src }], attrs: {} },
    ]);
    expect(out[0].text).toBe(src);
  });
});
