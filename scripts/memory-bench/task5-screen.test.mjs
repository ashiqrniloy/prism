import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableHash } from "./journal.mjs";
import {
  assertTask5ComparisonManifest,
  assertTask5ScopeReduction,
  assertTask5ScreenManifest,
  buildTask5ScreenManifest,
  computeTask5ScreenVerdict,
  reduceTask5Manifest,
  TASK5_ABILITY_MARGIN,
  TASK5_HALVING_FACTOR,
  TASK5_MANIFEST,
  TASK5_SCREEN_BEAM_1M_WALL_HOURS,
  TASK5_SCREEN_HANDOFF_REASON,
  TASK5_SCREEN_MANIFEST,
  TASK5_SCREEN_SUITES,
  TASK5_SCREEN_VERDICT_JSON,
  TASK5_SCREEN_VERDICT_MD,
  TASK5_SCREEN_VERSION,
  task5AbilityGuard,
  task5Beam1mSlice,
  task5CandidateGap,
  task5ManifestHash,
  task5ScreenCriteria,
  writeTask5ScreenVerdict,
} from "./task5-comparison.mjs";
import { assertTask5ScreenJournalFresh } from "./task5-execute.mjs";

const full = JSON.parse(await readFile(TASK5_MANIFEST, "utf8"));
const reduce = (value = full) => reduceTask5Manifest(value, { generatedAt: "2026-11-01T00:00:00.000Z" });
const refreeze = (value) => {
  value.manifestHash = task5ManifestHash(value);
  return value;
};
const beam1m = (manifest) => manifest.cells.find((cell) => cell.suite === "beam-1m" && cell.role === "control");
const conversations = (ids) => [...new Set(ids.map((id) => Number(id.split(":")[0])))].sort((a, b) => a - b);

test("task5_screen_selects_beam1m_slice_from_cohort_ids_only", () => {
  const ids = beam1m(full).questionIds;
  assert.deepEqual(conversations(task5Beam1mSlice(ids)), [10, 12, 15, 25]);
  assert.equal(task5Beam1mSlice(ids).length, 14);
  // The slice keeps cohort order and is stable, so two runs cannot differ by a map iteration.
  assert.deepEqual(task5Beam1mSlice(ids), task5Beam1mSlice([...ids]));
  // A tie is broken by ascending numeric conversation id, not by string order ("10" < "9" is false).
  const ties = ["9:a:0", "10:a:0", "2:a:0", "11:a:0"];
  assert.deepEqual(task5Beam1mSlice(ties, 3), ["9:a:0", "10:a:0", "2:a:0"]);
  // Reports and journals are not cohort ids and are refused, never used as a selection input.
  assert.throws(() => task5Beam1mSlice({ report: ids }), /never a report or journal/);
  assert.throws(() => task5Beam1mSlice([{ hitCount: 4 }]), /never a report or journal/);
});

test("task5_scope_reduction_refuses_any_other_drift", () => {
  const screen = reduce();
  assert.doesNotThrow(() => assertTask5ScopeReduction(full, screen));
  assert.deepEqual(screen.coverage.applicableSuites, TASK5_SCREEN_SUITES);
  assert.ok(!screen.coverage.applicableSuites.includes("longmemeval-m"), "LongMemEval-M is deferred to plan 210");
  assert.equal(beam1m(screen).questions, 14);
  assert.equal(beam1m(screen).wallTimeCapHours, TASK5_SCREEN_BEAM_1M_WALL_HOURS);

  const refused = (mutate, pattern) => {
    const changed = structuredClone(screen);
    mutate(changed);
    assert.throws(() => assertTask5ScopeReduction(full, refreeze(changed)), pattern);
  };
  refused((value) => (value.models.judges[0] = "openrouter/other:free"), /judges|models/);
  refused((value) => (value.models.answers[0] = "openrouter/other:free"), /models/);
  refused((value) => (value.criteria.abilityGuard.margin = 0.1), /criteria moved|ability guard/);
  refused((value) => (value.criteria.candidateGap.halving = "candidateGap <= 0.75 * controlGap"), /criteria moved/);
  refused((value) => (value.product.control.productHash = "0".repeat(64)), /control pin moved/);
  refused((value) => (value.product.candidate.productHash = "1".repeat(64)), /candidate product moved/);
  refused((value) => (value.budgets.perCell.maxInputTokensReservation += 1), /per-cell budgets changed/);
  refused((value) => (value.budgets.campaign.maxPhysicalCalls += 1), /campaign maxPhysicalCalls moved/);
  refused((value) => {
    value.cells[0].questionIds.pop();
    value.cells[0].idsHash = stableHash(value.cells[0].questionIds);
  }, /not the frozen screen cohort/);
  refused((value) => value.coverage.applicableSuites.push("longmemeval-s"), /disposition's suites|not in the full cohort/);
  refused((value) => value.cells.pop(), /cells outside its four suites/);
  // A hand-edited manifest that still recomputes its own hash is refused: the reduction is the only source.
  refused((value) => (value.cells[2].maxInputTokens += 500_000), /not the reduction|shared budget/);
  // Removing a suite and applying the beam-1m rule are the allowed moves, not a re-freeze.
  const reduced = reduce();
  assert.ok(reduced.cells.length < full.cells.length);
  assert.ok(!reduced.cells.some((cell) => cell.suite === "longmemeval-m"));
  // Reducing a screen again (the execution re-freeze path) is idempotent, not a second reduction.
  assert.deepEqual(reduce(reduced), reduced);
});

test("task5_screen_ability_guard_is_descriptive_not_a_veto", () => {
  const screen = reduce();
  assert.equal(screen.criteria.version, TASK5_SCREEN_VERSION);
  assert.equal(screen.criteria.abilityGuard.role, "descriptive");
  // Metric, margin, uncertainty and multiplicity text are carried verbatim, so the rows stay reportable.
  for (const key of ["metric", "margin", "rule", "uncertainty", "multiplicity", "missing"])
    assert.deepEqual(screen.criteria.abilityGuard[key], full.criteria.abilityGuard[key]);
  assert.deepEqual(screen.criteria.candidateGap, full.criteria.candidateGap, "the candidate-gap gate is unchanged");
  assert.equal(screen.criteriaHash, stableHash(screen.criteria));
  assert.equal(screen.evidenceProtocol.criteriaHash, screen.criteriaHash);
  // The guard reports a regressed stratum; it does not become a veto in this manifest.
  const criteria = task5ScreenCriteria(full.criteria);
  assert.equal(criteria.abilityGuard.role, "descriptive");
  assert.equal(full.criteria.abilityGuard.role, undefined, "the full target's veto is not relabelled");
  // The screen and the full target remain different criteria versions, so one cannot be scored as the other.
  assert.notEqual(screen.criteria.version, full.criteria.version);
  assert.doesNotThrow(() => assertTask5ScreenManifest(screen, full));
});

test("task5_screen_gate_refuses_gate11_report_reuse", () => {
  const screen = reduce();
  const journal = {
    campaignId: "campaign-superseded",
    status: "quota-daily",
    manifestHash: full.stopResume.manifestFingerprint,
    attempts: [{ attemptId: "a@1", manifestHash: full.stopResume.manifestFingerprint, status: "completed" }],
  };
  assert.throws(() => assertTask5ScreenJournalFresh(journal, screen), /superseded gate/);
  // A screen attempt from the screen's own identity is a resume, not reuse.
  const fresh = {
    campaignId: "campaign-screen",
    status: "quota-daily",
    manifestHash: screen.stopResume.manifestFingerprint,
    attempts: [{ attemptId: "a@1", manifestHash: screen.stopResume.manifestFingerprint, status: "completed" }],
  };
  assert.equal(assertTask5ScreenJournalFresh(fresh, screen), fresh);
  // A screen journal carrying one gate-11 attempt is refused even when its own identity matches.
  const mixed = structuredClone(fresh);
  mixed.attempts.push({ attemptId: "b@1", manifestHash: full.stopResume.manifestFingerprint });
  assert.throws(() => assertTask5ScreenJournalFresh(mixed, screen), /superseded gate/);
});

test("task5_screen_manifest_is_written_from_the_full_one_and_audits_itself", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-task5-screen-"));
  await mkdir(join(root, "docs/_evidence/memory-bench/202/task5"), { recursive: true });
  await writeFile(join(root, TASK5_MANIFEST), `${JSON.stringify(full, null, 2)}\n`);
  const screen = await buildTask5ScreenManifest({ root, generatedAt: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(screen, reduce());
  // The execution re-freeze re-pins the harness on the same scope and still passes the reduction guard.
  const repinned = reduceTask5Manifest(full, {
    generatedAt: "2026-11-01T00:00:00.000Z",
    product: { ...full.product, harnessHash: "a".repeat(64), candidate: { ...full.product.candidate, revision: "b".repeat(40) } },
  });
  assert.doesNotThrow(() => assertTask5ScopeReduction(screen, repinned));
  assert.notEqual(repinned.manifestHash, screen.manifestHash);
  assert.equal(screen.manifestHash, task5ManifestHash(screen));
  assert.notEqual(screen.manifestHash, full.manifestHash);
  assert.notEqual(screen.stopResume.manifestFingerprint, full.stopResume.manifestFingerprint, "the screen opens a new journal");
  // The full proposal's own structural rules are not weakened by the screen mode.
  assert.throws(() => assertTask5ComparisonManifest(screen), /every applicable suite|applicable suites drifted|applicable Task-5 suite/);
  assert.equal(TASK5_SCREEN_MANIFEST.endsWith("development-screen-manifest.json"), true);
});

function makeMockResult({ id, ability, cluster, correct = true, outcome = "scored", needed = 2, candidateGap = false }) {
  return {
    id,
    ability,
    cluster: cluster ?? `cluster-${id.split(":")[0]}`,
    outcome,
    correct,
    evidenceCounts: {
      fineRounds: needed,
      toolSurfacing: {
        rounds: Array.from({ length: needed }, (_, i) => ({ id: `r${i}`, surfaced: !candidateGap })),
        needed,
        neverSurfaced: candidateGap ? 1 : 0,
        candidateGap,
      },
    },
  };
}

test("task5_verdict_requires_halved_gap_in_every_applicable_suite", async () => {
  // Unit test on mock suites
  // Suite 1: passes (control gap 4/5 = 80%, candidate gap 2/5 = 40%, ratio 0.50 <= 0.50)
  const cPass = [
    makeMockResult({ id: "1:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "2:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "3:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "4:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "5:a:0", ability: "a", candidateGap: false }),
  ];
  const tPass = [
    makeMockResult({ id: "1:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "2:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "3:a:0", ability: "a", candidateGap: false }),
    makeMockResult({ id: "4:a:0", ability: "a", candidateGap: false }),
    makeMockResult({ id: "5:a:0", ability: "a", candidateGap: false }),
  ];
  const gapPass = task5CandidateGap(cPass, tPass, { suite: "suite-pass" });
  assert.equal(gapPass.passed, true);
  assert.equal(gapPass.ratio, 0.5);
  assert.equal(gapPass.verdict, "pass");

  // Suite 2: misses (control gap 4/5 = 80%, candidate gap 3/5 = 60%, ratio 0.75 > 0.50)
  const tMiss = [
    makeMockResult({ id: "1:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "2:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "3:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "4:a:0", ability: "a", candidateGap: false }),
    makeMockResult({ id: "5:a:0", ability: "a", candidateGap: false }),
  ];
  const gapMiss = task5CandidateGap(cPass, tMiss, { suite: "suite-miss" });
  assert.equal(gapMiss.passed, false);
  assert.ok(Math.abs(gapMiss.ratio - 0.75) < 1e-6);
  assert.equal(gapMiss.verdict, "miss");

  // Zero-gap baseline rule: control gap 0 requires candidate gap 0
  const cZero = [makeMockResult({ id: "1:a:0", ability: "a", candidateGap: false })];
  const tZero = [makeMockResult({ id: "1:a:0", ability: "a", candidateGap: false })];
  const tNonZero = [makeMockResult({ id: "1:a:0", ability: "a", candidateGap: true })];
  assert.equal(task5CandidateGap(cZero, tZero).verdict, "pass");
  assert.equal(task5CandidateGap(cZero, tNonZero).verdict, "miss");

  // Integration check on actual recorded screen verdict
  const verdict = await computeTask5ScreenVerdict();
  assert.equal(verdict.screenVerdict, "miss");
  assert.equal(verdict.suites["beam-100k"].candidateGap.verdict, "miss");
  assert.ok(verdict.suites["beam-100k"].candidateGap.ratio > TASK5_HALVING_FACTOR);
  assert.equal(verdict.suites.locomo.candidateGap.verdict, "miss");
  assert.ok(verdict.suites.locomo.candidateGap.ratio > TASK5_HALVING_FACTOR);
  assert.equal(verdict.suites["beam-1m"].candidateGap.verdict, "miss");
  assert.ok(verdict.suites["beam-1m"].candidateGap.ratio > TASK5_HALVING_FACTOR);
  assert.equal(verdict.suites["memoryagentbench-cr"].candidateGap.verdict, "inconclusive");
});

test("task5_screen_reports_ability_regression_and_missing_evidence_without_veto", async () => {
  // Mock suite where candidate gap passes, but ability regresses
  const cRows = [
    makeMockResult({ id: "1:a:0", ability: "a", correct: true, candidateGap: true }),
    makeMockResult({ id: "2:a:0", ability: "a", correct: true, candidateGap: true }),
    makeMockResult({ id: "3:a:0", ability: "a", correct: true, candidateGap: true }),
    makeMockResult({ id: "4:a:0", ability: "a", correct: true, candidateGap: true }),
  ];
  const tRows = [
    // Candidate halved the gap (0/4 vs 4/4)
    // But correctness regressed from 4/4 (100%) to 1/4 (25%) -> diff -75% < -3% margin
    makeMockResult({ id: "1:a:0", ability: "a", correct: true, candidateGap: false }),
    makeMockResult({ id: "2:a:0", ability: "a", correct: false, candidateGap: false }),
    makeMockResult({ id: "3:a:0", ability: "a", correct: false, candidateGap: false }),
    makeMockResult({ id: "4:a:0", ability: "a", correct: false, candidateGap: false }),
  ];

  const cohortAbilities = { a: 4, b_missing: 2 };
  const descriptiveGuard = task5AbilityGuard(cRows, tRows, { cohortAbilities, descriptive: true });
  assert.equal(descriptiveGuard.role, "descriptive");
  assert.deepEqual(descriptiveGuard.regressions, ["a"]);
  assert.deepEqual(descriptiveGuard.unverifiedStrata, ["b_missing"]);
  assert.equal(descriptiveGuard.passed, false);
  assert.ok(descriptiveGuard.strata.a.diff < -TASK5_ABILITY_MARGIN);
  assert.equal(descriptiveGuard.strata.b_missing.status, "unverified");

  // Descriptive guard reports regression and unverified stratum, but does not veto candidate gap
  const gap = task5CandidateGap(cRows, tRows);
  assert.equal(gap.verdict, "pass");
  // In screen mode (descriptive), suite verdict is the gap verdict ("pass")
  const screenSuiteVerdict = gap.verdict;
  assert.equal(screenSuiteVerdict, "pass");

  // In full target mode (non-descriptive veto), ability regression vetoes the pass
  const fullGuard = task5AbilityGuard(cRows, tRows, { cohortAbilities, descriptive: false });
  assert.equal(fullGuard.role, "veto");
  const fullSuiteVerdict = !fullGuard.passed || gap.verdict !== "pass" ? "miss" : "pass";
  assert.equal(fullSuiteVerdict, "miss");

  // Check on recorded screen evidence: ability regressions are reported without vetoing the candidate-gap verdicts
  const verdict = await computeTask5ScreenVerdict();
  assert.ok(verdict.suites["beam-100k"].abilityGuard.regressions.includes("abstention"));
  assert.ok(verdict.suites["beam-100k"].abilityGuard.regressions.includes("preference_following"));
  assert.ok(verdict.suites.locomo.abilityGuard.regressions.includes("open-domain"));
  assert.ok(verdict.suites.locomo.abilityGuard.regressions.includes("adversarial"));
  assert.ok(verdict.suites["beam-1m"].abilityGuard.regressions.includes("multi_session_reasoning"));
  assert.ok(verdict.suites["beam-1m"].abilityGuard.unverifiedStrata.includes("summarization"));
  assert.ok(verdict.suites["beam-1m"].abilityGuard.unverifiedStrata.includes("temporal_reasoning"));
  // In the screen verdict, the ability guard has role descriptive
  assert.equal(verdict.suites["beam-100k"].abilityGuard.role, "descriptive");
});

test("task5_unknown_is_not_zero", async () => {
  // MAB has no fine-gold round mappings: candidate gap must be unmeasurable and null, never 0
  const cMab = [makeMockResult({ id: "1:mab:0", ability: "mab", needed: 0, candidateGap: false })];
  const tMab = [makeMockResult({ id: "1:mab:0", ability: "mab", needed: 0, candidateGap: false })];
  const mabGap = task5CandidateGap(cMab, tMab, { suite: "memoryagentbench-cr" });
  assert.equal(mabGap.measurable, false);
  assert.equal(mabGap.controlGapRate, null);
  assert.equal(mabGap.candidateGapRate, null);
  assert.equal(mabGap.ratio, null);
  assert.equal(mabGap.verdict, "inconclusive");
  assert.notEqual(mabGap.controlGapRate, 0);
  assert.notEqual(mabGap.candidateGapRate, 0);

  // Missing stratum in ability guard has null diff and null accuracy, never 0
  const emptyGuard = task5AbilityGuard([], [], { cohortAbilities: { missing_ability: 5 } });
  assert.equal(emptyGuard.strata.missing_ability.missing, true);
  assert.equal(emptyGuard.strata.missing_ability.status, "unverified");
  assert.equal(emptyGuard.strata.missing_ability.controlAccuracy, null);
  assert.equal(emptyGuard.strata.missing_ability.candidateAccuracy, null);
  assert.equal(emptyGuard.strata.missing_ability.diff, null);
  assert.notEqual(emptyGuard.strata.missing_ability.diff, 0);

  // Worst-case bound: candidate failure counts as not-surfaced (gap = true), never zero
  const cFine = [
    makeMockResult({ id: "1:a:0", ability: "a", candidateGap: true }),
    makeMockResult({ id: "2:a:0", ability: "a", candidateGap: true }),
  ];
  const tFineWithFailure = [
    makeMockResult({ id: "1:a:0", ability: "a", candidateGap: false }),
    // Question 2 failed (run limit / error), missing toolSurfacing
    { id: "2:a:0", ability: "a", cluster: "cluster-2", outcome: "run_limit", correct: false, evidenceCounts: { fineRounds: 2 } },
  ];
  const failGap = task5CandidateGap(cFine, tFineWithFailure);
  assert.equal(failGap.worstCaseBound.candidateFailures, 1);
  assert.equal(failGap.worstCaseBound.worstCaseCandidateGaps, 1);
  assert.equal(failGap.worstCaseBound.worstCaseCandidateGapRate, 0.5);
  assert.notEqual(failGap.worstCaseBound.worstCaseCandidateGapRate, 0);

  // Real verdict check
  const verdict = await computeTask5ScreenVerdict();
  assert.equal(verdict.suites["memoryagentbench-cr"].candidateGap.measurable, false);
  assert.equal(verdict.suites["memoryagentbench-cr"].candidateGap.controlGapRate, null);
  assert.equal(verdict.suites["memoryagentbench-cr"].candidateGap.candidateGapRate, null);
});

test("task5_development_screen_verdict_matches_criteria_schema_and_recorded_evidence", async () => {
  const jsonPath = TASK5_SCREEN_VERDICT_JSON;
  const mdPath = TASK5_SCREEN_VERDICT_MD;
  const verdict = await writeTask5ScreenVerdict();

  const written = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(written.manifestHash, verdict.manifestHash);
  assert.equal(verdict.schemaVersion, 1);
  assert.equal(verdict.criteriaVersion, TASK5_SCREEN_VERSION);
  assert.equal(verdict.mode, "development-screen");
  assert.equal(verdict.screenVerdict, "miss");
  assert.equal(verdict.handOff.plan, 210);
  assert.equal(verdict.handOff.reason, TASK5_SCREEN_HANDOFF_REASON);

  // All 4 screen suites are present
  for (const suite of TASK5_SCREEN_SUITES) {
    assert.ok(suite in verdict.suites);
    assert.ok("candidateGap" in verdict.suites[suite]);
    assert.ok("abilityGuard" in verdict.suites[suite]);
    assert.ok("suiteVerdict" in verdict.suites[suite]);
  }

  // All 8 screen cells are recorded in sourceReports
  const screen = reduce();
  for (const cell of screen.cells) {
    assert.ok(cell.id in verdict.sourceReports, `sourceReports missing ${cell.id}`);
    const rep = verdict.sourceReports[cell.id];
    assert.ok(typeof rep.sha256 === "string" && rep.sha256.length === 64);
    assert.ok(rep.questionsScored > 0);
  }

  // Verify markdown formatting
  const md = await readFile(mdPath, "utf8");
  assert.ok(md.includes("# Task 5 Development Screen Verdict: miss"));
  assert.ok(md.includes("## Summary by Suite"));
  assert.ok(md.includes("## Candidate-Gap Detail"));
  assert.ok(md.includes("## Ability-Guard Detail (Descriptive)"));
  assert.ok(md.includes("## Plan 210 Hand-Off"));
  assert.ok(md.includes("## Source Reports"));
});
