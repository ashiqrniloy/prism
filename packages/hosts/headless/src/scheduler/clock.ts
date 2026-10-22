export interface SchedulerClock {
  now(): number;
  /** Must settle promptly on abort and release its timer/listener. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const systemClock: SchedulerClock = {
  now: Date.now,
  sleep(ms, signal) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      // Platform timers overflow beyond 2^31-1 ms; re-arm long waits at that boundary.
      const timer = setTimeout(done, Math.min(ms, 2147483647));
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
    });
  },
};
