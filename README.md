# Sofer

> A Google Docs–style rich text editor for the web, built from scratch on top of [Y.js](https://github.com/yjs/yjs). Real pagination, real collaboration, real DOCX/PDF — no ProseMirror, no TipTap, no Slate, no Lexical, no Quill.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)

Sofer is a document model and React renderer originally built for teacher-facing exam authoring. The engine is independent of any framework editor; the React layer is a thin renderer on top.

> **Status:** early development. APIs may change between 0.x releases.

---

## Why a new editor

Existing rich-text frameworks pay costs we couldn't afford for our use case:

- **ProseMirror / TipTap** — their schema is HTML-ish; collaboration with Y.js requires `y-prosemirror` which fights the CRDT on every list/table operation.
- **Lexical / Slate** — fast UIs, but the Y.js integrations are second-class and there is no "real" page-break engine.
- **Quill** — flat document model, no nested structures.

But the deeper reason we built Sofer is **print fidelity**. Exams, contracts, and academic papers exist to be printed; teachers reject editors that "shift a line" between screen and PDF. Sofer treats the page as a first-class concept:

- **Real A4/Letter pagination** — the layout engine fragments blocks into pages at the same break points the printer will, with `break-inside: avoid` honored on tables, images, list items. No "preview mode" diverging from the editing surface.
- **Stable across server-side rendering** — the paginated DOM is self-contained HTML the editor produces directly. Hand it to Puppeteer (or any HTML-to-PDF renderer) and the resulting PDF is **byte-equivalent** to what the user saw on screen: same font metrics, same margins, same page breaks. No "round-trip" through a different layout engine.
- **Metric-compatible fonts and styling** — the same CSS that styles the editor styles the PDF; there is no second template to drift out of sync.

Sofer's document model **is** the Y.Doc: blocks live in a `Y.Array`, each block carries a `Y.Text` and a `Y.Map` of attributes, and tables are first-class with row-major `Y.Array<Y.Map>` cells. Conflicts converge through the same CRDT machinery that powers Google Docs and Notion — and the result still prints exactly as you laid it out.

---

## Packages

All packages are published under `@sofereditor/*` on npm.

| Package | What it does |
|---|---|
| [`@sofereditor/core`](./packages/core) | Document model on Y.js: blocks, marks, commands, history. Framework-agnostic. |
| [`@sofereditor/react`](./packages/react) | React renderer, `useEditor` hook, `<Editor>` and `<Toolbar>` components, built-in A4 pagination. |
| [`@sofereditor/collab`](./packages/collab) | Hocuspocus binding for real-time collaboration. Awareness exposed for cursor overlays. |
| [`@sofereditor/import-docx`](./packages/import-docx) | Parse `.docx` (OOXML) in the browser or Node into a `SerializedDocument`. |
| [`@sofereditor/export-docx`](./packages/export-docx) | Emit `.docx` from a `SerializedDocument`. |
| [`@sofereditor/export-pdf`](./packages/export-pdf) | Serialize the paginated DOM to HTML; consumers run Puppeteer for PDF. |
| [`@sofereditor/math`](./packages/math) | Render LaTeX formulas as self-contained SVG using MathJax. |

Placeholder packages reserved for future modules: `@sofereditor/pagination`, `@sofereditor/tables`, `@sofereditor/layout-images`, `@sofereditor/server-hocuspocus`.

---

## Quick start

```bash
npm install @sofereditor/core @sofereditor/react yjs
```

```tsx
import { Editor, EditorProvider, Toolbar, useEditor, A4_PAGE } from "@sofereditor/react";

export function MyEditor() {
  const editor = useEditor();
  return (
    <EditorProvider editor={editor}>
      <Toolbar />
      <Editor
        editor={editor}
        pageGeometry={A4_PAGE}
        renderPageFooter={({ pageNumber, pageCount }) => (
          <span>Page {pageNumber} of {pageCount}</span>
        )}
      />
    </EditorProvider>
  );
}
```

### With collaboration

```bash
npm install @sofereditor/collab @hocuspocus/provider
```

```tsx
import * as Y from "yjs";
import { EditorDocument } from "@sofereditor/core";
import { useEditor } from "@sofereditor/react";
import { useCollab } from "@sofereditor/collab";

const ydoc = new Y.Doc();
const editor = useEditor({ document: new EditorDocument(ydoc) });
useCollab({
  ydoc,
  url: "wss://your-hocuspocus-server",
  name: "doc-id",
  token: jwt,
  user: { name: "Ada", color: "#f59e0b" },
});
```

### External image storage (S3, Azure Blob, etc.)

```tsx
const editor = useEditor({
  uploadImage: async (file) => {
    const { url } = await myApi.uploadImage(file);
    return url;
  },
});
```

`insertImageFromFile`, paste, and drag-and-drop all route through `uploadImage`; the Y.Doc stores URLs instead of base64.

### Import/export

```tsx
import { docxBlobToDocument } from "@sofereditor/import-docx";
import { documentToDocxBlob } from "@sofereditor/export-docx";
import { exportPdfFromElement } from "@sofereditor/export-pdf";

const serialized = await docxBlobToDocument(file);
editor.doc.loadFromJSON(serialized);

const docxBlob = await documentToDocxBlob(editor.snapshot);
await exportPdfFromElement(editorRootEl, { title: "My document" });
```

---

## Architecture

```
+----------------------+         +----------------------+
|     @sofereditor/core      |  ydoc   |     @sofereditor/collab    |
|  blocks / marks /    |<------->|  HocuspocusProvider  |
|  commands / history  |         |  awareness           |
+----------+-----------+         +----------+-----------+
           |                                |
           v                                v
+----------+-----------+         +----------------------+
|    @sofereditor/react      |         |  Hocuspocus server   |
|  <Editor> renders    |         |  (your backend)      |
|  paginated DOM       |         +----------------------+
+----------+-----------+
           |
           v
+----------+-----------+
|  @sofereditor/export-pdf   |
|  serializes DOM →    |
|  HTML for Puppeteer  |
+----------------------+
```

---

## Development

This is a [pnpm workspace](https://pnpm.io/workspaces). All packages live under `packages/`; the demo app lives under `apps/playground`.

```bash
pnpm install
pnpm dev          # runs the playground app
pnpm typecheck    # tsc --noEmit per package
pnpm test         # vitest per package
pnpm build        # tsup builds for all publishable packages
```

Running a single package's task:

```bash
pnpm --filter @sofereditor/core test
pnpm --filter @sofereditor/react build
```

---

## License

Sofer is released under the [**GNU AGPL v3.0**](./LICENSE) (or later).

If you run a modified version of Sofer over a network to provide a service, the AGPL requires you to make your source available to the users of that service. If that does not fit your use case, a commercial license is available — reach out via the project's issue tracker.

### Third-party licenses

All runtime dependencies of `@sofereditor/*` packages are released under permissive licenses (MIT, ISC, BSD, BlueOak, Zlib); none are copyleft. Key dependencies:

- [`yjs`](https://github.com/yjs/yjs) — MIT
- [`y-protocols`](https://github.com/yjs/y-protocols) — MIT
- [`@hocuspocus/provider`](https://github.com/ueberdosis/hocuspocus) — MIT
- [`docx`](https://github.com/dolanmiu/docx) — MIT
- [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) — MIT
- [`jszip`](https://github.com/Stuk/jszip) — MIT (or GPL 3.0+ at your choice)

Full transitive tree: `pnpm licenses list --prod`.
