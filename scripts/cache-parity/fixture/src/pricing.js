import { applyDiscount } from "./discount.js";
import { taxCents } from "./tax.js";
import { assertPrice, assertQuantity } from "./validate.js";

export function lineTotal(item) {
  assertQuantity(item.quantity);
  assertPrice(item.unitCents);
  return item.unitCents * item.quantity;
}

export function priceOrder(order) {
  const subtotal = order.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const discounted = applyDiscount(subtotal, order.discount);
  const tax = taxCents(subtotal, order.region);
  return { subtotal, discounted, tax, total: discounted + tax };
}
