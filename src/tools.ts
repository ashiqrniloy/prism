import type { AgentEvent, ErrorInfo, JsonObject, ToolCallContent, ToolDefinition, ToolExecutionContext, ToolRegistry, ToolResult } from "./contracts.js";
import { isJsonObject } from "./config.js";
import type { MiddlewareRegistry } from "./middleware.js";
import { errorToErrorInfo, redactSecrets, type SecretRedactor } from "./redaction.js";
import { assertPermission, type PermissionPolicy } from "./security.js";

export interface ToolFilter {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export type ToolFilterInput = ToolFilter | readonly ToolFilter[];
export type ToolValidator = (tool: ToolDefinition, args: JsonObject, context: ToolExecutionContext) => void | string | ErrorInfo | Promise<void | string | ErrorInfo>;

export interface DispatchToolCallOptions {
  readonly call: ToolCallContent;
  readonly registry: ToolRegistry;
  readonly context: ToolExecutionContext;
  readonly filter?: ToolFilterInput;
  readonly middleware?: MiddlewareRegistry;
  readonly validate?: ToolValidator;
  readonly emit?: (event: AgentEvent) => void | Promise<void>;
  readonly secrets?: readonly (string | undefined)[];
  readonly permission?: PermissionPolicy;
  readonly redactor?: SecretRedactor;
}

export function createToolRegistry(tools: readonly ToolDefinition[] = []): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();

  const registry: ToolRegistry = {
    register(tool) {
      byName.set(tool.name, tool);
    },
    get(name) {
      return byName.get(name);
    },
    resolve(name) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool;
    },
    list() {
      return [...byName.values()];
    },
  };

  for (const tool of tools) registry.register(tool);
  return registry;
}

export function filterTools(tools: readonly ToolDefinition[], filter?: ToolFilterInput): readonly ToolDefinition[] {
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
  const denied = new Set(filters.flatMap((item) => item.deny ?? []));
  const allows = filters.map((item) => item.allow?.length ? new Set(item.allow) : undefined).filter((item): item is Set<string> => Boolean(item));

  return tools.filter((tool) => !denied.has(tool.name) && allows.every((allow) => allow.has(tool.name)));
}

export async function dispatchToolCall(options: DispatchToolCallOptions): Promise<ToolResult> {
  const secrets = options.secrets ?? [];
  const precheck = await checkCall(options.call, options);
  if (precheck) return precheck;

  const mediatedCall = await (options.middleware?.run<ToolCallContent>("tool_call", options.call) ?? options.call);
  const tool = options.registry.get(mediatedCall.name);
  const postcheck = await checkCall(mediatedCall, options);
  if (postcheck) return postcheck;

  const context: ToolExecutionContext = {
    ...options.context,
    toolCallId: mediatedCall.id,
    progress: async (progress, metadata) => {
      await options.context.progress?.(progress, metadata);
      await options.emit?.({
        type: "tool_execution_progress",
        sessionId: options.context.sessionId,
        runId: options.context.runId,
        toolCallId: mediatedCall.id,
        name: mediatedCall.name,
        progress,
        metadata,
      });
    },
  };

  try {
    await assertPermission(options.permission, { kind: "tool", action: "execute", target: mediatedCall.name, metadata: options.context.metadata });
  } catch (error) {
    return blocked(mediatedCall, context, "permission_denied", errorToErrorInfo(error, secrets), options.emit);
  }

  const validation = await options.validate?.(tool!, mediatedCall.arguments, context);
  if (validation) return blocked(mediatedCall, context, "validation_failed", toErrorInfo(validation, secrets), options.emit);

  await options.emit?.({ type: "tool_execution_started", sessionId: context.sessionId, runId: context.runId, call: mediatedCall });

  try {
    const raw = await tool!.execute(mediatedCall.arguments, context);
    const mediatedResult = await (options.middleware?.run<ToolResult>("tool_result", raw) ?? raw);
    const result = options.redactor?.redact(mediatedResult) ?? mediatedResult;
    await options.emit?.({ type: "tool_execution_finished", sessionId: context.sessionId, runId: context.runId, result });
    return result;
  } catch (error) {
    const info = errorToErrorInfo(error, secrets);
    const result = { toolCallId: mediatedCall.id, name: mediatedCall.name, error: info };
    await options.emit?.({ type: "tool_execution_error", sessionId: context.sessionId, runId: context.runId, call: mediatedCall, error: info });
    return result;
  }
}

async function checkCall(call: ToolCallContent, options: DispatchToolCallOptions): Promise<ToolResult | undefined> {
  const context = options.context;
  const tool = options.registry.get(call.name);
  if (!tool) return blocked(call, context, "unknown_tool", { message: `Unknown tool: ${call.name}` }, options.emit);
  if (filterTools([tool], options.filter).length === 0) return blocked(call, context, "tool_denied", { message: `Tool denied: ${call.name}` }, options.emit);
  if (!isJsonObject(call.arguments)) return blocked(call, context, "invalid_arguments", { message: "Tool arguments must be a JSON object" }, options.emit);
  return undefined;
}

async function blocked(call: ToolCallContent, context: ToolExecutionContext, reason: string, error: ErrorInfo, emit?: (event: AgentEvent) => void | Promise<void>): Promise<ToolResult> {
  await emit?.({
    type: "tool_execution_blocked",
    sessionId: context.sessionId,
    runId: context.runId,
    toolCallId: call.id,
    name: call.name,
    reason,
    error,
  });
  return { toolCallId: call.id, name: call.name, error };
}

function toErrorInfo(value: string | ErrorInfo, secrets: readonly (string | undefined)[]): ErrorInfo {
  return typeof value === "string" ? errorToErrorInfo(value, secrets) : redactSecrets(value, secrets);
}
