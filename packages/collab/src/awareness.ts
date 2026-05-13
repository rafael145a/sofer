import type { Awareness } from "y-protocols/awareness";
import type { CollabUser } from "./binding";

export interface PeerState {
  clientId: number;
  user?: CollabUser;
}

export function getPeers(awareness: Awareness): PeerState[] {
  const peers: PeerState[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    peers.push({
      clientId,
      user: (state as { user?: CollabUser }).user,
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
