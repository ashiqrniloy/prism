import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  HARD_RUN_LIMITS,
  type LoopStrategy,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type RunLimitBreach,
  RunLimitError,
  type RunLimits,
  resolveRunLimits,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
// The tracker class is kernel-internal since plan 215 Task 26; the root exports its type and factory.
import { RunLimitTracker } from "../run-limits.js";
import { jsonBytes, PROVIDER_EVENT_OVERHEAD_BYTES, providerEventBytes, requestBytes } from "../agent-session/helpers.js";
import { mockProvider } from "../testing/index.js";

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

  it("keeps DEFAULT_RUN_LIMITS as the unconfigured fence sized for agent work (plan 229 Task 2)", () => {
    const resolved = resolveRunLimits(undefined, undefined);
    assert.deepEqual(
      { ...resolved, maxCost: undefined },
      {
        maxTurns: 50,
        maxProviderAttempts: 75,
        maxToolRounds: 49,
        maxToolCalls: 200,
        maxRepeatedToolRounds: 5,
        maxWallTimeMs: 900_000,
        maxRequestBytes: 8 * 1024 * 1024,
        maxResponseBytes: 8 * 1024 * 1024,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxTotalTokens: null,
        maxCost: undefined,
        maxContinuations: 3,
        maxToolTimeMs: null,
        bufferOutput: false,
        maxRunStateBytes: 256 * 1024,
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
    assert.throws(
      () => resolveRunLimits(undefined, { maxRequestBytes: 65 * 1024 * 1024 }),
      /at most ceilings\.maxRequestBytes \(67108864\)/,
    );
    assert.throws(() => resolveRunLimits(undefined, { maxResponseBytes: null as never }), /maxResponseBytes/);
  });

  it("narrows agent ceilings against run policy with null as +Infinity", () => {
    assert.equal(resolveRunLimits({ maxTurns: 16 }, { maxTurns: null }).maxTurns, 16);
    assert.equal(resolveRunLimits({ maxTurns: 16 }, { maxToolRounds: null }).maxTurns, 16);
    assert.equal(resolveRunLimits({ maxTurns: 16 }, { maxToolRounds: null }).maxToolRounds, null);
  });

  it("lifts provider attempts so they cannot undercut a raised or disabled maxTurns", () => {
    assert.equal(resolveRunLimits(undefined, { maxTurns: 64 }).maxProviderAttempts, 75, "default attempts keep spare retries");
    assert.equal(resolveRunLimits(undefined, { maxTurns: 96 }).maxProviderAttempts, 96);
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

  it("charges UTF-8 provider events at their sized byte length", async () => {
    const event = providerTextDelta("😀");
    // Plan 228 Task 4: the text's UTF-8 bytes plus the fixed per-event framing, never the stringified event.
    const bytes = providerEventBytes(event);
    assert.equal(bytes, PROVIDER_EVENT_OVERHEAD_BYTES + 4);
    assert.ok(bytes >= Buffer.byteLength(JSON.stringify(event), "utf8"));
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield event;
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
    });
    const within = await (await agent.session()).run("hi", { limits: { maxResponseBytes: bytes } });
    assert.equal(within.status, "completed");

    {
      const outcome = await (await agent.session()).run("hi", { limits: { maxResponseBytes: bytes - 1 } });
      assert.equal(outcome.limit?.limit, "maxResponseBytes");
      assert.equal(outcome.limit?.observed, bytes);
    }
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

  it("buffer_output_true_holds_deltas_until_turn_end: emits one terminal breach and withholds the breaching turn's output", async () => {
    const loop: LoopStrategy = {
      name: "two-turns",
      async run(run) {
        await run.turn();
        await run.turn();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("blocked"), providerUsage({ outputTokens: 2 }), providerDone()]])],
      slots: { loop },
    });
    const session = await agent.session();
    const events = collect(session.subscribe());
    {
      const outcome = await session.run("hi", { limits: { maxTurns: 1, maxOutputTokens: 1, bufferOutput: true } });
      assert.equal(outcome.limit?.limit, "maxOutputTokens");
      assert.equal(outcome.limit?.observed, 2);
    }
    const observed = await events;
    assert.equal(observed.filter((event) => event.type === "run.failed").length, 1);
    assert.equal(
      observed.some((event) => event.type === "message.delta"),
      false,
    );
  });

  it("does not buffer or withhold output when token caps are disabled (null)", async () => {
    const loop: LoopStrategy = {
      name: "two-turns-null",
      async run(run) {
        await run.turn();
        await run.turn();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("visible"), providerUsage({ outputTokens: 2 }), providerDone()]])],
      slots: { loop },
    });
    const session = await agent.session();
    const events = collect(session.subscribe());
    const result = await session.run("hi", { limits: { maxTurns: null, maxOutputTokens: null } });
    assert.equal(result.status, "completed");
    assert.equal(result.limit, undefined);
    assert.equal(result.attribution, undefined, "a clean run carries no attribution");
    const observed = await events;
    assert.equal(
      observed.some((event) => event.type === "message.delta"),
      true,
    );
    assert.equal(
      observed.some((event) => event.type === "run.failed"),
      false,
    );
    assert.equal(
      observed.some((event) => event.type === "run.failed"),
      false,
    );
  });

  it("attributes a maxTurns death with counters, closest axes, and the last ten tool calls", async () => {
    let turn = 0;
    const provider: ModelProvider = {
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
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
    });
    const session = await agent.session();
    const events = collect(session.subscribe());
    const failure = await session.run("hi", {
      limits: { maxTurns: 12, maxProviderAttempts: 24, maxToolRounds: 20, maxToolCalls: 20 },
    });
    const observed = await events;
    const exhausted = observed.filter((event) => event.type === "run.failed");
    assert.equal(exhausted.length, 1, "exactly one attribution event per limit death");
    const [event] = exhausted;
    assert.ok(event);
    assert.equal(event.limit?.limit, "maxTurns");
    assert.equal(event.attribution?.consumed.turns, 13);
    assert.equal(event.attribution?.consumed.inputTokens, 60);
    assert.equal(event.attribution?.consumed.providerAttempts, 12);
    assert.ok(event.attribution?.consumed.requestBytes > 0);
    // Ring buffer: 12 dispatches, the last 10 survive, in order, hashes only.
    assert.deepEqual(
      event.attribution?.recentToolCalls.map((call) => call.id),
      Array.from({ length: 10 }, (_, index) => `call-${index + 3}`),
    );
    assert.ok(event.attribution?.recentToolCalls.every((call) => call.name === "echo" && /^sha256:[a-f0-9]{64}$/.test(call.argHash)));
    assert.deepEqual(
      event.attribution?.closestOtherAxes.map((axis) => axis.axis),
      ["maxToolRounds", "maxToolCalls", "maxProviderAttempts"],
    );
    assert.deepEqual(
      event.attribution?.closestOtherAxes.map((axis) => axis.usedRatio),
      [0.6, 0.6, 0.5],
    );
    // The breach, its attribution, and the run's error are now one terminal `run.failed`, so the
    // stream ends on exactly one record and nothing follows it.
    assert.equal(observed.at(-1)?.type, "run.failed", "a limit death must end the stream with one run.failed");
    assert.equal(observed.filter((event) => event.type === "run.failed").length, 1);
    // Plan 108 T5: the same payload rides the terminal result, so a host that keeps only the
    // result reads exactly what the event reported, and the breach itself stays on `limit`.
    const result = failure;
    assert.equal(result.status, "failed");
    assert.equal(result?.limit?.limit, "maxTurns");
    assert.deepEqual(result?.attribution?.consumed, event.attribution?.consumed);
    assert.deepEqual(result?.attribution?.closestOtherAxes, event.attribution?.closestOtherAxes);
    assert.deepEqual(result?.attribution?.recentToolCalls, event.attribution?.recentToolCalls);
    assert.deepEqual(Object.keys(result?.attribution ?? {}).sort(), ["closestOtherAxes", "consumed", "recentToolCalls"]);
  });

  it("names the run input budget axis when cumulative tokens die, and hashes tool-call arguments", async () => {
    const secret = "sk-live-do-not-leak";
    let turn = 0;
    const provider: ModelProvider = {
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
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
    });
    const session = await agent.session();
    const events = collect(session.subscribe());
    {
      const outcome = await session.run("hi", { limits: { maxInputTokens: 10 } });
      assert.equal(outcome.limit?.limit, "maxInputTokens");
    }
    const observed = await events;
    const exhausted = observed.filter((event) => event.type === "run.failed");
    assert.equal(exhausted.length, 1);
    const [event] = exhausted;
    assert.ok(event);
    assert.equal(event.limit?.limit, "maxInputTokens");
    assert.equal(event.attribution?.consumed.inputTokens, 12);
    assert.equal(event.attribution?.consumed.turns, 2);
    assert.equal(event.attribution?.recentToolCalls.length, 1);
    const [call] = event.attribution?.recentToolCalls ?? [];
    assert.ok(call);
    assert.match(call.argHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes(secret), false, "raw arguments never enter the attribution event");
  });

  it("carries no attribution for a host abort", async () => {
    let ready: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const provider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        ready?.();
        await new Promise<void>((_resolve, reject) =>
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true }),
        );
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      limits: { maxTurns: 4 },
    });
    const controller = new AbortController();
    const run = (await agent.session()).run("hi", { signal: controller.signal });
    await started;
    controller.abort(new Error("host cancels"));
    {
      const outcome = await run;
      assert.equal(outcome.status, "aborted");
      assert.equal(outcome.limit, undefined);
      assert.equal(outcome.attribution, undefined, "an abort is not a ceiling death");
    }
  });

  it("carries attribution on a durable resumed run that dies on a limit", async () => {
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "durable-limit",
      model: { provider: "mock", model: "demo" },
      limits: { maxToolCalls: 1 },
      slots: { store: createMemorySessionStore() },
      packages: [
        mockProvider([
          [
            providerToolCall(toolCallContent("call-1", "write", { v: 1 })),
            providerToolCall(toolCallContent("call-2", "write", { v: 2 })),
            providerDone(),
          ],
        ]),
      ],
      tools: {
        add: [
          { name: "write", parameters: {}, execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: "ok" }) },
        ],
      },
    });
    const session = await agent.session({ id: "durable-limit-session", create: true });
    const first = await session.run("go");
    assert.equal(first.status, "suspended");

    const events: AgentEvent[] = [];
    // A resumed leg that dies on a ceiling ends the stream normally, with its one terminal `run.failed`.
    for await (const event of session.resume(
      first.pending!.map((pending) => ({ approvalId: pending.approvalId, outcome: "allow_once" as const })),
    )) {
      events.push(event);
    }
    const exhausted = events.find((event) => event.type === "run.failed");
    assert.ok(exhausted, "a resumed limit death still emits its attribution");
    assert.equal(exhausted.limit?.limit, "maxToolCalls");
    assert.ok(exhausted.attribution?.consumed, "the terminal event carries the attribution");
  });
});

describe("live delivery under caps (plan 228 Task 2)", () => {
  /** Yields `count` text deltas `gapMs` apart, then usage and done. */
  function pacedProvider(count: number, gapMs: number, outputTokens = 1): ModelProvider {
    return {
      id: "mock",
      async *generate() {
        for (let i = 0; i < count; i += 1) {
          if (i > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
          yield providerTextDelta(`d${i}`);
        }
        yield providerUsage({ outputTokens });
        yield providerDone();
      },
    };
  }

  async function arrivals(limits: RunLimits, runLimits: RunLimits) {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [pacedProvider(4, 60)])],
      limits,
    });
    const session = await agent.session();
    const start = performance.now();
    const seen: { type: AgentEvent["type"]; at: number }[] = [];
    const done = (async () => {
      // `close` keeps each delta's boundary: these cases time individual deltas, and the default `coalesce`
      // would merge a buffered burst into fewer events (plan 228 Task 3).
      for await (const event of session.subscribe({ overflow: "close" })) seen.push({ type: event.type, at: performance.now() - start });
    })();
    const result = await session.run("hi", { limits: runLimits });
    await session.close();
    await done;
    return { result, seen };
  }

  it("deltas_arrive_live_with_token_caps: arrival times track production times", async () => {
    const { result, seen } = await arrivals({ maxOutputTokens: 100_000 }, { maxTotalTokens: 100_000 });
    assert.equal(result.status, "completed");
    const deltas = seen.filter((event) => event.type === "message.delta");
    assert.equal(deltas.length, 4);
    // Production spans ~180 ms; buffered delivery would land all four together at turn end.
    assert.ok(deltas[3]!.at - deltas[0]!.at >= 120, `deltas spread over ${deltas[3]!.at - deltas[0]!.at} ms`);
    const completed = seen.findIndex((event) => event.type === "turn.completed");
    assert.ok(completed > seen.lastIndexOf(deltas[3]!), "turn.completed follows the turn's last delta");
  });

  it("buffer_output_true_holds_deltas_until_turn_end: all deltas land together, just before turn.completed", async () => {
    const { result, seen } = await arrivals({ maxOutputTokens: 100_000 }, { bufferOutput: true });
    assert.equal(result.status, "completed");
    const deltas = seen.filter((event) => event.type === "message.delta");
    assert.equal(deltas.length, 4);
    assert.ok(deltas[3]!.at - deltas[0]!.at < 30, `buffered deltas spread over ${deltas[3]!.at - deltas[0]!.at} ms`);
    const types = seen.map((event) => event.type);
    assert.equal(types[types.indexOf("turn.completed") - 1], "message.delta");
  });

  it("cap_breach_reports_once_under_live_delivery: deltas, then turn.completed{error}, then one run.failed", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("shown"), providerUsage({ outputTokens: 2 }), providerDone()]])],
    });
    const session = await agent.session();
    const events = collect(session.subscribe());
    const outcome = await session.run("hi", { limits: { maxOutputTokens: 1 } });
    assert.equal(outcome.limit?.limit, "maxOutputTokens");
    assert.equal(outcome.limit?.observed, 2);
    assert.ok(outcome.attribution);
    await session.close();
    const observed = await events;
    const types = observed.map((event) => event.type);
    assert.equal(types.filter((type) => type === "run.failed").length, 1);
    const delta = types.indexOf("message.delta");
    const turnCompleted = types.indexOf("turn.completed");
    const failed = types.indexOf("run.failed");
    assert.ok(delta >= 0 && delta < turnCompleted && turnCompleted < failed, types.join(","));
    const completedEvent = observed[turnCompleted] as Extract<AgentEvent, { type: "turn.completed" }>;
    assert.ok(completedEvent.error, "the breaching turn completes with an error");
    const failedEvent = observed[failed] as Extract<AgentEvent, { type: "run.failed" }>;
    assert.equal(failedEvent.limit?.limit, "maxOutputTokens");
    assert.ok(failedEvent.attribution);
    // Nothing from the breaching turn is persisted: the assistant message is appended only after the turn returns.
    assert.equal(
      (await session.messages()).some((message) => message.role === "assistant"),
      false,
    );
  });

  it("buffer_output_narrows_true_wins_across_layers", () => {
    assert.equal(resolveRunLimits(undefined, undefined).bufferOutput, false);
    assert.equal(resolveRunLimits({ maxOutputTokens: 1 }, { maxCost: { amount: 1, currency: "USD" } }).bufferOutput, false);
    assert.equal(resolveRunLimits({ bufferOutput: true }, undefined).bufferOutput, true);
    assert.equal(resolveRunLimits(undefined, { bufferOutput: true }).bufferOutput, true);
    assert.equal(resolveRunLimits({ bufferOutput: true }, { bufferOutput: false }).bufferOutput, true);
    assert.equal(resolveRunLimits({ bufferOutput: false }, { bufferOutput: true }).bufferOutput, true);
    assert.throws(() => resolveRunLimits(undefined, { bufferOutput: "yes" as never }), /bufferOutput must be a boolean/);
  });
});

describe("byte accounting without re-serializing (plan 228 Task 4)", () => {
  const unicodeMessages = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: [{ type: "text" as const, text: `turn ${i}: héllo wörld 😀 日本語 "quoted" \\ back\nslash ${"x".repeat(i * 7)}` }],
    ...(i % 5 === 0 ? { metadata: { source: "fixture", n: i, nested: { ok: true, nil: null } } } : {}),
  }));
  const imageMessage = {
    role: "user" as const,
    content: [
      { type: "text" as const, text: "describe this" },
      { type: "image" as const, mimeType: "image/png", data: Buffer.from("x".repeat(30_000)).toString("base64") },
    ],
  };
  const tools = Array.from({ length: 12 }, (_, i) => ({
    name: `tool_${i}`,
    description: `Tool ${i} — does “things”`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "a path" }, n: { type: "number" } },
      required: ["path"],
    },
  }));

  it("request_bytes_within_two_percent_of_serialized_size", () => {
    const fixtures = [
      { model: { provider: "mock", model: "demo" }, messages: unicodeMessages },
      { model: { provider: "mock", model: "demo" }, messages: [...unicodeMessages, imageMessage], tools },
      {
        model: { provider: "mock", model: "demo" },
        messages: [imageMessage],
        tools,
        context: [{ id: "c1", text: "context ✓" }],
        options: { temperature: 0.2, maxTokens: 512 },
        metadata: { tag: "é" },
        origin: undefined,
      },
      { model: { provider: "mock", model: "demo" }, messages: [] },
    ];
    for (const request of fixtures) {
      const truth = jsonBytes(request);
      const sized = requestBytes(request);
      assert.ok(Math.abs(sized - truth) <= truth * 0.02, `sized ${sized} vs serialized ${truth}`);
      assert.ok(sized >= truth * 0.98);
      // A second call reuses the memoized parts and gives the same answer.
      assert.equal(requestBytes(request), sized);
    }
  });

  it("request_bytes_still_guard_serializability", () => {
    const cyclic: Record<string, unknown> = { role: "user", content: [] };
    cyclic.self = cyclic;
    assert.throws(
      () => requestBytes({ model: { provider: "mock", model: "demo" }, messages: [cyclic] }),
      /JSON-serializable for run limits/,
    );
  });

  it("oversized_request_still_fails_closed", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("never"), providerDone()]])],
    });
    const outcome = await (await agent.session()).run("y".repeat(4096), { limits: { maxRequestBytes: 1024 } });
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.limit?.limit, "maxRequestBytes");
    assert.ok((outcome.limit?.observed ?? 0) > 4096);
  });

  it("oversized_frame_still_fails_closed", async () => {
    // A 65 MiB text frame: above the 64 MiB hard cap, so no configuration can admit it.
    const huge = "z".repeat(65 * 1024 * 1024);
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        yield providerTextDelta(huge);
        yield providerDone();
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
    });
    const outcome = await (await agent.session()).run("hi", { limits: { maxResponseBytes: HARD_RUN_LIMITS.maxResponseBytes } });
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.limit?.limit, "maxResponseBytes");
    assert.ok((outcome.limit?.observed ?? 0) >= 65 * 1024 * 1024);
  });

  it("sizes streamed deltas from their strings and never under-counts multibyte text", () => {
    for (const text of ["", "ascii", "😀😀", "日本語テキスト", "é".repeat(1000)]) {
      const event = providerTextDelta(text);
      assert.equal(providerEventBytes(event), PROVIDER_EVENT_OVERHEAD_BYTES + Buffer.byteLength(text, "utf8"));
      assert.ok(providerEventBytes(event) >= jsonBytes(event));
    }
    const argDelta = { type: "tool_call_delta" as const, index: 0, id: "call_1", name: "read", argumentsText: '{"path":"ü"}' };
    // Argument text is charged at its own UTF-8 length; JSON escaping of its quotes is not counted.
    assert.equal(providerEventBytes(argDelta), PROVIDER_EVENT_OVERHEAD_BYTES + 6 + 4 + Buffer.byteLength(argDelta.argumentsText));
    const call = providerToolCall(toolCallContent("call_1", "read", { path: "a" }));
    assert.equal(providerEventBytes(call), jsonBytes(call));
  });
});

describe("default run limits sized for agent work (plan 229 Task 2)", () => {
  const echo: ToolDefinition = {
    name: "echo",
    parameters: { type: "object", properties: { i: { type: "number" } } },
    execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: "ok" }),
  };

  /** A provider that calls `echo` for `rounds` turns (or forever), each turn reporting `inputTokens`. */
  async function toolLoopAgent(rounds: number, inputTokens: number) {
    let turn = 0;
    const provider: ModelProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn <= rounds) yield providerToolCall(toolCallContent(`call-${turn}`, "echo", { i: turn }));
        else yield providerTextDelta("done");
        yield providerDone({ inputTokens, outputTokens: 50 });
      },
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: { add: [echo] },
    });
    return { agent, session: await agent.session(), turns: () => turn };
  }

  it("default_limits_finish_a_twelve_round_task", async () => {
    // Probe p6-defaults: 12 rounds at 6,000 input tokens a turn passed the old 40,000 cumulative cap at turn 7.
    const { agent, session, turns } = await toolLoopAgent(12, 6_000);
    const result = await session.run("do the task");
    assert.equal(result.status, "completed");
    assert.equal(result.limit, undefined);
    assert.equal(turns(), 13);
    await agent.dispose();
  });

  it("default_limits_still_end_a_runaway_loop", async () => {
    const { agent, session, turns } = await toolLoopAgent(Number.POSITIVE_INFINITY, 10);
    const result = await session.run("loop forever");
    assert.equal(result.status, "stopped");
    assert.equal(result.stopReason, "turn_limit");
    assert.equal(result.limit, undefined);
    assert.equal(turns(), 50, "49 tool rounds run; the 50th turn's calls are settled, not dispatched");
    await agent.dispose();
  });

  it("default_token_axes_are_disabled", () => {
    const resolved = resolveRunLimits();
    assert.equal(resolved.maxInputTokens, null);
    assert.equal(resolved.maxOutputTokens, null);
    assert.equal(resolved.maxTotalTokens, null);
    const tracker = new RunLimitTracker(resolved);
    tracker.recordUsage({ inputTokens: 10_000_000, outputTokens: 1_000_000 });
    assert.equal(tracker.breach, undefined);
    tracker.dispose();
  });

  it("host_token_cap_still_breaches", async () => {
    const { agent, session } = await toolLoopAgent(12, 6_000);
    const result = await session.run("do the task", { limits: { maxInputTokens: 40_000 } });
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "maxInputTokens");
    await agent.dispose();
  });
});
