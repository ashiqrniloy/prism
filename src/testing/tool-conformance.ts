// ponytail: dependency-free conformance helper for the tool-dispatch contract.
// Hosts configuring a ToolRegistry with allow/deny filters, permission policies,
// and validators call this once to assert the blocked-reason matrix
// (unknown_tool / tool_denied / invalid_arguments / permission_denied /
// validation_failed) and the success path. Mirrors the assertions in
// src/__tests__/tools.test.ts so hosts do not re-derive them. Throws plain
// Error; no test runner, no network. Execution is observed via the
// tool_execution_started / tool_execution_blocked events the runtime emits,
// not by mutating the caller's tool.

import type { AgentEvent, JsonObject, ToolCallContent, ToolDefinition, ToolExecutionContext, ToolRegistry, ToolResult } from "../contracts.js";
import type { PermissionPolicy } from "../security.js";
import { dispatchToolCall, type ToolFilterInput, type ToolValidator } from "../tools.js";

export interface ToolDispatchProbeOptions {
  readonly call: ToolCallContent;
  readonly registry: ToolRegistry;
  readonly context?: Partial<ToolExecutionContext>;
  readonly filter?: ToolFilterInput;
  readonly permission?: PermissionPolicy;
  readonly validate?: ToolValidator;
  readonly secrets?: readonly (string | undefined)[];
}

export interface ToolConformanceOptions {
  /** A tool that will be registered and used as the success-path target. */
  readonly tool: ToolDefinition;
  /** Valid arguments object for the success-path probe. */
  readonly validArgs: JsonObject;
  /** Optional permission policy to apply (defaults to allow-all). */
  readonly permission?: PermissionPolicy;
  /** Optional validator to apply. */
  readonly validate?: ToolValidator;
  /** Optional filter applied to every probe (e.g. a deny list under test). */
  readonly filter?: ToolFilterInput;
  readonly secrets?: readonly (string | undefined)[];
}

const denyAllPermission: PermissionPolicy = { check: () => ({ allowed: false, reason: "denied" }) };
const alwaysInvalidValidator: ToolValidator = () => "invalid";

/**
 * Assert the full tool-dispatch contract against a fresh registry containing
 * `options.tool`: unknown tools, denied tools, non-object arguments,
 * permission denials, and validator failures all block with the canonical
 * reason and never emit `tool_execution_started`; a valid call emits
 * `tool_execution_started` and returns a result without an error. Throws on
 * the first violation.
 */
export async function assertToolDispatchConforms(
  registry: ToolRegistry,
  options: ToolConformanceOptions,
): Promise<void> {
  registry.register(options.tool);
  const baseContext: ToolExecutionContext = { sessionId: "conformance", runId: "r", toolCallId: "call" };
  const call = (name: string, args: unknown): ToolCallContent => ({ type: "tool_call", id: "call", name, arguments: args as JsonObject });
  const shared = { registry, secrets: options.secrets };

  // 1. unknown tool → blocked "unknown_tool".
  await assertToolBlocked({ call: call("does-not-exist", {}), context: baseContext, ...shared, ...pickPolicy(options) }, "unknown_tool");

  // 2. denied tool (filter) → blocked "tool_denied".
  await assertToolBlocked(
    { call: call(options.tool.name, options.validArgs), context: baseContext, ...shared, ...pickPolicy(options), filter: { deny: [options.tool.name] } },
    "tool_denied",
  );

  // 3. invalid (non-object) arguments → blocked "invalid_arguments".
  await assertToolBlocked(
    { call: call(options.tool.name, "not-an-object" as unknown as JsonObject), context: baseContext, ...shared, ...pickPolicy(options) },
    "invalid_arguments",
  );

  // 4. permission denial → blocked "permission_denied".
  await assertToolBlocked(
    { call: call(options.tool.name, options.validArgs), context: baseContext, ...shared, ...pickPolicy(options), permission: denyAllPermission },
    "permission_denied",
  );

  // 5. validator failure → blocked "validation_failed".
  await assertToolBlocked(
    { call: call(options.tool.name, options.validArgs), context: baseContext, ...shared, ...pickPolicy(options), validate: alwaysInvalidValidator },
    "validation_failed",
  );

  // 6. valid call → executes (tool_execution_started), no error, no blocked event.
  const probe = await dispatchAndCollect({ call: call(options.tool.name, options.validArgs), context: baseContext, ...shared, ...pickPolicy(options) });
  if (probe.result.error) throw new Error(`Valid tool call was not executed: ${probe.result.error.message}`);
  if (!probe.events.some((event) => event.type === "tool_execution_started")) {
    throw new Error("Valid tool call did not emit tool_execution_started");
  }
  if (probe.events.some((event) => event.type === "tool_execution_blocked")) {
    throw new Error("Valid tool call emitted a tool_execution_blocked event");
  }
}

export async function assertToolBlocked(probe: ToolDispatchProbeOptions, expectedReason: string): Promise<void> {
  const captured = await dispatchAndCollect(probe);
  const blockedEvent = captured.events.find((event) => event.type === "tool_execution_blocked");
  if (!blockedEvent) throw new Error(`Expected tool_execution_blocked for "${expectedReason}", but no blocked event was emitted`);
  if (blockedEvent.type === "tool_execution_blocked" && blockedEvent.reason !== expectedReason) {
    throw new Error(`Blocked reason mismatch: expected ${expectedReason}, got ${blockedEvent.reason}`);
  }
  if (!captured.result.error) throw new Error(`Blocked call for "${expectedReason}" carried no error in the result`);
  if (captured.events.some((event) => event.type === "tool_execution_started")) {
    throw new Error(`Tool emitted tool_execution_started despite being blocked for "${expectedReason}"; blocked calls must not execute`);
  }
}

export async function dispatchAndCollect(probe: ToolDispatchProbeOptions): Promise<{ result: ToolResult; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  const context: ToolExecutionContext = { sessionId: "conformance", runId: "r", toolCallId: probe.call.id, ...probe.context };
  const result = await dispatchToolCall({
    call: probe.call,
    registry: probe.registry,
    context,
    filter: probe.filter,
    permission: probe.permission,
    validate: probe.validate,
    secrets: probe.secrets,
    emit: (event) => { events.push(event); },
  });
  return { result, events };
}

function pickPolicy(options: ToolConformanceOptions): { permission?: PermissionPolicy; validate?: ToolValidator; filter?: ToolFilterInput } {
  return { permission: options.permission, validate: options.validate, filter: options.filter };
}
