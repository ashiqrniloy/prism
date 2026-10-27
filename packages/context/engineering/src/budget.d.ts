/**
 * Draft input budget (plan 158 Task 7), ported from the kernel's `src/context-budget.ts`
 * (plan 145 Task 4's "context blocks escape the context budget now" deferral closes here).
 *
 * The kernel version evicted from six named groups plus skills and context blocks; a `context.build`
 * draft is one flat message list with an addition channel for context blocks, so the port keeps the
 * same discipline over that shape:
 *
 * - The **mandatory prefix** is the leading system block (plus `draft.systemPrompt`, which replaces
 *   it). It is never dropped; when it alone exceeds the cap the transform rejects and the run fails
 *   closed, exactly as the kernel's `ContextBudgetError` did.
 * - Droppable rows are evicted oldest-first, tool results before other history, then context blocks
 *   lowest-priority-first — the kernel's drop order.
 * - Measurement counts messages, context blocks, and tool declarations with the assembler's own
 *   text shapes, so the pass sees what another `context.build` handler added before it.
 *
 * Budget-only: estimates never reach billing, provider usage, or the wire.
 */
import type { ContextBlock, Message, ToolDefinition } from "@arnilo/prism";
export type TokenEstimator = (text: string) => number;
/** Assembler-time input budget. At least one max required when present. */
export interface ContextBudget {
    readonly maxInputTokens?: number;
    readonly maxInputBytes?: number;
    readonly reportOmissions?: boolean;
}
export type ContextBudgetOmissionKind = "tool_results" | "history" | "context";
export interface ContextBudgetOmission {
    readonly kind: ContextBudgetOmissionKind;
    readonly id?: string;
    readonly tokenEstimate: number;
    readonly byteLength: number;
}
export interface ContextBudgetReport {
    readonly omitted: readonly ContextBudgetOmission[];
    readonly keptTokens: number;
    readonly keptBytes: number;
    readonly maxInputTokens?: number;
    readonly maxInputBytes?: number;
    readonly truncated: boolean;
}
export declare const HARD_MAX_CONTEXT_BUDGET_TOKENS = 2000000;
export declare const HARD_MAX_CONTEXT_BUDGET_BYTES: number;
export declare const DEFAULT_MAX_CONTEXT_BUDGET_OMISSIONS = 256;
export declare const HARD_MAX_CONTEXT_BUDGET_OMISSIONS = 1024;
export declare const CONTEXT_BUDGET_ERROR_CODE: "context_budget_exceeded";
/** The 0.12 message, kept verbatim so a host that matched on it still does. */
export declare class ContextBudgetError extends Error {
    readonly code: "context_budget_exceeded";
    constructor(message?: string);
}
export declare function isContextBudgetError(error: unknown): error is ContextBudgetError;
export declare function resolveContextBudget(budget: ContextBudget): Required<Pick<ContextBudget, "reportOmissions">> & ContextBudget;
/** One O(n) measurement of the whole draft. */
export declare function measureBudgetCost(options: {
    readonly messages: readonly Message[];
    readonly context?: readonly ContextBlock[];
    readonly tools?: readonly ToolDefinition[];
    readonly systemPrompt?: string;
}): {
    tokens: number;
    bytes: number;
};
export interface ApplyDraftBudgetOptions {
    readonly messages: readonly Message[];
    readonly context?: readonly ContextBlock[];
    readonly tools?: readonly ToolDefinition[];
    readonly systemPrompt?: string;
    readonly budget: ContextBudget;
}
export interface ApplyDraftBudgetResult {
    readonly messages: readonly Message[];
    readonly context: readonly ContextBlock[];
    readonly report: ContextBudgetReport;
}
/**
 * Apply the budget to a whole draft. Throws `ContextBudgetError` when the mandatory prefix cannot
 * fit; the handler turns that into a `ctx.reject`, so the run fails closed rather than sending an
 * over-cap request.
 */
export declare function applyDraftBudget(options: ApplyDraftBudgetOptions): ApplyDraftBudgetResult;
