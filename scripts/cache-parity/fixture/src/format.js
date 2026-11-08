import { fromCents } from "./units.js";

export function money(cents) {
  return `$${fromCents(cents).toFixed(2)}`;
}

export function padRight(text, width) {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
