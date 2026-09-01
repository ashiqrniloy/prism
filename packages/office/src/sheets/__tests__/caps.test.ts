import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateWorkbookSync } from "@office-open/xlsx";
import {
  HARD_MAX_COLUMNS,
  HARD_MAX_ROWS,
  HARD_MAX_SHEET_BYTES,
  HARD_MAX_SHEETS,
  parseCsv,
  parseWorkbook,
  resolveSheetsCaps,
  SheetsCapError,
  SheetsValidationError,
} from "../index.js";

describe("@arnilo/prism-office/sheets — Caps & Oversize Refusal", () => {
  it("refuses oversized synthetic CSV at row cap boundary without multi-GB memory explosion", async () => {
    // Generate synthetic rows that exceed the configured row cap
    const configuredCap = 1_000;
    const excessRows = Array.from({ length: configuredCap + 10 }, (_, i) => `${i},item_${i},100.00`).join("\n");

    await assert.rejects(
      async () => parseCsv(excessRows, { caps: { maxRows: configuredCap } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxRows cap/);
        return true;
      },
    );
  });

  it("refuses input exceeding byte cap before executing full parse", async () => {
    const text = "id,name,value\n1,Alpha,100\n2,Beta,200\n3,Gamma,300\n";
    const byteLen = Buffer.byteLength(text, "utf8");

    await assert.rejects(
      async () => parseCsv(text, { caps: { maxBytes: byteLen - 1 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxBytes cap/);
        return true;
      },
    );
  });

  it("refuses multi-sheet workbook exceeding maxSheets cap", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [
        { name: "S1", rows: [{ cells: [{ value: 1 }] }] },
        { name: "S2", rows: [{ cells: [{ value: 2 }] }] },
        { name: "S3", rows: [{ cells: [{ value: 3 }] }] },
        { name: "S4", rows: [{ cells: [{ value: 4 }] }] },
      ],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(bytes), { caps: { maxSheets: 3 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeding maxSheets cap/);
        return true;
      },
    );
  });

  it("refuses wide rows exceeding maxColumns cap in CSV and XLSX", async () => {
    const wideCsv = `${Array.from({ length: 50 }, (_, i) => `col_${i}`).join(",")}\n`;
    await assert.rejects(
      async () => parseCsv(wideCsv, { caps: { maxColumns: 20 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxColumns cap/);
        return true;
      },
    );

    const wideXlsx = generateWorkbookSync({
      worksheets: [
        {
          name: "Wide",
          rows: [
            {
              cells: Array.from({ length: 30 }, (_, i) => ({ value: `Cell ${i}` })),
            },
          ],
        },
      ],
    });

    await assert.rejects(
      async () => parseWorkbook(new Uint8Array(wideXlsx), { caps: { maxColumns: 10 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxColumns cap/);
        return true;
      },
    );
  });

  it("enforces hard ceiling limits against user-configured caps", () => {
    // Valid caps
    const resolved = resolveSheetsCaps({
      maxBytes: 10_000_000,
      maxSheets: 50,
      maxRows: 50_000,
      maxColumns: 500,
    });
    assert.equal(resolved.maxBytes, 10_000_000);
    assert.equal(resolved.maxSheets, 50);

    // Beyond hard ceiling
    assert.throws(() => resolveSheetsCaps({ maxBytes: HARD_MAX_SHEET_BYTES + 1 }), SheetsValidationError);
    assert.throws(() => resolveSheetsCaps({ maxSheets: HARD_MAX_SHEETS + 1 }), SheetsValidationError);
    assert.throws(() => resolveSheetsCaps({ maxRows: HARD_MAX_ROWS + 1 }), SheetsValidationError);
    assert.throws(() => resolveSheetsCaps({ maxColumns: HARD_MAX_COLUMNS + 1 }), SheetsValidationError);

    // Negative / zero / non-integer caps
    assert.throws(() => resolveSheetsCaps({ maxBytes: -100 }), SheetsValidationError);
    assert.throws(() => resolveSheetsCaps({ maxRows: 0 }), SheetsValidationError);
    assert.throws(() => resolveSheetsCaps({ maxColumns: 1.5 }), SheetsValidationError);
  });
});
