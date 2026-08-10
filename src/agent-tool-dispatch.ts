// Tool-dispatch helpers split from agents.ts at 0.1.4 (verbatim move; internal, not public API).
import type { StoredAgentRunState } from "./agent-run-state.js";
import {
  Agent,
  AgentConfig,
  AgentDecisionError,
  HARD_MAX_ELICITATION_BYTES,
  JsonObject,
  MAX_DECISION_REASON_BYTES,
  MAX_ELICITATION_BYTES,
  PendingDecision,
  ProviderRequestPolicy,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
} from "./contracts.js";
import { createToolRegistry } from "./tools.js";

export function toolElicitationRequest(
  tool: ToolDefinition | undefined,
  args: JsonObject,
  context: ToolExecutionContext,
): { schema: JsonObject; reason?: string } | undefined {
  if (!tool?.elicitation) return undefined;
  let request: { readonly schema: JsonObject; readonly reason?: string; readonly validate?: (payload: JsonObject) => void } | undefined;
  try {
    request = tool.elicitation(args, context);
  } catch {
    return undefined;
  }
  if (!request) return undefined;
  const schemaText = JSON.stringify(request.schema);
  if (schemaText === undefined || Buffer.byteLength(schemaText, "utf8") > HARD_MAX_ELICITATION_BYTES) return undefined;
  const reason = request.reason;
  if (reason !== undefined && Buffer.byteLength(reason, "utf8") > MAX_DECISION_REASON_BYTES) return { schema: request.schema };
  return { schema: request.schema, ...(reason !== undefined ? { reason } : {}) };
}

/** Elicitation payload check: bounded JSON object, schema-required keys, host validator when configured. */
export async function validateElicitationPayload(
  agent: Agent,
  state: StoredAgentRunState,
  target: PendingDecision,
  payload: JsonObject,
  signal?: AbortSignal,
): Promise<void> {
  const invalid = (message: string) => new AgentDecisionError("ERR_PRISM_DECISION_INVALID", message);
  const text = JSON.stringify(payload);
  if (text === undefined || Buffer.byteLength(text, "utf8") > MAX_ELICITATION_BYTES) {
    throw new AgentDecisionError("ERR_PRISM_DECISION_LIMIT", `Elicitation payload exceeds ${MAX_ELICITATION_BYTES} bytes`);
  }
  const schema = target.elicitationSchema;
  if (schema) {
    const required = (schema as { required?: unknown }).required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !Object.hasOwn(payload, key)) throw invalid(`Elicitation payload missing required key ${key}`);
      }
    }
    if (agent.config.validator) {
      const tool: ToolDefinition = {
        name: target.scope.toolName ?? "elicitation",
        parameters: schema,
        execute: () => ({ toolCallId: "", name: "elicitation" }),
      };
      const context = { sessionId: state.sessionId, runId: state.runId, toolCallId: target.toolCallId ?? "elicitation", signal };
      const validation = await agent.config.validator(tool, payload, context);
      if (validation) throw invalid("Elicitation payload failed schema validation");
    }
  }
  // Tool-declared answer-shape validation, re-derived from the current registry (never persisted).
  const call = state.pendingCalls?.find((entry) => entry.call.id === target.toolCallId)?.call;
  const tool = call ? activeTools(agent.config.tools).registry.get(call.name) : undefined;
  const validate =
    tool?.elicitation && call
      ? safeToolElicitationValidate(tool, call.arguments, {
          sessionId: state.sessionId,
          runId: state.runId,
          toolCallId: target.toolCallId ?? "elicitation",
          signal,
        })
      : undefined;
  if (validate) {
    try {
      validate(payload);
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : "Elicitation payload rejected by tool validation");
    }
  }
}

function safeToolElicitationValidate(
  tool: ToolDefinition,
  args: JsonObject,
  context: ToolExecutionContext,
): ((payload: JsonObject) => void) | undefined {
  try {
    return tool.elicitation!(args, context)?.validate;
  } catch {
    return undefined;
  }
}

export function activeTools(tools: AgentConfig["tools"]): { registry: ToolRegistry; tools: readonly ToolDefinition[] } {
  if (!tools) return { registry: createToolRegistry(), tools: [] };
  if ("list" in tools) return { registry: tools, tools: tools.list() };
  const registry = createToolRegistry(tools);
  return { registry, tools };
}

export function policyList(
  policies: ProviderRequestPolicy | readonly ProviderRequestPolicy[] | undefined,
): readonly ProviderRequestPolicy[] {
  if (!policies) return [];
  return "apply" in policies ? [policies] : policies;
}
