import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseCsv, parseWorkbook } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = fs.existsSync(path.resolve(__dirname, "../../../fixtures"))
  ? path.resolve(__dirname, "../../../fixtures")
  : path.resolve(__dirname, "../../fixtures");

describe("@arnilo/prism-office/sheets — Golden Fixture Corpus & Adversarial Ingestion", () => {
  it("parses money.csv and verifies decimal safety on all financial columns", async () => {
    const filePath = path.join(fixturesDir, "money.csv");
    const content = fs.readFileSync(filePath, "utf-8");
    const result = await parseCsv(content);

    assert.equal(result.rows.length, 5);
    assert.equal(result.schema.length, 6);

    // Schema type checks
    assert.equal(result.schema[0].name, "transaction_id");
    assert.equal(result.schema[0].type, "string");

    assert.equal(result.schema[1].name, "description");
    assert.equal(result.schema[1].type, "string");

    assert.equal(result.schema[2].name, "currency_symbol");
    assert.equal(result.schema[2].type, "decimal");

    assert.equal(result.schema[3].name, "total_amount");
    assert.equal(result.schema[3].type, "decimal");

    assert.equal(result.schema[4].name, "unit_price");
    assert.equal(result.schema[4].type, "decimal");

    assert.equal(result.schema[5].name, "refund_fee");
    assert.equal(result.schema[5].type, "decimal");

    // Row 1 value checks
    const row1 = result.rows[1];
    assert.equal(row1[0], "TXN-1001");
    assert.equal(row1[1], "Software Consulting");
    assert.deepEqual(row1[2], { type: "decimal", value: "1234.56" });
    assert.deepEqual(row1[3], { type: "decimal", value: "1234.56" });
    assert.deepEqual(row1[4], { type: "decimal", value: "99.95" });
    assert.deepEqual(row1[5], { type: "decimal", value: "-50.00" });

    // Row 2 value checks (accounting parenthesis and minus)
    const row2 = result.rows[2];
    assert.deepEqual(row2[2], { type: "decimal", value: "450.00" });
    assert.deepEqual(row2[3], { type: "decimal", value: "450.00" });
    assert.deepEqual(row2[4], { type: "decimal", value: "450.00" });
    assert.deepEqual(row2[5], { type: "decimal", value: "-10.00" });
  });

  it("parses dialects corpus (comma, semicolon, tab, pipe, quoted-newlines)", async () => {
    // Comma
    const commaContent = fs.readFileSync(path.join(fixturesDir, "dialects/comma.csv"), "utf-8");
    const commaRes = await parseCsv(commaContent);
    assert.equal(commaRes.dialect.delimiter, ",");
    assert.equal(commaRes.rows.length, 4);
    assert.equal(commaRes.schema[1].type, "integer");
    assert.equal(commaRes.schema[2].type, "boolean");
    assert.equal(commaRes.schema[3].type, "decimal");

    // Semicolon with embedded quoted commas
    const semiContent = fs.readFileSync(path.join(fixturesDir, "dialects/semicolon.csv"), "utf-8");
    const semiRes = await parseCsv(semiContent);
    assert.equal(semiRes.dialect.delimiter, ";");
    assert.equal(semiRes.rows.length, 4);
    assert.equal(semiRes.rows[1][0], "Acme, Corp");
    assert.equal(semiRes.rows[1][1], "123 Main St, New York");
    assert.deepEqual(semiRes.rows[1][2], { type: "decimal", value: "1000000.00" });

    // Tab TSV
    const tabContent = fs.readFileSync(path.join(fixturesDir, "dialects/tab.tsv"), "utf-8");
    const tabRes = await parseCsv(tabContent);
    assert.equal(tabRes.dialect.delimiter, "\t");
    assert.equal(tabRes.rows.length, 4);
    assert.equal(tabRes.schema[0].type, "integer");
    assert.equal(tabRes.schema[3].type, "decimal");

    // Pipe PSV
    const pipeContent = fs.readFileSync(path.join(fixturesDir, "dialects/pipe.psv"), "utf-8");
    const pipeRes = await parseCsv(pipeContent);
    assert.equal(pipeRes.dialect.delimiter, "|");
    assert.equal(pipeRes.rows.length, 4);
    assert.equal(pipeRes.rows[1][0], "US");

    // Quoted newlines
    const newlinesContent = fs.readFileSync(path.join(fixturesDir, "dialects/quoted-newlines.csv"), "utf-8");
    const newlinesRes = await parseCsv(newlinesContent);
    assert.equal(newlinesRes.rows.length, 4);
    assert.equal(newlinesRes.rows[1][2], "Paragraph 1\nParagraph 2 with, commas\nParagraph 3");
    assert.equal(newlinesRes.rows[2][2], 'Customer said: "Everything looks great!"\nConfirmed on 2026-08-31');
  });

  it("parses ambiguous corpus (mixed precision and locale mirrored)", async () => {
    const mixedContent = fs.readFileSync(path.join(fixturesDir, "ambiguous/mixed-precision.csv"), "utf-8");
    const mixedRes = await parseCsv(mixedContent);
    assert.equal(mixedRes.schema[1].name, "scientific_reading");
    assert.equal(mixedRes.schema[1].type, "string");
    assert.deepEqual(mixedRes.schema[1].flags, ["numeric-ambiguous"]);

    const localeContent = fs.readFileSync(path.join(fixturesDir, "ambiguous/locale-mirrored.csv"), "utf-8");
    const localeRes = await parseCsv(localeContent);
    assert.equal(localeRes.dialect.delimiter, ";");
    assert.equal(localeRes.rows.length, 4);
    assert.equal(localeRes.schema[2].type, "decimal");
    assert.deepEqual(localeRes.rows[1][2], { type: "decimal", value: "12345.67" });
  });

  it("safely ingests adversarial billion-quotes without recursion or exponential blowup", async () => {
    const filePath = path.join(fixturesDir, "adversarial/billion-quotes.csv");
    const content = fs.readFileSync(filePath, "utf-8");

    const startTime = performance.now();
    const result = await parseCsv(content);
    const elapsed = performance.now() - startTime;

    assert.equal(result.rows.length, 4);
    assert.equal(result.rows[1][1], '"hello"');
    assert.equal(result.rows[2][1], '"a""b""c"');
    assert.equal(result.rows[3][1], '"quoted"');
    assert(elapsed < 100, `Adversarial parse took ${elapsed}ms (must be < 100ms)`);
  });

  it("parses committed minimal.xlsx and financial.xlsx binaries", async () => {
    // 1. minimal.xlsx
    const minBytes = fs.readFileSync(path.join(fixturesDir, "xlsx/minimal.xlsx"));
    const minResult = await parseWorkbook(new Uint8Array(minBytes));
    assert.equal(minResult.sheets.length, 1);
    assert.equal(minResult.sheets[0].name, "Sheet1");
    assert.equal(minResult.sheets[0].rows.length, 2);

    // 2. financial.xlsx
    const finBytes = fs.readFileSync(path.join(fixturesDir, "xlsx/financial.xlsx"));
    const finResult = await parseWorkbook(new Uint8Array(finBytes));
    assert.equal(finResult.sheets.length, 2);
    assert.equal(finResult.sheets[0].name, "Revenue");
    assert.equal(finResult.sheets[1].name, "Expenses");

    // Check Revenue formulas and decimals
    const revRows = finResult.sheets[0].rows;
    assert.deepEqual(revRows[1][1], { type: "decimal", value: "1234.56" });
    assert.deepEqual(revRows[1][2], {
      type: "formula",
      formula: "=B2*0.2",
      cachedValue: "246.912",
    });

    // Check Expenses
    const expRows = finResult.sheets[1].rows;
    assert.equal(expRows[1][0], "Hosting");
    assert.deepEqual(expRows[1][1], { type: "decimal", value: "450" });
  });
});
