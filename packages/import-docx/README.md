# @sofer/import-docx

> Parse .docx (OOXML) into a Sofer SerializedDocument.

Works in the browser **and** in Node. No native deps.

```bash
npm install @sofer/import-docx
```

```ts
import { docxBlobToDocument } from '@sofer/import-docx';

const serialized = await docxBlobToDocument(fileOrBlob);
editor.doc.loadFromJSON(serialized);
```

## License

[AGPL-3.0-or-later](./LICENSE) © Alef Peretz. Part of the [Sofer](https://github.com/rafael145a/sofer) editor monorepo.
