import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  type DeckModel,
  type DocModel,
  DocumentsCapError,
  DocumentsFormatError,
  DocumentsValidationError,
  generateDocument,
  type SheetModel,
} from "../index.js";

function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

describe("generateDocument", () => {
  const sampleDoc: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: "Quarterly Report",
    blocks: [
      { type: "heading", level: 1, text: "Performance Summary" },
      {
        type: "paragraph",
        runs: [{ text: "Net ARR increased by ", bold: false }, { text: "22% ", bold: true }, { text: "across all product lines." }],
      },
      {
        type: "list",
        ordered: true,
        items: ["North America expansion", "EMEA enterprise sales", "APAC pilot launches"],
      },
      {
        type: "table",
        rows: 2,
        columns: 2,
        headers: ["Region", "Revenue"],
        cells: [
          ["North America", { type: "decimal", value: "24500000.00" }],
          ["EMEA", { type: "decimal", value: "18200000.50" }],
        ],
      },
      { type: "page-break" },
      {
        type: "chart",
        chartType: "bar",
        title: "Regional Comparison",
        data: {
          categories: ["NA", "EMEA", "APAC"],
          series: [{ name: "Q3", values: [24.5, 18.2, 5.3] }],
        },
      },
    ],
  };

  const sampleSheet: SheetModel = {
    kind: "sheet",
    modelVersion: 1,
    title: "Financials",
    sheets: [
      {
        name: "Income Statement",
        columnWidths: [
          { column: 0, width: 25 },
          { column: 1, width: 20 },
        ],
        frozenPanes: { rows: 1, columns: 0 },
        cells: [
          ["Category", "Amount"],
          ["Subscription Revenue", { type: "decimal", value: "42700000.00" }],
          ["Professional Services", { type: "decimal", value: "5300000.00" }],
          ["Total Revenue", { formula: "=SUM(B2:B3)", cachedValue: 48000000 }],
        ],
      },
    ],
  };

  const sampleDeck: DeckModel = {
    kind: "deck",
    modelVersion: 1,
    title: "Investor Presentation",
    slides: [
      {
        layout: "title",
        title: "Series B Pitch",
        subtitle: "Growth & Unit Economics",
        notes: "Introduce executive team and set context.",
      },
      {
        layout: "title-and-content",
        title: "Key Metrics",
        bullets: ["128% Net Revenue Retention", "74% Gross Margins", "18 Months Runway"],
        notes: "Highlight gross margin improvements since last quarter.",
      },
      {
        layout: "two-column",
        title: "Go-To-Market Pillars",
        bullets: ["Enterprise Direct Sales", "Self-Serve PLG Funnel", "Global System Integrators", "Cloud Marketplace Listings"],
      },
    ],
  };

  it("generates valid DOCX with PK signature and matching contentHash", async () => {
    const result = await generateDocument(sampleDoc, { format: "docx" });
    assert.ok(result.bytes instanceof Uint8Array);
    assert.ok(result.bytes.length > 0);
    assert.ok(isZipContainer(result.bytes), "output must be a valid zip container");

    const expectedHash = createHash("sha256").update(result.bytes).digest("hex");
    assert.equal(result.contentHash, expectedHash);
    assert.equal(result.contentHash.length, 64);
  });

  it("generates valid XLSX with PK signature and matching contentHash", async () => {
    const result = await generateDocument(sampleSheet, { format: "xlsx" });
    assert.ok(result.bytes instanceof Uint8Array);
    assert.ok(result.bytes.length > 0);
    assert.ok(isZipContainer(result.bytes), "output must be a valid zip container");

    const expectedHash = createHash("sha256").update(result.bytes).digest("hex");
    assert.equal(result.contentHash, expectedHash);
  });

  it("generates valid PPTX with PK signature and matching contentHash", async () => {
    const result = await generateDocument(sampleDeck, { format: "pptx" });
    assert.ok(result.bytes instanceof Uint8Array);
    assert.ok(result.bytes.length > 0);
    assert.ok(isZipContainer(result.bytes), "output must be a valid zip container");

    const expectedHash = createHash("sha256").update(result.bytes).digest("hex");
    assert.equal(result.contentHash, expectedHash);
  });

  it("rejects mismatched kind and format with DocumentsFormatError", async () => {
    await assert.rejects(
      async () => generateDocument(sampleDoc, { format: "xlsx" }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsFormatError);
        assert.equal((err as DocumentsFormatError).code, "ERR_PRISM_DOCUMENTS_UNSUPPORTED_FORMAT");
        return true;
      },
    );

    await assert.rejects(async () => generateDocument(sampleSheet, { format: "pptx" }), DocumentsFormatError);

    await assert.rejects(async () => generateDocument(sampleDeck, { format: "docx" }), DocumentsFormatError);
  });

  it("rejects invalid model with DocumentsValidationError before translation", async () => {
    const invalidDoc = {
      kind: "doc",
      modelVersion: 1,
      blocks: [{ type: "unknown_block" }],
    };

    await assert.rejects(
      // @ts-expect-error testing invalid model
      async () => generateDocument(invalidDoc, { format: "docx" }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsValidationError);
        assert.equal((err as DocumentsValidationError).code, "ERR_PRISM_DOCUMENTS_INVALID_MODEL");
        return true;
      },
    );
  });

  it("enforces maxBlocks cap before generation producing no partial bytes", async () => {
    await assert.rejects(
      async () =>
        generateDocument(sampleDoc, {
          format: "docx",
          caps: { maxBlocks: 2 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsCapError);
        assert.equal((err as DocumentsCapError).code, "ERR_PRISM_DOCUMENTS_CAP");
        assert.match((err as DocumentsCapError).message, /exceeding maxBlocks cap/);
        return true;
      },
    );
  });

  it("enforces maxSlides cap before generation", async () => {
    await assert.rejects(
      async () =>
        generateDocument(sampleDeck, {
          format: "pptx",
          caps: { maxSlides: 2 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsCapError);
        assert.equal((err as DocumentsCapError).code, "ERR_PRISM_DOCUMENTS_CAP");
        assert.match((err as DocumentsCapError).message, /exceeding maxSlides cap/);
        return true;
      },
    );
  });

  it("enforces maxCells cap before generation", async () => {
    await assert.rejects(
      async () =>
        generateDocument(sampleSheet, {
          format: "xlsx",
          caps: { maxCells: 3 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsCapError);
        assert.equal((err as DocumentsCapError).code, "ERR_PRISM_DOCUMENTS_CAP");
        assert.match((err as DocumentsCapError).message, /exceed maxCells cap/);
        return true;
      },
    );
  });

  it("enforces maxBytes cap on generated output", async () => {
    await assert.rejects(
      async () =>
        generateDocument(sampleDoc, {
          format: "docx",
          caps: { maxBytes: 500 }, // generated zip is ~9KB
        }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsCapError);
        assert.equal((err as DocumentsCapError).code, "ERR_PRISM_DOCUMENTS_CAP");
        assert.match((err as DocumentsCapError).message, /exceeds maxBytes cap/);
        return true;
      },
    );
  });

  it("generates a 200-block document in < 500ms warm", async () => {
    const largeDoc: DocModel = {
      kind: "doc",
      modelVersion: 1,
      title: "200-Block Performance Document",
      blocks: Array.from({ length: 200 }, (_, i) => ({
        type: "paragraph",
        text: `Paragraph ${i}: Performance measurement block for Prism docx generator.`,
        runs: [
          { text: `Section ${i}: `, bold: true },
          { text: "Standard benchmark text payload.", italic: i % 2 === 0 },
        ],
      })),
    };

    // Warm-up run
    await generateDocument(largeDoc, { format: "docx" });

    const start = performance.now();
    const result = await generateDocument(largeDoc, { format: "docx" });
    const elapsed = performance.now() - start;

    assert.ok(result.bytes.length > 0);
    assert.ok(elapsed < 500, `Generation took ${elapsed.toFixed(2)}ms, expected < 500ms`);
  });
});
