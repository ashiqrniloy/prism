import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historicalVariants, memoryConfigs } from "./ablations.mjs";
import {
  ACCEPTANCE_1888_PROTOCOL_VERSION,
  ACCEPTANCE_1889_CEILING,
  ACCEPTANCE_1889_FULL_REPORT,
  ACCEPTANCE_1889_SCREEN_CEILING,
  ACCEPTANCE_18810_CEILING,
  ACCEPTANCE_18810_CRITERIA,
  ACCEPTANCE_18810_PRIOR_RESERVATION,
  ACCEPTANCE_18810_SUBSET,
  AcceptanceManifestError,
  ARM_1889_IDS,
  acceptance1888TaskState,
  acceptance18810Verdict,
  armRecord1888,
  assertAcceptance1888Manifest,
  assertAcceptance1889Manifest,
  assertAcceptance1889ProbeManifest,
  assertAcceptance1889ScreenManifest,
  assertAcceptance18810Manifest,
  assertAcceptanceManifest,
  assertScreenAManifest,
  assertScreenProfile,
  buildAcceptance1888Manifest,
  buildAcceptance1889Manifest,
  buildAcceptance1889ProbeManifest,
  buildAcceptance1889ScreenManifest,
  buildAcceptance18810Manifest,
  buildAcceptanceManifest,
  buildScreenAManifest,
  chooseConcurrency,
  defaultGate,
  findingVerdict1888,
  frozenProduct,
  fullReferenceReuse1889,
  GATE_1_CAP,
  HELDOUT_SUBSETS,
  heldout1888,
  heldoutV3Draw,
  improvementVerdict,
  LIFECYCLE_ARMS,
  LIFECYCLE_SEEDS,
  PRIMARY_1888_ABILITIES,
  prefixArmAudit,
  priceAvailable,
  primaryFamily1888,
  qualityVerdict,
  REQUIRED_LME_CONFIGS,
  SCREEN_1889_ARM_IDS,
  SCREEN_1889_ARMS,
  SCREEN_1889_BASELINE_VARIANT,
  SCREEN_A_ARM_IDS,
  SCREEN_A_TARGET,
  screenArmCounts,
  screenAVerdict,
  screenVerdict,
  sourceFingerprint,
  stageASelection,
  statisticallyPowered,
  substitutionVerdict,
  validateFindingMatrix,
} from "./acceptance.mjs";
import { writeCostOf } from "./acceptance-report.mjs";
import confirmatory from "./confirmatory.json" with { type: "json" };
import { multiSessionDiagnostic } from "./retrieval-diagnostics.mjs";
import screenV1 from "./screen-v1.json" with { type: "json" };
import { holm } from "./stats.mjs";
import subsets from "./subsets.json" with { type: "json" };
import { variantProvenance } from "./variants.mjs";

const clone = (value) => structuredClone(value);

test("screen_profiles_refuse_every_heldout_draw", () => {
  // Plan 188.10 Task 2: the screen profile refuses the live held-out draw, like held-out v2 before it.
  assert.deepEqual(HELDOUT_SUBSETS, ["heldout-v2", "heldout-v3"]);
  for (const subset of HELDOUT_SUBSETS)
    assert.throws(
      () => assertScreenProfile("task6", { jobs: [{ id: "screen-x", suite: "longmemeval-s", subset }] }),
      new RegExp(`refuses ${subset} ids`),
    );
  const ok = { jobs: [{ id: "screen-x", suite: "longmemeval-s", subset: "screen-ms-v1" }] };
  assert.throws(() => assertScreenProfile("task6", ok), /cannot run subset screen-ms-v1/);
  assert.equal(
    assertScreenProfile("task6", { jobs: [{ id: "screen-x", suite: "longmemeval-s", subset: "screen-v1" }] }).subset,
    "screen-v1",
  );
});

/** A report with `correct` of `total` per ability, for the pre-registered Stage A target. */
function stageAReport(perAbility, { runLimited = 0 } = {}) {
  const results = [];
  for (const [ability, { correct, total }] of Object.entries(perAbility))
    for (let index = 0; index < total; index += 1)
      results.push({
        ability,
        value: index < correct ? 1 : 0,
        outcome: index >= correct && index < correct + runLimited ? "run_limit" : "answered",
      });
  return { results };
}

const STAGE_A_BASELINE = {
  "multi-session": { correct: 14, total: 30 },
  "knowledge-update": { correct: 3, total: 5 },
  "temporal-reasoning": { correct: 3, total: 5 },
  "single-session-user": { correct: 5, total: 5 },
  "single-session-assistant": { correct: 4, total: 5 },
  "single-session-preference": { correct: 4, total: 5 },
  abstention: { correct: 5, total: 5 },
};

test("screen_a_manifest_requires_cap_development_ids_and_t_dev", () => {
  // Plan 188.10 Task 7: no paid call before the owner's cap is recorded, no held-out id, no target drift.
  const built = buildScreenAManifest({ harnessHash: "a".repeat(64), productHash: "b".repeat(64) });
  assert.match(built.gate.approval, /^Gate 1 approved 2026-10-23: 34,000,000 tokens/, "the cap is recorded verbatim");
  assert.equal(assertScreenAManifest(built).kind, "188.10-gate1-stage-a");
  const approved = structuredClone(built);
  const pending = structuredClone(built);
  pending.gate.approval = "pending owner approval";
  assert.throws(() => assertScreenAManifest(pending), /not owner-approved yet/, "an unapproved cap cannot spend");
  assert.deepEqual(
    approved.jobs.map((job) => job.config),
    ["fabric-x", "fabric-x", "fabric-x-tools"],
    "the free writer, the passive reference and the tools arm, nothing else",
  );
  assert.ok(approved.jobs.every((job) => job.subset === "screen-ms-v1" && job.labelInjections === "off"));
  assert.deepEqual(
    approved.jobs.filter((job) => job.writeSide).map((job) => job.writeSide),
    [SCREEN_A_ARM_IDS["write-x"], SCREEN_A_ARM_IDS["write-x"]],
    "both readers reuse the one local writer's snapshot",
  );
  assert.equal(approved.jobs[0].write, true, "the writer is the only job that writes");
  for (const [mutate, message] of [
    [(manifest) => (manifest.gate.approval = "pending owner approval"), /not owner-approved yet/],
    [(manifest) => (manifest.gate.approval = "short"), /recorded verbatim with its date/],
    [(manifest) => (manifest.gate.cap = 40_000_000), /cap must be the approved/],
    [(manifest) => (manifest.ceiling = 40_000_000), /Stage A ceiling/],
    [(manifest) => (manifest.jobs[0].subset = "heldout-v3"), /refuses heldout-v3|must run screen-ms-v1/],
    [(manifest) => (manifest.target.multiSessionCorrect = 15), /fixes multiSessionCorrect at 18/],
    [(manifest) => (manifest.target.maxAbilityLoss = 2), /fixes maxAbilityLoss at 1/],
    [(manifest) => (manifest.jobs[0].labelInjections = "on"), /labels off/],
    [(manifest) => manifest.jobs.pop(), /exactly its three declared arms/],
    [(manifest) => (manifest.jobs[2].writeSide = "other"), /must reuse the `fabric-x` snapshot/],
  ]) {
    const copy = structuredClone(approved);
    mutate(copy);
    assert.throws(() => assertScreenAManifest(copy), message);
  }
});

test("t_dev_verdict_written_from_manifest_rule", () => {
  // Plan 188.10 Task 7: the verdict is a function of the pre-registered target, never hand-set.
  const reference = stageAReport(STAGE_A_BASELINE);
  const met = stageAReport({
    ...STAGE_A_BASELINE,
    "multi-session": { correct: 18, total: 30 },
    "knowledge-update": { correct: 2, total: 5 },
  });
  const verdict = screenAVerdict({ reference, arms: { "x-tools": met } });
  assert.equal(verdict.target, SCREEN_A_TARGET);
  assert.equal(verdict.arms["x-tools"].met, true, "18/30 with a one-question ability loss meets T_dev");
  assert.equal(verdict.selected, "x-tools");
  assert.deepEqual(verdict.next, { skipStageB: true, heldoutArm: "x-tools" });

  const misses = [
    [{ ...STAGE_A_BASELINE, "multi-session": { correct: 17, total: 30 } }, /multi-session 17\/30 < 18\/30/],
    [
      { ...STAGE_A_BASELINE, "multi-session": { correct: 18, total: 30 }, "knowledge-update": { correct: 1, total: 5 } },
      /worst ability loss 2 > 1/,
    ],
    [{ ...STAGE_A_BASELINE, "multi-session": { correct: 20, total: 30 } }, /run-limit rate/],
  ];
  for (const [perAbility, message] of misses) {
    const missed = screenAVerdict({
      reference,
      arms: { "x-tools": stageAReport(perAbility, { runLimited: perAbility === misses[2][0] ? 3 : 0 }) },
    });
    assert.equal(missed.arms["x-tools"].met, false, message.source);
    assert.match(missed.arms["x-tools"].reason, message);
    assert.equal(missed.selected, null, "a miss selects nothing");
    assert.equal(missed.next, "stage-b");
  }
  // A short arm cannot claim the absolute target even when every answered question is right.
  const short = screenAVerdict({ reference, arms: { "x-tools": stageAReport({ "multi-session": { correct: 18, total: 18 } }) } });
  assert.equal(short.arms["x-tools"].met, false);
  assert.match(short.arms["x-tools"].reason, /multi-session answered 18, target is set on 30/);
});

test("screen_a_selects_tools_arm_only_when_t_dev_met", () => {
  // Plan 188.10 Task 7: the reference is never "selected"; only the tools arm can skip Stage B.
  const reference = stageAReport(STAGE_A_BASELINE);
  const none = screenAVerdict({ reference, arms: {} });
  assert.equal(none.selected, null, "no tools report means no selection");
  assert.equal(none.next, "stage-b");
  assert.throws(() => screenAVerdict({ arms: {} }), /needs the fabric-x reference/);
  const ties = screenAVerdict({
    reference: stageAReport(STAGE_A_BASELINE),
    arms: { "x-tools": stageAReport({ ...STAGE_A_BASELINE, "multi-session": { correct: 18, total: 30 } }) },
  });
  assert.deepEqual(ties.next, { skipStageB: true, heldoutArm: "x-tools" });
});

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

/* Plan 188.8: paid held-out acceptance manifest, verdicts and aggregate-only evidence. */
test("acceptance_188_8_manifest_requires_cap_and_heldout_v2_ids", () => {
  const manifest = assertAcceptance1888Manifest(
    buildAcceptance1888Manifest({ harnessHash: "h", productHash: "p", postfixProductHash: "q" }),
  );
  assert.equal(manifest.ceiling, 30_000_000);
  assert.equal(manifest.protocolVersion, 2);
  assert.equal(manifest.jobs.length, 5);
  assert.deepEqual(
    manifest.jobs.filter((job) => job.subset === "heldout-v2").map((job) => job.config),
    ["fabric", "fabric", "fabric-agentic", "full"],
  );
  const heldout = new Set(Object.values(manifest.heldoutV2.ids).flat());
  const development = Object.values(manifest.development.ids).flat();
  assert.equal(heldout.size, 100);
  for (const id of development) assert.equal(heldout.has(id), false, id);
  const noCap = clone(manifest);
  delete noCap.jobs[0].maxInputTokens;
  assert.throws(() => assertAcceptance1888Manifest(noCap), /cap must be/);
  const overCeiling = clone(manifest);
  overCeiling.ceiling = 1;
  assert.throws(() => assertAcceptance1888Manifest(overCeiling), /ceiling/);
  const leaked = clone(manifest);
  leaked.heldoutV2.ids[Object.keys(leaked.heldoutV2.ids)[0]][0] = development[0];
  assert.throws(() => assertAcceptance1888Manifest(leaked), /development id in the held-out draw/);
  const noHashes = clone(manifest);
  noHashes.prefix.harnessHash = null;
  assert.throws(() => assertAcceptance1888Manifest(noHashes), /both source hashes/);
  const sameProduct = clone(manifest);
  sameProduct.prefix.postfixProductHash = sameProduct.prefix.productHash;
  assert.throws(() => assertAcceptance1888Manifest(sameProduct), /identical to the post-fix product/);
  assert.throws(() => assertAcceptance1888Manifest(buildAcceptanceManifest()), /not the 188.8/);
});

test("prefix_arm_differs_from_postfix_only_in_product_paths", async () => {
  const manifest = buildAcceptance1888Manifest({ harnessHash: "harness", productHash: "product", postfixProductHash: "postfix" });
  const dir = await mkdtemp(join(tmpdir(), "prism-prefix-"));
  const write = async (root, paths, files) => {
    for (const file of files) {
      await mkdir(join(root, paths[0]), { recursive: true });
      await writeFile(join(root, paths[0], file.name), file.body);
    }
  };
  await write(dir, ["scripts/memory-bench"], [{ name: "run.mjs", body: "same" }]);
  await write(dir, ["packages/memory/fabric/src"], [{ name: "context.ts", body: "old product" }]);
  const postfix = await mkdtemp(join(tmpdir(), "prism-postfix-"));
  await write(postfix, ["scripts/memory-bench"], [{ name: "run.mjs", body: "same" }]);
  await write(postfix, ["packages/memory/fabric/src"], [{ name: "context.ts", body: "new product" }]);
  const harnessHash = await sourceFingerprint(["scripts/memory-bench"], postfix);
  const prefixHash = await sourceFingerprint(["packages/memory/fabric/src"], dir);
  const productHash = await sourceFingerprint(["packages/memory/fabric/src"], postfix);
  const recorded = { ...manifest, prefix: { ...manifest.prefix, harnessHash, productHash: prefixHash, postfixProductHash: productHash } };
  const audited = await prefixArmAudit(recorded, { root: postfix, worktree: dir });
  assert.notEqual(audited.productHash, audited.postfixProductHash);
  // A changed harness file makes the pre-fix arm a different protocol, not a treatment.
  const drifted = await mkdtemp(join(tmpdir(), "prism-drift-"));
  await write(drifted, ["scripts/memory-bench"], [{ name: "run.mjs", body: "changed" }]);
  await write(drifted, ["packages/memory/fabric/src"], [{ name: "context.ts", body: "old product" }]);
  await assert.rejects(prefixArmAudit(recorded, { root: postfix, worktree: drifted }), /harness differs/);
  // An identical product is not the treatment either.
  await assert.rejects(prefixArmAudit(recorded, { root: postfix, worktree: postfix }), /identical to the post-fix product/);
});

test("primary_family_is_holm_over_four_abilities", () => {
  const group = (p, diff = 0.1) => ({ p, diff, ci95: [diff - 0.1, diff + 0.1], confirmatory: true });
  const groups = {
    "knowledge-update": group(0.01),
    "multi-session": group(0.02),
    "temporal-reasoning": group(0.03),
    "single-session-user": group(0.04),
    "single-session-assistant": group(0.0001),
    abstention: group(0.0001),
    overall: group(0.001),
  };
  const family = primaryFamily1888(groups);
  assert.deepEqual(Object.keys(family), PRIMARY_1888_ABILITIES);
  assert.deepEqual(
    Object.values(family).map((entry) => entry.pHolm),
    holm([0.01, 0.02, 0.03, 0.04]),
  );
  // Holm over four tests never equals the two-test correction a descriptive family would give.
  assert.notEqual(family["knowledge-update"].pHolm, holm([0.01, 0.0001])[0]);
  assert.equal(primaryFamily1888({ "knowledge-update": group(0.01) })["multi-session"], undefined);
});

test("improvement_verdict_does_not_imply_substitution", () => {
  const improved = {
    "knowledge-update": { diff: 0.3, pHolm: 0.001 },
    "multi-session": { diff: 0.1, pHolm: 0.2 },
    "temporal-reasoning": { diff: 0.05, pHolm: 0.4 },
    "single-session-user": { diff: 0.02, pHolm: 0.9 },
  };
  assert.equal(improvementVerdict({ groups: improved, powered: true }), "improved");
  const wide = { confirmatory: true, ci95: [-0.2, 0.01] };
  assert.equal(substitutionVerdict({ overall: wide }), "not-a-substitute");
  assert.equal(substitutionVerdict({ overall: { ci95: [-0.2, 0.01] } }), "not-a-substitute");
  assert.equal(substitutionVerdict({ overall: { ci95: [-0.01, 0.02] } }), "full-context-substitute");
  assert.equal(substitutionVerdict({ overall: { ci95: [-0.01, 0.02] }, powered: false }), "not-a-substitute");
  // A quality claim needs paired clusters and power, not complete usage accounting.
  assert.equal(statisticallyPowered({ n: 100, clusters: 100, power: 0.99 }), true);
  assert.equal(statisticallyPowered({ n: 100, clusters: 100, power: 0.4 }), false);
  assert.equal(statisticallyPowered({ n: 100, clusters: 4, power: 0.99 }), false);
  // An improvement alone is never a fix; a measured, unmoved gap is unresolved, not inconclusive.
  assert.equal(findingVerdict1888({ improvement: "improved", substitution: "not-a-substitute" }), "unresolved");
  assert.equal(findingVerdict1888({ improvement: "inconclusive", substitution: "not-a-substitute" }), "unresolved");
  assert.equal(findingVerdict1888({ improvement: "improved", substitution: "full-context-substitute" }), "fixed");
  assert.equal(findingVerdict1888({ improvement: "improved", substitution: "full-context-substitute", powered: false }), "inconclusive");

  const regressed = { ...improved, "multi-session": { diff: -0.2, pHolm: 0.01 } };
  assert.equal(improvementVerdict({ groups: regressed, powered: true }), "worse");
  assert.equal(improvementVerdict({ groups: improved, powered: false }), "inconclusive");
  assert.equal(improvementVerdict({ groups: { "knowledge-update": improved["knowledge-update"] }, powered: true }), "inconclusive");
});

test("missing_primary_arm_keeps_task_unchecked_in_report", () => {
  const state = acceptance1888TaskState({ missing: [{ id: "accept1888-full", attempts: [] }] });
  assert.equal(state.taskComplete, false);
  assert.deepEqual(state.missing, ["accept1888-full"]);
  assert.equal(acceptance1888TaskState({ missing: [] }).taskComplete, true);
});

test("evidence_contains_no_text_or_oracle_material", () => {
  const manifest = buildAcceptance1888Manifest({ harnessHash: "h", productHash: "p", postfixProductHash: "q" });
  const serialized = JSON.stringify(manifest);
  for (const forbidden of ["question", "answer", "haystack", "sk-"]) assert.equal(serialized.includes(forbidden), false);
  const report = {
    status: "completed",
    inputTokens: 10,
    cacheReadTokens: 4,
    outputTokens: 2,
    results: [
      {
        id: "f685340e_abs",
        ability: "abstention",
        correct: true,
        outcome: "answered",
        question: "secret question text",
        answer: "secret gold answer",
        haystack: "secret history",
      },
    ],
  };
  const record = JSON.stringify(armRecord1888(report));
  for (const forbidden of ["secret", "question", "haystack"]) assert.equal(record.includes(forbidden), false);
  assert.equal(JSON.parse(record).correct, 1);
});

// --- Plan 188.9 Task 10: paid development screen -------------------------------------------

const screenManifest = (overrides = {}) =>
  buildAcceptance1889ScreenManifest({
    harnessHash: "a".repeat(64),
    productHash: "b".repeat(64),
    writeSideKeys: { x: "c".repeat(64), xc: "d".repeat(64) },
    concurrency: { concurrency: 8, reason: "probe" },
    ...overrides,
  });

test("screen_manifest_requires_cap_and_development_ids_only", () => {
  const manifest = screenManifest();
  assert.equal(assertAcceptance1889ScreenManifest(manifest), manifest);
  assert.equal(manifest.ceiling, ACCEPTANCE_1889_SCREEN_CEILING);
  // The reads carry the spend claim; a write side is reserved and charged once, in order.
  const readCaps = manifest.jobs
    .filter((job) => !job.id.endsWith("-write-x") && !job.id.endsWith("-write-xc"))
    .reduce((sum, job) => sum + job.maxInputTokens, 0);
  assert.ok(readCaps <= ACCEPTANCE_1889_SCREEN_CEILING, "read caps fit the approved cap");
  // The plan's baseline pins 188.8 delivery by variant; the shipped-delivery arm is descriptive only.
  assert.deepEqual(
    manifest.jobs.map((job) => job.id),
    ["baseline", "baseline-new-delivery", "write-x", "x"].map((arm) => SCREEN_1889_ARM_IDS[arm]),
  );
  assert.deepEqual(manifest.jobs.find((job) => job.id === SCREEN_1889_ARM_IDS.baseline).ablate, [SCREEN_1889_BASELINE_VARIANT]);
  assert.equal(manifest.jobs.find((job) => job.id === SCREEN_1889_ARM_IDS["baseline-new-delivery"]).ablate, undefined);
  // `fabric-xc` is held out because its write-side cost was never measured, and the manifest says so.
  for (const arm of ["xc", "write-xc", "xc-agentic"])
    assert.ok(manifest.excluded.find((item) => item.arm === arm)?.reason, `${arm} exclusion carries a reason`);
  assert.deepEqual(
    manifest.excluded.map((item) => item.arm),
    ["xc", "write-xc", "xc-agentic"],
  );
  assert.ok(
    manifest.excluded.every((item) => item.reason.length > 20),
    "every exclusion carries its measurement",
  );
  for (const job of manifest.jobs) {
    assert.equal(job.subset, "screen-v1", "the screen never touches a held-out id");
    assert.equal(job.suite, "longmemeval-s");
    assert.equal(job.labelInjections, "off");
  }
  // The full arm set is still valid when nothing is excluded: the agentic arm reuses the `xc` store.
  const full = screenManifest({ excluded: [] });
  assert.equal(assertAcceptance1889ScreenManifest(full), full);
  assert.deepEqual(
    full.jobs.map((job) => job.id),
    SCREEN_1889_ARMS.map((arm) => SCREEN_1889_ARM_IDS[arm.id]),
  );
  assert.equal(full.jobs.find((job) => job.id === SCREEN_1889_ARM_IDS["xc-agentic"]).writeSide, SCREEN_1889_ARM_IDS["write-xc"]);
  assert.throws(
    () =>
      assertAcceptance1889ScreenManifest({
        ...manifest,
        excluded: [...manifest.excluded, { arm: "x", reason: "contradiction" }],
      }),
    /both run and excluded/,
  );
  assert.throws(() => assertAcceptance1889ScreenManifest({ ...manifest, excluded: [{ arm: "nope", reason: "unknown" }] }), /unknown arm/);
  assert.throws(() => assertAcceptance1889ScreenManifest({ ...manifest, excluded: [{ arm: "x" }] }), /needs a reason/);
  // Development ids only: every screen id is in the development pool.
  const development = new Set(Object.values(confirmatory.abilities).flat());
  for (const ids of Object.values(manifest.screen.idsHash ? screenV1.abilities : {}))
    for (const id of ids) assert.ok(development.has(id), `${id} is development data`);
  assert.throws(() => assertAcceptance1889ScreenManifest({ ...manifest, ceiling: 1 }), /ceiling/);
  for (const subset of HELDOUT_SUBSETS)
    assert.throws(
      () => assertAcceptance1889ScreenManifest({ ...manifest, jobs: manifest.jobs.map((job) => ({ ...job, subset })) }),
      /screen draw/,
      `a screen manifest never names ${subset}`,
    );
  assert.throws(() => assertAcceptance1889ScreenManifest({ ...manifest, concurrency: { concurrency: 0 } }), /probed concurrency/);
  assert.throws(() => assertAcceptance1889ScreenManifest({ ...manifest, jobs: manifest.jobs.slice(1) }), /declared arms/);
  // The probe manifest is its own frozen contract: one job per step, development ids, 8 questions.
  const probe = buildAcceptance1889ProbeManifest();
  assert.equal(assertAcceptance1889ProbeManifest(probe), probe);
  assert.deepEqual(
    probe.jobs.map((job) => job.concurrency),
    [4, 8, 16, 24],
  );
  assert.throws(
    () => assertAcceptance1889ProbeManifest({ ...probe, jobs: probe.jobs.map((job) => ({ ...job, maxQuestions: 35 })) }),
    /answer 8 questions/,
  );
});

test("go_no_go_rule_is_applied_from_manifest_not_hand_set", () => {
  const ability = (correct, total = 5) => ({ correct, total });
  const report = (perAbility, { runLimit = 0 } = {}) => ({
    results: Object.entries(perAbility).flatMap(([name, counts], index) =>
      Array.from({ length: counts.total }, (_, question) => ({
        id: `${name}-${index}-${question}`,
        ability: name,
        correct: question < counts.correct,
        outcome: question < runLimit ? "run_limit" : "completed",
      })),
    ),
  });
  const baseline = report({
    "knowledge-update": ability(3),
    "multi-session": ability(3),
    "temporal-reasoning": ability(3),
    "single-session-user": ability(3),
  });
  // +3 questions, no ability loss: both passive arms proceed.
  const gains = report({
    "knowledge-update": ability(4),
    "multi-session": ability(4),
    "temporal-reasoning": ability(4),
    "single-session-user": ability(4),
  });
  // +3 questions but one ability loses 2: dropped.
  const lopsided = report({
    "knowledge-update": ability(5),
    "multi-session": ability(5),
    "temporal-reasoning": ability(5),
    "single-session-user": ability(1),
  });
  // +2 questions: below the +3 rule.
  const small = report({
    "knowledge-update": ability(4),
    "multi-session": ability(3),
    "temporal-reasoning": ability(3),
    "single-session-user": ability(4),
  });
  const agenticOk = report(
    {
      "knowledge-update": ability(3),
      "multi-session": ability(3),
      "temporal-reasoning": ability(3),
      "single-session-user": ability(3),
    },
    { runLimit: 0 },
  );
  const agenticLimited = report(
    {
      "knowledge-update": ability(3),
      "multi-session": ability(3),
      "temporal-reasoning": ability(3),
      "single-session-user": ability(3),
    },
    { runLimit: 5 },
  );

  const verdict = screenVerdict({ baseline, arms: { x: gains, xc: lopsided, "xc-agentic": agenticOk } });
  assert.deepEqual(verdict.rule, { minGainQuestions: 3, maxAbilityLoss: 1, maxRunLimit: 0.05 });
  assert.equal(verdict.baseline.correct, 12);
  assert.equal(verdict.arms.x.gainQuestions, 4);
  assert.equal(verdict.arms.x.proceed, true);
  assert.equal(verdict.arms.xc.gainQuestions, 4);
  assert.equal(verdict.arms.xc.abilityLosses["single-session-user"], 2);
  assert.equal(verdict.arms.xc.proceed, false);
  assert.match(verdict.arms.xc.reason, /worst ability loss 2/);
  assert.equal(verdict.arms["xc-agentic"].runLimitRate, 0);
  assert.equal(verdict.arms["xc-agentic"].proceed, true);
  assert.deepEqual(verdict.proceed, ["x", "xc-agentic"]);

  assert.equal(screenVerdict({ baseline, arms: { x: small } }).arms.x.proceed, false, "+2 questions is not enough");
  assert.equal(screenVerdict({ baseline, arms: { "xc-agentic": agenticLimited } }).arms["xc-agentic"].proceed, false);
  assert.equal(screenArmCounts(agenticLimited).correct, 12);
  // The verdict carries only counts and reasons: no question text, answer or oracle material.
  const record = JSON.stringify(verdict);
  for (const forbidden of ["haystack", "answer", "question-"]) assert.equal(record.includes(forbidden), false);
});

test("concurrency_probe_picks_highest_clean_step", () => {
  const rows = (steps) => steps.map(([concurrency, p95Ms, overloads]) => ({ concurrency, p95Ms, overloads }));
  assert.deepEqual(
    chooseConcurrency(
      rows([
        [4, 100, 0],
        [8, 120, 0],
        [16, 140, 0],
        [24, 145, 0],
      ]),
      { maxConcurrency: 24 },
    ),
    {
      concurrency: 24,
      reason: "highest step with 0 overloads and p95 145ms < 1.5x 100ms",
    },
  );
  // The screen's reservation bound caps the choice at 4 and says why.
  assert.deepEqual(
    chooseConcurrency(
      rows([
        [4, 100, 0],
        [8, 120, 0],
        [16, 140, 0],
        [24, 145, 0],
      ]),
    ),
    {
      concurrency: 4,
      reason: "highest step with 0 overloads and p95 100ms < 1.5x 100ms; capped at 4 by the reservation bound",
    },
  );
  // A row that did not finish measures a broken arm, not latency.
  assert.equal(
    chooseConcurrency([
      { concurrency: 4, p95Ms: 100, overloads: 0, status: "failed" },
      { concurrency: 8, p95Ms: 120, overloads: 0, status: "completed" },
    ]).concurrency,
    1,
    "the only finished step is above the screen's reservation bound, so step 4 is not usable either",
  );
  // Above 1.5x the step-4 p95 the step is out even with no overload.
  assert.equal(
    chooseConcurrency(
      rows([
        [4, 100, 0],
        [8, 120, 0],
        [16, 140, 0],
        [24, 160, 0],
      ]),
      { maxConcurrency: 24 },
    ).concurrency,
    16,
  );
  // 16 overloaded, 24 is slow: the highest clean step is 8.
  assert.equal(
    chooseConcurrency(
      rows([
        [4, 100, 0],
        [8, 120, 0],
        [16, 130, 1],
        [24, 160, 0],
      ]),
      { maxConcurrency: 24 },
    ).concurrency,
    8,
  );
  // Anything above 1.5x the step-4 p95 is out even without an overload.
  assert.equal(
    chooseConcurrency(
      rows([
        [4, 100, 0],
        [8, 200, 0],
        [16, 300, 0],
        [24, 400, 0],
      ]),
    ).concurrency,
    4,
  );
  // Overloads at step 4 do not disqualify a later clean step; only that step's own evidence counts.
  assert.equal(
    chooseConcurrency(
      rows([
        [4, 100, 2],
        [8, 120, 0],
      ]),
      { maxConcurrency: 8 },
    ).concurrency,
    8,
  );
  assert.equal(chooseConcurrency([]).concurrency, 1);
  // Missing p95 rows cannot win.
  assert.equal(
    chooseConcurrency(
      rows([
        [4, 100, 0],
        [8, null, 0],
        [16, 140, 0],
      ]),
      { maxConcurrency: 24 },
    ).concurrency,
    16,
  );
});

/* Plan 188.9 Task 11: held-out manifest, full-context reuse and aggregate-only evidence. */
const acceptanceManifest1889 = (overrides = {}) => {
  const fullReference = {
    ok: true,
    from: ACCEPTANCE_1889_FULL_REPORT,
    inputCap: 870976,
    idsHash: "e".repeat(64),
    protocolHash: null,
    reason: "the full arm sends the whole history and never reaches the delivery code this plan changed",
  };
  return buildAcceptance1889Manifest({
    harnessHash: "a".repeat(64),
    productHash: "b".repeat(64),
    writeSideKey: "c".repeat(64),
    fullReference,
    ...overrides,
  });
};

test("acceptance_188_9_manifest_requires_cap_heldout_ids_and_reuse_fingerprint", () => {
  const manifest = acceptanceManifest1889();
  assert.equal(assertAcceptance1889Manifest(manifest), manifest);
  assert.equal(manifest.ceiling, ACCEPTANCE_1889_CEILING);
  assert.deepEqual(
    manifest.jobs.map((job) => job.id),
    ["baseline", "x", "write-x"].map((arm) => ARM_1889_IDS[arm]),
  );
  assert.deepEqual(manifest.jobs.find((job) => job.id === ARM_1889_IDS.baseline).ablate, [SCREEN_1889_BASELINE_VARIANT]);
  assert.equal(manifest.jobs.find((job) => job.id === ARM_1889_IDS.x).writeSide, ARM_1889_IDS["write-x"]);
  assert.equal(manifest.jobs.find((job) => job.id === ARM_1889_IDS.x).subset, "heldout-v2");
  assert.ok(
    manifest.jobs.every((job) => job.subset === "heldout-v2"),
    "no development id reaches acceptance",
  );
  for (const arm of ["xc", "xc-agentic", "agentic"])
    assert.ok(manifest.unavailable.find((item) => item.arm === arm)?.reason, `${arm} is out of scope with a reason`);
  const readCaps = manifest.jobs.filter((job) => !job.write).reduce((sum, job) => sum + job.maxInputTokens, 0);
  assert.ok(readCaps <= manifest.ceiling, "read caps fit the ceiling");
  assert.throws(() => assertAcceptance1889Manifest({ ...manifest, ceiling: 1 }), /ceiling/);
  assert.throws(() => assertAcceptance1889Manifest({ ...manifest, fullReference: { ok: false, reason: "ids differ" } }), /full reference/);
  assert.throws(
    () => assertAcceptance1889Manifest({ ...manifest, jobs: manifest.jobs.map((job) => ({ ...job, subset: "screen-v1" })) }),
    /heldout-v2/,
  );
  assert.throws(
    () => assertAcceptance1889Manifest({ ...manifest, jobs: manifest.jobs.filter((job) => job.id !== ARM_1889_IDS.x) }),
    /declared arms/,
  );
});

test("full_reference_reuse_checks_only_what_shapes_the_full_arm", async () => {
  const heldout = heldout1888();
  const ids = Object.values(heldout.ids).flat();
  const prior = {
    status: "completed",
    usageComplete: true,
    suite: "longmemeval-s",
    subset: "heldout-v2",
    config: "full",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    generation: { temperature: 0, maxTokens: 4096 },
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    judgeProtocol: "enum-json-v1",
    inputCap: 870976,
    results: ids.map((id) => ({ id })),
  };
  assert.equal((await fullReferenceReuse1889(prior, heldout)).ok, true);
  assert.equal((await fullReferenceReuse1889({ ...prior, model: "other" }, heldout)).ok, false);
  assert.equal((await fullReferenceReuse1889({ ...prior, generation: { temperature: 0, maxTokens: 2048 } }, heldout)).ok, false);
  assert.equal((await fullReferenceReuse1889({ ...prior, results: prior.results.slice(0, 99) }, heldout)).ok, false);
  assert.equal((await fullReferenceReuse1889({ ...prior, status: "partial" }, heldout)).ok, false);
  assert.equal((await fullReferenceReuse1889({ ...prior, config: "fabric" }, heldout)).ok, false);
});

test("write_side_cost_reported_per_session_and_per_question", () => {
  // The product cost is per stored session; the benchmark cost is per question. Never folded.
  const cost = writeCostOf({
    inputTokens: 417437,
    results: [{ ingest: { sessions: 30, consolidationFailures: 2 } }, { ingest: { sessions: 21, consolidationFailures: 1 } }],
  });
  assert.equal(cost.sessions, 51);
  assert.equal(cost.perSession, Math.round(417437 / 51));
  assert.equal(cost.perQuestion, Math.round(417437 / 2));
  assert.equal(cost.failedConsolidations, 3);
  assert.equal(writeCostOf(null), null);
});

/* Plan 188.10 Task 9: held-out v3 acceptance of Stage A's selected configuration. */
const STAGE_A_VERDICT = {
  kind: "188.10-stage-a-verdict",
  selected: "x-tools",
  next: { skipStageB: true, heldoutArm: "x-tools" },
};
const ACCEPTANCE_MANIFEST_18810 = (overrides = {}) =>
  buildAcceptance18810Manifest({
    harnessHash: "a".repeat(64),
    product: { hash: "b".repeat(64), stageAHash: "b".repeat(64) },
    selection: { arm: "x-tools", skipStageB: true, path: "verdict.json", fileHash: "c".repeat(64) },
    writeSideKey: "d".repeat(64),
    ...overrides,
  });

test("acceptance_188_10_manifest_requires_v3_selected_arm_and_full", () => {
  const manifest = ACCEPTANCE_MANIFEST_18810();
  assert.equal(assertAcceptance18810Manifest(manifest), manifest);
  assert.equal(manifest.kind, "188.10-heldout-acceptance");
  assert.equal(manifest.heldoutV3.subset, ACCEPTANCE_18810_SUBSET);
  assert.deepEqual(manifest.heldoutV3.counts, {
    "multi-session": 40,
    "knowledge-update": 20,
    "temporal-reasoning": 20,
    "single-session-user": 14,
    "single-session-assistant": 6,
  });
  assert.equal(manifest.heldoutV3.screenOverlap, 0, "no development id reaches the held-out draw");
  assert.deepEqual(
    manifest.jobs.map((job) => job.id),
    ["write-x", "x", "x-tools", "full"].map((arm) => `accept18810-${arm}`),
  );
  assert.ok(manifest.jobs.every((job) => job.subset === "heldout-v3" && job.suite === "longmemeval-s"));
  assert.ok(
    manifest.jobs.every((job) => job.labelInjections === "on"),
    "a held-out report keeps injection precision",
  );
  assert.equal(manifest.protocolVersion, ACCEPTANCE_1888_PROTOCOL_VERSION);
  for (const [mutate, message] of [
    [(item) => (item.heldoutV3.idsHash = "f".repeat(64)), /differ from the frozen draw/],
    [(item) => (item.heldoutV3.counts["multi-session"] = 30), /needs 40 ids/],
    [(item) => item.jobs.pop(), /exactly its declared arms/],
    [(item) => (item.jobs[3].subset = "heldout-v2"), /must run heldout-v3/],
    [(item) => (item.jobs[1].labelInjections = "off"), /keeps its injection labels/],
    [(item) => (item.selection.arm = "x"), /selected `x-tools` arm/],
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => assertAcceptance18810Manifest(copy), message);
  }
});

test("acceptance_188_10_selection_comes_from_stage_a_verdict", () => {
  const hash = (value) => value;
  assert.deepEqual(stageASelection(STAGE_A_VERDICT, { path: "v.json", fileHash: hash("x") }), {
    arm: "x-tools",
    skipStageB: true,
    path: "v.json",
    fileHash: "x",
  });
  assert.throws(() => stageASelection(null), /verdict is missing/);
  assert.throws(() => stageASelection({ kind: "other", selected: "x-tools" }), /not the Stage A verdict/);
  assert.throws(() => stageASelection({ ...STAGE_A_VERDICT, selected: null }, { fileHash: "x" }), /selected nothing/);
  assert.throws(() => stageASelection({ ...STAGE_A_VERDICT, selected: "x" }, { fileHash: "x" }), /must be `x-tools`/);
  assert.throws(
    () => stageASelection({ ...STAGE_A_VERDICT, next: { skipStageB: false, heldoutArm: "x-tools" } }, { fileHash: "x" }),
    /did not skip Stage B/,
  );
  assert.throws(
    () => stageASelection({ ...STAGE_A_VERDICT, next: { skipStageB: true, heldoutArm: "x" } }, { fileHash: "x" }),
    /disagrees with its selection/,
  );
  assert.throws(() => stageASelection(STAGE_A_VERDICT), /needs its file hash/);
});

test("acceptance_188_10_manifest_splits_writer_from_readers", () => {
  const manifest = ACCEPTANCE_MANIFEST_18810();
  const writer = manifest.jobs.find((job) => job.id === "accept18810-write-x");
  assert.equal(writer.write, true, "the writer is the only job that writes");
  assert.equal(writer.writeSide, undefined);
  assert.deepEqual(
    manifest.jobs.filter((job) => job.writeSide).map((job) => [job.id, job.writeSide]),
    [
      ["accept18810-x", "accept18810-write-x"],
      ["accept18810-x-tools", "accept18810-write-x"],
    ],
    "both memory readers share one exchange snapshot",
  );
  assert.equal(manifest.jobs.find((job) => job.id === "accept18810-full").writeSide, undefined);
  const writeOnly = structuredClone(manifest);
  delete writeOnly.jobs.find((job) => job.id === "accept18810-write-x").write;
  assert.throws(() => assertAcceptance18810Manifest(writeOnly), /needs its `fabric-x` writer/);
  const scoredWriter = structuredClone(manifest);
  scoredWriter.jobs.find((job) => job.id === "accept18810-write-x").writeSide = "accept18810-write-x";
  assert.throws(() => assertAcceptance18810Manifest(scoredWriter), /cannot also read a snapshot/);
  const split = structuredClone(manifest);
  split.jobs.find((job) => job.id === "accept18810-x-tools").writeSide = "accept18810-x";
  assert.throws(() => assertAcceptance18810Manifest(split), /must reuse the `fabric-x` snapshot/);
});

test("acceptance_188_10_manifest_has_no_xc_job_on_stage_a_path", () => {
  const manifest = ACCEPTANCE_MANIFEST_18810();
  assert.ok(!manifest.jobs.some((job) => job.config.startsWith("fabric-xc")), "no `xc` arm was selected");
  assert.ok(!manifest.jobs.some((job) => job.id.includes("xc")));
  const xc = structuredClone(manifest);
  xc.jobs[2] = { ...xc.jobs[2], config: "fabric-xc-tools" };
  assert.throws(() => assertAcceptance18810Manifest(xc), /no `xc` job/);
});

test("acceptance_188_10_ceiling_fits_gate_1_remainder", () => {
  const manifest = ACCEPTANCE_MANIFEST_18810();
  assert.equal(manifest.ceiling, ACCEPTANCE_18810_CEILING);
  assert.equal(manifest.priorReservation, ACCEPTANCE_18810_PRIOR_RESERVATION);
  assert.ok(manifest.priorReservation + manifest.ceiling <= GATE_1_CAP, "gate 1 still covers the held-out run");
  const reads = manifest.jobs.filter((job) => !job.write).reduce((sum, job) => sum + job.maxInputTokens, 0);
  assert.equal(reads, manifest.ceiling, "the ceiling is the read caps' sum");
  assert.throws(() => assertAcceptance18810Manifest({ ...manifest, ceiling: 40_000_000 }), /ceiling must be/);
  assert.throws(() => assertAcceptance18810Manifest({ ...manifest, priorReservation: 0, ceiling: 34_000_001 }), /ceiling must be 20000000/);
  // A different prior use or gate cannot fit the same ceiling silently.
  assert.throws(() => assertAcceptance18810Manifest({ ...manifest, priorReservation: 4_000_001 }), /prior use is/);
  assert.throws(
    () => assertAcceptance18810Manifest({ ...manifest, gate: { ...manifest.gate, cap: 30_000_000 } }),
    /cap must be the approved/,
  );
  for (const [arm, cap] of [
    ["x", 1_000_001],
    ["x-tools", 5_000_001],
    ["full", 14_000_001],
  ]) {
    const copy = structuredClone(manifest);
    const job = copy.jobs.find((item) => item.id === `accept18810-${arm}`);
    job.maxInputTokens = cap;
    copy.ceiling = ACCEPTANCE_18810_CEILING + cap;
    copy.ceiling = ACCEPTANCE_18810_CEILING;
    assert.throws(() => assertAcceptance18810Manifest(copy), /cap exceeds/);
  }
});

test("acceptance_188_10_refuses_product_drift_from_stage_a", () => {
  const stageA = { productHash: "b".repeat(64) };
  assert.deepEqual(frozenProduct({ productHash: "b".repeat(64), stageAManifest: stageA }), {
    hash: "b".repeat(64),
    stageAHash: "b".repeat(64),
  });
  assert.throws(() => frozenProduct({ productHash: "e".repeat(64), stageAManifest: stageA }), /product changed since Stage A/);
  assert.throws(() => frozenProduct({ productHash: "b".repeat(64), stageAManifest: {} }), /no product hash/);
  assert.throws(() => frozenProduct({ stageAManifest: stageA }), /current product hash/);
  const drifted = structuredClone(ACCEPTANCE_MANIFEST_18810());
  drifted.product.hash = "e".repeat(64);
  assert.throws(() => assertAcceptance18810Manifest(drifted), /not frozen at Stage A's selection/);
});

test("multi_session_target_and_non_regression_are_pre_registered", () => {
  const manifest = ACCEPTANCE_MANIFEST_18810();
  assert.deepEqual(manifest.criteria, ACCEPTANCE_18810_CRITERIA);
  assert.equal(manifest.criteria.multiSessionCorrect, 24);
  assert.equal(manifest.criteria.multiSessionTotal, 40);
  assert.deepEqual(manifest.criteria.maxAbilityLoss, {
    "knowledge-update": 2,
    "temporal-reasoning": 2,
    "single-session-user": 1,
    "single-session-assistant": 1,
  });
  for (const [mutate, message] of [
    [(item) => (item.criteria.multiSessionCorrect = 20), /fix multiSessionCorrect/],
    [(item) => (item.criteria.maxAbilityLoss["knowledge-update"] = 5), /fix maxAbilityLoss/],
    [(item) => (item.criteria.minOverallDiff = -0.1), /fix minOverallDiff/],
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => assertAcceptance18810Manifest(copy), message);
  }
});

test("heldout_v3_unreadable_until_campaign", async () => {
  // The diagnostic reads gold evidence, so it refuses the live draw before touching a store.
  await assert.rejects(() => multiSessionDiagnostic({ subset: "heldout-v3", storeFrom: "/nonexistent" }), /refuse the held-out v3 draw/);
  // A screen profile refuses it too, and the held-out subset list is the one guard both use.
  assert.ok(HELDOUT_SUBSETS.includes(ACCEPTANCE_18810_SUBSET));
  const draw = heldoutV3Draw();
  assert.equal(draw.screenOverlap, 0);
  assert.equal(draw.idsHash.length, 64);
});

test("success_verdict_requires_all_primary_criteria", () => {
  const reference = stageAReport({
    "multi-session": { correct: 14, total: 40 },
    "knowledge-update": { correct: 12, total: 20 },
    "temporal-reasoning": { correct: 12, total: 20 },
    "single-session-user": { correct: 10, total: 14 },
    "single-session-assistant": { correct: 4, total: 6 },
  });
  const arm = (multiSession, overrides = {}) =>
    stageAReport({
      "multi-session": { correct: multiSession, total: 40 },
      "knowledge-update": { correct: 12, total: 20 },
      "temporal-reasoning": { correct: 12, total: 20 },
      "single-session-user": { correct: 10, total: 14 },
      "single-session-assistant": { correct: 4, total: 6 },
      ...overrides,
    });
  const improvement = (diff, low) => ({
    "multi-session": { diff, ci95: [low, low + 0.2] },
    overall: { diff: diff >= 0 ? diff : diff },
  });
  const met = acceptance18810Verdict({ reference, arm: arm(30), comparison: improvement(0.4, 0.15) });
  assert.equal(met.met, true, met.reason);
  assert.equal(met.multiSessionSuccess, true);
  assert.deepEqual(
    met.checks.map((check) => check.id),
    ["multi-session-absolute", "multi-session-paired-improvement", "non-regression"],
  );

  const belowTarget = acceptance18810Verdict({ reference, arm: arm(23), comparison: improvement(0.2, 0.02) });
  assert.equal(belowTarget.met, false);
  assert.match(belowTarget.reason, /multi-session 23\/40, target 24\/40/);

  // A positive diff whose CI straddles zero is not an improvement.
  const unclear = acceptance18810Verdict({ reference, arm: arm(26), comparison: improvement(0.3, -0.01) });
  assert.equal(unclear.met, false);
  assert.match(unclear.reason, /multi-session-paired-improvement/);

  // Knowledge-update may lose two, not three; the overall difference may not go negative.
  const regressed = acceptance18810Verdict({
    reference,
    arm: arm(30, { "knowledge-update": { correct: 9, total: 20 } }),
    comparison: improvement(0.2, 0.05),
  });
  assert.equal(regressed.met, false);
  assert.match(regressed.reason, /knowledge-update lost 3 > 2/);
  const overallDown = acceptance18810Verdict({
    reference,
    arm: arm(30),
    comparison: { ...improvement(0.2, 0.05), overall: { diff: -0.01 } },
  });
  assert.equal(overallDown.met, false);
  assert.match(overallDown.reason, /overall paired diff -0.0100/);

  // A missing comparison cannot pass.
  const missing = acceptance18810Verdict({ reference, arm: arm(30) });
  assert.equal(missing.met, false);
  assert.match(missing.reason, /no paired multi-session comparison/);
  assert.throws(() => acceptance18810Verdict({ arm: arm(30) }), /needs both/);
});

test("evidence_contains_no_text_or_oracle_material", async () => {
  // The manifest is ids, hashes, counts and criteria: no question, answer or label text.
  const manifest = ACCEPTANCE_MANIFEST_18810();
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"question"|"answer"|"text"|"prompt"|"gold"/);
  const dir = await mkdtemp(join(tmpdir(), "accept18810-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const saved = JSON.parse(await Bun.file(join(dir, "manifest.json")).text());
  assert.equal(saved.heldoutV3.idsHash, manifest.heldoutV3.idsHash);
  assert.deepEqual(Object.keys(saved.heldoutV3.counts).sort(), Object.keys(manifest.heldoutV3.counts).sort());
});
