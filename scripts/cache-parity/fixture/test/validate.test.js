import { expect, test } from "bun:test";
import { assertPrice, assertQuantity } from "../src/validate.js";

test("rejects bad input", () => {
  expect(() => assertQuantity(0)).toThrow();
  expect(() => assertPrice(-1)).toThrow();
  expect(() => assertQuantity(2)).not.toThrow();
});
