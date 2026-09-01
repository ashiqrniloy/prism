import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateWorkbookSync } from "@office-open/xlsx";
import { parseCsv, parseWorkbook } from "../index.js";
import type { SheetsTelemetry, SheetsTelemetryAttributeValue, SheetsTelemetrySpan } from "../telemetry.js";

describe("@arnilo/prism-office/sheets — Telemetry Seam & Privacy", () => {
  it("records standard metadata metrics without leaking cell text for CSV parses", async () => {
    const csv = `id,pii_ssn,medical_diagnosis\n1,123-45-6789,CONFIDENTIAL_HEALTH_RECORD\n`;

    const attributes: Record<string, SheetsTelemetryAttributeValue> = {};
    let ended = false;

    const telemetry: SheetsTelemetry = {
      startSpan(name, initialAttrs) {
        assert.equal(name, "sheets.parse");
        for (const [k, v] of Object.entries(initialAttrs ?? {})) {
          attributes[k] = v;
        }
        const span: SheetsTelemetrySpan = {
          setAttribute(key, value) {
            attributes[key] = value;
          },
          addEvent() {},
          recordError() {},
          end() {
            ended = true;
          },
        };
        return span;
      },
    };

    const parsed = await parseCsv(csv, { telemetry });
    assert.equal(parsed.rows.length, 2);
    assert.equal(ended, true);

    // Verify structured metadata
    assert.equal(attributes["sheets.format"], "csv");
    assert.equal(typeof attributes["sheets.bytes"], "number");
    assert.equal(attributes["sheets.rows"], 2);
    assert.equal(attributes["sheets.columns"], 3);
    assert.equal(attributes["sheets.sheetCount"], 1);

    // Verify ZERO leakage of sensitive cell contents
    for (const [k, v] of Object.entries(attributes)) {
      assert(!k.includes("CONFIDENTIAL") && !k.includes("123-45-6789"));
      assert(!String(v).includes("CONFIDENTIAL") && !String(v).includes("123-45-6789"));
    }
  });

  it("records standard metadata metrics without leaking cell text for XLSX parses", async () => {
    const bytes = generateWorkbookSync({
      worksheets: [
        {
          name: "SecretPayroll",
          rows: [
            { cells: [{ value: "Employee" }, { value: "Salary" }] },
            { cells: [{ value: "SECRET_EMPLOYEE_ID_9999" }, { value: "150000.00" }] },
          ],
        },
      ],
    });

    const attributes: Record<string, SheetsTelemetryAttributeValue> = {};
    let ended = false;

    const telemetry: SheetsTelemetry = {
      startSpan(name, initialAttrs) {
        assert.equal(name, "sheets.parse");
        for (const [k, v] of Object.entries(initialAttrs ?? {})) {
          attributes[k] = v;
        }
        const span: SheetsTelemetrySpan = {
          setAttribute(key, value) {
            attributes[key] = value;
          },
          addEvent() {},
          recordError() {},
          end() {
            ended = true;
          },
        };
        return span;
      },
    };

    const parsed = await parseWorkbook(new Uint8Array(bytes), { telemetry });
    assert.equal(parsed.sheets.length, 1);
    assert.equal(ended, true);

    assert.equal(attributes["sheets.format"], "xlsx");
    assert.equal(typeof attributes["sheets.bytes"], "number");
    assert.equal(attributes["sheets.sheetCount"], 1);
    assert.equal(attributes["sheets.rows"], 2);
    assert.equal(attributes["sheets.columns"], 2);

    for (const [k, v] of Object.entries(attributes)) {
      assert(!k.includes("SECRET_EMPLOYEE"));
      assert(!String(v).includes("SECRET_EMPLOYEE"));
    }
  });
});
