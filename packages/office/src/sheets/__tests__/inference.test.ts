import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferAndTransformRows, parseCsv, resolveSheetsCaps } from "../index.js";

describe("@arnilo/prism-office/sheets — Schema Inference Engine", () => {
  it("infers decimal type and exact decimal strings for currency-formatted columns", async () => {
    const csv = `product,price,paid\nLaptop,"$1,234.56",true\nMouse,"$25.99",true\nKeyboard,"$120.00",false\n`;
    const result = await parseCsv(csv);

    assert.equal(result.schema.length, 3);
    assert.equal(result.schema[0].name, "product");
    assert.equal(result.schema[0].type, "string");

    assert.equal(result.schema[1].name, "price");
    assert.equal(result.schema[1].type, "decimal");
    assert.equal(result.schema[1].sample, "$1,234.56");

    assert.equal(result.schema[2].name, "paid");
    assert.equal(result.schema[2].type, "boolean");

    // Check row values: price values must be decimal objects with string representation
    assert.deepEqual(result.rows[1][1], { type: "decimal", value: "1234.56" });
    assert.deepEqual(result.rows[2][1], { type: "decimal", value: "25.99" });
    assert.deepEqual(result.rows[3][1], { type: "decimal", value: "120.00" });
  });

  it("infers decimal type via column name heuristics for numeric columns", async () => {
    const csv = `id,item_total,fee_amount,user_rating\n1,500,25.50,5\n2,1200,60.00,4\n3,850,42.50,5\n`;
    const result = await parseCsv(csv);

    // item_total and fee_amount match money heuristics -> decimal
    assert.equal(result.schema[1].name, "item_total");
    assert.equal(result.schema[1].type, "decimal");
    assert.deepEqual(result.rows[1][1], { type: "decimal", value: "500" });

    assert.equal(result.schema[2].name, "fee_amount");
    assert.equal(result.schema[2].type, "decimal");
    assert.deepEqual(result.rows[1][2], { type: "decimal", value: "25.50" });

    // user_rating is integer
    assert.equal(result.schema[3].name, "user_rating");
    assert.equal(result.schema[3].type, "integer");
    assert.equal(result.rows[1][3], 5);
  });

  it("falls back to string with numeric-ambiguous flag on scientific notation", async () => {
    const csv = `exp_id,measurement\n1,1.23e5\n2,4.56E-3\n3,7.89e+2\n`;
    const result = await parseCsv(csv);

    assert.equal(result.schema[1].name, "measurement");
    assert.equal(result.schema[1].type, "string");
    assert.deepEqual(result.schema[1].flags, ["numeric-ambiguous"]);

    // Value preserved as string
    assert.equal(result.rows[1][1], "1.23e5");
  });

  it("infers date, datetime, integer, and boolean columns accurately", async () => {
    const csv = `created_date,timestamp,is_admin,login_count\n2026-08-31,2026-08-31T12:00:00Z,true,10\n2026-09-01,2026-09-01T15:30:00Z,false,0\n`;
    const result = await parseCsv(csv);

    assert.equal(result.schema[0].type, "date");
    assert.equal(result.schema[1].type, "datetime");
    assert.equal(result.schema[2].type, "boolean");
    assert.equal(result.schema[3].type, "integer");

    assert.deepEqual(result.rows[1][0], { type: "date", value: "2026-08-31" });
    assert.deepEqual(result.rows[1][1], { type: "datetime", value: "2026-08-31T12:00:00Z" });
    assert.equal(result.rows[1][2], true);
    assert.equal(result.rows[1][3], 10);
  });

  it("samples window rows and reports validation mismatches on subsequent rows", () => {
    const caps = resolveSheetsCaps({ inferenceWindowRows: 5 });

    // First 5 data rows are integers, rows 6-8 have invalid strings for integer column
    const header = ["id", "score"];
    const rows = [header, [1, 100], [2, 200], [3, 300], [4, 400], [5, 500], [6, "NOT_A_SCORE_1"], [7, "NOT_A_SCORE_2"], [8, 800]];

    const result = inferAndTransformRows(rows, caps);

    assert.equal(result.schema[1].type, "integer");
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].kind, "type-mismatch");
    assert.equal(result.warnings[0].column, "score");
    assert.equal(result.warnings[0].mismatchCount, 2);
    assert.deepEqual(result.warnings[0].samples, ["NOT_A_SCORE_1", "NOT_A_SCORE_2"]);
  });

  it("computes nullRate accurately across sampled rows", () => {
    const caps = resolveSheetsCaps();
    const rows = [
      ["name", "optional_field"],
      ["Alice", "A"],
      ["Bob", null],
      ["Charlie", ""],
      ["David", "D"],
    ];

    const result = inferAndTransformRows(rows, caps);
    assert.equal(result.schema[0].nullRate, 0);
    // 2 out of 4 rows are null/empty -> 0.5
    assert.equal(result.schema[1].nullRate, 0.5);
  });
});
