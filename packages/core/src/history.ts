import * as Y from "yjs";
import type { EditorDocument } from "./document";
import { TRACKED_ORIGINS } from "./commands";

export class EditorHistory {
  readonly undoManager: Y.UndoManager;

  constructor(doc: EditorDocument) {
    this.undoManager = new Y.UndoManager(doc.blocks, {
      trackedOrigins: TRACKED_ORIGINS,
      captureTimeout: 400,
    });
  }

  undo(): boolean {
    return this.undoManager.undo() != null;
  }

  redo(): boolean {
    return this.undoManager.redo() != null;
  }

  destroy(): void {
    this.undoManager.destroy();
  }
}
