import type * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface CollabUser {
  name: string;
  color: string;
}

export interface BindCollabOptions {
  ydoc: Y.Doc;
  url: string;
  name: string;
  token?: string;
  user?: CollabUser;
  onStatus?: (status: ConnectionStatus) => void;
  onSynced?: (synced: boolean) => void;
}

export interface CollabBinding {
  readonly provider: HocuspocusProvider;
  readonly awareness: Awareness;
  setUser(user: CollabUser | null): void;
  destroy(): void;
}

export function bindCollab(opts: BindCollabOptions): CollabBinding {
  const provider = new HocuspocusProvider({
    url: opts.url,
    name: opts.name,
    document: opts.ydoc,
    token: opts.token,
    onStatus: opts.onStatus
      ? ({ status }) => opts.onStatus!(status as ConnectionStatus)
      : undefined,
    onSynced: opts.onSynced
      ? ({ state }) => opts.onSynced!(state)
      : undefined,
  });

  if (opts.user) {
    provider.awareness?.setLocalStateField("user", opts.user);
  }

  let destroyed = false;

  return {
    provider,
    get awareness() {
      const a = provider.awareness;
      if (!a) {
        throw new Error(
          "[@editor/collab] Awareness not yet available (provider not connected).",
        );
      }
      return a;
    },
    setUser(user) {
      if (destroyed) return;
      provider.awareness?.setLocalStateField("user", user);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      provider.destroy();
    },
  };
}
