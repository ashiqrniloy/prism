/** The most bytes of text one tool result or resource read returns. */
export const MAX_RESULT_BYTES = 64 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/** UTF-8 length of `text`. */
export function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/** `text` cut to at most `maxBytes` of UTF-8 on a character boundary, with `truncated` saying whether it was cut. */
export function truncateBytes(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) return { text, truncated: false };
  // A cut inside a multi-byte character decodes to U+FFFD at the end; drop it.
  const cut = decoder.decode(bytes.subarray(0, maxBytes)).replace(/�+$/, "");
  return { text: cut, truncated: true };
}

/** The marker appended to text that was cut. */
export function truncationMarker(omittedBytes: number): string {
  return `\n[truncated: ${omittedBytes} bytes omitted]`;
}

/**
 * Serializes a result for the wire. A result over {@linkcode MAX_RESULT_BYTES} is cut and marked, so the text
 * a client reads always says when it is incomplete. Lookup functions already bound their own lists; this is the
 * last guard.
 */
export function boundedJson(value: unknown, maxBytes: number = MAX_RESULT_BYTES): string {
  const text = JSON.stringify(value, null, 2);
  const total = byteLength(text);
  if (total <= maxBytes) return text;
  const marker = truncationMarker(total - maxBytes);
  const cut = truncateBytes(text, maxBytes - byteLength(marker));
  return `${cut.text}${truncationMarker(total - byteLength(cut.text))}`;
}
