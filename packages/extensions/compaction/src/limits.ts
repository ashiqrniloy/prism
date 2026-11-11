export const DEFAULT_MAX_SUMMARY_TOKENS = 16_384;
export const HARD_MAX_SUMMARY_TOKENS = 131_072;
export const DEFAULT_RESERVE_TOKENS = 16_384;
export const HARD_RESERVE_TOKENS = 131_072;
export const DEFAULT_MAX_SUMMARY_ERROR_BYTES = 1024;
export const HARD_MAX_SUMMARY_ERROR_BYTES = 8 * 1024;

export function validateCompactionLimit(name: string, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
    throw new RangeError(`${name} must be a positive safe integer at most ${hardCap}`);
  }
  return value;
}

export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!)) low -= 1;
  return text.slice(0, low);
}
