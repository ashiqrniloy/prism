import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertCleanupCriteriaPin,
  CLEANUP_CRITERIA,
  cleanupCriteriaHash,
  cleanupManifestPin,
  cleanupVerdict,
  robustnessCriteriaHash,
  verifyCleanupCriteria,
} from "./robustness.mjs";

const repo = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const files = () => ({
  gapPredictions: repo("docs/_evidence/memory-bench/210/gap-predictions.json"),
  plan202Task5: repo("docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json"),
  ledger: repo("docs/_evidence/memory-bench/210/feature-ledger.json"),
});
const edited = (edit) => {
  const copy = structuredClone(CLEANUP_CRITERIA);
  edit(copy);
  return copy;
};

test("cleanup_criteria_hash_pinned_by_manifests", () => {
  const hash = verifyCleanupCriteria();
  assert.equal(hash, cleanupCriteriaHash());
  assert.notEqual(cleanupCriteriaHash({ ...CLEANUP_CRITERIA, frozen: "2000-01-01" }), hash);
  const pin = cleanupManifestPin();
  assert.deepEqual(pin, { criteriaHash: robustnessCriteriaHash(), cleanupCriteriaHash: hash });
  assertCleanupCriteriaPin({ ...pin, arms: [] });
  assert.throws(() => assertCleanupCriteriaPin({ criteriaHash: pin.criteriaHash }), /does not pin/);
  assert.throws(() => assertCleanupCriteriaPin({ ...pin, cleanupCriteriaHash: "0".repeat(64) }), /pins a different/);
  assert.throws(() => assertCleanupCriteriaPin({ ...pin, criteriaHash: "0".repeat(64) }), /different robustness criteria/);

  // Drift in anything the file pins is refused.
  const changed = files();
  changed.gapPredictions.predictions[0].predicted = "anything";
  assert.throws(() => verifyCleanupCriteria(CLEANUP_CRITERIA, changed), /Task 3 predictions changed/);
  const task5 = files();
  task5.plan202Task5.criteriaHash = "0".repeat(64);
  assert.throws(() => verifyCleanupCriteria(CLEANUP_CRITERIA, task5), /202 Task 5 frozen criteria changed/);
  const leg = files();
  leg.gapPredictions.deferred[0].protocol += " and more";
  assert.throws(() => verifyCleanupCriteria(CLEANUP_CRITERIA, leg), /protocol or rule drifted/);
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => (c.pins.workOutcomeCriteriaHash = "0".repeat(64))),
        files(),
      ),
    /work-outcome criteria changed/,
  );
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => c.partitions.reads.push("heldout-a")),
        files(),
      ),
    /development partitions only/,
  );

  // Every no-credible-path row has a removal route; an inert route on a preset member is refused.
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => c.inertRemoval.features.pop()),
        files(),
      ),
    /no-credible-path row kind\.episode has no removal route/,
  );
  const member = files();
  member.ledger.features.find((row) => row.id === "retrieval.hybrid").presets.conversational = "member";
  assert.throws(() => verifyCleanupCriteria(CLEANUP_CRITERIA, member), /retrieval\.hybrid is a preset member/);
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => c.inertRemoval.features.push("retrieval.lexical")),
        files(),
      ),
    /retrieval\.lexical is not a no-credible-path row/,
  );
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => (c.preRegistered.maintainThenAnswer.arm = "none")),
        files(),
      ),
    /maintain-then-answer arm/,
  );
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => (c.preRegistered.weakHitsBelowFloor.status = "built")),
        files(),
      ),
    /weak-hits variant/,
  );
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => (c.rules.fixKept.secondTry = true)),
        files(),
      ),
    /no second try/,
  );
});

test("negative_feature_always_removed_by_rules", () => {
  const strong = {
    feature: "recall.gather",
    status: "benefit",
    benefit: [{ ciLow: 4 }],
    fix: { real: true, measured: true, directionMet: true, ciLow: 3 },
    cost: { relativeReduction: 0.5, accuracyCiLow: 0 },
  };
  for (const negative of [
    { status: "negative" },
    { safetyFailure: true },
    { abilities: [{ ciHigh: 1 }, { ciHigh: -0.5 }] },
    { status: "safety-proven", safetyFailure: true },
    { ownerHold: { reason: "the owner wants it" }, abilities: [{ ciHigh: -1 }] },
  ]) {
    const verdict = cleanupVerdict({ ...strong, ...negative });
    assert.equal(verdict.verdict, "remove");
    assert.equal(verdict.tier, "removed");
    assert.equal(verdict.reason, "negative");
  }
  // Without the negative signal the same evidence keeps the fix.
  assert.equal(cleanupVerdict(strong).verdict, "fix-kept");
});

test("owner_hold_routes_to_experimental_tier", () => {
  const removable = {
    feature: "workers.linker",
    status: "unmeasured",
    removal: { inert: true, byteIdentical: true },
  };
  assert.deepEqual(cleanupVerdict(removable), {
    feature: "workers.linker",
    verdict: "remove",
    tier: "removed",
    reason: "removal non-inferior",
  });
  const held = cleanupVerdict({ ...removable, ownerHold: { reason: "hosts depend on it" } });
  assert.equal(held.verdict, "owner-hold");
  assert.equal(held.tier, "experimental");
  assert.throws(() => cleanupVerdict({ ...removable, ownerHold: { reason: " " } }), /needs a written reason/);

  // Unshown non-inferiority is inconclusive: experimental, never stable, holdable with a reason.
  const unshown = cleanupVerdict({
    feature: "scope.path",
    status: "unmeasured",
    removal: { suites: [{ ciLow: -3 }], workOutcomeNonInferior: true },
  });
  assert.equal(unshown.verdict, "inconclusive");
  assert.equal(unshown.tier, "experimental");
  assert.equal(cleanupVerdict({ feature: "scope.path", status: "unmeasured", removal: null }).verdict, "inconclusive");
  assert.equal(cleanupVerdict({ feature: "scope.path", ownerHold: { reason: "r" } }).tier, "experimental");

  // A missed fix gets no second try and a kept feature needs no hold.
  assert.equal(cleanupVerdict({ ...removable, fix: { real: true, measured: true, directionMet: false, ciLow: 2 } }).verdict, "remove");
  assert.equal(cleanupVerdict({ feature: "safety.redaction", status: "safety-proven" }).verdict, "keep");
  assert.equal(cleanupVerdict({ feature: "x", cost: { relativeReduction: 0.12, accuracyCiLow: -1.5 } }).reason, "cost or latency");
  assert.equal(cleanupVerdict({ feature: "x", cost: { relativeReduction: 0.12, accuracyCiLow: -2.5 } }).verdict, "inconclusive");
  // Removal of a non-inert feature also needs the work-outcome rows.
  const measured = { feature: "write.keyword-enrichment", removal: { suites: [{ ciLow: -1 }], workOutcomeNonInferior: true } };
  assert.equal(cleanupVerdict(measured).verdict, "remove");
  assert.equal(cleanupVerdict({ ...measured, removal: { ...measured.removal, workOutcomeNonInferior: false } }).verdict, "inconclusive");
  // A plan 202 Task 5 feature is kept on benefit only with a pass of the pinned Task 5 rules.
  assert.equal(cleanupVerdict({ ...measured, benefit: [{ ciLow: 2 }] }).verdict, "remove");
  assert.equal(cleanupVerdict({ ...measured, benefit: [{ ciLow: 2 }], plan202Task5Pass: true }).verdict, "keep");
  assert.equal(cleanupVerdict({ feature: "recall.gather", benefit: [{ ciLow: 2 }] }).verdict, "keep");
  assert.throws(
    () =>
      verifyCleanupCriteria(
        edited((c) => c.rules.keep.plan202Task5.features.pop()),
        files(),
      ),
    /navigation\.agentic-lexical must carry/,
  );
});
