import type { AppState } from "../model/types";

interface KeyboardEditorOptions {
  getState: () => AppState;
  deleteSelectedPoints: () => void;
  clearSelection: () => void;
  undoEdits: () => void;
  redoEdits: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function bindKeyboardEditor(options: KeyboardEditorOptions): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) {
      return;
    }

    const hasModifier = event.metaKey || event.ctrlKey;
    const isUndoShortcut = hasModifier && !event.altKey && event.key.toLowerCase() === "z";
    const isRedoShortcut =
      (hasModifier && !event.altKey && event.shiftKey && event.key.toLowerCase() === "z") ||
      (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "y");

    if (isRedoShortcut) {
      event.preventDefault();
      options.redoEdits();
      return;
    }

    if (isUndoShortcut) {
      event.preventDefault();
      options.undoEdits();
      return;
    }

    if (event.key === "Escape") {
      options.clearSelection();
      return;
    }

    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    const state = options.getState();
    if (!state.selectedTrackId || state.selectedPointIds.length === 0) {
      return;
    }

    event.preventDefault();
    options.deleteSelectedPoints();
  };

  window.addEventListener("keydown", handler);

  return () => {
    window.removeEventListener("keydown", handler);
  };
}
