import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "../file-mutation-queue.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("serializes ops on the same file path (no overlap)", async () => {
  const log: string[] = [];
  let active = 0;
  let maxActive = 0;
  const fn = async (id: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    log.push(`start ${id}`);
    await delay(20);
    log.push(`end ${id}`);
    active--;
    return id;
  };
  const path = join(tmpdir(), `mq-serial-${Date.now()}.txt`);
  const [a, b] = await Promise.all([
    withFileMutationQueue(path, () => fn("a")),
    withFileMutationQueue(path, () => fn("b")),
  ]);
  assert.equal(maxActive, 1, "same-file ops must never overlap");
  assert.deepEqual(log, ["start a", "end a", "start b", "end b"], "ops run strictly in order");
  assert.equal(a, "a");
  assert.equal(b, "b");
});

test("runs ops on different files in parallel", async () => {
  let active = 0;
  let maxActive = 0;
  const fn = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(30);
    active--;
  };
  await Promise.all([
    withFileMutationQueue(join(tmpdir(), `mq-p1-${Date.now()}.txt`), fn),
    withFileMutationQueue(join(tmpdir(), `mq-p2-${Date.now()}.txt`), fn),
  ]);
  assert.equal(maxActive, 2, "different-file ops must run concurrently");
});

test("serializes ops on a non-existent path (realpath fallback to resolved path)", async () => {
  let active = 0;
  let maxActive = 0;
  const fn = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(20);
    active--;
  };
  const path = join(tmpdir(), `mq-missing-${Date.now()}-${Math.random()}.txt`);
  await Promise.all([
    withFileMutationQueue(path, fn),
    withFileMutationQueue(path, fn),
  ]);
  assert.equal(maxActive, 1, "same non-existent path must still serialize");
});

test("releases the slot when fn throws (subsequent op still runs)", async () => {
  const path = join(tmpdir(), `mq-throw-${Date.now()}.txt`);
  await assert.rejects(
    () => withFileMutationQueue(path, async () => { throw new Error("boom"); }),
    /boom/,
  );
  // slot must have been released — a follow-up op completes normally
  const r = await withFileMutationQueue(path, async () => "ok");
  assert.equal(r, "ok");
});

test("chains 3 sequential ops on one path (each sees the prior complete)", async () => {
  const path = join(tmpdir(), `mq-chain-${Date.now()}.txt`);
  const order: number[] = [];
  let counter = 0;
  const fn = async () => {
    const id = ++counter;
    order.push(id);
    await delay(10);
    return id;
  };
  const results = await Promise.all([
    withFileMutationQueue(path, fn),
    withFileMutationQueue(path, fn),
    withFileMutationQueue(path, fn),
  ]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.deepEqual(order, [1, 2, 3]);
});
