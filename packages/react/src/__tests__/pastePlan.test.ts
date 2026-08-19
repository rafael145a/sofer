// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { SOFER_MIME } from "@sofereditor/core";
import { planPaste } from "../pastePlan";

/**
 * jsdom não implementa `DataTransfer`. Este duplo cobre exatamente a superfície
 * que `planPaste` usa — `getData`, `types` e `files` — com a mesma semântica do
 * navegador (`getData` de um tipo ausente devolve string vazia).
 */
function clipboard(dados: Record<string, string>, arquivos: File[] = []): DataTransfer {
  return {
    getData: (tipo: string) => dados[tipo] ?? "",
    types: [...Object.keys(dados), ...(arquivos.length ? ["Files"] : [])],
    files: arquivos as unknown as FileList,
  } as unknown as DataTransfer;
}

const arquivoPng = (nome = "image.png", bytes = 7392): File =>
  new File([new Uint8Array(bytes)], nome, { type: "image/png" });

describe("planPaste — ordem dos ramos", () => {
  it("Word (HTML + PNG renderizado) cola o TEXTO, não a figura", () => {
    // Forma medida num caso real em 2026-08-19: ao copiar TEXTO, o Word põe no
    // clipboard o HTML completo E um PNG do trecho renderizado. Com o ramo de
    // arquivos na frente, o texto do professor virava imagem. Se este teste
    // reprovar com kind "images", a ordem dos ramos regrediu.
    const cd = clipboard(
      {
        "text/plain": "1.\tCircule os números pares que aparecem no texto.",
        "text/html":
          `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>` +
          `<p class=MsoNormal><b>Circule os números pares</b><o:p></o:p></p></body></html>`,
        "text/rtf": "{\\rtf1 ...}",
      },
      [arquivoPng()],
    );
    const plano = planPaste(cd);
    expect(plano.kind).toBe("html");
  });

  it("imagem de verdade (HTML só com <img>) ainda cai no ramo de arquivos", () => {
    // A inversão acima só é segura porque `htmlToSlice` devolve null quando o
    // HTML não tem conteúdo aproveitável. Sem isto, colar imagem quebraria.
    const cd = clipboard(
      {
        "text/plain": "",
        "text/html": `<meta charset='utf-8'><img src="https://exemplo.com/foto.png">`,
      },
      [arquivoPng("foto.png")],
    );
    const plano = planPaste(cd);
    expect(plano.kind).toBe("images");
    if (plano.kind === "images") expect(plano.files).toHaveLength(1);
  });

  it("imagem do Word (só <img> embrulhado em markup do Office) cai em arquivos", () => {
    const cd = clipboard(
      {
        "text/html":
          `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>` +
          `<p class=MsoNormal><img src="file:///C:/Users/x/image001.png"><o:p></o:p></p></body></html>`,
      },
      [arquivoPng()],
    );
    expect(planPaste(cd).kind).toBe("images");
  });

  it("arquivo do Finder (sem HTML nenhum) cai em arquivos", () => {
    expect(planPaste(clipboard({}, [arquivoPng("foto.png")])).kind).toBe("images");
  });

  it("slice do próprio editor vence o HTML", () => {
    // Copiar dentro do editor também escreve text/html no clipboard; a cópia
    // interna é mais fiel e não pode perder para o parser de HTML externo.
    const slice = { blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }], openStart: false, openEnd: false };
    const cd = clipboard({
      [SOFER_MIME]: JSON.stringify(slice),
      "text/html": "<p>x</p>",
      "text/plain": "x",
    });
    expect(planPaste(cd).kind).toBe("sofer");
  });

  it("slice corrompido não engole a colagem — segue para o HTML", () => {
    const cd = clipboard({
      [SOFER_MIME]: "{ isto não é json",
      "text/html": "<p>texto de verdade</p>",
      "text/plain": "texto de verdade",
    });
    expect(planPaste(cd).kind).toBe("html");
  });

  it("HTML sem conteúdo aproveitável e sem arquivo cai em texto puro", () => {
    const cd = clipboard({
      "text/html": "<meta charset='utf-8'><style>p{color:red}</style>",
      "text/plain": "sobrou o texto",
    });
    const plano = planPaste(cd);
    expect(plano.kind).toBe("text");
    if (plano.kind === "text") expect(plano.text).toBe("sobrou o texto");
  });

  it("clipboard vazio devolve none (handler não deve chamar preventDefault)", () => {
    expect(planPaste(clipboard({})).kind).toBe("none");
  });

  it("arquivo que não é imagem é ignorado e a colagem vira texto", () => {
    const pdf = new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" });
    const cd = clipboard({ "text/plain": "só o texto" }, [pdf]);
    const plano = planPaste(cd);
    expect(plano.kind).toBe("text");
  });
});
