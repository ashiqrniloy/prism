import { PricingError } from "./errors.js";

export function assertQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new PricingError(`bad quantity: ${quantity}`);
}

export function assertPrice(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new PricingError(`bad price: ${cents}`);
}
