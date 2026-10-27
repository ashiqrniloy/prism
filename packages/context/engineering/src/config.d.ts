/**
 * Validated `packageConfig` for `@arnilo/prism-context-engineering` (plan 158 Task 7).
 *
 * Every stage is off unless configured, and one handler composes the configured stages in a fixed
 * order (fold → tool search → attention or budget). `budget` and `attention` are mutually exclusive:
 * both evict from the same request for the same reason, and configuring both would leave the order
 * of two competing evictions to chance. `blocks` caps the injected context-block share in a
 * `model.request` pass, so it is mutually exclusive with `budget` too; `accounting` emits the
 * measurement event and any configured stage emits it as well.
 *
 * The JSON schema carries no function: `fold.summarize` is `"truncate"` or `{ model }`, and an
 * attention axis is one of the three object kinds. A host that needs a custom summarizer or a
 * predicate axis uses the package's library exports, or registers its own `context.build` handler.
 */
import type { JsonSchema, ModelRef } from "@arnilo/prism";
import type { ContextBudget } from "./budget.js";
import type { AttentionTrigger } from "./attention-types.js";
/** Input budget for the whole draft. At least one cap is required when the block is present. */
export interface ContextEngineeringBudgetConfig {
    readonly maxInputTokens?: number;
    readonly maxInputBytes?: number;
    /** Emit the `context.omissions` package event for every dropped row. Default `false`. */
    readonly reportOmissions?: boolean;
}
/** Old-tool-result folding. `summarize` defaults to `"truncate"` (deterministic, no model call).
 *  `keepLast` and `clearAtLeastTokens` apply only when batching (`clearAtLeastTokens > 0`). */
export interface ContextEngineeringFoldConfig {
    readonly minAgeTurns?: number;
    readonly minBytes?: number;
    readonly maxSummaryBytes?: number;
    readonly summarize?: "truncate" | {
        readonly model?: ModelRef;
    };
    /** Newest tool results that batch mode never folds. Default `3`. */
    readonly keepLast?: number;
    /** Tool names that are never folded (batch and per-turn mode). Default `[]`. */
    readonly excludeTools?: readonly string[];
    /** Clear in batches of at least this many tokens. `0` (default) folds every eligible result per turn. */
    readonly clearAtLeastTokens?: number;
}
/** Progressive tool disclosure. `disclosure: "search"` narrows the draft and registers `search_tools`. */
export interface ContextEngineeringToolSearchConfig {
    readonly disclosure?: "all" | "search";
    readonly topK?: number;
}
/** Attention compiler settings, in the JSON-safe subset of the library's options. */
export interface ContextEngineeringAttentionConfig {
    readonly maxInputTokens?: number;
    readonly reserveTokens?: number;
    readonly triggerRatio?: number;
    readonly compactRatio?: number;
    readonly thinkingKeepTurns?: number;
    readonly keepLast?: number;
    readonly excludeTools?: readonly string[];
    /** Fold axes. Omitted keeps the `triggerRatio` axis. A predicate axis is not expressible in JSON. */
    readonly trigger?: readonly AttentionTrigger[] | AttentionTrigger;
}
/** Injected-block share cap: whole blocks over `maxShare × inputCap` are dropped. */
export interface ContextEngineeringBlocksConfig {
    /** Fraction of the input cap injected context blocks may occupy (0 < maxShare ≤ 1). */
    readonly maxShare: number;
}
export interface ContextEngineeringConfig {
    /** Emit `context.accounted` once per request even with no stage configured. Default `false`. */
    readonly accounting?: boolean;
    /** Cap the share of the input taken by injected context blocks (mutually exclusive with budget). */
    readonly blocks?: ContextEngineeringBlocksConfig;
    readonly budget?: ContextEngineeringBudgetConfig;
    readonly fold?: ContextEngineeringFoldConfig;
    readonly toolSearch?: ContextEngineeringToolSearchConfig;
    readonly attention?: ContextEngineeringAttentionConfig;
}
/** {@link ContextEngineeringConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedContextEngineeringConfig {
    readonly accounting: boolean;
    readonly blocks?: ContextEngineeringBlocksConfig;
    readonly budget?: ContextBudget;
    readonly fold?: {
        readonly minAgeTurns: number;
        readonly minBytes: number;
        readonly maxSummaryBytes: number;
        readonly summarize: "truncate" | {
            readonly model?: ModelRef;
        };
        readonly keepLast: number;
        readonly excludeTools: readonly string[];
        readonly clearAtLeastTokens: number;
    };
    readonly toolSearch?: {
        readonly disclosure: "all" | "search";
        readonly topK: number;
    };
    readonly attention?: ContextEngineeringAttentionConfig;
}
export declare const DEFAULT_FOLD_MIN_AGE_TURNS = 2;
export declare const DEFAULT_FOLD_MIN_BYTES = 4096;
export declare const DEFAULT_FOLD_MAX_SUMMARY_BYTES = 512;
export declare const DEFAULT_FOLD_KEEP_LAST = 3;
export declare const DEFAULT_FOLD_CLEAR_AT_LEAST_TOKENS = 0;
export declare const DEFAULT_TOOL_SEARCH_TOP_K = 16;
export declare const contextEngineeringConfigSchema: JsonSchema;
export declare class ContextEngineeringConfigError extends Error {
    constructor(message: string);
}
/** Apply the defaults and reject the one combination the package will not run. */
export declare function resolveContextEngineeringConfig(config?: ContextEngineeringConfig): ResolvedContextEngineeringConfig;
/** `true` when nothing is configured, so `setup` registers no handler at all. */
export declare function isEmptyContextEngineeringConfig(config: ResolvedContextEngineeringConfig): boolean;
