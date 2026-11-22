/**
 * Plan 226 Task 3: a tool call ends when the run is aborted, the wall limit passes, or a tool/run
 * timeout expires (evaluation probe `p4-hang`: a tool that ignores its signal held the run for
 * 4,014 ms under `maxWallTimeMs: 300`).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createToolRegistry,
  dispatchToolCall,
  resolveRunLimits,
  type ToolCallContent,
  type ToolDefinition,
  type ToolResult,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { RunLimitTracker } from "../run-limits.js";
import { twoTurnProvider } from "../testing/index.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ownership = { tenantId: "tenant", accountId: "account", userId: "user" };

function hangingTool(extra: Partial<ToolDefinition> = {}, onSignal?: (signal: AbortSignal) => void): ToolDefinition {
  return {
    name: "hang",
    async execute(_args, context) {
      if (context.signal) onSignal?.(context.signal);
      // Deliberately ignores its signal.
      await sleep(800);
      return { toolCallId: context.toolCallId, name: "hang", value: "late" };
    },
    ...extra,
  };
}

function toolCall(name = "hang"): ToolCallContent {
  return { type: "tool_call", id: "call-1", name, arguments: {} };
}

async function dispatch(
  tool: ToolDefinition,
  options: {
    readonly signal?: AbortSignal;
    readonly limits?: Parameters<typeof resolveRunLimits>[0];
    readonly effectStore?: ReturnType<typeof createMemoryToolEffectStore>;
  } = {},
): Promise<{ readonly result: ToolResult; readonly events: AgentEvent[]; readonly ms: number }> {
  const events: AgentEvent[] = [];
  const started = performance.now();
  const result = await dispatchToolCall({
    call: toolCall(tool.name),
    registry: createToolRegistry([tool]),
    context: { sessionId: "s", runId: "r", toolCallId: "call-1", signal: options.signal as AbortSignal },
    emit: (event) => {
      events.push(event);
    },
    ...(options.limits ? { limitTracker: new RunLimitTracker(resolveRunLimits(undefined, options.limits)) } : {}),
    ...(options.effectStore ? { effectStore: options.effectStore, ownership } : {}),
  });
  return { result, events, ms: performance.now() - started };
}

const completed = (events: readonly AgentEvent[]) => events.filter((event) => event.type === "tool.completed");

describe("tool interruption", () => {
  it("session_abort_settles_the_running_call", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const { result, events, ms } = await dispatch(hangingTool(), { signal: controller.signal });
    assert.equal(result.error?.code, "tool_aborted");
    assert.ok(ms < 200, `settled in ${ms} ms`);
    const done = completed(events);
    assert.equal(done.length, 1);
    assert.equal((done[0] as { status?: string }).status, "error");
  });

  it("an already-aborted signal never starts the tool", async () => {
    let started = 0;
    const tool = hangingTool({
      execute(_args, context) {
        started += 1;
        return { toolCallId: context.toolCallId, name: "hang", value: 1 };
      },
    });
    const { result } = await dispatch(tool, { signal: AbortSignal.abort() });
    assert.equal(result.error?.code, "tool_aborted");
    assert.equal(started, 0);
  });

  it("tool_timeout_settles_and_aborts_the_tool_signal", async () => {
    let toolSignal: AbortSignal | undefined;
    const { result, ms } = await dispatch(hangingTool({ timeoutMs: 30 }, (signal) => (toolSignal = signal)));
    assert.equal(result.error?.code, "tool_timeout");
    assert.match(result.error?.message ?? "", /30 ms/);
    assert.ok(ms < 300, `settled in ${ms} ms`);
    assert.equal(toolSignal?.aborted, true, "a cooperative tool is told to stop");
  });

  it("a tool cannot reach the abort controller of its own deadline", async () => {
    const parent = new AbortController();
    let toolSignal: AbortSignal | undefined;
    const { result } = await dispatch(
      hangingTool({ timeoutMs: 20 }, (signal) => (toolSignal = signal)),
      { signal: parent.signal },
    );
    assert.equal(result.error?.code, "tool_timeout");
    assert.equal(parent.signal.aborted, false, "the run signal is untouched by a call timeout");
    assert.equal(toolSignal?.aborted, true);
  });

  it("run_limit_clamps_tool_timeout", async () => {
    const clamped = await dispatch(hangingTool({ timeoutMs: 5_000 }), { limits: { maxToolTimeMs: 30 } });
    assert.equal(clamped.result.error?.code, "tool_timeout");
    assert.ok(clamped.ms < 300);
    const own = await dispatch(hangingTool({ timeoutMs: 30 }), { limits: { maxToolTimeMs: 5_000 } });
    assert.equal(own.result.error?.code, "tool_timeout");
    assert.ok(own.ms < 300);
    const runOnly = await dispatch(hangingTool(), { limits: { maxToolTimeMs: 30 } });
    assert.equal(runOnly.result.error?.code, "tool_timeout");
  });

  it("limits narrow maxToolTimeMs by min and reject invalid values", () => {
    assert.equal(resolveRunLimits(undefined, undefined).maxToolTimeMs, null);
    assert.equal(resolveRunLimits({ maxToolTimeMs: 100 }, { maxToolTimeMs: 500 }).maxToolTimeMs, 100);
    assert.equal(resolveRunLimits({ maxToolTimeMs: 500 }, { maxToolTimeMs: 100 }).maxToolTimeMs, 100);
    assert.equal(resolveRunLimits({ maxToolTimeMs: 500 }, { maxToolTimeMs: null }).maxToolTimeMs, 500);
    assert.throws(() => resolveRunLimits({ maxToolTimeMs: 0 }), /maxToolTimeMs/);
    assert.throws(() => resolveRunLimits({ maxToolTimeMs: 1.5 }), /maxToolTimeMs/);
    assert.throws(() => createToolRegistry([hangingTool({ timeoutMs: 0 })]), /timeoutMs/);
  });

  it("a call without a timeout still completes normally", async () => {
    const tool: ToolDefinition = {
      name: "quick",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "quick", value: 7 }),
    };
    const { result, events } = await dispatch(tool, { signal: new AbortController().signal, limits: { maxToolTimeMs: 1_000 } });
    assert.equal(result.value, 7);
    assert.equal(completed(events).length, 1);
  });

  it("late_tool_outcome_is_dropped", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let lateProgress = 0;
      const resolving: ToolDefinition = {
        name: "late-ok",
        async execute(_args, context) {
          await sleep(60);
          await context.progress?.(1);
          lateProgress += 1;
          return { toolCallId: context.toolCallId, name: "late-ok", value: "late" };
        },
        timeoutMs: 10,
      };
      const rejecting: ToolDefinition = {
        name: "late-fail",
        async execute() {
          await sleep(60);
          throw new Error("late failure");
        },
        timeoutMs: 10,
      };
      const first = await dispatch(resolving);
      const second = await dispatch(rejecting);
      const settledEvents = first.events.length + second.events.length;
      await sleep(150);
      assert.equal(first.result.error?.code, "tool_timeout");
      assert.equal(second.result.error?.code, "tool_timeout");
      assert.equal(lateProgress, 1, "the detached tool kept running");
      assert.equal(first.events.length + second.events.length, settledEvents, "nothing is emitted after settlement");
      assert.deepEqual(
        first.events.filter((event) => event.type === "tool.progress"),
        [],
      );
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("dispatched_effect_timeout_is_unknown_not_failed", async () => {
    const store = createMemoryToolEffectStore();
    const tool = hangingTool({ timeoutMs: 20, effect: { kind: "external_mutation", idempotency: "required" } });
    const { result, events } = await dispatch(tool, { effectStore: store });
    assert.equal(result.error?.code, "ERR_PRISM_TOOL_EFFECT_UNKNOWN");
    const done = completed(events);
    assert.equal(done.length, 1);
    assert.equal((done[0] as { status?: string }).status, "error");
  });

  it("aborted_call_has_exactly_one_result", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const { events } = await dispatch(hangingTool({ timeoutMs: 50 }), { signal: controller.signal });
    await sleep(100);
    assert.equal(completed(events).length, 1);
  });
});

describe("tool interruption through a run", () => {
  it("wall_limit_ends_a_tool_that_ignores_its_signal", async () => {
    const provider = twoTurnProvider({ id: "call-1", name: "hang", args: {} });
    const agent = await createAgent({
      model: { provider: provider.id, model: "demo" },
      packages: [providerPackage("interruption-provider", [provider])],
      tools: { add: [hangingTool()] },
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "wall", create: true });
    const events: AgentEvent[] = [];
    const watching = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    const started = performance.now();
    const outcome = await session.run("go", { limits: { maxWallTimeMs: 150 } });
    const ms = performance.now() - started;
    await session.close();
    await watching;
    assert.equal(outcome.limit?.limit, "maxWallTimeMs");
    assert.ok(ms < 150 + 100 + 200, `returned in ${ms} ms`);
    assert.equal(events.filter((event) => event.type === "run.failed").length, 1);
    const done = completed(events);
    assert.equal(done.length, 1);
    assert.equal((done[0] as { error?: { code?: string } }).error?.code, "tool_aborted");
  });

  it("a run-level tool timeout lets the run continue", async () => {
    const provider = twoTurnProvider({ id: "call-1", name: "hang", args: {} });
    const agent = await createAgent({
      model: { provider: provider.id, model: "demo" },
      packages: [providerPackage("interruption-timeout-provider", [provider])],
      tools: { add: [hangingTool()] },
      limits: { maxToolTimeMs: 30 },
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "timeout", create: true });
    const started = performance.now();
    const outcome = await session.run("go");
    const ms = performance.now() - started;
    await session.close();
    assert.equal(outcome.limit, undefined);
    assert.ok(ms < 500, `returned in ${ms} ms`);
  });
});
