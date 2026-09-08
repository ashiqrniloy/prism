import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEvent,
  type AgentLoopStrategy,
  AgentRunError,
  type AIProvider,
  createAgent,
  createMockProvider,
  HARD_RUN_LIMITS,
  providerDone,
  providerTextDelta,
  providerUsage,
  type RunLimitBreach,
  RunLimitError,
  RunLimitTracker,
  resolveRunLimits,
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
    const observed = await events;
    assert.equal(
      observed.some((event) => event.type === "message_delta"),
      true,
    );
    assert.equal(
      observed.some((event) => event.type === "run_limit_exceeded"),
      false,
    );
  });
});
