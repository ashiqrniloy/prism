import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CheckpointConflictError,
  createEventMultiplexer,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  LeaseConflictError,
} from "../index.js";

describe("CheckpointStore", () => {
  it("enforces versions and ownership with bounded pagination", async () => {
    const store = createMemoryCheckpointStore({ maxPageSize: 2 });
    await store.saveCheckpoint({ namespace: "workflow", key: "a", version: 1, value: { ok: true }, category: "running", tenantId: "t1" });
    await store.saveCheckpoint({ namespace: "workflow", key: "b", version: 1, value: null, category: "done", tenantId: "t1" });
    await store.saveCheckpoint({ namespace: "workflow", key: "c", version: 1, value: null, category: "done", tenantId: "t1" });

    assert.equal((await store.loadCheckpoint({ namespace: "workflow", key: "a", tenantId: "t1" }))?.version, 1);
    await assert.rejects(
      store.loadCheckpoint({ namespace: "workflow", key: "a", tenantId: "other" }),
      CheckpointConflictError,
    );
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
    await assert.rejects(
      createMemoryCheckpointStore().loadCheckpoint({ namespace: "n", key: "k", signal }),
      /stop/,
    );
  });
});

describe("LeaseStore", () => {
  it("excludes owners, renews by opaque token, and fences expiry takeover", async () => {
    const store = createMemoryLeaseStore();
    const first = await store.tryAcquireLease({ namespace: "workflow", key: "run", ownerId: "a", ttlMs: 100, tenantId: "t1" });
    assert.ok(first);
    assert.equal(await store.tryAcquireLease({ namespace: "workflow", key: "run", ownerId: "b", ttlMs: 100, tenantId: "t1" }), null);
    assert.equal(await store.renewLease({ namespace: "workflow", key: "run", ownerId: "a", token: "wrong", ttlMs: 100, tenantId: "t1" }), null);
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

  it("observes async sources and closes them", async () => {
    let returned = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        let value = 0;
        return {
          async next() { return { value: ++value, done: false }; },
          async return() { returned = true; return { value: undefined, done: true }; },
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
});
