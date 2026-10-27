import { type Memory, type MemoryVectorRecord } from "@arnilo/prism-memory-core";
import type { FabricNoteCensus } from "../promote.js";
import { type MemoryNoteMetadata } from "../types.js";
export type { ActiveNoteOptions, MemoryNoteStatus } from "./status.js";
export { isActiveNote, isMemoryNoteStatus, normalizeNoteStatus } from "./status.js";
export type { ArchiveConfig, ArchiveDecisionOptions } from "./archive.js";
export { ARCHIVE_SEARCH_COVERAGE, DEFAULT_ARCHIVE_CONFIG, MAX_ARCHIVED_HITS, MAX_ARCHIVE_BELOW, MAX_GRACE_SESSIONS, shouldArchive, } from "./archive.js";
export { appendUseEvent, MAX_USE_EVENTS, type MemoryNoteUseEvent, readUseEvents } from "./events.js";
export type { InspectNoteInput, LifecycleDecisionView, LifecycleNoteView } from "./inspect.js";
export { describeNote, inspectNote } from "./inspect.js";
export type { CapacityLimits, CapacityNote, CapacityUsage } from "./capacity.js";
export { capacityForLevel, capacityUsage, DEFAULT_CAPACITY, evictionOrder, MAX_FABRIC_CAPACITY_NOTES, MAX_FABRIC_CAPACITY_TOKENS, overCapacity, } from "./capacity.js";
export type { DuplicateGroup, EpisodeCluster, EpisodeSummary } from "./merge.js";
export { DEFAULT_DUPLICATE_DICE, DEFAULT_EPISODE_MIN_CLUSTER, duplicateGroups, EPISODE_MERGE_SYSTEM, EPISODE_MERGE_TOOL, episodeClusters, MAX_DUPLICATE_DICE, MAX_EPISODE_CLUSTER, MAX_EPISODE_SUMMARY_CHARS, mergedMetadata, MIN_DUPLICATE_DICE, summarizeEpisodeCluster, } from "./merge.js";
export type { SiblingGroup, WidenConfig, WidenGroup, WidenNote } from "./widen.js";
export { crossProjectGroups, DEFAULT_WIDEN_CONFIG, MAX_WIDEN_CONTRADICTIONS, MAX_WIDEN_PROJECTS, MAX_WIDEN_SIBLINGS, MIN_WIDEN_CONTRADICTIONS, MIN_WIDEN_PROJECTS, MIN_WIDEN_SIBLINGS, narrowingCandidates, siblingGroups, } from "./widen.js";
export { DEFAULT_DECAY, DEFAULT_STORAGE_WEIGHTS, DEFAULT_STRENGTH_WEIGHTS, logistic, MAX_STORAGE_WEIGHT, MAX_STRENGTH_WEIGHT, noteImportance, retrievalStrength, type StrengthPriorOptions, type StrengthWeights, storageStrength, type StorageWeights, strengthPrior, type MemoryNoteDecay, } from "./strength.js";
export { createScopeClock, readScopeClockState, SCOPE_CLOCK_COUNTER, type ScopeClock, type ScopeClockSessionState, type ScopeClockTick, } from "./clock.js";
/** Distinct sessions a candidate must be used in before it is verified. */
export declare const DEFAULT_VERIFY_AFTER_SESSIONS = 2;
/** The hard cap keeps a misconfigured threshold from making a candidate unverifiable. */
export declare const HARD_VERIFY_AFTER_SESSIONS = 100;
/** What one use-recording call needs; the scope clock arrives with plan 188.4 Task 2. */
export interface ArchiveNoteOptions {
    readonly now?: number;
    /** The survivor's id when a capacity merge archived this note. */
    readonly mergedInto?: string;
    /** The wider-scope note this one was widened into (plan 188.4 Task 6). */
    readonly widenedTo?: string;
    /** Audit-log verb; merges and evictions name themselves. */
    readonly auditVerb?: string;
    readonly signal?: AbortSignal;
}
export interface RecordUsesOptions {
    /** Scope-session ordinal written into the use log. */
    readonly clock?: number;
    readonly verifyAfterSessions?: number;
    readonly now?: number;
    readonly signal?: AbortSignal;
}
/** Evidence a finished turn carries: outcome tags and the notes a user correction cited. */
export interface LifecycleEvidence {
    readonly helpful?: readonly string[];
    readonly harmful?: readonly string[];
}
export interface FabricLifecycle {
    /** Confirm a candidate. False when the note is missing, blocked, or not a candidate. */
    verify(id: string, options?: {
        readonly signal?: AbortSignal;
    }): Promise<boolean>;
    /**
     * Record at most one use per session per note, and verify a candidate that reaches
     * `verifyAfterSessions` distinct sessions with no harmful evidence. Returns the ids it verified.
     */
    recordUses(sessionKey: string, ids: readonly string[], options?: RecordUsesOptions): Promise<readonly string[]>;
    /** Add the diagnostic retrieval counts; never touches status or either strength. */
    recordRetrievals(counts: Readonly<Record<string, number>>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<void>;
    /** Count helpful evidence, and harmful evidence that reopens a verified note for reconsolidation. */
    recordEvidence(evidence: LifecycleEvidence, options?: {
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly helpful: number;
        readonly harmful: number;
    }>;
    /**
     * Archive one note: status `archived`, `archivedAt`, and the status to revive to. Never sets
     * `validTo`. `mergedInto` records the survivor when a capacity merge archived it.
     */
    archive(id: string, options?: ArchiveNoteOptions): Promise<boolean>;
    /**
     * Supersede one note: `validTo` set, status `retired`, logged. Narrowing does this when enough
     * projects contradict a wider note; archive never sets `validTo`.
     */
    supersede(id: string, options?: {
        readonly now?: number;
        readonly signal?: AbortSignal;
    }): Promise<boolean>;
    /** Replace the note's lifecycle metadata with `next` (the survivor of a capacity merge). */
    mergeMetadata(id: string, next: MemoryNoteMetadata, options?: {
        readonly signal?: AbortSignal;
    }): Promise<boolean>;
    /** Pin or unpin a note: a pinned note is never archived or evicted. */
    pin(id: string, pinned?: boolean, options?: {
        readonly signal?: AbortSignal;
    }): Promise<boolean>;
    census(signal?: AbortSignal): Promise<FabricNoteCensus>;
    retireNote(id: string, validTo: string, options?: {
        readonly signal?: AbortSignal;
    }): Promise<boolean>;
    handleSupersededReflections(supersededReflectionIds: ReadonlySet<string>, options?: {
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly supersededNotes: Map<string, MemoryVectorRecord>;
        readonly reconsolidated: string[];
    }>;
    reconsolidating(options?: {
        readonly signal?: AbortSignal;
    }): Promise<readonly MemoryVectorRecord[]>;
}
/** Metadata-only lifecycle changes: they never re-embed, so verification and archiving cost no model call. */
export declare function createFabricLifecycle(memory: Memory): FabricLifecycle;
