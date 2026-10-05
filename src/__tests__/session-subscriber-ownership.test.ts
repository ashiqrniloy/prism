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
import { describe, it } from "bun:test";
import { RuntimeAgentSession } from "../agent-session/session.js";
import { type AgentEvent, type ModelProvider, createAgent, providerDone, providerTextDelta, createMemorySessionStore, SubscriberOverflowError } from "../index.js";
import { mockProvider, createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

async function mockSession(id: string): Promise<RuntimeAgentSession> {
  const store = createMemorySessionStore();
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
    slots: { store },
  });
  return new RuntimeAgentSession({
    id,
    agent,
    store,
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
    if (next.value.type === "run.completed") finished += 1;
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
    const session = await mockSession("across-runs");
    const iterator = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();

    const first = await session.run("one");
    const second = await session.run("two");

    const events = await drainRunEvents(iterator, 2);
    const owned = events.flatMap((event) => ("runId" in event && typeof event.runId === "string" ? [event.runId] : []));
    assert.ok(owned.includes(first.runId), "first run's events reached the subscriber");
    assert.ok(owned.includes(second.runId), "second run's events reached the subscriber");
    assert.equal(events.filter((event) => event.type === "run.completed").length, 2, "both runs finished, none closed it");
    assert.equal(await parked(iterator), true, "still open after both runs");

    const closed = await iterator.return?.();
    assert.equal(closed?.done, true, "the host closes it");
    assert.equal((await iterator.next()).done, true);
  });

  it("closes a default subscriber at run end", async () => {
    const session = await mockSession("run-scoped");
    const iterator = session.subscribe()[Symbol.asyncIterator]();

    await session.run("one");

    const events = await drainRunEvents(iterator, 1);
    assert.equal(events.at(-1)?.type, "run.completed");
    assert.equal((await iterator.next()).done, true, "run end closes a run-scoped subscriber");
  });

  it("applies the same overflow rules to an acrossRuns subscriber", async () => {
    const overflowed = await mockSession("across-runs-overflow");
    const closing = overflowed.subscribe({ acrossRuns: true, maxQueuedEvents: 1 })[Symbol.asyncIterator]();
    await overflowed.run("one");
    // maxQueuedEvents: 1 keeps the first queued event; the next overflow fails the iterator loudly
    // under the default "close" policy, even though the subscription outlives the run.
    await assert.rejects(
      async () => {
        for (;;) {
          const next = await closing.next();
          if (next.done) break;
        }
      },
      (error: unknown) => error instanceof SubscriberOverflowError,
    );

    const dropping = await mockSession("across-runs-drop-oldest");
    const iterator = dropping.subscribe({ acrossRuns: true, maxQueuedEvents: 2, overflow: "drop_oldest" })[Symbol.asyncIterator]();
    const first = await dropping.run("one");
    const second = await dropping.run("two");
    const events = await drainRunEvents(iterator, 1);
    const owned = events.flatMap((event) => ("runId" in event && typeof event.runId === "string" ? [event.runId] : []));
    assert.ok(owned.includes(second.runId), "the second run is still served after the first overflowed the queue");
    assert.equal(owned.includes(first.runId), false, "drop_oldest kept the newest events instead");
  });

  it("ends an acrossRuns subscription on session teardown", async () => {
    const session = await mockSession("teardown");
    const iterator = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    await session.run("one");
    await drainRunEvents(iterator, 1);

    session.closeSubscribers();

    assert.equal((await iterator.next()).done, true, "teardown closes an acrossRuns subscriber");
    const after = await session.run("two");
    assert.equal(after.status, "completed", "the session still runs after teardown");
    assert.equal((await iterator.next()).done, true, "no events reach a subscriber the session tore down");
  });

  it("stream() terminates on a run that fails before its first event", async () => {
    const session = await mockSession("stream-preflight");
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
    assert.equal(result.status, "completed", "the failed stream released the session");
  });

  it("stream() terminates on success, abort, and early consumer return", async () => {
    const aborted: ModelProvider = {
      id: "mock",
      async *generate(request) {
        yield providerTextDelta("partial");
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason ?? new Error("aborted")), { once: true });
        });
        yield providerDone();
      },
    };
    const session = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [aborted])] })).session({
      id: "stream-abort",
      create: true,
    });
    const hostOwned = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    const terminal: string[] = [];
    const consumer = (async () => {
      try {
        for await (const event of session.stream("Hi")) {
          terminal.push(event.type);
          if (event.type === "message.delta") session.abort(new Error("host stop"));
        }
        return "resolved";
      } catch (error) {
        return `unexpected: ${String(error)}`;
      }
    })();
    const ended = await Promise.race([consumer, new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1_000))]);
    assert.equal(ended, "resolved", "an aborted run still ends the stream, without throwing");
    assert.equal(terminal.at(-1), "run.failed", "the terminal event is the last thing the stream yields");
    const hostEvents = await drainAvailable(hostOwned);
    assert.ok(
      hostEvents.some((event) => event.type === "run.failed"),
      "the acrossRuns subscriber saw the aborted run's terminal event",
    );
    assert.equal(await parked(hostOwned), true, "an abort closes nothing the host owns explicitly");
    await hostOwned.return?.();

    const success = createMockProvider([providerTextDelta("done"), providerDone()]);
    const reused = await (await createAgent({ model: { provider: "mock", model: "demo" }, packages: [providerPackage("test-provider", [success])] })).session({
      id: "stream-success",
      create: true,
    });
    const seen: AgentEvent[] = [];
    for await (const event of reused.stream("Hi")) {
      seen.push(event);
      if (event.type === "message.delta") break;
    }
    assert.equal(seen.at(-1)?.type, "message.delta", "early return ends the stream");
    assert.equal((await reused.run("again")).status, "completed", "early return released the session");
  });
});
