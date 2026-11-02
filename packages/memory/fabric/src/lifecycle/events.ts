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

/**
 * One co-read (plan 207 Task 4): the note was cited in an answering turn together with `with`, the other notes that
 * turn cited. `s` is the scope-session ordinal, `t` the session's turn index. Ids and indexes only, never text.
 */
export interface MemoryNoteCoReadEvent {
  readonly s: number;
  readonly t: number;
  readonly with: readonly string[];
}

/** The last co-reads a note keeps, and the other notes one event names. */
export const MAX_CO_READ_EVENTS = 16;
export const MAX_CO_READ_WITH = 8;

const NOTE_ID_PATTERN = /^[0-9a-f]{12}$/;

/** Fail-closed read of the stored co-read log: a malformed entry makes the whole field unreadable. */
export function readCoReadEvents(value: unknown): readonly MemoryNoteCoReadEvent[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CO_READ_EVENTS) return undefined;
  const events: MemoryNoteCoReadEvent[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
    const record = item as Record<string, unknown>;
    if (typeof record.s !== "number" || !Number.isSafeInteger(record.s) || record.s < 0) return undefined;
    if (typeof record.t !== "number" || !Number.isSafeInteger(record.t) || record.t < 0) return undefined;
    const others = record.with;
    if (!Array.isArray(others) || others.length === 0 || others.length > MAX_CO_READ_WITH) return undefined;
    if (!others.every((id) => typeof id === "string" && NOTE_ID_PATTERN.test(id))) return undefined;
    events.push({ s: record.s, t: record.t, with: others as readonly string[] });
  }
  return events;
}

/** Append one co-read and drop the oldest beyond {@link MAX_CO_READ_EVENTS}. */
export function appendCoReadEvent(
  events: readonly MemoryNoteCoReadEvent[],
  event: MemoryNoteCoReadEvent,
): readonly MemoryNoteCoReadEvent[] {
  return [...events, event].slice(-MAX_CO_READ_EVENTS);
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
export function appendUseEvent(uses: readonly MemoryNoteUseEvent[], event: MemoryNoteUseEvent): readonly MemoryNoteUseEvent[] {
  return [...uses, event].slice(-MAX_USE_EVENTS);
}
