import { useCallback, useRef, useSyncExternalStore } from "react";
import type { EditorDocument, PageSettings } from "@sofereditor/core";

/**
 * Reactive snapshot of an `EditorDocument`'s page settings. Re-renders the
 * component when `docSettings` changes (either locally via `setPageSettings`
 * or remotely via Y.js sync).
 *
 * Caches the snapshot reference to satisfy `useSyncExternalStore`'s stable-
 * identity requirement — `getPageSettings` returns a fresh object each call,
 * which would loop the store forever without this caching.
 */
export function usePageSettings(doc: EditorDocument): PageSettings {
  const cacheRef = useRef<PageSettings | null>(null);

  const subscribe = useCallback(
    (notify: () => void) => doc.observePageSettings(notify),
    [doc],
  );

  const getSnapshot = useCallback((): PageSettings => {
    const next = doc.getPageSettings();
    const prev = cacheRef.current;
    if (prev && shallowEqual(prev, next)) return prev;
    cacheRef.current = next;
    return next;
  }, [doc]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function shallowEqual(a: PageSettings, b: PageSettings): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.marginTop === b.marginTop &&
    a.marginBottom === b.marginBottom &&
    a.marginLeft === b.marginLeft &&
    a.marginRight === b.marginRight &&
    a.preset === b.preset
  );
}
