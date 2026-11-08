import { expect, test } from "bun:test";
import { lineTotal, priceOrder } from "../src/pricing.js";

test("line total multiplies", () => {
  expect(lineTotal({ quantity: 3, unitCents: 200 })).toBe(600);
});

test("tax is charged on the discounted amount", () => {
  const priced = priceOrder({
    items: [{ name: "book", quantity: 2, unitCents: 5000 }],
    discount: { kind: "percent", value: 10 },
    region: "eu",
  });
  expect(priced.subtotal).toBe(10000);
  expect(priced.discounted).toBe(9000);
  expect(priced.tax).toBe(1800);
  expect(priced.total).toBe(10800);
});
