import { WorkflowDefinitionError } from "./errors.js";
import { baseProblem, branchNameProblem } from "./nodes/worktree-ref.js";
import type {
  AgentNodeDefinition,
  ConditionalNodeDefinition,
  FanOutNodeDefinition,
  FunctionNodeDefinition,
  GateNodeDefinition,
  HumanGateNodeDefinition,
  JoinNodeDefinition,
  LoopNodeConfig,
  LoopNodeDefinition,
  NestedWorkflowNodeDefinition,
  RouteNodeConfig,
  RouteNodeDefinition,
} from "./types.js";

export function agentNode(config: Omit<AgentNodeDefinition, "kind">): AgentNodeDefinition {
  const worktree = config?.worktree;
  if (typeof worktree === "object" && worktree !== null) {
    // A literal branch or base is checked now; a function's result is checked when the node starts.
    const branch = typeof worktree.branch === "string" ? branchNameProblem(worktree.branch) : undefined;
    if (branch !== undefined) throw new WorkflowDefinitionError(`agentNode worktree.branch ${branch}`);
    const base = typeof worktree.base === "string" ? baseProblem(worktree.base) : undefined;
    if (base !== undefined) throw new WorkflowDefinitionError(`agentNode worktree.base ${base}`);
    for (const key of ["branch", "base"] as const) {
      const value = worktree[key];
      if (value !== undefined && typeof value !== "string" && typeof value !== "function") {
        throw new WorkflowDefinitionError(`agentNode worktree.${key} must be a string or a function`);
      }
    }
  }
  return { ...config, kind: "agent" };
}

export function functionNode(config: Omit<FunctionNodeDefinition, "kind">): FunctionNodeDefinition {
  return { ...config, kind: "function" };
}

export function loopNode(config: LoopNodeConfig): LoopNodeDefinition {
  return { ...config, kind: "loop" };
}

export function conditionalNode(config: Omit<ConditionalNodeDefinition, "kind">): ConditionalNodeDefinition {
  return { ...config, kind: "conditional" };
}

/**
 * Runs each item through the node `route` picks, at most `maxConcurrency` at once; the output is the item
 * results in item order. An item whose profile is busy waits instead of failing.
 */
export function fanOut(config: Omit<FanOutNodeDefinition, "kind">): FanOutNodeDefinition {
  if (typeof config?.items !== "function") throw new WorkflowDefinitionError("fanOut requires items()");
  if (typeof config.route !== "function") throw new WorkflowDefinitionError("fanOut requires route()");
  return { ...config, kind: "fan_out" };
}

export function joinNode(config: Omit<JoinNodeDefinition, "kind"> = {}): JoinNodeDefinition {
  return { ...config, kind: "join" };
}

export function workflowNode(config: Omit<NestedWorkflowNodeDefinition, "kind">): NestedWorkflowNodeDefinition {
  return { ...config, kind: "workflow" };
}

export function routeNode(config: RouteNodeConfig): RouteNodeDefinition {
  if (typeof config?.select !== "function") {
    throw new WorkflowDefinitionError("Route node requires select()");
  }
  return { ...config, kind: "route" };
}

/** A deterministic gate. It never calls a model; a failure routes back, bounded by `maxSupersteps`. */
export function gateNode(config: Omit<GateNodeDefinition, "kind">): GateNodeDefinition {
  if (typeof config?.check !== "function") throw new WorkflowDefinitionError("Gate node requires check()");
  return { ...config, kind: "gate" };
}

/** A gate that asks a person through `host.ui`, or suspends durably when no UI answers. */
export function humanGate(config: Omit<HumanGateNodeDefinition, "kind">): HumanGateNodeDefinition {
  const kind = (config?.request as { kind?: string } | undefined)?.kind;
  if (!kind) throw new WorkflowDefinitionError("Human gate requires a request");
  if (kind === "terminal" || kind === "secret") {
    throw new WorkflowDefinitionError(`Human gate cannot send a "${kind}" request: a gate never runs a terminal or collects secrets`);
  }
  return { ...config, kind: "human_gate" };
}
