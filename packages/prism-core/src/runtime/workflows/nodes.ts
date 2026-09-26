import { WorkflowDefinitionError } from "./errors.js";
import type {
  AgentNodeDefinition,
  ConditionalNodeDefinition,
  FanOutNodeDefinition,
  FunctionNodeDefinition,
  JoinNodeDefinition,
  LoopNodeConfig,
  LoopNodeDefinition,
  NestedWorkflowNodeDefinition,
  RouteNodeConfig,
  RouteNodeDefinition,
  ToolNodeDefinition,
} from "./types.js";

export function agentNode(config: Omit<AgentNodeDefinition, "kind">): AgentNodeDefinition {
  return { ...config, kind: "agent" };
}

export function functionNode(config: Omit<FunctionNodeDefinition, "kind">): FunctionNodeDefinition {
  return { ...config, kind: "function" };
}

export function loopNode(config: LoopNodeConfig): LoopNodeDefinition {
  return { ...config, kind: "loop" };
}

export function toolNode(config: Omit<ToolNodeDefinition, "kind">): ToolNodeDefinition {
  return { ...config, kind: "tool" };
}

export function conditionalNode(config: Omit<ConditionalNodeDefinition, "kind">): ConditionalNodeDefinition {
  return { ...config, kind: "conditional" };
}

export function fanOutNode(config: Omit<FanOutNodeDefinition, "kind">): FanOutNodeDefinition {
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
