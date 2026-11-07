import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARM_OVERSHOOT_TOKENS,
  abandonUnfinished,
  acquireCampaignLock,
  attemptCharge,
  availableTokens,
  CampaignBudgetBlocked,
  CampaignLocked,
  campaignLockPath,
  createAdmission,
  JournalInvalid,
  journalSpend,
  loadJournal,
  openJournal,
  reconcileAttempt,
  releaseCampaignLock,
  requireAttemptReservation,
  reserveAttempt,
  saveJournal,
} from "./journal.mjs";

const manifest = (ceiling = 20_000_000) => ({
  ceiling,
  priorReservation: 0,
  provider: "opencode-go",
  model: "mimo-v2.5",
  jobs: [{ id: "arm", suite: "longmemeval-s", config: "fabric", ablate: [] }],
});
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "prism-journal-"));
  return { dir, path: join(dir, "campaign-journal.json"), legacy: join(dir, "evidence") };
}
const reserved = (maxInputTokens = 1_000_000) => maxInputTokens + ARM_OVERSHOOT_TOKENS;

test("renamed_abandoned_attempt_keeps_reservation", async () => {
  const { dir, path } = await workspace();
  const journal = await openJournal({ path, manifest: manifest(), legacyDirectory: dir });
  const attempt = reserveAttempt(journal, { jobId: "arm", output: join(dir, "v2-arm.json"), maxInputTokens: 1_000_000 });
  await writeFile(attempt.output, "{}\n");
  await saveJournal(path, journal);
  await rename(attempt.output, join(dir, "abandoned-arm.json"));
  const reloaded = await loadJournal(path);
  const charge = attemptCharge(reloaded.attempts[0]);
  assert.equal(charge, reserved());
  assert.equal(journalSpend(reloaded), reserved());
  assert.equal(existsSync(attempt.output), false, "the renamed file no longer exists at its old path");
});

test("crash_before_first_report_still_consumes_allocation", async () => {
  const { dir, path } = await workspace();
  const journal = await openJournal({ path, manifest: manifest(), legacyDirectory: dir });
  reserveAttempt(journal, { jobId: "arm", output: join(dir, "missing.json"), maxInputTokens: 1_000_000 });
  await saveJournal(path, journal);
  // No report exists at all: recovery charges the reservation, it does not refund it.
  const recovered = abandonUnfinished(await loadJournal(path));
  assert.equal(recovered.attempts[0].status, "abandoned");
  assert.equal(attemptCharge(recovered.attempts[0]), reserved());
  assert.equal(availableTokens(recovered), 20_000_000 - reserved());
});

test("parallel_campaign_and_manual_child_cannot_oversubscribe", async () => {
  const { dir, path } = await workspace();
  const lock = campaignLockPath(path);
  await writeFile(lock, `${JSON.stringify({ pid: 1 })}\n`);
  await assert.rejects(() => acquireCampaignLock(lock), CampaignLocked);
  await writeFile(lock, `${JSON.stringify({ pid: 999_999_999 })}\n`);
  await acquireCampaignLock(lock, { pid: process.pid });
  await releaseCampaignLock(lock);

  const journal = await openJournal({ path, manifest: manifest(2_900_000), legacyDirectory: dir });
  reserveAttempt(journal, { jobId: "arm", output: join(dir, "a.json"), maxInputTokens: 1_000_000 });
  assert.throws(
    () => reserveAttempt(journal, { jobId: "arm", output: join(dir, "b.json"), maxInputTokens: 1_000_000 }),
    CampaignBudgetBlocked,
  );
  await saveJournal(path, journal);
  await assert.rejects(() => requireAttemptReservation({ journalPath: "", attemptId: "arm@1", maxInputTokens: 1 }), JournalInvalid);
  await assert.rejects(
    () => requireAttemptReservation({ journalPath: path, attemptId: "arm@1", maxInputTokens: 2_000_000 }),
    JournalInvalid,
  );
  await assert.rejects(() => requireAttemptReservation({ journalPath: path, attemptId: "missing", maxInputTokens: 1 }), JournalInvalid);
  const admitted = await requireAttemptReservation({ journalPath: path, attemptId: "arm@1", maxInputTokens: 1_000_000 });
  assert.equal(admitted.attempt.reservedInputTokens, reserved());
});

test("usage_missing_preserves_reservation_and_stops_unbounded_spend", async () => {
  const { dir, path } = await workspace();
  const journal = await openJournal({ path, manifest: manifest(2_800_000), legacyDirectory: dir });
  const attempt = reserveAttempt(journal, { jobId: "arm", output: join(dir, "a.json"), maxInputTokens: 1_000_000 });
  reconcileAttempt(journal, attempt.attemptId, { status: "completed", inputTokens: 300_000, usageComplete: false });
  assert.equal(attemptCharge(journal.attempts[0]), reserved(), "incomplete billing keeps the allocation");
  assert.equal(availableTokens(journal), 2_800_000 - reserved());
  assert.throws(
    () => reserveAttempt(journal, { jobId: "arm", output: join(dir, "b.json"), maxInputTokens: 1_000_000 }),
    CampaignBudgetBlocked,
  );
});

test("recovery_reconciles_usage_exactly_once", async () => {
  const { dir, path } = await workspace();
  const journal = await openJournal({ path, manifest: manifest(), legacyDirectory: dir });
  const attempt = reserveAttempt(journal, { jobId: "arm", output: join(dir, "a.json"), maxInputTokens: 1_000_000 });
  reconcileAttempt(journal, attempt.attemptId, { status: "completed", inputTokens: 400_000, usageComplete: true });
  const once = journalSpend(journal);
  reconcileAttempt(journal, attempt.attemptId, { status: "completed", inputTokens: 400_000, usageComplete: true });
  assert.equal(journalSpend(journal), once);
  assert.equal(once, 400_000);
  await saveJournal(path, journal);
  const reloaded = await loadJournal(path);
  assert.equal(journalSpend(reloaded), once);
});

test("retry_and_inflight_headroom_count_before_call", () => {
  // Two concurrent calls cannot each spend the same remaining allocation.
  const admission = createAdmission({ reservedInputTokens: 400_000, spent: () => 0 });
  admission.check();
  assert.throws(() => admission.check(), CampaignBudgetBlocked, "in-flight requests share the reservation");
  const spentAdmission = createAdmission({ reservedInputTokens: 400_000, spent: () => 200_000 });
  assert.throws(() => spentAdmission.check(), CampaignBudgetBlocked, "spend plus this request exceeds the reservation");
  const tight = createAdmission({ reservedInputTokens: 400_000, spent: () => 300_000 });
  assert.doesNotThrow(() => tight.check(100_000));
  assert.throws(() => tight.check(250_000), CampaignBudgetBlocked);
});

test("an_admission_token_releases_exactly_its_own_bound", () => {
  const admission = createAdmission({ reservedInputTokens: 1_000_000, spent: () => 0 });
  const first = admission.check();
  admission.check();
  admission.release(first);
  // The token accounting stays balanced; the spend gate is what decides admission.
  assert.doesNotThrow(() => admission.check());
  admission.release();
  assert.throws(() => createAdmission({ reservedInputTokens: 100_000, spent: () => 50_000 }).check(), CampaignBudgetBlocked);
});

test("a_stale_in_flight_bound_expires_instead_of_holding_the_reservation", () => {
  let clock = 0;
  const admission = createAdmission({ reservedInputTokens: 600_000, spent: () => 0, now: () => clock });
  const tokens = [admission.check(), admission.check()];
  assert.equal(tokens.filter(Boolean).length, 2);
  assert.throws(() => admission.check(), CampaignBudgetBlocked);
  // A leaked entry (an abandoned stream) is expired rather than held forever.
  clock += 660_001;
  admission.check();
  admission.release();
});

test("legacy_evidence_is_imported_once_at_its_allocation", async () => {
  const { dir, legacy } = await workspace();
  await import("node:fs/promises").then(({ mkdir }) => mkdir(legacy, { recursive: true }));
  await writeFile(
    join(legacy, "abandoned-rerun-full.json"),
    `${JSON.stringify({ status: "failed", inputTokens: 3_700_000, maxInputTokens: 12_000_000, usageComplete: false })}\n`,
  );
  await writeFile(
    join(legacy, "v2-full.json"),
    `${JSON.stringify({ status: "completed", inputTokens: 8_373_632, usageComplete: true })}\n`,
  );
  const first = await openJournal({ path: join(dir, "journal.json"), manifest: manifest(90_000_000), legacyDirectory: legacy });
  assert.equal(first.legacy.length, 2);
  assert.equal(journalSpend(first), 12_000_000 + 8_373_632);
  await saveJournal(join(dir, "journal.json"), first);
  const second = await openJournal({ path: join(dir, "journal.json"), manifest: manifest(90_000_000), legacyDirectory: legacy });
  assert.equal(journalSpend(second), journalSpend(first));
  await assert.rejects(
    () => openJournal({ path: join(dir, "journal.json"), manifest: manifest(80_000_000), legacyDirectory: legacy }),
    JournalInvalid,
  );
});

test("parallel_arms_never_exceed_ceiling_when_all_hit_caps", async () => {
  const { dir, path } = await workspace();
  // Room for exactly two arms at their caps, so a third launch must be refused, not over-committed.
  const cap = 1_000_000;
  const journal = await openJournal({ path, manifest: manifest(2 * reserved(cap) + 1), legacyDirectory: dir });
  for (const jobId of ["arm-a", "arm-b"]) reserveAttempt(journal, { jobId, output: join(dir, `${jobId}.json`), maxInputTokens: cap });
  assert.equal(journalSpend(journal), 2 * reserved(cap));
  assert.throws(
    () => reserveAttempt(journal, { jobId: "arm-c", output: join(dir, "arm-c.json"), maxInputTokens: cap }),
    CampaignBudgetBlocked,
  );
  // Both reservations stay chargeable while the parallel arms run.
  await saveJournal(path, journal);
  for (const jobId of ["arm-a", "arm-b"]) {
    const attempt = await requireAttemptReservation({ journalPath: path, attemptId: `${jobId}@1`, maxInputTokens: cap });
    assert.equal(attempt.attempt.reservedInputTokens, reserved(cap));
  }
  assert.equal(availableTokens(journal), 1);
});

test("resumed_baseline_journal_identity_includes_frozen_execution_protocol", async () => {
  const { manifestFingerprint } = await import("./journal.mjs");
  const base = { criteriaHash: "criteria", ceiling: 1000, jobs: [], resumeProtocolHash: "first" };
  assert.notEqual(manifestFingerprint(base), manifestFingerprint({ ...base, resumeProtocolHash: "changed" }));
});

test("overlapping_saves_land_in_order_and_keep_every_reservation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "journal-order-"));
  const path = join(dir, "journal.json");
  const journal = await openJournal({ path, manifest: manifest() });
  const saves = [];
  for (const jobId of ["a", "b", "c"]) {
    reserveAttempt(journal, { jobId, output: join(dir, `${jobId}.json`), maxInputTokens: 1000 });
    saves.push(saveJournal(path, journal));
  }
  await Promise.all(saves);
  const stored = await loadJournal(path);
  for (const jobId of ["a", "b", "c"]) assert.ok(stored.attempts.some((attempt) => attempt.jobId === jobId));
});
