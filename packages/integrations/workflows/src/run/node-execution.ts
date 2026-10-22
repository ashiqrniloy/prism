/** node-execution (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */

import type { Session } from "@arnilo/prism";
import { WorkflowAbortError, WorkflowCheckpointError, WorkflowLoopLimitError, WorkflowRuntimeError } from "../errors.js";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_NESTED_DEPTH,
  HARD_MAX_LOOP_ITERATIONS,
  validateWorkflowLimit,
  WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
} from "../limits.js";
import { executeAgentNode } from "../nodes/agent-node.js";
import { DEFAULT_MAX_PROFILE_BACKOFF_MS, runFanOutPool } from "../nodes/fan-out.js";
import { executeGate, executeHumanGate, gatePassTargets } from "../nodes/gate.js";
import { createScopedState } from "../scoped.js";
import type {
  GateNodeOutput,
  RunWorkflowOptions,
  WorkflowEventInput,
  WorkflowLoopIterationRecord,
  WorkflowLoopNodeContext,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowSuspensionDescriptor,
  WorkflowTransitionChannel,
} from "../types.js";
import {
  boundNodeOutput,
  combineSignals,
  errorCode,
  errorMessage,
  isAbortError,
  nodeIdempotency,
  nowIso,
  sleep,
  workflowLoopIterationId,
} from "../util.js";
import { cloneState, isCheckpointFailure, isWorkflowSuspension, persistCheckpoint } from "./checkpoint.js";
import type { SchedulerState } from "./main.js";
import { resolveMaxFanOut, resumeWorkflow, runWorkflow, suspend } from "./main.js";
import { applyConditionalSkip, applyRouteSkip, releaseSuccessors } from "./skip.js";
import { updateWorkflowState } from "./validation.js";

export async function runNode(
  state: SchedulerState,
  nodeId: string,
  options: RunWorkflowOptions,
  bus: WorkflowTransitionChannel,
  emit: (event: WorkflowEventInput) => Promise<void>,
  activeSessions: Map<string, Session>,
): Promise<void> {
  const node = state.workflow.nodes[nodeId]!;
  const nodeState = state.nodes.get(nodeId)!;
  if (node.kind === "loop" && nodeState.iteration && !nodeState.iterations) {
    nodeState.iterations = Array.from({ length: nodeState.iteration }, (_, iteration) => ({
      schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
      iteration,
      iterationId: workflowLoopIterationId(state.workflow.id, state.runId, nodeId, iteration, options.ownership?.tenantId),
      done: false,
      ...(iteration === nodeState.iteration! - 1 && nodeState.lastOutput !== undefined ? { output: nodeState.lastOutput } : {}),
    }));
  }
  const isSupersteps = state.workflow.execution === "supersteps";
  const iteration = isSupersteps ? (nodeState.iteration ?? 0) : undefined;
  nodeState.status = "running";
  nodeState.attempt = 1;
  await emit({
    type: "node_started",
    workflowId: state.workflow.id,
    runId: state.runId,
    nodeId,
    ...(iteration !== undefined ? { iteration } : {}),
    timestamp: nowIso(),
  });
  // A superstep wave checkpoints at its barrier, so a node that must not rerun records its start first.
  if (!isSupersteps || nodeIdempotency(node) === "fail") {
    await persistCheckpoint(state, options, emit);
  }

  const retries = node.retries ?? 0;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    attempt += 1;
    nodeState.attempt = attempt;
    nodeState.stateVersionBefore ??= state.stateVersion;
    nodeState.currentIterationStateVersionBefore = state.stateVersion;
    let result: Awaited<ReturnType<typeof executeNode>>;
    try {
      if (options.signal?.aborted) throw new WorkflowAbortError();

      const timeoutSignal = node.timeoutMs ? AbortSignal.timeout(node.timeoutMs) : undefined;
      const signal = combineSignals([options.signal, timeoutSignal]);
      const ctx = createContext(state, nodeId, options, signal);

      result = await executeNode(
        node,
        ctx,
        state,
        options,
        bus,
        activeSessions,
        node.kind === "loop"
          ? async (iteration, iterationId) =>
              emit({
                type: "node_iteration_started",
                workflowId: state.workflow.id,
                runId: state.runId,
                nodeId,
                iteration,
                iterationId,
                timestamp: nowIso(),
              })
          : undefined,
        node.kind === "loop"
          ? async (iteration, iterationId, output, done) => {
              const previousIteration = nodeState.iteration;
              const previousOutput = nodeState.lastOutput;
              const previousIterations = nodeState.iterations;
              const iterations = previousIterations ?? [];
              nodeState.iterations = iterations;
              iterations.push({
                schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
                iteration,
                iterationId,
                done,
                ...(output === undefined ? {} : { output }),
              } satisfies WorkflowLoopIterationRecord);
              nodeState.iteration = iteration + 1;
              nodeState.lastOutput = output;
              try {
                await persistCheckpoint(state, options, emit);
              } catch (error) {
                iterations.pop();
                nodeState.iteration = previousIteration;
                nodeState.lastOutput = previousOutput;
                nodeState.iterations = previousIterations;
                throw error;
              }
              await emit({
                type: "node_iteration_finished",
                workflowId: state.workflow.id,
                runId: state.runId,
                nodeId,
                iteration,
                iterationId,
                done,
                ...(output === undefined ? {} : { output }),
                timestamp: nowIso(),
              });
            }
          : undefined,
        // The child session and worktree are durable before the agent runs, so a kill can reopen them.
        async () => persistCheckpoint(state, options, emit),
      );
    } catch (error) {
      if (isCheckpointFailure(error)) throw error;
      lastError = error;
      activeSessions.delete(nodeId);
      if (isAbortError(error) || options.signal?.aborted) {
        nodeState.status = "aborted";
        nodeState.error = { message: errorMessage(error), code: errorCode(error) };
        await emit({
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
      await emit({
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

    if (isWorkflowSuspension(result.output)) {
      if (!options.checkpoints) {
        throw new WorkflowRuntimeError("Durable workflow suspension requires checkpoints", "ERR_PRISM_WORKFLOW_SUSPEND");
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
        data:
          result.output.data === undefined
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
      await persistCheckpoint(state, options, emit);
      await emit({
        type: "workflow_suspended",
        workflowId: state.workflow.id,
        runId: state.runId,
        suspension: descriptor,
        timestamp: descriptor.requestedAt,
      });
      return;
    }
    const output = boundNodeOutput(result.output, {
      maxNodeOutputBytes: state.workflow.limits?.maxNodeOutputBytes,
      redactor: options.redactor,
    });
    await onNodeSucceeded(state, nodeId, output, result, options, emit);
    return;
  }

  throw lastError instanceof Error ? lastError : new WorkflowRuntimeError(errorMessage(lastError));
}

export async function onNodeSucceeded(
  state: SchedulerState,
  nodeId: string,
  output: unknown,
  result: { sessionId?: string; leafId?: string; runId?: string },
  options: RunWorkflowOptions,
  emit: (event: WorkflowEventInput) => Promise<void>,
): Promise<void> {
  const node = state.workflow.nodes[nodeId];
  const nodeState = state.nodes.get(nodeId);
  if (!node || !nodeState) return;
  const isSupersteps = state.workflow.execution === "supersteps";
  const iteration = nodeState.iteration ?? 0;

  nodeState.status = "succeeded";
  nodeState.output = output;
  nodeState.lastOutput = undefined;
  nodeState.error = undefined;
  if (result.sessionId) nodeState.sessionId = result.sessionId;
  if (result.leafId) nodeState.leafId = result.leafId;
  if (result.runId) nodeState.runId = result.runId;
  state.outputs.set(nodeId, output);
  state.completed.add(nodeId);

  if (isSupersteps) {
    if (node.kind !== "loop") {
      const iterations = nodeState.iterations ?? [];
      nodeState.iterations = iterations;
      iterations.push({
        schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
        iteration,
        iterationId: workflowLoopIterationId(state.workflow.id, state.runId, nodeId, iteration, options.ownership?.tenantId),
        done: false,
        ...(output === undefined ? {} : { output }),
        ...(nodeState.currentIterationStateVersionBefore !== undefined
          ? { stateVersionBefore: nodeState.currentIterationStateVersionBefore }
          : {}),
      });
      nodeState.iteration = iteration + 1;
      nodeState.lastOutput = output;
    }

    postSuperstepActivations(state, nodeId, node, output);
  } else {
    if (node.kind === "conditional") {
      await applyConditionalSkip(state, nodeId, Boolean(output), emit);
    } else if (node.kind === "route") {
      await applyRouteSkip(state, nodeId, (output as readonly string[]) ?? [], emit);
    }
    await persistCheckpoint(state, options, emit);
    await emit({
      type: "node_finished",
      workflowId: state.workflow.id,
      runId: state.runId,
      nodeId,
      timestamp: nowIso(),
    });
    releaseSuccessors(state, nodeId, emit);
  }
}

function postSuperstepActivations(state: SchedulerState, nodeId: string, node: WorkflowNodeDefinition, output: unknown): void {
  let targets: readonly string[];
  if (node.kind === "gate" || node.kind === "human_gate") {
    const result = output as GateNodeOutput;
    targets = result.pass ? gatePassTargets(state, nodeId, node) : result.route;
  } else if (node.kind === "route") {
    targets = Array.isArray(output) ? (output as readonly string[]) : [];
  } else if (node.kind === "conditional") {
    const passed = Boolean(output);
    const successors = state.successors.get(nodeId) ?? [];
    targets = passed ? (node.then ?? successors) : (node.else ?? []);
  } else {
    targets = state.successors.get(nodeId) ?? [];
  }

  for (const target of targets) {
    let pending = state.pendingActivations?.get(target);
    if (!pending) {
      pending = { from: new Set(), round: state.superstep ?? 0 };
      state.pendingActivations?.set(target, pending);
    }
    pending.from.add(nodeId);
  }
}

function createContext(state: SchedulerState, nodeId: string, options: RunWorkflowOptions, signal?: AbortSignal): WorkflowNodeContext {
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
    resume:
      state.resume?.nodeId === nodeId && state.resume.decision === "approve"
        ? { input: state.resumeInput, resumedAt: state.resume.resumedAt }
        : undefined,
  };
}

async function executeNode(
  node: WorkflowNodeDefinition,
  ctx: WorkflowNodeContext,
  state: SchedulerState,
  options: RunWorkflowOptions,
  bus: WorkflowTransitionChannel,
  activeSessions: Map<string, Session>,
  onLoopIterationStart?: (iteration: number, iterationId: string) => Promise<void>,
  onLoopIteration?: (iteration: number, iterationId: string, output: unknown, done: boolean) => Promise<void>,
  onAgentOpened?: () => Promise<void>,
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
    case "route": {
      const selected = await node.select(ctx);
      if (isWorkflowSuspension(selected)) return { output: selected };
      if (!Array.isArray(selected)) {
        throw new WorkflowRuntimeError(
          `Route node "${ctx.nodeId}" select() must return an array of target node ids`,
          "ERR_PRISM_WORKFLOW_ROUTE_TARGET",
        );
      }
      const declaredSuccessors = new Set(state.successors.get(ctx.nodeId) ?? []);
      for (const target of selected) {
        if (typeof target !== "string" || !declaredSuccessors.has(target)) {
          throw new WorkflowRuntimeError(
            `Route node "${ctx.nodeId}" selected undeclared successor "${target}"`,
            "ERR_PRISM_WORKFLOW_ROUTE_TARGET",
          );
        }
      }
      return { output: [...new Set(selected)] };
    }
    case "fan_out": {
      const items = await node.items(ctx);
      const effectiveLimit = resolveMaxFanOut(state.workflow, node);
      if (items.length > effectiveLimit) {
        throw new WorkflowRuntimeError(`Fan-out exceeded maxFanOut (${items.length} > ${effectiveLimit})`, "ERR_PRISM_WORKFLOW_FANOUT");
      }
      const workflowConcurrency = state.workflow.limits?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
      const concurrency = Math.min(
        node.maxConcurrency ?? workflowConcurrency,
        options.concurrency ?? workflowConcurrency,
        workflowConcurrency,
      );
      const routed = items.map((item, index) => {
        const target = node.route(item, index, ctx);
        if (target === null || typeof target !== "object" || !["agent", "function", "workflow"].includes(target.kind)) {
          throw new WorkflowRuntimeError(
            `Fan-out "${ctx.nodeId}" route() must return an agent, function, or workflow node (item ${index})`,
            "ERR_PRISM_WORKFLOW_FANOUT",
          );
        }
        return target;
      });
      const outputs = await runFanOutPool(
        items.length,
        async (index) => {
          const itemCtx: WorkflowNodeContext = { ...ctx, nodeId: `${ctx.nodeId}[${index}]` };
          const result = await executeNode(routed[index]!, itemCtx, state, options, bus, activeSessions);
          if (isWorkflowSuspension(result.output)) {
            throw new WorkflowRuntimeError(
              `Fan-out "${ctx.nodeId}" item ${index} suspended; items cannot suspend`,
              "ERR_PRISM_WORKFLOW_FANOUT",
            );
          }
          return result.output;
        },
        { concurrency, maxBackoffMs: node.maxProfileBackoffMs ?? DEFAULT_MAX_PROFILE_BACKOFF_MS, signal: ctx.signal },
      );
      return { output: outputs };
    }
    case "join": {
      const from = node.from ?? (Object.keys(ctx.upstream).length === 1 ? Object.keys(ctx.upstream)[0] : undefined);
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
    case "loop": {
      const maxIterations = validateWorkflowLimit(`Node "${ctx.nodeId}" maxIterations`, node.maxIterations, HARD_MAX_LOOP_ITERATIONS);
      const nodeState = state.nodes.get(ctx.nodeId);
      const firstIteration = nodeState?.iteration ?? 0;
      const lastIteration = nodeState?.iterations?.at(-1);
      if (lastIteration?.done && firstIteration === nodeState?.iterations?.length) {
        return { output: lastIteration.output };
      }
      let previousOutput = nodeState?.lastOutput;
      for (let iteration = firstIteration; iteration < maxIterations; iteration += 1) {
        if (ctx.signal?.aborted) throw new WorkflowAbortError();
        const iterationId = workflowLoopIterationId(ctx.workflowId, ctx.runId, ctx.nodeId, iteration, ctx.ownership?.tenantId);
        await onLoopIterationStart?.(iteration, iterationId);
        const loopContext: WorkflowLoopNodeContext = {
          ...createContext(state, ctx.nodeId, options, ctx.signal),
          iteration,
          iterationId,
          previousOutput,
          ...(iteration === firstIteration ? {} : { resume: undefined }),
        };
        const bodyResult = node.execute
          ? { output: await node.execute(loopContext) }
          : await executeNode(node.body as WorkflowNodeDefinition, loopContext, state, options, bus, activeSessions);
        if (isWorkflowSuspension(bodyResult.output)) return bodyResult;
        const output = boundNodeOutput(bodyResult.output, {
          maxNodeOutputBytes: state.workflow.limits?.maxNodeOutputBytes,
          redactor: options.redactor,
        });
        const predicateContext: WorkflowLoopNodeContext = {
          ...createContext(state, ctx.nodeId, options, ctx.signal),
          iteration,
          iterationId,
          previousOutput: output,
          ...(iteration === firstIteration ? {} : { resume: undefined }),
        };
        const done = await node.until(predicateContext);
        previousOutput = output;
        await onLoopIteration?.(iteration, iterationId, output, done);
        if (done) return { output };
      }
      throw new WorkflowLoopLimitError(ctx.nodeId, maxIterations, previousOutput);
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
        initialState: node.scope ? createScopedState(state.state, node.scope) : cloneState(state.state),
        transitions: bus,
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
        return {
          output: suspend({
            reason: childSuspension.reason,
            data: childSuspension.data,
            resumeSchema: childSuspension.resumeSchema,
          }),
        };
      }
      const result =
        existing && options.checkpoints
          ? await resumeWorkflow(
              node.workflow,
              { workflowId: node.workflow.id, runId: childRunId },
              {
                ...childOptions,
                checkpoints: options.checkpoints,
                resume:
                  existing.value.status === "suspended" && ctx.resume
                    ? { decision: "approve", input: ctx.resume.input, expectedVersion: existing.version }
                    : undefined,
              },
            )
          : await runWorkflow(node.workflow, childInput, childOptions);
      if (result.status === "suspended") {
        return {
          output: suspend({
            reason: result.suspension?.reason ?? "Nested workflow suspended",
            data: result.suspension?.data,
            resumeSchema: result.suspension?.resumeSchema,
          }),
        };
      }
      if (node.scope) {
        await ctx.updateState({ [node.scope]: result.state }, { mode: "merge" });
      } else {
        await ctx.updateState(result.state, { mode: "replace" });
      }
      return { output: node.output ? await node.output(result, ctx) : result.outputs, runId: result.runId };
    }
    case "gate":
      return { output: await executeGate(node, ctx, state) };
    case "human_gate":
      return { output: await executeHumanGate(node, ctx, state, options) };
    case "agent":
      // Only a top-level agent node is durable by id; fan-out items and loop bodies run under derived ids.
      return executeAgentNode(
        node,
        ctx,
        options,
        bus,
        activeSessions,
        state.workflow.nodes[ctx.nodeId] === node ? { nodeState: state.nodes.get(ctx.nodeId)!, opened: onAgentOpened } : undefined,
      );
    default: {
      const _exhaustive: never = node;
      throw new WorkflowRuntimeError(`Unknown node kind ${(_exhaustive as WorkflowNodeDefinition).kind}`);
    }
  }
}
