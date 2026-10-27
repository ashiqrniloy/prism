import type { ExtractedNote } from "./extract.js";
import type { ConsolidationCandidate } from "./gather.js";
/** The terms of the score, all data so plan 188.6 can calibrate them. */
export interface PromotionWeights {
    readonly explicit: number;
    readonly correction: number;
    readonly outcome: number;
    readonly recurrence: number;
    readonly generality: number;
    readonly ephemerality: number;
    readonly derivability: number;
    readonly duplicate: number;
}
/** Provisional until plan 188.6 calibrates against paired evidence. */
export declare const DEFAULT_PROMOTION_WEIGHTS: PromotionWeights;
export declare const DEFAULT_PROMOTION_MIN_SCORE = 0.5;
/** Distinct sessions at which recurrence reaches 1; `log2(1 + sessions)` is normalised by it. */
export declare const DEFAULT_RECURRENCE_SATURATION = 4;
/** Files whose content a note may simply restate; defaults to the repository's own instructions. */
export declare const DEFAULT_DERIVABLE_FROM: readonly string[];
export declare const MAX_DERIVABLE_FILE_BYTES: number;
export declare const MAX_DERIVABLE_FILES = 16;
/** A note whose terms are this covered by a `derivableFrom` file adds nothing a reader can look up. */
export declare const DERIVABLE_COVERAGE = 0.9;
export interface PromotionSignals {
    readonly explicit: number;
    readonly correction: number;
    readonly outcome: number;
    readonly recurrence: number;
    readonly generality: number;
    readonly ephemerality: number;
    readonly derivability: number;
    readonly duplicate: number;
}
export type PromotionRejection = "ephemeral" | "derivable" | "score";
export interface PromotionScore {
    readonly score: number;
    readonly signals: PromotionSignals;
    readonly accepted: boolean;
    /** The one reason a note was rejected; absent when accepted. */
    readonly reason?: PromotionRejection;
}
export interface PromotionExistingNote {
    readonly id: string;
    readonly kind: string;
    readonly text: string;
}
export interface DerivableSource {
    readonly path: string;
    readonly text: string;
    readonly terms: ReadonlySet<string>;
}
export interface PromotionScoreContext {
    /** The gathered candidates `note.evidence` resolves to. */
    readonly candidates: readonly ConsolidationCandidate[];
    /** Distinct sessions covering those candidates and any existing note an UPDATE would target. */
    readonly sessions: number;
    /** Same-kind active notes in the target scope, for the duplicate term. */
    readonly existing?: readonly PromotionExistingNote[];
    /** Contents of `derivableFrom` from `loadDerivableSources`; one analysis per file per pass. */
    readonly derivable?: readonly DerivableSource[];
    readonly weights?: Partial<PromotionWeights>;
    readonly minScore?: number;
    readonly scratchDir?: string;
}
/** `log2(1 + sessions)` normalised to reach 1 at `sessions = 4`; capped at 1. */
export declare function recurrenceSignal(sessions: number, saturation?: number): number;
/**
 * Determine whether a note is only true for a moment: a line reference, a temp path, a commit hash,
 * a branch name, or a date it would outlive. A date is not ephemeral when the note states its own
 * validity bound (`since`, `until`, `as of`), which is the durable form of a dated claim.
 */
export declare function ephemeralReason(text: string, scratchDir?: string): string | undefined;
/**
 * Score one extracted note and decide whether the gate accepts it.
 *
 * Precedence: ephemerality rejects unless the user said it explicitly, derivability rejects outright,
 * and an explicit user statement is never rejected for score. Secrets and the trust scan are Task 2's
 * job and happen before this point.
 */
export declare function scorePromotion(note: ExtractedNote, context: PromotionScoreContext): PromotionScore;
export interface SkippedDerivableSource {
    readonly path: string;
    readonly reason: "outside-root" | "missing" | "unreadable" | "truncated";
}
export interface DerivableSources {
    readonly sources: readonly DerivableSource[];
    /** Paths the jail refused or could not read; a status note is all a pass can do with them. */
    readonly skipped: readonly SkippedDerivableSource[];
}
/**
 * Read `derivableFrom` once per pass through the fabric file jail: inside the project root, each file
 * capped at 64 KiB, a symlink or `..` escape skipped with a note rather than silently trusted.
 */
export declare function loadDerivableSources(root: string, files?: readonly string[]): Promise<DerivableSources>;
