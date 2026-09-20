/** Plan 103 T4: snapshot-keyed `contextMeter()` cache — identity, invalidation, parity, and poll cost. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentSession, ContextMeter, Message, ModelConfig } from "../index.js";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, resolveInputCap } from "../index.js";

const MODEL: ModelConfig = { provider: "mock", model: "claude-sonnet-4.5", limits: { contextWindow: 100_000 } };
const CAP = resolveInputCap({}, MODEL);
const RUN_INPUT_BUDGET = 5_000;
/** Warm reads must not re-enter the estimator (a 200k-char cold read measures ≈1ms on the reference machine). */
const POLL_READS = 1_000;
const POLL_BUDGET_MS = 250;
const COLD_BUDGET_MS = 50;

const silentProvider = {
  id: "mock",
  async *generate() {
    yield providerTextDelta("ok");
    yield providerDone();
  },
};

function createSession(id: string): AgentSession {
  const agent = createAgent({ id: `${id}-agent`, store: createMemorySessionStore(), model: MODEL, provider: silentProvider });
  return agent.createSession({ id });
}

function textMessage(role: "user" | "assistant", text: string): Message {
  return { role, content: [{ type: "text", text }] };
}

/** Test-only reach into the private history (same cast pattern as `leak-sessions.test.ts`). */
function historyOf(session: AgentSession): Message[] {
  return (session as unknown as { history: Message[] }).history;
}

/** Read the meter while the run is still active (run budget visible), then once more after it ends. */
async function metersDuringRun(session: AgentSession, input: string): Promise<{ during?: ContextMeter; after: ContextMeter }> {
  let during: ContextMeter | undefined;
  const subscription = session.subscribe();
  const pump = (async () => {
    for await (const event of subscription) {
      if (event.type === "provider_turn_finished") during = session.contextMeter();
    }
  })();
  await session.run(input, { limits: { maxInputTokens: RUN_INPUT_BUDGET, maxTurns: 4 } });
  await pump;
  return { during, after: session.contextMeter() };
}

describe("context-meter cache (plan 103 T4)", () => {
  it("returns the identical frozen value until something changes", () => {
    const session = createSession("meter-identity");
    historyOf(session).push(textMessage("user", "x".repeat(4_000)));
    const first = session.contextMeter();
    assert.equal(session.contextMeter(), first, "unchanged state serves the same object");
    assert.ok(Object.isFrozen(first), "the cached value is frozen");
    assert.throws(() => {
      (first as unknown as { inputTokens: number }).inputTokens = 1;
    }, TypeError);
    assert.equal(first.inputCap, CAP);
  });

  it("a recomputed value after invalidation deep-equals the cached one", () => {
    const session = createSession("meter-parity");
    historyOf(session).push(textMessage("user", "x".repeat(4_000)));
    const cached = session.contextMeter();
    (session as unknown as { invalidateSnapshot(): void }).invalidateSnapshot();
    const fresh = session.contextMeter();
    assert.notEqual(fresh, cached, "a generation bump recomputes");
    assert.deepEqual(fresh, cached, "the recompute is field-identical: no stale-field drift");
  });

  it("an in-place history push invalidates without a generation bump", () => {
    const session = createSession("meter-push");
    historyOf(session).push(textMessage("user", "a".repeat(4_000)));
    const before = session.contextMeter();
    // The run loop pushes into the same array during a turn (`agent-loops.ts`), before any
    // entry append bumps the generation — the length guard is what keeps the meter honest.
    historyOf(session).push(textMessage("assistant", "b".repeat(4_000)));
    const after = session.contextMeter();
    assert.notEqual(after, before);
    assert.ok(after.inputTokens > before.inputTokens, "the pushed message is counted");
  });

  it("an appended turn invalidates and labels the new reading", async () => {
    const session = createSession("meter-append");
    const before = session.contextMeter();
    assert.equal(before.inputTokens, 0, "an empty history estimates zero");
    const { after } = await metersDuringRun(session, "hello");
    assert.notEqual(after, before);
    assert.equal(after.source, "estimated", "the silent provider leaves the label in place");
    assert.ok(after.inputTokens > before.inputTokens);
    assert.equal(after.runInputBudget, undefined);
  });

  it("a run boundary changes runInputBudget and invalidates both ways", async () => {
    const session = createSession("meter-run");
    const idle = session.contextMeter();
    assert.equal(idle.runInputBudget, undefined, "no run, no budget");
    const { during, after } = await metersDuringRun(session, "hi");
    assert.ok(during, "a meter read inside the run must exist");
    assert.equal(during.runInputBudget, RUN_INPUT_BUDGET);
    assert.notEqual(during, idle);
    assert.equal(after.runInputBudget, undefined, "the budget ends with the run");
    assert.notEqual(after, during);
    assert.equal(session.contextMeter(), after, "the post-run read is cached too");
  });

  it("compact() drops the pre-compaction reading", async () => {
    const session = createSession("meter-compact");
    const { after } = await metersDuringRun(session, "hi");
    assert.equal(session.contextMeter(), after);
    await session.compact();
    const compacted = session.contextMeter();
    assert.notEqual(compacted, after, "compact() clears the active meter");
    assert.equal(compacted.source, "estimated");
    assert.equal(session.contextMeter(), compacted);
  });

  it("two sessions over different histories never share a value", () => {
    const first = createSession("meter-first");
    const second = createSession("meter-second");
    historyOf(first).push(textMessage("user", "a".repeat(4_000)));
    historyOf(second).push(textMessage("user", "b".repeat(8_000)));
    const firstMeter = first.contextMeter();
    const secondMeter = second.contextMeter();
    assert.notEqual(firstMeter, secondMeter);
    assert.ok(secondMeter.inputTokens > firstMeter.inputTokens);
    assert.equal(first.contextMeter(), firstMeter);
    assert.equal(second.contextMeter(), secondMeter);
  });

  it("1,000 warm reads over a 200k-char history touch no history element", () => {
    const session = createSession("meter-poll");
    const touches = { iterated: 0, indexed: 0 };
    const probe = new Proxy(
      Array.from({ length: 20 }, (_, index) => textMessage("user", `message ${index} ${"x".repeat(10_000)}`)),
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) touches.iterated += 1;
          else if (typeof property === "string" && /^\d+$/.test(property)) touches.indexed += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    // The proxy IS the session history, so any estimation pass through it is counted.
    (session as unknown as { history: Message[] }).history = probe as unknown as Message[];

    const coldStart = performance.now();
    const cold = session.contextMeter();
    const coldMs = performance.now() - coldStart;
    const coldTouches = touches.iterated + touches.indexed;
    assert.ok(coldTouches > 0, "the cold read estimates through the history array");
    assert.ok(coldMs < COLD_BUDGET_MS, `cold read took ${coldMs.toFixed(2)}ms`);

    const warmStart = performance.now();
    for (let read = 0; read < POLL_READS; read += 1) assert.equal(session.contextMeter(), cold);
    const warmMs = performance.now() - warmStart;
    assert.equal(touches.iterated + touches.indexed, coldTouches, "warm reads never re-enter the estimator");
    assert.ok(warmMs < POLL_BUDGET_MS, `${POLL_READS} warm reads took ${warmMs.toFixed(1)}ms`);
  });
});
