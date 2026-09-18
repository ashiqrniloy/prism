import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type DeckModel, type DocModel, DocumentsValidationError, type SheetModel, validateDocumentModel } from "../index.js";

describe("Prism Document Model Validation", () => {
  const validDocModel: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: "Q3 Financial Summary",
    blocks: [
      { type: "heading", level: 1, text: "Executive Summary" },
      {
        type: "paragraph",
        text: "Revenue grew 14% year-over-year.",
        runs: [{ text: "Revenue grew ", bold: true }, { text: "14% ", italic: true }, { text: "year-over-year." }],
      },
      {
        type: "list",
        ordered: false,
        items: [
          "Enterprise expansion in EU",
          { text: "APAC partner growth", runs: [{ text: "APAC", bold: true }, { text: " partner growth" }] },
        ],
      },
      {
        type: "table",
        rows: 2,
        columns: 2,
        headers: ["Metric", "Value"],
        cells: [
          ["Total ARR", { type: "decimal", value: "45200000.50" }],
          ["YoY Growth", { type: "decimal", value: "0.14" }],
        ],
      },
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        alt: "ARR chart",
        width: 400,
        height: 300,
      },
      { type: "page-break" },
      {
        type: "chart",
        chartType: "bar",
        title: "Quarterly Revenue",
        data: {
          categories: ["Q1", "Q2", "Q3", "Q4"],
          series: [{ name: "2026", values: [10.2, 11.5, 12.8, 14.1] }],
        },
      },
    ],
  };

  const validSheetModel: SheetModel = {
    kind: "sheet",
    modelVersion: 1,
    title: "Ledger",
    sheets: [
      {
        name: "General Ledger",
        columnWidths: [
          { column: 0, width: 20 },
          { column: 1, width: 30 },
        ],
        frozenPanes: { rows: 1, columns: 0 },
        cells: [
          ["Date", "Account", "Debit", "Credit"],
          [{ type: "date", value: "2026-08-31" }, "Cash", { type: "decimal", value: "1000.00" }, null],
          [{ type: "datetime", value: "2026-08-31T18:00:00Z" }, "Accounts Receivable", null, { type: "decimal", value: "1000.00" }],
          ["Total", "Balance", { formula: "=SUM(C2:C3)", cachedValue: 1000 }, { formula: "=SUM(D2:D3)", cachedValue: 1000 }],
        ],
      },
    ],
  };

  const validDeckModel: DeckModel = {
    kind: "deck",
    modelVersion: 1,
    title: "Board Deck",
    slides: [
      {
        layout: "title",
        title: "Q3 Board Review",
        subtitle: "Confidential",
        notes: "Welcome attendees and introduce the agenda.",
      },
      {
        layout: "title-and-content",
        title: "Key Highlights",
        bullets: ["Completed SOC2 Type II audit", "Shipped multi-tenant RAG engine"],
      },
    ],
  };

  it("validates doc, sheet, and deck fixtures successfully", () => {
    assert.doesNotThrow(() => validateDocumentModel(validDocModel));
    assert.doesNotThrow(() => validateDocumentModel(validSheetModel));
    assert.doesNotThrow(() => validateDocumentModel(validDeckModel));
  });

  it("rejects non-object or null input", () => {
    assert.throws(
      () => validateDocumentModel(null),
      (err) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.equal(err.code, "ERR_PRISM_DOCUMENTS_INVALID_MODEL");
        return true;
      },
    );
    assert.throws(() => validateDocumentModel("string-model"), DocumentsValidationError);
    assert.throws(() => validateDocumentModel([]), DocumentsValidationError);
  });

  it("rejects unknown kind", () => {
    assert.throws(
      () => validateDocumentModel({ kind: "audio", modelVersion: 1, blocks: [] }),
      (err) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.match(err.message, /unknown document kind/);
        return true;
      },
    );
  });

  it("rejects missing or invalid modelVersion", () => {
    assert.throws(
      () => validateDocumentModel({ kind: "doc", blocks: [] }),
      (err) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.match(err.message, /modelVersion must be a positive safe integer/);
        return true;
      },
    );
    assert.throws(() => validateDocumentModel({ kind: "doc", modelVersion: 0, blocks: [] }), DocumentsValidationError);
    assert.throws(() => validateDocumentModel({ kind: "doc", modelVersion: -1, blocks: [] }), DocumentsValidationError);
  });

  it("rejects unknown block type in doc model", () => {
    const invalidDoc = {
      kind: "doc",
      modelVersion: 1,
      blocks: [{ type: "video_embed", url: "https://example.com/video.mp4" }],
    };
    assert.throws(() => validateDocumentModel(invalidDoc), DocumentsValidationError);
  });

  it("rejects invalid heading level", () => {
    const invalidHeading = {
      kind: "doc",
      modelVersion: 1,
      blocks: [{ type: "heading", level: 7, text: "Too deep" }],
    };
    assert.throws(() => validateDocumentModel(invalidHeading), DocumentsValidationError);
  });

  it("rejects table with row/column dimension mismatches", () => {
    const mismatchedRows: DocModel = {
      kind: "doc",
      modelVersion: 1,
      blocks: [
        {
          type: "table",
          rows: 3,
          columns: 2,
          cells: [
            ["A", "B"],
            ["C", "D"],
          ],
        },
      ],
    };
    assert.throws(
      () => validateDocumentModel(mismatchedRows),
      (err) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.match(err.message, /declares 3 rows but contains 2/);
        return true;
      },
    );

    const mismatchedCols: DocModel = {
      kind: "doc",
      modelVersion: 1,
      blocks: [
        {
          type: "table",
          rows: 2,
          columns: 3,
          cells: [
            ["A", "B", "C"],
            ["D", "E"],
          ],
        },
      ],
    };
    assert.throws(
      () => validateDocumentModel(mismatchedCols),
      (err) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.match(err.message, /row 1 declares 3 columns but contains 2/);
        return true;
      },
    );
  });

  it("rejects non-canonical decimal strings in sheet model", () => {
    const invalidDecimalSheet = {
      kind: "sheet",
      modelVersion: 1,
      sheets: [
        {
          name: "Data",
          cells: [[{ type: "decimal", value: "1.23e4" }]],
        },
      ],
    };
    assert.throws(() => validateDocumentModel(invalidDecimalSheet), DocumentsValidationError);

    const trailingDotSheet = {
      kind: "sheet",
      modelVersion: 1,
      sheets: [
        {
          name: "Data",
          cells: [[{ type: "decimal", value: "123." }]],
        },
      ],
    };
    assert.throws(() => validateDocumentModel(trailingDotSheet), DocumentsValidationError);
  });

  it("rejects invalid deck layout", () => {
    const invalidDeck = {
      kind: "deck",
      modelVersion: 1,
      slides: [{ layout: "unsupported_layout", title: "Test" }],
    };
    assert.throws(() => validateDocumentModel(invalidDeck), DocumentsValidationError);
  });

  it("validates 100-block model in < 10ms warm", () => {
    const largeDoc: DocModel = {
      kind: "doc",
      modelVersion: 1,
      title: "Large Benchmark Document",
      blocks: Array.from({ length: 100 }, (_, i) => ({
        type: "paragraph",
        text: `Paragraph ${i}: Bounded content benchmark for Prism Document Model.`,
        runs: [{ text: `Paragraph ${i}: `, bold: true }, { text: "Bounded content benchmark." }],
      })),
    };

    // Warm-up compile
    validateDocumentModel(largeDoc);

    const start = performance.now();
    for (let i = 0; i < 10; i += 1) {
      validateDocumentModel(largeDoc);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / 10;
    assert.ok(avgMs < 10, `Average validation time ${avgMs.toFixed(2)}ms should be < 10ms`);
  });
});
