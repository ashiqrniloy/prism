import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CheckpointConflictError,
  createEventMultiplexer,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  EventMultiplexerError,
  EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE,
  LeaseConflictError,
} from "../index.js";

describe("CheckpointStore", () => {
  it("enforces versions and ownership with bounded pagination", async () => {
    const store = createMemoryCheckpointStore({ maxPageSize: 2 });
    await store.saveCheckpoint({ namespace: "workflow", key: "a", version: 1, value: { ok: true }, category: "running", tenantId: "t1" });
    await store.saveCheckpoint({ namespace: "workflow", key: "b", version: 1, value: null, category: "done", tenantId: "t1" });
    await store.saveCheckpoint({ namespace: "workflow", key: "c", version: 1, value: null, category: "done", tenantId: "t1" });

    assert.equal((await store.loadCheckpoint({ namespace: "workflow", key: "a", tenantId: "t1" }))?.version, 1);
    await assert.rejects(store.loadCheckpoint({ namespace: "workflow", key: "a", tenantId: "other" }), CheckpointConflictError);
    await assert.rejects(
      store.saveCheckpoint({ namespace: "workflow", key: "a", version: 1, value: null, tenantId: "t1" }),
      CheckpointConflictError,
    );

    const first = await store.listCheckpoints({ namespace: "workflow", tenantId: "t1", limit: 2 });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = await store.listCheckpoints({ namespace: "workflow", tenantId: "t1", limit: 2, cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.equal(await store.deleteCheckpoint({ namespace: "workflow", key: "a", tenantId: "t1" }), true);
  });

  it("evicts least-recently-saved records past maxRecords and rejects oversized values", async () => {
    const store = createMemoryCheckpointStore({ maxRecords: 2, maxValueBytes: 64 });
    await store.saveCheckpoint({ namespace: "n", key: "a", version: 1, value: null });
    await store.saveCheckpoint({ namespace: "n", key: "b", version: 1, value: null });
    // Updating "a" makes it most-recently-saved, so "b" is the eviction victim.
    await store.saveCheckpoint({ namespace: "n", key: "a", version: 2, value: null });
    await store.saveCheckpoint({ namespace: "n", key: "c", version: 1, value: null });

    assert.equal((await store.loadCheckpoint({ namespace: "n", key: "a" }))?.version, 2);
    assert.equal(await store.loadCheckpoint({ namespace: "n", key: "b" }), null);
    assert.notEqual(await store.loadCheckpoint({ namespace: "n", key: "c" }), null);

    await assert.rejects(store.saveCheckpoint({ namespace: "n", key: "big", version: 1, value: "x".repeat(128) }), /maxValueBytes/);
  });

  it("enforces compare-and-swap and lease fencing", async () => {
    const store = createMemoryCheckpointStore();
    await store.saveCheckpoint({ namespace: "n", key: "k", version: 1, expectedVersion: 0, fencingToken: 2, value: 1 });
    await assert.rejects(
      store.saveCheckpoint({ namespace: "n", key: "k", version: 2, expectedVersion: 0, fencingToken: 2, value: 2 }),
      CheckpointConflictError,
    );
    await assert.rejects(
      store.saveCheckpoint({ namespace: "n", key: "k", version: 2, expectedVersion: 1, fencingToken: 1, value: 2 }),
      CheckpointConflictError,
    );
    await store.saveCheckpoint({ namespace: "n", key: "k", version: 2, expectedVersion: 1, fencingToken: 3, value: 2 });
  });

  it("fails closed on abort", async () => {
    const signal = AbortSignal.abort(new Error("stop"));
    await assert.rejects(createMemoryCheckpointStore().loadCheckpoint({ namespace: "n", key: "k", signal }), /stop/);
  });
});

describe("LeaseStore", () => {
  it("excludes owners, renews by opaque token, and fences expiry takeover", async () => {
    const store = createMemoryLeaseStore();
    const first = await store.tryAcquireLease({ namespace: "workflow", key: "run", ownerId: "a", ttlMs: 100, tenantId: "t1" });
    assert.ok(first);
    assert.equal(await store.tryAcquireLease({ namespace: "workflow", key: "run", ownerId: "b", ttlMs: 100, tenantId: "t1" }), null);
    assert.equal(
      await store.renewLease({ namespace: "workflow", key: "run", ownerId: "a", token: "wrong", ttlMs: 100, tenantId: "t1" }),
      null,
    );
    await assert.rejects(store.getLease({ namespace: "workflow", key: "run", tenantId: "other" }), LeaseConflictError);
    await new Promise((resolve) => setTimeout(resolve, 110));
    const second = await store.tryAcquireLease({ namespace: "workflow", key: "run", ownerId: "b", ttlMs: 20, tenantId: "t1" });
    assert.ok(second);
    assert.equal(second.fencingToken, first.fencingToken + 1);
    assert.equal(await store.releaseLease({ namespace: "workflow", key: "run", ownerId: "a", token: first.token, tenantId: "t1" }), false);
    assert.equal(await store.releaseLease({ namespace: "workflow", key: "run", ownerId: "b", token: second.token, tenantId: "t1" }), true);
  });
});

describe("EventMultiplexer", () => {
  it("fans in sources and bounds overflow", async () => {
    const mux = createEventMultiplexer<number>({
      maxQueuedEvents: 2,
      overflow: "drop_oldest",
      overflowEvent: () => -1,
    });
    mux.publish(1);
    mux.publish(2);
    mux.publish(3);
    const seen: number[] = [];
    for await (const event of mux.subscribe()) {
      seen.push(event);
      if (seen.length === 2) break;
    }
    mux.close();
    assert.equal(mux.droppedEvents, 1);
    assert.deepEqual(seen, [-1, 3]);
  });

  it("delivers in comparator order even when the consumer is parked", async () => {
    const mux = createEventMultiplexer<number>({ compare: (a, b) => a - b });
    const iterator = mux.subscribe()[Symbol.asyncIterator]();
    const first = iterator.next(); // parks the consumer on an empty queue
    mux.publish(3);
    mux.publish(1);
    mux.publish(2);
    assert.equal((await first).value, 1);
    assert.equal((await iterator.next()).value, 2);
    assert.equal((await iterator.next()).value, 3);
    mux.close();
  });

  it("observes async sources and closes them", async () => {
    let returned = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        let value = 0;
        return {
          async next() {
            return { value: ++value, done: false };
          },
          async return() {
            returned = true;
            return { value: undefined, done: true };
          },
        };
      },
    };
    const mux = createEventMultiplexer<string>();
    mux.observe(source, String);
    const iterator = mux.subscribe()[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value, "1");
    mux.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(returned, true);
  });

  it("rejects a second concurrent subscriber and frees the slot on close", async () => {
    const mux = createEventMultiplexer<number>();
    const first = mux.subscribe()[Symbol.asyncIterator]();
    const parked = first.next(); // parks the single consumer on an empty queue
    const second = mux.subscribe()[Symbol.asyncIterator]();
    await assert.rejects(
      second.next(),
      (error: unknown) => error instanceof EventMultiplexerError && error.code === EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE,
    );
    // The rejected subscriber never touches the queue; the first consumer still receives events.
    mux.publish(1);
    assert.equal((await parked).value, 1);
    mux.close();
    // Slot freed: a fresh subscriber works (and terminates because the mux is closed).
    const afterClose = mux.subscribe()[Symbol.asyncIterator]();
    assert.equal((await afterClose.next()).done, true);
  });

  it("frees the single-consumer slot when the first subscriber returns", async () => {
    const mux = createEventMultiplexer<number>();
    const first = mux.subscribe()[Symbol.asyncIterator]();
    mux.publish(7);
    assert.equal((await first.next()).value, 7); // consumer suspended at the yield
    await first.return?.(undefined); // return() completes because the body is at a yield
    const second = mux.subscribe()[Symbol.asyncIterator]();
    mux.publish(8);
    assert.equal((await second.next()).value, 8);
    mux.close();
  });

  it("guards only once a subscriber actually starts iterating", async () => {
    const mux = createEventMultiplexer<number>();
    mux.publish(5);
    const created = [mux.subscribe()[Symbol.asyncIterator](), mux.subscribe()[Symbol.asyncIterator]()];
    // Creating a subscription does not consume the slot; the first to iterate wins.
    assert.equal((await created[0].next()).value, 5);
    await assert.rejects(
      created[1].next(),
      (error: unknown) => error instanceof EventMultiplexerError && error.code === EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE,
    );
    mux.close();
  });
});
