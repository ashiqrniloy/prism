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
  reduceTask5Manifest,
  TASK5_MANIFEST,
  TASK5_SCREEN_BEAM_1M_WALL_HOURS,
  TASK5_SCREEN_MANIFEST,
  TASK5_SCREEN_SUITES,
  TASK5_SCREEN_VERSION,
  task5Beam1mSlice,
  task5ManifestHash,
  task5ScreenCriteria,
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
