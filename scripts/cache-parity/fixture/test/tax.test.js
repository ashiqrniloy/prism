import { expect, test } from "bun:test";
import { taxCents, taxRate } from "../src/tax.js";

test("known and unknown regions", () => {
  expect(taxRate("us")).toBe(0.07);
  expect(taxRate("mars")).toBe(0);
  expect(taxCents(1000, "eu")).toBe(200);
});
