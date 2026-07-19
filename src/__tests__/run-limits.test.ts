import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentRunError,
  RunLimitError,
  RunLimitTracker,
  createAgent,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerUsage,
  resolveRunLimits,
  type AgentEvent,
  type AgentLoopStrategy,
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
    assert.throws(() => resolveRunLimits({ maxCost: { amount: 1, currency: "USD" } }, { maxCost: { amount: 1, currency: "EUR" } }), /currencies/);
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
    assert.equal(observed.some((event) => event.type === "message_delta"), false);
  });
});
