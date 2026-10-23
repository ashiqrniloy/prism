/**
 * Latency recorder for harness runs (plan 188.9 Task 3). Records milliseconds only: a report never
 * carries a prompt, an answer or a credential, so this module cannot be the place one leaks.
 */

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]);
}

const round = (value) => Math.round(value * 10) / 10;
const mean = (values) => (values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
const stats = (values) => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95), mean: mean(values) });

/**
 * `begin()`/`firstByte()`/`end()` measure one call. A non-streaming call leaves firstByte unset,
 * which is recorded as total time: the two fields differ only where the transport streams.
 */
export function createTiming({ now = () => performance.now() } = {}) {
  const calls = [];
  const questionTimes = [];
  return {
    begin() {
      return { startedAt: now(), firstByteMs: null };
    },
    firstByte(handle) {
      if (handle && handle.firstByteMs === null) handle.firstByteMs = now() - handle.startedAt;
    },
    end(handle, role) {
      const totalMs = now() - handle.startedAt;
      calls.push({ role, firstByteMs: round(handle.firstByteMs ?? totalMs), totalMs: round(totalMs) });
      return totalMs;
    },
    /** Wrap one awaitable in a role measurement. */
    async measure(role, run) {
      const handle = this.begin();
      try {
        return await run();
      } finally {
        this.end(handle, role);
      }
    },
    startQuestion() {
      const startedAt = now();
      return () => questionTimes.push(round(now() - startedAt));
    },
    summary({ wallMs, concurrency } = {}) {
      const byRole = {};
      for (const name of [...new Set(calls.map((call) => call.role))].sort()) {
        const selected = calls.filter((call) => call.role === name);
        byRole[name] = {
          calls: selected.length,
          firstByteMs: stats(selected.map((call) => call.firstByteMs)),
          totalMs: stats(selected.map((call) => call.totalMs)),
        };
      }
      return {
        wallMs: wallMs === undefined ? null : round(wallMs),
        concurrency: concurrency ?? null,
        questions: { n: questionTimes.length, wallMs: stats(questionTimes) },
        roles: byRole,
        calls: calls.length,
      };
    },
  };
}

/** A concurrency ceiling that can shrink at runtime on provider overload (never below `min`). */
export function createGate(initial, min = 1) {
  let limit = Math.max(min, initial);
  let active = 0;
  const waiting = [];
  const wake = () => {
    while (active < limit && waiting.length) {
      active++;
      waiting.shift()();
    }
  };
  return {
    get limit() {
      return limit;
    },
    get active() {
      return active;
    },
    halve() {
      const next = Math.max(min, Math.floor(limit / 2));
      const changed = next !== limit;
      limit = next;
      wake();
      return changed;
    },
    async acquire() {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise((resolve) => waiting.push(resolve));
    },
    release() {
      active--;
      wake();
    },
  };
}
