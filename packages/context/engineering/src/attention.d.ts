/** Attention Compiler (plan 074 Tasks 2–3), ported into `@arnilo/prism-context-engineering`
 *  (plan 158 Task 7). Creation is synchronous and fails closed; `compileAttention` measures the
 *  assembled draft once, rewrites only the message clone it is given, and never touches the store,
 *  the compaction ledger, or the frozen prefix.
 *
 *  The kernel version rewrote two of the assembler's groups (`history` and the in-flight
 *  `toolResults`); a `context.build` draft is one flat message list, so the port rewrites the list
 *  and treats every row as history. The stages, gates, ledger, and frontier are otherwise the same
 *  code, which is why the kernel's attention suites still pass against this module.
 */
import type { ContextBlock, Message, SecretRedactor, ToolDefinition } from "@arnilo/prism";
import type { AttentionCompiler, AttentionCompilerContext, AttentionCompilerOptions, AttentionReport, AttentionTrigger, AttentionTriggerDecision, AttentionTriggerState, AttentionInputCapOptions } from "./attention-types.js";
import { type ResolvedToolResultFoldOptions } from "./fold.js";
export declare const ATTENTION_BUDGET_ERROR_CODE: "attention_budget_exceeded";
/** C9: still over `triggerRatio` after every eligible stage — host should compact, not delete. */
export declare class AttentionBudgetError extends Error {
    readonly code: "attention_budget_exceeded";
    constructor(message?: string);
}
export declare function isAttentionBudgetError(error: unknown): error is AttentionBudgetError;
export declare const DEFAULT_ATTENTION_TRIGGER_RATIO = 0.75;
export declare const DEFAULT_ATTENTION_COMPACT_RATIO = 0.9;
export declare const DEFAULT_ATTENTION_THINKING_KEEP_TURNS = 1;
export declare const DEFAULT_ATTENTION_KEEP_LAST = 3;
export declare const DEFAULT_ATTENTION_RESERVE_TOKENS = 1024;
export declare function resolveAttentionReserveTokens(value: unknown): number;
/** C2: host `maxInputTokens` wins; otherwise `contextWindow - (maxOutputTokens ?? 0) - reserve`.
 *  Throws when no cap can be derived. */
export declare function resolveInputCap(options?: AttentionInputCapOptions, model?: AttentionCompilerContext["model"]): number;
/**
 * Build the frozen per-turn state the axes read: the compiler supplies the cap and the run budget
 * (so a caller cannot silently drop the budget and fall back to the input cap), the caller
 * supplies what only the turn knows.
 */
export declare function attentionTriggerState(compiler: Pick<AttentionCompiler, "inputCap" | "runInputBudget">, turn: {
    readonly estimatedInputTokens: number;
    readonly runInputTokens?: number;
    readonly turn?: number;
}): AttentionTriggerState;
/**
 * Evaluate the fold axes in order against one turn's state; the first axis that fires wins, and
 * its `targetTokens` (when it has one) is what the stages fold to. Called at most twice per turn —
 * once at turn start, once after the stages — so a host predicate never runs per row.
 */
export declare function evaluateAttentionTrigger(axes: readonly AttentionTrigger[], state: AttentionTriggerState): AttentionTriggerDecision;
/** Validate compiler options + resolve the input cap. No provider I/O; unknown or
 *  unresolvable input throws here rather than on the first turn. */
export declare function createAttentionCompiler(options?: AttentionCompilerOptions, context?: AttentionCompilerContext): AttentionCompiler;
export interface AttentionStickyFrontier {
    /** SHA-256 keys of assistant messages whose thinking blocks were stripped. */
    readonly thinking: Set<string>;
    /** Tool call ids whose results were stubbed. */
    readonly toolCallIds: Set<string>;
}
export declare function createAttentionStickyFrontier(): AttentionStickyFrontier;
export interface AttentionCompileOptions {
    readonly compiler: AttentionCompiler;
    /** The exact messages the draft will send; the returned list is a rewritten clone. */
    readonly messages: readonly Message[];
    readonly context?: readonly ContextBlock[];
    readonly tools?: readonly ToolDefinition[];
    /** Host fold: its `summarize` wins for the rows the compiler picks, and its age/byte gates
     *  decide fold-eligibility. Omitted → the deterministic stub and `keepLast` alone. */
    readonly fold?: ResolvedToolResultFoldOptions;
    readonly frontier?: AttentionStickyFrontier;
    /** Session-owned folded bodies: a body stored here is re-applied instead of re-summarized, so a
     *  sticky row stays byte-identical and the host `summarize` runs once per row instead of once per
     *  turn. Omit for one-shot assemblies. */
    readonly attentionFold?: AttentionFoldLedger;
    readonly redactor?: SecretRedactor;
    readonly signal?: AbortSignal;
    readonly turn?: number;
    /** Run input tokens already charged this run; the `run_input_ratio` axis projects onto it. */
    readonly runInputTokens?: number;
    readonly sessionId?: string;
    readonly runId?: string;
}
export interface AttentionCompilation {
    /** The input list unchanged when nothing was mutated; otherwise a rewritten clone. The caller's
     *  array and messages are never mutated. */
    readonly messages: readonly Message[];
    readonly mutated: boolean;
    readonly report: AttentionReport;
}
/** One O(n) measurement of what the draft will send: messages, context blocks, tool declarations. */
export declare function measureDraftCost(options: {
    readonly messages: readonly Message[];
    readonly context?: readonly ContextBlock[];
    readonly tools?: readonly ToolDefinition[];
}): {
    tokens: number;
    bytes: number;
};
/**
 * Measure once, then mutate oldest-first until back under `triggerRatio` (C4), or throw
 * `AttentionBudgetError` when every eligible row is exhausted (C9). The frozen prefix (the leading
 * system messages) is never touched, and neither are the caller's arrays.
 */
export declare function compileAttention(options: AttentionCompileOptions): Promise<AttentionCompilation>;
export interface PersistedAttentionStickyFrontier {
    readonly v: 1;
    /** Newest-last, so a restored frontier is the tail of the mutations the session made. */
    readonly thinking: readonly string[];
    readonly toolCallIds: readonly string[];
}
/** Bounded snapshot of a live frontier; caller-owned (the session state persists it, the compiler
 *  never writes anywhere). */
export declare function serializeAttentionStickyFrontier(frontier: AttentionStickyFrontier): PersistedAttentionStickyFrontier;
/** Validate a persisted frontier from an untrusted store (plan 074 P3). Malformed *entries* are
 *  dropped one by one — a key the compiler cannot trust simply re-decides on the next turn —
 *  while a malformed *shape* yields `undefined` so the caller starts from an empty frontier.
 *  Never throws: a resume must not fail because a hand-edited record was stored. */
export declare function parseAttentionStickyFrontier(value: unknown): PersistedAttentionStickyFrontier | undefined;
/** Rebuild a frontier from a restored snapshot; callers hold the session that owns it. */
export declare function restoreAttentionStickyFrontier(persisted: PersistedAttentionStickyFrontier): AttentionStickyFrontier;
export interface AttentionFoldLedger {
    /** toolCallId → stub body (never the payload); insertion order is fold order, oldest first. */
    readonly bodies: Map<string, string>;
}
export declare function createAttentionFoldLedger(): AttentionFoldLedger;
/** Serialized fold ledger (plan 086 T3). Stub bodies only — no payload, and every entry was
 *  already capped and redacted when it was folded, so a restore re-applies it verbatim. */
export interface PersistedAttentionFoldLedger {
    readonly v: 1;
    /** Oldest-first, so a restored ledger is the tail of the folds the session made. */
    readonly bodies: readonly {
        readonly id: string;
        readonly body: string;
    }[];
}
/** Bounded snapshot of a live ledger; caller-owned. */
export declare function serializeAttentionFoldLedger(ledger: AttentionFoldLedger): PersistedAttentionFoldLedger;
/** Validate a persisted ledger from an untrusted store (plan 086 T3). Malformed *entries* are
 *  dropped one by one — a body the compiler cannot trust simply re-summarizes on the next turn —
 *  while a malformed *shape* yields `undefined` so the caller starts from an empty ledger.
 *  Never throws: a resume must not fail because a hand-edited record was stored. */
export declare function restoreAttentionFoldLedger(value: unknown): AttentionFoldLedger | undefined;
/** Consecutive `truncated` turns that arm compaction by default. */
export declare const DEFAULT_ATTENTION_TRUNCATION_THRESHOLD = 2;
export interface AttentionTruncationTriggerOptions {
    /** Truncated turns in a row before the trigger fires (default 2). */
    readonly threshold?: number;
}
/**
 * Host-side follow-up policy for `truncated` turns (plan 074 P4). `truncated: true` means the
 * gate ran out of *eligible* rows: stubs cannot hold the request under the ratio, so the honest
 * answer is a new prefix at the next task boundary rather than a silent eviction.
 *
 * Wire it by feeding every `attention.compiled` event to `observe` and handing `trigger` to a
 * `compaction.when` handler. It fires **once per armed streak**, so a branch is compacted once and
 * then left alone until new truncated turns arrive; a mutated turn that was not truncated clears
 * the streak because the pressure was relieved.
 */
export interface AttentionTruncationTrigger {
    /** Feed an `attention.compiled` event or an `AttentionReport`; returns the resulting streak. */
    observe(report: {
        readonly truncated?: unknown;
    }): number;
    /** Truncated turns in a row since the last fire or relief. */
    readonly streak: () => number;
    /** `true` once the streak reaches the threshold, resetting it. */
    readonly shouldCompact: () => boolean;
    /** Clear the streak (host compacted for its own reasons). */
    reset(): void;
}
export declare function createAttentionTruncationTrigger(options?: AttentionTruncationTriggerOptions): AttentionTruncationTrigger;
