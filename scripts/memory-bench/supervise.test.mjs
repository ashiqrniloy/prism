import { test } from "bun:test";
import assert from "node:assert/strict";
import { SUPERVISE_BACKOFF_MS, superviseDecision, superviseJournalPath } from "./supervise.mjs";

test("supervisor_restarts_until_finished_and_sleeps_through_a_daily_cap", () => {
  assert.deepEqual(superviseDecision({ status: "finished" }, { restarts: 3, maxRestarts: 10 }), { action: "stop", reason: "finished" });
  assert.equal(superviseDecision({ status: "active" }, { restarts: 10, maxRestarts: 10 }).action, "stop");
  // A crash or a halt backs off, growing to the cap.
  assert.equal(superviseDecision(null, { restarts: 0, maxRestarts: 10 }).waitMs, SUPERVISE_BACKOFF_MS[0]);
  assert.equal(superviseDecision({ status: "setup-failure" }, { restarts: 50, maxRestarts: 99 }).waitMs, SUPERVISE_BACKOFF_MS.at(-1));
  // A daily cap waits until the journal's resume time, plus a margin.
  const now = Date.parse("2026-11-04T20:00:00Z");
  const decision = superviseDecision({ status: "quota-daily", resumeAfter: "2026-11-05T00:00:00Z" }, { restarts: 0, maxRestarts: 10, now });
  assert.equal(decision.reason, "quota-daily");
  assert.equal(decision.waitMs, 4 * 3_600_000 + 120_000);
});

test("a_quick_read_supervisor_reads_the_quick_journal_not_the_full_one", () => {
  const env = { PRISM_MEMORY_BENCH_208_WORKER: "208-screen.large.P.locomo,208-screen.large.P+O.locomo" };
  const full = superviseJournalPath(env);
  const quick = superviseJournalPath({ ...env, PRISM_MEMORY_BENCH_208_QUICK: "1" });
  assert.notEqual(quick, full, "a quick read keeps its own journal");
  assert.match(quick, /journal-worker-[0-9a-f]+\.json$/);
  assert.throws(() => superviseJournalPath({}), /PRISM_MEMORY_BENCH_208_WORKER/);
});
