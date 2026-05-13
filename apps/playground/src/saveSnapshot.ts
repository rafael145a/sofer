import { serializePaginatedHtml } from "@editor/export-pdf";

export interface SaveSnapshotResult {
  ok: boolean;
  status: number;
  snapshotId?: string;
  blobUrl?: string;
  error?: string;
  /** Raw HTML built on the client. Useful for dev/debug when the api-portal isn't reachable. */
  html?: string;
  /** Size of the gzipped body actually sent, in bytes. */
  gzippedBytes?: number;
}

export interface SaveSnapshotOptions {
  /** Document title; flows through `serializePaginatedHtml` into `<title>`. */
  title?: string;
  /** Endpoint base URL. Defaults to `import.meta.env.VITE_API_URL` or `http://localhost:3000`. */
  apiUrl?: string;
  /** Override the fetch implementation (used by tests). */
  fetchImpl?: typeof fetch;
  /** Include the HTML in the result for debug/inspection. */
  includeHtml?: boolean;
}

/**
 * Serialize the live editor DOM into a self-contained HTML snapshot, gzip it,
 * and POST it to the api-portal. The api-portal stores the HTML as the
 * source-of-truth for printing and asynchronously renders the master PDF via
 * Puppeteer (`setContent + page.pdf()`) — no re-pagination on the server.
 */
export async function saveSnapshot(
  root: HTMLElement,
  provaId: string,
  options: SaveSnapshotOptions = {},
): Promise<SaveSnapshotResult> {
  const html = serializePaginatedHtml(root, { title: options.title });
  const pageCount = root.querySelectorAll(".ed-page").length;

  const gzipped = await gzip(new TextEncoder().encode(html));
  const baseUrl =
    options.apiUrl ?? import.meta.env.VITE_API_URL ?? "http://localhost:3000";
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/provas/${encodeURIComponent(provaId)}/snapshot`;

  const fetchImpl = options.fetchImpl ?? fetch;
  let resp: Response;
  try {
    resp = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "gzip",
        "X-Snapshot-Generated-At": new Date().toISOString(),
        "X-Snapshot-Page-Count": String(pageCount),
      },
      body: new Blob([gzipped as BlobPart], { type: "application/octet-stream" }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      html: options.includeHtml ? html : undefined,
      gzippedBytes: gzipped.byteLength,
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      error: await safeText(resp),
      html: options.includeHtml ? html : undefined,
      gzippedBytes: gzipped.byteLength,
    };
  }

  const body = (await resp.json().catch(() => ({}))) as {
    snapshotId?: string;
    blobUrl?: string;
  };
  return {
    ok: true,
    status: resp.status,
    snapshotId: body.snapshotId,
    blobUrl: body.blobUrl,
    html: options.includeHtml ? html : undefined,
    gzippedBytes: gzipped.byteLength,
  };
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(compressed);
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return `HTTP ${resp.status}`;
  }
}
