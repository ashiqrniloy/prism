/**
 * Plan 239 Task 10: the job driver. It runs one agent session until a host predicate says done, across runs and
 * across process restarts. The job is a cyclic workflow of one function node ("step") and a route back to it or
 * to the end, so it reuses the engine's checkpoints and `suspend` (Task 1(f)): no loop of its own.
 *
 * Each step continues the session when its branch owes a model turn (`session.continue()`, plan 231), and runs the
 * next message otherwise. A failed run is recorded as data, never thrown; the next step waits a doubling backoff
 * first. A suspended run (an approval) suspends the job; `resumeAgentJob` with the decisions resumes it.
 */

import { createHash } from "node:crypto";
import {
  AgentDecisionError,
  type Decision,
  type JsonObject,
  type JsonValue,
  type Message,
  type PackageAPI,
  type PendingDecision,
  type RunOptions,
  type RunResult,
  type Session,
  SessionContinueError,
  SessionLimitError,
} from "@arnilo/prism";
import { defineWorkflow } from "./define.js";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { functionNode, routeNode } from "./nodes.js";
import { branchRunResult, resumeChild } from "./nodes/agent-node.js";
import { resumeWorkflow, runWorkflow, suspend } from "./run.js";
import { createWorkflowRuntime, WORKFLOWS_SERVICE, type WorkflowRuntime } from "./services.js";
import type {
  WorkflowCheckpointAdapter,
  WorkflowCheckpointRecord,
  WorkflowDefinition,
  WorkflowNodeContext,
  WorkflowRunResult,
} from "./types.js";
import { createRunId, isAbortError, sleep, stableStringify } from "./util.js";

/** Workflow id of every agent job checkpoint. */
export const AGENT_JOB_WORKFLOW_ID = "prism.agent-job";
/** Runs a job makes when `maxRuns` is unset. `null` leaves it unbounded. */
export const DEFAULT_JOB_MAX_RUNS = 100;
/** Failed runs in a row that stop a job. */
export const DEFAULT_JOB_MAX_CONSECUTIVE_FAILURES = 3;
/** Runs in a row with the same outcome (final text and tool calls) that stop a job. */
export const DEFAULT_JOB_MAX_IDENTICAL_OUTCOMES = 3;
/** First wait before the run after a failed one; it doubles per failure in a row. */
export const DEFAULT_JOB_RETRY_BASE_MS = 30_000;
/** Longest wait before the run after a failed one. */
export const DEFAULT_JOB_RETRY_MAX_MS = 15 * 60_000;
/** Step and route records the job's checkpoint keeps (`WorkflowLimits.maxIterationRecords`), so it stays bounded. */
const JOB_ITERATION_RECORDS = 4;

export const AGENT_JOB_EVENTS = {
  started: "job.started",
  run: "job.run",
  stopped: "job.stopped",
} as const;

export type AgentJobStatus = "done" | "stopped" | "failed" | "suspended" | "aborted";

export type AgentJobStopReason =
  | "done"
  | "session_limit"
  | "max_runs"
  | "max_consecutive_failures"
  | "max_identical_outcomes"
  | "nothing_to_continue"
  | "approval_required"
  | "aborted";

export interface AgentJobUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cost?: number;
  readonly currency?: string;
}

/** What the checkpoint keeps of a run: ids, status and error codes, never message content. */
export interface AgentJobRunSummary {
  readonly runId: string;
  readonly status: RunResult["status"];
  readonly errorCode?: string;
  readonly limit?: string;
  readonly limitScope?: "run" | "session";
}

/** The job's durable state: the step node's output, written with each workflow checkpoint. */
export interface AgentJobState {
  readonly jobId: string;
  readonly runs: number;
  readonly consecutiveFailures: number;
  readonly identicalOutcomes: number;
  readonly outcomeHash?: string;
  readonly usage: AgentJobUsage;
  /** Session leaf when the newest run was recorded; a different leaf on restart means an unrecorded run. */
  readonly leafId?: string;
  readonly lastRun?: AgentJobRunSummary;
  readonly stop?: { readonly status: Exclude<AgentJobStatus, "suspended">; readonly reason: AgentJobStopReason };
}

/** What `next` and `done` see. `lastRun` is the newest run's result in this process; absent right after a restart. */
export interface AgentJobView extends AgentJobState {
  readonly session: Session;
  readonly lastRunResult?: RunResult;
}

export interface AgentJobSpec {
  /** The first message. */
  readonly input: string | Message | readonly Message[];
  /** The next message, or `undefined` to continue the branch as it stands. Default: `undefined`. */
  readonly next?: (
    view: AgentJobView,
  ) => string | Message | readonly Message[] | undefined | Promise<string | Message | readonly Message[] | undefined>;
  /** Host predicate after each run that did not fail. It may call a model; the driver never does. */
  readonly done: (view: AgentJobView) => boolean | Promise<boolean>;
  /** Default {@link DEFAULT_JOB_MAX_RUNS}; `null` is unbounded (the session limits and `done` still stop it). */
  readonly maxRuns?: number | null;
  readonly maxConsecutiveFailures?: number;
  readonly maxIdenticalOutcomes?: number;
  /** Wait before the run after a failed one: `baseMs × 2^(failures − 1)`, at most `maxMs`. */
  readonly retry?: { readonly baseMs?: number; readonly maxMs?: number };
  /** Durable job checkpoints. Default: the `checkpoints` service through `prism`. */
  readonly checkpoints?: WorkflowCheckpointAdapter;
  /** A package API: resolves the checkpoints service and emits `job.*` events as the workflows package. */
  readonly prism?: PackageAPI;
  /** Narrowing options for every run (never `signal`: that is the job's). */
  readonly runOptions?: Omit<RunOptions, "signal">;
  readonly signal?: AbortSignal;
  /** Job id (the workflow run id). Default: a random id. */
  readonly jobId?: string;
}

export interface AgentJobResult {
  readonly jobId: string;
  readonly status: AgentJobStatus;
  readonly reason: AgentJobStopReason;
  readonly runs: number;
  readonly usage: AgentJobUsage;
  /** The newest run's result in this process. */
  readonly lastRun?: RunResult;
  /** Present on a suspended job: the decisions `resumeAgentJob` needs. */
  readonly pending?: readonly PendingDecision[];
  /** Workflow checkpoint version. */
  readonly version: number;
}

export interface ResumeAgentJobOptions {
  /** Decisions for a job suspended on an approval: one per pending decision, as `session.resume` takes them. */
  readonly decisions?: readonly Decision[];
}

interface JobInput {
  readonly jobId: string;
  readonly startLeafId?: string;
}

/** Start a job on `session`. It returns when the job stops, suspends, or is aborted. */
export async function runAgentJob(session: Session, spec: AgentJobSpec): Promise<AgentJobResult> {
  const jobId = spec.jobId ?? createRunId();
  const input: JobInput = { jobId, ...(session.leafId === undefined ? {} : { startLeafId: session.leafId }) };
  const driver = createDriver(session, spec, initialState(jobId, session.leafId));
  driver.emit(AGENT_JOB_EVENTS.started, { resumed: false });
  return driver.finish(() => runWorkflow(driver.workflow, input, driver.workflowOptions(jobId)));
}

/**
 * Continue a job after a process restart or a suspension. It reads the newest checkpoint; a run that was in flight is
 * continued through `session.continue()`, not restarted. A suspended job needs `options.decisions`.
 */
export async function resumeAgentJob(
  session: Session,
  spec: Omit<AgentJobSpec, "jobId">,
  jobId: string,
  options: ResumeAgentJobOptions = {},
): Promise<AgentJobResult> {
  const checkpoints = resolveCheckpoints(spec);
  const record = await checkpoints.load({ workflowId: AGENT_JOB_WORKFLOW_ID, runId: jobId, signal: spec.signal });
  if (!record) throw new WorkflowCheckpointError(`No checkpoint for agent job ${jobId}`);
  const driver = createDriver(session, { ...spec, jobId }, stateFromRecord(record, jobId));
  if (record.value.status === "succeeded") return driver.result(record.version);
  let resume: { decision: "approve"; input: JsonValue; expectedVersion: number } | undefined;
  if (record.value.status === "suspended") {
    if (!options.decisions) return driver.result(record.version, "suspended", pendingOf(record));
    resume = { decision: "approve", input: options.decisions as unknown as JsonValue, expectedVersion: record.version };
  }
  driver.emit(AGENT_JOB_EVENTS.started, { resumed: true });
  return driver.finish(() =>
    resumeWorkflow(
      driver.workflow,
      { workflowId: AGENT_JOB_WORKFLOW_ID, runId: jobId },
      {
        ...driver.workflowOptions(jobId),
        ...(resume ? { resume } : {}),
      },
    ),
  );
}

function createDriver(session: Session, spec: AgentJobSpec, start: AgentJobState) {
  const maxRuns = spec.maxRuns === undefined ? DEFAULT_JOB_MAX_RUNS : spec.maxRuns;
  const maxFailures = spec.maxConsecutiveFailures ?? DEFAULT_JOB_MAX_CONSECUTIVE_FAILURES;
  const maxIdentical = spec.maxIdenticalOutcomes ?? DEFAULT_JOB_MAX_IDENTICAL_OUTCOMES;
  const baseMs = spec.retry?.baseMs ?? DEFAULT_JOB_RETRY_BASE_MS;
  const maxMs = spec.retry?.maxMs ?? DEFAULT_JOB_RETRY_MAX_MS;
  for (const [name, value] of [
    ["maxConsecutiveFailures", maxFailures],
    ["maxIdenticalOutcomes", maxIdentical],
    ...(maxRuns === null ? [] : [["maxRuns", maxRuns] as const]),
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new WorkflowRuntimeError(`Agent job ${name} must be a positive safe integer`);
  }
  for (const [name, value] of [
    ["retry.baseMs", baseMs],
    ["retry.maxMs", maxMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new WorkflowRuntimeError(`Agent job ${name} must be a non-negative safe integer`);
  }
  const checkpoints = resolveCheckpoints(spec);
  const runtime = spec.prism?.services.consume<WorkflowRuntime>(WORKFLOWS_SERVICE);
  const events = runtime?.events ?? spec.prism?.events;
  let state = start;
  let lastRunResult: RunResult | undefined;
  let pending: readonly PendingDecision[] | undefined;

  const emit = (name: string, data: JsonObject): void => {
    events?.emit(name, { jobId: state.jobId, sessionId: session.id, ...data });
  };
  const view = (): AgentJobView => ({ ...state, session, ...(lastRunResult ? { lastRunResult } : {}) });

  /** One run of the job, recorded as data. A thrown error here would fail the workflow, so only aborts and store faults throw. */
  const step = async (ctx: WorkflowNodeContext): Promise<unknown> => {
    if (state.stop) return state;
    let result: RunResult;
    try {
      if (ctx.resume) {
        result = await resumeChild(session, ctx, { ...spec.runOptions, signal: ctx.signal });
      } else {
        if (state.consecutiveFailures > 0) {
          await sleep(Math.min(maxMs, baseMs * 2 ** Math.min(state.consecutiveFailures - 1, 30)), ctx.signal);
        }
        const outcome = await startRun(ctx);
        if ("stop" in outcome) return (state = { ...state, stop: outcome.stop });
        if ("suspend" in outcome) return outcome.suspend;
        result = outcome.result;
      }
    } catch (error) {
      if (isAbortError(error) || ctx.signal?.aborted) return (state = { ...state, stop: { status: "aborted", reason: "aborted" } });
      if (error instanceof SessionLimitError) return (state = { ...state, stop: { status: "stopped", reason: "session_limit" } });
      result = failedResult(session, error);
    }
    lastRunResult = result;
    if (result.status === "suspended") {
      pending = result.pending;
      emit(AGENT_JOB_EVENTS.run, { runs: state.runs, runId: result.runId, status: "suspended" });
      return suspend({
        reason: "approval_required",
        data: { state: state as unknown as JsonValue, pending: (result.pending ?? []) as unknown as JsonValue },
      });
    }
    state = await record(result);
    emit(AGENT_JOB_EVENTS.run, {
      runs: state.runs,
      runId: result.runId,
      status: result.status,
      consecutiveFailures: state.consecutiveFailures,
      ...(state.lastRun?.limit ? { limit: state.lastRun.limit } : {}),
    });
    return state;
  };

  /** Continue the branch when it owes a turn (or a run happened that the checkpoint never recorded); else send the next message. */
  const startRun = async (
    ctx: WorkflowNodeContext,
  ): Promise<{ result: RunResult } | { stop: NonNullable<AgentJobState["stop"]> } | { suspend: unknown }> => {
    const options = { ...spec.runOptions, signal: ctx.signal };
    const leafChanged = session.leafId !== state.leafId;
    if (state.runs === 0 && !leafChanged) return { result: await session.run(spec.input, options) };
    try {
      return { result: await session.continue(options) };
    } catch (error) {
      if (error instanceof AgentDecisionError) {
        // The process died while a run waited on an approval: the job waits for the same decisions.
        return { suspend: suspend({ reason: "approval_required", data: { state: state as unknown as JsonValue } }) };
      }
      if (!(error instanceof SessionContinueError)) throw error;
    }
    // A run finished after the last checkpoint: record it from the branch instead of running again.
    if (leafChanged) return { result: await branchRunResult(session, "completed", "") };
    const message = await spec.next?.(view());
    if (message === undefined) return { stop: { status: "stopped", reason: "nothing_to_continue" } };
    return { result: await session.run(message, options) };
  };

  const record = async (result: RunResult): Promise<AgentJobState> => {
    const runs = state.runs + 1;
    const lastRun: AgentJobRunSummary = {
      runId: result.runId,
      status: result.status,
      ...(typeof result.error?.code === "string" ? { errorCode: result.error.code } : {}),
      ...(result.limit ? { limit: result.limit.limit, limitScope: result.limit.scope ?? "run" } : {}),
    };
    const base = {
      ...state,
      runs,
      usage: addUsage(state.usage, result),
      lastRun,
      ...(session.leafId === undefined ? {} : { leafId: session.leafId }),
    };
    if (result.status === "aborted") return { ...base, stop: { status: "aborted", reason: "aborted" } };
    if (result.status === "failed") {
      const { outcomeHash: _hash, ...rest } = base;
      const failed = { ...rest, consecutiveFailures: state.consecutiveFailures + 1, identicalOutcomes: 0 };
      if (result.limit?.scope === "session") return { ...failed, stop: { status: "stopped", reason: "session_limit" } };
      if (failed.consecutiveFailures >= maxFailures) return { ...failed, stop: { status: "failed", reason: "max_consecutive_failures" } };
      return maxRuns !== null && runs >= maxRuns ? { ...failed, stop: { status: "stopped", reason: "max_runs" } } : failed;
    }
    const outcomeHash = hashOutcome(result);
    const identicalOutcomes = outcomeHash === state.outcomeHash ? state.identicalOutcomes + 1 : 1;
    const next: AgentJobState = { ...base, consecutiveFailures: 0, outcomeHash, identicalOutcomes };
    state = next;
    if (await spec.done(view())) return { ...next, stop: { status: "done", reason: "done" } };
    if (identicalOutcomes >= maxIdentical) return { ...next, stop: { status: "stopped", reason: "max_identical_outcomes" } };
    if (maxRuns !== null && runs >= maxRuns) return { ...next, stop: { status: "stopped", reason: "max_runs" } };
    return next;
  };

  const workflow: WorkflowDefinition = defineWorkflow({
    id: AGENT_JOB_WORKFLOW_ID,
    revision: "1",
    nodes: {
      step: functionNode({ activation: "any", execute: step }),
      route: routeNode({ select: () => (state.stop ? [] : ["step"]) }),
    },
    edges: [
      ["step", "route"],
      ["route", "step"],
    ],
    // A run takes two supersteps (step, route); a restart or an approval can re-enter a step without a new run, so
    // the bound is twice that. `maxRuns` itself is enforced by the step.
    limits: { maxSupersteps: maxRuns === null ? null : 4 * maxRuns + 4, maxIterationRecords: JOB_ITERATION_RECORDS },
  });

  const result = (version: number, status?: AgentJobStatus, pendingDecisions?: readonly PendingDecision[]): AgentJobResult => {
    const stop = state.stop;
    return {
      jobId: state.jobId,
      status: status ?? stop?.status ?? "stopped",
      reason: status === "suspended" ? "approval_required" : (stop?.reason ?? "aborted"),
      runs: state.runs,
      usage: state.usage,
      ...(lastRunResult ? { lastRun: lastRunResult } : {}),
      ...(pendingDecisions ? { pending: pendingDecisions } : {}),
      version,
    };
  };

  return {
    workflow,
    emit,
    result,
    workflowOptions: (jobId: string) => ({ checkpoints, runId: jobId, signal: spec.signal, ...(spec.prism ? { prism: spec.prism } : {}) }),
    async finish(start: () => Promise<WorkflowRunResult>): Promise<AgentJobResult> {
      let final: AgentJobResult;
      try {
        const run = await start();
        if (run.status === "suspended") {
          final = result(run.version, "suspended", pending ?? []);
          emit(AGENT_JOB_EVENTS.stopped, { status: "suspended", reason: "approval_required", runs: state.runs });
          return final;
        }
        final = result(run.version, run.status === "aborted" ? "aborted" : undefined);
      } catch (error) {
        if (!(isAbortError(error) || spec.signal?.aborted)) throw error;
        state = { ...state, stop: { status: "aborted", reason: "aborted" } };
        final = result(-1);
      }
      emit(AGENT_JOB_EVENTS.stopped, { status: final.status, reason: final.reason, runs: final.runs });
      return final;
    },
  };
}

function resolveCheckpoints(spec: Pick<AgentJobSpec, "checkpoints" | "prism">): WorkflowCheckpointAdapter {
  const checkpoints = spec.checkpoints ?? (spec.prism ? createWorkflowRuntime(spec.prism).checkpoints : undefined);
  if (!checkpoints) throw new WorkflowCheckpointError("An agent job needs `checkpoints` or a `prism` package API that provides them");
  return checkpoints;
}

function initialState(jobId: string, leafId: string | undefined): AgentJobState {
  return {
    jobId,
    runs: 0,
    consecutiveFailures: 0,
    identicalOutcomes: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ...(leafId === undefined ? {} : { leafId }),
  };
}

/** The newest recorded job state: a suspension's own copy, else the step's newest output, else the job's start. */
function stateFromRecord(record: WorkflowCheckpointRecord, jobId: string): AgentJobState {
  const suspended = (record.value.suspension?.data as { state?: AgentJobState } | undefined)?.state;
  const step = record.value.nodes.step;
  const saved = suspended ?? ((step?.iterations?.at(-1)?.output ?? step?.lastOutput ?? step?.output) as AgentJobState | undefined);
  if (saved && typeof saved === "object" && saved.jobId === jobId) return saved;
  return initialState(jobId, (record.value.workflowInput as JobInput | undefined)?.startLeafId);
}

function pendingOf(record: WorkflowCheckpointRecord): readonly PendingDecision[] {
  const pending = (record.value.suspension?.data as { pending?: unknown } | undefined)?.pending;
  return Array.isArray(pending) ? (pending as PendingDecision[]) : [];
}

function failedResult(session: Session, error: unknown): RunResult {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "run_threw";
  return {
    sessionId: session.id,
    runId: "",
    status: "failed",
    text: "",
    content: [],
    messages: [],
    error: { code, message: error instanceof Error ? error.message : String(error) },
  } as RunResult;
}

function addUsage(total: AgentJobUsage, result: RunResult): AgentJobUsage {
  const usage = result.usage;
  if (!usage) return total;
  const cost = usage.cost === undefined ? total.cost : (total.cost ?? 0) + usage.cost;
  const currency = total.currency ?? usage.currency;
  return {
    inputTokens: total.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: total.outputTokens + (usage.outputTokens ?? 0),
    totalTokens: total.totalTokens + (usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
    ...(cost === undefined ? {} : { cost }),
    ...(currency === undefined ? {} : { currency }),
  };
}

/** One SHA-256 over the final text and the run's tool calls and results, without call ids (they differ per run). */
function hashOutcome(result: RunResult): string {
  const calls: unknown[] = [];
  for (const message of result.messages) {
    for (const block of message.content) {
      if (block.type === "tool_call") calls.push(["call", block.name, block.arguments]);
      else if (block.type === "tool_result") calls.push(["result", block.name, block.result ?? null, block.error ?? null]);
    }
  }
  return `sha256:${createHash("sha256")
    .update(stableStringify({ text: result.text, calls }))
    .digest("hex")}`;
}
