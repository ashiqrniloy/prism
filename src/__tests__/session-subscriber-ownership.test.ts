/**
 * Plan 104 Task 5: who owns a subscriber.
 *
 * A default subscriber is run-scoped: run end (finish, suspension, denial) closes it, which is what
 * `stream()` and every example rely on. `SubscribeOptions.acrossRuns: true` opts one subscriber out of
 * that close so a host can watch several runs of the same session; it is bounded by the same queue and
 * overflow rules and dies only from a host close, an overflow, or session teardown. `stream()` owns its
 * subscription: it closes it when the owned run settles, so a run that fails before its first event
 * cannot park the consumer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuntimeAgentSession } from "../agent-session/session.js";
import {
  type AgentEvent,
  AgentRunError,
  type AIProvider,
  createAgent,
  createMockProvider,
  providerDone,
  providerTextDelta,
} from "../index.js";

function mockSession(id: string): RuntimeAgentSession {
  return new RuntimeAgentSession({
    id,
    agent: createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
    }),
  });
}

/** Pull queued events until both runs' terminal events arrived; a parked pull means "no more events". */
async function drainRunEvents(iterator: AsyncIterator<AgentEvent>, runs: number): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  let finished = 0;
  while (finished < runs) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
    if (next.value.type === "agent_finished") finished += 1;
  }
  return events;
}

/** Pull everything already queued; a pull with nothing to deliver resolves as "parked" instead. */
async function drainAvailable(iterator: AsyncIterator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for (;;) {
    const outcome = await Promise.race([iterator.next(), new Promise<"parked">((resolve) => setTimeout(() => resolve("parked"), 20))]);
    if (outcome === "parked" || outcome.done) return events;
    events.push(outcome.value);
  }
}

/** A pull that never resolves means the iterator is parked (open) rather than done. */
async function parked(iterator: AsyncIterator<AgentEvent>): Promise<boolean> {
  const outcome = await Promise.race([
    iterator.next().then((result) => (result.done ? "done" : "event")),
    new Promise<string>((resolve) => setTimeout(() => resolve("parked"), 20)),
  ]);
  return outcome === "parked";
}

describe("session subscriber ownership (plan 104 Task 5)", () => {
  it("keeps an acrossRuns subscriber open across two sequential runs", async () => {
    const session = mockSession("across-runs");
    const iterator = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();

    const first = await session.run("one");
    const second = await session.run("two");

    const events = await drainRunEvents(iterator, 2);
    const owned = events.flatMap((event) => ("runId" in event && typeof event.runId === "string" ? [event.runId] : []));
    assert.ok(owned.includes(first.runId), "first run's events reached the subscriber");
    assert.ok(owned.includes(second.runId), "second run's events reached the subscriber");
    assert.equal(events.filter((event) => event.type === "agent_finished").length, 2, "both runs finished, none closed it");
    assert.equal(await parked(iterator), true, "still open after both runs");

    const closed = await iterator.return?.();
    assert.equal(closed?.done, true, "the host closes it");
    assert.equal((await iterator.next()).done, true);
  });

  it("closes a default subscriber at run end", async () => {
    const session = mockSession("run-scoped");
    const iterator = session.subscribe()[Symbol.asyncIterator]();

    await session.run("one");

    const events = await drainRunEvents(iterator, 1);
    assert.equal(events.at(-1)?.type, "agent_finished");
    assert.equal((await iterator.next()).done, true, "run end closes a run-scoped subscriber");
  });

  it("applies the same overflow rules to an acrossRuns subscriber", async () => {
    const overflowed = mockSession("across-runs-overflow");
    const closing = overflowed.subscribe({ acrossRuns: true, maxQueuedEvents: 1 })[Symbol.asyncIterator]();
    await overflowed.run("one");
    const notice = await closing.next();
    // maxQueuedEvents: 1 keeps the first queued event; the rest overflow into the notice (default "close").
    while (notice.value?.type !== "event_subscriber_overflow") {
      const next = await closing.next();
      assert.equal(next.done, false, "the overflow notice always arrives");
      if (next.value.type === "event_subscriber_overflow") break;
    }
    assert.equal((await closing.next()).done, true, "the default close policy closes it despite acrossRuns");

    const dropping = mockSession("across-runs-drop-oldest");
    const iterator = dropping.subscribe({ acrossRuns: true, maxQueuedEvents: 2, overflow: "drop_oldest" })[Symbol.asyncIterator]();
    const first = await dropping.run("one");
    const second = await dropping.run("two");
    const events = await drainRunEvents(iterator, 1);
    const owned = events.flatMap((event) => ("runId" in event && typeof event.runId === "string" ? [event.runId] : []));
    assert.ok(owned.includes(second.runId), "the second run is still served after the first overflowed the queue");
    assert.equal(owned.includes(first.runId), false, "drop_oldest kept the newest events instead");
  });

  it("ends an acrossRuns subscription on session teardown", async () => {
    const session = mockSession("teardown");
    const iterator = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    await session.run("one");
    await drainRunEvents(iterator, 1);

    session.closeSubscribers();

    assert.equal((await iterator.next()).done, true, "teardown closes an acrossRuns subscriber");
    const after = await session.run("two");
    assert.equal(after.status, "succeeded", "the session still runs after teardown");
    assert.equal((await iterator.next()).done, true, "no events reach a subscriber the session tore down");
  });

  it("stream() terminates on a run that fails before its first event", async () => {
    const session = mockSession("stream-preflight");
    const outcome = await Promise.race([
      (async () => {
        try {
          for await (const event of session.stream("Hi", { maxToolRounds: 3 } as never)) void event;
          return "resolved";
        } catch (error) {
          return `rejected: ${(error as Error).message}`;
        }
      })(),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ]);

    assert.match(outcome, /^rejected: RunOptions\.maxToolRounds was removed/, "the failure surfaces, it does not park the consumer");
    const result = await session.run("again");
    assert.equal(result.status, "succeeded", "the failed stream released the session");
  });

  it("stream() terminates on success, abort, and early consumer return", async () => {
    const aborted: AIProvider = {
      id: "mock",
      async *generate(request) {
        yield providerTextDelta("partial");
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason ?? new Error("aborted")), { once: true });
        });
        yield providerDone();
      },
    };
    const session = createAgent({ model: { provider: "mock", model: "demo" }, provider: aborted }).createSession({ id: "stream-abort" });
    const hostOwned = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    const terminal: string[] = [];
    const consumer = (async () => {
      try {
        for await (const event of session.stream("Hi")) {
          terminal.push(event.type);
          if (event.type === "message_delta") session.abort(new Error("host stop"));
        }
        return "resolved";
      } catch (error) {
        // Unchanged abort contract: terminal events first, then the run rejection.
        return error instanceof AgentRunError && error.result.status === "aborted" ? "aborted" : `unexpected: ${String(error)}`;
      }
    })();
    const ended = await Promise.race([consumer, new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1_000))]);
    assert.equal(ended, "aborted", "an aborted run still ends the stream");
    assert.equal(terminal.at(-1), "error", "the terminal event lands before the rejection");
    const hostEvents = await drainAvailable(hostOwned);
    assert.ok(
      hostEvents.some((event) => event.type === "error"),
      "the acrossRuns subscriber saw the aborted run's terminal event",
    );
    assert.equal(await parked(hostOwned), true, "an abort closes nothing the host owns explicitly");
    await hostOwned.return?.();

    const success = createMockProvider([providerTextDelta("done"), providerDone()]);
    const reused = createAgent({ model: { provider: "mock", model: "demo" }, provider: success }).createSession({ id: "stream-success" });
    const seen: AgentEvent[] = [];
    for await (const event of reused.stream("Hi")) {
      seen.push(event);
      if (event.type === "message_delta") break;
    }
    assert.equal(seen.at(-1)?.type, "message_delta", "early return ends the stream");
    assert.equal((await reused.run("again")).status, "succeeded", "early return released the session");
  });
});
