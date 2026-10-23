import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historicalVariants, memoryConfigs } from "./ablations.mjs";
import { buildManifest, campaignJobs, reservation, writeManifest } from "./campaign.mjs";
import { openJournal, reserveAttempt, saveJournal } from "./journal.mjs";
import { variantProvenance } from "./variants.mjs";

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
