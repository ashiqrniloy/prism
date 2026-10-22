/** Marks a line that exceeded `maxBytes`. The line is discarded, never buffered. */
export interface OversizeFrame {
  readonly oversize: true;
}

export const OVERSIZE: OversizeFrame = Object.freeze({ oversize: true });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Splits a byte or string stream into newline-delimited frames. A line over `maxBytes`
 * is dropped while reading and surfaced as `OVERSIZE`; memory never exceeds `maxBytes`
 * plus one chunk. Blank lines are skipped.
 */
export async function* readJsonlFrames(
  source: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
): AsyncGenerator<string | OversizeFrame> {
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let discarding = false;
  const reset = () => {
    pending = [];
    pendingBytes = 0;
    discarding = false;
  };
  const line = (): string | undefined => {
    if (pendingBytes === 0) return undefined;
    const joined = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pending) {
      joined.set(part, offset);
      offset += part.length;
    }
    const text = decoder.decode(joined).replace(/\r$/, "");
    return text.length > 0 ? text : undefined;
  };
  for await (const chunk of source) {
    let bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    while (bytes.length > 0) {
      const newline = bytes.indexOf(10);
      const part = newline < 0 ? bytes : bytes.subarray(0, newline);
      if (!discarding) {
        pendingBytes += part.length;
        if (pendingBytes > maxBytes) {
          discarding = true;
          pending = [];
          pendingBytes = 0;
        } else {
          pending.push(part);
        }
      }
      if (newline < 0) break;
      if (discarding) yield OVERSIZE;
      else {
        const text = line();
        if (text !== undefined) yield text;
      }
      reset();
      bytes = bytes.subarray(newline + 1);
    }
  }
  if (discarding) yield OVERSIZE;
  else {
    const text = line();
    if (text !== undefined) yield text;
  }
}
