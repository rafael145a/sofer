import { describe, it, expect } from "vitest";
import { PALETA } from "../formulaSnippet";

describe("PALETA", () => {
  it("tem as sete categorias, nessa ordem", () => {
    expect(PALETA.map((c) => c.nome)).toEqual([
      "Estruturas",
      "Símbolos",
      "Relações",
      "Gregas",
      "Conjuntos",
      "Funções",
      "Setas",
    ]);
  });

  it("Estruturas vem primeiro e mantém os oito itens originais", () => {
    // Quem já usava a paleta não pode perder velocidade nem reaprender.
    const estruturas = PALETA[0];
    expect(estruturas.nome).toBe("Estruturas");
    const labels = estruturas.itens.map((i) => i.label);
    for (const antigo of [
      "Fração",
      "Expoente",
      "Índice",
      "Raiz",
      "Raiz n-ésima",
      "Somatório",
      "Integral",
      "Matriz 2×2",
    ]) {
      expect(labels, antigo).toContain(antigo);
    }
  });

  it("usa a notação BRASILEIRA das funções trigonométricas", () => {
    // \sin renderiza "sin" e \tan renderiza "tan". Prova brasileira escreve
    // "sen" e "tg". Se alguém "simplificar" para o idioma do LaTeX, a paleta
    // continua parecendo certa e a PROVA IMPRESSA sai errada — por isso o
    // teste trava a string exata, não só que o snippet renderize.
    const funcoes = PALETA.find((c) => c.nome === "Funções")!;
    const porLabel = Object.fromEntries(funcoes.itens.map((i) => [i.label, i.snippet]));
    expect(porLabel["sen"]).toBe("\\operatorname{sen}");
    expect(porLabel["tg"]).toBe("\\operatorname{tg}");
    expect(porLabel["cotg"]).toBe("\\operatorname{cotg}");
    // E o inverso: nenhuma categoria pode conter as formas inglesas.
    const todos = PALETA.flatMap((c) => c.itens.map((i) => i.snippet)).join(" ");
    expect(todos).not.toMatch(/\\sin\b/);
    expect(todos).not.toMatch(/\\tan\b/);
    expect(todos).not.toMatch(/\\cot\b/);
  });

  it("cada categoria cabe em 4 linhas da própria grade", () => {
    // A grade tem min-height fixo para 4 linhas. Uma categoria que passe
    // disso ou rola ou faz o modal pular de altura ao trocar de aba.
    for (const c of PALETA) {
      const linhas = Math.ceil(c.itens.length / c.colunas);
      expect(linhas, `${c.nome} (${c.itens.length} itens / ${c.colunas} col)`).toBeLessThanOrEqual(4);
    }
  });

  it("Estruturas usa 4 colunas e as de símbolo usam 6", () => {
    // Rótulo em palavra ("Raiz n-ésima") não cabe na largura de um símbolo.
    expect(PALETA[0].colunas).toBe(4);
    for (const c of PALETA.slice(1)) {
      expect(c.colunas, c.nome).toBe(6);
    }
  });

  it("não há label repetido dentro da mesma categoria", () => {
    for (const c of PALETA) {
      const labels = c.itens.map((i) => i.label);
      expect(new Set(labels).size, c.nome).toBe(labels.length);
    }
  });

  it("tem 82 itens no total", () => {
    expect(PALETA.reduce((n, c) => n + c.itens.length, 0)).toBe(82);
  });

  const CATEGORIAS_DE_SIMBOLO = ["Símbolos", "Relações", "Gregas", "Conjuntos", "Setas"];

  it("todo item das categorias de símbolo tem titulo não vazio e diferente do label", () => {
    // Sem `titulo`, o `title` do botão vira o próprio glifo (`title="∝"`):
    // no-op de acessibilidade. `titulo === label` seria o mesmo no-op de volta.
    for (const c of PALETA.filter((cat) => CATEGORIAS_DE_SIMBOLO.includes(cat.nome))) {
      for (const item of c.itens) {
        expect(item.titulo, `${c.nome} / ${item.label}`).toBeTruthy();
        expect(item.titulo, `${c.nome} / ${item.label}`).not.toBe(item.label);
      }
    }
  });

  it("nenhum titulo, em qualquer categoria, repete o label", () => {
    for (const c of PALETA) {
      for (const item of c.itens) {
        if (item.titulo !== undefined) {
          expect(item.titulo, `${c.nome} / ${item.label}`).not.toBe(item.label);
        }
      }
    }
  });
});
