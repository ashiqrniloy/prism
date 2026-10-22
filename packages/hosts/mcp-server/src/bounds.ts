import { McpBridgeError } from "@arnilo/prism-mcp";

/** Resolves a bounded positive integer option, or throws naming the rule. Shared by `serve`, `server`, and `serve-tools`. */
export function bounded(value: number | undefined, fallback: number, cap: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > cap)
    throw new McpBridgeError(`${name} must be a positive safe integer <= ${cap}`);
  return resolved;
}

/** Truncates to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low);
}
