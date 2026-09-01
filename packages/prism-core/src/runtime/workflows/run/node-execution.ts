/** node-execution (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */

import { randomUUID } from "node:crypto";
import type { AgentSession, Message, ToolDefinition, ToolExecutionContext } from "@arnilo/prism";
import { assertExecutionAllowed, createToolRegistry, dispatchToolCall } from "@arnilo/prism";
import { WorkflowAbortError, WorkflowCheckpointError, WorkflowLoopLimitError, WorkflowRuntimeError } from "../errors.js";
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_NESTED_DEPTH,
  HARD_MAX_LOOP_ITERATIONS,
  validateWorkflowLimit,
  WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
} from "../limits.js";
import type {
  RunWorkflowOptions,
  WorkflowEventBus,
  WorkflowEventInput,
  WorkflowLoopIterationRecord,
  WorkflowLoopNodeContext,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowSuspensionDescriptor,
} from "../types.js";
import { boundNodeOutput, combineSignals, errorCode, errorMessage, isAbortError, nowIso, sleep, workflowLoopIterationId } from "../util.js";
import { cloneState, isWorkflowSuspension, persistCheckpoint } from "./checkpoint.js";
import type { SchedulerState } from "./main.js";
import { resolveMaxFanOut, resumeWorkflow, runWorkflow, suspend } from "./main.js";
import { applyConditionalSkip, releaseSuccessors } from "./skip.js";
import { updateWorkflowState } from "./validation.js";

export async function runNode(
  state: SchedulerState,
  nodeId: string,
  options: RunWorkflowOptions,
  bus: WorkflowEventBus,
  emit: (event: WorkflowEventInput) => void,
  activeSessions: Map<string, AgentSession>,
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

      const timeoutSignal = node.timeoutMs ? AbortSignal.timeout(node.timeoutMs) : undefined;
      const signal = combineSignals([options.signal, timeoutSignal]);
      const ctx = createContext(state, nodeId, options, signal);

      const result = await executeNode(
        node,
        ctx,
        state,
        options,
        bus,
        activeSessions,
        node.kind === "loop"
          ? (iteration, iterationId) =>
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
              emit({
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
      );
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
      nodeState.lastOutput = undefined;
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

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: unknown;
  const runners = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (true) {
      if (failed) return;
      if (signal?.aborted) {
        failed = new WorkflowAbortError();
        throw failed;
      }
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (error) {
        failed = error;
        throw error;
      }
    }
  });
  try {
    await Promise.all(runners);
  } catch (error) {
    await Promise.allSettled(runners);
    throw error;
  }
  return results;
}

async function executeNode(
  node: WorkflowNodeDefinition,
  ctx: WorkflowNodeContext,
  state: SchedulerState,
  options: RunWorkflowOptions,
  bus: WorkflowEventBus,
  activeSessions: Map<string, AgentSession>,
  onLoopIterationStart?: (iteration: number, iterationId: string) => void,
  onLoopIteration?: (iteration: number, iterationId: string, output: unknown, done: boolean) => Promise<void>,
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
        throw new WorkflowRuntimeError(`Fan-out exceeded maxFanOut (${items.length} > ${effectiveLimit})`, "ERR_PRISM_WORKFLOW_FANOUT");
      }
      const workflowConcurrency = state.workflow.limits?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
      const concurrency = Math.min(options.concurrency ?? workflowConcurrency, workflowConcurrency);
      return {
        output: await mapPool(items, concurrency, (item, index) => Promise.resolve(node.map(item, index, ctx)), ctx.signal),
      };
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
        onLoopIterationStart?.(iteration, iterationId);
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
      const result = await dispatchToolCall({
        call: { type: "tool_call", id: toolContext.toolCallId, name: tool.name, arguments: args },
        registry: createToolRegistry([tool]),
        context: toolContext,
        guardrails: options.guardrails,
        redactor: options.redactor,
        ledger: options.runLedger,
        ownership: options.ownership,
        beforeExecute: async () => {
          await assertExecutionAllowed(options.executionPolicy, enriched);
        },
      });
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
          limits: options.limits,
          ownership: options.ownership,
          identity: options.identity,
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

function resolveTool(tool: ToolDefinition | string, options: RunWorkflowOptions): ToolDefinition {
  if (typeof tool !== "string") return tool;
  if (!options.tools) {
    throw new WorkflowRuntimeError(`Tool "${tool}" requires RunWorkflowOptions.tools`);
  }
  const resolved = typeof options.tools === "function" ? options.tools(tool) : options.tools[tool];
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
  return Boolean(value && typeof value === "object" && "role" in value && "content" in value && Array.isArray((value as Message).content));
}
