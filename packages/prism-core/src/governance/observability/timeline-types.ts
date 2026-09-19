import type {
  AgentFinishReason,
  BudgetAxisUsage,
  BudgetConsumedCounters,
  ErrorInfo,
  ProviderStopReason,
  RunLimitName,
  TurnBudgets,
  SecretRedactor,
  ToolCallSummary,
  Usage,
} from "@arnilo/prism";
import type { WorkflowCheckpointValue, WorkflowEvent } from "../../runtime/workflows/types.js";

// ─── Content-capture policy ───────────────────────────────────────────────────

/**
 * Controls what I/O content appears on timeline steps.
 *
 * - `"metadata"` (default): kinds, names, status, timings, usage, error codes.
 *   No prompts, tool args, tool results, node payloads.
 * - `"redacted_io"`: input/output after `SecretRedactor`, byte-capped per step.
 * - `"full_io"`: redactor still runs (secrets never pass); host accepts residual
 *   prompt/tool content for replay debugging.
 */
export type TimelineContentPolicy = "metadata" | "redacted_io" | "full_io";

// ─── Step kinds ───────────────────────────────────────────────────────────────

export type ExecutionStepKind =
  | "run"
  | "turn"
  | "deterministic"
  | "provider"
  | "tool"
  | "guardrail"
  | "delegation"
  | "compaction"
  | "attention"
  | "retry"
  | "hitl"
  | "artifact"
  | "workflow_node"
  | "loop_iteration"
  | "nested_workflow";

export type ExecutionStepStatus = "running" | "succeeded" | "failed" | "blocked" | "skipped" | "suspended" | "denied" | "aborted";

// ─── ExecutionStep ────────────────────────────────────────────────────────────

export interface ExecutionStep {
  readonly id: string;
  readonly parentId?: string;
  readonly kind: ExecutionStepKind;
  /** Tool name, model id, node id, guardrail stage, etc. */
  readonly name: string;
  /** Stable emission-order index, 0-based. */
  readonly order: number;
  readonly status: ExecutionStepStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  /** Omitted unless content policy allows. */
  readonly input?: unknown;
  /** Omitted unless content policy allows. */
  readonly output?: unknown;
  readonly error?: ErrorInfo;
  readonly usage?: Usage;
  /** Low-cardinality operational metadata only. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─── Per-turn trace + limit attribution ───────────────────────────────────────

/**
 * One entry per `turn` step: turn number, timing, provider attempts, cache hit rate, budget snapshot,
 * and the stop reason of the last provider attempt (`provider_turn_finished` metadata).
 */
export interface TimelineTurn {
  readonly turn: number;
  readonly status: ExecutionStepStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  /** Provider attempts folded into this turn, retries included. */
  readonly providerAttempts: number;
  /** Cache reads ÷ input tokens across this turn's provider attempts; absent when cache usage is unknown. */
  readonly cacheHitRate?: number;
  /** Last provider attempt's recorded O(1) run-budget snapshot; absent on legacy events. */
  readonly budgets?: TurnBudgets;
  readonly stopReason?: ProviderStopReason;
}

/**
 * Terminal limit attribution (plan 087 T2), joined from `run_limit_exceeded` (`maximum`/`observed`)
 * and `budget_exhausted` (`consumed`, `closestOtherAxes`, `recentToolCalls`). Present only when the
 * run died on a run limit; `consumed` and the axes are absent on traces that only recorded the
 * breach.
 */
export interface TimelineExhaustion {
  readonly limit: RunLimitName;
  readonly maximum?: number;
  readonly observed?: number;
  readonly currency?: string;
  readonly consumed?: BudgetConsumedCounters;
  /** Other finite product axes by closeness to their cap, highest `used / cap` first. */
  readonly closestOtherAxes: readonly BudgetAxisUsage[];
  /** Last dispatched host tool calls (id + name + `sha256:` argument hash), newest last. */
  readonly recentToolCalls: readonly ToolCallSummary[];
}

// ─── ExecutionTimeline ────────────────────────────────────────────────────────

export interface ExecutionTimeline {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly workflowRevision?: string;
  /** Workflow checkpoint sidecar metadata (`WorkflowCheckpointValue.metadata`), present only when projected with a checkpoint. */
  readonly workflowMetadata?: Readonly<Record<string, unknown>>;
  readonly traceId?: string;
  readonly status: string;
  /** Clean-stop taxonomy when the run stopped on a ceiling or host turn policy (`agent_finished.finishReason`). */
  readonly stopReason?: AgentFinishReason;
  /** Host turn-policy stop detail, bounded and redacted at the runtime boundary. */
  readonly stopDetail?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  /** Run-level input, present only under non-metadata content policy. */
  readonly input?: unknown;
  /** Run-level result, present only under non-metadata content policy. */
  readonly result?: unknown;
  /** Aggregated run-total usage. */
  readonly usage?: Usage;
  /** Cache reads ÷ input tokens across all provider attempts; absent when cache usage is unknown. */
  readonly cacheHitRate?: number;
  /** Flat ordered step array. Tree via parentId. */
  readonly steps: readonly ExecutionStep[];
  /** Per-turn trace (turn number, timing, attempts, stop reason); absent for workflow timelines. */
  readonly turns?: readonly TimelineTurn[];
  /** Terminal limit attribution, present only when the run died on a run limit. */
  readonly exhaustion?: TimelineExhaustion;
  /** True when at least one step's I/O was omitted due to policy or oversize. */
  readonly redacted: boolean;
  readonly content: TimelineContentPolicy;
}

// ─── Projector options ────────────────────────────────────────────────────────

export interface TimelineProjectionOptions {
  /** Content-capture policy. Default `"metadata"`. */
  readonly content?: TimelineContentPolicy;
  /** Secret redactor; required when content is not `"metadata"`. */
  readonly redactor?: SecretRedactor;
  /** Maximum steps before the projector fails closed. Default 1,000; hard 10,000. */
  readonly maxSteps?: number;
  /** Maximum bytes per step I/O field. Default 16,384; hard 262,144. */
  readonly maxStepIoBytes?: number;
  /** Optional OTel trace ID to attach to the timeline. */
  readonly traceId?: string;
  /** Optional instrumentation handle to resolve traceId from onTraceReference/runId. */
  readonly instrumentation?: { traceId(runId: string): string | undefined };
}

export interface WorkflowTimelineProjectionOptions extends TimelineProjectionOptions {
  /** Optional checkpoint to join node outputs from. */
  readonly checkpoint?: WorkflowCheckpointValue;
}

// ─── Incremental folder ───────────────────────────────────────────────────────

export interface TimelineFolder {
  /** Push a single agent event into the folder. Unknown event types are ignored. */
  push(event: unknown): void;
  /** Return a frozen snapshot of the current timeline. */
  snapshot(): ExecutionTimeline;
}

export interface WorkflowTimelineFolder {
  /** Push a single workflow event. `agent_event` children are delegated internally. */
  push(event: WorkflowEvent): void;
  /** Return a frozen snapshot of the current timeline. */
  snapshot(): ExecutionTimeline;
}
