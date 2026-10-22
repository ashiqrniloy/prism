import { DocumentsValidationError } from "./errors.js";
import { type DocumentPatch, patchDocument } from "./patch.js";
import type { DocumentModel } from "./types.js";

export interface PatchHistory {
  /** Returns the current document model state. */
  getModel(): DocumentModel;
  /** Applies one or more patch operations, pushing the prior state onto the undo stack and clearing redo history. */
  apply(patches: readonly DocumentPatch[]): DocumentModel;
  /** Reverts the last applied patch operation, pushing current state onto the redo stack. */
  undo(): DocumentModel;
  /** Reapplies the most recently reverted patch operation. */
  redo(): DocumentModel;
  /** Returns true if undo is available. */
  canUndo(): boolean;
  /** Returns true if redo is available. */
  canRedo(): boolean;
  /** Current number of states on the undo stack. */
  readonly undoCount: number;
  /** Current number of states on the redo stack. */
  readonly redoCount: number;
}

/**
 * Creates an in-memory undo/redo history manager for interactive document editing workflows.
 *
 * Enforces typed patch validation at each step without collaboration or CRDT overhead.
 */
export function createPatchHistory(initialModel: DocumentModel): PatchHistory {
  let currentModel = structuredClone(initialModel);
  const undoStack: DocumentModel[] = [];
  let redoStack: DocumentModel[] = [];

  return {
    getModel(): DocumentModel {
      return structuredClone(currentModel);
    },

    apply(patches: readonly DocumentPatch[]): DocumentModel {
      const next = patchDocument(currentModel, patches);
      undoStack.push(currentModel);
      redoStack = [];
      currentModel = next;
      return structuredClone(currentModel);
    },

    undo(): DocumentModel {
      if (undoStack.length === 0) {
        throw new DocumentsValidationError("cannot undo: patch history undo stack is empty");
      }
      redoStack.push(currentModel);
      currentModel = undoStack.pop()!;
      return structuredClone(currentModel);
    },

    redo(): DocumentModel {
      if (redoStack.length === 0) {
        throw new DocumentsValidationError("cannot redo: patch history redo stack is empty");
      }
      undoStack.push(currentModel);
      currentModel = redoStack.pop()!;
      return structuredClone(currentModel);
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    get undoCount(): number {
      return undoStack.length;
    },

    get redoCount(): number {
      return redoStack.length;
    },
  };
}
