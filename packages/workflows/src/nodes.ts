import type {
  AgentNodeDefinition,
  ConditionalNodeDefinition,
  FanOutNodeDefinition,
  FunctionNodeDefinition,
  JoinNodeDefinition,
  ToolNodeDefinition,
} from "./types.js";

export function agentNode(
  config: Omit<AgentNodeDefinition, "kind">,
): AgentNodeDefinition {
  return { ...config, kind: "agent" };
}

export function functionNode(
  config: Omit<FunctionNodeDefinition, "kind">,
): FunctionNodeDefinition {
  return { ...config, kind: "function" };
}

export function toolNode(
  config: Omit<ToolNodeDefinition, "kind">,
): ToolNodeDefinition {
  return { ...config, kind: "tool" };
}

export function conditionalNode(
  config: Omit<ConditionalNodeDefinition, "kind">,
): ConditionalNodeDefinition {
  return { ...config, kind: "conditional" };
}

export function fanOutNode(
  config: Omit<FanOutNodeDefinition, "kind">,
): FanOutNodeDefinition {
  return { ...config, kind: "fan_out" };
}

export function joinNode(
  config: Omit<JoinNodeDefinition, "kind"> = {},
): JoinNodeDefinition {
  return { ...config, kind: "join" };
}
