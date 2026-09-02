import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type DeckModel,
  type DocModel,
  DocumentsPatchError,
  DocumentsValidationError,
  type ParagraphBlock,
  patchDocument,
  type SheetModel,
} from "../index.js";

describe("patchDocument", () => {
  const baseDoc: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: "Original Title",
    blocks: [
      { type: "heading", level: 1, text: "Chapter 1" },
      { type: "paragraph", text: "Original paragraph text." },
      {
        type: "table",
        rows: 2,
        columns: 2,
        cells: [
          ["A", "B"],
          ["C", "D"],
        ],
      },
    ],
  };

  const baseDeck: DeckModel = {
    kind: "deck",
    modelVersion: 1,
    title: "Deck Title",
    slides: [
      { layout: "title", title: "Slide 1" },
      { layout: "title-and-content", title: "Slide 2", bullets: ["Point A", "Point B"] },
    ],
  };

  const baseSheet: SheetModel = {
    kind: "sheet",
    modelVersion: 1,
    sheets: [
      {
        name: "Sheet1",
        cells: [
          ["Item", "Cost"],
          ["Hosting", 120],
        ],
      },
    ],
  };

  it("returns an identical clone when patch list is empty", () => {
    const patched = patchDocument(baseDoc, []);
    assert.deepEqual(patched, baseDoc);
    assert.notEqual(patched, baseDoc, "must return a distinct clone");
  });

  it("applies set operations on document title and blocks", () => {
    const patched = patchDocument(baseDoc, [
      { op: "set", target: { title: true }, value: "Updated Title" },
      {
        op: "set",
        target: { block: 1 },
        patch: { text: "Patched paragraph text." },
      },
    ]) as DocModel;

    assert.equal(patched.title, "Updated Title");
    assert.equal(baseDoc.title, "Original Title", "original model must remain untouched");
    assert.equal((patched.blocks[1] as ParagraphBlock).text, "Patched paragraph text.");
  });

  it("applies set operation on table cell", () => {
    const patched = patchDocument(baseDoc, [
      {
        op: "set",
        target: { table: { block: 2, row: 1, column: 1 } },
        value: "Updated D",
      },
    ]) as DocModel;

    const table = patched.blocks[2];
    assert.ok(table.type === "table");
    assert.equal(table.cells[1][1], "Updated D");
  });

  it("applies set operation on sheet cell", () => {
    const patched = patchDocument(baseSheet, [
      {
        op: "set",
        target: { cell: { sheet: 0, row: 1, column: 1 } },
        value: 250,
      },
    ]) as SheetModel;

    assert.equal(patched.sheets[0].cells[1][1], 250);
  });

  it("applies insert operations on doc blocks", () => {
    const patched = patchDocument(baseDoc, [
      {
        op: "insert",
        target: { afterBlock: 0 },
        block: { type: "paragraph", text: "Inserted after heading." },
      },
      {
        op: "insert",
        target: { beforeBlock: 0 },
        block: { type: "heading", level: 2, text: "Subtitle heading" },
      },
    ]) as DocModel;

    assert.equal(patched.blocks.length, 5);
    assert.equal((patched.blocks[0] as ParagraphBlock).text, "Subtitle heading");
    assert.equal((patched.blocks[1] as ParagraphBlock).text, "Chapter 1");
    assert.equal((patched.blocks[2] as ParagraphBlock).text, "Inserted after heading.");
  });

  it("applies remove operation on doc block", () => {
    const patched = patchDocument(baseDoc, [{ op: "remove", target: { block: 1 } }]) as DocModel;

    assert.equal(patched.blocks.length, 2);
    assert.equal((patched.blocks[0] as ParagraphBlock).text, "Chapter 1");
    assert.equal(patched.blocks[1].type, "table");
  });

  it("applies move operation on deck slides", () => {
    const patched = patchDocument(baseDeck, [
      {
        op: "move",
        from: { slide: 1 },
        to: { beforeSlide: 0 },
      },
    ]) as DeckModel;

    assert.equal(patched.slides.length, 2);
    assert.equal(patched.slides[0].title, "Slide 2");
    assert.equal(patched.slides[1].title, "Slide 1");
  });

  it("rejects unknown operation with DocumentsValidationError", () => {
    assert.throws(
      // @ts-expect-error testing invalid operation
      () => patchDocument(baseDoc, [{ op: "unknown_op", target: { block: 0 } }]),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.equal((err as DocumentsValidationError).code, "ERR_PRISM_DOCUMENTS_INVALID_MODEL");
        assert.match((err as DocumentsValidationError).message, /unknown patch operation/);
        return true;
      },
    );
  });

  it("rejects out-of-bounds target index with DocumentsValidationError", () => {
    assert.throws(
      () => patchDocument(baseDoc, [{ op: "set", target: { block: 99 }, patch: { text: "err" } }]),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.equal((err as DocumentsValidationError).code, "ERR_PRISM_DOCUMENTS_INVALID_MODEL");
        assert.match((err as DocumentsValidationError).message, /out of bounds/);
        return true;
      },
    );
  });

  it("rejects patches that result in invalid schema models", () => {
    assert.throws(
      () =>
        patchDocument(baseDoc, [
          {
            op: "set",
            target: { block: 0 },
            // @ts-expect-error invalid heading level
            block: { type: "heading", level: 9, text: "Bad heading" },
          },
        ]),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsValidationError);
        return true;
      },
    );
  });

  it("rejects metadata set with __proto__ key before mutation", () => {
    const before = structuredClone(baseDoc);
    assert.throws(
      () =>
        patchDocument(baseDoc, [
          { op: "set", target: { metadata: "__proto__" } as never, value: { polluted: true } },
        ]),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsPatchError);
        assert.equal((err as DocumentsPatchError).code, "ERR_PRISM_DOCUMENTS_UNSAFE_PATH");
        assert.match((err as DocumentsPatchError).message, /__proto__/);
        return true;
      },
    );
    assert.deepEqual(baseDoc, before, "model unchanged on rejected polluting patch");
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined, "Object.prototype must not be polluted");
    // cleanup
    Reflect.deleteProperty(Object.prototype as Record<string, unknown>, "polluted");
  });

  it("rejects metadata set with constructor and prototype keys", () => {
    for (const key of ["constructor", "prototype"]) {
      assert.throws(
        () => patchDocument(baseDoc, [{ op: "set", target: { metadata: key } as never, value: "x" }]),
        (err: unknown) => {
          assert.ok(err instanceof DocumentsPatchError);
          assert.equal((err as DocumentsPatchError).code, "ERR_PRISM_DOCUMENTS_UNSAFE_PATH");
          return true;
        },
      );
    }
  });

  it("rejects set patch whose patch object contains prototype-polluting key", () => {
    assert.throws(
      () =>
        patchDocument(baseDoc, [
          {
            op: "set",
            target: { block: 1 },
            patch: { ["__proto__"]: { polluted: true } } as Record<string, unknown>,
          },
        ]),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsPatchError);
        assert.equal((err as DocumentsPatchError).code, "ERR_PRISM_DOCUMENTS_UNSAFE_PATH");
        return true;
      },
    );
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
    // cleanup
    Reflect.deleteProperty(Object.prototype as Record<string, unknown>, "polluted");
  });
});
