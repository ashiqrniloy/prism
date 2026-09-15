import type { Usage } from "@arnilo/prism";
import type { ExecutionTimeline } from "./timeline-types.js";

/** Maximum distinct tool names retained in a summary before overflowing to "other". */
export const MAX_SUMMARY_DISTINCT_TOOLS = 64;

export interface TimelineSummary {
  readonly durationMs: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolCounts: Readonly<Record<string, number>>;
  readonly providerAttempts: number;
  readonly usage?: Usage;
  readonly cost?: { readonly amount: number; readonly currency: string };
  readonly errorCount: number;
  readonly blockedToolCount: number;
  readonly suspended: boolean;
  readonly status: string;
  readonly stepCount: number;
}

export interface SessionSummary {
  readonly sessionId?: string;
  readonly runCount: number;
  readonly durationMs: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolCounts: Readonly<Record<string, number>>;
  readonly providerAttempts: number;
  readonly usage?: Usage;
  readonly cost?: { readonly amount: number; readonly currency: string };
  readonly errorCount: number;
  readonly blockedToolCount: number;
  readonly suspended: boolean;
  readonly status: string;
  readonly stepCount: number;
  readonly runs: readonly TimelineSummary[];
}

/** Pure arithmetic helper to sum two optional Usage objects. */
export function addUsage(a?: Usage, b?: Usage): Usage | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const inputTokens = (a.inputTokens ?? 0) + (b.inputTokens ?? 0);
  const outputTokens = (a.outputTokens ?? 0) + (b.outputTokens ?? 0);
  const totalTokens = (a.totalTokens ?? 0) + (b.totalTokens ?? 0);
  const cacheReadTokens =
    a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined ? (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) : undefined;
  const cacheWriteTokens =
    a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined
      ? (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0)
      : undefined;
  const cost = a.cost !== undefined || b.cost !== undefined ? Math.round(((a.cost ?? 0) + (b.cost ?? 0)) * 1e6) / 1e6 : undefined;
  const currency = a.currency ?? b.currency;

  return {
    ...(inputTokens ? { inputTokens } : {}),
    ...(outputTokens ? { outputTokens } : {}),
    ...(totalTokens ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(currency ? { currency } : {}),
  };
}

/**
 * Bounds distinct tool names to `maxDistinct` (default 64) and rolls
 * the rest into "other" deterministically (sorted by count desc, then name asc).
 */
export function capToolCounts(
  rawCounts: Readonly<Record<string, number>>,
  maxDistinct: number = MAX_SUMMARY_DISTINCT_TOOLS,
): Readonly<Record<string, number>> {
  const entries = Object.entries(rawCounts);
  if (entries.length <= maxDistinct) {
    return Object.freeze({ ...rawCounts });
  }

  // Separate any existing "other" bucket if present
  let existingOther = 0;
  const namedEntries: [string, number][] = [];
  for (const [tool, count] of entries) {
    if (tool === "other") {
      existingOther += count;
    } else {
      namedEntries.push([tool, count]);
    }
  }

  // Sort descending by count, then alphabetically for determinism.
  namedEntries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const capped: Record<string, number> = {};
  let otherCount = existingOther;

  for (let i = 0; i < namedEntries.length; i++) {
    const [tool, count] = namedEntries[i]!;
    if (i < maxDistinct) {
      capped[tool] = count;
    } else {
      otherCount += count;
    }
  }

  if (otherCount > 0) {
    capped.other = otherCount;
  }

  return Object.freeze(capped);
}

/**
 * Extracts a single run's usage from an ExecutionTimeline without double-counting:
 * if a root "run" step has usage (run_total), that is returned;
 * otherwise, usage from individual "provider" steps is summed.
 */
function extractTimelineUsage(timeline: ExecutionTimeline): Usage | undefined {
  const runStep = timeline.steps.find((s) => s.kind === "run" && s.usage !== undefined);
  if (runStep?.usage) {
    return runStep.usage;
  }
  let aggregated: Usage | undefined;
  for (const step of timeline.steps) {
    if (step.kind === "provider" && step.usage) {
      aggregated = addUsage(aggregated, step.usage);
    }
  }
  return aggregated;
}

/**
 * Summarizes a single ExecutionTimeline for cockpit dashboard cards and latency/cost attribution.
 */
export function summarizeTimeline(timeline: ExecutionTimeline): TimelineSummary {
  const durationMs =
    timeline.startedAt && timeline.finishedAt ? Math.max(0, Date.parse(timeline.finishedAt) - Date.parse(timeline.startedAt) || 0) : 0;

  let turnCount = 0;
  let toolCallCount = 0;
  const rawToolCounts: Record<string, number> = {};
  let providerAttempts = 0;
  let errorCount = 0;
  let blockedToolCount = 0;
  let suspended = false;

  for (const step of timeline.steps) {
    if (step.kind === "turn") {
      turnCount++;
    } else if (step.kind === "tool") {
      toolCallCount++;
      rawToolCounts[step.name] = (rawToolCounts[step.name] ?? 0) + 1;
      if (step.status === "denied" || step.metadata?.blocked === true) {
        blockedToolCount++;
      }
    } else if (step.kind === "guardrail") {
      if (
        step.status === "denied" ||
        step.metadata?.action === "deny" ||
        step.metadata?.action === "block" ||
        step.metadata?.action === "tripwire"
      ) {
        blockedToolCount++;
      }
    } else if (step.kind === "provider" || step.kind === "retry") {
      providerAttempts++;
    }

    if (step.error !== undefined || step.status === "failed") {
      errorCount++;
    }

    if (step.metadata?.suspended === true || step.metadata?.interruption !== undefined || step.name === "agent_suspended") {
      suspended = true;
    }
  }

  const usage = extractTimelineUsage(timeline);
  const cost = usage?.cost !== undefined ? { amount: usage.cost, currency: usage.currency ?? "USD" } : undefined;

  return Object.freeze({
    durationMs,
    turnCount,
    toolCallCount,
    toolCounts: capToolCounts(rawToolCounts),
    providerAttempts,
    usage,
    cost,
    errorCount,
    blockedToolCount,
    suspended,
    status: timeline.status,
    stepCount: timeline.steps.length,
  });
}

/**
 * Summarizes an entire session across multiple runs, grouping metrics and summing
 * usage without double-counting run_total and provider_turn.
 */
export function summarizeSession(timelines: readonly ExecutionTimeline[], options?: { sessionId?: string }): SessionSummary {
  const runs = timelines.map((tl) => summarizeTimeline(tl));

  let totalDurationMs = 0;
  let totalTurnCount = 0;
  let totalToolCallCount = 0;
  const mergedToolCounts: Record<string, number> = {};
  let totalProviderAttempts = 0;
  let aggregatedUsage: Usage | undefined;
  let totalErrorCount = 0;
  let totalBlockedToolCount = 0;
  let anySuspended = false;
  let totalStepCount = 0;

  for (let i = 0; i < timelines.length; i++) {
    const summary = runs[i]!;
    totalDurationMs += summary.durationMs;
    totalTurnCount += summary.turnCount;
    totalToolCallCount += summary.toolCallCount;
    totalProviderAttempts += summary.providerAttempts;
    aggregatedUsage = addUsage(aggregatedUsage, summary.usage);
    totalErrorCount += summary.errorCount;
    totalBlockedToolCount += summary.blockedToolCount;
    if (summary.suspended) anySuspended = true;
    totalStepCount += summary.stepCount;

    for (const [tool, count] of Object.entries(summary.toolCounts)) {
      mergedToolCounts[tool] = (mergedToolCounts[tool] ?? 0) + count;
    }
  }

  let compositeStatus = "succeeded";
  if (runs.some((r) => r.status === "failed")) {
    compositeStatus = "failed";
  } else if (runs.some((r) => r.status === "aborted")) {
    compositeStatus = "aborted";
  } else if (runs.some((r) => r.status === "denied")) {
    compositeStatus = "denied";
  } else if (runs.some((r) => r.status === "running")) {
    compositeStatus = "running";
  } else if (runs.length === 0) {
    compositeStatus = "unknown";
  }

  const cost =
    aggregatedUsage?.cost !== undefined ? { amount: aggregatedUsage.cost, currency: aggregatedUsage.currency ?? "USD" } : undefined;

  const sessionId = options?.sessionId ?? timelines[0]?.sessionId;

  return Object.freeze({
    ...(sessionId ? { sessionId } : {}),
    runCount: timelines.length,
    durationMs: totalDurationMs,
    turnCount: totalTurnCount,
    toolCallCount: totalToolCallCount,
    toolCounts: capToolCounts(mergedToolCounts),
    providerAttempts: totalProviderAttempts,
    usage: aggregatedUsage,
    cost,
    errorCount: totalErrorCount,
    blockedToolCount: totalBlockedToolCount,
    suspended: anySuspended,
    status: compositeStatus,
    stepCount: totalStepCount,
    runs: Object.freeze(runs),
  });
}
