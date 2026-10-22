import type { EventOrigin, JsonObject, RunController, ToolCallContent, ToolCapabilityKind, ToolDefinition, ToolResult } from "../index.js";
import { DriverError } from "./errors.js";
import { ALL_TOOL_EFFECTS } from "./normalize/effects.js";

/** A bridged tool as the vendor sees it: the name, description, input schema, and the effects the gate reports. */
export interface BridgedToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonObject;
  readonly effects: readonly ToolCapabilityKind[];
}

export interface ToolBridge {
  readonly tools: readonly BridgedToolDefinition[];
  /** Runs one call through `RunController.executeTools`, so `tool.call` and `tool.execute` fire as for any tool. */
  invoke(call: ToolCallContent): Promise<ToolResult>;
}

export interface BridgeToolsOptions {
  readonly origin: EventOrigin;
  /** The tool definitions to resolve against. A driver passes the agent's list (`DriverRunContext.tools`). */
  readonly tools: readonly ToolDefinition[];
}

const EMPTY_SCHEMA: JsonObject = { type: "object", properties: {} };

/**
 * Exposes the named tools to a vendor. A name that is not registered fails before anything is exposed, and
 * `invoke` refuses any call whose name was not bridged.
 */
export function bridgeTools(run: RunController, names: readonly string[], options: BridgeToolsOptions): ToolBridge {
  const registry = new Map(options.tools.map((tool) => [tool.name, tool] as const));
  const missing = names.filter((name) => !registry.has(name));
  if (missing.length > 0) throw new DriverError("unknown_tool", `no registered tool named ${missing.join(", ")}`);
  const bridged = new Set(names);
  const tools = names.map((name): BridgedToolDefinition => {
    const tool = registry.get(name) as ToolDefinition;
    return {
      name,
      description: tool.description ?? "",
      schema: tool.parameters ?? EMPTY_SCHEMA,
      effects: tool.effects ?? ALL_TOOL_EFFECTS,
    };
  });
  return {
    tools,
    async invoke(call) {
      if (!bridged.has(call.name)) throw new DriverError("unknown_tool", `${call.name} was not bridged to this run`);
      const [result] = await run.executeTools([call], { origin: options.origin });
      if (result === undefined) throw new DriverError("unknown_tool", `${call.name} produced no result`);
      return result;
    },
  };
}
