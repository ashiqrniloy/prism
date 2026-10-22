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
