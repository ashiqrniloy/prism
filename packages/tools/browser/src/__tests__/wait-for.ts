import { setTimeout as delay } from "node:timers/promises";

interface WaitForOptions {
  /** Deadline for the poll; the helper throws when it passes. */
  readonly timeoutMs?: number;
  /** Delay between reads. */
  readonly intervalMs?: number;
}

/**
 * Polls `read` until `ok` holds, returns that value, or throws naming the label and the
 * last observed value. Browser async state (download quarantine, idle reaping) is not
 * awaitable from the outside — `manager.ts` quarantines on a fire-and-forget listener
 * promise — so a fixed sleep is a race: under CPU load the state can arrive after the
 * sleep and the assertion fails for a reason unrelated to the behavior under test.
 */
export async function waitFor<T>(read: () => T, ok: (value: T) => boolean, label: string, options: WaitForOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (ok(value)) return value;
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label} (last observed ${preview(value)})`);
    }
    await delay(intervalMs);
  }
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
