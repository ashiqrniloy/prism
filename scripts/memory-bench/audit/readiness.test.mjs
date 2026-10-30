import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableHash } from "../journal.mjs";
import {
  assertBaselineContinuation,
  assertBaselineReadiness,
  loadReadinessEvidence,
  readinessBlockers,
  validateBaselineReadiness,
} from "./readiness.mjs";

test("continuation_may_change_wrapper_hash_but_not_draws_or_analysis_rules", async () => {
  const { assertAnalysisProtocol } = await import("./readiness.mjs");
  const original = { analysisHash: "old-wrapper", datasets: { suite: { idsHash: "frozen" } }, screening: "paired" };
  assertAnalysisProtocol(original, { ...original, analysisHash: "new-wrapper" });
  assert.throws(() => assertAnalysisProtocol(original, { ...original, datasets: { suite: { idsHash: "changed" } } }), /analysis protocol/);
  assert.throws(() => assertAnalysisProtocol(original, { ...original, screening: "changed" }), /analysis protocol/);
});

test("retained_cell_bytes_are_pinned_and_old_measurement_protocol_cannot_resume", async () => {
  const manifest = JSON.parse(await readFile("docs/_evidence/memory-bench/202/resume-manifest-before-commandcode-panel.json", "utf8"));
  const original = manifest.jobs.find((j) => j.retainedCompletion && j.arm === "full-truncated");
  assert.ok(original);
  const dir = await mkdtemp(join(tmpdir(), "prism-retained-cell-"));
  const bytes = await readFile(original.retainedCompletion.path);
  await writeFile(join(dir, "retained.json"), bytes);
  const job = { ...original, retainedCompletion: { ...original.retainedCompletion, path: "retained.json" } };
  assert.equal(JSON.parse(bytes).usageComplete, false);
  // Historical evidence stays valid as history; the repaired run path must refuse its reuse.
  await assert.rejects(assertBaselineContinuation(job, dir), /checkpoint does not match/);
  await writeFile(join(dir, "retained.json"), Buffer.concat([bytes, Buffer.from(" ")]));
  await assert.rejects(assertBaselineContinuation(job, dir), /bytes changed/);
});

const evidence = async () => {
  const e = await loadReadinessEvidence();
  for (const [key, file] of Object.entries({
    pilotManifest: "manifest.json",
    pilot: "final-results.json",
    coverage: "evidence-coverage.json",
    budget: "budget-accounting.json",
    roles: "role-totals.json",
  }))
    e[key] = JSON.parse(await readFile(`docs/_evidence/memory-bench/202/pilot-v3/${file}`, "utf8"));
  return e;
};

test("baseline_resume_refuses_missing_or_stale_readiness", async () => {
  await assert.rejects(assertBaselineReadiness({ root: "/tmp/prism-readiness-missing" }), /Readiness/);
  const pins = { productHash: "current" };
  const manifest = { executable: true, baselineComplete: false, jobs: [{ subset: "dev" }] };
  const report = { status: "ready", blockers: [], pins, manifestHash: stableHash(manifest) };
  assert.equal(validateBaselineReadiness(report, manifest, pins, []), manifest);
  assert.throws(() => validateBaselineReadiness(report, manifest, { productHash: "changed" }, []), /stale/);
  assert.throws(() => validateBaselineReadiness(report, { ...manifest, ceiling: 2 }, pins, []), /stale/);
  assert.throws(() => validateBaselineReadiness(report, manifest, pins, ["pilot-cells"]), /incomplete/);
});

test("readiness_cannot_pass_with_ineligible_comparator_or_missing_pilot_cell", async () => {
  const input = await evidence();
  assert.ok(!readinessBlockers(input).includes("pilot-cells"));
  input.pilot.cells.pop();
  assert.ok(readinessBlockers(input).includes("pilot-cells"));
  const other = await evidence();
  other.pilot.cells.find((c) => c.config === "full").contextEligibility.eligible = false;
  assert.ok(readinessBlockers(other).includes("comparator-eligibility"));
});

test("readiness_does_not_mark_broad_baseline_complete", async () => {
  const input = await evidence();
  input.budget.totals.missingUsageExchanges = 1;
  input.budget.totals.reservationCharge = 100_000_000;
  input.budget.totals.elapsedMinutesIncludingEngineeringAndProbe = 1000;
  const blockers = readinessBlockers(input);
  assert.ok(blockers.includes("usage-reconciliation"));
  assert.ok(blockers.includes("reservation-ceiling"));
  assert.ok(blockers.includes("elapsed-wall-ceiling"));
  const plan = await readFile("plans/202-Phase-11-Part-O12-Memory-Robustness-And-Recall-Beyond-Full-Context.md", "utf8");
  assert.match(plan, /- \[ \] Task 4: Baseline/);
});

test("readiness_cannot_pass_without_graded_rubric_registration_or_borderline_controls", async () => {
  const input = await evidence();
  input.graded.registration = {};
  assert.ok(readinessBlockers(input).includes("graded-registration"));
  const other = await evidence();
  other.graded.controls = other.graded.controls.filter((c) => c.variant !== "minusOne");
  assert.ok(readinessBlockers(other).includes("borderline-controls"));
});

test("readiness_requires_current_free_routes_and_unexpired_verified_operations", async () => {
  const { operationalBlockers } = await import("./readiness.mjs");
  const { BASELINE_MODELS, BASELINE_JUDGES } = await import("../baseline.mjs");
  const row = (ref) => ({
    ref,
    free: ref.startsWith("openrouter/"),
    status: "passed",
    inputCap: 100000,
    limits: { contextWindow: 128000 },
    parameters: { maxTokens: 8192 },
  });
  const e = {
    pilot: { kind: "202-readiness-pilot-v6" },
    pilotManifest: { answerModel: "commandcode/meta/muse-spark-1.3-contributor" },
    currentHarnessHash: "current",
    verification: { status: "passed", harnessHash: "current" },
    operations: {
      expiresAt: "2099-01-01T00:00:00Z",
      usage: { usageComplete: true },
      models: BASELINE_MODELS.map((m) => row(`${m.provider}/${m.model}`)),
      judges: BASELINE_JUDGES.map((ref) => ({ ...row(ref), positive: true, negative: false })),
    },
  };
  assert.deepEqual(operationalBlockers(e), []);
  const stale = structuredClone(e);
  stale.operations.expiresAt = "2000-01-01T00:00:00Z";
  assert.ok(operationalBlockers(stale).includes("quota-unavailable-or-unverified"));
  const paid = structuredClone(e);
  paid.operations.models[0].ref = "commandcode/paid";
  assert.ok(operationalBlockers(paid).includes("broad-models-panel-context-unverified"));
  const mislabeled = structuredClone(e);
  mislabeled.operations.models.find((r) => r.ref.includes("muse-spark")).free = true;
  assert.ok(operationalBlockers(mislabeled).includes("broad-models-panel-context-unverified"));
  const wrongPilot = structuredClone(e);
  wrongPilot.pilotManifest.answerModel = "commandcode/stealth/glyph-cluster:free";
  assert.ok(operationalBlockers(wrongPilot).includes("fresh-accounted-pilot-required"));
  const code = structuredClone(e);
  code.currentHarnessHash = "changed";
  assert.ok(operationalBlockers(code).includes("workspace-checks-failed"));
  const refused = structuredClone(e);
  refused.operations.finishedAt = "2026-01-01T00:00:00Z";
  refused.quota = { remaining: 0, observedAt: "2026-01-02T00:00:00Z" };
  assert.ok(operationalBlockers(refused).includes("quota-unavailable-or-unverified"));
  refused.operations.finishedAt = "2026-01-03T00:00:00Z";
  assert.deepEqual(operationalBlockers(refused), []);
  const partial = structuredClone(e);
  partial.operations.usage.usageComplete = false;
  assert.ok(operationalBlockers(partial).includes("probe-usage-reconciliation"));
});

test("stopped_campaign_carryover_preserves_unknown_reservations_without_double_counting", async () => {
  const { continuationCharge } = await import("./readiness.mjs");
  const stopped = {
    status: "stopped-by-owner",
    priorReservation: 12,
    legacy: [],
    attempts: [
      { reservedInputTokens: 100, confirmedInputTokens: 7, usageComplete: true },
      { reservedInputTokens: 20, usageComplete: false },
    ],
  };
  assert.equal(continuationCharge(10, 2, null), 12);
  assert.equal(continuationCharge(10, 2, stopped), 39);
  assert.throws(() => continuationCharge(10, 2, { ...stopped, priorReservation: 99 }), /carryover/);
  assert.throws(() => continuationCharge(10, 2, { ...stopped, status: "active" }), /carryover/);
});

test("owner_closed_screen_cannot_be_reopened_by_refreshing_admission", async () => {
  const { operationalBlockers } = await import("./readiness.mjs");
  const { BASELINE_MODELS, BASELINE_JUDGES } = await import("../baseline.mjs");
  const row = (ref) => ({
    ref,
    free: false,
    status: "passed",
    inputCap: 100000,
    limits: { contextWindow: 128000 },
    parameters: { maxTokens: 8192 },
  });
  const e = {
    pilot: { kind: "202-readiness-pilot-v6" },
    pilotManifest: { answerModel: "commandcode/meta/muse-spark-1.3-contributor" },
    currentHarnessHash: "current",
    verification: { status: "passed", harnessHash: "current" },
    operations: {
      expiresAt: "2099-01-01T00:00:00Z",
      usage: { usageComplete: true },
      models: BASELINE_MODELS.map((m) => row(`${m.provider}/${m.model}`)),
      judges: BASELINE_JUDGES.map((ref) => ({ ...row(ref), positive: true, negative: false })),
    },
  };
  assert.deepEqual(operationalBlockers(e), []);
  e.screenClosure = { status: "closed-by-owner", acceptedCells: 23, originallyPlannedCells: 25 };
  assert.ok(operationalBlockers(e).includes("screen-closed-by-owner"));
});

test("readiness_refuses_product_hash_without_cache_stability_record", async () => {
  const { CACHE_STABILITY, CACHE_STABILITY_TESTS, assertCacheStabilityPin, parseJunit, writeCacheStabilityRecord } = await import(
    "./readiness.mjs"
  );
  const { PREFIX_PRODUCT_PATHS, sourceFingerprint } = await import("../acceptance.mjs");
  const root = await mkdtemp(join(tmpdir(), "prism-cache-pin-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, PREFIX_PRODUCT_PATHS[0]), { recursive: true });
  await mkdir(join(root, CACHE_STABILITY), { recursive: true });
  const source = join(root, PREFIX_PRODUCT_PATHS[0], "index.ts");
  await writeFile(source, "export const product = 1;\n");
  const productHash = await sourceFingerprint(PREFIX_PRODUCT_PATHS, root);
  const manifest = { productHash };
  await assert.rejects(assertCacheStabilityPin(manifest, { root }), /cache-stability-record-missing/);

  const equivalencePath = join(root, CACHE_STABILITY, "equivalence.json");
  await writeFile(equivalencePath, `${JSON.stringify({ status: "different", post: { productHash }, mergeWithPreChangeCells: false })}\n`);
  const green = { pass: CACHE_STABILITY_TESTS.length, fail: 0, skip: 0, passed: [...CACHE_STABILITY_TESTS] };
  assert.equal((await writeCacheStabilityRecord({ root, run: () => ({ ...green, fail: 1 }) })).status, "failed");
  await assert.rejects(assertCacheStabilityPin(manifest, { root }), /cache-stability-suite-failed/);
  assert.equal((await writeCacheStabilityRecord({ root, run: () => ({ ...green, passed: green.passed.slice(1) }) })).status, "failed");
  assert.equal((await writeCacheStabilityRecord({ root, run: () => green })).status, "passed");
  await assertCacheStabilityPin(manifest, { root });
  // Any manifest hash other than the pinned one is refused, wherever its builder keeps it.
  await assert.rejects(assertCacheStabilityPin({ productHash: "other" }, { root }), /cache-stability-manifest-unpinned/);
  await assert.rejects(assertCacheStabilityPin({ sourceHashes: { product: "other" } }, { root }), /cache-stability-manifest-unpinned/);
  await assert.rejects(assertCacheStabilityPin({ product: { hash: "other" } }, { root }), /cache-stability-manifest-unpinned/);
  // The pre-fix arm of a prefix comparison legitimately has a different product hash.
  await assertCacheStabilityPin({ prefix: { productHash: "pre-fix", postfixProductHash: productHash } }, { root });
  // An edited equivalence file, or an edited product, breaks the pin.
  await writeFile(equivalencePath, `${JSON.stringify({ status: "identical", post: { productHash }, mergeWithPreChangeCells: false })}\n`);
  await assert.rejects(assertCacheStabilityPin(manifest, { root }), /cache-stability-equivalence-missing/);
  await writeCacheStabilityRecord({ root, run: () => green });
  await writeFile(source, "export const product = 2;\n");
  await assert.rejects(
    assertCacheStabilityPin({ productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS, root) }, { root }),
    /cache-stability-product-changed/,
  );

  const xml = `<testsuite><testcase name="a" /><testcase name="b"><failure message="x" /></testcase><testcase name="c"><skipped /></testcase></testsuite>`;
  assert.deepEqual(parseJunit(xml), { pass: 1, fail: 1, skip: 1, passed: ["a"] });
});
