/**
 * Contract of the shared FIFO semaphore used by the sandbox exec caps, the egress
 * connection cap, and the check-runner concurrency cap:
 * FIFO wake order, abort-aware waiting, and release semantics that floor at zero.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Semaphore } from "../semaphore.js";

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

test("cap: queued waiters do not wake while the slot is held", async () => {
  const semaphore = new Semaphore(1);
  const release = await semaphore.acquire();
  let queuedWoke = false;
  void semaphore.acquire().then((queuedRelease) => {
    queuedWoke = true;
    queuedRelease();
  });
  await settle();
  assert.equal(queuedWoke, false);
  release();
  await settle();
  assert.equal(queuedWoke, true);
});

test("fifo: waiters wake in submission order", async () => {
  const semaphore = new Semaphore(1);
  const held = await semaphore.acquire();
  const order: number[] = [];
  const releases = new Map<number, () => void>();
  for (const waiter of [1, 2, 3]) {
    void semaphore.acquire().then((release) => {
      order.push(waiter);
      releases.set(waiter, release);
    });
  }
  await settle();
  assert.deepEqual(order, []);
  held();
  await settle();
  assert.deepEqual(order, [1], "first release wakes the oldest waiter");
  releases.get(1)?.();
  await settle();
  assert.deepEqual(order, [1, 2]);
  releases.get(2)?.();
  await settle();
  assert.deepEqual(order, [1, 2, 3]);
  releases.get(3)?.();
});

test("abort: a queued waiter rejects with the injected error class and holds no slot", async () => {
  class TestAbortError extends Error {
    readonly code = "ERR_TEST_ABORT";
    constructor(message: string) {
      super(message);
      this.name = "TestAbortError";
    }
  }
  const semaphore = new Semaphore(1, TestAbortError);
  const held = await semaphore.acquire();

  // An already-aborted signal rejects before consuming a slot.
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(semaphore.acquire(preAborted.signal), (error: unknown) => {
    assert.ok(error instanceof TestAbortError);
    assert.equal(error.message, "sandbox operation aborted");
    return true;
  });

  // Aborting a waiter that is still queued rejects it and drops it from the queue,
  // so the next release wakes the waiter queued behind it instead of a dead one.
  const controller = new AbortController();
  const queued = semaphore.acquire(controller.signal);
  let liveWoke = false;
  const live = semaphore.acquire().then((liveRelease) => {
    liveWoke = true;
    return liveRelease;
  });
  controller.abort();
  await assert.rejects(queued, (error: unknown) => {
    assert.ok(error instanceof TestAbortError);
    assert.equal(error.message, "sandbox operation aborted");
    return true;
  });
  held();
  await settle();
  assert.equal(liveWoke, true, "release wakes the live waiter, not the aborted one");
  // The aborted waiter left the queue, so releasing the held slot wakes nobody and
  // leaves the cap fully available again.
  (await live)();
  const reacquired = await semaphore.acquire();
  reacquired();
});

test("release: extra releases are ignored and never widen the cap", async () => {
  const semaphore = new Semaphore(1);
  const release = await semaphore.acquire();
  release();
  semaphore.release();
  const held = await semaphore.acquire();
  let secondWoke = false;
  void semaphore.acquire().then((secondRelease) => {
    secondWoke = true;
    secondRelease();
  });
  await settle();
  assert.equal(secondWoke, false, "cap stays 1 after an extra release");
  held();
  await settle();
  assert.equal(secondWoke, true);
});
