/**
 * Plan 228 Task 3: the one merge rule for adjacent streamed content. Message assembly
 * (`pushCoalescedContent`) and a lagging subscriber's queue (`EventSubscriber`) both use it.
 */
import type { AgentEvent, ContentBlock, EventOrigin } from "../contracts.js";

/** A subscriber never merges a delta past this many UTF-16 code units (at most 48 KiB of UTF-8), so
 *  host mappers that truncate one delta at 64 KiB (AG-UI, ACP) never cut merged text. */
export const MAX_COALESCED_DELTA_CHARS = 16 * 1024;

/**
 * Merge `next` onto `last` when both are text, or both are thinking with neither side `redacted` and
 * neither carrying a `data` payload. Returns `undefined` when they do not merge, or when the merged text
 * would exceed `maxChars`. Pure: neither input is mutated.
 */
export function mergeContentBlocks(last: ContentBlock | undefined, next: ContentBlock, maxChars = Infinity): ContentBlock | undefined {
  if (!last) return undefined;
  if (last.type === "text" && next.type === "text") {
    if (last.text.length + next.text.length > maxChars) return undefined;
    return { type: "text", text: last.text + next.text };
  }
  if (
    last.type === "thinking" &&
    next.type === "thinking" &&
    !last.redacted &&
    !next.redacted &&
    last.data === undefined &&
    next.data === undefined
  ) {
    if (last.text.length + next.text.length > maxChars) return undefined;
    const signature = next.signature ?? last.signature;
    return { type: "thinking", text: last.text + next.text, ...(signature ? { signature } : {}) };
  }
  return undefined;
}

function sameOrigin(a: EventOrigin | undefined, b: EventOrigin | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a) as (keyof EventOrigin)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * Merge two queued `message.delta` events of the same session, run, and origin into one, under the
 * subscriber cap. Returns `undefined` when they do not merge. Events arrive already redacted, so a merged
 * text is exactly what a consumer concatenating both deltas would see.
 */
export function mergeDeltaEvents(last: AgentEvent, next: AgentEvent, maxChars = MAX_COALESCED_DELTA_CHARS): AgentEvent | undefined {
  if (last.type !== "message.delta" || next.type !== "message.delta") return undefined;
  if (last.sessionId !== next.sessionId || last.runId !== next.runId || !sameOrigin(last.origin, next.origin)) return undefined;
  const content = mergeContentBlocks(last.content, next.content, maxChars);
  return content ? { ...last, content } : undefined;
}
