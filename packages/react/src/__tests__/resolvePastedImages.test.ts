// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ClipboardSlice, ImageEmbed } from "@sofereditor/core";
import {
  dataUrlToFile,
  resolvePastedImageUploads,
  sliceHasDataImageEmbeds,
} from "../resolvePastedImages";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

function sliceWithImage(src: string): ClipboardSlice {
  const embed: ImageEmbed = { type: "image", src, width: 10, height: 10 };
  return {
    blocks: [
      {
        type: "paragraph",
        text: "",
        delta: [{ insert: "antes " }, { insert: embed }, { insert: " depois" }],
        attrs: {},
      },
    ],
    openStart: false,
    openEnd: false,
  };
}

describe("sliceHasDataImageEmbeds", () => {
  it("true quando há embed com src data:image/", () => {
    expect(sliceHasDataImageEmbeds(sliceWithImage(PNG_1PX))).toBe(true);
  });

  it("false quando o embed já foi resolvido pra uma URL http(s)", () => {
    expect(sliceHasDataImageEmbeds(sliceWithImage("https://cdn.exemplo.com/foto.png"))).toBe(false);
  });

  it("false quando não há embed nenhum (slice só com texto)", () => {
    const slice: ClipboardSlice = {
      blocks: [{ type: "paragraph", text: "x", delta: [{ insert: "x" }], attrs: {} }],
      openStart: false,
      openEnd: false,
    };
    expect(sliceHasDataImageEmbeds(slice)).toBe(false);
  });
});

describe("resolvePastedImageUploads", () => {
  it("sem uploadImage configurado, devolve o slice inalterado (mesmo objeto) — playground", async () => {
    const slice = sliceWithImage(PNG_1PX);
    const out = await resolvePastedImageUploads(slice, undefined);
    expect(out).toBe(slice);
  });

  it("troca o data: pela URL devolvida por upload", async () => {
    const slice = sliceWithImage(PNG_1PX);
    const upload = vi.fn(async (_file: File) => "https://blob.exemplo.com/imagens/abc.png");
    const out = await resolvePastedImageUploads(slice, upload);
    expect(upload).toHaveBeenCalledTimes(1);
    const embed = out.blocks[0].delta[1].insert as ImageEmbed;
    expect(embed.src).toBe("https://blob.exemplo.com/imagens/abc.png");
    // width/height preservados, só o src muda.
    expect(embed.width).toBe(10);
    expect(embed.height).toBe(10);
  });

  it("não muta o slice original", async () => {
    const slice = sliceWithImage(PNG_1PX);
    const upload = vi.fn(async () => "https://blob.exemplo.com/x.png");
    await resolvePastedImageUploads(slice, upload);
    const originalEmbed = slice.blocks[0].delta[1].insert as ImageEmbed;
    expect(originalEmbed.src).toBe(PNG_1PX);
  });

  it("upload que falha mantém o data: daquela imagem e não rejeita a promise", async () => {
    const slice = sliceWithImage(PNG_1PX);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const upload = vi.fn(async () => {
      throw new Error("rede caiu");
    });
    const out = await resolvePastedImageUploads(slice, upload);
    const embed = out.blocks[0].delta[1].insert as ImageEmbed;
    expect(embed.src).toBe(PNG_1PX);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("um upload falhando não impede os outros de serem resolvidos", async () => {
    const embedOk: ImageEmbed = { type: "image", src: PNG_1PX, width: 5, height: 5 };
    const embedFail: ImageEmbed = { type: "image", src: PNG_1PX, width: 6, height: 6 };
    const slice: ClipboardSlice = {
      blocks: [
        { type: "paragraph", text: "", delta: [{ insert: embedOk }], attrs: {} },
        { type: "paragraph", text: "", delta: [{ insert: embedFail }], attrs: {} },
      ],
      openStart: false,
      openEnd: false,
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const upload = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new Error("essa falhou");
      return "https://blob.exemplo.com/ok.png";
    });
    const out = await resolvePastedImageUploads(slice, upload);
    expect((out.blocks[0].delta[0].insert as ImageEmbed).src).toBe("https://blob.exemplo.com/ok.png");
    expect((out.blocks[1].delta[0].insert as ImageEmbed).src).toBe(PNG_1PX);
    errSpy.mockRestore();
  });

  // B1: dataUrlToFile agora pode rejeitar (data: malformado) ANTES de chamar
  // `upload` — o catch de resolvePastedImageUploads precisa cobrir essa
  // rejeição também, preservando o data: original em vez de subir um File
  // de 0 bytes com MIME inventado.
  it("data: malformado no slice preserva o src original e não chama upload", async () => {
    const slice = sliceWithImage("data:image/png;base64,!!!nao-e-base64!!!");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const upload = vi.fn(async () => "https://blob.exemplo.com/nao-deveria-chegar-aqui.png");
    const out = await resolvePastedImageUploads(slice, upload);
    const embed = out.blocks[0].delta[1].insert as ImageEmbed;
    expect(embed.src).toBe("data:image/png;base64,!!!nao-e-base64!!!");
    expect(upload).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("ops que não são embed data: passam intocados", async () => {
    const slice = sliceWithImage(PNG_1PX);
    const upload = vi.fn(async () => "https://blob.exemplo.com/x.png");
    const out = await resolvePastedImageUploads(slice, upload);
    expect(out.blocks[0].delta[0].insert).toBe("antes ");
    expect(out.blocks[0].delta[2].insert).toBe(" depois");
  });
});

describe("dataUrlToFile", () => {
  it("deriva a extensão do MIME (png)", async () => {
    const file = await dataUrlToFile(PNG_1PX);
    expect(file.type).toBe("image/png");
    expect(file.name.endsWith(".png")).toBe(true);
  });

  it("deriva a extensão do MIME (jpeg -> .jpg)", async () => {
    const jpeg = PNG_1PX.replace("image/png", "image/jpeg");
    const file = await dataUrlToFile(jpeg);
    expect(file.type).toBe("image/jpeg");
    expect(file.name.endsWith(".jpg")).toBe(true);
  });

  it("o conteúdo do File corresponde ao base64 decodificado", async () => {
    const file = await dataUrlToFile(PNG_1PX);
    const buf = await file.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  // B1: data: URL-encoded (não-base64) — regex antigo só reconhecia
  // `;base64,`; contra esta forma o MIME caía no default inventado
  // "image/png" e o arquivo saía com 0 bytes, sem lançar. `fetch` trata as
  // duas formas nativamente.
  it("data: URL-encoded (sem ;base64,) não vira arquivo de 0 bytes com MIME inventado", async () => {
    const svgUrlEncoded = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%2F%3E%3C%2Fsvg%3E";
    const file = await dataUrlToFile(svgUrlEncoded);
    expect(file.type).toBe("image/svg+xml");
    expect(file.size).toBeGreaterThan(0);
  });

  // B1: data: malformado deve REJEITAR a promise (o chamador,
  // resolvePastedImageUploads, já preserva o data: original nesse caso) —
  // nunca devolver um File vazio silenciosamente.
  it("data: malformado rejeita em vez de devolver um File vazio", async () => {
    await expect(dataUrlToFile("data:image/png;base64,!!!nao-e-base64!!!")).rejects.toBeTruthy();
  });
});
