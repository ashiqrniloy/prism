import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPatchHistory, type DocModel, DocumentsValidationError } from "../index.js";

describe("createPatchHistory", () => {
  const initialDoc: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: "Version 1",
    blocks: [
      { type: "heading", level: 1, text: "Initial Section" },
      { type: "paragraph", text: "First draft content." },
    ],
  };

  it("applies patches and tracks history", () => {
    const history = createPatchHistory(initialDoc);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
    assert.equal(history.undoCount, 0);
    assert.equal(history.redoCount, 0);

    const v2 = history.apply([
      { op: "set", target: { title: true }, value: "Version 2" },
      { op: "insert", target: { afterBlock: 1 }, block: { type: "page-break" } },
    ]) as DocModel;

    assert.equal(v2.title, "Version 2");
    assert.equal(v2.blocks.length, 3);
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);
    assert.equal(history.undoCount, 1);
  });

  it("reverts applied patches on undo and restores exact initial state", () => {
    const history = createPatchHistory(initialDoc);

    history.apply([{ op: "set", target: { title: true }, value: "Version 2" }]);

    const reverted = history.undo() as DocModel;
    assert.deepEqual(reverted, initialDoc);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);
    assert.equal(history.redoCount, 1);
  });

  it("reapplies undone patches on redo", () => {
    const history = createPatchHistory(initialDoc);

    history.apply([{ op: "set", target: { title: true }, value: "Version 2" }]);

    history.undo();
    const reapplied = history.redo() as DocModel;
    assert.equal(reapplied.title, "Version 2");
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);
  });

  it("clears redo stack when applying a new patch after undo", () => {
    const history = createPatchHistory(initialDoc);

    history.apply([{ op: "set", target: { title: true }, value: "Version 2" }]);
    history.undo();
    assert.equal(history.canRedo(), true);

    history.apply([{ op: "set", target: { title: true }, value: "Branch 2" }]);
    assert.equal(history.canRedo(), false);
    assert.equal(history.redoCount, 0);
    assert.equal(history.getModel().title, "Branch 2");
  });

  it("throws DocumentsValidationError when undoing with empty history", () => {
    const history = createPatchHistory(initialDoc);
    assert.throws(
      () => history.undo(),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.match((err as DocumentsValidationError).message, /undo stack is empty/);
        return true;
      },
    );
  });

  it("throws DocumentsValidationError when redoing with empty redo stack", () => {
    const history = createPatchHistory(initialDoc);
    assert.throws(
      () => history.redo(),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.match((err as DocumentsValidationError).message, /redo stack is empty/);
        return true;
      },
    );
  });
});
