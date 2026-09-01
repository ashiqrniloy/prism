import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv, SheetsCapError, SheetsFormatError } from "../index.js";
import type { SheetsTelemetry, SheetsTelemetryAttributeValue, SheetsTelemetrySpan } from "../telemetry.js";

describe("@arnilo/prism-office/sheets — CSV Parser & Dialect Sniffing", () => {
  it("sniffs standard comma delimiter and parses RFC 4180 fields", async () => {
    const csv = 'name,amount,active\n"Alice",1234.56,true\n"Bob",99.95,false\n';
    const result = await parseCsv(csv);

    assert.equal(result.dialect.delimiter, ",");
    assert.equal(result.dialect.quote, '"');
    assert.equal(result.dialect.hasHeader, true);
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows[0], ["name", "amount", "active"]);
    assert.equal(result.rows[1][0], "Alice");
    assert.deepEqual(result.rows[1][1], { type: "decimal", value: "1234.56" });
    assert.equal(result.rows[1][2], true);
    assert.equal(result.rows[2][0], "Bob");
    assert.deepEqual(result.rows[2][1], { type: "decimal", value: "99.95" });
    assert.equal(result.rows[2][2], false);
  });

  it("sniffs semicolon delimiter when fields contain quoted commas", async () => {
    const csv = 'item;location;cost\n"Consulting, LLC";"NY, USA";4500.00\n"Hardware, Inc";"SF, USA";1200.50\n';
    const result = await parseCsv(csv);

    assert.equal(result.dialect.delimiter, ";");
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[1][0], "Consulting, LLC");
    assert.equal(result.rows[1][1], "NY, USA");
    assert.deepEqual(result.rows[1][2], { type: "decimal", value: "4500.00" });
  });

  it("sniffs tab delimiter (TSV) and pipe delimiter", async () => {
    const tsv = "col1\tcol2\tcol3\nval1\tval2\tval3\n";
    const tsvResult = await parseCsv(tsv);
    assert.equal(tsvResult.dialect.delimiter, "\t");
    assert.equal(tsvResult.rows.length, 2);

    const psv = "id|name|score\n1|Alice|95\n2|Bob|88\n";
    const psvResult = await parseCsv(psv);
    assert.equal(psvResult.dialect.delimiter, "|");
    assert.equal(psvResult.rows.length, 3);
    assert.equal(psvResult.rows[1][0], 1);
    assert.equal(psvResult.rows[1][1], "Alice");
    assert.equal(psvResult.rows[1][2], 95);
  });

  it("handles embedded newlines and escaped doubled quotes within quoted fields", async () => {
    const csv = 'id,description,quote\n1,"Line 1\nLine 2\r\nLine 3","She said ""Hello World"""\n2,"Simple text","Normal quote"\n';
    const result = await parseCsv(csv);

    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[1][0], 1);
    assert.equal(result.rows[1][1], "Line 1\nLine 2\r\nLine 3");
    assert.equal(result.rows[1][2], 'She said "Hello World"');
    assert.equal(result.rows[2][0], 2);
    assert.equal(result.rows[2][1], "Simple text");
    assert.equal(result.rows[2][2], "Normal quote");
  });

  it("strips UTF-8 BOM from string and Uint8Array buffers", async () => {
    // String with UTF-8 BOM \uFEFF
    const strWithBom = '\uFEFFname,value\n"Alpha",100\n';
    const strResult = await parseCsv(strWithBom);
    assert.equal(strResult.rows[0][0], "name");
    assert.equal(strResult.rows[1][0], "Alpha");

    // Uint8Array with UTF-8 BOM bytes 0xEF, 0xBB, 0xBF
    const rawBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62, 0x0a, 0x31, 0x2c, 0x32, 0x0a]);
    const byteResult = await parseCsv(rawBytes);
    assert.deepEqual(byteResult.rows[0], ["a", "b"]);
    assert.deepEqual(byteResult.rows[1], [1, 2]);
  });

  it("rejects UTF-16 input with SheetsFormatError", async () => {
    // UTF-16 LE BOM bytes: 0xFF, 0xFE
    const utf16Bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00]);
    await assert.rejects(
      async () => parseCsv(utf16Bytes),
      (err: unknown) => {
        assert(err instanceof SheetsFormatError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT");
        assert.match(err.message, /UTF-16 encoding is unsupported/);
        return true;
      },
    );

    // UTF-16 BE BOM bytes: 0xFE, 0xFF
    const utf16BeBytes = new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x2c]);
    await assert.rejects(
      async () => parseCsv(utf16BeBytes),
      (err: unknown) => {
        assert(err instanceof SheetsFormatError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_UNSUPPORTED_FORMAT");
        return true;
      },
    );
  });

  it("refuses input exceeding maxBytes cap with SheetsCapError", async () => {
    const csv = "a,b,c\n1,2,3\n4,5,6\n7,8,9\n";
    await assert.rejects(
      async () => parseCsv(csv, { caps: { maxBytes: 10 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxBytes cap/);
        return true;
      },
    );
  });

  it("refuses input exceeding maxRows cap with SheetsCapError", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Row${i},${i}`).join("\n");
    await assert.rejects(
      async () => parseCsv(lines, { caps: { maxRows: 10 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxRows cap/);
        return true;
      },
    );
  });

  it("refuses input exceeding maxColumns cap with SheetsCapError", async () => {
    const wideLine = Array.from({ length: 20 }, (_, i) => `Col${i}`).join(",");
    await assert.rejects(
      async () => parseCsv(wideLine, { caps: { maxColumns: 5 } }),
      (err: unknown) => {
        assert(err instanceof SheetsCapError);
        assert.equal(err.code, "ERR_PRISM_SHEETS_CAP");
        assert.match(err.message, /exceeds maxColumns cap/);
        return true;
      },
    );
  });

  it("records warnings when dialect breaks mid-file without crashing", async () => {
    // Row 1 has 3 cols, Row 2 has 2 cols, Row 3 has 4 cols
    const inconsistentCsv = "a,b,c\n1,2\n10,20,30,40\n";
    const result = await parseCsv(inconsistentCsv);

    assert.equal(result.rows.length, 3);
    const dialectWarnings = result.warnings.filter((w) => w.kind === "dialect-mismatch");
    assert.equal(dialectWarnings.length, 2);
    assert.equal(dialectWarnings[0].row, 2);
    assert.equal(dialectWarnings[1].row, 3);
  });

  it("returns empty result on empty or whitespace-only input", async () => {
    const emptyResult = await parseCsv("");
    assert.equal(emptyResult.rows.length, 0);
    assert.equal(emptyResult.schema.length, 0);
    assert.equal(emptyResult.warnings.length, 0);

    const whitespaceResult = await parseCsv("   \n\n\t\n  ");
    assert.equal(whitespaceResult.rows.length, 0);
  });

  it("invokes telemetry seam on CSV parse without leaking sensitive text", async () => {
    const csv = "id,secret\n1,SUPER_SECRET_TOKEN_999\n";

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

    const result = await parseCsv(csv, { telemetry: mockTelemetry });
    assert.equal(result.rows.length, 2);
    assert(spanEnded);

    assert.equal(recordedAttributes["sheets.format"], "csv");
    assert.equal(recordedAttributes["sheets.rows"], 2);
    assert.equal(recordedAttributes["sheets.columns"], 2);
    assert.equal(recordedAttributes["sheets.sheetCount"], 1);

    for (const [k, v] of Object.entries(recordedAttributes)) {
      assert(!k.includes("SUPER_SECRET"));
      assert(!String(v).includes("SUPER_SECRET"));
    }
  });

  it("allows overriding dialect explicitly", async () => {
    const csv = "a|b|c\n1|2|3\n";
    const result = await parseCsv(csv, {
      dialect: { delimiter: "|" },
    });

    assert.equal(result.dialect.delimiter, "|");
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows[0], ["a", "b", "c"]);
  });
});
