import type { Awareness } from "y-protocols/awareness";
import type { EncodedCursor } from "@sofereditor/core";
import type { CollabUser } from "./binding";

export interface PeerState {
  clientId: number;
  user?: CollabUser;
  /** Cursor/seleção remota codificada (Y.RelativePosition + blockId). */
  cursor?: EncodedCursor;
}

export function getPeers(awareness: Awareness): PeerState[] {
  const peers: PeerState[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const s = state as { user?: CollabUser; cursor?: EncodedCursor };
    peers.push({
      clientId,
      user: s.user,
      cursor: s.cursor ?? undefined,
    });
  });
  return peers;
}

export function observePeers(
  awareness: Awareness,
  callback: (peers: PeerState[]) => void,
): () => void {
  const emit = () => callback(getPeers(awareness));
  awareness.on("change", emit);
  emit();
  return () => awareness.off("change", emit);
}

/**
 * Publica (ou limpa, com null) o cursor/seleção local no awareness. O editor
 * chama isto a cada mudança de seleção (com throttle). Os peers leem via
 * `getPeers`/`observePeers`.
 */
export function setLocalCursor(
  awareness: Awareness,
  cursor: EncodedCursor | null,
): void {
  awareness.setLocalStateField("cursor", cursor);
}
