import type { JsonObject, SecretRedactor } from "@arnilo/prism";
import type { MemoryEntryInput, MemoryVectorHit, RecallScoringOptions } from "./types.js";
export declare const RECALL_OVERSAMPLE = 4;
/** Midpoint importance applied to records without a stored value. */
export declare const NEUTRAL_IMPORTANCE = 0.5;
/** Weight vector after resolver validation and sum-normalization. */
export interface ResolvedRecallScoring {
    readonly similarity: number;
    readonly recency: number;
    readonly importance: number;
    readonly halfLifeMs: number;
    readonly recencyBasis: "created" | "accessed";
}
/** Clamp host-trusted importance into [0,1]; absent/non-finite → neutral. */
export declare function clampImportance(value: number | undefined): number;
/** Store trust boundary: importance must be a finite number when present; out-of-range clamps. */
export declare function normalizeImportance(value: number | undefined): number | undefined;
/**
 * Host-owned importance derivation from a reflection record (e.g. a serialized
 * observational-memory reflection): runs at write time only, receives the reflection
 * after secret redaction, and its returned weight is clamped to [0,1]. No default
 * implementation ships — hosts own the heuristic (see docs for the frequency/prominence
 * recipe example); importance is never LLM-derived in the write path.
 */
export type ImportanceFromReflection = (reflection: JsonObject) => number;
/**
 * Write-time importance: an explicit `entry.importance` wins; otherwise the host hook
 * runs once over the redacted `entry.reflection`. Returns undefined (neutral at scoring)
 * when neither yields a value. Never called at recall.
 */
export declare function deriveEntryImportance(entry: Pick<MemoryEntryInput, "importance" | "reflection">, hook: ImportanceFromReflection | undefined, redactor?: SecretRedactor): number | undefined;
/**
 * Validate weights (finite, in [0,1]) and sum-normalize. Similarity keeps the remainder of 1;
 * weights overshooting 1 normalize down to similarity 0. Returns undefined when no composite
 * weight is set — recall then behaves exactly as before (unblended, unchanged ordering).
 */
export declare function resolveRecallScoring(options: RecallScoringOptions | undefined): ResolvedRecallScoring | undefined;
/** Exponential half-life decay from the record timestamp; 1 (neutral) when missing/ill-dated. */
export declare function recencyOf(createdAt: string, halfLifeMs: number, now: number): number;
/**
 * Pure composite re-rank over one candidate batch: blends similarity, recency, and importance
 * per hit and exposes the components. Tie-break matches store ordering (score desc, sequence asc, id asc).
 */
export declare function rerankRecallHits(hits: readonly MemoryVectorHit[], scoring: ResolvedRecallScoring, now?: number): MemoryVectorHit[];
