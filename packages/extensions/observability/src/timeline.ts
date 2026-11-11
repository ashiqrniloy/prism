import type {
  AgentEvent,
  AgentEventRecord,
  AgentFinishReason,
  BudgetAxisUsage,
  BudgetConsumedCounters,
  CheckpointRestoreAudit,
  ErrorInfo,
  EventOrigin,
  ProviderStopReason,
  RunLimitBreach,
  RunLimitName,
  SecretRedactor,
  ToolCallRecord,
  ToolCallSummary,
  TurnBudgets,
  Usage,
  UsageRecord,
} from "@arnilo/prism";
import { resolveRedactor } from "@arnilo/prism";
import { cacheUsageReport } from "@arnilo/prism/provider-kit";
import { ORIGIN_ATTRIBUTES, originAttributes } from "./origin.js";
import type { WorkflowEvent } from "@arnilo/prism-extensions/workflows";
import type { EvaluationTrace } from "@arnilo/prism-hosts/evals";
import type {
  ExecutionStep,
  ExecutionStepKind,
  ExecutionStepStatus,
  ExecutionTimeline,
  TimelineContentPolicy,
  TimelineExhaustion,
  TimelineFolder,
  TimelineProjectionOptions,
  StepOrigin,
  TimelineOriginGroup,
  TimelineTurn,
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
  origin?: StepOrigin;
  metadata?: Readonly<Record<string, unknown>>;
}

/** Close the open turn step when the next turn opens or the run ends. */
function closeTurnStep(state: { currentTurnStep?: MutableStep }): void {
  const step = state.currentTurnStep;
  if (step?.status !== "running") return;
  const finished = new Date().toISOString();
  step.status = "succeeded";
  step.finishedAt = finished;
  step.durationMs = durationMs(step.startedAt, finished);
  state.currentTurnStep = undefined;
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
  /** Approval steps by `toolCallId`, so `decision.resolved` can settle the step `run.suspended` opened. */
  decisionSteps: Map<string, MutableStep>;
  order: number;
  runId: string;
  sessionId?: string;
  status: string;
  /** Clean-stop taxonomy of the finished run (`agent_finished.finishReason`), when it stopped on a ceiling or host policy. */
  stopReason?: AgentFinishReason;
  /** Host turn-policy stop detail, bounded and redacted at the runtime boundary. */
  stopDetail?: string;
  /** Restore-hook audit published by the claiming resume event (plan 094 Task 3); absent when no hooks ran. */
  restore?: CheckpointRestoreAudit;
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
  // Terminal limit breach (`run_limit_exceeded`) and attribution payload (`budget_exhausted`).
  breach?: RunLimitBreach;
  attribution?: {
    limit: RunLimitName;
    consumed: BudgetConsumedCounters;
    closestOtherAxes: readonly BudgetAxisUsage[];
    recentToolCalls: readonly ToolCallSummary[];
  };
  /** Origin of the event being folded; stamped on every step it adds. */
  currentOrigin?: StepOrigin;
  // Tool call records indexed by toolCallId for joining on persistence projections.
  toolCallIndex?: Map<string, ToolCallRecord>;
}

function createFoldState(options: TimelineProjectionOptions = {}): FoldState {
  const content = options.content ?? "metadata";
  const redactor = content !== "metadata" ? (options.redactor ?? resolveRedactor(undefined, [])) : undefined;
  return {
    steps: [],
    activeTools: new Map(),
    decisionSteps: new Map(),
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
  if (state.currentOrigin && !step.origin) step.origin = state.currentOrigin;
  state.steps.push(step);
  return step;
}

function stepOrigin(origin: EventOrigin | undefined): StepOrigin | undefined {
  if (!origin) return undefined;
  const executedBy = origin.executedBy ?? (origin.kind === "external" ? "external" : "prism");
  const attrs = originAttributes(origin);
  return {
    agent: attrs[ORIGIN_ATTRIBUTES.agent] ?? "",
    ...(attrs[ORIGIN_ATTRIBUTES.vendor] ? { vendor: attrs[ORIGIN_ATTRIBUTES.vendor] } : {}),
    ...(attrs[ORIGIN_ATTRIBUTES.profile] ? { profile: attrs[ORIGIN_ATTRIBUTES.profile] } : {}),
    ...(attrs[ORIGIN_ATTRIBUTES.subagentId] ? { subagentId: attrs[ORIGIN_ATTRIBUTES.subagentId] } : {}),
    executedBy,
    observed: executedBy === "external",
  };
}

/** Groups steps by agent, then sub-agent, in first-seen order. */
function groupByOrigin(steps: readonly MutableStep[]): readonly TimelineOriginGroup[] | undefined {
  const groups = new Map<string, { origin: StepOrigin; stepIds: string[] }>();
  for (const step of steps) {
    if (!step.origin) continue;
    const id = `${step.origin.agent}\u0000${step.origin.subagentId ?? ""}`;
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { origin: step.origin, stepIds: [] }));
    group.stepIds.push(step.id);
  }
  if (groups.size === 0) return undefined;
  const ordered = [...groups.values()].sort(
    (a, b) => a.origin.agent.localeCompare(b.origin.agent) || (a.origin.subagentId ? 1 : 0) - (b.origin.subagentId ? 1 : 0),
  );
  return ordered.map(({ origin, stepIds }) => Object.freeze({ ...origin, stepIds: Object.freeze(stepIds) }));
}

function foldAgentEvent(state: FoldState, event: AgentEvent): void {
  state.currentOrigin = stepOrigin(event.origin);
  const parentId = (): string | undefined => state.currentTurnStep?.id ?? state.runStep?.id;

  switch (event.type) {
    case "run.started": {
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
      // A durable resume re-opens the run and carries the restore audit.
      if (event.resumed) {
        if (event.restore) state.restore = event.restore;
      }
      return;
    }
    case "run.completed": {
      closeTurnStep(state);
      if (state.runStep) {
        const finished = now();
        state.runStep.status = "succeeded";
        state.runStep.finishedAt = finished;
        state.runStep.durationMs = durationMs(state.runStep.startedAt, finished);
        state.runStep.usage = event.usage;
      }
      state.totalUsage = addUsage(state.totalUsage, event.usage);
      state.status = event.stopReason ? `finished:${event.stopReason}` : "succeeded";
      state.stopReason = event.stopReason;
      state.stopDetail = event.stopDetail;
      state.finishedAt = now();
      return;
    }
    case "run.suspended": {
      closeTurnStep(state);
      if (state.runStep) state.runStep.status = "suspended";
      state.status = "suspended";
      const interruption = event.interruption;
      const pending = interruption.pendingDecisions ?? [];
      if (!pending.some((decision) => decision.toolCallId)) {
        addStep(state, {
          id: `hitl:${event.runId}:${state.order}`,
          parentId: state.runStep?.id,
          kind: "hitl",
          name: interruption.reason ?? "suspended",
          order: state.order++,
          status: "suspended",
          startedAt: now(),
        });
        return;
      }
      // One step per gated call, keyed by `toolCallId` so the settled decision lands on it.
      for (const decision of pending) {
        const toolCallId = decision.toolCallId;
        if (!toolCallId) continue;
        const toolName = decision.scope.toolName ?? interruption.toolName;
        const guardrail = decision.guardrail ?? interruption.guardrail;
        const step = addStep(state, {
          id: `hitl:${event.runId}:${state.order}`,
          parentId: state.runStep?.id,
          kind: "hitl",
          name: toolName ?? interruption.reason ?? "suspended",
          order: state.order++,
          status: "suspended",
          startedAt: now(),
          metadata: {
            toolCallId,
            approvalId: decision.approvalId,
            ...(toolName ? { toolName } : {}),
            ...(guardrail ? { guardrail } : {}),
          },
        });
        state.decisionSteps.set(toolCallId, step);
      }
      return;
    }
    case "decision.resolved": {
      if (state.runStep) state.runStep.status = "succeeded";
      const finished = now();
      for (const decision of event.decisions) {
        const status = decision.outcome === "allow" ? "approved" : "denied";
        const step = state.decisionSteps.get(decision.toolCallId);
        if (!step) {
          // Inline (and durable-resume) decisions settle before this timeline saw the suspension.
          addStep(state, {
            id: `hitl:${event.runId}:${state.order}`,
            parentId: state.runStep?.id,
            kind: "hitl",
            name: "approval",
            order: state.order++,
            status,
            startedAt: finished,
            finishedAt: finished,
            durationMs: 0,
            metadata: { toolCallId: decision.toolCallId, via: event.via },
          });
          continue;
        }
        step.status = status;
        step.finishedAt = finished;
        step.durationMs = durationMs(step.startedAt, finished);
        step.metadata = { ...step.metadata, via: event.via };
      }
      return;
    }
    case "turn.started": {
      // The loop's own start opens the turn step; a provider attempt carries `metadata` and opens
      // the chat step under it. The turn step is opened lazily here (the loop no longer emits a
      // separate turn event) and closed when the next turn opens or the run ends.
      if (!state.currentTurnStep || state.currentTurnStep.metadata?.turn !== event.turn) {
        closeTurnStep(state);
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
      }
      const metadata = event.metadata;
      const modelName = typeof metadata.model === "string" ? metadata.model : (metadata.model as { model?: string } | undefined)?.model;
      const step: MutableStep = {
        id: `provider:${event.runId}:${event.turn}:${metadata.attempt ?? 0}`,
        parentId: state.currentTurnStep?.id ?? state.runStep?.id,
        kind: "provider",
        name: modelName ?? metadata.providerId ?? "provider",
        order: state.order++,
        status: "running",
        startedAt: now(),
        metadata: {
          providerId: metadata.providerId,
          model: metadata.model,
          attempt: metadata.attempt,
          ...(event.retry ? { attempt: event.attempt, delayMs: event.retry.delayMs } : {}),
        },
        ...(event.retry ? { error: event.retry.error } : {}),
      };
      state.currentProviderStep = addStep(state, step);
      return;
    }
    case "turn.completed": {
      if (event.metadata && state.currentProviderStep) {
        const metadata = event.metadata;
        const finished = now();
        state.currentProviderStep.status = event.error ? "failed" : "succeeded";
        state.currentProviderStep.finishedAt = finished;
        state.currentProviderStep.durationMs = durationMs(state.currentProviderStep.startedAt, finished);
        state.currentProviderStep.usage = event.usage;
        if (metadata.stopReason || metadata.budgets || metadata.cache) {
          state.currentProviderStep.metadata = {
            ...state.currentProviderStep.metadata,
            ...(metadata.stopReason ? { stopReason: metadata.stopReason } : {}),
            ...(metadata.budgets ? { budgets: metadata.budgets } : {}),
            ...(metadata.cache ? { cache: metadata.cache } : {}),
          };
        }
        if (event.error) state.currentProviderStep.error = event.error;
      } else if (state.currentTurnStep) {
        const finished = now();
        state.currentTurnStep.status = "succeeded";
        state.currentTurnStep.finishedAt = finished;
        state.currentTurnStep.durationMs = durationMs(state.currentTurnStep.startedAt, finished);
      }
      state.totalUsage = addUsage(state.totalUsage, event.usage);
      state.currentProviderStep = undefined;
      if (!event.metadata) state.currentTurnStep = undefined;
      return;
    }
    case "tool.started": {
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
    case "tool.completed": {
      const toolCallId = event.toolCallId || event.result?.toolCallId || event.result?.name || "";
      const step = state.activeTools.get(toolCallId);
      const failed = event.status === "error" || Boolean(event.error) || Boolean(event.result?.error);
      const blocked = event.status === "blocked";
      if (step) {
        const finished = now();
        step.status = blocked ? "blocked" : failed ? "failed" : "succeeded";
        step.finishedAt = finished;
        step.durationMs = durationMs(step.startedAt, finished);
        if (event.error) step.error = event.error;
        if (blocked) step.metadata = { ...step.metadata, ...(event.reason ? { reason: event.reason } : {}) };
        else {
          const { io, wasRedacted } = prepareIo(
            event.result?.value ?? event.result?.content,
            state.content,
            state.redactor,
            state.maxIoBytes,
          );
          if (wasRedacted) state.anyRedacted = true;
          if (io !== undefined) step.output = io;
        }
        step.metadata = { ...step.metadata, durationMs: event.metadata.durationMs };
        state.activeTools.delete(toolCallId);
      } else {
        // No matching start — create a standalone outcome step.
        addStep(state, {
          id: `tool:${toolCallId || `err-${state.order}`}`,
          parentId: parentId(),
          kind: "tool",
          name: event.name ?? "unknown",
          order: state.order++,
          status: blocked ? "blocked" : failed ? "failed" : "succeeded",
          startedAt: now(),
          ...(event.error ? { error: event.error } : {}),
          ...(blocked && event.reason ? { metadata: { reason: event.reason } } : {}),
        });
      }
      return;
    }
    case "package.event": {
      // Kernel modules ride `package.event` until their owning phase names them.
      if (event.name === "guardrail.decision") {
        const data = event.data as
          | { record?: { stage?: string; action?: string; guardrail?: unknown }; toolName?: string; toolCallId?: string }
          | undefined;
        const record = data?.record ?? {};
        addStep(state, {
          id: `guardrail:${event.runId}:${state.order}`,
          parentId: parentId(),
          kind: "guardrail",
          name: record.stage ?? data?.toolName ?? "guardrail",
          order: state.order++,
          status: String(record.action) === "deny" || record.action === "block" || record.action === "tripwire" ? "denied" : "succeeded",
          startedAt: now(),
          metadata: {
            action: record.action ?? "unknown",
            // Rule identity only: `metadata` stays low-cardinality, so the free-text reason is not projected (plan 092 T1).
            ...(typeof record.guardrail === "string" ? { guardrail: record.guardrail } : {}),
            ...(data?.toolName ? { toolName: data.toolName } : {}),
            ...(data?.toolCallId ? { toolCallId: data.toolCallId } : {}),
          },
        });
        return;
      }
      if (event.name === "agent.step") {
        const data = event.data as
          | {
              adapterId?: string;
              stepIndex?: number;
              subagentType?: string;
              state?: string;
              durationMs?: number;
              usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
              kind?: string;
              toolName?: string;
            }
          | undefined;
        addStep(state, {
          id: `delegation:${data?.adapterId ?? "unknown"}:${data?.stepIndex ?? 0}`,
          parentId: parentId(),
          kind: "delegation",
          name: data?.subagentType ?? data?.adapterId ?? "delegation",
          order: state.order++,
          status: data?.state === "done" ? "succeeded" : data?.state === "error" ? "failed" : "running",
          startedAt: now(),
          ...(data?.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
          ...(data?.usage
            ? {
                usage: {
                  inputTokens: data.usage.inputTokens,
                  outputTokens: data.usage.outputTokens,
                  totalTokens: data.usage.totalTokens,
                },
              }
            : {}),
          metadata: {
            adapterId: data?.adapterId ?? "unknown",
            kind: data?.kind ?? "unknown",
            ...(data?.toolName ? { toolName: data.toolName } : {}),
          },
        });
        return;
      }
      if (event.name === "attention.compiled") {
        const data = event.data as Record<string, number | boolean> | undefined;
        addStep(state, {
          id: `attention:${event.sessionId}:${state.order}`,
          parentId: parentId(),
          kind: "attention",
          name: "attention.compiled",
          order: state.order++,
          status: "succeeded",
          startedAt: now(),
          metadata: { ...data },
        });
        return;
      }
      return;
    }
    case "compaction.started": {
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
    case "compaction.completed": {
      // Find the running compaction step and close it.
      const compStep = findLastStep(state.steps, (s) => s.kind === "compaction" && s.status === "running");
      if (compStep) {
        compStep.status = "succeeded";
        compStep.finishedAt = now();
        compStep.durationMs = durationMs(compStep.startedAt, compStep.finishedAt);
      }
      return;
    }
    case "run.failed": {
      closeTurnStep(state);
      if (state.runStep) state.runStep.status = "failed";
      state.status = "failed";
      state.finishedAt = now();
      if (event.limit) state.breach = event.limit;
      if (event.attribution) {
        state.attribution = {
          limit: event.limit?.limit ?? "maxTurns",
          consumed: event.attribution.consumed,
          closestOtherAxes: event.attribution.closestOtherAxes,
          recentToolCalls: event.attribution.recentToolCalls,
        };
      }
      return;
    }
    // Events that do not produce timeline steps — ignored, never thrown.
    case "message.delta":
    case "message.completed":
    case "tool.progress":
    case "decision.pending":
      return;
    default:
      // Unknown future event types are silently ignored per spec.
      return;
  }
}

interface MutableTurn {
  turn: number;
  status: ExecutionStepStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  providerAttempts: number;
  budgets?: TurnBudgets;
  stopReason?: ProviderStopReason;
  usage?: Usage;
}

/** Derive the per-turn trace from folded provider steps in one O(steps) pass. */
function projectTurns(steps: readonly MutableStep[]): readonly TimelineTurn[] {
  const index = new Map<string, MutableTurn>();
  const turns: MutableTurn[] = [];
  for (const step of steps) {
    if (step.kind === "turn") {
      const entry: MutableTurn = {
        turn: typeof step.metadata?.turn === "number" ? step.metadata.turn : turns.length + 1,
        status: step.status,
        startedAt: step.startedAt,
        providerAttempts: 0,
      };
      if (step.finishedAt !== undefined) entry.finishedAt = step.finishedAt;
      if (step.durationMs !== undefined) entry.durationMs = step.durationMs;
      index.set(step.id, entry);
      turns.push(entry);
      continue;
    }
    if (step.kind !== "provider" || !step.parentId) continue;
    const parent = index.get(step.parentId);
    if (!parent) continue;
    parent.providerAttempts += 1;
    parent.usage = addUsage(parent.usage, step.usage);
    const reason = step.metadata?.stopReason;
    if (typeof reason === "string") parent.stopReason = reason as ProviderStopReason;
    if (step.metadata?.budgets) parent.budgets = step.metadata.budgets as TurnBudgets;
  }
  return Object.freeze(
    turns.map(({ usage, ...turn }) => {
      const cacheHitRate = cacheUsageReport(usage)?.hitRate;
      return Object.freeze({ ...turn, ...(cacheHitRate === undefined ? {} : { cacheHitRate }) });
    }),
  );
}

/** Join the breach (`run_limit_exceeded`) and the attribution payload (`budget_exhausted`). */
function projectExhaustion(state: FoldState): TimelineExhaustion | undefined {
  const limit = state.attribution?.limit ?? state.breach?.limit;
  if (!limit) return undefined;
  return Object.freeze({
    limit,
    ...(state.breach ? { maximum: state.breach.maximum, observed: state.breach.observed } : {}),
    ...(state.breach?.currency ? { currency: state.breach.currency } : {}),
    ...(state.attribution ? { consumed: state.attribution.consumed } : {}),
    closestOtherAxes: state.attribution?.closestOtherAxes ?? [],
    recentToolCalls: state.attribution?.recentToolCalls ?? [],
  });
}

function buildTimeline(state: FoldState): ExecutionTimeline {
  // A turn answered deterministically still emits provider-turn events around the host-supplied
  // stream, so any `provider` step inside a turn that also carries a `deterministic` step is dropped:
  // the adapter was never called. Done here rather than on the event because the host emits the
  // deterministic marker from inside the provider round, after `turn.started` has fired.
  const answeredTurns = new Set(state.steps.filter((step) => step.kind === "deterministic").map((step) => step.parentId));
  if (answeredTurns.size > 0) {
    state.steps = state.steps.filter(
      (step) => step.kind !== "provider" || step.parentId === undefined || !answeredTurns.has(step.parentId),
    );
  }
  const resolvedTraceId = state.traceId ?? (state.instrumentation && state.runId ? state.instrumentation.traceId(state.runId) : undefined);
  const turns = state.steps.some((step) => step.kind === "turn") ? projectTurns(state.steps) : undefined;
  const exhaustion = projectExhaustion(state);
  const cacheHitRate = cacheUsageReport(state.totalUsage)?.hitRate;
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
    ...(cacheHitRate === undefined ? {} : { cacheHitRate }),
    ...(state.restore ? { restore: state.restore } : {}),
    steps: Object.freeze(state.steps.map(freezeStep)),
    ...(groupByOrigin(state.steps) ? { byOrigin: groupByOrigin(state.steps) } : {}),
    ...(turns ? { turns } : {}),
    ...(exhaustion ? { exhaustion } : {}),
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

  // A turn answered deterministically still emits provider-turn events around the host-supplied
  // stream, so any `provider` step inside a turn that also carries a `deterministic` step is dropped:
  // the adapter was never called. Do it here, not on the event, because the host emits the
  // deterministic marker from inside the provider round, after `turn.started` has fired.
  const deterministicTurns = new Set(state.steps.filter((step) => step.kind === "deterministic").map((step) => step.parentId));
  if (deterministicTurns.size > 0) {
    state.steps = state.steps.filter(
      (step) => step.kind !== "provider" || step.parentId === undefined || !deterministicTurns.has(step.parentId),
    );
  }

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
        if (event.restore) state.restore = event.restore;
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
        state.currentOrigin = undefined;
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
    ...(checkpoint?.metadata ? { workflowMetadata: redactor ? redactor.redact(checkpoint.metadata) : checkpoint.metadata } : {}),
    ...((state.traceId ?? (state.instrumentation && state.runId ? state.instrumentation.traceId(state.runId) : undefined))
      ? { traceId: state.traceId ?? (state.instrumentation && state.runId ? state.instrumentation.traceId(state.runId) : undefined) }
      : {}),
    status: state.status,
    startedAt: state.startedAt || now(),
    ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
    ...(state.runInput !== undefined ? { input: state.runInput } : {}),
    ...(state.runResult !== undefined ? { result: state.runResult } : {}),
    ...(state.totalUsage ? { usage: state.totalUsage } : {}),
    ...(state.restore ? { restore: state.restore } : {}),
    steps: Object.freeze(state.steps.map(freezeStep)),
    ...(groupByOrigin(state.steps) ? { byOrigin: groupByOrigin(state.steps) } : {}),
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
