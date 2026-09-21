import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type AgentLoopStrategy,
  AgentRunError,
  type AIProvider,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  HARD_RUN_LIMITS,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  resumeAgentRunStream,
  type RunLimitBreach,
  RunLimitError,
  RunLimitTracker,
  resolveRunLimits,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("run limits", () => {
  it("validates, narrows inherited ceilings, and fails closed for invalid values", () => {
    assert.equal(resolveRunLimits({ maxTurns: 2 }, { maxTurns: 20 }).maxTurns, 2);
    assert.equal(resolveRunLimits(undefined, { maxTurns: 20 }).maxTurns, 20);
    assert.throws(() => resolveRunLimits(undefined, { maxRequestBytes: 0 }), /positive safe integer/);
    assert.throws(
      () => resolveRunLimits({ maxCost: { amount: 1, currency: "USD" } }, { maxCost: { amount: 1, currency: "EUR" } }),
      /currencies/,
    );
  });

  it("keeps DEFAULT_RUN_LIMITS as the unconfigured fence (LLM10 defaults unchanged)", () => {
    const resolved = resolveRunLimits(undefined, undefined);
    assert.deepEqual(
      { ...resolved, maxCost: undefined },
      {
        maxTurns: 16,
        maxProviderAttempts: 24,
        maxToolRounds: 8,
        maxToolCalls: 32,
        maxWallTimeMs: 120_000,
        maxRequestBytes: 8 * 1024 * 1024,
        maxResponseBytes: 8 * 1024 * 1024,
        maxInputTokens: 40_000,
        maxOutputTokens: 10_000,
        maxTotalTokens: 50_000,
        maxCost: undefined,
        maxStopContinuations: 3,
      },
    );
    assert.deepEqual({ ...HARD_RUN_LIMITS }, { maxRequestBytes: 64 * 1024 * 1024, maxResponseBytes: 64 * 1024 * 1024 });
  });

  it("accepts raised limits, null (disabled) caps, and large envelopes without TypeError", () => {
    assert.equal(resolveRunLimits(undefined, { maxTurns: 10_000 }).maxTurns, 10_000);
    assert.equal(resolveRunLimits(undefined, { maxInputTokens: 5_000_000 }).maxInputTokens, 5_000_000);
    assert.equal(resolveRunLimits(undefined, { maxWallTimeMs: 4 * 60 * 60_000 }).maxWallTimeMs, 4 * 60 * 60_000);
    assert.equal(resolveRunLimits(undefined, { maxTurns: null }).maxTurns, null);
    assert.equal(resolveRunLimits(undefined, { maxTurns: null }).maxProviderAttempts, null);
    assert.equal(resolveRunLimits(undefined, { maxCost: { amount: 50_000, currency: "USD" } }).maxCost?.amount, 50_000);
  });

  it("keeps byte axes process-hard: oversized and null are rejected", () => {
    assert.throws(() => resolveRunLimits(undefined, { maxRequestBytes: 65 * 1024 * 1024 }), /at most 67108864/);
    assert.throws(() => resolveRunLimits(undefined, { maxResponseBytes: null as never }), /maxResponseBytes/);
  });

  it("narrows agent ceilings against run policy with null as +Infinity", () => {
    assert.equal(resolveRunLimits({ maxTurns: 16 }, { maxTurns: null }).maxTurns, 16);
    assert.equal(resolveRunLimits({ maxTurns: 16 }, { maxToolRounds: null }).maxTurns, 16);
    assert.equal(resolveRunLimits({ maxTurns: 16 }, { maxToolRounds: null }).maxToolRounds, null);
  });

  it("lifts provider attempts so they cannot undercut a raised or disabled maxTurns", () => {
    assert.equal(resolveRunLimits(undefined, { maxTurns: 64 }).maxProviderAttempts, 64);
    assert.equal(resolveRunLimits({ maxTurns: 100 }).maxProviderAttempts, 100);
    assert.equal(resolveRunLimits(undefined, { maxProviderAttempts: 24, maxTurns: null }).maxProviderAttempts, 24);
    assert.equal(resolveRunLimits({ maxProviderAttempts: 24 }, { maxTurns: 100 }).maxProviderAttempts, 100);
  });

  it("rejects non-positive, non-integer, and Infinity policy caps", () => {
    for (const bad of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      assert.throws(() => resolveRunLimits(undefined, { maxTurns: bad }), /positive safe integer or null/);
    }
  });

  it("accounts usage once, derives totals, and rejects missing or mixed cost", () => {
    const tracker = new RunLimitTracker(resolveRunLimits(undefined, { maxTotalTokens: 3, maxCost: { amount: 1, currency: "USD" } }));
    tracker.recordUsage({ inputTokens: 1, outputTokens: 2, cost: 1, currency: "USD" });
    assert.equal(tracker.snapshot().totalTokens, 3);
    assert.throws(() => tracker.recordUsage({ outputTokens: 1, cost: 0, currency: "USD" }), RunLimitError);
    const cost = new RunLimitTracker(resolveRunLimits(undefined, { maxCost: { amount: 1, currency: "USD" } }));
    assert.throws(() => cost.recordUsage({ outputTokens: 1, cost: 0, currency: "EUR" }), RunLimitError);
    tracker.dispose();
    cost.dispose();
  });

  it("skips null caps when charging but still enforces finite token caps", () => {
    const unbounded = new RunLimitTracker(resolveRunLimits(undefined, { maxTurns: null, maxWallTimeMs: null }));
    for (let i = 0; i < 100; i++) unbounded.charge("maxTurns");
    assert.equal(unbounded.breach, undefined);
    assert.equal(unbounded.deadlineAt, undefined);
    assert.equal(unbounded.snapshot().turns, 100); // counters still accumulate for durable snapshots
    unbounded.dispose();
    const billed = new RunLimitTracker(resolveRunLimits(undefined, { maxInputTokens: 5_000_000 }));
    assert.throws(() => billed.recordUsage({ inputTokens: 5_000_001 }), RunLimitError);
    billed.dispose();
  });

  it("keeps missing usage fail-closed only for configured cost, not default token caps", () => {
    const costless = new RunLimitTracker(resolveRunLimits(undefined, {}));
    costless.recordUsage(undefined); // vendor omitted usage; DEFAULT token caps must not fail the run
    assert.equal(costless.breach, undefined);
    costless.dispose();
    const costed = new RunLimitTracker(resolveRunLimits(undefined, { maxCost: { amount: 1, currency: "USD" } }));
    assert.throws(() => costed.recordUsage(undefined), RunLimitError);
    costed.dispose();
  });

  it("arms a finite wall timer and breaches through the real clock, without throwing", async () => {
    const breaches: RunLimitBreach[] = [];
    const tracker = new RunLimitTracker(resolveRunLimits(undefined, { maxWallTimeMs: 5 }), {
      onExceeded: (breach) => breaches.push(breach),
    });
    assert.ok(typeof tracker.deadlineAt === "string");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(tracker.breach?.limit, "maxWallTimeMs");
    assert.equal(breaches.length, 1);
    tracker.dispose();
  });

  it("keeps a restored durable deadline even when the wall axis is now disabled", () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    const expired = new RunLimitTracker(resolveRunLimits(undefined, { maxWallTimeMs: null }), { deadlineAt: past });
    assert.equal(expired.breach?.limit, "maxWallTimeMs"); // remaining 0 breaches immediately, no throw
    expired.dispose();
    // > 24.8 days out: Node clamps setTimeout to 1ms, so the timer must re-check the real clock
    const future = new Date(Date.now() + 25 * 86_400_000).toISOString();
    const farOut = new RunLimitTracker(resolveRunLimits(undefined, { maxWallTimeMs: null }), { deadlineAt: future });
    assert.equal(farOut.deadlineAt, future);
    assert.equal(farOut.breach, undefined);
    farOut.dispose();
  });

  it("breaches finite token caps on cumulative usage across rounds", () => {
    const tracker = new RunLimitTracker(
      resolveRunLimits(undefined, { maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: 5_000_000 }),
    );
    tracker.recordUsage({ inputTokens: 3_000_000 });
    assert.equal(tracker.breach, undefined);
    assert.throws(() => tracker.recordUsage({ inputTokens: 2_000_000, outputTokens: 500_000 }), RunLimitError);
    tracker.dispose();
  });

  it("charges UTF-8 provider events at their serialized byte length", async () => {
    const event = providerTextDelta("😀");
    const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    const provider: AIProvider = {
      id: "utf8-bytes",
      async *generate() {
        yield event;
      },
    };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider });
    const within = await agent.createSession().run("hi", { limits: { maxResponseBytes: bytes } });
    assert.equal(within.status, "succeeded");

    await assert.rejects(agent.createSession().run("hi", { limits: { maxResponseBytes: bytes - 1 } }), (error: unknown) => {
      assert.ok(error instanceof AgentRunError);
      assert.equal(error.result.limit?.limit, "maxResponseBytes");
      assert.equal(error.result.limit?.observed, bytes);
      return true;
    });
  });

  it("treats byte caps as per-frame, not run-lifetime sums", () => {
    const tracker = new RunLimitTracker(
      resolveRunLimits(undefined, { maxRequestBytes: 8 * 1024 * 1024, maxResponseBytes: 8 * 1024 * 1024 }),
    );
    for (let i = 0; i < 20; i += 1) tracker.charge("maxRequestBytes", 2 * 1024 * 1024);
    for (let i = 0; i < 20; i += 1) tracker.charge("maxResponseBytes", 2 * 1024 * 1024);
    assert.equal(tracker.snapshot().requestBytes, 20 * 2 * 1024 * 1024);
    assert.equal(tracker.snapshot().responseBytes, 20 * 2 * 1024 * 1024);
    assert.throws(() => tracker.charge("maxRequestBytes", 9 * 1024 * 1024), RunLimitError);
    assert.throws(() => tracker.charge("maxResponseBytes", 8 * 1024 * 1024 + 1), RunLimitError);
    const breach = tracker.breach;
    assert.ok(breach);
    assert.equal(breach.limit, "maxRequestBytes");
    assert.equal(breach.observed, 9 * 1024 * 1024);
    tracker.dispose();
  });

  it("emits one terminal breach and withholds configured-token-budget output", async () => {
    const loop: AgentLoopStrategy = {
      name: "two-turns",
      async run(ctx) {
        await ctx.generate(await ctx.assemble(ctx.input));
        await ctx.generate(await ctx.assemble(ctx.input));
        return undefined;
      },
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("blocked"), providerUsage({ outputTokens: 2 }), providerDone()]),
    });
    const session = agent.createSession();
    const events = collect(session.subscribe());
    await assert.rejects(session.run("hi", { loop, limits: { maxTurns: 1, maxOutputTokens: 1 } }), (error: unknown) => {
      assert.ok(error instanceof AgentRunError);
      assert.equal(error.result.limit?.limit, "maxOutputTokens");
      assert.equal(error.result.limit?.observed, 2);
      return true;
    });
    const observed = await events;
    assert.equal(observed.filter((event) => event.type === "run_limit_exceeded").length, 1);
    assert.equal(
      observed.some((event) => event.type === "message_delta"),
      false,
    );
  });

  it("does not buffer or withhold output when token caps are disabled (null)", async () => {
    const loop: AgentLoopStrategy = {
      name: "two-turns-null",
      async run(ctx) {
        await ctx.generate(await ctx.assemble(ctx.input));
        await ctx.generate(await ctx.assemble(ctx.input));
        return undefined;
      },
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("visible"), providerUsage({ outputTokens: 2 }), providerDone()]),
    });
    const session = agent.createSession();
    const events = collect(session.subscribe());
    const result = await session.run("hi", { loop, limits: { maxTurns: null, maxOutputTokens: null } });
    assert.equal(result.status, "succeeded");
    assert.equal(result.limit, undefined);
    assert.equal(result.attribution, undefined, "a clean run carries no attribution");
    const observed = await events;
    assert.equal(
      observed.some((event) => event.type === "message_delta"),
      true,
    );
    assert.equal(
      observed.some((event) => event.type === "run_limit_exceeded"),
      false,
    );
    assert.equal(
      observed.some((event) => event.type === "budget_exhausted"),
      false,
    );
  });

  it("attributes a maxTurns death with counters, closest axes, and the last ten tool calls", async () => {
    let turn = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        yield providerToolCall(toolCallContent(`call-${turn}`, "echo", { i: turn }));
        yield providerDone({ inputTokens: 5, outputTokens: 1 });
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      parameters: { type: "object", properties: { i: { type: "number" } } },
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
    };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo] });
    const session = agent.createSession();
    const events = collect(session.subscribe());
    let failure: AgentRunError | undefined;
    await assert.rejects(session.run("hi", { limits: { maxTurns: 12, maxToolRounds: 20, maxToolCalls: 20 } }), (error: unknown) => {
      assert.ok(error instanceof AgentRunError);
      failure = error;
      return true;
    });
    const observed = await events;
    const exhausted = observed.filter((event) => event.type === "budget_exhausted");
    assert.equal(exhausted.length, 1, "exactly one attribution event per limit death");
    const [event] = exhausted;
    assert.ok(event);
    assert.equal(event.limit, "maxTurns");
    assert.equal(event.consumed.turns, 13);
    assert.equal(event.consumed.inputTokens, 60);
    assert.equal(event.consumed.providerAttempts, 12);
    assert.ok(event.consumed.requestBytes > 0);
    // Ring buffer: 12 dispatches, the last 10 survive, in order, hashes only.
    assert.deepEqual(
      event.recentToolCalls.map((call) => call.id),
      Array.from({ length: 10 }, (_, index) => `call-${index + 3}`),
    );
    assert.ok(event.recentToolCalls.every((call) => call.name === "echo" && /^sha256:[a-f0-9]{64}$/.test(call.argHash)));
    assert.deepEqual(
      event.closestOtherAxes.map((axis) => axis.axis),
      ["maxToolRounds", "maxToolCalls", "maxProviderAttempts"],
    );
    assert.deepEqual(
      event.closestOtherAxes.map((axis) => axis.usedRatio),
      [0.6, 0.6, 0.5],
    );
    const order = observed.map((event) => event.type);
    assert.ok(
      order.indexOf("run_limit_exceeded") < order.indexOf("budget_exhausted") && order.indexOf("budget_exhausted") < order.indexOf("error"),
      "a limit death must deliver its breach, then its attribution, then the run's error",
    );
    // Plan 108 T5: the same payload rides the terminal result, so a host that keeps only the
    // result reads exactly what the event reported, and the breach itself stays on `limit`.
    const result = failure?.result;
    assert.equal(result?.limit?.limit, "maxTurns");
    assert.deepEqual(result?.attribution?.consumed, event.consumed);
    assert.deepEqual(result?.attribution?.closestOtherAxes, event.closestOtherAxes);
    assert.deepEqual(result?.attribution?.recentToolCalls, event.recentToolCalls);
    assert.deepEqual(Object.keys(result?.attribution ?? {}).sort(), ["closestOtherAxes", "consumed", "recentToolCalls"]);
  });

  it("names the run input budget axis when cumulative tokens die, and hashes tool-call arguments", async () => {
    const secret = "sk-live-do-not-leak";
    let turn = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        yield providerToolCall(toolCallContent(`call-${turn}`, "echo", { token: secret }));
        yield providerUsage({ inputTokens: 6 });
        yield providerDone();
      },
    };
    const echo: ToolDefinition = {
      name: "echo",
      parameters: { type: "object", properties: { token: { type: "string" } } },
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
    };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, tools: [echo] });
    const session = agent.createSession();
    const events = collect(session.subscribe());
    await assert.rejects(session.run("hi", { limits: { maxInputTokens: 10 } }), (error: unknown) => {
      assert.ok(error instanceof AgentRunError);
      assert.equal(error.result.limit?.limit, "maxInputTokens");
      return true;
    });
    const observed = await events;
    const exhausted = observed.filter((event) => event.type === "budget_exhausted");
    assert.equal(exhausted.length, 1);
    const [event] = exhausted;
    assert.ok(event);
    assert.equal(event.limit, "maxInputTokens");
    assert.equal(event.consumed.inputTokens, 12);
    assert.equal(event.consumed.turns, 2);
    assert.equal(event.recentToolCalls.length, 1);
    const [call] = event.recentToolCalls;
    assert.ok(call);
    assert.match(call.argHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes(secret), false, "raw arguments never enter the attribution event");
  });

  it("carries no attribution for a host abort", async () => {
    let ready: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        ready?.();
        await new Promise<void>((_resolve, reject) =>
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true }),
        );
      },
    };
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider, limits: { maxTurns: 4 } });
    const controller = new AbortController();
    const run = agent.createSession().run("hi", { signal: controller.signal });
    await started;
    controller.abort(new Error("host cancels"));
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof AgentRunError);
      assert.equal(error.result.status, "aborted");
      assert.equal(error.result.limit, undefined);
      assert.equal(error.result.attribution, undefined, "an abort is not a ceiling death");
      return true;
    });
  });

  it("carries attribution on a durable resumed run that dies on a limit", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "durable-limit",
      model: { provider: "mock", model: "demo" },
      limits: { maxToolCalls: 1 },
      store: createMemorySessionStore(),
      provider: createMockProvider([
        providerToolCall(toolCallContent("call-1", "write", { v: 1 })),
        providerToolCall(toolCallContent("call-2", "write", { v: 2 })),
        providerDone(),
      ]),
      tools: [
        { name: "write", parameters: {}, execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: "ok" }) },
      ],
    });
    const first = await agent.createSession({ id: "durable-limit-session" }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    assert.equal(first.status, "suspended");
    const version = first.runState?.version;
    assert.ok(version !== undefined, "the suspended run carries its version");

    const events: AgentEvent[] = [];
    let failure: AgentRunError | undefined;
    try {
      for await (const event of resumeAgentRunStream(
        agent,
        { runId: first.runId, sessionId: first.sessionId },
        { decision: "approve", expectedVersion: version },
        { checkpoints, definitionRevision: "1" },
      )) {
        events.push(event);
      }
    } catch (error) {
      assert.ok(error instanceof AgentRunError);
      failure = error;
    }
    const exhausted = events.find((event) => event.type === "budget_exhausted");
    assert.ok(exhausted, "a resumed limit death still emits its attribution");
    assert.equal(failure?.result.limit?.limit, "maxToolCalls");
    assert.deepEqual(failure?.result.attribution?.consumed, exhausted.consumed);
    assert.deepEqual(failure?.result.attribution?.closestOtherAxes, exhausted.closestOtherAxes);
    assert.deepEqual(failure?.result.attribution?.recentToolCalls, exhausted.recentToolCalls);
  });
});
