import type { DocHandle, DocumentId } from "@automerge/automerge-repo";
import {
  AutomergeRepoUndoRedo,
  UndoRedoOptions,
  defaultScope,
} from "./automerge-repo-undo-redo";

type Change = { description: string | undefined; ids: DocumentId[] };

export class UndoRedoManager {
  #handles: Map<DocumentId, AutomergeRepoUndoRedo<any>> = new Map();

  #undoStack: Record<string | symbol, Change[]> = { [defaultScope]: [] };

  #redoStack: Record<string | symbol, Change[]> = { [defaultScope]: [] };

  addHandle<T>(handle: DocHandle<T> | AutomergeRepoUndoRedo<T>) {
    const undoableHandle =
      handle instanceof AutomergeRepoUndoRedo
        ? handle
        : new AutomergeRepoUndoRedo(handle);
    this.#handles.set(undoableHandle.handle.documentId, undoableHandle);

    return undoableHandle;
  }

  getUndoRedoHandle<T>(
    documentId: DocumentId,
  ): AutomergeRepoUndoRedo<T> | undefined {
    return this.#handles.get(documentId);
  }

  #transaction(
    fn: () => string | void,
    options: UndoRedoOptions<unknown> & { dependencies?: DocumentId[] } = {},
  ) {
    this.startTransaction(options.dependencies);

    const description = fn() ?? options?.description;

    return this.endTransaction({ ...options, description });
  }

  get transaction() {
    return this.#transaction.bind(this);
  }

  startTransaction(dependencies?: DocumentId[]) {
    // Todo: should we error out if we don't have a handle for one of the ids?
    const handles = dependencies ?
      dependencies.map(id => this.#handles.get(id)).filter(Boolean) :
      [...this.#handles.values()]

    handles.forEach((handle) => {
      handle!.startTransaction()
    })
  }

  private getStacks(scope: string | symbol) {
    if (!this.#undoStack[scope]) {
      this.#undoStack[scope] = [];
    }
    if (!this.#redoStack[scope]) {
      this.#redoStack[scope] = [];
    }
    return {
      undoStack: this.#undoStack[scope],
      redoStack: this.#redoStack[scope],
    };
  }

  endTransaction(options: UndoRedoOptions<unknown> & { dependencies?: DocumentId[] } = {}) {
    const scope = options.scope ?? defaultScope;
    const { undoStack } = this.getStacks(scope);

    const handleEntries = options.dependencies
      ? options.dependencies.map(id => [id, this.#handles.get(id)] as const).filter(([, handle]) => handle)
      : [...this.#handles];

    const results = handleEntries
      .map(([id, handle]) => {
        return handle!.endTransaction(options) ? id : null;
      })
      .filter((id): id is DocumentId => id !== null);

    if (results.length === 0) {
      return;
    }

    undoStack.push({
      description: options.description,
      ids: results,
    });

    this.#redoStack[scope] = [];

    return {
      description: options.description,
      ids: results,
      scope,
    };
  }

  #undo(scope: string | symbol = defaultScope) {
    const { undoStack, redoStack } = this.getStacks(scope);
    const change = undoStack.pop();

    if (!change) {
      return;
    }

    change.ids.forEach((id) => {
      const handle = this.#handles.get(id);
      if (handle) {
        handle.undo(scope);
      }
    });

    redoStack.push(change);

    return { ...change, scope };
  }

  get undo() {
    return this.#undo.bind(this);
  }

  undos(scope: string | symbol = defaultScope) {
    const { undoStack } = this.getStacks(scope);
    return undoStack.map((change) => change.description);
  }

  #redo(scope: string | symbol = defaultScope) {
    const { undoStack, redoStack } = this.getStacks(scope);
    const change = redoStack.pop();

    if (!change) {
      return;
    }

    change.ids.forEach((id) => {
      const handle = this.#handles.get(id);
      if (handle) {
        handle.redo(scope);
      }
    });

    undoStack.push(change);

    return { ...change, scope };
  }

  get redo() {
    return this.#redo.bind(this);
  }

  redos(scope: string | symbol = defaultScope) {
    const { redoStack } = this.getStacks(scope);
    return redoStack.map((change) => change.description);
  }

  canUndo(scope: string | symbol = defaultScope) {
    const { undoStack } = this.getStacks(scope);
    return undoStack.length > 0;
  }

  canRedo(scope: string | symbol = defaultScope) {
    const { redoStack } = this.getStacks(scope);
    return redoStack.length > 0;
  }
}
