import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateWorkbookSync } from "@office-open/xlsx";
import { parseWorkbook, SheetsCapError, SheetsFormatError, SheetsValidationError } from "../index.js";
import type { SheetsTelemetry, SheetsTelemetryAttributeValue, SheetsTelemetrySpan } from "../telemetry.js";

describe("@arnilo/prism-office/sheets — XLSX Parser & Container Gating", () => {
  it("parses a multi-sheet workbook with various cell types and formula preservation", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [
        {
          name: "Financials",
          rows: [
            {
              cells: [{ value: "Item" }, { value: "Amount" }, { value: "IsPaid" }, { value: "Calculated" }],
            },
            {
              cells: [{ value: "Consulting" }, { value: 1234.56 }, { value: true }, { formula: "B2*1.1", value: 1358.016 }],
            },
            {
              cells: [{ value: "Hardware" }, { value: 99.95 }, { value: false }, { formula: "SUM(B2:B3)", value: "1334.51" }],
            },
          ],
        },
        {
          name: "Summary",
          rows: [
            {
              cells: [{ value: "Total Rows" }, { value: 2 }],
            },
          ],
        },
      ],
    });

    const parsed = await parseWorkbook(new Uint8Array(bytes));

    assert.equal(parsed.sheets.length, 2);
    assert.equal(parsed.sheets[0].name, "Financials");
    assert.equal(parsed.sheets[1].name, "Summary");

    // Sheet 1 rows
    const fRows = parsed.sheets[0].rows;
    assert.equal(fRows.length, 3);
    assert.deepEqual(fRows[0], ["Item", "Amount", "IsPaid", "Calculated"]);

    // Row 1 checks
    assert.equal(fRows[1][0], "Consulting");
    assert.deepEqual(fRows[1][1], { type: "decimal", value: "1234.56" });
    assert.equal(fRows[1][2], true);
    assert.deepEqual(fRows[1][3], {
      type: "formula",
      formula: "=B2*1.1",
      cachedValue: "1358.016",
    });

    // Row 2 checks
    assert.equal(fRows[2][0], "Hardware");
    assert.deepEqual(fRows[2][1], { type: "decimal", value: "99.95" });
    assert.equal(fRows[2][2], false);
    assert.deepEqual(fRows[2][3], {
      type: "formula",
      formula: "=SUM(B2:B3)",
      cachedValue: "1334.51",
    });

    // Sheet 1 schema
    const schema = parsed.sheets[0].schema;
    assert.equal(schema.length, 4);
    assert.equal(schema[0].name, "Item");
    assert.equal(schema[1].name, "Amount");
    assert.equal(schema[2].name, "IsPaid");
    assert.equal(schema[3].name, "Calculated");
  });

  it("handles sparse rows and sparse column positions gracefully", async () => {
    // Generate workbook with row containing gap between col 0 and col 2
    const bytes = generateWorkbookSync({
      worksheets: [
        {
          name: "Sparse",
          rows: [
            {
              cells: [{ value: "Col A" }, { value: "Col B" }, { value: "Col C" }],
            },
            {
              // Row 2: cells at col A and col C, leaving col B empty/null
              cells: [{ value: "First" }, { value: "" }, { value: "Third" }],
            },
          ],
        },
      ],
    });

    const parsed = await parseWorkbook(new Uint8Array(bytes));
    assert.equal(parsed.sheets.length, 1);
    const rows = parsed.sheets[0].rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[1][0], "First");
    assert.equal(rows[1][2], "Third");
  });

  it("rejects non-ZIP input with SheetsFormatError (PK\\x03\\x04 container gating)", async () => {
    const nonZipBytes = new TextEncoder().encode("Not a zip file or XLSX document");
    await assert.rejects(
      async () => parseWorkbook(nonZipBytes),
      (err: unknown) => {
        assert(err instanceof SheetsFormatError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT");
        assert.match(err.message, /ZIP signature/);
        return true;
      },
    );
  });

  it("rejects short buffer with SheetsFormatError", async () => {
    const shortBytes = new Uint8Array([0x50, 0x4b]);
    await assert.rejects(
      async () => parseWorkbook(shortBytes),
      (err: unknown) => {
        assert(err instanceof SheetsFormatError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT");
        return true;
      },
    );
  });

  it("refuses input exceeding maxBytes cap with SheetsCapError", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [{ name: "S1", rows: [{ cells: [{ value: "Test" }] }] }],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(bytes), { caps: { maxBytes: 100 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxBytes cap/);
        return true;
      },
    );
  });

  it("refuses input exceeding maxSheets cap with SheetsCapError", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [
        { name: "Sheet1", rows: [{ cells: [{ value: "1" }] }] },
        { name: "Sheet2", rows: [{ cells: [{ value: "2" }] }] },
        { name: "Sheet3", rows: [{ cells: [{ value: "3" }] }] },
      ],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(bytes), { caps: { maxSheets: 2 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeding maxSheets cap/);
        return true;
      },
    );
  });

  it("refuses worksheet exceeding maxRows cap with SheetsCapError", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      cells: [{ value: `Row ${i + 1}` }],
    }));

    const bytes = generateWorkbookSync({
      worksheets: [{ name: "BigSheet", rows }],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(bytes), { caps: { maxRows: 10 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeding maxRows cap/);
        return true;
      },
    );
  });

  it("refuses worksheet exceeding maxColumns cap with SheetsCapError", async () => {
    const cells = Array.from({ length: 20 }, (_, i) => ({
      value: `Col ${i + 1}`,
    }));

    const bytes = generateWorkbookSync({
      worksheets: [{ name: "WideSheet", rows: [{ cells }] }],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(bytes), { caps: { maxColumns: 5 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxColumns cap/);
        return true;
      },
    );
  });

  it("rejects invalid cap configuration with SheetsValidationError", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [{ name: "Sheet1", rows: [{ cells: [{ value: "1" }] }] }],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(bytes), { caps: { maxRows: -5 } }),
      (err: unknown) => {
        assert(err instanceof SheetsValidationError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_VALIDATION");
        assert.match(err.message, /must be an integer/);
        return true;
      },
    );
  });

  it("invokes telemetry seam without leaking cell contents", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [
        {
          name: "SecretSheet",
          rows: [
            {
              cells: [{ value: "CONFIDENTIAL_PASSWORD_12345" }, { value: "9999.99" }],
            },
          ],
        },
      ],
    });

    const recordedAttributes: Record<string, SheetsTelemetryAttributeValue> = {};
    let spanEnded = false;

    const mockSpan: SheetsTelemetrySpan = {
      setAttribute(name, value) {
        recordedAttributes[name] = value;
      },
      addEvent() {},
      recordError() {},
      end() {
        spanEnded = true;
      },
    };

    const mockTelemetry: SheetsTelemetry = {
      startSpan(name, attributes) {
        assert.equal(name, "sheets.parse");
        for (const [k, v] of Object.entries(attributes ?? {})) {
          recordedAttributes[k] = v;
        }
        return mockSpan;
      },
    };

    const parsed = await parseWorkbook(new Uint8Array(bytes), { telemetry: mockTelemetry });
    assert.equal(parsed.sheets.length, 1);
    assert(spanEnded);

    // Verify telemetry attributes contain only metadata and byte/row counts
    assert.equal(recordedAttributes["sheets.format"], "xlsx");
    assert(typeof recordedAttributes["sheets.bytes"] === "number");
    assert.equal(recordedAttributes["sheets.sheetCount"], 1);
    assert.equal(recordedAttributes["sheets.rows"], 1);
    assert.equal(recordedAttributes["sheets.columns"], 2);

    // Ensure secret text is NOT present in any telemetry attribute key or value
    for (const [k, v] of Object.entries(recordedAttributes)) {
      assert(!k.includes("CONFIDENTIAL"));
      assert(!String(v).includes("CONFIDENTIAL"));
    }
  });

  it("preserves decimal precision as string and never converts to float", async () => {
    // Large decimal money values that lose precision with IEEE-754 double floats
    const bytes = generateWorkbookSync({
      worksheets: [
        {
          name: "MoneyPrecision",
          rows: [{ cells: [{ value: "Price" }, { value: "LargeAmount" }] }, { cells: [{ value: 0.1 }, { value: "9007199254740993" }] }],
        },
      ],
    });

    const parsed = await parseWorkbook(new Uint8Array(bytes));
    const rows = parsed.sheets[0].rows;
    assert.equal(rows.length, 2);

    // 0.1 -> { type: "decimal", value: "0.1" }
    const cell0 = rows[1][0];
    assert.equal(typeof cell0, "object");
    assert.notEqual(cell0, null);
    if (typeof cell0 === "object" && cell0 !== null && "type" in cell0) {
      assert.equal(cell0.type, "decimal");
      assert.equal(typeof cell0.value, "string");
      assert.equal(cell0.value, "0.1");
    }
  });

  it("handles date-formatted serial numbers from styles.xml", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [
        {
          name: "Dates",
          rows: [{ cells: [{ value: "EventDate" }] }, { cells: [{ value: new Date("2026-08-31T00:00:00.000Z") }] }],
        },
      ],
    });

    const parsed = await parseWorkbook(new Uint8Array(bytes));
    const rows = parsed.sheets[0].rows;
    assert.equal(rows.length, 2);
    const dateCell = rows[1][0];
    assert.ok(dateCell);
  });
});
