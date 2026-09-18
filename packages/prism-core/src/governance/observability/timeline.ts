import type {
  AgentEvent,
  AgentEventRecord,
  AgentFinishReason,
  ErrorInfo,
  SecretRedactor,
  ToolCallRecord,
  Usage,
  UsageRecord,
} from "@arnilo/prism";
import { resolveRedactor } from "@arnilo/prism";
import type { WorkflowEvent } from "../../runtime/workflows/types.js";
import type { EvaluationTrace } from "../evals/types.js";
import type {
  ExecutionStep,
  ExecutionStepKind,
  ExecutionStepStatus,
  ExecutionTimeline,
  TimelineContentPolicy,
  TimelineFolder,
  TimelineProjectionOptions,
  WorkflowTimelineFolder,
  WorkflowTimelineProjectionOptions,
} from "./timeline-types.js";

// ─── Limits ───────────────────────────────────────────────────────────────────

const DEFAULT_MAX_STEPS = 1_000;
const HARD_MAX_STEPS = 10_000;
const DEFAULT_MAX_STEP_IO_BYTES = 16 * 1024;
const HARD_MAX_STEP_IO_BYTES = 256 * 1024;

export class TimelineError extends Error {
  readonly code: string;
  constructor(message: string, code = "ERR_PRISM_TIMELINE") {
    super(message);
    this.code = code;
  }
}

function resolveMaxSteps(value: number | undefined): number {
  const v = value ?? DEFAULT_MAX_STEPS;
  if (!Number.isSafeInteger(v) || v < 1 || v > HARD_MAX_STEPS) {
    throw new TimelineError(`maxSteps must be an integer in [1, ${HARD_MAX_STEPS}]`, "ERR_PRISM_TIMELINE_BOUNDS");
  }
  return v;
}

function resolveMaxIoBytes(value: number | undefined): number {
  const v = value ?? DEFAULT_MAX_STEP_IO_BYTES;
  if (!Number.isSafeInteger(v) || v < 1 || v > HARD_MAX_STEP_IO_BYTES) {
    throw new TimelineError(`maxStepIoBytes must be an integer in [1, ${HARD_MAX_STEP_IO_BYTES}]`, "ERR_PRISM_TIMELINE_BOUNDS");
  }
  return v;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface MutableStep {
  id: string;
  parentId?: string;
  kind: ExecutionStepKind;
  name: string;
  order: number;
  status: ExecutionStepStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: ErrorInfo;
  usage?: Usage;
  metadata?: Readonly<Record<string, unknown>>;
}

function durationMs(start: string, end: string): number | undefined {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined;
  const d = e - s;
  return d >= 0 ? d : undefined;
}

function findLastStep(steps: readonly MutableStep[], predicate: (s: MutableStep) => boolean): MutableStep | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s && predicate(s)) return s;
  }
  return undefined;
}

function truncateIo(value: unknown, maxBytes: number): unknown {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value);
  if (json.length <= maxBytes) return value;
  // Truncate the serialized form; return a marker string instead of the original
  return `[truncated: ${json.length} bytes > ${maxBytes}]`;
}

function prepareIo(
  value: unknown,
  content: TimelineContentPolicy,
  redactor: SecretRedactor | undefined,
  maxBytes: number,
): { io: unknown; wasRedacted: boolean } {
  if (content === "metadata") return { io: undefined, wasRedacted: value !== undefined };
  if (value === undefined) return { io: undefined, wasRedacted: false };
  const redacted = redactor ? redactor.redact(value) : value;
  const truncated = truncateIo(redacted, maxBytes);
  return { io: truncated, wasRedacted: truncated !== redacted };
}

function addUsage(total: Usage | undefined, addition: Usage | undefined): Usage | undefined {
  if (!addition) return total;
  if (!total) return { ...addition };
  return {
    inputTokens: (total.inputTokens ?? 0) + (addition.inputTokens ?? 0) || undefined,
    outputTokens: (total.outputTokens ?? 0) + (addition.outputTokens ?? 0) || undefined,
    totalTokens: (total.totalTokens ?? 0) + (addition.totalTokens ?? 0) || undefined,
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (addition.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (total.cacheWriteTokens ?? 0) + (addition.cacheWriteTokens ?? 0) || undefined,
    cost: (total.cost ?? 0) + (addition.cost ?? 0) || undefined,
    currency: total.currency ?? addition.currency,
  };
}

function freezeStep(step: MutableStep): ExecutionStep {
  return Object.freeze({ ...step });
}

function now(): string {
  return new Date().toISOString();
}

// ─── Agent event folding ──────────────────────────────────────────────────────

interface FoldState {
  steps: MutableStep[];
  runStep?: MutableStep;
  currentTurnStep?: MutableStep;
  currentProviderStep?: MutableStep;
  activeTools: Map<string, MutableStep>;
  order: number;
  runId: string;
  sessionId?: string;
  status: string;
  /** Clean-stop taxonomy of the finished run (`agent_finished.finishReason`), when it stopped on a ceiling or host policy. */
  stopReason?: AgentFinishReason;
  /** Host turn-policy stop detail, bounded and redacted at the runtime boundary. */
  stopDetail?: string;
  startedAt: string;
  finishedAt?: string;
  runInput?: unknown;
  runResult?: unknown;
  totalUsage?: Usage;
  anyRedacted: boolean;
  content: TimelineContentPolicy;
  redactor: SecretRedactor | undefined;
  maxSteps: number;
  maxIoBytes: number;
  traceId?: string;
  instrumentation?: { traceId(runId: string): string | undefined };
  // Tool call records indexed by toolCallId for joining on persistence projections.
  toolCallIndex?: Map<string, ToolCallRecord>;
}

function createFoldState(options: TimelineProjectionOptions = {}): FoldState {
  const content = options.content ?? "metadata";
  const redactor = content !== "metadata" ? (options.redactor ?? resolveRedactor(undefined, [])) : undefined;
  return {
    steps: [],
    activeTools: new Map(),
    order: 0,
    runId: "",
    status: "running",
    startedAt: "",
    anyRedacted: content === "metadata",
    content,
    redactor,
    maxSteps: resolveMaxSteps(options.maxSteps),
    maxIoBytes: resolveMaxIoBytes(options.maxStepIoBytes),
    traceId: options.traceId,
    instrumentation: options.instrumentation,
  };
}

function addStep(state: FoldState, step: MutableStep): MutableStep {
  if (state.steps.length >= state.maxSteps) {
    throw new TimelineError(`Timeline exceeded maxSteps (${state.maxSteps})`, "ERR_PRISM_TIMELINE_BOUNDS");
  }
  state.steps.push(step);
  return step;
}

function foldAgentEvent(state: FoldState, event: AgentEvent): void {
  const parentId = (): string | undefined => state.currentTurnStep?.id ?? state.runStep?.id;

  switch (event.type) {
    case "agent_started": {
      state.runId = event.runId;
      state.sessionId = event.sessionId;
      state.startedAt = now();
      state.status = "running";
      const step: MutableStep = {
        id: `run:${event.runId}`,
        kind: "run",
        name: event.runId,
        order: state.order++,
        status: "running",
        startedAt: state.startedAt,
      };
      state.runStep = addStep(state, step);
      return;
    }
    case "agent_finished": {
      if (state.runStep) {
        const finished = now();
        state.runStep.status = "succeeded";
        state.runStep.finishedAt = finished;
        state.runStep.durationMs = durationMs(state.runStep.startedAt, finished);
        state.runStep.usage = event.usage;
      }
      state.totalUsage = addUsage(state.totalUsage, event.usage);
      state.status = event.finishReason ? `finished:${event.finishReason}` : "succeeded";
      state.stopReason = event.finishReason;
      state.stopDetail = event.stopDetail;
      state.finishedAt = now();
      return;
    }
    case "agent_suspended": {
      if (state.runStep) state.runStep.status = "suspended";
      state.status = "suspended";
      addStep(state, {
        id: `hitl:${event.runId}:${state.order}`,
        parentId: state.runStep?.id,
        kind: "hitl",
        name: event.interruption.reason ?? "suspended",
        order: state.order++,
        status: "suspended",
        startedAt: now(),
      });
      return;
    }
    case "agent_resumed": {
      state.status = "running";
      if (state.runStep) state.runStep.status = "running";
      return;
    }
    case "agent_denied": {
      if (state.runStep) state.runStep.status = "denied";
      state.status = "denied";
      state.finishedAt = now();
      return;
    }
    case "turn_started": {
      const step: MutableStep = {
        id: `turn:${event.runId}:${event.turn}`,
        parentId: state.runStep?.id,
        kind: "turn",
        name: `turn-${event.turn}`,
        order: state.order++,
        status: "running",
        startedAt: now(),
        metadata: { turn: event.turn },
      };
      state.currentTurnStep = addStep(state, step);
      return;
    }
    case "turn_finished": {
      if (state.currentTurnStep) {
        const finished = now();
        state.currentTurnStep.status = "succeeded";
        state.currentTurnStep.finishedAt = finished;
        state.currentTurnStep.durationMs = durationMs(state.currentTurnStep.startedAt, finished);
      }
      state.currentTurnStep = undefined;
      state.currentProviderStep = undefined;
      return;
    }
    case "provider_turn_started": {
      const modelName =
        typeof event.metadata.model === "string" ? event.metadata.model : (event.metadata.model as { model?: string } | undefined)?.model;
      const step: MutableStep = {
        id: `provider:${event.runId}:${event.turn}:${event.metadata.attempt ?? 0}`,
        parentId: state.currentTurnStep?.id ?? state.runStep?.id,
        kind: "provider",
        name: modelName ?? event.metadata.providerId ?? "provider",
        order: state.order++,
        status: "running",
        startedAt: now(),
        metadata: {
          providerId: event.metadata.providerId,
          model: event.metadata.model,
          attempt: event.metadata.attempt,
        },
      };
      state.currentProviderStep = addStep(state, step);
      return;
    }
    case "provider_turn_finished": {
      if (state.currentProviderStep) {
        const finished = now();
        state.currentProviderStep.status = event.error ? "failed" : "succeeded";
        state.currentProviderStep.finishedAt = finished;
        state.currentProviderStep.durationMs = durationMs(state.currentProviderStep.startedAt, finished);
        state.currentProviderStep.usage = event.usage;
        if (event.error) state.currentProviderStep.error = event.error;
      }
      state.totalUsage = addUsage(state.totalUsage, event.usage);
      state.currentProviderStep = undefined;
      return;
    }
    case "tool_execution_started": {
      const { io: inputIo, wasRedacted } = prepareIo(event.call.arguments, state.content, state.redactor, state.maxIoBytes);
      if (wasRedacted) state.anyRedacted = true;
      const step: MutableStep = {
        id: `tool:${event.call.id}`,
        parentId: parentId(),
        kind: "tool",
        name: event.call.name,
        order: state.order++,
        status: "running",
        startedAt: now(),
        ...(inputIo !== undefined ? { input: inputIo } : {}),
      };
      state.activeTools.set(event.call.id, step);
      addStep(state, step);
      return;
    }
    case "tool_execution_finished": {
      const toolCallId = event.result?.toolCallId ?? event.result?.name ?? "";
      const step = state.activeTools.get(toolCallId);
      if (step) {
        const finished = now();
        step.status = event.result.error ? "failed" : "succeeded";
        step.finishedAt = finished;
        step.durationMs = durationMs(step.startedAt, finished);
        if (event.result.error) step.error = { message: event.result.error.message ?? String(event.result.error) };
        const { io, wasRedacted } = prepareIo(event.result.value ?? event.result.content, state.content, state.redactor, state.maxIoBytes);
        if (wasRedacted) state.anyRedacted = true;
        if (io !== undefined) step.output = io;
        if (event.metadata) step.metadata = { ...step.metadata, durationMs: event.metadata.durationMs };
        state.activeTools.delete(toolCallId);
      }
      return;
    }
    case "tool_execution_error": {
      const toolCallId = event.call?.id ?? "";
      const step = state.activeTools.get(toolCallId);
      if (step) {
        const finished = now();
        step.status = "failed";
        step.finishedAt = finished;
        step.durationMs = durationMs(step.startedAt, finished);
        step.error = event.error;
        if (event.metadata) step.metadata = { ...step.metadata, durationMs: event.metadata.durationMs };
        state.activeTools.delete(toolCallId);
      } else {
        // No matching start — create a standalone error step.
        addStep(state, {
          id: `tool:${toolCallId || `err-${state.order}`}`,
          parentId: parentId(),
          kind: "tool",
          name: event.call?.name ?? "unknown",
          order: state.order++,
          status: "failed",
          startedAt: now(),
          error: event.error,
        });
      }
      return;
    }
    case "tool_execution_blocked": {
      const step = state.activeTools.get(event.toolCallId);
      if (step) {
        step.status = "blocked";
        step.finishedAt = now();
        step.durationMs = durationMs(step.startedAt, step.finishedAt);
        step.error = event.error;
        step.metadata = { ...step.metadata, reason: event.reason };
        state.activeTools.delete(event.toolCallId);
      } else {
        addStep(state, {
          id: `tool:${event.toolCallId}`,
          parentId: parentId(),
          kind: "tool",
          name: event.name,
          order: state.order++,
          status: "blocked",
          startedAt: now(),
          error: event.error,
          metadata: { reason: event.reason },
        });
      }
      return;
    }
    case "guardrail_decision": {
      addStep(state, {
        id: `guardrail:${event.runId}:${state.order}`,
        parentId: parentId(),
        kind: "guardrail",
        name: event.record.stage ?? event.toolName ?? "guardrail",
        order: state.order++,
        status:
          String(event.record.action) === "deny" || event.record.action === "block" || event.record.action === "tripwire"
            ? "denied"
            : "succeeded",
        startedAt: now(),
        metadata: {
          action: event.record.action,
          ...(event.toolName ? { toolName: event.toolName } : {}),
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
        },
      });
      return;
    }
    case "delegated_agent_step": {
      addStep(state, {
        id: `delegation:${event.adapterId}:${event.stepIndex}`,
        parentId: parentId(),
        kind: "delegation",
        name: event.subagentType ?? event.adapterId,
        order: state.order++,
        status: event.state === "done" ? "succeeded" : event.state === "error" ? "failed" : "running",
        startedAt: now(),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        ...(event.usage
          ? {
              usage: {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                totalTokens: event.usage.totalTokens,
              },
            }
          : {}),
        metadata: {
          adapterId: event.adapterId,
          kind: event.kind,
          ...(event.toolName ? { toolName: event.toolName } : {}),
        },
      });
      return;
    }
    case "compaction_started": {
      addStep(state, {
        id: `compaction:${event.sessionId}:${state.order}`,
        parentId: state.runStep?.id,
        kind: "compaction",
        name: "compaction",
        order: state.order++,
        status: "running",
        startedAt: now(),
      });
      return;
    }
    case "compaction_finished": {
      // Find the running compaction step and close it.
      const compStep = findLastStep(state.steps, (s) => s.kind === "compaction" && s.status === "running");
      if (compStep) {
        compStep.status = "succeeded";
        compStep.finishedAt = now();
        compStep.durationMs = durationMs(compStep.startedAt, compStep.finishedAt);
      }
      return;
    }
    case "attention_compiled": {
      addStep(state, {
        id: `attention:${event.sessionId}:${state.order}`,
        parentId: parentId(),
        kind: "attention",
        name: "attention_compiled",
        order: state.order++,
        status: "succeeded",
        startedAt: now(),
        metadata: {
          used: event.used,
          usedAfter: event.usedAfter,
          inputCap: event.inputCap,
          triggerRatio: event.triggerRatio,
          droppedThinkingTurns: event.droppedThinkingTurns,
          stubbedToolResults: event.stubbedToolResults,
          stubbedBytes: event.stubbedBytes,
          truncated: event.truncated,
        },
      });
      return;
    }
    case "retry_scheduled": {
      addStep(state, {
        id: `retry:${event.runId}:${event.attempt}`,
        parentId: state.runStep?.id,
        kind: "retry",
        name: `retry-${event.attempt}`,
        order: state.order++,
        status: "running",
        startedAt: now(),
        error: event.error,
        metadata: { attempt: event.attempt, delayMs: event.delayMs },
      });
      return;
    }
    case "error": {
      if (state.runStep) state.runStep.status = "failed";
      state.status = "failed";
      state.finishedAt = now();
      return;
    }
    case "artifact_validation_started":
    case "artifact_validation_finished":
    case "artifact_revision_started":
    case "artifact_finished":
    case "artifact_failed": {
      const isTerminal = event.type === "artifact_finished" || event.type === "artifact_failed";
      addStep(state, {
        id: `artifact:${event.runId}:${event.turn}:${event.attempt}:${event.type}`,
        parentId: parentId(),
        kind: "artifact",
        name: event.type,
        order: state.order++,
        status: event.type === "artifact_failed" ? "failed" : isTerminal ? "succeeded" : "running",
        startedAt: now(),
        metadata: { turn: event.turn, attempt: event.attempt },
      });
      return;
    }
    // Events that do not produce timeline steps — ignored, never thrown.
    case "message_started":
    case "message_delta":
    case "message_finished":
    case "tool_execution_progress":
    case "run_limit_exceeded":
    case "queue_updated":
    case "steer_rejected":
    case "event_subscriber_overflow":
      return;
    default:
      // Unknown future event types are silently ignored per spec.
      return;
  }
}

function buildTimeline(state: FoldState): ExecutionTimeline {
  const resolvedTraceId = state.traceId ?? (state.instrumentation && state.runId ? state.instrumentation.traceId(state.runId) : undefined);
  return Object.freeze({
    schemaVersion: 1 as const,
    runId: state.runId,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(resolvedTraceId ? { traceId: resolvedTraceId } : {}),
    status: state.status,
    ...(state.stopReason ? { stopReason: state.stopReason } : {}),
    ...(state.stopDetail ? { stopDetail: state.stopDetail } : {}),
    startedAt: state.startedAt || now(),
    ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
    ...(state.runInput !== undefined ? { input: state.runInput } : {}),
    ...(state.runResult !== undefined ? { result: state.runResult } : {}),
    ...(state.totalUsage ? { usage: state.totalUsage } : {}),
    steps: Object.freeze(state.steps.map(freezeStep)),
    redacted: state.anyRedacted,
    content: state.content,
  });
}

// ─── Persistence trace folding (offline) ──────────────────────────────────────

/**
 * Fold an `EvaluationTrace` (from `createPersistenceTraceResolver`) into a
 * frozen `ExecutionTimeline`. Deterministic for the same trace inputs.
 */
function foldTraceEvents(
  state: FoldState,
  events: readonly AgentEventRecord[],
  toolCalls: readonly ToolCallRecord[],
  usageRecords: readonly UsageRecord[],
): void {
  // Build tool-call index for joining results by toolCallId.
  state.toolCallIndex = new Map();
  for (const tc of toolCalls) {
    if (tc.toolCallId) state.toolCallIndex.set(tc.toolCallId, tc);
  }

  // Sort events by sequence (persistence order).
  const sorted = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  for (const record of sorted) {
    const event = record.event as AgentEvent;
    if (!event?.type) continue;
    foldAgentEvent(state, event);
  }

  // Accumulate usage from separate usage records when not already captured from events.
  for (const ur of usageRecords) {
    if (ur.scope === "run_total") {
      state.totalUsage = addUsage(state.totalUsage, ur.usage);
    }
  }
}

// ─── Public projectors ────────────────────────────────────────────────────────

/**
 * Project a live `AgentEvent` stream into a frozen `ExecutionTimeline`.
 * Caller passes all events from a run; the projector folds them in order.
 */
export function projectAgentTimeline(events: readonly AgentEvent[], options: TimelineProjectionOptions = {}): ExecutionTimeline {
  const state = createFoldState(options);
  for (const event of events) {
    foldAgentEvent(state, event);
  }
  return buildTimeline(state);
}

/**
 * Project an `EvaluationTrace` (from persistence) into a frozen
 * `ExecutionTimeline`. The trace's events, tool calls, and usage records are
 * joined to reconstruct the ordered step sequence.
 */
export function projectTraceTimeline(trace: EvaluationTrace, options: TimelineProjectionOptions = {}): ExecutionTimeline {
  const state = createFoldState(options);
  // Use the run record for top-level metadata.
  state.runId = trace.run.id;
  state.sessionId = trace.run.sessionId;
  state.startedAt = trace.run.startedAt ?? now();
  state.finishedAt = trace.run.finishedAt;
  state.status = trace.run.status ?? "unknown";

  foldTraceEvents(state, trace.events, trace.toolCalls, trace.usage);

  return buildTimeline(state);
}

/**
 * Project `WorkflowEvent[]` (optionally with a checkpoint) into a frozen
 * `ExecutionTimeline`. Workflow node outputs appear only when a checkpoint is
 * provided and the content policy allows I/O.
 */
export function projectWorkflowTimeline(
  events: readonly WorkflowEvent[],
  options: WorkflowTimelineProjectionOptions = {},
): ExecutionTimeline {
  const state = createFoldState(options);
  const checkpoint = options.checkpoint;
  const content = options.content ?? "metadata";
  const redactor = content !== "metadata" ? (options.redactor ?? resolveRedactor(undefined, [])) : undefined;

  // Sort by sequence for deterministic order.
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

  // Track workflow-node steps by nodeId.
  const nodeSteps = new Map<string, MutableStep>();

  for (const event of sorted) {
    switch (event.type) {
      case "workflow_started": {
        state.runId = event.runId;
        state.startedAt = event.timestamp;
        state.status = "running";
        // Use workflowInput from checkpoint if available.
        if (checkpoint?.workflowInput !== undefined && content !== "metadata") {
          const { io, wasRedacted } = prepareIo(checkpoint.workflowInput, content, redactor, state.maxIoBytes);
          state.runInput = io;
          if (wasRedacted) state.anyRedacted = true;
        }
        break;
      }
      case "workflow_finished": {
        state.status = event.status;
        state.finishedAt = event.timestamp;
        break;
      }
      case "workflow_suspended": {
        state.status = "suspended";
        addStep(state, {
          id: `hitl:${event.runId}:${state.order}`,
          kind: "hitl",
          name: event.suspension.reason ?? "suspended",
          order: state.order++,
          status: "suspended",
          startedAt: event.timestamp,
        });
        break;
      }
      case "workflow_resumed": {
        state.status = "running";
        break;
      }
      case "node_started": {
        const step: MutableStep = {
          id: `wfnode:${event.nodeId}`,
          kind: "workflow_node",
          name: event.nodeId,
          order: state.order++,
          status: "running",
          startedAt: event.timestamp,
        };
        nodeSteps.set(event.nodeId, step);
        addStep(state, step);
        break;
      }
      case "node_finished": {
        const step = nodeSteps.get(event.nodeId);
        if (step) {
          step.status = "succeeded";
          step.finishedAt = event.timestamp;
          step.durationMs = durationMs(step.startedAt, event.timestamp);
          // Join checkpoint output if available.
          if (checkpoint) {
            const nodeCheckpoint = checkpoint.nodes[event.nodeId];
            if (nodeCheckpoint?.output !== undefined) {
              const { io, wasRedacted } = prepareIo(nodeCheckpoint.output, content, redactor, state.maxIoBytes);
              if (wasRedacted) state.anyRedacted = true;
              if (io !== undefined) step.output = io;
            }
          }
        }
        break;
      }
      case "node_failed": {
        const step = nodeSteps.get(event.nodeId);
        if (step) {
          step.status = "failed";
          step.finishedAt = event.timestamp;
          step.durationMs = durationMs(step.startedAt, event.timestamp);
          step.error = event.error;
        }
        break;
      }
      case "node_skipped": {
        const step = nodeSteps.get(event.nodeId);
        if (step) {
          step.status = "skipped";
          step.finishedAt = event.timestamp;
          if (event.reason) step.metadata = { ...step.metadata, skippedReason: event.reason };
        } else {
          // Skipped without a start event (conditional prune).
          addStep(state, {
            id: `wfnode:${event.nodeId}`,
            kind: "workflow_node",
            name: event.nodeId,
            order: state.order++,
            status: "skipped",
            startedAt: event.timestamp,
            ...(event.reason ? { metadata: { skippedReason: event.reason } } : {}),
          });
        }
        break;
      }
      case "node_iteration_started": {
        const parentStep = nodeSteps.get(event.nodeId);
        addStep(state, {
          id: `wfiter:${event.nodeId}:${event.iteration}`,
          parentId: parentStep?.id,
          kind: "loop_iteration",
          name: `${event.nodeId}:iter-${event.iteration}`,
          order: state.order++,
          status: "running",
          startedAt: event.timestamp,
          metadata: { iteration: event.iteration },
        });
        break;
      }
      case "node_iteration_finished": {
        const iterStep = findLastStep(
          state.steps,
          (s) => s.kind === "loop_iteration" && s.name === `${event.nodeId}:iter-${event.iteration}`,
        );
        if (iterStep) {
          iterStep.status = "succeeded";
          iterStep.finishedAt = event.timestamp;
          iterStep.durationMs = durationMs(iterStep.startedAt, event.timestamp);
          if (event.output !== undefined) {
            const { io, wasRedacted } = prepareIo(event.output, content, redactor, state.maxIoBytes);
            if (wasRedacted) state.anyRedacted = true;
            if (io !== undefined) iterStep.output = io;
          }
          if (event.done) iterStep.metadata = { ...iterStep.metadata, done: true };
        }
        break;
      }
      case "agent_event": {
        // Delegate to agent event folder with the node step as parent.
        const parentStep = nodeSteps.get(event.nodeId);
        const prevTurn = state.currentTurnStep;
        const prevRun = state.runStep;
        // Temporarily set the run step to the node step so children nest correctly.
        state.runStep = parentStep;
        foldAgentEvent(state, event.event);
        state.runStep = prevRun;
        state.currentTurnStep = prevTurn;
        break;
      }
      case "checkpoint_saved":
      case "workflow_event_overflow":
        // Not timeline-visible.
        break;
      default:
        // Unknown future workflow event types — silently ignored.
        break;
    }
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    runId: state.runId,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(checkpoint ? { workflowId: checkpoint.workflowId } : {}),
    ...(checkpoint ? { workflowRevision: checkpoint.definitionHash } : {}),
    ...((state.traceId ?? (state.instrumentation && state.runId ? state.instrumentation.traceId(state.runId) : undefined))
      ? { traceId: state.traceId ?? (state.instrumentation && state.runId ? state.instrumentation.traceId(state.runId) : undefined) }
      : {}),
    status: state.status,
    startedAt: state.startedAt || now(),
    ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
    ...(state.runInput !== undefined ? { input: state.runInput } : {}),
    ...(state.runResult !== undefined ? { result: state.runResult } : {}),
    ...(state.totalUsage ? { usage: state.totalUsage } : {}),
    steps: Object.freeze(state.steps.map(freezeStep)),
    redacted: state.anyRedacted,
    content: state.content,
  });
}

// ─── Incremental folder ───────────────────────────────────────────────────────

/**
 * Create an incremental timeline folder. Push events one at a time for live
 * SSE/cockpit use; call `snapshot()` to get a frozen `ExecutionTimeline`.
 */
export function createTimelineFolder(options: TimelineProjectionOptions = {}): TimelineFolder {
  const state = createFoldState(options);
  return {
    push(event: unknown): void {
      if (!event || typeof event !== "object" || !("type" in event)) return;
      foldAgentEvent(state, event as AgentEvent);
    },
    snapshot(): ExecutionTimeline {
      return buildTimeline(state);
    },
  };
}

/**
 * Create an incremental workflow timeline folder. Push `WorkflowEvent`s one at
 * a time; call `snapshot()` for the current frozen `ExecutionTimeline`.
 */
export function createWorkflowTimelineFolder(options: WorkflowTimelineProjectionOptions = {}): WorkflowTimelineFolder {
  const allEvents: WorkflowEvent[] = [];
  return {
    push(event: WorkflowEvent): void {
      allEvents.push(event);
    },
    snapshot(): ExecutionTimeline {
      return projectWorkflowTimeline(allEvents, options);
    },
  };
}
