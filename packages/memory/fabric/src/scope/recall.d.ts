/**
 * Union recall across the active memory scopes (plan 188.2 Task 4).
 *
 * Each scope keeps its own `Memory` (and therefore its own tenant/resource/thread isolation), so the
 * union is built by querying every scope, fusing the per-scope rankings with RRF, and adding one
 * bounded prior per scope. Priors are data: the table below is the only place a level influences the
 * ranking. A `path` note earns its prior only when one of its `applies_to` globs matches a file the
 * session touched, so a narrow note never outranks a project note elsewhere.
 *
 * Recall adds the two strength priors (plan 188.4 Task 3) here, after fusion and the scope prior: a
 * well-used note outranks an equally relevant neglected one, and neither prior can override relevance.
 */
import { type MemoryVectorHit, type RecallScoringOptions } from "@arnilo/prism-memory-core";
import type { FabricCandidate } from "../recall.js";
import type { FabricScopeLevel, MemoryFabricExplainEntry, MemoryNoteMetadata, MemoryNoteScope } from "../types.js";
export type ScopePriors = Readonly<Record<MemoryNoteScope, number>>;
/** Defaults from plan 188.2 Task 4. `path` only applies when its glob matches a touched path. */
export declare const DEFAULT_SCOPE_PRIORS: ScopePriors;
export declare const MAX_SCOPE_PRIOR = 0.5;
/** Narrowest first: a lower index wins key shadowing. A private project note beats a shared team note. */
export declare const SCOPE_DEPTH: readonly MemoryNoteScope[];
export declare function resolveScopePriors(input: Partial<Record<MemoryNoteScope, number>> | undefined): ScopePriors;
export declare function scopeOf(candidate: FabricCandidate): MemoryNoteScope;
/**
 * Glob match for `applies_to`: `/` is the separator, `**` crosses directories, `*` and `?` stay
 * inside one segment. Patterns and paths are project-root-relative with no `..` (validated on write).
 */
export declare function globMatches(pattern: string, path: string): boolean;
/** The prior this candidate earns: `path` only on a touched-path glob match, otherwise its level. */
export declare function priorFor(metadata: MemoryNoteMetadata, priors: ScopePriors, touchedPaths: readonly string[]): number;
/** One hit dropped because a narrower scope holds the same `key`. */
export interface ShadowedCandidate {
    readonly candidate: FabricCandidate;
    readonly byId: string;
}
export interface ScopeRecallResult {
    readonly candidates: readonly FabricCandidate[];
    readonly shadowed: readonly ShadowedCandidate[];
}
/** A scope loader: one `Memory` per active storage level. */
export type ScopeCandidateLoader = (query: string, kinds: ReadonlySet<import("../types.js").MemoryNoteKind>, asOfMs: number, limit: number, signal?: AbortSignal, scoring?: RecallScoringOptions, minSimilarity?: number, touchedPaths?: readonly string[], allowArchived?: boolean) => Promise<ScopeRecallResult>;
export interface ScopeRecallScope {
    readonly level: FabricScopeLevel;
    readonly memory: import("@arnilo/prism-memory-core").Memory;
}
export declare function createScopeRecall(deps: {
    readonly scopes: readonly ScopeRecallScope[];
    readonly recallCandidates: (query: string, kinds: ReadonlySet<import("../types.js").MemoryNoteKind>, asOfMs: number, limit: number, signal?: AbortSignal, scoring?: RecallScoringOptions, minSimilarity?: number, source?: import("@arnilo/prism-memory-core").Memory, allowArchived?: boolean) => Promise<FabricCandidate[]>;
    readonly priors: ScopePriors;
    /** `w_R·σ(R) + w_S·σ(S)` for one note; absent keeps the pre-188.4 ranking. */
    readonly strengthPrior?: (metadata: MemoryNoteMetadata) => number;
}): ScopeCandidateLoader;
/**
 * Two-pass budget selection: the best hit of every scope that has one is reserved first, then the
 * rest fill by rank. The best overall hit is always returned, even when it alone exceeds the budget.
 */
export declare function selectWithScopeReserve<T>(ranked: readonly T[], options: {
    readonly budget?: number;
    readonly limit?: number;
    readonly tokens: (item: T) => number;
    readonly level: (item: T) => string;
}): T[];
/** Explain rows for hits that lost to a narrower scope's key; kept for diagnosis, never returned as hits. */
export declare function shadowedExplain(shadowed: readonly ShadowedCandidate[], priors: ScopePriors, touchedPaths: readonly string[]): MemoryFabricExplainEntry[];
/** The hit's mode similarity before the scope prior, used by the floor and by explain. */
export declare function baseScore(hit: MemoryVectorHit): number;
