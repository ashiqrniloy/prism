/**
 * The delegation slot queue: at most `limit` slots held at once; a caller over the limit waits in call order up to
 * `timeoutMs`, and a waiter that times out or is aborted leaves the queue without taking a slot.
 */
export interface SlotQueue {
  /** Resolves when a slot is held; rejects with `onRefused`'s error on a full queue with `timeoutMs` 0, on timeout, or on abort. */
  acquire(options?: { readonly signal?: AbortSignal }): Promise<void>;
  /** Takes a slot without waiting, even over the limit: for a leg that continues a call already holding its place. */
  force(): void;
  /** Gives one slot back; the oldest waiter takes it before any new caller can. */
  release(): void;
  readonly active: number;
  readonly waiting: number;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
}

export function createSlotQueue(options: {
  readonly limit: number;
  readonly timeoutMs: number;
  /** The error a refused caller gets: `full` with `timeoutMs` 0, `timeout` after waiting, `aborted` by its signal. */
  readonly onRefused: (reason: "full" | "timeout" | "aborted") => Error;
}): SlotQueue {
  const { limit, timeoutMs, onRefused } = options;
  const waiters: Waiter[] = [];
  let active = 0;

  const remove = (waiter: Waiter): boolean => {
    const index = waiters.indexOf(waiter);
    if (index < 0) return false;
    waiters.splice(index, 1);
    return true;
  };

  return {
    acquire({ signal } = {}) {
      if (signal?.aborted) return Promise.reject(onRefused("aborted"));
      // Waiters come first: a new caller never overtakes one already queued.
      if (active < limit && waiters.length === 0) {
        active += 1;
        return Promise.resolve();
      }
      if (timeoutMs <= 0) return Promise.reject(onRefused("full"));
      return new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => {
          if (remove(waiter)) {
            waiter.cleanup();
            reject(onRefused("aborted"));
          }
        };
        const waiter: Waiter = {
          resolve,
          reject,
          cleanup: () => {
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
          },
        };
        timer = setTimeout(() => {
          if (remove(waiter)) {
            waiter.cleanup();
            reject(onRefused("timeout"));
          }
        }, timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.push(waiter);
      });
    },
    force() {
      active += 1;
    },
    release() {
      active = Math.max(0, active - 1);
      while (active < limit && waiters.length > 0) {
        const next = waiters.shift() as Waiter;
        next.cleanup();
        active += 1;
        next.resolve();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiters.length;
    },
  };
}
