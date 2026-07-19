import type { AgentEvent, ErrorInfo, JsonObject, OwnershipScope, RunLedger, ToolCallContent, ToolCallRecord, ToolCallStatus, ToolDefinition, ToolExecutionContext, ToolExecutionMetadata, ToolRegistry, ToolResult } from "./contracts.js";
import { isJsonObject } from "./config.js";
import { createId } from "./ids.js";
import type { MiddlewareRegistry } from "./middleware.js";
import { errorToErrorInfo, redactRunLedgerRecord, redactSecrets, type SecretRedactor } from "./redaction.js";
import { assertCanRegister, type DuplicateRegistrationOptions } from "./registry-options.js";
import { assertPermission, type PermissionPolicy } from "./security.js";

export interface ToolFilter {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export type ToolFilterInput = ToolFilter | readonly ToolFilter[];
export type ToolValidator = (tool: ToolDefinition, args: JsonObject, context: ToolExecutionContext) => void | string | ErrorInfo | Promise<void | string | ErrorInfo>;

export interface ToolArgumentValidationError {
  readonly path?: string;
  readonly message: string;
}

export interface ToolArgumentValidationResult {
  readonly ok: boolean;
  readonly errors?: readonly ToolArgumentValidationError[];
}

export interface ToolArgumentValidator {
  validate(schema: JsonObject, value: unknown): ToolArgumentValidationResult;
}

export interface ToolParameterValidatorOptions {
  /** When a tool omits `parameters`. Default `"allow"` preserves pre-validation behavior. */
  readonly missingSchema?: "allow" | "reject";
}

/** Wrap a schema adapter as the existing `ToolValidator` seam used by dispatch and the agent runtime. */
export function createToolParameterValidator(
  validator: ToolArgumentValidator,
  options: ToolParameterValidatorOptions = {},
): ToolValidator {
  const missingSchema = options.missingSchema ?? "allow";
  return (tool, args) => {
    if (!tool.parameters) {
      if (missingSchema === "reject") return `Tool ${tool.name} has no parameters schema`;
      return undefined;
    }
    const result = validator.validate(tool.parameters, args);
    if (result.ok) return undefined;
    return formatToolArgumentValidationErrors(tool.name, result.errors);
  };
}

function formatToolArgumentValidationErrors(toolName: string, errors?: readonly ToolArgumentValidationError[]): string {
  if (!errors?.length) return `Tool arguments failed validation: ${toolName}`;
  return errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join("; ");
}

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
  readonly ledger?: RunLedger;
  readonly ownership?: OwnershipScope;
}

export interface ToolRegistryOptions extends DuplicateRegistrationOptions {}

export function createToolRegistry(tools: readonly ToolDefinition[] = [], options: ToolRegistryOptions = {}): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();

  const registry: ToolRegistry = {
    register(tool) {
      assertCanRegister(byName, tool.name, "tool", tool.name, options.duplicate);
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

function toolExecutionMetadata(startedAt: string, status: ToolCallStatus): ToolExecutionMetadata {
  return { durationMs: Math.max(0, Date.now() - Date.parse(startedAt)), status };
}

export async function dispatchToolCall(options: DispatchToolCallOptions): Promise<ToolResult> {
  const secrets = options.secrets ?? [];
  const startedAt = new Date().toISOString();
  const precheck = await checkCall(options.call, options, startedAt);
  if (precheck) return precheck;

  const mediatedCall = await (options.middleware?.run<ToolCallContent>("tool_call", options.call) ?? options.call);
  const tool = options.registry.get(mediatedCall.name);
  const postcheck = await checkCall(mediatedCall, options, startedAt);
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
      await appendToolCallRecord(options, "started", mediatedCall, startedAt, {
        progress,
        progressMetadata: metadata,
        progressAt: new Date().toISOString(),
      });
    },
  };

  try {
    await assertPermission(options.permission, { kind: "tool", action: "execute", target: mediatedCall.name, metadata: options.context.metadata });
  } catch (error) {
    return blocked(mediatedCall, context, "permission_denied", errorToErrorInfo(error, secrets), options, startedAt);
  }

  const validation = await options.validate?.(tool!, mediatedCall.arguments, context);
  if (validation) return blocked(mediatedCall, context, "validation_failed", toErrorInfo(validation, secrets), options, startedAt);

  await options.emit?.({ type: "tool_execution_started", sessionId: context.sessionId, runId: context.runId, call: mediatedCall });
  await appendToolCallRecord(options, "started", mediatedCall, startedAt, {});

  try {
    const raw = await tool!.execute(mediatedCall.arguments, context);
    const mediatedResult = await (options.middleware?.run<ToolResult>("tool_result", raw) ?? raw);
    const result = options.redactor?.redact(mediatedResult) ?? mediatedResult;
    const finishedAt = new Date().toISOString();
    const metadata = toolExecutionMetadata(startedAt, "finished");
    await options.emit?.({ type: "tool_execution_finished", sessionId: context.sessionId, runId: context.runId, result, metadata });
    await appendToolCallRecord(options, "finished", mediatedCall, startedAt, { finishedAt, result });
    return result;
  } catch (error) {
    const info = errorToErrorInfo(error, secrets);
    const result = { toolCallId: mediatedCall.id, name: mediatedCall.name, error: info };
    const finishedAt = new Date().toISOString();
    const metadata = toolExecutionMetadata(startedAt, "error");
    await options.emit?.({ type: "tool_execution_error", sessionId: context.sessionId, runId: context.runId, call: mediatedCall, error: info, metadata });
    await appendToolCallRecord(options, "error", mediatedCall, startedAt, { finishedAt, result });
    return result;
  }
}

async function checkCall(call: ToolCallContent, options: DispatchToolCallOptions, startedAt: string): Promise<ToolResult | undefined> {
  const context = options.context;
  const tool = options.registry.get(call.name);
  if (!tool) return blocked(call, context, "unknown_tool", { message: `Unknown tool: ${call.name}` }, options, startedAt);
  if (filterTools([tool], options.filter).length === 0) return blocked(call, context, "tool_denied", { message: `Tool denied: ${call.name}` }, options, startedAt);
  if (!isJsonObject(call.arguments)) return blocked(call, context, "invalid_arguments", { message: "Tool arguments must be a JSON object" }, options, startedAt);
  return undefined;
}

async function blocked(call: ToolCallContent, context: ToolExecutionContext, reason: string, error: ErrorInfo, options: DispatchToolCallOptions, startedAt: string): Promise<ToolResult> {
  const metadata = toolExecutionMetadata(startedAt, "blocked");
  await options.emit?.({
    type: "tool_execution_blocked",
    sessionId: context.sessionId,
    runId: context.runId,
    toolCallId: call.id,
    name: call.name,
    reason,
    error,
    metadata,
  });
  const finishedAt = new Date().toISOString();
  const result = { toolCallId: call.id, name: call.name, error };
  await appendToolCallRecord(options, "blocked", call, startedAt, { reason, finishedAt, result });
  return result;
}

function toErrorInfo(value: string | ErrorInfo, secrets: readonly (string | undefined)[]): ErrorInfo {
  return typeof value === "string" ? errorToErrorInfo(value, secrets) : redactSecrets(value, secrets);
}

const randomId = createId;

function appendToolCallRecord(
  options: DispatchToolCallOptions,
  status: ToolCallRecord["status"],
  call: ToolCallContent,
  startedAt: string,
  fields: Partial<ToolCallRecord>,
): Promise<void> | void {
  if (!options.ledger) return undefined;
  const record: ToolCallRecord = {
    id: randomId("toolcall"),
    sessionId: options.context.sessionId,
    runId: options.context.runId,
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
    status,
    startedAt,
    redacted: Boolean(options.redactor),
    ...options.ownership,
    ...fields,
  };
  return options.ledger.appendToolCall(redactRunLedgerRecord(record, options.redactor));
}
