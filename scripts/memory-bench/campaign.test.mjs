import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historicalVariants, memoryConfigs } from "./ablations.mjs";
import {
  buildManifest,
  campaignJobs,
  dailyFreeQuotaFailure,
  failureHttpStatus,
  isBudgetQuotaCause,
  nextDailyReset,
  reservation,
  retryUncounted,
  transientCooldownMs,
  transientFailure,
  writeManifest,
} from "./campaign.mjs";
import { openJournal, reserveAttempt, saveJournal, TERMINAL_ATTEMPT_STATUSES } from "./journal.mjs";
import { createAnswerCache } from "./judge.mjs";
import { variantProvenance } from "./variants.mjs";

test("resumed_campaign_charges_only_new_measured_usage_and_keeps_unknown_reservations", async () => {
  const { incrementalAttemptUsage } = await import("./campaign.mjs");
  const prior = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, usageComplete: true };
  const report = { inputTokens: 140, outputTokens: 17, cacheReadTokens: 25, usageComplete: true };
  assert.deepEqual(incrementalAttemptUsage(report, prior), { inputTokens: 40, outputTokens: 7, cacheReadTokens: 5, usageComplete: true });
  assert.equal(incrementalAttemptUsage({ ...report, usageComplete: false }, prior).usageComplete, false);
  assert.equal(incrementalAttemptUsage(report, { ...prior, usageComplete: false }).usageComplete, false);
  assert.throws(() => incrementalAttemptUsage({ ...report, inputTokens: 90 }, prior), /cumulative usage/);
});

test("campaign_preflights_each_actual_arm_and_reserves_unknown_usage", async () => {
  const jobs = campaignJobs();
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length);
  assert.equal(jobs.filter((job) => job.family === "rerun").length, 16);
  assert.deepEqual(
    jobs.filter((job) => job.suite === "locomo").map((job) => job.config),
    ["full"],
  );
  for (const job of jobs) {
    const variants = historicalVariants(job.ablate);
    await variantProvenance(variants);
    memoryConfigs({ ...job, ablate: job.ablate.filter((spec) => !variants.includes(spec)) }, { lifecycle: job.suite === "lifecycle" });
  }
  assert.equal(reservation({ inputTokens: 5, maxInputTokens: 100, usageComplete: false }), 100);
  assert.equal(reservation({ inputTokens: 120, maxInputTokens: 100, usageComplete: false }), 120);
  assert.equal(reservation({ inputTokens: 5, maxInputTokens: 100 }), 5);
  assert.throws(() => reservation({ inputTokens: NaN }));
  assert.throws(() => memoryConfigs({ config: "fabric", ablate: ["fabric.stem=off"] }), /preload/);
});

test("dry_manifest_does_not_reset_spend_or_start_provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prism-campaign-"));
  const manifestPath = join(dir, "campaign.json");
  const journalPath = join(dir, "campaign-journal.json");
  const manifest = await writeManifest(manifestPath);
  assert.equal(manifest.jobs.length, buildManifest().jobs.length);
  assert.ok(existsSync(manifestPath));
  assert.equal(existsSync(journalPath), false, "a dry run never creates a spend journal");
  const journal = await openJournal({ path: journalPath, manifest, legacyDirectory: dir });
  reserveAttempt(journal, { jobId: "arm", output: join(dir, "arm.json"), maxInputTokens: 1000 });
  await saveJournal(journalPath, journal);
  const before = await readFile(journalPath, "utf8");
  await writeManifest(manifestPath);
  assert.equal(await readFile(journalPath, "utf8"), before, "a dry run never rewrites an active journal");
});

// --- Plan 202 Task 5.4.3: daily free quota halts resumably -------------------------------------

test("daily_free_quota_halts_resumable_without_consuming_attempt", async () => {
  const daily = {
    status: "failed",
    failure: {
      code: "MemoryBenchAnswerError:429",
      message: "MemoryBenchAnswerError:429",
      cause: { code: "429", message: "OpenRouter request failed: 429 error:message:Rate limit exceeded: free-models-per-day" },
    },
  };
  assert.equal(failureHttpStatus(daily), 429);
  assert.ok(dailyFreeQuotaFailure(daily), "a daily free-model 429 is the account budget, not an arm failure");
  const perMinute = {
    ...daily,
    failure: { ...daily.failure, cause: { code: "429", message: "Rate limit exceeded: free-models-per-min" } },
  };
  assert.equal(dailyFreeQuotaFailure(perMinute), null, "a per-minute 429 stays the transient retry path");
  const badRequest = { ...daily, failure: { code: "MemoryBenchAnswerError:400", cause: { code: "400", message: "free-models-per-day" } } };
  assert.equal(dailyFreeQuotaFailure(badRequest), null, "only 429 carries a quota verdict");
  assert.equal(dailyFreeQuotaFailure({ status: "completed" }), null);
  assert.equal(isBudgetQuotaCause("quota-daily"), true);
  assert.equal(isBudgetQuotaCause("quota-window"), true);
  assert.equal(isBudgetQuotaCause("failed"), false);
  // A transient provider fault is re-run from its checkpoint and never spends the job's attempts.
  assert.equal(isBudgetQuotaCause("transient"), true);
  const failed = (code, message) => ({
    status: "failed",
    failure: { code, message: code, cause: { code: code.split(":").at(-1), message } },
  });
  assert.equal(transientFailure(failed("MemoryBenchJudgeError:429", "Kilo's free models are limited to 200 requests per hour")), true);
  assert.equal(
    transientFailure(failed("MemoryBenchAnswerError:400", "Kilo request failed: 400 ... error:message:Provider returned error,code:4")),
    true,
  );
  // An intermittent upstream content filter is transient: the same question passed on reruns.
  assert.equal(
    transientFailure(
      failed(
        "MemoryBenchAnswerError:400",
        "Command Code request failed: 400 error:message:400 InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.,type:invalid_request_error",
      ),
    ),
    true,
  );
  // A 400 the gateway pins on the request itself fails the same way on every re-run.
  assert.equal(
    transientFailure(
      failed(
        "MemoryBenchAnswerError:400",
        "opencode-go request failed: 400 error:type:invalid_request_error,message:Upstream request failed: invalid_value Validation: tools array cannot be empty",
      ),
    ),
    false,
  );
  assert.equal(transientFailure(failed("MemoryBenchAnswerError:502", "bad gateway")), true);
  assert.equal(
    transientFailure({ status: "failed", failure: { message: "TypeError: ECONNRESET: The socket connection was closed unexpectedly" } }),
    true,
  );
  assert.equal(transientFailure(failed("MemoryBenchAnswerError:400", "invalid schema")), false, "an input 400 is not transient");
  assert.equal(transientFailure(failed("MemoryBenchAnswerError:401", "unauthorized")), false);
  assert.equal(transientFailure({ status: "failed", failure: { message: "maximum context length exceeded" } }), false);
  assert.equal(transientFailure(daily), false, "a daily cap is its own pause");
  assert.equal(transientFailure({ status: "completed" }), false);
  assert.ok(transientCooldownMs(1) < transientCooldownMs(3) && transientCooldownMs(99) === transientCooldownMs(4));
  assert.ok(TERMINAL_ATTEMPT_STATUSES.includes("quota-daily"), "the halt is a terminal attempt status the journal accepts");
  // Two daily halts must not exhaust the job's two attempts: the rerun is still allowed.
  const attempts = Array.from({ length: 2 }, () => ({ jobId: "cell", cause: "quota-daily" }));
  assert.equal(attempts.filter((attempt) => !isBudgetQuotaCause(attempt.cause)).length, 0);
  assert.equal(nextDailyReset(new Date("2026-10-31T12:00:00Z")).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(nextDailyReset(new Date("2026-11-01T00:00:00Z")).toISOString(), "2026-11-02T00:00:00.000Z");
});

test("resume_after_daily_halt_regenerates_no_answer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prism-task5-resume-"));
  const keyOf = (protocolHash, id) => ({ protocolHash, id });
  const before = createAnswerCache({ root: dir });
  const key = before.key(keyOf("protocol-a", "q1"));
  await before.write(key, { answer: "the cached answer", injections: [] });
  // The halt keeps the cell's answers directory, so the rerun resolves the same checkpoint and does
  // not ask the provider again.
  const after = createAnswerCache({ root: dir });
  assert.equal(after.key(keyOf("protocol-a", "q1")), key, "the checkpoint identity survives a restart");
  assert.equal((await after.read(key))?.answer, "the cached answer");
  assert.equal(await after.read(after.key(keyOf("protocol-b", "q1"))), null, "a changed protocol is a miss, never a silent reuse");
  assert.equal(await after.read(after.key(keyOf("protocol-a", "q2"))), null);
});

// --- Plan 188.9 Task 4: fast campaign ------------------------------------------------------

test("sibling_failure_keeps_reservations_consistent", async () => {
  const { runArmPool } = await import("./campaign.mjs");
  const started = [];
  let finished = 0;
  const calls = [];
  const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  await runArmPool(jobs, 2, async (job) => {
    started.push(job.id);
    calls.push(job.id);
    if (job.id === "a") throw new Error("arm a failed");
    await new Promise((resolve) => setTimeout(resolve, 10));
    finished++;
    return {};
  });
  // Both concurrent arms were allowed to finish; the unstarted sibling never launched.
  assert.deepEqual(started.sort(), ["a", "b"]);
  assert.equal(finished, 1);
  assert.deepEqual(calls.sort(), ["a", "b"]);
});

test("parallel_campaign_is_faster_on_delayed_mock", async () => {
  const { runArmPool } = await import("./campaign.mjs");
  const jobs = Array.from({ length: 6 }, (_, index) => ({ id: `arm-${index}` }));
  const work = () => new Promise((resolve) => setTimeout(resolve, 120));
  const serialStart = performance.now();
  await runArmPool(jobs, 1, work);
  const serial = performance.now() - serialStart;
  const parallelStart = performance.now();
  await runArmPool(jobs, 3, work);
  const parallel = performance.now() - parallelStart;
  assert.ok(serial >= 6 * 120, `serial too fast to measure: ${serial}`);
  assert.ok(parallel < serial * 0.45, `parallel ${parallel.toFixed(0)}ms vs serial ${serial.toFixed(0)}ms`);
});

test("screen_profile_refuses_heldout_and_acceptance", async () => {
  const { assertScreenProfile, AcceptanceManifestError, SCREEN_PROFILE } = await import("./acceptance.mjs");
  const devJob = { id: "screen-fabric", suite: "longmemeval-s", config: "fabric", subset: "screen-v1" };
  assert.deepEqual(assertScreenProfile("task6", { jobs: [devJob] }), SCREEN_PROFILE);
  assert.equal(SCREEN_PROFILE.subset, "screen-v1");
  assert.equal(SCREEN_PROFILE.phase, "all");
  assert.equal(SCREEN_PROFILE.labelInjections, "off");
  assert.equal(SCREEN_PROFILE.concurrency, 8);
  assert.throws(() => assertScreenProfile("task6", { jobs: [{ ...devJob, subset: "heldout-v2" }] }), AcceptanceManifestError);
  assert.throws(() => assertScreenProfile("task6", { jobs: [{ ...devJob, subset: "confirmatory" }] }), AcceptanceManifestError);
  assert.throws(() => assertScreenProfile("task6", { jobs: [{ ...devJob, suite: "locomo" }] }), AcceptanceManifestError);
  assert.throws(() => assertScreenProfile("acceptance1888", { jobs: [devJob] }), /acceptance manifest/);
  assert.throws(() => assertScreenProfile("acceptance", { jobs: [devJob] }), /acceptance manifest/);
});

test("write_side_jobs_are_ordered_and_validated", async () => {
  const { orderJobs } = await import("./campaign.mjs");
  const { assertJobDependencies } = await import("./acceptance.mjs");
  const jobs = [
    { id: "read", suite: "longmemeval-s", config: "fabric", writeSide: "write" },
    { id: "write", suite: "longmemeval-s", config: "fabric-agentic" },
  ];
  assert.deepEqual(
    orderJobs(jobs).map((job) => job.id),
    ["write", "read"],
  );
  assert.doesNotThrow(() => assertJobDependencies(jobs));
  assert.throws(() => assertJobDependencies([{ ...jobs[0], writeSide: "missing" }, jobs[1]]), /unknown write side/);
  assert.throws(() => assertJobDependencies([jobs[0], { ...jobs[1], suite: "locomo" }]), /must agree on suite/);
  assert.throws(() => assertJobDependencies([jobs[0], { ...jobs[1], config: "om" }]), /must be a fabric arm/);
  assert.throws(
    () =>
      assertJobDependencies([
        { ...jobs[0], writeSide: "write", id: "write2" },
        { ...jobs[1], writeSide: "read" },
      ]),
    /itself a read-side arm/,
  );
});

test("parallel_pool_still_runs_a_single_job_at_a_time_when_asked", async () => {
  const { runArmPool } = await import("./campaign.mjs");
  let active = 0;
  let peak = 0;
  await runArmPool([{ id: "a" }, { id: "b" }], 1, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return {};
  });
  assert.equal(peak, 1);
});

test("cache_probe_rows_are_listed_beside_the_verdict_without_the_per_request_body", async () => {
  const { cacheProbeRows } = await import("./campaign.mjs");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "prism-probe-rows-"));
  assert.deepEqual(await cacheProbeRows(join(dir, "missing")), []);
  await writeFile(
    join(dir, "cache-probe.commandcode-muse.json"),
    JSON.stringify({
      route: "commandcode/muse",
      status: "as-expected",
      requests: 12,
      requestsReadingCache: 11,
      expectedBreakRequest: 9,
      breakReadsLess: true,
      unexpectedMisses: [],
      perRequest: [{ bodySha256: "x" }],
    }),
  );
  await writeFile(join(dir, "report.json"), "{}");
  const rows = await cacheProbeRows(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].informational, true);
  assert.equal(rows[0].route, "commandcode/muse");
  assert.equal("perRequest" in rows[0], false);
});

test("interrupted_attempts_cost_only_wall_time_on_retrying_routes", () => {
  const retrying = { freeRouteRetries: true };
  assert.equal(retryUncounted(retrying, { status: "abandoned" }), true);
  assert.equal(retryUncounted(retrying, { status: "failed", cause: "transient" }), true);
  assert.equal(retryUncounted(retrying, { status: "setup-failure" }), false);
  assert.equal(retryUncounted(retrying, { status: "failed", cause: "answer-error" }), false);
  assert.equal(retryUncounted({}, { status: "abandoned" }), false);
});
