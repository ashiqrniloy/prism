import type { Message } from "@arnilo/prism";
export declare const DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS = 2;
export declare const DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES = 4096;
export declare const DEFAULT_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES = 512;
export declare const HARD_TOOL_RESULT_FOLD_MAX_SUMMARY_BYTES = 4096;
export declare const DEFAULT_TOOL_RESULT_FOLD_KEEP_LAST = 3;
export declare const DEFAULT_TOOL_RESULT_FOLD_CLEAR_AT_LEAST_TOKENS = 0;
export declare const TOOL_RESULT_FOLD_TURN_METADATA_KEY: "prismToolResultTurn";
export interface ToolResultFoldInput {
    readonly sessionId: string;
    readonly runId: string;
    readonly turn: number;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly text: string;
}
export interface ToolResultFoldOptions {
    readonly minAgeTurns?: number;
    readonly minBytes?: number;
    readonly maxSummaryBytes?: number;
    /** Newest tool results batch mode never folds; ignored when `clearAtLeastTokens` is `0`. */
    readonly keepLast?: number;
    /** Tool names never folded. */
    readonly excludeTools?: readonly string[];
    /** Batch size in tokens. `0` keeps the per-turn behavior (fold every eligible result). */
    readonly clearAtLeastTokens?: number;
    readonly summarize: (input: ToolResultFoldInput) => Promise<string> | string;
}
export interface ResolvedToolResultFoldOptions {
    readonly minAgeTurns: number;
    readonly minBytes: number;
    readonly maxSummaryBytes: number;
    readonly keepLast: number;
    readonly excludeTools: readonly string[];
    readonly clearAtLeastTokens: number;
    readonly summarize: (input: ToolResultFoldInput) => Promise<string> | string;
}
export interface FoldToolResultsContext {
    readonly sessionId: string;
    readonly runId: string;
    readonly turn: number;
    readonly signal?: AbortSignal;
    /** When set, only these tool-call ids are folded; every other row is returned untouched. */
    readonly restrictToToolCallIds?: ReadonlySet<string>;
}
/** Run overrides agent; disabled when neither supplies `summarize`. */
export declare function resolveToolResultFold(run?: ToolResultFoldOptions, agent?: ToolResultFoldOptions): ResolvedToolResultFoldOptions | undefined;
/** Projection-only fold for history tool messages; does not mutate the input array. */
export declare function foldToolResultHistory(history: readonly Message[], options: ResolvedToolResultFoldOptions, context: FoldToolResultsContext): Promise<readonly Message[]>;
/** A batch decision: which rows this request folds, and which ids advance the persisted frontier. */
export interface ToolResultFoldSelection {
    readonly foldToolCallIds: ReadonlySet<string>;
    readonly advance: readonly string[];
}
/** Cache-aware batch plan (plan 194 Task 4): fold every already-cleared row, and fold pending rows
 *  only once their combined original size reaches `clearAtLeastTokens`. A held batch returns exactly
 *  the frontier's rows, so the provider view is byte-identical up to the new tail. */
export declare function planToolResultFoldBatch(history: readonly Message[], options: ResolvedToolResultFoldOptions, context: {
    readonly turn: number;
    readonly clearedToolCallIds: ReadonlySet<string>;
}): ToolResultFoldSelection;
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
export declare function formatFoldedToolResult(summary: string): string;
export declare function foldedToolResultHeader(toolName: string, toolCallId: string, summary: string): string;
/** The fold stub: names the tool, the call id, and the original payload size, so the model can
 *  decide to re-run the tool instead of guessing what it lost. */
export declare function foldedToolResultStub(toolName: string, toolCallId: string, summary: string, originalBytes: number): string;
/** Text the fold summarizes for one tool result: the payload JSON, then any text blocks.
 *  Shared with the attention compiler so both hash/summarize the same bytes. */
export declare function toolResultFoldText(result: unknown, error: unknown, extra?: readonly {
    readonly type: string;
}[]): string;
/** UTF-8 cap that never splits a multi-byte character. Shared with the attention
 *  compiler's host-summarize path so both cap host text identically. */
export declare function capToolResultSummary(summary: string, maxBytes: number): string;
/** Provider turn per history index: assistant messages advance the turn, tool rows use
 *  their `prismToolResultTurn` stamp when present and the last assistant turn otherwise.
 *  Shared with the attention compiler so age gates match the fold exactly. */
export declare function inferToolResultTurns(history: readonly Message[]): readonly number[];
/** `fold.summarize: "truncate"` — the deterministic projection: the head of the payload, which the
 *  fold then caps at `maxSummaryBytes` without splitting a multi-byte character. No model call. */
export declare function truncateSummarize(input: ToolResultFoldInput): string;
export interface ModelSummarizeOptions {
    /** Resolved by the package through `prism.models.client(fold.summarize.model)`. */
    readonly client: {
        generate(request: {
            readonly messages: readonly Message[];
            readonly signal?: AbortSignal;
        }): AsyncIterable<{
            readonly type: string;
            readonly content?: {
                readonly type: string;
                readonly text?: string;
            };
            readonly error?: unknown;
        }>;
    };
    /** Byte cap on the summary; the provider stream is aborted once it is reached. */
    readonly maxSummaryBytes: number;
    /** Prepended to the payload. Default {@link DEFAULT_FOLD_SUMMARY_INSTRUCTION}. */
    readonly instruction?: string;
}
export declare const DEFAULT_FOLD_SUMMARY_INSTRUCTION = "Summarize this tool result for a later turn. Keep identifiers, file paths, and outcomes; drop formatting noise. Answer with the summary only.";
/**
 * `fold.summarize: { model }` — one model call per newly folded result. Bounded twice: the provider
 * stream is aborted as soon as `maxSummaryBytes` is reached, and the fold caps the returned string
 * again, so a runaway provider cannot inflate the request.
 */
export declare function createModelSummarize(options: ModelSummarizeOptions): (input: ToolResultFoldInput) => Promise<string>;
