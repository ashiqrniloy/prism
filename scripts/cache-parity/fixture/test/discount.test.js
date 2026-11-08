import { expect, test } from "bun:test";
import { applyDiscount } from "../src/discount.js";

test("percent and fixed discounts", () => {
  expect(applyDiscount(1000, { kind: "percent", value: 10 })).toBe(900);
  expect(applyDiscount(1000, { kind: "fixed", cents: 250 })).toBe(750);
  expect(applyDiscount(100, { kind: "fixed", cents: 250 })).toBe(0);
  expect(applyDiscount(1000, undefined)).toBe(1000);
});
