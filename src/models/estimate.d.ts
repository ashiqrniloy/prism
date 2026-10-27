/** Input estimation residue (plan 158 Task 8). The kernel's own accounting: the usage seam
 *  (`provider-round.ts`), the compaction trigger (`contracts-core/compaction.ts`), skill disclosure,
 *  and the context meter all measure with these helpers, so they stay in the kernel after the
 *  context-engineering stages moved to `@arnilo/prism-context-engineering`.
 *
 *  Nothing here decides anything: every function returns a number or a cap. The stages that act on
 *  those numbers are package `context.build` handlers, which import these estimators from
 *  `@arnilo/prism`. */
import type { ContextBlock, Message, ModelConfig, TokenEstimate, ToolDefinition } from "../contracts.js";
/**
 * Host-supplied token estimator. Budget-only: it never reaches billing, provider
 * usage, or the wire — it decides what a caller evicts and nothing else.
 */
export type TokenEstimator = (text: string) => number;
/** Input-cap resolution inputs: a host cap, or the model window minus headroom. */
export interface InputCapOptions {
    /** Host cap; when set it wins over `model.limits.contextWindow`. */
    readonly maxInputTokens?: number;
    /** Output + next-turn headroom subtracted from the window (default 1024). */
    readonly reserveTokens?: number;
}
/** Default headroom subtracted from a model window when a caller derives an input cap. */
export declare const DEFAULT_INPUT_RESERVE_TOKENS = 1024;
/** UTF-16 code units / 4. Estimate only — not billing. */
export declare function estimateTextTokens(text: string): number;
export declare function estimateTextBytes(text: string): number;
export declare function estimateMessageTokens(message: Message, estimateTokens?: TokenEstimator): number;
export declare function estimateMessageTokens(messages: readonly Message[], modelFamily?: string): TokenEstimate;
export declare function estimateMessageBytes(message: Message): number;
export declare function estimateAssemblyTokens(messages: readonly Message[]): number;
/** Tool declarations and context blocks projected with the assembler's own `measureAll` text
 *  shapes, so the usage-fallback estimate and any package stage cannot drift (never
 *  `JSON.stringify` of the raw schemas). */
export declare function estimateRequestExtrasTokens(tools: readonly ToolDefinition[] | undefined, context: readonly ContextBlock[] | undefined, estimateTokens: TokenEstimator): number;
/** Resolve a per-request input cap: host `maxInputTokens` wins; otherwise
 *  `contextWindow - (maxOutputTokens ?? 0) - reserve`. Throws when no cap can be derived, so a
 *  caller that needs one fails at config time rather than on the turn that first measures. */
export declare function resolveInputCap(options?: InputCapOptions, model?: Pick<ModelConfig, "limits">): number;
