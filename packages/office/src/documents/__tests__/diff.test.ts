import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffDocument } from "../diff.js";
import { DocumentsValidationError } from "../errors.js";
import type { DeckModel, DocModel, SheetModel } from "../types.js";

const doc = (blocks: DocModel["blocks"], title = "T"): DocModel => ({
  kind: "doc",
  modelVersion: 1,
  title,
  blocks,
});

describe("diffDocument", () => {
  it("diffs paragraph, table cell, and slide; decimal strings compare exactly", () => {
    const from = doc([
      { type: "paragraph", text: "hello" },
      {
        type: "table",
        rows: 1,
        columns: 1,
        cells: [[{ type: "decimal", value: "1234.50" }]],
      },
    ]);
    const sameDecimal = doc([
      { type: "paragraph", text: "hello" },
      {
        type: "table",
        rows: 1,
        columns: 1,
        cells: [[{ type: "decimal", value: "1234.50" }]],
      },
    ]);
    assert.equal(diffDocument(from, sameDecimal).changes.length, 0);

    const para = diffDocument(from, doc([{ type: "paragraph", text: "goodbye" }, from.blocks[1]!]));
    assert.equal(
      para.changes.some((change) => change.path === "blocks/0" && change.op === "replace"),
      true,
    );

    const cell = diffDocument(
      from,
      doc([from.blocks[0]!, { type: "table", rows: 1, columns: 1, cells: [[{ type: "decimal", value: "1234.5" }]] }]),
    );
    assert.equal(
      cell.changes.some((change) => change.path === "blocks/1/cells/0/0"),
      true,
    );

    const deckFrom: DeckModel = { kind: "deck", modelVersion: 1, slides: [{ layout: "title", title: "A" }] };
    const deckTo: DeckModel = { kind: "deck", modelVersion: 1, slides: [{ layout: "title", title: "B" }] };
    assert.equal(
      diffDocument(deckFrom, deckTo).changes.some((change) => change.path === "slides/0"),
      true,
    );
  });

  it("reports truncation instead of unbounded walk", () => {
    const from = doc(Array.from({ length: 8 }, (_, i) => ({ type: "paragraph" as const, text: `p${i}` })));
    const to = doc(Array.from({ length: 8 }, (_, i) => ({ type: "paragraph" as const, text: `q${i}` })));
    const diff = diffDocument(from, to, { maxOps: 2, maxNodes: 64 });
    assert.equal(diff.truncated, true);
    assert.ok(diff.changes.length <= 2);
  });

  it("rejects kind mismatch", () => {
    const sheet: SheetModel = { kind: "sheet", modelVersion: 1, sheets: [{ name: "S", cells: [["a"]] }] };
    assert.throws(() => diffDocument(doc([]), sheet), DocumentsValidationError);
  });
});
