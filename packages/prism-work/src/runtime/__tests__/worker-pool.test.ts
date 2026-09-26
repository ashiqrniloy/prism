import assert from "node:assert/strict";
import { test } from "bun:test";
import { closeWorkerPool, runInPool, shouldOffloadToPool, WORKER_POOL_MAX_WORKERS, workerPoolStats } from "../worker-pool.js";

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`worker pool did not settle within ${ms}ms`)), ms).unref();
    }),
  ]);
}

test("runInPool round-trips a structured-cloneable payload", async () => {
  const bytes = new Uint8Array([1, 2, 3, 250]);
  const echoed = await within(runInPool<Uint8Array>({ kind: "probe.echo", payload: bytes }), 5_000);
  assert.deepEqual([...echoed], [...bytes]);
  assert.match(echoed.constructor.name, /Uint8Array/);
});

test("pool never runs more than the bounded worker count and queues the rest", async () => {
  const before = workerPoolStats();
  const jobs = Array.from({ length: WORKER_POOL_MAX_WORKERS * 3 }, () => runInPool({ kind: "probe.spin", payload: { ms: 250 } }));
  const queued = workerPoolStats().queued;
  assert.equal(queued, jobs.length - WORKER_POOL_MAX_WORKERS);
  await within(Promise.all(jobs), 20_000);
  const after = workerPoolStats();
  assert.equal(after.queued, 0);
  assert.equal(after.busy, 0);
  assert.ok(after.peak <= WORKER_POOL_MAX_WORKERS, `peak ${after.peak} exceeded ${WORKER_POOL_MAX_WORKERS}`);
  assert.ok(after.peak >= before.peak);
  assert.equal(after.workers, WORKER_POOL_MAX_WORKERS);
  assert.equal(after.completed - before.completed, jobs.length);
});

test("workers do not inherit parent credentials", async () => {
  process.env.PRISM_POOL_PROBE_SECRET = "planted-secret-value";
  const seen = await within(runInPool<{ envKeys: number; secret: string | null }>({ kind: "probe.env" }), 5_000);
  assert.equal(seen.secret, null);
  assert.ok(seen.envKeys < 20, `worker inherited ${seen.envKeys} env keys`);
  delete process.env.PRISM_POOL_PROBE_SECRET;
});

test("a worker crash rejects its task and the pool recovers on the next one", async () => {
  const before = workerPoolStats();
  await assert.rejects(within(runInPool({ kind: "probe.crash" }), 5_000), /worker (failed|exited)/);
  assert.equal(workerPoolStats().failed, before.failed + 1);
  const recovered = await within(runInPool<string>({ kind: "probe.echo", payload: "recovered" }), 5_000);
  assert.equal(recovered, "recovered");
  const stats = workerPoolStats();
  assert.ok(stats.workers <= WORKER_POOL_MAX_WORKERS);
  assert.equal(stats.busy, 0);
  assert.equal(stats.queued, 0);
});

test("an unknown task kind rejects without killing the pool", async () => {
  await assert.rejects(within(runInPool({ kind: "probe.nope" }), 5_000), /unknown worker task kind/);
  assert.equal(await within(runInPool<string>({ kind: "probe.echo", payload: "alive" }), 5_000), "alive");
});

test("closeWorkerPool rejects in-flight tasks, terminates every worker, and the pool recovers", async () => {
  const inFlight = runInPool({ kind: "probe.spin", payload: { ms: 30_000 } });
  const rejected = assert.rejects(within(inFlight, 5_000), /worker pool is closed/);
  await within(closeWorkerPool(), 5_000);
  await rejected;
  const stats = workerPoolStats();
  assert.equal(stats.workers, 0);
  assert.equal(stats.busy, 0);
  assert.equal(stats.queued, 0);
  // The pool is not terminal: the next task spawns a fresh worker (test files share one process).
  assert.equal(await within(runInPool<string>({ kind: "probe.echo", payload: "fresh" }), 5_000), "fresh");
  await within(closeWorkerPool(), 5_000);
});

// Plan 127 further action #1. The four measured rows are the decision Task 3 had to revert (§9), so a
// rule that admits them again is a regression; the pdf row and the cheap-result row are the shapes
// that do pay. Numbers: input bytes, `rows x (columns + 1)`-style result values, and the measured
// inline compute from evidence §9/§12.
test("offload pricing charges the result clone, not just the input round-trip", () => {
  const cases = [
    {
      name: "pdf extract (text result, 250-378 ms compute)",
      pricing: { inputBytes: 288_031, resultValues: 1 + 1_000 * 4, computeMs: 350 },
      offloads: true,
    },
    {
      name: "csv model (2 MB result vs 57 ms compute)",
      pricing: { inputBytes: 1_340_000, resultValues: 20_001 * 13, computeMs: 57 },
      offloads: false,
    },
    {
      name: "xlsx model (2.3 MB result vs 654 ms compute)",
      pricing: { inputBytes: 2_100_000, resultValues: 20_001 * 13, computeMs: 654 },
      offloads: false,
    },
    {
      name: "docx model (40k blocks vs 76 ms compute)",
      pricing: { inputBytes: 65_536, resultValues: 40_005, computeMs: 76 },
      offloads: false,
    },
    { name: "tiny pdf below the input floor", pricing: { inputBytes: 872, resultValues: 5, computeMs: 1.8 }, offloads: false },
    { name: "1 MiB input with a single-value result", pricing: { inputBytes: 1_048_576, resultValues: 1, computeMs: 320 }, offloads: true },
  ];
  for (const { name, pricing, offloads } of cases) {
    assert.equal(shouldOffloadToPool(pricing), offloads, name);
  }
});
