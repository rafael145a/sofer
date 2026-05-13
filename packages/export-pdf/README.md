# @sofer/export-pdf

> Serialize the paginated Sofer DOM to self-contained HTML.

Includes Puppeteer-friendly templates and standalone serializers. Run Puppeteer (or your printer of choice) over the HTML to get the PDF.

```bash
npm install @sofer/export-pdf
```

```ts
import { serializePaginatedHtml, exportPdfFromElement } from '@sofer/export-pdf';

const html = serializePaginatedHtml(editorRoot, { title: 'My document' });
await exportPdfFromElement(editorRoot, { title: 'My document' }); // client-side PDF
```

## License

[AGPL-3.0-or-later](./LICENSE) © Sofer Contributors. Part of the [Sofer](https://github.com/rafael145a/sofer) editor monorepo.
