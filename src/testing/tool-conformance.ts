// ponytail: dependency-free conformance helper for the tool-dispatch contract.
// Hosts configuring a ToolRegistry with allow/deny filters, permission policies,
// and validators call this once to assert the blocked-reason matrix
// (unknown_tool / tool_denied / invalid_arguments / permission_denied /
// validation_failed) and the success path. Mirrors the assertions in
// src/__tests__/tools.test.ts so hosts do not re-derive them. Throws plain
// Error; no test runner, no network. Execution is observed via the
// tool.started / tool.completed(status: "blocked") events the runtime emits,
// not by mutating the caller's tool.
//
// `assertGateIntegrity` (plan 177 Task 6) is the agent-level companion: it runs the safety-gate
// invariants against a caller-supplied agent factory, so a custom loop or driver proves it keeps them.
// It uses the mock provider only and never touches the network.

import type {
  Agent,
  AgentConfig,
  AgentEvent,
  JsonObject,
  ToolCallContent,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
  ToolResult,
  Decision,
  ErrorInfo,
  SessionEntry,
} from "../contracts.js";
import { providerPackage } from "../provider-kit/package.js";
import { dispatchToolCall, type ToolFilterInput, type ToolValidator } from "../tools.js";
import { createScriptedHostUi } from "./host-ui.js";
import { twoTurnProvider } from "./loop-conformance.js";

export interface ToolDispatchProbeOptions {
  readonly call: ToolCallContent;
  readonly registry: ToolRegistry;
  readonly context?: Partial<ToolExecutionContext>;
  readonly filter?: ToolFilterInput;
  /** Adapter-specific policy check immediately before the tool side effect. */
  readonly beforeExecute?: (call: ToolCallContent, tool: ToolDefinition, context: ToolExecutionContext) => void | Promise<void>;
  readonly validate?: ToolValidator;
  readonly secrets?: readonly (string | undefined)[];
}

export interface ToolConformanceOptions {
  /** A tool that will be registered and used as the success-path target. */
  readonly tool: ToolDefinition;
  /** Valid arguments object for the success-path probe. */
  readonly validArgs: JsonObject;
  /** Optional pre-execution policy check applied to every probe. */
  readonly beforeExecute?: (call: ToolCallContent, tool: ToolDefinition, context: ToolExecutionContext) => void | Promise<void>;
  /** Optional validator to apply. */
  readonly validate?: ToolValidator;
  /** Optional filter applied to every probe (e.g. a deny list under test). */
  readonly filter?: ToolFilterInput;
  readonly secrets?: readonly (string | undefined)[];
}

const denyBeforeExecute = (): never => {
  throw new Error("denied");
};
const alwaysInvalidValidator: ToolValidator = () => "invalid";

/**
 * Assert the full tool-dispatch contract against a fresh registry containing
 * `options.tool`: unknown tools, denied tools, non-object arguments,
 * permission denials, and validator failures all block with the canonical
 * reason and never emit `tool.started`; a valid call emits
 * `tool.started` and returns a result without an error. Throws on
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

  // 4. pre-execution policy denial → blocked "execution_denied".
  await assertToolBlocked(
    {
      call: call(options.tool.name, options.validArgs),
      context: baseContext,
      ...shared,
      ...pickPolicy(options),
      beforeExecute: denyBeforeExecute,
    },
    "execution_denied",
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

  // 6. valid call → executes (tool.started), no error, no blocked outcome.
  const probe = await dispatchAndCollect({
    call: call(options.tool.name, options.validArgs),
    context: baseContext,
    ...shared,
    ...pickPolicy(options),
  });
  if (probe.result.error) throw new Error(`Valid tool call was not executed: ${probe.result.error.message}`);
  if (!probe.events.some((event) => event.type === "tool.started")) {
    throw new Error("Valid tool call did not emit tool.started");
  }
  if (probe.events.some((event) => event.type === "tool.completed" && event.status === "blocked")) {
    throw new Error("Valid tool call emitted a blocked tool.completed event");
  }
}

export async function assertToolBlocked(probe: ToolDispatchProbeOptions, expectedReason: string): Promise<void> {
  const captured = await dispatchAndCollect(probe);
  const blockedEvent = captured.events.find((event) => event.type === "tool.completed" && event.status === "blocked");
  if (!blockedEvent) throw new Error(`Expected a blocked tool.completed for "${expectedReason}", but none was emitted`);
  if (blockedEvent.type === "tool.completed" && blockedEvent.reason !== expectedReason) {
    throw new Error(`Blocked reason mismatch: expected ${expectedReason}, got ${blockedEvent.reason}`);
  }
  if (!captured.result.error) throw new Error(`Blocked call for "${expectedReason}" carried no error in the result`);
  if (captured.events.some((event) => event.type === "tool.started")) {
    throw new Error(`Tool emitted tool.started despite being blocked for "${expectedReason}"; blocked calls must not execute`);
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
    beforeExecute: probe.beforeExecute,
    validate: probe.validate,
    secrets: probe.secrets,
    emit: (event) => {
      events.push(event);
    },
  });
  return { result, events };
}


function pickPolicy(options: ToolConformanceOptions): {
  beforeExecute?: (call: ToolCallContent, tool: ToolDefinition, context: ToolExecutionContext) => void | Promise<void>;
  validate?: ToolValidator;
  filter?: ToolFilterInput;
} {
  return { beforeExecute: options.beforeExecute, validate: options.validate, filter: options.filter };
}

function _context(toolCallId: string): ToolExecutionContext {
  return { sessionId: "conformance", runId: "r", toolCallId };
}

/* ------------------------------------------------------------------------------------------------
 * Gate integrity (plan 177 Task 6)
 * ---------------------------------------------------------------------------------------------- */

/** Builds the agent under test; a custom loop or driver injects itself here. */
export interface GateIntegrityOptions {
  /**
   * Builds the agent each probe runs against. A custom loop passes its strategy through `slots.loop`
   * (or a loop package) here, so the check exercises the loop that will ship, not a stand-in:
   * `(config) => createAgent({ ...config, slots: { ...config.slots, loop: myLoop } })`.
   */
  readonly createAgent: (config: AgentConfig) => Promise<Agent>;
}

const GATE_MODEL = { provider: "mock", model: "demo" } as const;
const GATE_PROVIDER = "gate-integrity-provider";
/** The tool every probe registers; the provider calls it by this name. */
const GATE_TOOL = "echo";

/** A tool that records every executed argument object, so an un-gated call is visible. */
function gatedTool(executed: JsonObject[]): ToolDefinition {
  return {
    name: GATE_TOOL,
    parameters: {},
    execute: (args, execution) => {
      executed.push(args);
      return { toolCallId: execution.toolCallId, name: GATE_TOOL, value: "ok" };
    },
  };
}

/** One tool call, then a final text turn: the shape every probe needs. */
function gateProvider(args: JsonObject) {
  return providerPackage(GATE_PROVIDER, [twoTurnProvider({ id: "call-1", name: GATE_TOOL, args })]);
}

function toolResultErrors(entries: readonly SessionEntry[]): ErrorInfo[] {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.message
      ? entry.message.content.flatMap((block) => (block.type === "tool_result" && block.error ? [block.error] : []))
      : [],
  );
}

/**
 * Assert the safety-gate invariants a loop must preserve, against `options.createAgent`:
 *
 * 1. a rewritten call is re-gated, so a denial reached on the final arguments stops it;
 * 2. an `ask` keeps every other handler's rewrite, so a sanitized call is what executes;
 * 3. a resumed call is re-gated, so an approval cannot carry arguments the gate would deny;
 * 4. `agent.dispose()` stops an in-flight tool, so no call runs once disposal has begun.
 *
 * Each probe asserts the outcome the gate must produce (a denial recorded, the sanitized arguments
 * executed, the disposal denied) as well as the absence of an un-gated execution, so a loop that
 * skips the tool pipeline fails rather than passing vacuously. Throws on the first violation, naming
 * the probe; returns normally when all four hold. The mock provider is the only dependency.
 *
 * An external-agent driver loop (`usesModel: false`, tools relayed through `RunController.ask`) does
 * not drive `executeTools` at all; `driverConformance`'s `gating`/`fail_closed`/`resume` legs cover it.
 */
export async function assertGateIntegrity(options: GateIntegrityOptions): Promise<void> {
  const probes: readonly { readonly name: string; readonly run: () => Promise<void> }[] = [
    { name: "rewrite_is_regated", run: () => rewriteIsRegated(options.createAgent) },
    { name: "ask_keeps_rewrite", run: () => askKeepsRewrite(options.createAgent) },
    { name: "resume_is_regated", run: () => resumeIsRegated(options.createAgent) },
    { name: "dispose_is_fail_closed", run: () => disposeIsFailClosed(options.createAgent) },
  ];
  for (const probe of probes) {
    try {
      await probe.run();
    } catch (error) {
      throw new Error(`gate integrity: ${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Shared shape: build the agent, run one session, dispose. */
async function withGatedAgent(
  create: GateIntegrityOptions["createAgent"],
  config: AgentConfig,
  sessionId: string,
  body: (session: Awaited<ReturnType<Agent["session"]>>) => Promise<void>,
): Promise<void> {
  const agent = await create(config);
  try {
    await body(await agent.session({ id: sessionId, create: true }));
  } finally {
    await agent.dispose();
  }
}

async function rewriteIsRegated(create: GateIntegrityOptions["createAgent"]): Promise<void> {
  const executed: JsonObject[] = [];
  await withGatedAgent(
    create,
    {
      model: GATE_MODEL,
      packages: [gateProvider({ path: "/tmp/inside" })],
      tools: { add: [gatedTool(executed)] },
      hooks: (hooks) => {
        hooks.on("tool.call", (call) => ({ rewrite: { path: String(call.args.path).replace("/tmp/inside", "/etc/shadow") } }));
        hooks.on("tool.call", (call) => (String(call.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      },
    },
    "gate-integrity-rewrite",
    async (session) => {
      await session.run("go");
      if (executed.length > 0) throw new Error(`a rewritten call executed (${JSON.stringify(executed[0])}) instead of being re-gated`);
      if (!toolResultErrors(await session.entries()).some((error) => /outside root/.test(error.message))) {
        throw new Error("the re-gated call produced no denial in the transcript");
      }
    },
  );
}

async function askKeepsRewrite(create: GateIntegrityOptions["createAgent"]): Promise<void> {
  const executed: JsonObject[] = [];
  const scripted = createScriptedHostUi({ confirm: true });
  await withGatedAgent(
    create,
    {
      model: GATE_MODEL,
      packages: [gateProvider({ path: "/tmp/raw" })],
      tools: { add: [gatedTool(executed)] },
      host: { ui: scripted.ui },
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ ask: "approve the sanitized call?" }));
        hooks.on("tool.call", (call) => ({ rewrite: { path: String(call.args.path).replace("/tmp/raw", "/tmp/sanitized") } }));
      },
    },
    "gate-integrity-ask",
    async (session) => {
      await session.run("go");
      if (executed.length !== 1) throw new Error(`an approved call executed ${executed.length} times, expected once`);
      if (executed[0]?.path !== "/tmp/sanitized") throw new Error(`the sanitizing rewrite was dropped: executed ${JSON.stringify(executed[0])}`);
    },
  );
}

async function resumeIsRegated(create: GateIntegrityOptions["createAgent"]): Promise<void> {
  const executed: JsonObject[] = [];
  await withGatedAgent(
    create,
    {
      model: GATE_MODEL,
      packages: [gateProvider({ path: "/tmp/ok" })],
      tools: { add: [gatedTool(executed)] },
      hooks: (hooks) => {
        hooks.on("tool.call", () => ({ ask: "approve the call?" }));
        hooks.on("tool.call", (call) => (String(call.args.path).startsWith("/etc") ? { deny: "outside root" } : undefined));
      },
    },
    "gate-integrity-resume",
    async (session) => {
      const first = await session.run("go");
      // A loop that cannot suspend denies the ask outright, which is the same outcome: no execution.
      if (first.status === "suspended") {
        const decisions: Decision[] = (first.pending ?? []).map((pending) => ({
          approvalId: pending.approvalId,
          outcome: "allow_once" as const,
          modifiedArguments: { path: "/etc/shadow" },
        }));
        for await (const _event of session.resume(decisions)) {
          // Drain: the resumed run's outcome is checked through the recorded executions.
        }
      }
      if (executed.length > 0) throw new Error(`a resumed call executed (${JSON.stringify(executed[0])}) instead of being re-gated`);
    },
  );
}

async function disposeIsFailClosed(create: GateIntegrityOptions["createAgent"]): Promise<void> {
  const executed: JsonObject[] = [];
  let agent: Agent | undefined;
  agent = await create({
    model: GATE_MODEL,
    packages: [gateProvider({})],
    tools: { add: [gatedTool(executed)] },
    hooks: (hooks) => {
      // Dispose while the run is mid-tool-round: the call must not execute.
      hooks.on("tool.call", async () => {
        await agent!.dispose();
        return undefined;
      });
    },
  });
  const built = agent;
  try {
    const session = await built.session({ id: "gate-integrity-dispose", create: true });
    let completed = false;
    try {
      completed = (await session.run("go")).status === "completed";
    } catch {
      // A loop that surfaces the abort as a rejection is fine; only a clean completion is not.
    }
    if (executed.length > 0) throw new Error("a tool executed after dispose() was called");
    if (completed) throw new Error("a run reported success after dispose() was called mid-round");
  } finally {
    await built.dispose();
  }
}
