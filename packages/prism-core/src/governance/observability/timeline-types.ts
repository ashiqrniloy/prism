import type { AgentFinishReason, ErrorInfo, SecretRedactor, Usage } from "@arnilo/prism";
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

// ─── ExecutionTimeline ────────────────────────────────────────────────────────

export interface ExecutionTimeline {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly workflowRevision?: string;
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
  /** Flat ordered step array. Tree via parentId. */
  readonly steps: readonly ExecutionStep[];
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
