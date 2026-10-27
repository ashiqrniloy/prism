import type { StoredAgentRunState } from "./agent-run-state.js";
import { Agent, JsonObject, PendingDecision, ToolDefinition, ToolExecutionContext, ToolRegistry } from "./contracts.js";
export declare function toolElicitationRequest(tool: ToolDefinition | undefined, args: JsonObject, context: ToolExecutionContext): {
    schema: JsonObject;
    reason?: string;
} | undefined;
/** Elicitation payload check: bounded JSON object, schema-required keys, host validator when configured. */
export declare function validateElicitationPayload(agent: Agent, state: StoredAgentRunState, target: PendingDecision, payload: JsonObject, signal?: AbortSignal): Promise<void>;
export declare function activeTools(agent: Agent): {
    registry: ToolRegistry;
    tools: readonly ToolDefinition[];
};
