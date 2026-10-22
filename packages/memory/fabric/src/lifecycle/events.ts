/**
 * The note use log (plan 188.4 Task 1): who used a note, when, and in which scope session.
 *
 * A use is a citation of a note id the session was shown. Retrieval alone is not a use, so recall
 * and injection only move `retrievals`, which is a diagnostic count and never affects status,
 * storage strength, or retrieval strength.
 */

/** One use: the scope-session ordinal it happened in (Task 2 owns the clock) and the wall time. */
export interface MemoryNoteUseEvent {
  readonly s: number;
  readonly at: string;
}

/** The log keeps the last 32 uses plus the counters; frontmatter never holds an unbounded array. */
export const MAX_USE_EVENTS = 32;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

/** Fail-closed read of the stored use log: a malformed entry makes the whole field unreadable. */
export function readUseEvents(value: unknown): readonly MemoryNoteUseEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const events: MemoryNoteUseEvent[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    if (typeof record.s !== "number" || !Number.isSafeInteger(record.s) || record.s < 0) return undefined;
    if (!isIsoTimestamp(record.at)) return undefined;
    events.push({ s: record.s, at: record.at });
  }
  return events;
}

/** Append one use and drop the oldest beyond {@link MAX_USE_EVENTS}. */
export function appendUseEvent(
  uses: readonly MemoryNoteUseEvent[],
  event: MemoryNoteUseEvent,
): readonly MemoryNoteUseEvent[] {
  return [...uses, event].slice(-MAX_USE_EVENTS);
}
