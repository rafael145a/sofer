import { describe, it, expect } from "vitest";
import { commonBlockProps } from "../NodeView";

/**
 * Atributos base de um bloco. Exportado como helper puro (mesmo padrão de
 * `cellStyle`) para poder ser fixado sem montar o `EditorProvider`.
 */
describe("commonBlockProps — linha de resposta", () => {
  it("não emite estilo em parágrafo comum", () => {
    expect(commonBlockProps({}, 0, "paragraph", undefined).style).toBeUndefined();
  });

  it("emite régua inferior e entrelinha", () => {
    expect(
      commonBlockProps({ answerLine: true, answerLineSpacing: 2 }, 0, "paragraph", undefined).style,
    ).toEqual({
      borderBottom: "1px solid #000000",
      lineHeight: "2",
    });
  });

  it("entrelinha ausente vale 1", () => {
    expect(
      commonBlockProps({ answerLine: true }, 0, "paragraph", undefined).style,
    ).toMatchObject({ lineHeight: "1" });
  });

  it("combina com alinhamento", () => {
    expect(
      commonBlockProps({ answerLine: true, align: "center" }, 0, "paragraph", undefined).style,
    ).toMatchObject({
      textAlign: "center",
      borderBottom: "1px solid #000000",
    });
  });

  it("preserva os data-attributes do bloco", () => {
    const a = commonBlockProps({ answerLine: true }, 7, "paragraph", undefined);
    expect(a["data-block-index"]).toBe(7);
    expect(a["data-block-type"]).toBe("paragraph");
  });
});
