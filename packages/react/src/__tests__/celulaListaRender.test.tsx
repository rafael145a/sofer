// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type MutableRefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorDocument, type SerializedDocument } from "@sofereditor/core";
import { EditorProvider } from "../EditorContext";
import { NodeView } from "../NodeView";
import { useEditor, type UseEditorResult } from "../useEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

let container: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function celulaDoc(attrs: Record<string, unknown>): SerializedDocument {
  return {
    blocks: [
      {
        type: "table",
        text: "",
        delta: [],
        attrs: { rows: 1, cols: 1 },
        cells: [{ text: "um\ndois", delta: [{ insert: "um\ndois" }], attrs }],
      },
    ],
  } as SerializedDocument;
}

function montar(attrs: Record<string, unknown>): HTMLElement {
  const editorDoc = EditorDocument.fromJSON(celulaDoc(attrs));
  function Harness({ apiRef }: { apiRef: MutableRefObject<UseEditorResult | null> }) {
    const editor = useEditor({ document: editorDoc });
    apiRef.current = editor;
    return (
      <EditorProvider editor={editor}>
        <NodeView block={editor.snapshot.blocks[0]!} index={0} />
      </EditorProvider>
    );
  }
  const apiRef: MutableRefObject<UseEditorResult | null> = { current: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness, { apiRef }));
  });
  return container;
}

describe("render de célula-lista", () => {
  it("sem listKind não emite lista", () => {
    const dom = montar({});
    expect(dom.querySelector("ul")).toBeNull();
    expect(dom.querySelector("ol")).toBeNull();
    expect(dom.querySelector(".ed-cell")!.textContent).toBe("um\ndois");
  });

  it("listKind bullet emite <ul> com um <li> por linha", () => {
    const dom = montar({ listKind: "bullet" });
    const ul = dom.querySelector("ul.ed-list.ed-list-bullet");
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll("li")).toHaveLength(2);
    expect([...ul!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["um", "dois"]);
  });

  it("listKind ordered emite <ol>", () => {
    const dom = montar({ listKind: "ordered" });
    expect(dom.querySelector("ol.ed-list.ed-list-ordered")).not.toBeNull();
  });

  it("todo <li> carrega data-cell-line com seu índice", () => {
    const dom = montar({ listKind: "bullet" });
    expect(
      [...dom.querySelectorAll("li")].map((li) => li.getAttribute("data-cell-line")),
    ).toEqual(["0", "1"]);
  });

  it("listStart vira o atributo start do <ol>", () => {
    const dom = montar({ listKind: "ordered", listStart: 5 });
    expect(dom.querySelector("ol")!.getAttribute("start")).toBe("5");
  });
});
