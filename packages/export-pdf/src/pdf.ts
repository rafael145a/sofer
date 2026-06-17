import type { LegacySerializedDocument, SerializedDocument } from "@sofereditor/core";
import { documentToHtml, type DocumentToHtmlOptions } from "./html";

export interface ExportPdfFromDocumentOptions extends DocumentToHtmlOptions {
  /** Suggested file name (used by the OS save dialog as the default). */
  filename?: string;
}

/**
 * Open the browser's print dialog for a `SerializedDocument`.
 *
 * Strategy: render the document to standalone HTML in a hidden iframe and call
 * `iframe.contentWindow.print()`. The user picks "Save as PDF" (or any printer)
 * from the native dialog. No external PDF library required.
 *
 * The returned promise resolves after the print dialog closes (`afterprint`).
 */
export async function exportPdfFromDocument(
  doc: SerializedDocument | LegacySerializedDocument,
  options: ExportPdfFromDocumentOptions = {},
): Promise<void> {
  const html = documentToHtml(doc, { ...options, standalone: true });
  await printHtmlInIframe(html, options.filename ?? options.title ?? "Documento");
}

export interface SerializePaginatedHtmlOptions {
  /** Document title (becomes `<title>` and is used as default filename). */
  title?: string;
  /** Extra CSS appended to the cloned styles (e.g. for headers/footers). */
  extraCss?: string;
  /**
   * Override the `@page { size }`. Default reads `--ed-page-width` /
   * `--ed-page-height` CSS variables off the root (set by `<Editor>` from the
   * current `PageSettings`); falls back to A4 if absent.
   */
  pageSize?: { width: string; height: string };
}

export interface ExportPdfFromElementOptions extends SerializePaginatedHtmlOptions {
  /** Suggested file name. */
  filename?: string;
}

function cssPageSizeFromRoot(
  cs: CSSStyleDeclaration | undefined,
): { width: string; height: string } {
  if (!cs) return { width: "210mm", height: "297mm" };
  const w = cs.getPropertyValue("--ed-page-width").trim();
  const h = cs.getPropertyValue("--ed-page-height").trim();
  if (!w || !h) return { width: "210mm", height: "297mm" };
  // CSS vars come back as e.g. "794px". `@page` accepts px directly.
  return { width: w, height: h };
}

/**
 * Serialize a live editor root (the `.ed-root` paginated DOM) into a
 * self-contained HTML string. The output preserves the in-editor pagination
 * decisions verbatim — each `.ed-page` becomes a fixed-size page in the final
 * print medium with no re-layout possible.
 *
 * The returned HTML inlines every accessible stylesheet from the host document
 * (or links it as a fallback for cross-origin sheets) so the layout survives
 * transplant to an iframe, a saved file, or a headless renderer.
 *
 * This is the building block for two paths:
 *  - `exportPdfFromElement` (this file): writes the HTML into a hidden iframe
 *    and calls `window.print()` for the local "Save as PDF" flow.
 *  - Upload-to-server snapshots: POST the string to a backend that converts it
 *    to PDF via Puppeteer's `setContent + page.pdf()` without re-running the
 *    pagination engine.
 */
export function serializePaginatedHtml(
  root: HTMLElement,
  options: SerializePaginatedHtmlOptions = {},
): string {
  const clone = root.cloneNode(true) as HTMLElement;
  // Strip interactive scaffolding that print styles can't see ahead of time.
  clone.querySelectorAll("[contenteditable]").forEach((el) => {
    (el as HTMLElement).removeAttribute("contenteditable");
  });
  clone.querySelectorAll(".ed-image-overlay").forEach((el) => el.remove());

  // Read the page size baked into the editor via `--ed-page-*` CSS variables.
  // The Editor component sets these on its root from the current PageSettings
  // (`packages/react/src/Editor.tsx`). Falls back to A4 if we can't read them.
  const cs = root.ownerDocument?.defaultView?.getComputedStyle(root);
  const pageSize = options.pageSize ?? cssPageSizeFromRoot(cs);

  const styles = collectStyles();
  const title = escapeHtml(options.title ?? "Documento");
  const extra = options.extraCss ?? "";
  // The `@page { size }` and page-break rules live inside `@media print` so
  // they merge cleanly with any host-document print stylesheet that already
  // declares its own `@page` (e.g. `apps/playground/src/styles.css`). Putting
  // ours after the cloned `<style>`s gives our override last-write-wins.
  return [
    "<!doctype html>",
    `<html><head><meta charset="utf-8"><meta name="ed-print-snapshot" content="1"><title>${title}</title>`,
    styles,
    `<style>
      html, body { margin: 0; padding: 0; background: white; }
      @media print {
        @page { size: ${pageSize.width} ${pageSize.height}; margin: 0; }
        .ed-page { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; page-break-after: always; break-after: page; }
        .ed-page:last-child { page-break-after: auto; break-after: auto; }
        .ed-image-overlay { display: none !important; }
      }
      ${extra}
    </style>`,
    "</head><body>",
    clone.outerHTML,
    "</body></html>",
  ].join("");
}

/**
 * Snapshot a live editor root element (the `.ed-root` paginated DOM) and open
 * the browser's print dialog. Preserves the in-editor pagination decisions
 * verbatim — no re-layout in the print frame.
 *
 * For the "send the snapshot to a server" use case, use
 * `serializePaginatedHtml` directly and POST the returned string.
 */
export async function exportPdfFromElement(
  root: HTMLElement,
  options: ExportPdfFromElementOptions = {},
): Promise<void> {
  const html = serializePaginatedHtml(root, options);
  await printHtmlInIframe(html, options.filename ?? options.title ?? "Documento");
}

// ---------- internals ----------

async function printHtmlInIframe(html: string, _filename: string): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const docu = iframe.contentDocument ?? win?.document;
  if (!win || !docu) {
    iframe.remove();
    throw new Error("export-pdf: failed to access iframe document");
  }

  docu.open();
  docu.write(html);
  docu.close();

  // Wait for the iframe to finish loading (images, fonts).
  await new Promise<void>((resolve) => {
    if (docu.readyState === "complete") resolve();
    else iframe.addEventListener("load", () => resolve(), { once: true });
  });
  // Best-effort wait for embedded images: print dialogs that snapshot too early
  // miss late-loading data URIs (rare, but real).
  await waitForImages(docu);

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      win.removeEventListener("afterprint", cleanup);
      // Defer removal one tick so Safari's print queue doesn't choke.
      setTimeout(() => iframe.remove(), 0);
      resolve();
    };
    win.addEventListener("afterprint", cleanup);
    win.focus();
    win.print();
    // Fallback in case afterprint never fires (older browsers).
    setTimeout(() => {
      if (iframe.isConnected) cleanup();
    }, 60_000);
  });
}

function collectStyles(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      const css = Array.from(rules)
        .map((r) => r.cssText)
        .join("\n");
      if (css) parts.push(`<style>${css}</style>`);
    } catch {
      // Cross-origin sheet — fall back to linking it.
      const href = sheet.href;
      if (href) parts.push(`<link rel="stylesheet" href="${escapeAttr(href)}">`);
    }
  }
  return parts.join("\n");
}

async function waitForImages(docu: Document): Promise<void> {
  const imgs = Array.from(docu.images);
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
