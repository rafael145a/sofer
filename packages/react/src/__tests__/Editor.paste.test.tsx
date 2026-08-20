// @vitest-environment jsdom
/**
 * Reprodução de dois bugs do ramo assíncrono de colagem com imagem `data:`
 * (Google Docs) em `Editor.tsx` — `onPaste`, caso "html" com embed pendente
 * de upload (ver `resolvePastedImages.ts`):
 *
 * B4 — duas colagens concorrentes caem na mesma posição. Sem indicador de
 * carregamento nenhum na UI, uma rede lenta faz o professor colar de novo
 * enquanto o primeiro upload ainda está em voo; a segunda captura a MESMA
 * posição e empurra a primeira ao resolver.
 *
 * B5 — (a) a colagem some em silêncio quando o bloco capturado desaparece
 * durante o `await` (Ctrl+A+Backspace local, ou edição remota via
 * Hocuspocus); (b) restaurar `capturedSelection` incondicionalmente depois
 * de inserir arranca o caret de onde o professor está AGORA se ele se moveu
 * enquanto esperava — o dano que o comentário original afirmava evitar.
 *
 * Monta o `<Editor>` de verdade e dispara um `paste` real (sem
 * `@testing-library`, que não é dependência deste pacote — mesmo padrão de
 * `Editor.keydown.test.tsx`), com um `uploadImage` controlável por promise
 * (deferred) pra simular a janela de espera do upload.
 */
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collapsedSelection,
  insertParagraph,
  insertText,
  isImageEmbed,
  type CommandContext,
  type Selection,
} from "@sofereditor/core";
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

function ctxOf(api: UseEditorResult): CommandContext {
  return { doc: api.doc, getSelection: api.getSelection, setSelection: api.setSelection };
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

describe("Editor onPaste (html + imagem data:) — B5: bloco sumiu / seleção do usuário", () => {
  it("bloco capturado removido durante o upload não engole a colagem em silêncio", async () => {
    const d1 = deferred<string>();
    const upload = vi.fn(async () => d1.promise);
    const { api, rootEl } = mount(upload);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ctx = ctxOf(api);
    act(() => {
      insertText(ctx, "primeiro bloco");
      insertParagraph(ctx);
      // Segundo bloco fica vazio — é onde a colagem vai acontecer.
      api.setSelection(collapsedSelection({ blockIndex: 1, offset: 0 }));
    });
    expect(api.doc.blockCount()).toBe(2);

    firePaste(rootEl, imageHtml());
    await flushAsync();
    expect(upload).toHaveBeenCalledTimes(1);

    // O bloco alvo (índice 1) desaparece durante o await — cenário real:
    // Ctrl+A+Backspace local, ou um par remoto via Hocuspocus apagando
    // conteúdo acima. Simulado diretamente no Y.Doc, que é o que qualquer
    // uma das duas causas produz.
    act(() => {
      api.doc.ydoc.transact(() => {
        api.doc.blocks.delete(1, 1);
      });
    });
    expect(api.doc.blockCount()).toBe(1);

    d1.resolve("https://blob.exemplo.com/foto.png");
    await flushAsync();

    // A colagem NÃO sumiu calada: foi logada...
    expect(errSpy).toHaveBeenCalled();
    // ...e o conteúdo entrou em algum lugar do documento (fim, como último
    // recurso), não foi descartado.
    expect(embedCount(api)).toBe(1);

    errSpy.mockRestore();
  });

  it("seleção do usuário depois da colagem assíncrona não é sobrescrita pela posição antiga da colagem", async () => {
    const d1 = deferred<string>();
    const upload = vi.fn(async () => d1.promise);
    const { api, rootEl } = mount(upload);

    const ctx = ctxOf(api);
    act(() => {
      insertText(ctx, "texto base para colar no meio");
      api.setSelection(collapsedSelection({ blockIndex: 0, offset: 5 }));
    });

    firePaste(rootEl, imageHtml());
    await flushAsync();
    expect(upload).toHaveBeenCalledTimes(1);

    // O professor clica em outro lugar (ou continua digitando alhures)
    // enquanto o upload ainda está em voo.
    const movedAwaySelection: Selection = collapsedSelection({ blockIndex: 0, offset: 0 });
    act(() => {
      api.setSelection(movedAwaySelection);
    });

    d1.resolve("https://blob.exemplo.com/foto.png");
    await flushAsync();

    // A imagem foi inserida na posição capturada (colagem não se perdeu)...
    expect(embedCount(api)).toBe(1);
    // ...mas a seleção final é a do professor AGORA, não a posição antiga da
    // colagem (que o `insertSlice` deixaria logo depois do embed inserido).
    expect(api.getSelection()).toEqual(movedAwaySelection);
  });
});
