import { isMainThread, Worker } from "node:worker_threads";

/**
 * Internal bounded worker pool for the measured CPU-bound surfaces (plan 127 Task 2).
 *
 * Why it exists: `docs/_evidence/phase127-bun-concurrency.md` §3 measured four
 * `cpu-offload-candidate` surfaces whose compute blocks the event loop far longer than a warm
 * worker round-trip costs — PDF extract (~250-360 ms), docx parse (~52 ms), xlsx parse
 * (~218-326 ms), csv parse (~50-65 ms) against 0.02 ms round-trip at 1 KiB … 7.2 ms at 16 MiB,
 * i.e. ≥ 1 order of magnitude at every realistic payload. Three of those four were reverted
 * (Task 3) because their *results* clone far slower than their inputs (§12) — the pricing rule
 * that keeps that decision honest lives in `shouldOffloadToPool` below.
 *
 * Size: 8 x ~500 ms PDF extracts through a pool of N workers on a loaded 16-CPU host
 * (2026-09-26, load/cpu ~1.1-1.5): wall 5032 / 1905 / 1122 / 920 ms and per-extract p50
 * 542 / 471 / 548 / 852 ms for N = 1 / 2 / 4 / 8, with the parent 5 ms tick gap at 5.1 ms p50
 * for every N. N = 2 is the winner: best per-task latency and the smallest co-tenant CPU claim
 * (a bigger pool adds parallel CPU claim, not loop freedom, and the workspace suites are bounded
 * to 2 concurrent leaves because those budgets flake at 3-4).
 * ponytail: fixed 2 workers — raise only after re-measuring per-task latency and the co-tenant
 * budget suites on an idle host.
 *
 * Fail-closed: a worker error or exit rejects its in-flight task (never hangs); the slot is
 * dropped and replaced lazily by the next task. `closeWorkerPool()` rejects queued and in-flight
 * tasks and terminates every worker (the next task spawns fresh ones). Workers get an explicit
 * env allowlist (probe: a default Bun worker inherits all 69 parent env keys, including planted
 * secrets, while `env: {…}` is honored and left 1 key). Nothing here logs payload contents;
 * `workerPoolStats()` reports counts only.
 */
export const WORKER_POOL_MAX_WORKERS = 2;

/**
 * Input size below which a hop cannot pay for itself (plan 127 Task 1 §3): at 64 KiB inline compute
 * is ~7 ms (csv), ~20 ms (xlsx), ~52 ms (docx) and >50 ms (pdf) against a 0.063 ms round-trip, and
 * below it a tiny parse must not pay a cold worker spawn. This is only the input half of the price —
 * `shouldOffloadToPool` also charges the result side.
 */
export const WORKER_POOL_OFFLOAD_MIN_BYTES = 64 * 1024;

/** Measured one-way structured-clone prices, plan 127 §12 (Bun 1.4.2, loaded 16-CPU host). */
const FLAT_BYTES_PER_MS = 1_250_000; // Uint8Array: 1 MiB -> 0.71 ms, 4 MiB -> 2.24 ms, 16 MiB -> 13.07 ms
const RESULT_VALUES_PER_MS = 2_000; // model graphs: csv/xlsx 260k values -> 108/115 ms, docx 40k -> 12 ms
const WORKER_POOL_SCHEDULING_MS = 0.1; // measured warm dispatch + settle overhead
const OFFLOAD_MIN_COMPUTE_MARGIN = 10; // the moved pdf row is ~1500x; the reverted three were ~1-6x

/**
 * Price a hop in both directions before taking it (plan 127 further action #1).
 *
 * Task 1's break-even table priced only the input round-trip, and on that basis csv/xlsx/docx were
 * offloaded and then reverted: their results are object graphs, which clone 100x slower per byte
 * than a flat buffer (§9, §12), so the hop cost more than the parse it saved. Text and byte inputs
 * are cheap (a 2 MB string clones in 0.06 ms — strings are shared, not copied), so the result shape
 * is what decides. `resultValues` counts every value the clone must rebuild — containers plus leaf
 * strings/numbers, e.g. `rows x (columns + 1)` for a sheet model — and `computeMs` is the measured
 * (or per-unit-derived) inline cost. Offload only when the compute dwarfs both clones.
 */
export function shouldOffloadToPool(pricing: {
  /** Bytes sent to the worker. */
  readonly inputBytes: number;
  /** Values the clone must rebuild in the result (containers plus leaf strings/numbers). */
  readonly resultValues: number;
  /** Expected inline compute time — measured, or derived from a measured per-unit cost. */
  readonly computeMs: number;
}): boolean {
  if (!isMainThread) return false;
  if (pricing.inputBytes < WORKER_POOL_OFFLOAD_MIN_BYTES) return false;
  const cloneMs = pricing.inputBytes / FLAT_BYTES_PER_MS + pricing.resultValues / RESULT_VALUES_PER_MS;
  return pricing.computeMs >= OFFLOAD_MIN_COMPUTE_MARGIN * (cloneMs + WORKER_POOL_SCHEDULING_MS);
}

/** Typed task object crossing the thread boundary — never a function, never `eval`-shaped. */
export interface WorkerPoolTask {
  /** Handler name registered in `worker-pool-entry.ts`, e.g. `probe.echo`. */
  readonly kind: string;
  /** Structured-cloneable payload. Byte caps stay at each caller's trust boundary. */
  readonly payload?: unknown;
}

export interface WorkerPoolStats {
  readonly workers: number;
  readonly busy: number;
  readonly queued: number;
  readonly peak: number;
  readonly completed: number;
  readonly failed: number;
}

export class WorkerPoolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkerPoolError";
  }
}

/** A task that failed inside the worker; carries the remote error identity for revival. */
export class WorkerTaskError extends WorkerPoolError {
  readonly remoteName: string;
  readonly remoteMessage: string;

  constructor(remoteName: string, remoteMessage: string) {
    super(remoteMessage);
    this.name = "WorkerTaskError";
    this.remoteName = remoteName;
    this.remoteMessage = remoteMessage;
  }
}

/**
 * Rebuild the caller's own error class from a remote worker failure so `instanceof` checks keep
 * working (each class takes a message; the worker reply carries name + message only). Returns
 * `undefined` when the failure is not a known remote task error — callers rethrow the original.
 */
export function reviveWorkerTaskError(error: unknown, classes: readonly (new (message: string) => Error)[]): Error | undefined {
  if (!(error instanceof WorkerTaskError)) return undefined;
  for (const errorClass of classes) {
    if (errorClass.name === error.remoteName) return new errorClass(error.remoteMessage);
  }
  return undefined;
}

interface Job {
  readonly task: WorkerPoolTask;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface Slot {
  readonly worker: Worker;
  job: Job | null;
  dead: boolean;
}

type WorkerReply = { ok: true; value: unknown } | { ok: false; error: { name: string; message: string } };

const WORKER_ENTRY = new URL("./worker-pool-entry.js", import.meta.url);
const ENV_ALLOWLIST = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"] as const;

const slots = new Set<Slot>();
const idle: Slot[] = [];
const queue: Job[] = [];
let busy = 0;
let peak = 0;
let completed = 0;
let failed = 0;

/** Run one task on the pool; the pool spawns workers lazily and never hangs. */
export function runInPool<TOut = unknown>(task: WorkerPoolTask): Promise<TOut> {
  return new Promise<TOut>((resolve, reject) => {
    const job: Job = { task, resolve: resolve as (value: unknown) => void, reject };
    const slot = idle.pop();
    if (slot) {
      dispatch(slot, job);
      return;
    }
    if (slots.size < WORKER_POOL_MAX_WORKERS) {
      dispatch(createSlot(), job);
      return;
    }
    queue.push(job);
  });
}

export function workerPoolStats(): WorkerPoolStats {
  return { workers: slots.size, busy, queued: queue.length, peak, completed, failed };
}

/**
 * Terminate every worker and reject queued/in-flight tasks. Idempotent; the pool lazily spawns
 * fresh workers on the next task, so a host (or a test file) that shut it down can still use it.
 */
export async function closeWorkerPool(): Promise<void> {
  const error = new WorkerPoolError("worker pool is closed");
  while (queue.length > 0) {
    failed += 1;
    queue.shift()?.reject(error);
  }
  await Promise.all([...slots].map((slot) => dropSlot(slot, error, { terminate: true })));
  idle.length = 0;
}

function createSlot(): Slot {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const worker = new Worker(WORKER_ENTRY, { env });
  const slot: Slot = { worker, job: null, dead: false };
  worker.on("message", (reply: WorkerReply) => settle(slot, reply));
  worker.on("error", (error: Error) => {
    void dropSlot(slot, new WorkerPoolError(`worker failed: ${error.message}`, { cause: error }));
  });
  worker.on("exit", (code: number) => {
    void dropSlot(slot, new WorkerPoolError(`worker exited with code ${code}`));
  });
  worker.unref();
  slots.add(slot);
  return slot;
}

function dispatch(slot: Slot, job: Job): void {
  slot.job = job;
  busy += 1;
  peak = Math.max(peak, busy);
  slot.worker.ref();
  try {
    slot.worker.postMessage(job.task);
  } catch (error) {
    // Clone failure rejects this task; the worker itself is still healthy.
    slot.job = null;
    busy -= 1;
    failed += 1;
    idle.push(slot);
    slot.worker.unref();
    job.reject(new WorkerPoolError(`worker task is not structured-cloneable: ${(error as Error).message}`, { cause: error }));
    pump();
  }
}

function settle(slot: Slot, reply: WorkerReply): void {
  const job = slot.job;
  if (!job) return;
  slot.job = null;
  busy -= 1;
  idle.push(slot);
  slot.worker.unref();
  if (reply?.ok === true) {
    completed += 1;
    job.resolve(reply.value);
  } else {
    failed += 1;
    const detail = reply && reply.ok === false ? reply.error : undefined;
    job.reject(new WorkerTaskError(detail?.name ?? "WorkerPoolError", detail?.message ?? "worker task failed"));
  }
  pump();
}

function pump(): void {
  while (queue.length > 0) {
    const slot = idle.pop();
    if (slot) {
      dispatch(slot, queue.shift() as Job);
      continue;
    }
    if (slots.size < WORKER_POOL_MAX_WORKERS) {
      dispatch(createSlot(), queue.shift() as Job);
      continue;
    }
    return;
  }
}

async function dropSlot(slot: Slot, error: Error, options: { terminate?: boolean } = {}): Promise<void> {
  if (slot.dead) return;
  slot.dead = true;
  slots.delete(slot);
  const index = idle.indexOf(slot);
  if (index >= 0) idle.splice(index, 1);
  if (slot.job) {
    slot.job.reject(error);
    slot.job = null;
    busy -= 1;
    failed += 1;
  }
  if (options.terminate) await slot.worker.terminate();
  pump();
}
