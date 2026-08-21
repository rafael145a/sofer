import { describe, it, expect } from "vitest";
import { distribuirAltura } from "../TableResizeOverlay";

describe("arrastar a base distribui igual entre as linhas", () => {
  it("divide o delta em partes iguais", () => {
    expect(distribuirAltura([40, 40, 40], 30)).toEqual([50, 50, 50]);
  });

  it("PRESERVA as diferenças que o professor ajustou à mão", () => {
    // É o motivo de a divisão ser igual e não proporcional: uma linha que
    // foi deixada alta de propósito continua alta.
    expect(distribuirAltura([40, 80, 40], 30)).toEqual([50, 90, 50]);
  });

  it("respeita o piso ao encolher, sem estourar para negativo", () => {
    expect(distribuirAltura([20, 20, 20], -300)).toEqual([16, 16, 16]);
  });
});
