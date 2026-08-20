// @vitest-environment jsdom
/**
 * Reprodução de um bug do ramo assíncrono de colagem com imagem `data:`
 * (Google Docs) em `Editor.tsx` — `onPaste`, caso "html" com embed pendente
 * de upload (ver `resolvePastedImages.ts`):
 *
 * B4 — duas colagens concorrentes caem na mesma posição. Sem indicador de
 * carregamento nenhum na UI, uma rede lenta faz o professor colar de novo
 * enquanto o primeiro upload ainda está em voo; a segunda captura a MESMA
 * posição e empurra a primeira ao resolver.
 *
 * Monta o `<Editor>` de verdade e dispara um `paste` real (sem
 * `@testing-library`, que não é dependência deste pacote — mesmo padrão de
 * `Editor.keydown.test.tsx`), com um `uploadImage` controlável por promise
 * (deferred) pra simular a janela de espera do upload.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isImageEmbed } from "@sofereditor/core";
import { Editor } from "../Editor";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Base64 válido (comprimento múltiplo de 4, decodifica de verdade via
// `fetch` — usado por `dataUrlToFile`, ver bug B1) e grande o bastante
// (>1 KB decodificado) pra passar do piso do bug B2 também.
const BIG_VALID_B64 = "A".repeat(1400) + "AA==";

function imageHtml(width = 10, height = 10): string {
  return `<p><img src="data:image/png;base64,${BIG_VALID_B64}" width="${width}" height="${height}"></p>`;
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  // Dá tempo pro `fetch` de `data:` URL (usado por `dataUrlToFile`) e pra
  // cadeia de microtasks do upload resolverem — `fetch`, mesmo pra `data:`,
  // não é puramente síncrono no Node.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function Harness({
  apiRef,
  uploadImage,
}: {
  apiRef: MutableRefObject<UseEditorResult | null>;
  uploadImage?: (file: File) => Promise<string>;
}) {
  const editor = useEditor({ uploadImage });
  apiRef.current = editor;
  return createElement(Editor, { editor, pageGeometry: null });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mount(uploadImage?: (file: File) => Promise<string>): { api: UseEditorResult; rootEl: HTMLElement } {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  act(() => {
    root!.render(createElement(Harness, { apiRef, uploadImage }));
  });
  const api = apiRef.current;
  if (!api) throw new Error("editor não inicializou");
  const rootEl = container.querySelector('[contenteditable="true"]');
  if (!rootEl) throw new Error("root contentEditable não encontrado");
  return { api, rootEl: rootEl as HTMLElement };
}

function makeClipboardData(html: string): DataTransfer {
  return {
    getData: (type: string) => (type === "text/html" ? html : ""),
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
}

function firePaste(target: HTMLElement, html: string): void {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
  Object.defineProperty(ev, "clipboardData", { value: makeClipboardData(html) });
  act(() => {
    target.dispatchEvent(ev);
  });
}

function embedCount(api: UseEditorResult): number {
  return api.doc
    .toJSON()
    .blocks.reduce((n, b) => n + b.delta.filter((op) => isImageEmbed(op.insert)).length, 0);
}

describe("Editor onPaste (html + imagem data:) — B4: colagens concorrentes", () => {
  it("segunda colagem durante upload pendente é descartada, não cai na mesma posição da primeira", async () => {
    const d1 = deferred<string>();
    const upload = vi.fn(async () => d1.promise);
    const { api, rootEl } = mount(upload);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    firePaste(rootEl, imageHtml());
    await flushAsync();
    expect(upload).toHaveBeenCalledTimes(1);

    // Segunda colagem enquanto a primeira ainda está em voo.
    firePaste(rootEl, imageHtml());
    await flushAsync();
    // A segunda foi descartada — não gerou uma segunda chamada de upload.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    d1.resolve("https://blob.exemplo.com/foto.png");
    await flushAsync();

    // Só UMA imagem no documento — a segunda colagem não empurrou/duplicou.
    expect(embedCount(api)).toBe(1);

    warnSpy.mockRestore();
  });
});
