// Plan 060 leak tests: N=200 subscribe/dispose + event-queue drain cycles must
// not grow the session subscriber registry. Deterministic: every op awaited,
// no sleeps. Skips when the heap is too small for 200 live sessions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHeapStatistics } from "node:v8";
import { EventSubscriber } from "../agent-session/event-subscriber.js";
import { type AgentEvent, createAgent, createMockProvider } from "../index.js";

const N = 200;
const LOW_MEM = getHeapStatistics().heap_size_limit < 512 * 1024 * 1024;

function subscribersOf(session: object): Set<unknown> {
  return (session as unknown as { subscribers: Set<unknown> }).subscribers;
}

function event(n: number): AgentEvent {
  return { type: "queue_updated", sessionId: "leak", size: n } as AgentEvent;
}

describe("leak: sessions/subscribers/event-queue return to baseline", { skip: LOW_MEM }, () => {
  it("200 subscribe/dispose cycles leave zero subscribers", () => {
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider: createMockProvider() });
    const session = agent.createSession();
    for (let i = 0; i < N; i++) {
      const iterator = session.subscribe({ maxQueuedEvents: 8, overflow: "drop_oldest" })[Symbol.asyncIterator]();
      assert.equal(subscribersOf(session).size, 1, `cycle ${i}: subscribe must register`);
      void iterator.return?.();
      assert.equal(subscribersOf(session).size, 0, `cycle ${i}: dispose must deregister`);
    }
  });

  it("200 subscribe/wait/drain/dispose cycles release parked waiters", async () => {
    for (let i = 0; i < N; i++) {
      const sub = new EventSubscriber("leak", { maxQueuedEvents: 8, overflow: "drop_oldest" }, () => {});
      const iterator = sub[Symbol.asyncIterator]();
      const parked = iterator.next(); // waiter parks (queue empty)
      sub.push(event(i));
      assert.equal(((await parked).value as AgentEvent).type, "queue_updated", `cycle ${i}: parked waiter must get its event`);
      for (let j = 0; j < 10; j++) sub.push(event(j)); // 10 into cap 8 → drop_oldest
      const drained: AgentEvent[] = [];
      for (let j = 0; j < 8; j++) drained.push((await iterator.next()).value!);
      assert.equal(drained.length, 8, `cycle ${i}: bounded queue must drain exactly its cap`);
      await iterator.return?.();
      assert.equal((await iterator.next()).done, true, `cycle ${i}: disposed queue must be done`);
    }
  });
});
