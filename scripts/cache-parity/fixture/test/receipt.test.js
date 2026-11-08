import { expect, test } from "bun:test";
import { receipt } from "../src/receipt.js";

test("receipt lists lines and totals", () => {
  const text = receipt({ items: [{ name: "pen", quantity: 2, unitCents: 150 }], region: "none" });
  expect(text).toContain("pen");
  expect(text).toContain("total: $3.00");
});
