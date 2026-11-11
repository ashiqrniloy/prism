import type { DriverError } from "@arnilo/prism/driver-kit";
import { WorkflowAbortError, WorkflowRuntimeError } from "../errors.js";
import { isAbortError } from "../util.js";

const FIRST_BACKOFF_MS = 100;
export const DEFAULT_MAX_PROFILE_BACKOFF_MS = 2000;

/** True for the driver kit's structured `profile_busy`; only `code` is read, never the message. */
export function isProfileBusy(error: unknown): error is DriverError {
  for (let current: unknown = error, depth = 0; current !== null && typeof current === "object" && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === "profile_busy") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface FanOutPoolOptions {
  readonly concurrency: number;
  readonly maxBackoffMs: number;
  readonly signal?: AbortSignal;
}

/**
 * Runs `run(index)` for each index with at most `concurrency` in flight, results in index order.
 * An item that fails with `profile_busy` is re-queued behind the others, so it holds no slot, process,
 * or session while it waits; it is tried again when a sibling finishes, or after a bounded backoff when the
 * holder is outside this node. Any other failure stops further starts and is rethrown.
 */
export async function runFanOutPool<R>(count: number, run: (index: number) => Promise<R>, options: FanOutPoolOptions): Promise<R[]> {
  const results = new Array<R>(count);
  const queue = Array.from({ length: count }, (_, index) => index);
  let failed: unknown;
  const waiters = new Set<() => void>();
  let finishes = 0;
  const finished = (): void => {
    finishes += 1;
    for (const resolve of [...waiters]) resolve();
  };
  /** Resolves on the next sibling completion, after `backoff` ms, or on abort; leaves no timer behind. */
  const wait = (backoff: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        waiters.delete(done);
        options.signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, backoff);
      waiters.add(done);
      options.signal?.addEventListener("abort", done, { once: true });
    });

  const runner = async (): Promise<void> => {
    let streak = 0;
    let backoff = FIRST_BACKOFF_MS;
    while (failed === undefined) {
      if (options.signal?.aborted) {
        failed = new WorkflowAbortError();
        throw failed;
      }
      const index = queue.shift();
      if (index === undefined) return;
      try {
        results[index] = await run(index);
        streak = 0;
        backoff = FIRST_BACKOFF_MS;
        finished();
      } catch (error) {
        if (isProfileBusy(error) && !isAbortError(error)) {
          queue.push(index);
          streak += 1;
          if (streak >= queue.length) {
            const seen = finishes;
            await wait(backoff);
            backoff = Math.min(backoff * 2, options.maxBackoffMs);
            if (finishes !== seen) backoff = FIRST_BACKOFF_MS;
            streak = 0;
          }
          continue;
        }
        failed = error;
        finished();
        throw error;
      }
    }
  };

  const runners = Array.from({ length: Math.min(Math.max(options.concurrency, 1), count) }, runner);
  try {
    await Promise.all(runners);
  } catch (error) {
    await Promise.allSettled(runners);
    throw error;
  }
  if (queue.length > 0) throw new WorkflowRuntimeError("Fan-out ended with unstarted items", "ERR_PRISM_WORKFLOW_FANOUT");
  return results;
}
