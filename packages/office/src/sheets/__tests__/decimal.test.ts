import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isCanonicalDecimal, isCurrencyString, isScientificNotation, normalizeDecimal } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@arnilo/prism-office/sheets — Decimal Safety & Normalization", () => {
  it("normalizes standard decimal strings without altering canonical form", () => {
    assert.deepEqual(normalizeDecimal("1234.56"), { value: "1234.56", isMoney: false });
    assert.deepEqual(normalizeDecimal("-0.05"), { value: "-0.05", isMoney: false });
    assert.deepEqual(normalizeDecimal("42"), { value: "42", isMoney: false });
    assert.deepEqual(normalizeDecimal(".75"), { value: "0.75", isMoney: false });
    assert.equal(isCanonicalDecimal("1234.56"), true);
    assert.equal(isCanonicalDecimal("-0.05"), true);
    assert.equal(isCanonicalDecimal("42"), true);
  });

  it("normalizes currency variants and detects money markers", () => {
    // US / UK Dollar
    assert.deepEqual(normalizeDecimal("$1,234.56"), { value: "1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("$ 99.95"), { value: "99.95", isMoney: true });
    assert.deepEqual(normalizeDecimal("99.95 USD"), { value: "99.95", isMoney: true });

    // Euro (EU separator format)
    assert.deepEqual(normalizeDecimal("€ 1.234,56"), { value: "1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("1.234,56 €"), { value: "1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("1234,56 EUR"), { value: "1234.56", isMoney: true });

    // British Pound
    assert.deepEqual(normalizeDecimal("£1,500.00"), { value: "1500.00", isMoney: true });

    // Japanese Yen
    assert.deepEqual(normalizeDecimal("¥50,000"), { value: "50000", isMoney: true });

    // Indian Rupee (lakhs grouping)
    assert.deepEqual(normalizeDecimal("₹1,00,000.50"), { value: "100000.50", isMoney: true });

    // Swiss Franc
    assert.deepEqual(normalizeDecimal("CHF 450.00"), { value: "450.00", isMoney: true });
  });

  it("normalizes negative amounts including accounting parenthesis", () => {
    // Leading minus
    assert.deepEqual(normalizeDecimal("-$1,234.56"), { value: "-1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("$-1,234.56"), { value: "-1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("-$ 100.50"), { value: "-100.50", isMoney: true });

    // Accounting parenthesis
    assert.deepEqual(normalizeDecimal("(1,234.56)"), { value: "-1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("($1,234.56)"), { value: "-1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("(€ 1.234,56)"), { value: "-1234.56", isMoney: true });
    assert.deepEqual(normalizeDecimal("(500)"), { value: "-500", isMoney: true });
  });

  it("identifies scientific notation and rejects it from decimal normalization", () => {
    assert.equal(isScientificNotation("1.23e5"), true);
    assert.equal(isScientificNotation("4.56E-3"), true);
    assert.equal(isScientificNotation("-1.0e+10"), true);
    assert.equal(isScientificNotation("1234.56"), false);

    assert.equal(normalizeDecimal("1.23e5"), null);
    assert.equal(normalizeDecimal("4.56E-3"), null);
  });

  it("detects explicit currency strings", () => {
    assert.equal(isCurrencyString("$100"), true);
    assert.equal(isCurrencyString("€ 50"), true);
    assert.equal(isCurrencyString("100 USD"), true);
    assert.equal(isCurrencyString("($100)"), true);
    assert.equal(isCurrencyString("100.00"), false);
    assert.equal(isCurrencyString("Hello World"), false);
  });

  it("rejects invalid, mixed, or corrupt numeric strings", () => {
    assert.equal(normalizeDecimal(""), null);
    assert.equal(normalizeDecimal("abc"), null);
    assert.equal(normalizeDecimal("12.34.56"), null);
    assert.equal(normalizeDecimal("1,23,456.789.00"), null);
    assert.equal(normalizeDecimal("$$100"), null);
  });

  it("pathological inputs complete fast (linear scan, no ReDoS)", () => {
    const bigDigits = "9".repeat(8000);
    const bigCurrency = `$${"1,234,".repeat(1000)}567.89`;
    const t0 = performance.now();
    const r1 = normalizeDecimal(bigDigits);
    const r2 = normalizeDecimal(bigCurrency);
    const r3 = isCanonicalDecimal(bigDigits);
    const r4 = isScientificNotation(`${"9".repeat(4000)}e+${"9".repeat(4000)}`);
    const elapsed = performance.now() - t0;
    assert.equal(r1?.value, bigDigits);
    // currency with many groups is rejected (too long / ambiguous) but must not hang
    assert.ok(r2 === null || typeof r2.value === "string");
    assert.ok(typeof r3 === "boolean");
    assert.ok(typeof r4 === "boolean");
    assert.ok(elapsed < 50, `pathological parse took ${elapsed.toFixed(1)}ms, expected <50ms`);
  });

  it("enforces input length cap before parse", () => {
    const over = "9".repeat(9000);
    assert.equal(normalizeDecimal(over), null);
    assert.equal(isCanonicalDecimal(over), false);
    assert.equal(isScientificNotation(over), false);
    assert.equal(isCurrencyString(over), false);
    // one byte over boundary
    const justOver = "9".repeat(8193);
    assert.equal(normalizeDecimal(justOver), null);
  });

  it("ANTI-CORRUPTION INVARIANT: verifies zero floating-point conversions on decimal value paths in source code", () => {
    const srcDir = fs.existsSync(path.resolve(__dirname, "../../../src/sheets"))
      ? path.resolve(__dirname, "../../../src/sheets")
      : path.resolve(__dirname, "../../src/sheets");
    const targetFiles = ["decimal.ts", "inference.ts", "xlsx.ts", "csv.ts"];

    for (const fileName of targetFiles) {
      const filePath = path.join(srcDir, fileName);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // If line is in decimal value assignment or handling, assert no Number(cell) or parseFloat
        if (line.includes('type: "decimal"') || line.includes("transformedCell = {")) {
          assert(
            !line.includes("parseFloat") && !line.includes("Number("),
            `Violation at ${fileName}:${i + 1}: Floating-point coercion forbidden on decimal paths! Line: ${line}`,
          );
        }
      }
    }
  });
});
