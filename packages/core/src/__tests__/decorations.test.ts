import { describe, it, expect } from "vitest";
import { splitUnderscoreRuns, styleToCssText, BLANK_STYLE, BLANK_MIN_RUN } from "../decorations";

describe("splitUnderscoreRuns", () => {
  it("não segmenta texto sem corrida de 3+", () => {
    expect(splitUnderscoreRuns("a_b__c")).toEqual([{ text: "a_b__c", blank: false }]);
  });

  it("segmenta uma corrida de exatamente BLANK_MIN_RUN", () => {
    expect(BLANK_MIN_RUN).toBe(3);
    expect(splitUnderscoreRuns("a___b")).toEqual([
      { text: "a", blank: false },
      { text: "___", blank: true },
      { text: "b", blank: false },
    ]);
  });

  it("preserva o comprimento exato de corridas longas", () => {
    const r = splitUnderscoreRuns("Nome: " + "_".repeat(20));
    expect(r).toHaveLength(2);
    expect(r[1].blank).toBe(true);
    expect(r[1].text).toHaveLength(20);
  });

  it("lida com corridas nas bordas e múltiplas corridas", () => {
    expect(splitUnderscoreRuns("___a____")).toEqual([
      { text: "___", blank: true },
      { text: "a", blank: false },
      { text: "____", blank: true },
    ]);
  });

  it("texto só de underlines vira um único segmento de lacuna", () => {
    expect(splitUnderscoreRuns("_____")).toEqual([{ text: "_____", blank: true }]);
  });

  it("devolve lista vazia para string vazia", () => {
    expect(splitUnderscoreRuns("")).toEqual([]);
  });

  it("a concatenação dos segmentos reconstrói o texto original", () => {
    // Invariante obrigatória: os offsets do modelo dependem de nenhum caractere
    // ser introduzido nem removido pela segmentação.
    for (const src of ["a___b_c______d__", "___", "sem lacuna", "", "_", "__", "a_", "_a"]) {
      expect(splitUnderscoreRuns(src).map((s) => s.text).join("")).toBe(src);
    }
  });

  it("é reentrante — chamadas sucessivas não compartilham estado do regex", () => {
    const a = splitUnderscoreRuns("x___y");
    const b = splitUnderscoreRuns("x___y");
    expect(a).toEqual(b);
  });
});

describe("styleToCssText", () => {
  it("converte camelCase em kebab-case", () => {
    expect(styleToCssText({ borderBottomColor: "red", lineHeight: "2" })).toBe(
      "border-bottom-color:red;line-height:2",
    );
  });

  it("prefixa vendor properties corretamente", () => {
    expect(styleToCssText({ WebkitTextFillColor: "transparent" })).toBe(
      "-webkit-text-fill-color:transparent",
    );
  });

  it("preserva custom properties intactas", () => {
    expect(styleToCssText({ "--ed-guide-color": "#eee" })).toBe("--ed-guide-color:#eee");
  });

  it("devolve string vazia para objeto vazio", () => {
    expect(styleToCssText({})).toBe("");
  });
});

describe("BLANK_STYLE", () => {
  it("apaga o glifo sem apagar a cor que pinta o sublinhado", () => {
    // `color: transparent` apagaria os dois; text-fill-color só o glifo.
    expect(BLANK_STYLE.WebkitTextFillColor).toBe("transparent");
    expect(BLANK_STYLE.color).toBeUndefined();
    expect(BLANK_STYLE.textDecoration).toBe("underline");
  });

  it("não carrega nenhuma propriedade que desloque métricas", () => {
    // Qualquer uma destas moveria o texto e a paginação divergiria do PDF.
    const keys = Object.keys(BLANK_STYLE);
    for (const forbidden of [
      "display",
      "padding",
      "margin",
      "letterSpacing",
      "width",
      "fontSize",
      "verticalAlign",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
