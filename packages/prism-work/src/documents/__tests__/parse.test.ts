import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type DeckModel,
  type DocModel,
  DocumentsCapError,
  DocumentsParseError,
  generateDocument,
  parseDocument,
  type SecretRedactor,
  type SheetModel,
} from "../index.js";

describe("parseDocument", () => {
  const docFixture: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: "Quarterly Review",
    blocks: [
      { type: "heading", level: 1, text: "Executive Summary" },
      {
        type: "paragraph",
        runs: [
          { text: "Revenue increased by ", bold: false },
          { text: "35% year-over-year.", bold: true },
        ],
      },
      {
        type: "table",
        rows: 2,
        columns: 2,
        cells: [
          ["Region", "ARR"],
          ["North America", "15000000"],
        ],
      },
      { type: "page-break" },
    ],
  };

  const sheetFixture: SheetModel = {
    kind: "sheet",
    modelVersion: 1,
    sheets: [
      {
        name: "Financial Data",
        columnWidths: [
          { column: 0, width: 25 },
          { column: 1, width: 20 },
        ],
        frozenPanes: { rows: 1, columns: 0 },
        cells: [
          ["Line Item", "Total"],
          ["Operating Expenses", 450000],
          ["Calculated Net", { formula: "=SUM(B2:B2)", cachedValue: 450000 }],
        ],
      },
    ],
  };

  const deckFixture: DeckModel = {
    kind: "deck",
    modelVersion: 1,
    slides: [
      {
        layout: "title",
        title: "Product Launch",
        subtitle: "Q4 Roadmap",
      },
      {
        layout: "title-and-content",
        title: "Strategic Pillars",
        bullets: ["Developer Experience", "Enterprise Reliability", "AI Automation"],
        notes: "Emphasize enterprise security standards.",
      },
    ],
  };

  it("parses generated DOCX into a valid DocModel (round-trip)", async () => {
    const { bytes } = await generateDocument(docFixture, { format: "docx" });
    const parsed = (await parseDocument(bytes, { kind: "doc" })) as DocModel;

    assert.equal(parsed.kind, "doc");
    assert.equal(parsed.modelVersion, 1);
    assert.equal(parsed.title, "Quarterly Review");
    assert.ok(parsed.blocks.length >= 3);

    const heading = parsed.blocks.find((b) => b.type === "heading");
    assert.ok(heading && heading.type === "heading");
    assert.equal(heading.text, "Executive Summary");
    assert.equal(heading.level, 1);

    const table = parsed.blocks.find((b) => b.type === "table");
    assert.ok(table && table.type === "table");
    assert.equal(table.cells[0][0], "Region");
  });

  it("parses generated XLSX into a valid SheetModel (round-trip)", async () => {
    const { bytes } = await generateDocument(sheetFixture, { format: "xlsx" });
    const parsed = (await parseDocument(bytes, { kind: "sheet" })) as SheetModel;

    assert.equal(parsed.kind, "sheet");
    assert.equal(parsed.modelVersion, 1);
    assert.equal(parsed.sheets.length, 1);
    assert.equal(parsed.sheets[0].name, "Financial Data");
    assert.equal(parsed.sheets[0].cells.length, 3);
    assert.equal(parsed.sheets[0].cells[0][0], "Line Item");
    assert.equal(parsed.sheets[0].cells[1][1], 450000);
    const formulaCell = parsed.sheets[0].cells[2][1];
    assert.ok(typeof formulaCell === "object" && formulaCell !== null && "formula" in formulaCell);
    assert.equal(formulaCell.formula, "=SUM(B2:B2)");
  });

  it("parses generated PPTX into a valid DeckModel (round-trip)", async () => {
    const { bytes } = await generateDocument(deckFixture, { format: "pptx" });
    const parsed = (await parseDocument(bytes, { kind: "deck" })) as DeckModel;

    assert.equal(parsed.kind, "deck");
    assert.equal(parsed.modelVersion, 1);
    assert.equal(parsed.slides.length, 2);
    assert.equal(parsed.slides[0].title, "Product Launch");
    assert.equal(parsed.slides[0].subtitle, "Q4 Roadmap");
    assert.equal(parsed.slides[1].title, "Strategic Pillars");
    assert.ok(parsed.slides[1].bullets && parsed.slides[1].bullets.length === 3);
    assert.equal(parsed.slides[1].bullets[0], "Developer Experience");
    assert.equal(parsed.slides[1].notes, "Emphasize enterprise security standards.");
  });

  it("rejects non-ZIP bytes with DocumentsParseError", async () => {
    const corruptedBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await assert.rejects(
      async () => parseDocument(corruptedBytes, { kind: "doc" }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsParseError);
        assert.equal((err as DocumentsParseError).code, "ERR_PRISM_DOCUMENTS_PARSE_FAILED");
        assert.match((err as DocumentsParseError).message, /missing ZIP/);
        return true;
      },
    );
  });

  it("enforces maxBytes cap on input buffer", async () => {
    const { bytes } = await generateDocument(docFixture, { format: "docx" });
    await assert.rejects(
      async () => parseDocument(bytes, { kind: "doc", caps: { maxBytes: 100 } }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsCapError);
        assert.equal((err as DocumentsCapError).code, "ERR_PRISM_DOCUMENTS_CAP");
        assert.match((err as DocumentsCapError).message, /exceeds maxBytes cap/);
        return true;
      },
    );
  });

  it("enforces element caps on parsed model", async () => {
    const { bytes } = await generateDocument(deckFixture, { format: "pptx" });
    await assert.rejects(
      async () => parseDocument(bytes, { kind: "deck", caps: { maxSlides: 1 } }),
      (err: unknown) => {
        assert.ok(err instanceof DocumentsCapError);
        assert.equal((err as DocumentsCapError).code, "ERR_PRISM_DOCUMENTS_CAP");
        assert.match((err as DocumentsCapError).message, /exceeding maxSlides cap/);
        return true;
      },
    );
  });

  it("applies SecretRedactor to sanitize text content at parse boundary", async () => {
    const redactor: SecretRedactor = {
      redact(text: string): string {
        return text.replace(/Q4|enterprise|Developer/gi, "[REDACTED]");
      },
    };

    const { bytes } = await generateDocument(deckFixture, { format: "pptx" });
    const parsed = (await parseDocument(bytes, { kind: "deck", redactor })) as DeckModel;

    assert.equal(parsed.slides[0].subtitle, "[REDACTED] Roadmap");
    assert.equal(parsed.slides[1].bullets?.[0], "[REDACTED] Experience");
    assert.equal(parsed.slides[1].bullets?.[1], "[REDACTED] Reliability");
    assert.equal(parsed.slides[1].notes, "Emphasize [REDACTED] security standards.");
  });
});
