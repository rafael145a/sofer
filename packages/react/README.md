# @sofer/react

> React renderer for the Sofer editor with built-in A4 pagination.

```bash
npm install @sofer/react @sofer/core yjs
```

```tsx
import { Editor, EditorProvider, Toolbar, useEditor, A4_PAGE } from '@sofer/react';

export function MyEditor() {
  const editor = useEditor();
  return (
    <EditorProvider editor={editor}>
      <Toolbar />
      <Editor editor={editor} pageGeometry={A4_PAGE} />
    </EditorProvider>
  );
}
```

Optional `uploadImage` hook routes paste/drop/picker to external storage (S3, Azure Blob) so the Y.Doc stores URLs instead of base64.

## License

[AGPL-3.0-or-later](./LICENSE) © Sofer Contributors. Part of the [Sofer](https://github.com/rafael145a/sofer) editor monorepo.
