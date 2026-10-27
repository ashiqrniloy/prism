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
export declare const MAX_USE_EVENTS = 32;
/** Fail-closed read of the stored use log: a malformed entry makes the whole field unreadable. */
export declare function readUseEvents(value: unknown): readonly MemoryNoteUseEvent[] | undefined;
/** Append one use and drop the oldest beyond {@link MAX_USE_EVENTS}. */
export declare function appendUseEvent(uses: readonly MemoryNoteUseEvent[], event: MemoryNoteUseEvent): readonly MemoryNoteUseEvent[];
