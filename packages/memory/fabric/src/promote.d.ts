import type { JsonSchema } from "@arnilo/prism";
import { type ConsolidationExtractionReason } from "./consolidation/extract.js";
import { type PromotionWeights } from "./consolidation/score.js";
export declare const DEFAULT_PROMOTE_MIN_TURNS_BETWEEN = 8;
/** The hard cap keeps a misconfigured threshold from making a candidate immortal. */
export declare const HARD_PROMOTE_MIN_TURNS_BETWEEN = 1000;
/**
 * Session consolidation, off by default: `promote: false` (or absent) makes no extractor call.
 * The candidate lifecycle itself lives in `lifecycle` (verification by use is `verifyAfterSessions`).
 */
export interface MemoryFabricPromoteConfig {
    /** The extractor model; default: the agent's model. */
    readonly model?: string;
    /** Acceptance floor. Default 0.5 (provisional until plan 188.6). */
    readonly minScore?: number;
    /** Per-term weight overrides; every term defaults to {@link DEFAULT_PROMOTION_WEIGHTS}. */
    readonly weights?: Partial<PromotionWeights>;
    /** Candidates per pass. Default 48. */
    readonly maxCandidates?: number;
    /** Turns between background passes. Default 8. */
    readonly minTurnsBetween?: number;
    /** Files a note may not merely restate. Default `["AGENTS.md", "README.md", "package.json", "CLAUDE.md"]`. */
    readonly derivableFrom?: readonly string[];
    /**
     * The extractor's output budget. Capped by the model's own `limits.maxOutputTokens`; absent, the
     * model's parameters apply unchanged. Extracting 48 notes needs room the solver budget may not give.
     */
    readonly maxOutputTokens?: number;
    /** The extractor's reasoning effort, one of `THINKING_LEVELS`; absent, the model's default. */
    readonly thinkingLevel?: string;
}
export interface ResolvedPromoteConfig {
    readonly enabled: boolean;
    readonly model?: string;
    readonly maxOutputTokens?: number;
    readonly thinkingLevel?: string;
    readonly minScore: number;
    readonly weights?: Readonly<Partial<PromotionWeights>>;
    readonly maxCandidates: number;
    readonly minTurnsBetween: number;
    readonly derivableFrom: readonly string[];
}
/** The extractor budget bounds: below 256 an answer cannot hold one note; 32,768 is the largest asked of any model. */
export declare const HARD_PROMOTE_MAX_OUTPUT_TOKENS = 32768;
export declare const MIN_PROMOTE_MAX_OUTPUT_TOKENS = 256;
export declare const memoryFabricPromoteSchema: {
    readonly anyOf: readonly [{
        readonly const: false;
    }, {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly model: {
                readonly type: "string";
                readonly minLength: 1;
                readonly maxLength: 4096;
            };
            readonly minScore: {
                readonly type: "number";
                readonly minimum: 0;
                readonly maximum: 8;
            };
            readonly weights: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    [k: string]: JsonSchema;
                };
            };
            readonly maxCandidates: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 256;
            };
            readonly minTurnsBetween: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 1000;
            };
            readonly derivableFrom: {
                readonly type: "array";
                readonly maxItems: 16;
                readonly items: {
                    readonly type: "string";
                    readonly minLength: 1;
                    readonly maxLength: 200;
                };
            };
            readonly maxOutputTokens: {
                readonly type: "integer";
                readonly minimum: 256;
                readonly maximum: 32768;
            };
            readonly thinkingLevel: {
                readonly type: "string";
                readonly enum: readonly ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
            };
        };
    }];
};
export declare function resolvePromoteConfig(value: false | MemoryFabricPromoteConfig | undefined): ResolvedPromoteConfig;
/** One pass's counts, kept in session state for `memory:status`. */
export interface FabricConsolidationReport {
    readonly pass: string;
    readonly at: string;
    readonly candidates: number;
    readonly extracted: number;
    readonly accepted: number;
    readonly rejected: {
        readonly score: number;
        readonly ephemeral: number;
        readonly derivable: number;
        readonly trust: number;
        readonly secret: number;
    };
    readonly written: number;
    readonly updated: number;
    readonly exceptions: number;
    readonly retired: number;
    /** Actual extractor calls: 1 for a valid pass, 2 after one bounded repair. */
    readonly modelCalls: number;
    /** Extractor calls spent correcting a malformed answer; never more than 1. */
    readonly correctionCalls?: number;
    /**
     * Why the pass's extraction failed, by reason code. Present only on a failed pass: the pass keeps
     * its cursor and writes nothing, so `memory:status` shows the reason instead of dropping it.
     */
    readonly failures?: Readonly<Partial<Record<ConsolidationExtractionReason, number>>>;
    /** Extractor calls that stopped on the output limit, whether or not a repair followed. */
    readonly outputLimited?: number;
}
/** Per-session consolidation state: the cursor, the last pass's counts, and trust-scan refusals. */
export interface FabricPromoteState {
    /** The last entry id a pass covered; gathering resumes after it. */
    readonly cursor?: string;
    /** The last completed pass, replayed by `memory:status`. */
    readonly last?: FabricConsolidationReport;
    /** Notes the extractor's output refused for the trust scan. */
    readonly refused: number;
}
export declare const INITIAL_PROMOTE_STATE: FabricPromoteState;
export declare function readPromoteState(value: unknown): FabricPromoteState;
export interface FabricNoteCensus {
    readonly candidate: number;
    readonly verified: number;
    readonly archived: number;
    readonly reconsolidate?: number;
}
