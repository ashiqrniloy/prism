import { type Memory } from "@arnilo/prism-memory-core";
import { type MemoryLimits } from "@arnilo/prism-memory-core";
import type { MemoryVectorHit, MemoryVectorRecord, RecallScoringOptions } from "@arnilo/prism-memory-core";
import { type ScopeCandidateLoader } from "./scope/recall.js";
import { type MemoryFabric, type MemoryNoteKind, type MemoryNoteMetadata } from "./types.js";
/** A recalled row plus its parsed fabric metadata (kind and validity already checked). */
export interface FabricCandidate {
    readonly hit: MemoryVectorHit;
    readonly metadata: MemoryNoteMetadata;
}
/** Bounded candidate loader shared by recall and the write path — one store query per call. */
export type FabricCandidateLoader = (query: string, kinds: ReadonlySet<MemoryNoteKind>, asOfMs: number, limit: number, signal?: AbortSignal, scoring?: RecallScoringOptions, minSimilarity?: number) => Promise<FabricCandidate[]>;
/**
 * Window one recall may inspect: the `topK` hits plus the oversampled rows a linked neighbor can
 * be promoted from. `topK` at the hard cap leaves no room to expand, which is what asking for
 * every recallable note already means.
 */
export declare function resolveCandidateLimit(topK: number): number;
/**
 * One spelling for "every note kind" in every recall surface: `kinds: ["all"]` means
 * {@link MEMORY_NOTE_KINDS}, so recalling an episode or a procedure does not need the list.
 */
export declare function parseRecallKinds(value: unknown): readonly MemoryNoteKind[] | undefined;
export declare function createFabricRecall(deps: {
    readonly loadCandidates: ScopeCandidateLoader;
    readonly limits: MemoryLimits;
    readonly memory: Memory;
    readonly getNotes?: (ids: readonly string[], signal?: AbortSignal) => Promise<readonly MemoryVectorRecord[]>;
    /** Additive priors applied by the scope loader; used here only for shadowed explain rows. */
    readonly priors?: import("./scope/recall.js").ScopePriors;
}): MemoryFabric["recall"];
