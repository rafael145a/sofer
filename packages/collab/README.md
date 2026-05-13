# @sofer/collab

> Hocuspocus binding for real-time collaboration with Sofer.

```bash
npm install @sofer/collab @hocuspocus/provider yjs
```

```tsx
import * as Y from 'yjs';
import { useCollab } from '@sofer/collab';

const ydoc = new Y.Doc();
const { status, synced, binding } = useCollab({
  ydoc,
  url: 'wss://your-hocuspocus-server',
  name: 'doc-id',
  token: jwt,
  user: { name: 'Ada', color: '#f59e0b' },
});
```

`binding.awareness` exposes the Y.js awareness object for cursor overlays.

## License

[AGPL-3.0-or-later](./LICENSE) © Rafael Marreca. Part of the [Sofer](https://github.com/rafael145a/sofer) editor monorepo.
