import { describe, it, expect } from "vitest";
import { paraMathlive } from "../formulaSnippet";
import { PALETA } from "../formulaSnippet";

describe("tradução {} → #?", () => {
  it("converte cada destino de digitação", () => {
    expect(paraMathlive("\\frac{}{}")).toBe("\\frac{#?}{#?}");
    expect(paraMathlive("\\sqrt[{}]{}")).toBe("\\sqrt[#?]{#?}");
    expect(paraMathlive("\\left({}\\right)")).toBe("\\left(#?\\right)");
    expect(paraMathlive("\\{{}\\}")).toBe("\\{#?\\}");
  });

  it("não toca em chave com conteúdo", () => {
    // Estes três são a razão de a tradução ser segura: `pmatrix`, `sen` e
    // `R` estão DENTRO das chaves, então não são o literal `{}`.
    expect(paraMathlive("\\operatorname{sen}")).toBe("\\operatorname{sen}");
    expect(paraMathlive("\\mathbb{R}")).toBe("\\mathbb{R}");
    expect(paraMathlive("\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}"))
      .toBe("\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}");
  });

  it("todo {} de todo item da paleta vira um #?, e nenhum sobra", () => {
    for (const cat of PALETA) {
      for (const item of cat.itens) {
        const antes = (item.snippet.match(/\{\}/g) ?? []).length;
        const depois = paraMathlive(item.snippet);
        expect((depois.match(/#\?/g) ?? []).length, `${cat.nome}/${item.label}`).toBe(antes);
        expect(depois.includes("{}"), `${cat.nome}/${item.label}`).toBe(false);
      }
    }
  });
});

describe("toda estrutura marca onde o professor digita", () => {
  it("todo item de Estruturas tem pelo menos um {}", () => {
    // A Matriz nasceu sem marca nenhuma e o cursor caía depois de
    // \end{pmatrix} — foi o bloqueador da review da paleta.
    const estruturas = PALETA.find((c) => c.nome === "Estruturas")!;
    for (const item of estruturas.itens) {
      expect(item.snippet.includes("{}"), `${item.label} não marca destino`).toBe(true);
    }
  });
});
