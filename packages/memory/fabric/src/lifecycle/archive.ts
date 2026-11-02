/**
 * The archive rule (plan 188.4 Task 4): a note leaves the active index only when both strengths say
 * it is worthless — rarely retrieved *and* never shown to matter — and only after a grace window of
 * scope sessions since it was written. Archive is a rest state, not a tombstone: `validTo` stays
 * unset (supersession and expiry own that field), the note stays searchable, and a later citation
 * revives it.
 */
import type { MemoryNoteMetadata } from "../types.js";
import {
  DEFAULT_DECAY,
  DEFAULT_STORAGE_WEIGHTS,
  type MemoryNoteDecay,
  retrievalStrength,
  storageStrength,
  type StorageWeights,
} from "./strength.js";

export interface ArchiveConfig {
  /** Archive only below this retrieval strength. Default −2.0. */
  readonly retrievalBelow: number;
  /** Archive only below this storage strength. Default 1.0. */
  readonly storageBelow: number;
  /** Sessions a note lives before it can be archived at all. Default 10. */
  readonly graceSessions: number;
}

/** Provisional thresholds (plan 188.6 fits them): both must be low, so an important note stays. */
export const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig = Object.freeze({
  retrievalBelow: -2,
  storageBelow: 1,
  graceSessions: 10,
});

export const MAX_ARCHIVE_BELOW = 1_000;
export const MAX_GRACE_SESSIONS = 10_000;

/** Without `includeArchived`, archived notes are searched only when the best active hit is weaker. */
export const ARCHIVE_SEARCH_COVERAGE = 0.34;
/** At most this many archived hits are appended to a weak active result. */
export const MAX_ARCHIVED_HITS = 3;

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
export function shouldArchive(
  metadata: Pick<MemoryNoteMetadata, "kind" | "uses" | "useSessions" | "helpful" | "harmful" | "promotion" | "pinned" | "created">,
  clock: number,
  options: ArchiveDecisionOptions = {},
): boolean {
  if (metadata.pinned === true) return false;
  // The ontology curator alone changes or retires a concept (plan 207 Task 2).
  if (metadata.kind === "concept") return false;
  const archive = options.archive ?? DEFAULT_ARCHIVE_CONFIG;
  const decay = options.decay ?? DEFAULT_DECAY;
  const d = decay[metadata.kind] ?? DEFAULT_DECAY.fact;
  if (retrievalStrength(metadata, clock, d) >= archive.retrievalBelow) return false;
  if (storageStrength(metadata, options.storageWeights ?? DEFAULT_STORAGE_WEIGHTS) >= archive.storageBelow) return false;
  const created = Number.isSafeInteger(metadata.created) && (metadata.created as number) > 0 ? (metadata.created as number) : 0;
  return clock - created >= archive.graceSessions;
}
