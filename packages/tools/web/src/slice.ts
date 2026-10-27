/**
 * Context-sized paging for fetched pages: one slice per call, one memo per tool instance.
 *
 * A whole page can be a megabyte, which is more than most context windows, so `web_fetch` returns
 * the slice the caller asked for and a `nextOffset` to continue from. The slice ends on a line or
 * paragraph break when one falls in the last tenth of the window, so a page boundary is a block
 * boundary; it never splits a surrogate pair. Every backend slices with these helpers.
 */
import type { JsonObject } from "@arnilo/prism";
import { WebToolError } from "./transport.js";

export const DEFAULT_FETCH_CHARS = 32_000;
export const HARD_FETCH_CHARS = 100_000;

export interface FetchSlice {
  /** The slice, without the header lines. */
  readonly markdown: string;
  readonly offset: number;
  /** Exclusive end offset in the page. */
  readonly end: number;
  readonly totalChars: number;
  /** More characters remain in the page. */
  readonly truncated: boolean;
  /** The offset to ask for next, or `undefined` when this slice reaches the end. */
  readonly nextOffset?: number;
}

export interface FetchSliceArgs {
  readonly offset: number;
  readonly maxChars: number;
}

/** The `web_fetch` parameters: a URL plus the slice window. Every fetch backend registers this. */
export function fetchParameters(cached = false, prompt = false): JsonObject {
  return {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      max_chars: { type: "integer", minimum: 1, maximum: HARD_FETCH_CHARS, default: DEFAULT_FETCH_CHARS },
      offset: { type: "integer", minimum: 0, default: 0 },
      ...(cached ? { refresh: { type: "boolean", description: "Fetch the page again instead of reusing this session's cached copy" } } : {}),
      ...(prompt ? { prompt: { type: "string", minLength: 1, maxLength: 4_000, description: "A question for the configured model to answer from this page" } } : {}),
    },
    required: ["url"],
    additionalProperties: false,
  };
}

/** `max_chars` and `offset` as the caller gave them, validated. Bad input names the argument. */
export function fetchSliceArgs(args: JsonObject): FetchSliceArgs {
  const offset = args.offset ?? 0;
  if (!Number.isSafeInteger(offset) || (offset as number) < 0)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", "offset must be a non-negative integer");
  const maxChars = args.max_chars ?? DEFAULT_FETCH_CHARS;
  if (!Number.isSafeInteger(maxChars) || (maxChars as number) < 1 || (maxChars as number) > HARD_FETCH_CHARS)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", `max_chars must be an integer between 1 and ${HARD_FETCH_CHARS}`);
  return { offset: offset as number, maxChars: maxChars as number };
}

export function sliceMarkdown(markdown: string, args: FetchSliceArgs): FetchSlice {
  const totalChars = markdown.length;
  if (totalChars > 0 && args.offset >= totalChars)
    throw new WebToolError(
      "ERR_PRISM_WEB_INPUT",
      `offset ${args.offset} is past the end of the document (${totalChars} characters)`,
    );
  let end = Math.min(args.offset + args.maxChars, totalChars);
  if (end < totalChars) {
    // Prefer a paragraph, then a line break, in the last tenth of the window.
    const floor = args.offset + Math.max(1, Math.floor(args.maxChars / 10));
    const paragraph = markdown.lastIndexOf("\n\n", end - 1);
    const line = markdown.lastIndexOf("\n", end - 1);
    if (paragraph >= floor) end = paragraph + 1;
    else if (line >= floor) end = line + 1;
    else if (isHighSurrogate(markdown.charCodeAt(end - 1)) && isLowSurrogate(markdown.charCodeAt(end)))
      // Shrink rather than split; a window too small to shrink grows by one instead of returning half a pair.
      end = end - 1 > args.offset ? end - 1 : end + 1;
  }
  const truncated = end < totalChars;
  return {
    markdown: markdown.slice(args.offset, end),
    offset: args.offset,
    end,
    totalChars,
    truncated,
    ...(truncated ? { nextOffset: end } : {}),
  };
}

/** The model-visible text: which characters these are, how to continue, then the slice. */
export function fetchSliceText(slice: FetchSlice, sourceTruncated = false, cachedAgeMs?: number): string {
  const lines = [`Showing characters ${slice.offset}–${slice.end} of ${slice.totalChars}.`];
  if (cachedAgeMs !== undefined)
    lines.push(`This page was cached ${formatAge(cachedAgeMs)} ago; pass refresh: true to fetch it again.`);
  if (slice.nextOffset !== undefined) lines.push(`Call web_fetch again with offset=${slice.nextOffset} for more.`);
  if (sourceTruncated) lines.push(`The page exceeded the fetch limit and was cut at ${slice.totalChars} characters.`);
  return `${lines.join("\n")}\n\n${slice.markdown}`;
}

/** The result `value`: the document's citation fields plus this slice. */
export function fetchSliceValue<T extends { readonly markdown: string }>(page: T, slice: FetchSlice): Omit<T, "markdown"> & FetchSlice {
  const { markdown: _page, ...rest } = page;
  return { ...rest, ...slice };
}

/**
 * Truncates to at most `maxBytes` UTF-8 bytes without splitting a code point. A document over the
 * fetch limit is kept up to the limit and flagged, not failed: the caller can still read its head.
 */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

/** One compact age for the cache header: `42s`, `3m`, `2h`. */
function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
