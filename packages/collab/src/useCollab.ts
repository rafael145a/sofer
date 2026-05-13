import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  bindCollab,
  type BindCollabOptions,
  type CollabBinding,
  type ConnectionStatus,
} from "./binding";

export interface UseCollabOptions extends Omit<BindCollabOptions, "ydoc"> {
  ydoc: Y.Doc;
}

export interface UseCollabResult {
  status: ConnectionStatus;
  synced: boolean;
  binding: CollabBinding | null;
}

export function useCollab(options: UseCollabOptions): UseCollabResult {
  const { ydoc, url, name, token, user } = options;
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const bindingRef = useRef<CollabBinding | null>(null);

  useEffect(() => {
    const binding = bindCollab({
      ydoc,
      url,
      name,
      token,
      user,
      onStatus: (s) => setStatus(s),
      onSynced: (s) => setSynced(s),
    });
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
      setStatus("disconnected");
      setSynced(false);
    };
    // Re-bind when document identity or connection params change. `user` is
    // updated via setUser below so changes don't tear down the socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, url, name, token]);

  useEffect(() => {
    bindingRef.current?.setUser(user ?? null);
  }, [user?.name, user?.color]);

  return { status, synced, binding: bindingRef.current };
}
