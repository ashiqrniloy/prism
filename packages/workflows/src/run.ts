import {
  assertExecutionAllowed,
  type AgentSession,
  type ContentBlock,
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
  DEFAULT_MAX_NODES,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
} from "./limits.js";
import type {
  WorkflowCheckpointAdapter,
  WorkflowCheckpointValue,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventBus,
  WorkflowEventInput,
  WorkflowNodeCheckpoint,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowNodeStatus,
  WorkflowRunResult,
  WorkflowRunStatus,
  RunWorkflowOptions,
} from "./types.js";
import {
  boundNodeOutput,
  combineSignals,
  createRunId,
  errorCode,
  errorMessage,
  hashWorkflowDefinition,
  isAbortError,
  nowIso,
  ownershipMatches,
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
  checkpointChain: Promise<void>;
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
  input: unknown,
  options: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const runId = options.runId ?? createRunId();
  const definitionHash = hashWorkflowDefinition(workflow);
  const graph = buildGraph(workflow);
  const createdAt = nowIso();

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
    checkpointChain: Promise.resolve(),
  };

  return executeScheduler(state, options);
}

export async function resumeWorkflow(
  workflow: WorkflowDefinition,
  ref: { readonly runId: string; readonly workflowId?: string },
  options: RunWorkflowOptions & { readonly checkpoints: WorkflowCheckpointAdapter },
): Promise<WorkflowRunResult> {
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
  if (record.value.status === "succeeded") {
    const outputs: Record<string, unknown> = {};
    for (const [nodeId, node] of Object.entries(record.value.nodes)) {
      if (node.status === "succeeded" && node.output !== undefined) outputs[nodeId] = node.output;
    }
    return {
      workflowId: workflow.id,
      runId: record.runId,
      status: "succeeded",
      version: record.version,
      outputs,
    };
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
    nodes.set(nodeId, {
      nodeId,
      status,
      output: status === "ready" ? undefined : saved?.output,
      error: status === "ready" ? undefined : saved?.error,
      attempt: status === "ready" ? undefined : saved?.attempt,
      sessionId: saved?.sessionId,
      leafId: saved?.leafId,
      runId: saved?.runId,
    });
    if (status === "succeeded" && saved?.output !== undefined) outputs.set(nodeId, saved.output);
    if (status === "succeeded" || status === "skipped") {
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
    status: "running",
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
    checkpointChain: Promise.resolve(),
  };

  return executeScheduler(state, options);
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
    controller: runController,
  });

  try {
    return await executeSchedulerBody(state, options);
  } finally {
    unregisterActiveWorkflowRun(state.workflow.id, state.runId);
  }
}

async function executeSchedulerBody(
  state: SchedulerState,
  options: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const concurrency = Math.max(
    1,
    options.concurrency
      ?? state.workflow.limits?.maxConcurrency
      ?? DEFAULT_MAX_CONCURRENCY,
  );
  const maxNodes = state.workflow.limits?.maxNodes ?? DEFAULT_MAX_NODES;
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

    emit({
      type: "workflow_finished",
      workflowId: state.workflow.id,
      runId: state.runId,
      status: state.status,
      timestamp: nowIso(),
    });

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
    try {
      if (options.signal?.aborted) throw new WorkflowAbortError();

      const timeoutSignal = node.timeoutMs
        ? AbortSignal.timeout(node.timeoutMs)
        : undefined;
      const signal = combineSignals([options.signal, timeoutSignal]);
      const ctx = createContext(state, nodeId, options, signal);

      const result = await executeNode(node, ctx, state, options, bus, activeSessions);
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
    signal,
    ownership: options.ownership,
    metadata: options.metadata,
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
        toolCallId: `wf_${ctx.nodeId}_${Date.now().toString(36)}`,
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
    case "agent": {
      if (!options.agentFactory) {
        throw new WorkflowRuntimeError("agentFactory is required for agent nodes");
      }
      const session = await options.agentFactory(node.agent);
      activeSessions.set(ctx.nodeId, session);
      const stopObserve = bus.observeAgentNode({ nodeId: ctx.nodeId, session });
      try {
        const input = node.input ? await node.input(ctx) : ctx.workflowInput;
        await session.run(toAgentInput(input), {
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
          : await defaultAgentOutput(session);
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

async function defaultAgentOutput(session: AgentSession): Promise<unknown> {
  const entries = await session.entries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (message?.role !== "assistant") continue;
    const text = message.content
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
    return text || message.content;
  }
  return null;
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

/** Patch fan-out to honor workflow.limits.maxFanOut — used by executeNode path. */
export function resolveMaxFanOut(workflow: WorkflowDefinition, node: WorkflowNodeDefinition): number {
  if (node.kind !== "fan_out") return DEFAULT_MAX_FAN_OUT;
  return node.maxFanOut ?? workflow.limits?.maxFanOut ?? DEFAULT_MAX_FAN_OUT;
}
