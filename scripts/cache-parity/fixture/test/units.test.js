import { expect, test } from "bun:test";
import { fromCents, toCents } from "../src/units.js";

test("cents round trip", () => {
  expect(toCents(12.34)).toBe(1234);
  expect(fromCents(1234)).toBe(12.34);
});
