// ponytail: dependency-free conformance helper for the tool-dispatch contract.
// Hosts configuring a ToolRegistry with allow/deny filters, permission policies,
// and validators call this once to assert the blocked-reason matrix
// (unknown_tool / tool_denied / invalid_arguments / permission_denied /
// validation_failed) and the success path. Mirrors the assertions in
// src/__tests__/tools.test.ts so hosts do not re-derive them. Throws plain
// Error; no test runner, no network. Execution is observed via the
// tool_execution_started / tool_execution_blocked events the runtime emits,
// not by mutating the caller's tool.

import type {
  AgentEvent,
  JsonObject,
  ToolCallContent,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
  ToolResult,
} from "../contracts.js";
import type { PermissionPolicy } from "../security.js";
import {
  createActiveToolSet,
  createSearchToolsTool,
  createToolSearchState,
  HARD_MAX_TOOLS_INDEX,
  SEARCH_TOOLS_TOOL_NAME,
  selectDisclosedTools,
} from "../tool-search.js";
import { dispatchToolCall, filterTools, type ToolFilterInput, type ToolValidator } from "../tools.js";

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
export async function assertToolDispatchConforms(registry: ToolRegistry, options: ToolConformanceOptions): Promise<void> {
  registry.register(options.tool);
  const baseContext: ToolExecutionContext = { sessionId: "conformance", runId: "r", toolCallId: "call" };
  const call = (name: string, args: unknown): ToolCallContent => ({ type: "tool_call", id: "call", name, arguments: args as JsonObject });
  const shared = { registry, secrets: options.secrets };

  // 1. unknown tool → blocked "unknown_tool".
  await assertToolBlocked({ call: call("does-not-exist", {}), context: baseContext, ...shared, ...pickPolicy(options) }, "unknown_tool");

  // 2. denied tool (filter) → blocked "tool_denied".
  await assertToolBlocked(
    {
      call: call(options.tool.name, options.validArgs),
      context: baseContext,
      ...shared,
      ...pickPolicy(options),
      filter: { deny: [options.tool.name] },
    },
    "tool_denied",
  );

  // 3. invalid (non-object) arguments → blocked "invalid_arguments".
  await assertToolBlocked(
    { call: call(options.tool.name, "not-an-object" as unknown as JsonObject), context: baseContext, ...shared, ...pickPolicy(options) },
    "invalid_arguments",
  );

  // 4. permission denial → blocked "permission_denied".
  await assertToolBlocked(
    {
      call: call(options.tool.name, options.validArgs),
      context: baseContext,
      ...shared,
      ...pickPolicy(options),
      permission: denyAllPermission,
    },
    "permission_denied",
  );

  // 5. validator failure → blocked "validation_failed".
  await assertToolBlocked(
    {
      call: call(options.tool.name, options.validArgs),
      context: baseContext,
      ...shared,
      ...pickPolicy(options),
      validate: alwaysInvalidValidator,
    },
    "validation_failed",
  );

  // 6. valid call → executes (tool_execution_started), no error, no blocked event.
  const probe = await dispatchAndCollect({
    call: call(options.tool.name, options.validArgs),
    context: baseContext,
    ...shared,
    ...pickPolicy(options),
  });
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
    emit: (event) => {
      events.push(event);
    },
  });
  return { result, events };
}

export interface ToolDisclosureConformanceOptions {
  /** Host-active tool definitions; may include schema-bearing and oversized-description tools. */
  readonly tools: readonly ToolDefinition[];
  /** Host allow/deny bounds applied before disclosure (same input the runtime narrows). */
  readonly filter?: ToolFilterInput;
  /** Search options under test (topK). */
  readonly search?: { readonly topK?: number };
  /** Turn text used for the relevance query. Defaults to a zero-match probe. */
  readonly input?: string;
  /** Secret values that must never appear in model-facing search output. */
  readonly secrets?: readonly (string | undefined)[];
}

/**
 * Assert the tool-disclosure contract (plan 041) against the same narrowing the
 * runtime applies: search mode only narrows (disclosed set is a subset of the
 * allow/deny-filtered input, never wider, never zero, deterministic order); a
 * denied tool is never described; the generated `search_tools` tool is always
 * kept and its output is inert — names plus byte-truncated descriptions only,
 * no JSON structure, no secret values — and activation stays disclosed beside
 * the turn top-k next turn. Fails closed: an index over the hard cap discloses
 * the full eligible list. Throws on the first violation.
 */
export function assertToolDisclosureConforms(options: ToolDisclosureConformanceOptions): void {
  const eligible = filterTools(options.tools, options.filter);
  if (eligible.length === 0) throw new Error("Disclosure conformance needs at least one eligible tool");
  const activated = createActiveToolSet();
  const topK = options.search?.topK ?? 16;
  const state = createToolSearchState({ tools: eligible, activated, search: options.search });
  const searchTool = createSearchToolsTool(state);
  const runTools = [...eligible, searchTool];
  const input = options.input ?? "zzzqqq unmatchable zero-match probe";

  // 1. Narrowing stays a subset of the eligible list and always keeps search_tools.
  const disclosed = selectDisclosedTools({ tools: runTools, input, search: options.search, activated });
  const eligibleNames = new Set(eligible.map((tool) => tool.name));
  eligibleNames.add(SEARCH_TOOLS_TOOL_NAME);
  for (const tool of disclosed) {
    if (!eligibleNames.has(tool.name)) {
      throw new Error(`Disclosed tool ${tool.name} is not in the eligible list; search must never widen`);
    }
  }
  if (!disclosed.some((tool) => tool.name === SEARCH_TOOLS_TOOL_NAME)) {
    throw new Error("Disclosed set dropped the generated search_tools tool");
  }
  if (disclosed.length === 0) throw new Error("Disclosure disclosed zero tools; fail closed to a bounded non-empty set");

  // 2. A deny-listed tool is never described to the provider.
  const deniedName = eligible[0]!.name;
  const deniedDisclosed = selectDisclosedTools({
    tools: filterTools(runTools, { deny: [deniedName] }),
    input,
    search: options.search,
    activated,
  });
  if (deniedDisclosed.some((tool) => tool.name === deniedName)) {
    throw new Error(`Denied tool ${deniedName} was described to the provider`);
  }

  // 3. Deterministic order for identical turns.
  const again = selectDisclosedTools({ tools: runTools, input, search: options.search, activated });
  if (JSON.stringify(again.map((tool) => tool.name)) !== JSON.stringify(disclosed.map((tool) => tool.name))) {
    throw new Error("Disclosure order is not deterministic for identical turns");
  }

  // 4. Fail closed past the index hard cap: full eligible list, never zero, never wider.
  const oversized = Array.from({ length: HARD_MAX_TOOLS_INDEX + 1 }, (_, index) => ({
    name: `cap_${index}`,
    description: "Fixture tool beyond the frozen index cap.",
    parameters: { type: "object", properties: {} },
    execute: (): ToolResult => ({ toolCallId: "x", name: "cap" }),
  }));
  const overflowed = selectDisclosedTools({ tools: oversized, input, search: options.search });
  if (overflowed.length !== oversized.length) {
    throw new Error(`Index overflow must disclose the full list; disclosed ${overflowed.length} of ${oversized.length}`);
  }

  // 5. search_tools output is inert: names + byte-truncated descriptions, no JSON
  //    structure, no secret values; activation bounded to the eligible set.
  const oversizedDescription = `${"padding ".repeat(160)}TAIL-MARKER-BEYOND-TRUNCATION`;
  const probeEligible = [
    ...eligible,
    {
      name: "oversized_desc_tool",
      description: oversizedDescription,
      parameters: { type: "object", properties: { untrusted: { type: "string" } } },
      execute: (): ToolResult => ({ toolCallId: "x", name: "oversized_desc_tool" }),
    },
  ];
  const probeState = createToolSearchState({ tools: probeEligible, activated, search: options.search });
  const probeTool = createSearchToolsTool(probeState);
  const probeResult = probeTool.execute({ query: "oversized_desc_tool" }, context("probe")) as ToolResult;
  if (probeResult.error) throw new Error(`search_tools rejected a valid bounded query: ${probeResult.error.message}`);
  const text = probeResult.content?.find((block) => block.type === "text");
  if (text?.type !== "text" || !text.text.startsWith("- ")) {
    throw new Error("search_tools returned no bounded name+description lines");
  }
  if (text.text.includes("TAIL-MARKER-BEYOND-TRUNCATION")) {
    throw new Error(
      "search_tools emitted an untruncated oversized description; descriptions are truncated, descriptions are never executed",
    );
  }
  if (/[{}]/.test(text.text)) {
    throw new Error("search_tools text carries JSON structure; output must be inert name+description lines only");
  }
  const activatedCount = activated.list().length;
  if (activatedCount === 0 || activatedCount > topK) throw new Error(`activation not bounded: ${activatedCount} names`);
  const probeNames = new Set(probeEligible.map((tool) => tool.name));
  for (const name of activated.list()) {
    if (!probeNames.has(name)) throw new Error(`activated ${name} is not in the eligible set`);
  }

  // 5b. Secret scan: query every eligible tool by name; configured secret values
  //     must never surface in model-facing search output even when a host
  //     description carries one.
  for (const tool of eligible) {
    const probe = probeTool.execute({ query: tool.name }, context("probe-secret")) as ToolResult;
    const probeBlob = JSON.stringify(probe);
    for (const secret of options.secrets ?? []) {
      if (secret && probeBlob.includes(secret)) {
        throw new Error("search output leaked a configured secret");
      }
    }
  }

  // 6. Activated tools stay disclosed on the next turn, beside the turn top-k.
  //    (Names outside the runtime list are inert by design — e.g. the probe's
  //    synthetic tool above — so only eligible names are asserted.)
  const nextTurn = selectDisclosedTools({
    tools: runTools,
    input: "zzzqqq unmatchable next-turn probe",
    search: options.search,
    activated,
  });
  for (const name of activated.list()) {
    if (eligibleNames.has(name) && !nextTurn.some((tool) => tool.name === name)) {
      throw new Error(`activated tool ${name} was dropped from the next turn's disclosed set`);
    }
  }
}

function pickPolicy(options: ToolConformanceOptions): {
  permission?: PermissionPolicy;
  validate?: ToolValidator;
  filter?: ToolFilterInput;
} {
  return { permission: options.permission, validate: options.validate, filter: options.filter };
}

function context(toolCallId: string): ToolExecutionContext {
  return { sessionId: "conformance", runId: "r", toolCallId };
}
