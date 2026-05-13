# editor-monorepo

Custom rich text editor for the Alef Peretz ecosystem. Google Docs-like experience built from scratch in TypeScript, backed by Y.js for collaboration.

## Status

Early development. Phase 6 (floating images: wrap + z-order) of the [plan](../../../.claude-alef/plans/preciso-desenvolver-um-google-cryptic-lake.md).

## Packages

| Package | Role |
|---|---|
| `@editor/core` | Document model on Y.js, schema, selection, commands, input layer |
| `@editor/react` | React renderer, hooks, editor component |
| `@editor/pagination` | Real page-break engine (A4/Letter) |
| `@editor/layout-images` | Anchored images, wrap, z-order |
| `@editor/collab` | Y.js + Hocuspocus client binding |
| `@editor/math` | MathLive integration |
| `@editor/tables` | Table model and commands |
| `@editor/export-pdf` | PDF export pipeline |
| `@editor/export-docx` | DOCX export pipeline |
| `server-hocuspocus` | Reference WebSocket server (not published) |

## Apps

| App | Role |
|---|---|
| `playground` | Vite + React dev/demo app |

## Develop

```bash
pnpm install
pnpm dev          # runs the playground
pnpm typecheck
pnpm test
pnpm build        # builds all publishable packages
```

## Dependencies

Zero TipTap / ProseMirror / Lexical / Slate / Quill. Engine custom on top of Y.js.
