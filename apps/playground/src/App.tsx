import { Editor, EditorProvider, Toolbar, useEditor } from "@sofer/react";
import { useRef, useState, type JSX } from "react";
import {
  documentToHtml,
  documentToJson,
  downloadBlob,
  downloadString,
  exportPdfFromElement,
  serializePaginatedHtml,
} from "@sofer/export-pdf";
import { documentToDocxBlob } from "@sofer/export-docx";
import { docxBlobToDocument } from "@sofer/import-docx";
import type { SerializedDocument } from "@sofer/core";
import { saveSnapshot } from "./saveSnapshot";

function summarizeSnapshot(snap: SerializedDocument): string {
  const counts: Record<string, number> = {};
  let imageCount = 0;
  let totalChars = 0;
  for (const b of snap.blocks) {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
    totalChars += b.text.length;
    for (const op of b.delta) {
      if (typeof op.insert === "object" && op.insert && (op.insert as { type?: string }).type === "image") {
        imageCount++;
      }
    }
  }
  return JSON.stringify(
    { blocks: snap.blocks.length, byType: counts, images: imageCount, chars: totalChars, pageSettings: snap.pageSettings?.preset },
    null,
    2,
  );
}

export function App(): JSX.Element {
  const editor = useEditor();
  const editorRootRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const exportHtml = () => {
    const html = documentToHtml(editor.snapshot, { title: "Documento" });
    downloadString(html, "documento.html", "text/html;charset=utf-8");
  };

  const exportJson = () => {
    const json = documentToJson(editor.snapshot);
    downloadString(json, "documento.json", "application/json;charset=utf-8");
  };

  const exportPdf = async () => {
    const root = editorRootRef.current?.querySelector<HTMLElement>(".ed-root");
    if (!root) return;
    await exportPdfFromElement(root, { title: "Documento" });
  };

  // Dev-only: download the paginated HTML snapshot as a file. Use this for
  // manual verification — NEVER copy from devtools + paste into an editor:
  // pretty-formatters (VS Code, etc.) insert whitespace inside elements, and
  // because the editor uses `white-space: pre-wrap`, that whitespace renders
  // as visible newlines and bloats every block by ~4×. Saving as a Blob keeps
  // the bytes verbatim, which is exactly what the api-portal will receive.
  const downloadSnapshotHtml = () => {
    const root = editorRootRef.current?.querySelector<HTMLElement>(".ed-root");
    if (!root) return;
    const html = serializePaginatedHtml(root, { title: "Documento" });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, "snapshot.html");
  };

  const exportDocx = async () => {
    const blob = await documentToDocxBlob(editor.snapshot, { title: "Documento" });
    downloadBlob(blob, "documento.docx");
  };

  const [snapshotStatus, setSnapshotStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading" }
    | { kind: "success"; snapshotId?: string; bytes: number }
    | { kind: "error"; message: string; bytes?: number; html?: string }
  >({ kind: "idle" });

  // Dev-only: in production this would come from the route / loader.
  const PROVA_ID_DEV = "dev-prova-001";

  const saveProvaSnapshot = async () => {
    const root = editorRootRef.current?.querySelector<HTMLElement>(".ed-root");
    if (!root) return;
    setSnapshotStatus({ kind: "uploading" });
    const result = await saveSnapshot(root, PROVA_ID_DEV, {
      title: "Documento",
      includeHtml: true,
    });
    if (result.ok) {
      setSnapshotStatus({
        kind: "success",
        snapshotId: result.snapshotId,
        bytes: result.gzippedBytes ?? 0,
      });
    } else {
      // Surface the HTML on the global so it can be inspected from devtools
      // even when the api-portal isn't running locally.
      if (result.html) {
        (window as unknown as { __lastSnapshotHtml?: string }).__lastSnapshotHtml = result.html;
        // eslint-disable-next-line no-console
        console.log(
          "[snapshot] HTML captured on window.__lastSnapshotHtml (length:",
          result.html.length,
          "chars)",
        );
      }
      setSnapshotStatus({
        kind: "error",
        message: result.error ?? `HTTP ${result.status}`,
        bytes: result.gzippedBytes,
        html: result.html,
      });
    }
  };

  const importDocx = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      alert("Apenas .docx é suportado nesta versão.");
      return;
    }
    const serialized = await docxBlobToDocument(file);
    editor.doc.loadFromJSON(serialized);
  };

  return (
    <EditorProvider editor={editor}>
      <div className="layout">
        <header>
          <h1>Editor playground</h1>
          <p className="hint">
            Fase 9 — exportações. Marks: <kbd>⌘B</kbd>/<kbd>⌘I</kbd>/<kbd>⌘U</kbd>/<kbd>⌘⇧X</kbd>;{" "}
            <kbd>⌘K</kbd> link; <kbd>⌘Z</kbd> desfazer.
          </p>
          <Toolbar />
          <div className="ed-history-controls">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.history.undo()}>
              Undo
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.history.redo()}>
              Redo
            </button>
            <span className="export-sep" />
            <button onMouseDown={(e) => e.preventDefault()} onClick={exportHtml}>
              Export HTML
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={exportJson}>
              Export JSON
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => void exportPdf()}>
              Export PDF
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void saveProvaSnapshot()}
              disabled={snapshotStatus.kind === "uploading"}
              title="Serializa o DOM paginado e envia pro api-portal salvar no Azure"
            >
              {snapshotStatus.kind === "uploading" ? "Salvando snapshot…" : "Salvar snapshot"}
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={downloadSnapshotHtml}
              title="Baixa o HTML paginado como arquivo (preserva bytes; não passar por IDE prettifier)"
            >
              Download snapshot HTML
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => void exportDocx()}>
              Export DOCX
            </button>
            {snapshotStatus.kind === "success" && (
              <span className="snapshot-status snapshot-status-ok">
                ✓ snapshot enviado ({(snapshotStatus.bytes / 1024).toFixed(0)} KB gzip
                {snapshotStatus.snapshotId ? `, id ${snapshotStatus.snapshotId}` : ""})
              </span>
            )}
            {snapshotStatus.kind === "error" && (
              <span className="snapshot-status snapshot-status-err">
                ✗ {snapshotStatus.message}
                {snapshotStatus.bytes != null && ` (${(snapshotStatus.bytes / 1024).toFixed(0)} KB)`}
                {snapshotStatus.html && " — HTML em window.__lastSnapshotHtml"}
              </span>
            )}
            <span className="export-sep" />
            <input
              type="file"
              accept=".docx"
              ref={importInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importDocx(file);
                e.target.value = "";
              }}
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => importInputRef.current?.click()}
            >
              Import DOCX
            </button>
          </div>
        </header>

        <main>
          <div className="page-frame" ref={editorRootRef}>
            <Editor
              editor={editor}
              renderPageFooter={({ pageNumber, pageCount }) => (
                <span>
                  Página {pageNumber} de {pageCount}
                </span>
              )}
            />
          </div>

          <aside>
            <h2>Pending marks</h2>
            <pre>{JSON.stringify(editor.pendingMarks, null, 2)}</pre>
            <h2>Snapshot</h2>
            {/*
              Snapshot is a useful debug view but stringifying it on every
              keystroke is catastrophic for docs with embedded images — the
              base64 src lives inline, so a doc with 7 photos (~3 MB of base64)
              re-serializes per keystroke. Show structural info only; click
              "log" to dump the full snapshot on demand.
            */}
            <pre>{summarizeSnapshot(editor.snapshot)}</pre>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                // eslint-disable-next-line no-console
                console.log("snapshot", editor.snapshot);
              }}
            >
              Log full snapshot to console
            </button>
            <h2>Selection</h2>
            <pre>{JSON.stringify(editor.selection, null, 2)}</pre>
          </aside>
        </main>
      </div>
    </EditorProvider>
  );
}
