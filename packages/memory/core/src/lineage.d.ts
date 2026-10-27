import type { MemoryInvalidationEvent, MemoryInvalidationReason, MemoryInvalidationRecord, MemoryLineage, MemoryRecallExplanation, MemoryScope, MemoryShareGrant, MemoryVectorRecord, VectorStore } from "./types.js";
export declare const LINEAGE_META_KEY = "_lineage";
export declare const LINEAGE_SCHEMA_VERSION: 1;
/** Transitive derived-record walk. */
export declare const HARD_LINEAGE_DEPTH = 8;
/** Distinct ids marked in one walk. */
export declare const HARD_LINEAGE_EDGES = 256;
/** `sourceIds` on one record / share grant. */
export declare const HARD_LINEAGE_SOURCE_IDS = 32;
export declare const HARD_SHARE_SOURCE_IDS = 32;
/** One `invalidate` / delete slice. */
export declare const HARD_INVALIDATION_BATCH = 64;
/** Normalize host/write lineage. Schema v1 only. */
export declare function assertLineage(value: unknown): MemoryLineage;
type ParsedLineage = MemoryLineage | undefined | "invalid";
export declare function parseLineage(metadata: MemoryVectorRecord["metadata"]): ParsedLineage;
export declare function stampLineage(metadata: MemoryVectorRecord["metadata"] | undefined, lineage: unknown | undefined): MemoryVectorRecord["metadata"] | undefined;
export declare function assertInvalidationRecord(value: unknown): MemoryInvalidationRecord;
export declare function assertInvalidationBatch(entries: readonly MemoryInvalidationRecord[]): readonly MemoryInvalidationRecord[];
export declare function indexInvalidations(entries: readonly MemoryInvalidationRecord[]): ReadonlyMap<string, MemoryInvalidationRecord>;
/**
 * Plan 089 Task 3: the ids one exact scope currently withholds — everything but
 * `corrected`, which keeps its source. Feed this to observational-memory
 * `invalidatedIds` / recall so derived blocks whose source was revoked mid-turn stop
 * being injected on the next build. Stores without lineage invalidation return empty.
 */
export declare function listInvalidatedIds(vectorStore: VectorStore, scope: MemoryScope, options?: {
    readonly signal?: AbortSignal;
}): Promise<readonly string[]>;
/** Query-time exclude. Corrected sources stay; anything listing them in `_lineage.sourceIds` does not. Corrupt lineage denies. */
export declare function recordBlocked(record: Pick<MemoryVectorRecord, "id" | "metadata">, invalidations: ReadonlyMap<string, MemoryInvalidationRecord>): boolean;
/**
 * Roots plus same-thread records that list a marked id in `_lineage.sourceIds`.
 * Caps fail closed (throw) rather than leave unmarked descendants injectable.
 * `maxEdges` defaults to the interactive cap; privileged callers (deletion
 * propagation) may raise it explicitly and stay bounded.
 */
export declare function collectInvalidationIds(records: readonly MemoryVectorRecord[], roots: readonly string[], options?: {
    readonly maxEdges?: number;
}): readonly string[];
export declare function assertShareGrant(grant: MemoryShareGrant): MemoryShareGrant;
export declare function shareGrantAllows(grant: MemoryShareGrant, request: {
    readonly tenantId: string;
    readonly childThreadId: string;
    readonly now?: number;
}): boolean;
export declare function explainRecord(record: Pick<MemoryVectorRecord, "id" | "tenantId" | "resourceId" | "threadId" | "createdAt" | "metadata">, invalidation?: MemoryInvalidationRecord): MemoryRecallExplanation;
/** 072 invariant body: wrap with `defineScorer({ invariant: true, score: ... })`. Score 0 is not mean-able. */
export declare function revokedIdsAbsent(environment: {
    readonly injectedIds?: readonly string[];
} | undefined, deniedIds: readonly string[]): {
    readonly score: number;
};
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export declare function invalidateAcrossLayers(input: {
    readonly scope: Required<MemoryScope>;
    readonly entries: readonly MemoryInvalidationRecord[];
    readonly vectorStore: VectorStore;
    readonly signal?: AbortSignal;
    readonly observational?: {
        readonly drop: (ids: readonly string[]) => void | Promise<void>;
    };
    readonly rag?: {
        readonly deleteSource: (sourceId: string, options?: {
            readonly signal?: AbortSignal;
        }) => Promise<unknown>;
    };
}): Promise<void>;
export declare function toInvalidationEvent(reason: MemoryInvalidationReason, ids: readonly string[], hold: boolean): MemoryInvalidationEvent;
export {};
