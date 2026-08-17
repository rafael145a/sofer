// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { serializePaginatedHtml } from "@sofereditor/export-pdf";

/**
 * `serializePaginatedHtml` é o caminho PRINCIPAL do PDF: ele clona o DOM
 * paginado vivo do editor. Isso significa que a guia de tela das bordas
 * desligadas por preset viaja junto no clone — e precisa ser neutralizada
 * dentro de `@media print`, senão o preset "Nenhuma" imprime linhas cinza.
 *
 * É o único ponto do desenho em que tela e impressão divergem de propósito,
 * então fica travado por teste em vez de inspeção visual.
 */
function paginatedRoot(): HTMLElement {
  const root = document.createElement("div");
  root.className = "ed-root";
  root.innerHTML = `
    <div class="ed-page">
      <table class="ed-table"><tbody><tr>
        <td class="ed-cell" style="border-top-color:var(--ed-guide-color, transparent)"></td>
      </tr></tbody></table>
    </div>`;
  document.body.appendChild(root);
  return root;
}

describe("serializePaginatedHtml — guia de tela", () => {
  it("neutraliza --ed-guide-color dentro de @media print", () => {
    const html = serializePaginatedHtml(paginatedRoot());
    const print = html.slice(html.indexOf("@media print"));
    expect(print).toMatch(/--ed-guide-color:\s*transparent\s*!important/);
  });

  it("a regra cobre .ed-root, de onde a custom property herda até o <td>", () => {
    const html = serializePaginatedHtml(paginatedRoot());
    const regra = html.match(/([^{}]*)\{[^{}]*--ed-guide-color[^{}]*\}/)?.[1] ?? "";
    expect(regra).toContain(".ed-root");
  });

  it("NÃO neutraliza fora de @media print — a guia continua na tela", () => {
    const html = serializePaginatedHtml(paginatedRoot());
    const antesDoPrint = html.slice(0, html.indexOf("@media print"));
    expect(antesDoPrint).not.toContain("--ed-guide-color");
  });

  it("preserva a referência à variável no <td> clonado (geometria intacta)", () => {
    const html = serializePaginatedHtml(paginatedRoot());
    expect(html).toContain("border-top-color:var(--ed-guide-color, transparent)");
  });
});
