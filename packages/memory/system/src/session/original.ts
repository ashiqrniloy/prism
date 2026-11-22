/**
 * The original content of session entries, as `recall` returns it (plan 218.3 Task 4). STM keeps no copy: a record cites
 * entry ids, and recall reads those entries from the session store (`session.entries()`), redacts them with the
 * session's secrets, and pages them by byte offset, so an entry larger than any model window is readable in pieces.
 */
import type { ContentBlock, SessionEntry } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";

/**
 * An entry's original content: message text verbatim, a tool call's arguments as JSON, a tool result's payload (a
 * string verbatim, anything else as JSON). Not redacted; callers redact the whole text before slicing it.
 */
export function originalEntryText(entry: SessionEntry): string {
  if (!entry.message) {
    const value = entry.summary ?? entry.data ?? entry.event ?? entry.metadata ?? {};
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return entry.message.content.map(blockText).join("\n");
}

function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "thinking":
      return block.redacted ? "[thinking redacted]" : `[thinking] ${block.text}`;
    case "tool_call":
      return `[tool call ${block.name} ${block.id}] ${JSON.stringify(block.arguments)}`;
    case "tool_result": {
      const payload =
        block.result === undefined
          ? block.error
            ? JSON.stringify(block.error)
            : ""
          : typeof block.result === "string"
            ? block.result
            : JSON.stringify(block.result);
      return `[tool result ${block.name} ${block.toolCallId}${block.error ? " error" : ""}] ${payload}`;
    }
    default:
      return `[${block.type}]`;
  }
}

/** The label a page header names: the stored role of a message, else the entry kind. */
function entryLabel(entry: SessionEntry): string {
  return entry.kind === "message" && entry.message?.role ? entry.message.role : entry.kind;
}

/** One slice of an entry's redacted original content. */
export interface OriginalSlice {
  /** The slice, cut on UTF-8 character boundaries. */
  readonly content: string;
  /** Byte offset of the slice's first byte in the redacted original. */
  readonly offset: number;
  readonly bytes: number;
  readonly totalBytes: number;
  /** Where the next slice starts; absent at the end. */
  readonly nextOffset?: number;
}

/**
 * Bytes `[offset, offset + maxBytes)` of the entry's redacted original, moved onto character boundaries: the start
 * forward, the end back. Consecutive slices (each starting at the previous `nextOffset`) concatenate to the whole text.
 */
export function originalSlice(
  entry: SessionEntry,
  offset: number,
  maxBytes: number,
  secrets: readonly (string | undefined)[],
): OriginalSlice {
  const buffer = Buffer.from(redactSecrets(originalEntryText(entry), secrets), "utf8");
  let start = Math.min(offset, buffer.length);
  while (start < buffer.length && isContinuation(buffer[start]!)) start += 1;
  let end = Math.min(buffer.length, start + Math.max(1, maxBytes));
  if (end < buffer.length) while (end > start && isContinuation(buffer[end]!)) end -= 1;
  // A budget smaller than one character still advances by that character.
  if (end === start && start < buffer.length) {
    end = start + 1;
    while (end < buffer.length && isContinuation(buffer[end]!)) end += 1;
  }
  return {
    content: buffer.subarray(start, end).toString("utf8"),
    offset: start,
    bytes: end - start,
    totalBytes: buffer.length,
    ...(end < buffer.length ? { nextOffset: end } : {}),
  };
}

function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/** The header of one entry's page: id, label, time, the byte range, and how to read on. */
export function originalPageHeader(
  entry: SessionEntry,
  slice: Pick<OriginalSlice, "offset" | "bytes" | "totalBytes" | "nextOffset">,
): string {
  const range =
    slice.offset === 0 && slice.nextOffset === undefined
      ? `${slice.totalBytes} bytes`
      : `bytes ${slice.offset}–${slice.offset + slice.bytes} of ${slice.totalBytes}`;
  const more = slice.nextOffset === undefined ? "" : `; continue with recall { entry: "${entry.id}", offset: ${slice.nextOffset} }`;
  return `[${entry.timestamp}] [${entry.id}] ${entryLabel(entry)} (${range}${more}):`;
}

/** Bytes a header may take, reserved before the slice is cut so header plus slice stay within the page. */
export function headerReserve(entry: SessionEntry, totalBytes: number): number {
  return (
    Buffer.byteLength(originalPageHeader(entry, { offset: totalBytes, bytes: totalBytes, totalBytes, nextOffset: totalBytes }), "utf8") + 1
  );
}

/**
 * Entries' original content within `pageBytes` (headers included), oldest first: each entry gets the room left; an entry
 * cut short names the offset to continue from, and entries with no room left are listed by id only.
 */
export function boundedOriginals(entries: readonly SessionEntry[], secrets: readonly (string | undefined)[], pageBytes: number): string {
  const parts: string[] = [];
  let used = 0;
  const omitted: string[] = [];
  for (const entry of entries) {
    if (omitted.length) {
      omitted.push(entry.id);
      continue;
    }
    const total = Buffer.byteLength(redactSecrets(originalEntryText(entry), secrets), "utf8");
    const reserve = headerReserve(entry, total) + 1;
    const room = pageBytes - used - reserve - OMITTED_RESERVE;
    if (room < MIN_SLICE_BYTES && parts.length) {
      omitted.push(entry.id);
      continue;
    }
    const slice = originalSlice(entry, 0, Math.max(MIN_SLICE_BYTES, room), secrets);
    const part = `${originalPageHeader(entry, slice)}\n${slice.content}`;
    parts.push(part);
    used += Buffer.byteLength(part, "utf8") + 1;
  }
  if (omitted.length) parts.push(omittedLine(omitted));
  return parts.join("\n");
}

/** Smallest slice worth sending before listing the rest by id. */
const MIN_SLICE_BYTES = 256;
/** Room kept for the line that lists entries with no room left. */
const OMITTED_RESERVE = 160;

function omittedLine(ids: readonly string[]): string {
  const shown = ids.slice(0, 3).join(", ");
  return `[${ids.length} more source entr${ids.length === 1 ? "y" : "ies"} past this page (${shown}${ids.length > 3 ? ", …" : ""}); read each with recall { entry }]`;
}
