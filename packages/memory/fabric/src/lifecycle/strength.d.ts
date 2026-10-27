/**
 * The two strengths of a note (plan 188.4 Task 3, Bjork & Bjork 1992).
 *
 * Storage strength S only accumulates evidence of value — being explicit, used across sessions,
 * helpful, outcome-tagged — and a user correction is the only thing that lowers it. Retrieval
 * strength R is ACT-R base-level activation over the use log, measured in scope sessions since each
 * use, so a project left alone does not decay while another project runs (D7). Recall adds both as
 * small bounded priors after fusion; neither can override relevance on its own (D8).
 */
import type { MemoryNoteKind, MemoryNoteMetadata } from "../types.js";
/** How much each kind of note is expected to be needed again; a lower `d` forgets slower. */
export type MemoryNoteDecay = Readonly<Record<MemoryNoteKind, number>>;
/** Coefficients of `S = explicit + sessions·log(1+useSessions) + helpful − harmful + outcome`. */
export interface StorageWeights {
    readonly explicit: number;
    readonly sessions: number;
    readonly helpful: number;
    readonly harmful: number;
    readonly outcome: number;
}
/** Additive recall priors, one per strength. Each bounds its prior, so relevance stays dominant. */
export interface StrengthWeights {
    readonly retrieval: number;
    readonly storage: number;
}
/** The positive term of S is bounded in practice; the cap keeps a hostile counter from inflating it. */
export declare const MAX_STORAGE_WEIGHT = 10;
/** A prior never exceeds its weight, and both weights are capped so a note cannot buy rank. */
export declare const MAX_STRENGTH_WEIGHT = 0.5;
/**
 * Provisional per-kind decay (plan 188.6 fits these): episodes are one-off, a preference outlives
 * both; `working` and `file` take the fact value because the plan does not name them.
 */
export declare const DEFAULT_DECAY: MemoryNoteDecay;
export declare const DEFAULT_STORAGE_WEIGHTS: StorageWeights;
/** Two small priors: a note with perfect strengths earns at most 0.1, under a 0.15 scope prior. */
export declare const DEFAULT_STRENGTH_WEIGHTS: StrengthWeights;
/** The logistic function: every prior lands in (0,1) whatever the strength is. */
export declare function logistic(value: number): number;
/**
 * `S = a·explicit + b·log(1+useSessions) + c·helpful − d·harmful + e·outcome`, clamped at 0.
 * `explicit` and `outcome` are the two `prism.promotion` signals the consolidation pass records.
 */
export declare function storageStrength(metadata: Pick<MemoryNoteMetadata, "useSessions" | "helpful" | "harmful" | "promotion">, weights?: StorageWeights): number;
/**
 * `R = ln Σ (clock − s + 1)^(−d)` over the use log, with `clock` the scope-session ordinal (Task 2).
 * A note with no use counts one use at its creation ordinal (0 for a note written before the clock
 * existed), so an unused note still has a floor to fall from.
 */
export declare function retrievalStrength(metadata: Pick<MemoryNoteMetadata, "uses" | "useSessions" | "created">, clock: number, d: number): number;
export interface StrengthPriorOptions {
    readonly decay?: MemoryNoteDecay;
    readonly storageWeights?: StorageWeights;
    readonly weights?: StrengthWeights;
}
/**
 * The bounded recall prior `w_R·σ(R) + w_S·σ(S)`, added after fusion and the scope prior. Its two
 * weights cap it, so a much more relevant note never loses to a well-used one.
 */
export declare function strengthPrior(metadata: Pick<MemoryNoteMetadata, "kind" | "uses" | "useSessions" | "helpful" | "harmful" | "promotion">, clock: number, options?: StrengthPriorOptions): number;
/**
 * S normalised to [0,1) for the core `importance` column (D14): a note with no evidence scores 0,
 * an explicit note 0.5, and each extra session or helpful turn adds less than the one before.
 */
export declare function noteImportance(strength: number): number;
