/** Plan 228 Task 3: a lagging subscriber is coalesced, and overflow no longer aborts the run. */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { MAX_COALESCED_DELTA_CHARS, mergeContentBlocks, mergeDeltaEvents } from "../agent-session/coalesce.js";
import { DEFAULT_MAX_QUEUED_EVENTS, EventSubscriber } from "../agent-session/event-subscriber.js";
import {
  type AgentEvent,
  createAgent,
  createSecretRedactor,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  redactAgentEvent,
  SubscriberOverflowError,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const textDelta = (text: string, runId = "r1"): AgentEvent => ({
  type: "message.delta",
  sessionId: "s1",
  runId,
  content: { type: "text", text },
});
const thinkingDelta = (text: string, extra: Record<string, unknown> = {}): AgentEvent => ({
  type: "message.delta",
  sessionId: "s1",
  runId: "r1",
  content: { type: "thinking", text, ...extra },
});
const progress = (toolCallId: string, value: number): AgentEvent => ({
  type: "tool.progress",
  sessionId: "s1",
  runId: "r1",
  toolCallId,
  name: "t",
  progress: value,
});
const turnStarted: AgentEvent = { type: "run.started", sessionId: "s1", runId: "r1" } as AgentEvent;

function subscriber(options: ConstructorParameters<typeof EventSubscriber>[1] = {}): EventSubscriber {
  return new EventSubscriber("s1", options, () => {});
}

async function drain(sub: EventSubscriber): Promise<AgentEvent[]> {
  sub.close();
  const events: AgentEvent[] = [];
  for await (const event of sub) events.push(event);
  return events;
}

const text = (events: readonly AgentEvent[]) =>
  events.map((event) => (event.type === "message.delta" && event.content.type === "text" ? event.content.text : "")).join("");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("merge helper (plan 228 Task 3)", () => {
  it("merges text, and thinking only without redacted or data, carrying the signature over", () => {
    assert.deepEqual(mergeContentBlocks({ type: "text", text: "a" }, { type: "text", text: "b" }), { type: "text", text: "ab" });
    assert.deepEqual(mergeContentBlocks({ type: "thinking", text: "a", signature: "s0" }, { type: "thinking", text: "b" }), {
      type: "thinking",
      text: "ab",
      signature: "s0",
    });
    assert.equal(mergeContentBlocks({ type: "thinking", text: "a", redacted: true }, { type: "thinking", text: "b" }), undefined);
    assert.equal(mergeContentBlocks({ type: "thinking", text: "a" }, { type: "thinking", text: "b", data: "x" }), undefined);
    assert.equal(mergeContentBlocks({ type: "text", text: "a" }, { type: "thinking", text: "b" }), undefined);
    assert.equal(mergeContentBlocks(undefined, { type: "text", text: "b" }), undefined);
  });

  it("does not merge across runs, sessions, or origins, and does not mutate its inputs", () => {
    const a = textDelta("a");
    assert.equal(mergeDeltaEvents(a, textDelta("b", "r2")), undefined);
    assert.equal(mergeDeltaEvents(a, { ...textDelta("b"), sessionId: "s2" }), undefined);
    const origin = { kind: "external", agent: "x", agentId: "x", depth: 1 } as const;
    assert.equal(mergeDeltaEvents(a, { ...textDelta("b"), origin }), undefined);
    assert.deepEqual(mergeDeltaEvents({ ...a, origin }, { ...textDelta("b"), origin: { ...origin } }), { ...textDelta("ab"), origin });
    assert.deepEqual(a, textDelta("a"));
  });
});

describe("coalescing subscriber (plan 228 Task 3)", () => {
  it("defaults to coalesce with a 4096 bound", async () => {
    assert.equal(DEFAULT_MAX_QUEUED_EVENTS, 4096);
    const sub = subscriber();
    for (let index = 0; index < 4096; index += 1) sub.push(progress(`c${index}`, 0));
    sub.push(progress("c0", 1)); // a replacement, not growth
    sub.push(progress("extra", 0));
    await assert.rejects(() => sub.next(), SubscriberOverflowError);
  });

  it("lagging_subscriber_merges_adjacent_text_deltas", async () => {
    const sub = subscriber({ maxQueuedEvents: 2 });
    const parts = ["Hel", "lo", ", ", "wor", "ld"];
    for (const part of parts) sub.push(textDelta(part));
    const events = await drain(sub);
    assert.equal(events.length, 1);
    assert.equal(text(events), parts.join(""));
  });

  it("tool_progress_keeps_latest_per_call", async () => {
    const sub = subscriber();
    sub.push(progress("a", 1));
    sub.push(progress("b", 1));
    sub.push(textDelta("x"));
    sub.push(progress("a", 2));
    sub.push(progress("a", 3));
    const events = await drain(sub);
    assert.deepEqual(
      events.map((event) => (event.type === "tool.progress" ? `${event.toolCallId}:${String(event.progress)}` : event.type)),
      ["b:1", "message.delta", "a:3"],
    );
  });

  it("non_mergeable_events_keep_order_and_count", async () => {
    const sub = subscriber();
    const pushed: AgentEvent[] = [
      turnStarted,
      textDelta("a"),
      thinkingDelta("t"),
      textDelta("b"),
      thinkingDelta("r", { redacted: true }),
      thinkingDelta("s"),
      {
        type: "message.delta",
        sessionId: "s1",
        runId: "r1",
        content: { type: "tool_call_delta", index: 0, argumentsText: "{" },
      } as AgentEvent,
      textDelta("c"),
    ];
    for (const event of pushed) sub.push(event);
    assert.deepEqual(await drain(sub), pushed);
  });

  it("overflow_still_rejects_the_iterator", async () => {
    const sub = subscriber({ maxQueuedEvents: 2 });
    sub.push(turnStarted);
    sub.push(textDelta("a"));
    sub.push(textDelta("b")); // merged
    sub.push(turnStarted);
    assert.equal(sub.overflowed, true);
    await assert.rejects(
      () => sub.next(),
      (error: unknown) => error instanceof SubscriberOverflowError && error.maxQueuedEvents === 2,
    );
  });

  it("merged_delta_never_exceeds_16_kib", async () => {
    const sub = subscriber();
    const chunk = "é".repeat(1000);
    for (let index = 0; index < 100; index += 1) sub.push(textDelta(chunk));
    const events = await drain(sub);
    assert.ok(events.length > 1);
    for (const event of events) {
      assert.ok(event.type === "message.delta" && event.content.type === "text");
      assert.ok(event.content.text.length <= MAX_COALESCED_DELTA_CHARS);
      assert.ok(new TextEncoder().encode(event.content.text).byteLength <= 48 * 1024);
    }
    assert.equal(text(events), chunk.repeat(100));
  });

  it("other policies keep their meaning and do not merge", async () => {
    for (const overflow of ["close", "drop_oldest", "drop_newest"] as const) {
      const sub = subscriber({ maxQueuedEvents: 2, overflow });
      for (const part of ["a", "b", "c"]) sub.push(textDelta(part));
      if (overflow === "close") {
        await assert.rejects(() => sub.next(), SubscriberOverflowError);
        continue;
      }
      assert.equal(text(await drain(sub)), overflow === "drop_oldest" ? "bc" : "ab");
    }
  });

  it("queue operations stay linear over a large backlog", async () => {
    const sub = subscriber({ maxQueuedEvents: 200_000, overflow: "close" });
    const started = performance.now();
    for (let index = 0; index < 100_000; index += 1) sub.push(progress(`c${index}`, index));
    let count = 0;
    for (let index = 0; index < 100_000; index += 1) if ((await sub.next()).value) count += 1;
    assert.equal(count, 100_000);
    assert.ok(performance.now() - started < 2_000, "no quadratic shift");
  });

  it("split_secret_is_not_reassembled_by_merging", async () => {
    const SECRET = "sk-split-secret-0123";
    const redactor = createSecretRedactor([SECRET]);
    const raw = [`key=${SECRET};`, " half=sk-split-", "secret-0123", ` again ${SECRET}`];
    const redacted = raw.map((part) => redactAgentEvent(textDelta(part), redactor));
    const fast = subscriber();
    const fastEvents: AgentEvent[] = [];
    for (const event of redacted) {
      fast.push(event);
      fastEvents.push((await fast.next()).value as AgentEvent);
    }
    const lagging = subscriber();
    for (const event of redacted) lagging.push(event);
    const merged = await drain(lagging);
    assert.equal(merged.length, 1);
    assert.equal(text(merged), text(fastEvents), "a merged delta is exactly the concatenation a fast consumer sees");
    assert.ok(text(merged).startsWith("key=") && !text(merged).startsWith(`key=${SECRET}`), "a whole secret stays masked");
    assert.equal(text(merged).split(SECRET).length - 1, text(fastEvents).split(SECRET).length - 1, "merging adds no secret");
  });
});

function streamingProvider(deltas: readonly string[], opts: { gapEvery?: number; holdUntilAbort?: boolean } = {}): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      for (const [index, delta] of deltas.entries()) {
        yield providerTextDelta(delta);
        if (opts.gapEvery && index % opts.gapEvery === 0) await sleep(0);
      }
      if (opts.holdUntilAbort) {
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason ?? new Error("aborted")), { once: true });
        });
      }
      yield providerDone();
    },
  };
}

async function sessionWith(provider: ModelProvider, id: string) {
  const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [provider])] });
  return { agent, session: await agent.session({ id, create: true }) };
}

async function untilTerminal(iterator: AsyncIterator<AgentEvent>): Promise<AgentEvent> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error("ended without a terminal event");
    if (next.value.type === "run.completed" || next.value.type === "run.failed") return next.value;
  }
}

describe("stream overflow and abort (plan 228 Task 3)", () => {
  it("overflow_does_not_abort_the_run", async () => {
    const { session } = await sessionWith(streamingProvider(["a", "b", "c"]), "overflow-run");
    const watcher = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    const outcome = await (async () => {
      try {
        for await (const _event of session.stream("Hi", { maxQueuedEvents: 1 })) await sleep(50);
        return "completed";
      } catch (error) {
        return error instanceof SubscriberOverflowError ? "overflow" : `unexpected: ${String(error)}`;
      }
    })();
    assert.equal(outcome, "overflow");
    const terminal = await untilTerminal(watcher);
    assert.equal(terminal.type, "run.completed", "the run settles on its own after an overflow");
    const messages = await session.messages();
    const assistant = messages.at(-1);
    assert.equal(assistant?.role, "assistant");
    assert.deepEqual(assistant?.content, [{ type: "text", text: "abc" }], "the run's messages are in the store");
  });

  it("consumer_break_still_aborts_the_run", async () => {
    const { session } = await sessionWith(streamingProvider(["partial"], { holdUntilAbort: true }), "break-run");
    const watcher = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    for await (const event of session.stream("Hi")) if (event.type === "message.delta") break;
    const terminal = await Promise.race([untilTerminal(watcher), sleep(1_000).then(() => undefined)]);
    assert.equal(terminal?.type, "run.failed", "returning from the stream aborts the run");
  });

  it("slow_consumer_5000_deltas_does_not_overflow", async () => {
    const deltas = Array.from({ length: 5000 }, (_, index) => `w${index} `);
    const { session } = await sessionWith(streamingProvider(deltas, { gapEvery: 250 }), "slow-run");
    const seen: AgentEvent[] = [];
    for await (const event of session.stream("Hi", { maxQueuedEvents: 64 })) {
      seen.push(event);
      await sleep(50);
    }
    assert.equal(seen.at(-1)?.type, "run.completed");
    assert.equal(text(seen), deltas.join(""), "every delta's text arrives, merged");
  }, 30_000);

  it("agent_subscribe_coalesces", async () => {
    // agent.subscribe() carries agent-scoped events only (session.*, background.*, package.status), so the
    // part of the policy it can see is the default: 1,200 queued events overflowed the old 1024/close default.
    const { agent } = await sessionWith(streamingProvider(["x"]), "agent-sub");
    const iterator = agent.subscribe()[Symbol.asyncIterator]();
    for (let index = 0; index < 600; index += 1) await (await agent.session({ id: `agent-sub-${index}`, create: true })).close();
    let count = 0;
    for (;;) {
      const next = await Promise.race([iterator.next(), sleep(50).then(() => undefined)]);
      if (!next || next.done) break;
      count += 1;
    }
    assert.ok(count >= 1200, `a lagging agent subscriber keeps every event under the 4096 default (saw ${count})`);
    await agent.dispose();
  });
});
