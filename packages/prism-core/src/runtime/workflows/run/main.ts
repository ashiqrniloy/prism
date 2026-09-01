/** main (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */

import type { JsonObject } from "@arnilo/prism";
import { buildGraph } from "../define.js";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "../errors.js";
import {
  DEFAULT_MAX_FAN_OUT,
  HARD_MAX_CONCURRENCY,
  HARD_MAX_NESTED_DEPTH,
  validateWorkflowLimit,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
} from "../limits.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowLoopIterationRecord,
  WorkflowNodeDefinition,
  WorkflowNodeStatus,
  WorkflowResumeRecord,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowSuspension,
  WorkflowSuspensionDescriptor,
} from "../types.js";
import { createRunId, hashWorkflowDefinition, nowIso, ownershipMatches, redactValue } from "../util.js";
import { cloneState, parseStateHistory, resultFromRecord } from "./checkpoint.js";
import { executeScheduler } from "./scheduler.js";

interface RuntimeNodeState {
  nodeId: string;
  status: WorkflowNodeStatus;
  output?: unknown;
  error?: { message: string; code?: string | number };
  attempt?: number;
  sessionId?: string;
  leafId?: string;
  runId?: string;
  stateVersionBefore?: number;
  iteration?: number;
  lastOutput?: unknown;
  iterations?: WorkflowLoopIterationRecord[];
}

export interface SchedulerState {
  workflow: WorkflowDefinition;
  runId: string;
  definitionHash: string;
  status: WorkflowRunStatus;
  version: number;
  createdAt: string;
  workflowInput: unknown;
  nodes: Map<string, RuntimeNodeState>;
  outputs: Map<string, unknown>;
  remainingIndegree: Map<string, number>;
  successors: ReadonlyMap<string, readonly string[]>;
  predecessors: ReadonlyMap<string, readonly string[]>;
  ready: string[];
  running: Set<string>;
  skipped: Set<string>;
  completed: Set<string>;
  conditionalSkip: Map<string, Set<string>>;
  suspension?: WorkflowSuspensionDescriptor;
  resume?: WorkflowResumeRecord;
  resumeInput?: unknown;
  state: JsonObject;
  stateVersion: number;
  stateHistory: Map<number, JsonObject>;
  lineage?: import("../types.js").WorkflowReplayLineage;
  checkpointChain: Promise<void>;
  stateChain: Promise<void>;
}

/** Return from a workflow node to pause durably before its side effect. */
export function suspend<ResumeInput = unknown>(input: {
  readonly reason: string;
  readonly data?: unknown;
  readonly resumeSchema?: import("@arnilo/prism").JsonObject;
}): WorkflowSuspension<ResumeInput> {
  if (!input.reason.trim()) {
    throw new WorkflowRuntimeError("Suspension reason is required", "ERR_PRISM_WORKFLOW_SUSPEND");
  }
  return Object.freeze({ type: "workflow_suspend", ...input });
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
  input: unknown,
  options: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  validateRunOptions(options);
  const runId = options.runId ?? createRunId();
  const definitionHash = hashWorkflowDefinition(workflow);
  const graph = buildGraph(workflow);
  const createdAt = nowIso();
  const initialState = redactValue(cloneState(options.initialState ?? workflow.state?.initial ?? {}), options.redactor);

  const nodes = new Map<string, RuntimeNodeState>();
  for (const nodeId of Object.keys(workflow.nodes)) {
    nodes.set(nodeId, { nodeId, status: "pending" });
  }

  const remainingIndegree = new Map(graph.indegree);
  const ready: string[] = [];
  for (const [nodeId, degree] of remainingIndegree) {
    if (degree === 0) {
      ready.push(nodeId);
      nodes.get(nodeId)!.status = "ready";
    }
  }
  ready.sort((a, b) => a.localeCompare(b));

  const state: SchedulerState = {
    workflow,
    runId,
    definitionHash,
    status: "running",
    version: 0,
    createdAt,
    workflowInput: input,
    nodes,
    outputs: new Map(),
    remainingIndegree,
    successors: graph.successors,
    predecessors: graph.predecessors,
    ready,
    running: new Set(),
    skipped: new Set(),
    completed: new Set(),
    conditionalSkip: new Map(),
    state: initialState,
    stateVersion: 0,
    stateHistory: new Map([[0, initialState]]),
    checkpointChain: Promise.resolve(),
    stateChain: Promise.resolve(),
  };

  return executeScheduler(state, options);
}

export async function resumeWorkflow(
  workflow: WorkflowDefinition,
  ref: { readonly runId: string; readonly workflowId?: string },
  options: RunWorkflowOptions & { readonly checkpoints: WorkflowCheckpointAdapter },
): Promise<WorkflowRunResult> {
  validateRunOptions(options);
  const workflowId = ref.workflowId ?? workflow.id;
  const record = await options.checkpoints.load({
    workflowId,
    runId: ref.runId,
    ownership: options.ownership,
    signal: options.signal,
  });
  if (!record) {
    throw new WorkflowCheckpointError(`No checkpoint for workflow ${workflowId} run ${ref.runId}`);
  }
  if (!ownershipMatches(options.ownership, record.ownership)) {
    throw new WorkflowCheckpointError("Checkpoint tenant/ownership mismatch on resume");
  }
  if (record.value.schemaVersion !== WORKFLOW_CHECKPOINT_SCHEMA_VERSION) {
    throw new WorkflowCheckpointError(`Unsupported checkpoint schemaVersion ${record.value.schemaVersion}`);
  }
  const definitionHash = hashWorkflowDefinition(workflow);
  if (record.value.definitionHash !== definitionHash) {
    throw new WorkflowCheckpointError("Workflow definition hash mismatch on resume");
  }
  if (record.value.status === "succeeded" || record.value.status === "denied") {
    if (options.resume) {
      throw new WorkflowCheckpointError(`Workflow run is already ${record.value.status}`);
    }
    return resultFromRecord(workflow.id, record);
  }

  let resumeRecord: WorkflowResumeRecord | undefined;
  if (record.value.status === "suspended") {
    const suspension = record.value.suspension;
    if (!suspension) throw new WorkflowCheckpointError("Suspended checkpoint has no suspension descriptor");
    if (!options.resume) throw new WorkflowCheckpointError("Suspended workflow requires resume input");
    if (options.resume.expectedVersion !== record.version) {
      throw new WorkflowCheckpointError(`Stale resume version ${options.resume.expectedVersion} (current ${record.version})`);
    }
    if (suspension.resumeSchema && !options.validateResume) {
      throw new WorkflowCheckpointError("Suspension resumeSchema requires validateResume");
    }
    await options.validateResume?.({
      value: options.resume.input,
      schema: suspension.resumeSchema,
      suspension,
    });
    resumeRecord = {
      ...options.resume,
      nodeId: suspension.nodeId,
      resumedAt: nowIso(),
    };
  } else if (options.resume) {
    throw new WorkflowCheckpointError("Resume input is only valid for a suspended workflow");
  }

  const graph = buildGraph(workflow);
  const nodes = new Map<string, RuntimeNodeState>();
  const outputs = new Map<string, unknown>();
  const completed = new Set<string>();
  const skipped = new Set<string>();
  const remainingIndegree = new Map(graph.indegree);

  for (const nodeId of Object.keys(workflow.nodes)) {
    const saved = record.value.nodes[nodeId];
    let status = saved?.status ?? "pending";
    // Resume retries failed/aborted/interrupted nodes; succeeded/skipped stay terminal.
    if (status === "running" || status === "failed" || status === "aborted") {
      status = "ready";
    }
    if (status === "suspended" && resumeRecord?.decision === "approve") status = "ready";
    if (status === "suspended" && resumeRecord?.decision === "deny") status = "denied";
    nodes.set(nodeId, {
      nodeId,
      status,
      output: status === "ready" ? undefined : saved?.output,
      error: status === "ready" ? undefined : saved?.error,
      attempt: status === "ready" ? undefined : saved?.attempt,
      sessionId: saved?.sessionId,
      leafId: saved?.leafId,
      runId: saved?.runId,
      stateVersionBefore: saved?.stateVersionBefore,
      iteration: saved?.iteration,
      lastOutput: saved?.lastOutput ?? saved?.iterations?.at(-1)?.output,
      iterations: saved?.iterations?.map((iteration) => ({ ...iteration })),
    });
    if (status === "succeeded" && saved?.output !== undefined) outputs.set(nodeId, saved.output);
    if (status === "succeeded" || status === "skipped" || status === "denied") {
      completed.add(nodeId);
      if (status === "skipped") skipped.add(nodeId);
      for (const next of graph.successors.get(nodeId) ?? []) {
        remainingIndegree.set(next, Math.max(0, (remainingIndegree.get(next) ?? 0) - 1));
      }
    }
  }

  const ready = [...record.value.readyNodeIds].filter((nodeId) => {
    const status = nodes.get(nodeId)?.status;
    return status === "ready" || status === "pending";
  });
  for (const [nodeId, degree] of remainingIndegree) {
    const status = nodes.get(nodeId)?.status;
    if (degree === 0 && (status === "pending" || status === "ready") && !ready.includes(nodeId) && !completed.has(nodeId)) {
      ready.push(nodeId);
      nodes.get(nodeId)!.status = "ready";
    }
  }
  ready.sort((a, b) => a.localeCompare(b));

  const state: SchedulerState = {
    workflow,
    runId: record.runId,
    definitionHash,
    status: resumeRecord?.decision === "deny" ? "denied" : "running",
    version: record.version,
    createdAt: record.value.createdAt,
    workflowInput: record.value.workflowInput,
    nodes,
    outputs,
    remainingIndegree,
    successors: graph.successors,
    predecessors: graph.predecessors,
    ready,
    running: new Set(),
    skipped,
    completed,
    conditionalSkip: new Map(),
    suspension: resumeRecord?.decision === "approve" ? undefined : record.value.suspension,
    resume: redactValue(resumeRecord ?? record.value.resume, options.redactor),
    resumeInput: resumeRecord?.input ?? record.value.resume?.input,
    state: cloneState(record.value.state ?? {}),
    stateVersion: record.value.stateVersion ?? 0,
    stateHistory: parseStateHistory(record.value.stateHistory, record.value.state ?? {}),
    lineage: record.value.lineage,
    checkpointChain: Promise.resolve(),
    stateChain: Promise.resolve(),
  };

  const result = await executeScheduler(state, {
    ...options,
    fencingToken: options.fencingToken ?? record.fencingToken,
  });
  if (resumeRecord?.decision === "deny") {
    const nested = workflow.nodes[resumeRecord.nodeId];
    if (nested?.kind === "workflow") {
      const childRunId = `${record.runId}~${encodeURIComponent(resumeRecord.nodeId)}`;
      const child = await options.checkpoints.load({
        workflowId: nested.workflow.id,
        runId: childRunId,
        ownership: options.ownership,
        signal: options.signal,
      });
      if (child?.value.status === "suspended") {
        await resumeWorkflow(
          nested.workflow,
          { workflowId: nested.workflow.id, runId: childRunId },
          {
            ...options,
            checkpoints: options.checkpoints,
            resume: { decision: "deny", expectedVersion: child.version },
            nestedDepth: (options.nestedDepth ?? 0) + 1,
          },
        );
      }
    }
  }
  return result;
}

export function resolveMaxFanOut(workflow: WorkflowDefinition, node: WorkflowNodeDefinition): number {
  if (node.kind !== "fan_out") return DEFAULT_MAX_FAN_OUT;
  const workflowLimit = workflow.limits?.maxFanOut ?? DEFAULT_MAX_FAN_OUT;
  return Math.min(node.maxFanOut ?? workflowLimit, workflowLimit);
}

function validateRunOptions(options: RunWorkflowOptions): void {
  if (options.concurrency !== undefined) {
    validateWorkflowLimit("concurrency", options.concurrency, HARD_MAX_CONCURRENCY);
  }
  if (
    options.nestedDepth !== undefined &&
    (!Number.isSafeInteger(options.nestedDepth) || options.nestedDepth < 0 || options.nestedDepth > HARD_MAX_NESTED_DEPTH)
  ) {
    throw new WorkflowRuntimeError(`nestedDepth must be a non-negative safe integer at most ${HARD_MAX_NESTED_DEPTH}`);
  }
  if (options.nestedDepthLimit !== undefined) {
    validateWorkflowLimit("nestedDepthLimit", options.nestedDepthLimit, HARD_MAX_NESTED_DEPTH);
  }
}
