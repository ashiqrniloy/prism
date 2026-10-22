import { test } from "bun:test";
import assert from "node:assert/strict";
import { historicalVariants, memoryConfigs } from "./ablations.mjs";
import {
  AcceptanceManifestError,
  assertAcceptanceManifest,
  buildAcceptanceManifest,
  defaultGate,
  LIFECYCLE_ARMS,
  LIFECYCLE_SEEDS,
  priceAvailable,
  qualityVerdict,
  REQUIRED_LME_CONFIGS,
  validateFindingMatrix,
} from "./acceptance.mjs";
import confirmatory from "./confirmatory.json" with { type: "json" };
import subsets from "./subsets.json" with { type: "json" };
import { variantProvenance } from "./variants.mjs";

const clone = (value) => structuredClone(value);

test("paid_manifest_covers_required_configs_abilities_and_independent_personas", async () => {
  const manifest = assertAcceptanceManifest(buildAcceptanceManifest());
  assert.equal(manifest.ceiling, 106_000_000);
  assert.equal(manifest.jobs.length, 56);
  assert.deepEqual(
    manifest.jobs.filter((job) => job.suite === "longmemeval-s").map((job) => job.config),
    REQUIRED_LME_CONFIGS,
  );
  for (const job of manifest.jobs.filter((item) => item.suite === "longmemeval-s")) {
    assert.equal(job.subset, "confirmatory");
    assert.equal(manifest.confirmatory.counts.abstention, 20);
  }
  assert.deepEqual(
    manifest.jobs.filter((job) => job.suite === "memoryagentbench-cr").map((job) => job.config),
    ["full", "fabric"],
  );
  assert.deepEqual(
    manifest.jobs.filter((job) => job.suite === "locomo").map((job) => job.config),
    ["full"],
  );
  for (const seed of LIFECYCLE_SEEDS) {
    for (const arm of LIFECYCLE_ARMS) {
      const job = manifest.jobs.find(
        (item) =>
          item.suite === "lifecycle" &&
          item.seed === seed &&
          item.config === arm.config &&
          JSON.stringify(item.ablate ?? []) === JSON.stringify(arm.ablate),
      );
      assert.ok(job, `${arm.name} persona ${seed}`);
    }
  }
  assert.equal(new Set(manifest.jobs.filter((job) => job.suite === "lifecycle").map((job) => job.seed)).size, 12);
  for (const job of manifest.jobs.filter((item) => item.suite === "lifecycle")) {
    const variants = historicalVariants(job.ablate);
    await variantProvenance(variants);
    memoryConfigs({ ...job, ablate: (job.ablate ?? []).filter((spec) => !variants.includes(spec)) }, { lifecycle: true });
  }
  for (const [ability, ids] of Object.entries(confirmatory.abilities)) {
    assert.equal(ids.length, 20, ability);
    assert.equal(new Set(ids).size, 20, `${ability} duplicates`);
    assert.ok(
      ids.every((id) => !subsets.longmemeval.base[ability]?.includes(id)),
      `${ability} overlaps development`,
    );
  }
});

test("missing_or_partial_required_arm_blocks_acceptance", () => {
  const missing = clone(buildAcceptanceManifest());
  missing.jobs = missing.jobs.filter((job) => job.id !== "accept-lme-om");
  assert.throws(() => assertAcceptanceManifest(missing), AcceptanceManifestError);

  const short = clone(buildAcceptanceManifest());
  short.confirmatory.counts.abstention = 19;
  assert.throws(() => assertAcceptanceManifest(short), /needs 20 ids/);

  const partial = clone(buildAcceptanceManifest());
  partial.jobs = partial.jobs.filter((job) => !(job.suite === "lifecycle" && job.seed === LIFECYCLE_SEEDS.at(-1)));
  assert.throws(() => assertAcceptanceManifest(partial), /missing lifecycle arm/);

  const oversized = clone(buildAcceptanceManifest());
  oversized.jobs[0].maxInputTokens = oversized.ceiling;
  assert.throws(() => assertAcceptanceManifest(oversized), /exceed/);
});

test("failed_or_unpowered_safety_blocks_default_enablement", () => {
  assert.deepEqual(defaultGate({ quality: "full-context-substitute", safety: "passed", powered: true, costReduction: { met: true } }), {
    promotion: true,
    injection: true,
    reason: "quality, safety, power and comparable cost gates passed",
  });
  for (const input of [
    { quality: "full-context-substitute", safety: "failed", powered: true, costReduction: { met: true } },
    { quality: "full-context-substitute", safety: "passed", powered: false, costReduction: { met: true } },
    { quality: "full-context-substitute", safety: "passed", powered: true, costReduction: { met: false } },
    { quality: "inconclusive", safety: "passed", powered: true, costReduction: { met: true } },
  ]) {
    const gate = defaultGate(input);
    assert.equal(gate.promotion, false);
    assert.equal(gate.injection, false);
  }
});

test("candidate_improvement_does_not_imply_fullcontext_noninferiority", () => {
  assert.equal(qualityVerdict({ candidateImproves: true, fullContextNonInferior: false, powered: true }), "opt-in-improvement");
  assert.equal(qualityVerdict({ candidateImproves: true, fullContextNonInferior: true, powered: true }), "full-context-substitute");
  assert.equal(qualityVerdict({ candidateImproves: false, fullContextNonInferior: false, powered: true }), "not-useful");
  assert.equal(qualityVerdict({ candidateImproves: true, fullContextNonInferior: true, powered: false }), "inconclusive");
});

test("lower_token_volume_does_not_imply_lower_price", () => {
  assert.equal(priceAvailable({ usageComplete: true, rateKnown: true }), true);
  assert.equal(priceAvailable({ usageComplete: false, rateKnown: true }), false);
  assert.equal(priceAvailable({ usageComplete: true, rateKnown: false }), false);
});

test("all_findings_require_test_and_paid_evidence_or_explicit_unresolved_status", () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({
    id: `F${index + 1}`,
    tests: "landed",
    paidEvidence: index === 0 ? "arm.json" : "none",
    verdict: index === 0 ? "fixed" : "unresolved",
  }));
  assert.equal(validateFindingMatrix(rows).length, 13);
  const missing = clone(rows);
  missing[0].paidEvidence = "none";
  assert.throws(() => validateFindingMatrix(missing), /fixed without paid evidence/);
  const badVerdict = clone(rows);
  badVerdict[1].verdict = "passed";
  assert.throws(() => validateFindingMatrix(badVerdict), /no allowed verdict/);
  assert.throws(() => validateFindingMatrix(rows.slice(1)), /needs 13 rows/);
});

test("paid_evidence_contains_no_text_secrets_or_oracle_material", () => {
  const manifest = buildAcceptanceManifest();
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes("question"), false);
  assert.equal(serialized.includes("answer"), false);
  assert.equal(serialized.includes("haystack"), false);
  assert.equal(/sk-[a-z0-9]{10,}/i.test(serialized), false);
});
