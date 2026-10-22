import type { JsonValue } from "../../contracts.js";
import { DriverError } from "../errors.js";

export type JsonlItem = { readonly kind: "value"; readonly value: JsonValue } | { readonly kind: "invalid"; readonly raw: string };

export interface ReadJsonlOptions {
  /** Longest accepted line in bytes. A longer line fails with `jsonl_line_too_long`. */
  readonly maxLineBytes: number;
  readonly maxLines?: number;
  /** Applied to the raw text of an invalid line before it is reported. */
  readonly redact?: (text: string) => string;
}

const RAW_PREVIEW_CHARS = 256;

/**
 * Parses a byte or string stream as JSONL. Holds at most one line plus the current chunk. A malformed
 * line is reported as `{ kind: "invalid" }` (redacted, truncated) instead of throwing.
 */
export async function* readJsonl(stream: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>, options: ReadJsonlOptions): AsyncGenerator<JsonlItem> {
  const decoder = new TextDecoder();
  let pending = "";
  let pendingBytes = 0;
  let lines = 0;
  const tooLong = (): never => {
    throw new DriverError("jsonl_line_too_long", `a line exceeded ${options.maxLineBytes} bytes`);
  };
  const parse = (line: string): JsonlItem | undefined => {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (text.trim() === "") return undefined;
    try {
      return { kind: "value", value: JSON.parse(text) as JsonValue };
    } catch {
      const safe = options.redact ? options.redact(text) : text;
      return { kind: "invalid", raw: safe.slice(0, RAW_PREVIEW_CHARS) };
    }
  };
  const emit = (line: string): JsonlItem | undefined => {
    const item = parse(line);
    if (item && options.maxLines !== undefined && ++lines > options.maxLines) {
      throw new DriverError("jsonl_line_too_long", `more than ${options.maxLines} lines`);
    }
    return item;
  };
  for await (const chunk of stream) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let start = 0;
    for (;;) {
      const nl = text.indexOf("\n", start);
      if (nl === -1) break;
      const line = pending + text.slice(start, nl);
      if (pendingBytes + Buffer.byteLength(text.slice(start, nl)) > options.maxLineBytes) tooLong();
      pending = "";
      pendingBytes = 0;
      const item = emit(line);
      if (item) yield item;
      start = nl + 1;
    }
    const rest = text.slice(start);
    pendingBytes += Buffer.byteLength(rest);
    if (pendingBytes > options.maxLineBytes) tooLong();
    pending += rest;
  }
  const tail = pending + decoder.decode();
  if (tail.trim() !== "") {
    if (Buffer.byteLength(tail) > options.maxLineBytes) tooLong();
    const item = emit(tail);
    if (item) yield item;
  }
}
