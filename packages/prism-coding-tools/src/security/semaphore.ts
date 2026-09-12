/**
 * FIFO counting semaphore shared by the native/docker sandbox, the egress proxy,
 * and the check runner concurrency caps.
 *
 * Contract:
 * - `acquire` resolves with a release callback; call it exactly once per successful
 *   acquire. Releasing an unheld slot is ignored (the active count floors at zero).
 * - Waiters wake in submission order (FIFO).
 * - With an `AbortSignal`, an aborted wait rejects with the caller's sandbox error
 *   class and drops its waiter, so an aborted waiter never consumes a slot; the
 *   abort listener is detached on both wake and abort.
 *
 * Internal to `prism-coding-tools` — intentionally absent from `./security/index.ts`.
 */

const ABORT_MESSAGE = "sandbox operation aborted";

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly abortError: new (message: string) => Error = Error,
  ) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new this.abortError(ABORT_MESSAGE);
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new this.abortError(ABORT_MESSAGE));
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    this.active += 1;
    return () => this.release();
  }

  /** Release a held slot and wake the next FIFO waiter. Safe to call more than once. */
  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}
