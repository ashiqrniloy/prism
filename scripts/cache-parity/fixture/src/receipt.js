import { money, padRight } from "./format.js";
import { lineTotal, priceOrder } from "./pricing.js";

export function receipt(order) {
  const lines = order.items.map(
    (item) => `${padRight(item.name, 16)} ${item.quantity} x ${money(item.unitCents)} = ${money(lineTotal(item))}`,
  );
  const priced = priceOrder(order);
  lines.push(`subtotal: ${money(priced.subtotal)}`, `tax: ${money(priced.tax)}`, `total: ${money(priced.total)}`);
  return lines.join("\n");
}
