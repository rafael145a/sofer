# @sofer/export-docx

> Emit .docx from a Sofer SerializedDocument.

Round-trip with [@sofer/import-docx](https://www.npmjs.com/package/@sofer/import-docx) is exact for documents the editor produced.

```bash
npm install @sofer/export-docx
```

```ts
import { documentToDocxBlob } from '@sofer/export-docx';

const blob = await documentToDocxBlob(editor.snapshot, { title: 'My document' });
```

## License

[AGPL-3.0-or-later](./LICENSE) © Alef Peretz. Part of the [Sofer](https://github.com/rafael145a/sofer) editor monorepo.
