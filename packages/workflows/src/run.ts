import {
  assertExecutionAllowed,
  type AgentSession,
  type JsonObject,
  type Message,
  type ToolDefinition,
  type ToolExecutionContext,
} from "@arnilo/prism";
import { registerActiveWorkflowRun, unregisterActiveWorkflowRun } from "./active-runs.js";
import { buildGraph } from "./define.js";
import { createWorkflowEventBus } from "./events.js";
import {
  WorkflowAbortError,
  WorkflowCheckpointError,
  WorkflowRuntimeError,
} from "./errors.js";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_FAN_OUT,
  DEFAULT_MAX_NESTED_DEPTH,
  DEFAULT_MAX_NODES,
  DEFAULT_MAX_STATE_BYTES,
  DEFAULT_MAX_STATE_HISTORY,
  HARD_MAX_CONCURRENCY,
  HARD_MAX_NESTED_DEPTH,
  validateWorkflowLimit,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
} from "./limits.js";
import type {
  WorkflowCheckpointAdapter,
  WorkflowCheckpointRecord,
  WorkflowCheckpointValue,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventBus,
  WorkflowEventInput,
  WorkflowNodeCheckpoint,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowNodeStatus,
  WorkflowResumeRecord,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowSuspension,
  WorkflowSuspensionDescriptor,
  RunWorkflowOptions,
} from "./types.js";
import { randomUUID } from "node:crypto";
import {
  assertWithinBytes,
  boundNodeOutput,
  combineSignals,
  createRunId,
  errorCode,
  errorMessage,
  hashWorkflowDefinition,
  isAbortError,
  nowIso,
  ownershipMatches,
  redactValue,
  sleep,
} from "./util.js";

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
}

interface SchedulerState {
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
  lineage?: import("./types.js").WorkflowReplayLineage;
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
    throw new WorkflowCheckpointError(
      `Unsupported checkpoint schemaVersion ${record.value.schemaVersion}`,
    );
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
      throw new WorkflowCheckpointError(
        `Stale resume version ${options.resume.expectedVersion} (current ${record.version})`,
      );
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

  const ready = [...record.value.readyNodeIds]
    .filter((nodeId) => {
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
        await resumeWorkflow(nested.workflow, { workflowId: nested.workflow.id, runId: childRunId }, {
          ...options,
          checkpoints: options.checkpoints,
          resume: { decision: "deny", expectedVersion: child.version },
          nestedDepth: (options.nestedDepth ?? 0) + 1,
        });
      }
    }
  }
  return result;
}

async function executeScheduler(
  state: SchedulerState,
  options: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const runController = new AbortController();
  const signal = combineSignals([options.signal, runController.signal]);
  options = { ...options, signal };
  registerActiveWorkflowRun({
    workflowId: state.workflow.id,
    runId: state.runId,
    ownership: options.ownership,
    definitionHash: state.definitionHash,
    controller: runController,
  });

  try {
    return await executeSchedulerBody(state, options);
  } finally {
    unregisterActiveWorkflowRun(state.workflow.id, state.runId, options.ownership);
  }
}

async function executeSchedulerBody(
  state: SchedulerState,
  options: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const workflowConcurrency = state.workflow.limits?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const concurrency = Math.min(options.concurrency ?? workflowConcurrency, workflowConcurrency);
  const maxNodes = state.workflow.limits?.maxNodes ?? DEFAULT_MAX_NODES;
  const nestedDepth = options.nestedDepth ?? 0;
  const maxNestedDepth = Math.min(
    options.nestedDepthLimit ?? DEFAULT_MAX_NESTED_DEPTH,
    state.workflow.limits?.maxNestedDepth ?? DEFAULT_MAX_NESTED_DEPTH,
  );
  if (nestedDepth > maxNestedDepth) {
    throw new WorkflowRuntimeError(`Workflow exceeds maxNestedDepth (${nestedDepth} > ${maxNestedDepth})`, "ERR_PRISM_WORKFLOW_NESTED_DEPTH");
  }
  await validateState(state, options);
  if (Object.keys(state.workflow.nodes).length > maxNodes) {
    throw new WorkflowRuntimeError(`Workflow exceeds maxNodes (${Object.keys(state.workflow.nodes).length} > ${maxNodes})`);
  }

  const ownedBus = !options.eventBus;
  const bus = options.eventBus ?? createWorkflowEventBus({
    workflowId: state.workflow.id,
    runId: state.runId,
    signal: options.signal,
  });

  const emit = (event: WorkflowEventInput) => {
    bus.emit(event);
    const sequenced = { ...event, sequence: event.sequence ?? bus.sequence } as WorkflowEvent;
    options.onEvent?.(sequenced);
  };

  let fatalError: unknown;
  const activeSessions = new Map<string, AgentSession>();
  let settle: (() => void) | undefined;
  let pendingKick = false;
  const kick = () => {
    if (settle) {
      settle();
      settle = undefined;
      pendingKick = false;
      return;
    }
    pendingKick = true;
  };
  const waitForProgress = () => {
    if (pendingKick) {
      pendingKick = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      settle = resolve;
    });
  };

  const abortAllSessions = () => {
    for (const session of activeSessions.values()) {
      try {
        session.abort(options.signal?.reason ?? new WorkflowAbortError());
      } catch {
        // ignore
      }
    }
    kick();
  };

  const onAbort = () => {
    state.status = "aborted";
    abortAllSessions();
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  emit({
    type: "workflow_started",
    workflowId: state.workflow.id,
    runId: state.runId,
    timestamp: nowIso(),
  });
  if (state.resume) {
    emit({
      type: "workflow_resumed",
      workflowId: state.workflow.id,
      runId: state.runId,
      resume: state.resume,
      timestamp: nowIso(),
    });
  }

  await persistCheckpoint(state, options, emit);

  try {
    while (
      (state.ready.length > 0 || state.running.size > 0)
      && state.status === "running"
      && !fatalError
    ) {
      while (state.ready.length > 0 && state.running.size < concurrency && state.status === "running") {
        const nodeId = state.ready.shift()!;
        if (state.skipped.has(nodeId) || state.completed.has(nodeId)) continue;
        state.running.add(nodeId);
        void runNode(state, nodeId, options, bus, emit, activeSessions)
          .catch((error) => {
            fatalError = error;
            state.status = isAbortError(error) || options.signal?.aborted ? "aborted" : "failed";
            abortAllSessions();
          })
          .finally(() => {
            state.running.delete(nodeId);
            kick();
          });
      }

      if (state.running.size === 0) break;
      if (options.signal?.aborted) {
        fatalError = new WorkflowAbortError();
        state.status = "aborted";
        abortAllSessions();
        break;
      }
      await waitForProgress();
    }

    while (state.running.size > 0) {
      await waitForProgress();
    }

    if (options.signal?.aborted || state.status === "aborted") {
      state.status = "aborted";
      markRemaining(state, "aborted");
    } else if (fatalError) {
      state.status = "failed";
      markRemaining(state, "aborted");
    } else if (state.status === "suspended" || state.status === "denied") {
      // Suspension and denial are already fully represented in the checkpoint.
    } else if ([...state.nodes.values()].some((node) => node.status === "failed")) {
      state.status = "failed";
    } else if ([...state.nodes.values()].every((node) =>
      node.status === "succeeded" || node.status === "skipped"
    )) {
      state.status = "succeeded";
    } else if (state.ready.length === 0 && state.running.size === 0) {
      // Stuck pending nodes imply unmet deps from skips — treat unresolved as skipped if all preds skipped/succeeded.
      for (const [nodeId, node] of state.nodes) {
        if (node.status === "pending" || node.status === "ready") {
          skipNode(state, nodeId, "unmet dependencies", emit);
        }
      }
      state.status = [...state.nodes.values()].some((node) => node.status === "failed")
        ? "failed"
        : "succeeded";
    }

    await persistCheckpoint(state, options, emit);

    if (state.status !== "suspended") {
      emit({
        type: "workflow_finished",
        workflowId: state.workflow.id,
        runId: state.runId,
        status: state.status,
        timestamp: nowIso(),
      });
    }

    if (state.status === "aborted") {
      if (fatalError instanceof WorkflowAbortError) throw fatalError;
      throw new WorkflowAbortError(
        fatalError instanceof Error ? fatalError.message : "Workflow aborted",
      );
    }
    if (state.status === "failed") {
      const failed = [...state.nodes.values()].find((node) => node.status === "failed");
      throw new WorkflowRuntimeError(
        failed?.error?.message ?? errorMessage(fatalError) ?? "Workflow failed",
        failed?.error?.code ?? errorCode(fatalError) ?? "ERR_PRISM_WORKFLOW_FAILED",
      );
    }

    const outputs: Record<string, unknown> = {};
    for (const [nodeId, output] of state.outputs) outputs[nodeId] = output;
    return {
      workflowId: state.workflow.id,
      runId: state.runId,
      status: state.status,
      version: state.version,
      outputs,
      suspension: state.suspension,
      resume: state.resume,
      state: cloneState(state.state),
      lineage: state.lineage,
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (ownedBus) bus.close();
  }
}

async function runNode(
  state: SchedulerState,
  nodeId: string,
  options: RunWorkflowOptions,
  bus: WorkflowEventBus,
  emit: (event: WorkflowEventInput) => void,
  activeSessions: Map<string, AgentSession>,
): Promise<void> {
  const node = state.workflow.nodes[nodeId]!;
  const nodeState = state.nodes.get(nodeId)!;
  nodeState.status = "running";
  emit({
    type: "node_started",
    workflowId: state.workflow.id,
    runId: state.runId,
    nodeId,
    timestamp: nowIso(),
  });
  await persistCheckpoint(state, options, emit);

  const retries = node.retries ?? 0;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    attempt += 1;
    nodeState.attempt = attempt;
    nodeState.stateVersionBefore ??= state.stateVersion;
    try {
      if (options.signal?.aborted) throw new WorkflowAbortError();

      const timeoutSignal = node.timeoutMs
        ? AbortSignal.timeout(node.timeoutMs)
        : undefined;
      const signal = combineSignals([options.signal, timeoutSignal]);
      const ctx = createContext(state, nodeId, options, signal);

      const result = await executeNode(node, ctx, state, options, bus, activeSessions);
      if (isWorkflowSuspension(result.output)) {
        if (!options.checkpoints) {
          throw new WorkflowRuntimeError(
            "Durable workflow suspension requires checkpoints",
            "ERR_PRISM_WORKFLOW_SUSPEND",
          );
        }
        if (state.suspension && state.suspension.nodeId !== nodeId) {
          // ponytail: one durable review cursor; queue concurrent suspension requests
          // and rerun that node after the current review resolves.
          nodeState.status = "ready";
          if (!state.ready.includes(nodeId)) {
            state.ready.push(nodeId);
            state.ready.sort((a, b) => a.localeCompare(b));
          }
          await persistCheckpoint(state, options, emit);
          return;
        }
        const descriptor: WorkflowSuspensionDescriptor = {
          nodeId,
          reason: result.output.reason,
          data: result.output.data === undefined
            ? undefined
            : boundNodeOutput(result.output.data, {
                maxNodeOutputBytes: state.workflow.limits?.maxNodeOutputBytes,
                redactor: options.redactor,
              }),
          resumeSchema: result.output.resumeSchema,
          requestedAt: nowIso(),
        };
        nodeState.status = "suspended";
        nodeState.error = undefined;
        state.status = "suspended";
        state.suspension = descriptor;
        emit({
          type: "workflow_suspended",
          workflowId: state.workflow.id,
          runId: state.runId,
          suspension: descriptor,
          timestamp: descriptor.requestedAt,
        });
        await persistCheckpoint(state, options, emit);
        return;
      }
      const output = boundNodeOutput(result.output, {
        maxNodeOutputBytes: state.workflow.limits?.maxNodeOutputBytes,
        redactor: options.redactor,
      });

      nodeState.status = "succeeded";
      nodeState.output = output;
      nodeState.error = undefined;
      if (result.sessionId) nodeState.sessionId = result.sessionId;
      if (result.leafId) nodeState.leafId = result.leafId;
      if (result.runId) nodeState.runId = result.runId;
      state.outputs.set(nodeId, output);
      state.completed.add(nodeId);

      if (node.kind === "conditional") {
        applyConditionalSkip(state, nodeId, Boolean(output), emit);
      }

      emit({
        type: "node_finished",
        workflowId: state.workflow.id,
        runId: state.runId,
        nodeId,
        timestamp: nowIso(),
      });
      releaseSuccessors(state, nodeId, emit);
      await persistCheckpoint(state, options, emit);
      return;
    } catch (error) {
      lastError = error;
      activeSessions.delete(nodeId);
      if (isAbortError(error) || options.signal?.aborted) {
        nodeState.status = "aborted";
        nodeState.error = { message: errorMessage(error), code: errorCode(error) };
        emit({
          type: "node_failed",
          workflowId: state.workflow.id,
          runId: state.runId,
          nodeId,
          error: nodeState.error,
          timestamp: nowIso(),
        });
        state.status = "aborted";
        throw error;
      }
      if (attempt <= retries) {
        await sleep(Math.min(1000, 25 * attempt), options.signal);
        continue;
      }
      nodeState.status = "failed";
      nodeState.error = { message: errorMessage(error), code: errorCode(error) };
      state.completed.add(nodeId);
      emit({
        type: "node_failed",
        workflowId: state.workflow.id,
        runId: state.runId,
        nodeId,
        error: nodeState.error,
        timestamp: nowIso(),
      });
      await persistCheckpoint(state, options, emit);
      // fail-fast
      state.status = "failed";
      throw error instanceof Error ? error : new WorkflowRuntimeError(errorMessage(error));
    }
  }

  throw lastError instanceof Error ? lastError : new WorkflowRuntimeError(errorMessage(lastError));
}

function createContext(
  state: SchedulerState,
  nodeId: string,
  options: RunWorkflowOptions,
  signal?: AbortSignal,
): WorkflowNodeContext {
  const upstream: Record<string, unknown> = {};
  for (const pred of state.predecessors.get(nodeId) ?? []) {
    if (state.outputs.has(pred)) upstream[pred] = state.outputs.get(pred);
  }
  return {
    workflowId: state.workflow.id,
    runId: state.runId,
    nodeId,
    workflowInput: state.workflowInput,
    upstream,
    state: cloneState(state.state),
    stateVersion: state.stateVersion,
    updateState: (patch, updateOptions) => updateWorkflowState(state, patch, updateOptions, options),
    signal,
    ownership: options.ownership,
    metadata: options.metadata,
    resume: state.resume?.nodeId === nodeId && state.resume.decision === "approve"
      ? { input: state.resumeInput, resumedAt: state.resume.resumedAt }
      : undefined,
  };
}

async function executeNode(
  node: WorkflowNodeDefinition,
  ctx: WorkflowNodeContext,
  state: SchedulerState,
  options: RunWorkflowOptions,
  bus: WorkflowEventBus,
  activeSessions: Map<string, AgentSession>,
): Promise<{
  output: unknown;
  sessionId?: string;
  leafId?: string;
  runId?: string;
}> {
  switch (node.kind) {
    case "function":
      return { output: await node.execute(ctx) };
    case "conditional":
      return { output: await node.when(ctx) };
    case "fan_out": {
      const items = await node.items(ctx);
      const effectiveLimit = resolveMaxFanOut(state.workflow, node);
      if (items.length > effectiveLimit) {
        throw new WorkflowRuntimeError(
          `Fan-out exceeded maxFanOut (${items.length} > ${effectiveLimit})`,
          "ERR_PRISM_WORKFLOW_FANOUT",
        );
      }
      const mapped: unknown[] = [];
      for (let index = 0; index < items.length; index += 1) {
        if (ctx.signal?.aborted) throw new WorkflowAbortError();
        mapped.push(await node.map(items[index], index, ctx));
      }
      return { output: mapped };
    }
    case "join": {
      const from = node.from ?? (Object.keys(ctx.upstream).length === 1
        ? Object.keys(ctx.upstream)[0]
        : undefined);
      if (!from) {
        throw new WorkflowRuntimeError(`Join node "${ctx.nodeId}" requires a single upstream or explicit from`);
      }
      const items = ctx.upstream[from];
      if (!Array.isArray(items)) {
        throw new WorkflowRuntimeError(`Join node "${ctx.nodeId}" upstream "${from}" is not an array`);
      }
      const output = node.reduce ? await node.reduce(items, ctx) : items;
      return { output };
    }
    case "tool": {
      const tool = resolveTool(node.tool, options);
      const args = await node.args(ctx);
      if (node.approval && !ctx.resume) {
        return {
          output: suspend({
            reason: node.approval.reason,
            data: await node.approval.data?.(ctx, args),
            resumeSchema: node.approval.resumeSchema,
          }),
        };
      }
      const action = node.action
        ? await node.action(ctx, args)
        : {
            kind: "tool",
            operation: tool.name,
            risk: "medium" as const,
            metadata: {
              workflowId: ctx.workflowId,
              nodeId: ctx.nodeId,
              runId: ctx.runId,
            },
          };
      const enriched = {
        ...action,
        metadata: {
          ...action.metadata,
          workflowId: ctx.workflowId,
          nodeId: ctx.nodeId,
          runId: ctx.runId,
        },
      };
      await assertExecutionAllowed(options.executionPolicy, enriched);
      const toolContext: ToolExecutionContext = {
        sessionId: `workflow:${ctx.workflowId}`,
        runId: ctx.runId,
        toolCallId: `wf_${ctx.nodeId}_${randomUUID()}`,
        signal: ctx.signal,
        metadata: {
          workflowId: ctx.workflowId,
          nodeId: ctx.nodeId,
        },
      };
      const result = await tool.execute(args, toolContext);
      if (result.error) {
        throw new WorkflowRuntimeError(result.error.message, result.error.code ?? "ERR_PRISM_WORKFLOW_TOOL");
      }
      return { output: result.value ?? result.content ?? null };
    }
    case "workflow": {
      const childRunId = `${ctx.runId}~${encodeURIComponent(ctx.nodeId)}`;
      const childInput = node.input ? await node.input(ctx) : ctx.workflowInput;
      const childOptions: RunWorkflowOptions = {
        ...options,
        runId: childRunId,
        nestedDepth: (options.nestedDepth ?? 0) + 1,
        nestedDepthLimit: Math.min(
          options.nestedDepthLimit ?? DEFAULT_MAX_NESTED_DEPTH,
          state.workflow.limits?.maxNestedDepth ?? DEFAULT_MAX_NESTED_DEPTH,
        ),
        initialState: cloneState(state.state),
        eventBus: bus,
        metadata: {
          ...options.metadata,
          parentWorkflowId: ctx.workflowId,
          parentRunId: ctx.runId,
          parentNodeId: ctx.nodeId,
        },
      };
      const existing = options.checkpoints
        ? await options.checkpoints.load({
            workflowId: node.workflow.id,
            runId: childRunId,
            ownership: options.ownership,
            signal: ctx.signal,
          })
        : null;
      if (existing?.value.status === "suspended" && !ctx.resume) {
        const childSuspension = existing.value.suspension;
        if (!childSuspension) throw new WorkflowCheckpointError("Nested suspended workflow has no descriptor");
        return { output: suspend({
          reason: childSuspension.reason,
          data: childSuspension.data,
          resumeSchema: childSuspension.resumeSchema,
        }) };
      }
      const result = existing && options.checkpoints
        ? await resumeWorkflow(node.workflow, { workflowId: node.workflow.id, runId: childRunId }, {
            ...childOptions,
            checkpoints: options.checkpoints,
            resume: existing.value.status === "suspended" && ctx.resume
              ? { decision: "approve", input: ctx.resume.input, expectedVersion: existing.version }
              : undefined,
          })
        : await runWorkflow(node.workflow, childInput, childOptions);
      if (result.status === "suspended") {
        return { output: suspend({
          reason: result.suspension?.reason ?? "Nested workflow suspended",
          data: result.suspension?.data,
          resumeSchema: result.suspension?.resumeSchema,
        }) };
      }
      await ctx.updateState(result.state, { mode: "replace" });
      return { output: node.output ? await node.output(result, ctx) : result.outputs, runId: result.runId };
    }
    case "agent": {
      if (!options.agentFactory) {
        throw new WorkflowRuntimeError("agentFactory is required for agent nodes");
      }
      const session = await options.agentFactory(node.agent);
      activeSessions.set(ctx.nodeId, session);
      const stopObserve = bus.observeAgentNode({ nodeId: ctx.nodeId, session });
      try {
        const input = node.input ? await node.input(ctx) : ctx.workflowInput;
        const runResult = await session.run(toAgentInput(input), {
          signal: ctx.signal,
          ownership: options.ownership,
          redactor: options.redactor,
          runLedger: options.runLedger,
          metadata: {
            workflowId: ctx.workflowId,
            nodeId: ctx.nodeId,
            runId: ctx.runId,
          },
        });
        const output = node.output
          ? await node.output({ ...ctx, session })
          : runResult.text || (runResult.content.length > 0 ? runResult.content : null);
        return {
          output,
          sessionId: session.id,
          leafId: session.leafId,
        };
      } finally {
        stopObserve();
        activeSessions.delete(ctx.nodeId);
      }
    }
    default: {
      const _exhaustive: never = node;
      throw new WorkflowRuntimeError(`Unknown node kind ${(_exhaustive as WorkflowNodeDefinition).kind}`);
    }
  }
}

function resolveTool(
  tool: ToolDefinition | string,
  options: RunWorkflowOptions,
): ToolDefinition {
  if (typeof tool !== "string") return tool;
  if (!options.tools) {
    throw new WorkflowRuntimeError(`Tool "${tool}" requires RunWorkflowOptions.tools`);
  }
  const resolved = typeof options.tools === "function"
    ? options.tools(tool)
    : options.tools[tool];
  if (!resolved) throw new WorkflowRuntimeError(`Unknown tool "${tool}"`);
  return resolved;
}

function toAgentInput(input: unknown): string | Message | readonly Message[] {
  if (typeof input === "string") return input;
  if (isMessage(input)) return input;
  if (Array.isArray(input) && input.every(isMessage)) return input;
  return JSON.stringify(input ?? null);
}

function isMessage(value: unknown): value is Message {
  return Boolean(
    value
    && typeof value === "object"
    && "role" in value
    && "content" in value
    && Array.isArray((value as Message).content),
  );
}

function applyConditionalSkip(
  state: SchedulerState,
  nodeId: string,
  passed: boolean,
  emit: (event: WorkflowEventInput) => void,
): void {
  const node = state.workflow.nodes[nodeId];
  if (!node || node.kind !== "conditional") return;
  const successors = state.successors.get(nodeId) ?? [];
  const allowed = new Set(passed ? (node.then ?? successors) : (node.else ?? []));
  if (!passed && !node.else && !node.then) {
    // Default: skip all direct successors when false and no else/then configured.
    for (const next of successors) allowed.delete(next);
  }
  for (const next of successors) {
    if (!allowed.has(next)) {
      skipTransitive(state, next, `conditional ${nodeId} skipped`, emit);
    }
  }
}

function skipTransitive(
  state: SchedulerState,
  nodeId: string,
  reason: string,
  emit: (event: WorkflowEventInput) => void,
): void {
  if (state.skipped.has(nodeId) || state.completed.has(nodeId)) return;
  skipNode(state, nodeId, reason, emit);
  for (const next of state.successors.get(nodeId) ?? []) {
    // Only skip successor if all predecessors are completed/skipped and this path is the sole enabler —
    // for simplicity in v1: skip transitive only when every predecessor is skipped or the predecessor set is subset of skipped+current.
    const preds = state.predecessors.get(next) ?? [];
    if (preds.every((pred) => state.skipped.has(pred) || state.completed.has(pred))) {
      const allSkipped = preds.every((pred) => state.skipped.has(pred) || pred === nodeId);
      if (allSkipped && !state.completed.has(next)) {
        skipTransitive(state, next, reason, emit);
      }
    }
  }
}

function skipNode(
  state: SchedulerState,
  nodeId: string,
  reason: string,
  emit: (event: WorkflowEventInput) => void,
): void {
  if (state.skipped.has(nodeId) || state.completed.has(nodeId)) return;
  const nodeState = state.nodes.get(nodeId);
  if (!nodeState) return;
  nodeState.status = "skipped";
  state.skipped.add(nodeId);
  state.completed.add(nodeId);
  state.ready = state.ready.filter((id) => id !== nodeId);
  emit({
    type: "node_skipped",
    workflowId: state.workflow.id,
    runId: state.runId,
    nodeId,
    reason,
    timestamp: nowIso(),
  });
  releaseSuccessors(state, nodeId, emit);
}

function releaseSuccessors(
  state: SchedulerState,
  nodeId: string,
  emit: (event: WorkflowEventInput) => void,
): void {
  for (const next of state.successors.get(nodeId) ?? []) {
    if (state.skipped.has(next) || state.completed.has(next)) continue;
    const degree = Math.max(0, (state.remainingIndegree.get(next) ?? 0) - 1);
    state.remainingIndegree.set(next, degree);
    if (degree === 0) {
      // If all predecessors skipped and node not already marked, leave ready for execution
      // unless every predecessor was skipped AND node was marked skipped transitively.
      if (state.skipped.has(next)) continue;
      state.nodes.get(next)!.status = "ready";
      if (!state.ready.includes(next) && !state.running.has(next)) {
        state.ready.push(next);
        state.ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  void emit;
}

function markRemaining(state: SchedulerState, status: "aborted" | "skipped"): void {
  for (const [nodeId, node] of state.nodes) {
    if (node.status === "pending" || node.status === "ready" || node.status === "running") {
      node.status = status;
      state.completed.add(nodeId);
      if (status === "skipped") state.skipped.add(nodeId);
    }
  }
  state.ready = [];
}

async function persistCheckpoint(
  state: SchedulerState,
  options: RunWorkflowOptions,
  emit: (event: WorkflowEventInput) => void,
): Promise<void> {
  if (!options.checkpoints) return;
  if (options.checkpointGuard && !options.checkpointGuard()) {
    throw new WorkflowCheckpointError("Workflow lease lost; checkpoint write fenced");
  }
  const expectedVersion = state.version;
  state.version += 1;
  const version = state.version;
  const nodes: Record<string, WorkflowNodeCheckpoint> = {};
  for (const [nodeId, node] of state.nodes) {
    nodes[nodeId] = {
      nodeId,
      status: node.status,
      output: node.output,
      error: node.error,
      attempt: node.attempt,
      sessionId: node.sessionId,
      leafId: node.leafId,
      runId: node.runId,
      stateVersionBefore: node.stateVersionBefore,
    };
  }
  const value: WorkflowCheckpointValue = {
    schemaVersion: WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
    workflowId: state.workflow.id,
    runId: state.runId,
    definitionHash: state.definitionHash,
    status: state.status,
    readyNodeIds: [...state.ready].sort((a, b) => a.localeCompare(b)),
    completedNodeIds: [...state.completed].sort((a, b) => a.localeCompare(b)),
    nodes,
    workflowInput: state.workflowInput,
    createdAt: state.createdAt,
    updatedAt: nowIso(),
    redacted: Boolean(options.redactor),
    suspension: state.suspension,
    resume: state.resume,
    state: cloneState(state.state),
    stateVersion: state.stateVersion,
    stateHistory: Object.fromEntries([...state.stateHistory].map(([version, value]) => [String(version), cloneState(value)])),
    lineage: state.lineage,
    metadata: options.metadata,
  };
  // Terminal writes must land even when the run signal is already aborted
  // (cancel finalization / durable aborted status for resume).
  const terminal =
    state.status === "succeeded"
    || state.status === "failed"
    || state.status === "aborted";
  const save = state.checkpointChain.then(async () => {
    await options.checkpoints!.save({
      workflowId: state.workflow.id,
      runId: state.runId,
      version,
      expectedVersion,
      fencingToken: options.fencingToken,
      ownership: options.ownership,
      value,
      signal: terminal ? undefined : options.signal,
    });
    emit({
      type: "checkpoint_saved",
      workflowId: state.workflow.id,
      runId: state.runId,
      version,
      timestamp: nowIso(),
    });
  });
  state.checkpointChain = save;
  await save;
}

function isWorkflowSuspension(value: unknown): value is WorkflowSuspension {
  return Boolean(
    value
    && typeof value === "object"
    && "type" in value
    && value.type === "workflow_suspend"
    && "reason" in value
    && typeof value.reason === "string",
  );
}

function resultFromRecord(
  workflowId: string,
  record: WorkflowCheckpointRecord,
): WorkflowRunResult {
  const outputs: Record<string, unknown> = {};
  for (const [nodeId, node] of Object.entries(record.value.nodes)) {
    if (node.status === "succeeded" && node.output !== undefined) outputs[nodeId] = node.output;
  }
  return {
    workflowId,
    runId: record.runId,
    status: record.value.status,
    version: record.version,
    outputs,
    suspension: record.value.suspension,
    resume: record.value.resume,
    state: cloneState(record.value.state ?? {}),
    lineage: record.value.lineage,
  };
}

function cloneState(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function parseStateHistory(
  history: Readonly<Record<string, JsonObject>> | undefined,
  current: JsonObject,
): Map<number, JsonObject> {
  const parsed = new Map<number, JsonObject>();
  for (const [key, value] of Object.entries(history ?? {})) {
    const version = Number(key);
    if (Number.isSafeInteger(version) && version >= 0) parsed.set(version, cloneState(value));
  }
  if (parsed.size === 0) parsed.set(0, cloneState(current));
  return parsed;
}

async function validateState(state: SchedulerState, options: RunWorkflowOptions): Promise<void> {
  const maxBytes = state.workflow.limits?.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES;
  assertWithinBytes(state.state, maxBytes, "Workflow state");
  if (state.workflow.state?.schema && !options.validateState) {
    throw new WorkflowRuntimeError("Workflow state schema requires validateState", "ERR_PRISM_WORKFLOW_STATE_VALIDATOR");
  }
  if (options.validateState) {
    await awaitSignal(Promise.resolve(options.validateState({
      value: cloneState(state.state),
      schema: state.workflow.state?.schema,
      signal: options.signal,
    })), options.signal);
  }
}

async function awaitSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function updateWorkflowState(
  state: SchedulerState,
  patch: JsonObject,
  updateOptions: import("./types.js").WorkflowStateUpdateOptions | undefined,
  options: RunWorkflowOptions,
): Promise<Readonly<JsonObject>> {
  let result: JsonObject = state.state;
  const update = state.stateChain.then(async () => {
    const next = updateOptions?.mode === "replace"
      ? cloneState(patch)
      : { ...cloneState(state.state), ...cloneState(patch) };
    const redacted = redactValue(next, options.redactor);
    const maxHistory = state.workflow.limits?.maxStateHistory ?? DEFAULT_MAX_STATE_HISTORY;
    if (state.stateVersion + 1 >= maxHistory) {
      throw new WorkflowRuntimeError(`Workflow state history exceeds maxStateHistory (${maxHistory})`, "ERR_PRISM_WORKFLOW_STATE_HISTORY");
    }
    const candidate: SchedulerState = { ...state, state: redacted };
    await validateState(candidate, options);
    state.state = redacted;
    state.stateVersion += 1;
    state.stateHistory.set(state.stateVersion, cloneState(redacted));
    result = cloneState(redacted);
  });
  state.stateChain = update;
  await update;
  return result;
}

/** Resolve the effective fan-out limit for a node. */
export function resolveMaxFanOut(workflow: WorkflowDefinition, node: WorkflowNodeDefinition): number {
  if (node.kind !== "fan_out") return DEFAULT_MAX_FAN_OUT;
  const workflowLimit = workflow.limits?.maxFanOut ?? DEFAULT_MAX_FAN_OUT;
  return Math.min(node.maxFanOut ?? workflowLimit, workflowLimit);
}

function validateRunOptions(options: RunWorkflowOptions): void {
  if (options.concurrency !== undefined) {
    validateWorkflowLimit("concurrency", options.concurrency, HARD_MAX_CONCURRENCY);
  }
  if (options.nestedDepth !== undefined
    && (!Number.isSafeInteger(options.nestedDepth) || options.nestedDepth < 0 || options.nestedDepth > HARD_MAX_NESTED_DEPTH)) {
    throw new WorkflowRuntimeError(`nestedDepth must be a non-negative safe integer at most ${HARD_MAX_NESTED_DEPTH}`);
  }
  if (options.nestedDepthLimit !== undefined) {
    validateWorkflowLimit("nestedDepthLimit", options.nestedDepthLimit, HARD_MAX_NESTED_DEPTH);
  }
}
