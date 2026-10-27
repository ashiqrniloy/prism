/**
 * The archive rule (plan 188.4 Task 4): a note leaves the active index only when both strengths say
 * it is worthless — rarely retrieved *and* never shown to matter — and only after a grace window of
 * scope sessions since it was written. Archive is a rest state, not a tombstone: `validTo` stays
 * unset (supersession and expiry own that field), the note stays searchable, and a later citation
 * revives it.
 */
import type { MemoryNoteMetadata } from "../types.js";
import { type MemoryNoteDecay, type StorageWeights } from "./strength.js";
export interface ArchiveConfig {
    /** Archive only below this retrieval strength. Default −2.0. */
    readonly retrievalBelow: number;
    /** Archive only below this storage strength. Default 1.0. */
    readonly storageBelow: number;
    /** Sessions a note lives before it can be archived at all. Default 10. */
    readonly graceSessions: number;
}
/** Provisional thresholds (plan 188.6 fits them): both must be low, so an important note stays. */
export declare const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig;
export declare const MAX_ARCHIVE_BELOW = 1000;
export declare const MAX_GRACE_SESSIONS = 10000;
/** Without `includeArchived`, archived notes are searched only when the best active hit is weaker. */
export declare const ARCHIVE_SEARCH_COVERAGE = 0.34;
/** At most this many archived hits are appended to a weak active result. */
export declare const MAX_ARCHIVED_HITS = 3;
export interface ArchiveDecisionOptions {
    readonly archive?: ArchiveConfig;
    readonly decay?: MemoryNoteDecay;
    readonly storageWeights?: StorageWeights;
}
/**
 * The one archive predicate. A pinned note never archives, and a note under legal hold never reaches
 * this predicate: the store's scan excludes blocked rows.
 *
 * The creation ordinal is the session the note was written in; a note from before the scope clock
 * carries none and counts as ordinal 0, which grants it the grace window immediately.
 */
export declare function shouldArchive(metadata: Pick<MemoryNoteMetadata, "kind" | "uses" | "useSessions" | "helpful" | "harmful" | "promotion" | "pinned" | "created">, clock: number, options?: ArchiveDecisionOptions): boolean;
