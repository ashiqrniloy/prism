import { WorkflowDefinitionError, WorkflowLoopLimitError, WorkflowRuntimeError } from "../errors.js";
import { HARD_MAX_LOOP_ITERATIONS } from "../limits.js";
import type { SchedulerState } from "../run/main.js";
import { suspend } from "../run/main.js";
import { WORKFLOWS_SERVICE, type WorkflowRuntime } from "../services.js";
import type {
  GateNodeDefinition,
  GateNodeOutput,
  HumanGateNodeDefinition,
  RunWorkflowOptions,
  WorkflowNodeContext,
  WorkflowSuspension,
} from "../types.js";

const MAX_REASON_CHARS = 256;

/**
 * Where a failed gate sends the run: the named node, else `onFail`, else the gate's predecessor.
 * The target must be a declared successor (the back edge), as for a route node.
 */
export function gateFailTargets(state: SchedulerState, nodeId: string, explicit?: string, onFail?: string): readonly string[] {
  const successors = new Set(state.successors.get(nodeId) ?? []);
  const target = explicit ?? onFail ?? (state.predecessors.get(nodeId) ?? []).find((pred) => successors.has(pred));
  if (target === undefined || !successors.has(target)) {
    throw new WorkflowRuntimeError(
      `Gate "${nodeId}" failure target ${target === undefined ? "(its predecessor)" : `"${target}"`} is not a declared successor; add the back edge`,
      "ERR_PRISM_WORKFLOW_ROUTE_TARGET",
    );
  }
  return [target];
}

/** Successors a passing gate activates: every declared successor except the failure target. */
export function gatePassTargets(
  state: SchedulerState,
  nodeId: string,
  node: GateNodeDefinition | HumanGateNodeDefinition,
): readonly string[] {
  const fail = new Set(gateFailTargets(state, nodeId, undefined, node.onFail));
  return (state.successors.get(nodeId) ?? []).filter((id) => !fail.has(id));
}

function assertWithinBound(state: SchedulerState, nodeId: string, node: GateNodeDefinition | HumanGateNodeDefinition): void {
  const max = node.maxIterations ?? HARD_MAX_LOOP_ITERATIONS;
  const nodeState = state.nodes.get(nodeId);
  if ((nodeState?.iteration ?? 0) >= max) throw new WorkflowLoopLimitError(nodeId, max, nodeState?.lastOutput);
}

function fail(
  state: SchedulerState,
  nodeId: string,
  node: GateNodeDefinition | HumanGateNodeDefinition,
  reason: string,
  route?: string,
): GateNodeOutput {
  return {
    pass: false,
    reason: reason.slice(0, MAX_REASON_CHARS),
    route: gateFailTargets(state, nodeId, route, node.onFail),
  };
}

/** A gate never calls a model: the check sees only the node context. A throw or malformed result fails closed. */
export async function executeGate(node: GateNodeDefinition, ctx: WorkflowNodeContext, state: SchedulerState): Promise<GateNodeOutput> {
  assertWithinBound(state, ctx.nodeId, node);
  let result: Awaited<ReturnType<GateNodeDefinition["check"]>>;
  try {
    result = await node.check(ctx);
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    return fail(state, ctx.nodeId, node, "check_threw");
  }
  if (result?.pass === true) return { pass: true, ...(result.output === undefined ? {} : { output: result.output }) };
  if (result?.pass === false && typeof result.reason === "string") return fail(state, ctx.nodeId, node, result.reason, result.route);
  return fail(state, ctx.nodeId, node, "check_invalid");
}

/**
 * Ask through `host.ui` as the workflows package. No UI (or an `unavailable` answer) suspends the
 * workflow durably; `resumeWorkflow` with the answer as `input` continues it.
 */
export async function executeHumanGate(
  node: HumanGateNodeDefinition,
  ctx: WorkflowNodeContext,
  state: SchedulerState,
  options: RunWorkflowOptions,
): Promise<GateNodeOutput | WorkflowSuspension<unknown>> {
  assertWithinBound(state, ctx.nodeId, node);
  if (ctx.resume) return { pass: true, output: ctx.resume.input };
  const runtime = options.parent?.prism.services.consume<WorkflowRuntime>(WORKFLOWS_SERVICE);
  const kind = node.request.kind;
  const ui = runtime?.host.ui;
  if (ui) {
    let response: Awaited<ReturnType<typeof ui.request>>;
    try {
      response = await ui.request(node.request as never);
    } catch (error) {
      if ((error as { code?: string })?.code === "capability_missing") {
        throw new WorkflowDefinitionError(`Human gate "${ctx.nodeId}" needs the host-ui capability on the workflows package`);
      }
      throw error;
    }
    if (response.status === "answered") {
      const value = response.value;
      if (kind === "confirm" && value === false) return fail(state, ctx.nodeId, node, "declined");
      return { pass: true, ...(value === undefined ? {} : { output: value }) };
    }
    if (response.status === "dismissed") return fail(state, ctx.nodeId, node, "dismissed");
  }
  return suspend({ reason: "human_gate_unavailable", data: { nodeId: ctx.nodeId, kind } });
}
