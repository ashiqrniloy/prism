import type { BudgetAxisUsage, BudgetConsumedCounters, ResolvedRunLimits, RunLimitBreach, RunLimitCounters, RunLimitName, RunLimits, ToolCallSummary, Usage } from "./contracts.js";
export declare const DEFAULT_RUN_LIMITS: Readonly<{
    maxTurns: 16;
    maxProviderAttempts: 24;
    maxToolRounds: 8;
    maxToolCalls: 32;
    maxWallTimeMs: 120000;
    maxRequestBytes: number;
    maxResponseBytes: number;
    maxInputTokens: 40000;
    maxOutputTokens: 10000;
    maxTotalTokens: 50000;
}>;
/** How long `session.close()` waits for background tasks when no limit configures it. */
export declare const DEFAULT_BACKGROUND_SETTLE_MS = 5000;
/**
 * Bounded settle for `session.close()` (plan 146 Task 7): the agent-wide `backgroundSettleMs`, validated
 * as a non-negative safe integer. A per-run layer cannot set it, since a session outlives a run.
 */
export declare function resolveBackgroundSettleMs(agent?: RunLimits): number;
/**
 * Process-safety ceilings that exist so a bug cannot OOM the host via JSON.parse of giant
 * provider frames. Product axes (turns, wall time, tokens, …) have no hard cap: hosts set
 * them per workload, and `null` explicitly disables an axis.
 */
export declare const HARD_RUN_LIMITS: Readonly<{
    maxRequestBytes: number;
    maxResponseBytes: number;
}>;
export declare class RunLimitError extends Error {
    readonly breach: RunLimitBreach;
    readonly code = "ERR_PRISM_RUN_LIMIT";
    constructor(breach: RunLimitBreach);
}
export interface RunLimitTrackerOptions {
    readonly onExceeded?: (breach: RunLimitBreach) => void;
    /** Durable resumption restores cumulative counters and original wall deadline. */
    readonly snapshot?: RunLimitCounters;
    readonly deadlineAt?: string;
}
/** Validate one host-authored layer. Defaults are applied only after inheritance is resolved. */
export declare function resolveRunLimits(agent?: RunLimits, run?: RunLimits): Readonly<ResolvedRunLimits>;
export declare class RunLimitTracker {
    private readonly options;
    readonly limits: Readonly<ResolvedRunLimits>;
    private readonly startedAt;
    /** Wall deadline ISO string; absent when the run has no wall limit. */
    readonly deadlineAt: string | undefined;
    private readonly counters;
    private timer?;
    private exceeded?;
    constructor(limits: Readonly<ResolvedRunLimits>, options?: RunLimitTrackerOptions);
    get breach(): RunLimitBreach | undefined;
    snapshot(): RunLimitCounters;
    dispose(): void;
    charge(limit: Exclude<RunLimitName, "maxCost">, delta?: number): void;
    recordUsage(usage: Usage | undefined): void;
    private exceed;
}
export declare function createRunLimitTracker(limits: RunLimits | undefined, options?: RunLimitTrackerOptions): RunLimitTracker;
/**
 * Attribution carried by a limit death (plan 087 T2, plan 108 T5): the `budget_exhausted` payload
 * without `limit`, which `RunResult.limit` / `child_failed.limit` already carry.
 */
export interface BudgetExhaustionAttribution {
    readonly consumed: BudgetConsumedCounters;
    readonly closestOtherAxes: readonly BudgetAxisUsage[];
    readonly recentToolCalls: readonly ToolCallSummary[];
}
/**
 * Build the `budget_exhausted` payload (plan 087 T2): which axis fired, the counters a host reads
 * first, the closest other axes, and the last dispatched tool calls (hashes only).
 */
export declare function describeBudgetExhaustion(tracker: RunLimitTracker, breach: RunLimitBreach, recentToolCalls: readonly ToolCallSummary[]): BudgetExhaustionAttribution & {
    readonly limit: RunLimitName;
};
