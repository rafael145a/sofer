# @sofer/core

> Y.js-backed document model for the Sofer editor.

Framework-agnostic engine: blocks, marks, commands, history. The document **is** a Y.Doc — collaboration converges through CRDT, not through diffs.

```bash
npm install @sofer/core yjs
```

```ts
import { EditorDocument } from '@sofer/core';

const doc = new EditorDocument();
const json = doc.toJSON();           // SerializedDocument
doc.loadFromJSON(json);
```

## License

[AGPL-3.0-or-later](./LICENSE) © Rafael Marreca. Part of the [Sofer](https://github.com/rafael145a/sofer) editor monorepo.
