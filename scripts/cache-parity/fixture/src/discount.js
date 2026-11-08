import { PricingError } from "./errors.js";

/** A discount is `{ kind: "percent", value }` or `{ kind: "fixed", cents }`. */
export function applyDiscount(subtotalCents, discount) {
  if (discount === undefined) return subtotalCents;
  if (discount.kind === "percent") {
    if (discount.value < 0 || discount.value > 100) throw new PricingError("percent out of range");
    return subtotalCents - Math.floor((subtotalCents * discount.value) / 100);
  }
  if (discount.kind === "fixed") {
    return Math.max(0, subtotalCents - discount.cents);
  }
  throw new PricingError(`unknown discount: ${discount.kind}`);
}
