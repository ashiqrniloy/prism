import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  CLAIM_LABELS,
  HUMAN_AUDIT_CLAIMS,
  parseClaimLabels,
  renderClaimReviewPage,
  selectHumanAuditClaims,
} from "./audit/claim-review.mjs";
import {
  assertClaimAuditGate,
  assertNoCuratorJudge,
  assertReportHasNoText,
  bundleFromConcepts,
  calibratePanel,
  citationOrder,
  claimPrompt,
  createClaimPanel,
  evidenceReach,
  flattenClaims,
  judgeClaims,
  MAX_CLAIMS_PER_GROUP,
  o3Row,
  offlineFixture,
  offlineHumanLabels,
  parseClaimVerdict,
  runAudit,
  scriptedJudges,
} from "./ontology-audit.mjs";

const ARM = "conversational+O";

test("audit_sample_is_seeded_and_stratified", async () => {
  const bundles = offlineFixture();
  const run = (seed, sample) => runAudit({ bundles, arm: ARM, judges: scriptedJudges(), sample, seed });
  const a = await run("seed-1", 12);
  const b = await run("seed-1", 12);
  const c = await run("seed-2", 12);
  const ids = (report) => report.rows.map((row) => row.id);
  assert.deepEqual(ids(a), ids(b));
  assert.notDeepEqual(ids(a), ids(c));
  // 12 per (arm, model) over 3 suites x sizes: round-robin covers every stratum before repeating one.
  for (const group of Object.keys(a.groups)) {
    const strata = Object.keys(a.groups[group].byStratum);
    assert.equal(a.groups[group].sampled, 12);
    assert.ok(strata.length >= 5, `${group} covers ${strata.length} strata`);
  }
  // Human claims are the person's, not the curator's: excluded from the pool.
  assert.equal(a.pool.humanClaimsExcluded, 6);
  // The per-group cap is a hard limit.
  await assert.rejects(run("s", MAX_CLAIMS_PER_GROUP + 1), /--sample must be/);
  // The pool is not mutated by drawing.
  assert.equal(flattenClaims(bundles).claims.length, 6 * 17);
});

test("audit_report_carries_no_text", async () => {
  const bundles = offlineFixture();
  const report = await runAudit({ bundles, arm: ARM, judges: scriptedJudges(), humanLabels: offlineHumanLabels(bundles) });
  const body = JSON.stringify(report);
  for (const bundle of bundles) {
    for (const note of Object.values(bundle.notes)) assert.ok(!body.includes(note));
    for (const concept of bundle.concepts) for (const claim of concept.claims) assert.ok(!body.includes(claim.text));
  }
  // A report that did carry text is refused before it is written.
  assert.throws(() => assertReportHasNoText({ leak: bundles[0].concepts[0].claims[0].text }, bundles), /claim or note text/);
  assert.throws(() => assertReportHasNoText({ leak: Object.values(bundles[0].notes)[0] }, bundles), /claim or note text/);
  // Human labels are ids and verdicts only.
  assert.throws(() => parseClaimLabels('[{"id":"a","verdict":"supported","claim":"text"}]'), /only id and verdict/);
  assert.throws(() => parseClaimLabels('[{"id":"a","verdict":"correct"}]'), /label verdict/);
  assert.throws(() => parseClaimLabels('[{"id":"a","verdict":"supported"},{"id":"a","verdict":"supported"}]'), /duplicate/);
  assert.equal(parseClaimLabels('{"items":[{"id":"a","verdict":"contradicted"}]}')[0].verdict, "contradicted");
});

test("o3_row_invalid_below_kappa_threshold", () => {
  const groups = { g1: { supportedShare: 0.97 }, g2: { supportedShare: 0.96 } };
  const row = (calibration) => o3Row({ groups, calibration });
  // Not calibrated: the row is invalid, never a pass or a fail.
  assert.deepEqual([row({ n: 60, kappaSupportedVsNot: 0.79 }).valid, row({ n: 60, kappaSupportedVsNot: 0.79 }).pass], [false, null]);
  assert.equal(row({ n: 60, kappaSupportedVsNot: null }).valid, false);
  assert.equal(row(null).valid, false);
  assert.match(row({ n: 40, kappaSupportedVsNot: 0.95 }).invalidReasons.join(), /incomplete/);
  // Calibrated: pass needs every group at or above 95%.
  assert.deepEqual([row({ n: 60, kappaSupportedVsNot: 0.8 }).valid, row({ n: 60, kappaSupportedVsNot: 0.8 }).pass], [true, true]);
  const low = o3Row({ groups: { ...groups, g3: { supportedShare: 0.94 } }, calibration: { n: 60, kappaSupportedVsNot: 0.9 } });
  assert.deepEqual([low.valid, low.pass, low.groups.g3.pass], [true, false, false]);
});

test("scripted_judge_offline_run_produces_all_labels", async () => {
  const bundles = offlineFixture();
  const labels = offlineHumanLabels(bundles);
  assert.equal(labels.length, HUMAN_AUDIT_CLAIMS);
  const report = await runAudit({ bundles, arm: ARM, judges: scriptedJudges(), humanLabels: labels });
  const seen = new Set(report.rows.map((row) => row.label));
  for (const label of CLAIM_LABELS) assert.ok(seen.has(label), `${label} missing`);
  // Plan 199 panel with three distinct-model judges; citations are position-swapped between judges.
  assert.deepEqual(
    report.panel.map((judge) => judge.citationOrder),
    ["forward", "reversed", "forward"],
  );
  // Budget: one call per judged claim per judge; the 60 human claims are inside the sample cap.
  for (const summary of Object.values(report.groups)) assert.ok(summary.sampled <= MAX_CLAIMS_PER_GROUP);
  assert.equal(report.judgeCalls, report.rows.filter((row) => row.judged).length * 3);
  // Cited filler is not needed: one of two citations, whichever order the judge saw them in.
  for (const summary of Object.values(report.groups)) assert.equal(summary.citationPrecision, 0.5);
  assert.equal(report.calibration.n, HUMAN_AUDIT_CLAIMS);
  assert.ok(report.calibration.kappaSupportedVsNot > 0.8, `kappa ${report.calibration.kappaSupportedVsNot}`);
  assert.equal(report.o3.valid, true);
  // Without labels the row is invalid, not a pass.
  const unlabelled = await runAudit({ bundles, arm: ARM, judges: scriptedJudges() });
  assert.deepEqual([unlabelled.o3.valid, unlabelled.o3.pass], [false, null]);
});

test("judges_see_citations_in_swapped_order_and_only_the_cited_notes", async () => {
  const claim = { id: "x", text: "the claim", cites: ["a", "b", "c"], notes: ["first", "second", "third"] };
  assert.deepEqual(citationOrder(3, false), [0, 1, 2]);
  assert.deepEqual(citationOrder(3, true), [2, 1, 0]);
  const prompts = [];
  const judge = (ref) => ({
    ref,
    generate: async (prompt, { parse }) => {
      prompts.push(prompt);
      return parse('{"label":"supported","needed":[1]}');
    },
  });
  const neededLog = new Map();
  const panel = createClaimPanel({ judges: [judge("p/one"), judge("q/two")], neededLog });
  const [row] = await judgeClaims([{ ...claim, group: "g", suite: "s", partition: "dev", size: "small" }], { panel, neededLog });
  assert.ok(prompts[0].indexOf("first") < prompts[0].indexOf("third"));
  assert.ok(prompts[1].indexOf("third") < prompts[1].indexOf("first"));
  assert.equal(claimPrompt(claim, [0, 1, 2]).includes("Claim: the claim"), true);
  // "needed: [1]" is the first note shown: note 0 for the forward judge, note 2 for the reversed one. No majority, none needed.
  assert.equal(row.neededCount, 0);
  assert.equal(row.label, "supported");
  // Distinct models are required by the plan 199 panel.
  assert.throws(() => createClaimPanel({ judges: [judge("p/one"), judge("p/one")] }), /distinct models/);
});

test("unresolved_citation_and_failed_panel_count_against_the_claim", async () => {
  const base = { group: "g", suite: "s", partition: "dev", size: "small" };
  let calls = 0;
  const fail = (ref) => ({
    ref,
    generate: async () => {
      calls++;
      throw new Error("quota");
    },
  });
  const neededLog = new Map();
  const panel = createClaimPanel({ judges: [fail("p/one"), fail("q/two")], neededLog });
  const rows = await judgeClaims(
    [
      { ...base, id: "missing", text: "t", cites: ["a"], notes: [undefined] },
      { ...base, id: "failing", text: "t", cites: ["a"], notes: ["n"] },
    ],
    { panel, neededLog },
  );
  assert.deepEqual(
    rows.map((row) => [row.label, row.judged, Boolean(row.unresolved), Boolean(row.failed)]),
    [
      ["unsupported", false, true, false],
      ["unsupported", false, false, true],
    ],
  );
  assert.equal(calls, 2, "the unresolved claim makes no judge call");
  assert.throws(() => parseClaimVerdict("not json", 2), /invalid claim-support verdict JSON/);
  assert.throws(() => parseClaimVerdict('{"label":"maybe"}', 2), /label/);
  assert.throws(() => parseClaimVerdict('{"label":"supported","needed":[3]}', 2), /needed/);
  assert.deepEqual(parseClaimVerdict('```json\n{"label":"supported","needed":[2,2]}\n```', 2), { label: "supported", needed: [2] });
});

test("human_set_is_development_only_label_blind_and_reviewable", () => {
  const bundles = offlineFixture();
  const { claims } = flattenClaims(bundles);
  assert.throws(() => selectHumanAuditClaims(claims), /development partitions only/);
  const dev = flattenClaims(bundles.filter((bundle) => bundle.partition === "dev")).claims;
  const picked = selectHumanAuditClaims(dev);
  assert.equal(picked.length, HUMAN_AUDIT_CLAIMS);
  assert.deepEqual(
    picked.map((c) => c.id),
    selectHumanAuditClaims(dev).map((c) => c.id),
  );
  const page = renderClaimReviewPage(picked.map((c) => ({ id: c.id, claim: c.text, notes: c.notes })));
  for (const label of CLAIM_LABELS) assert.ok(page.includes(label));
  // Label-blind: the page payload holds only id, claim and notes, never a panel verdict.
  const payload = JSON.parse(/const items=(.*);\nconst kinds/.exec(page)[1]);
  for (const item of payload) assert.deepEqual(Object.keys(item).sort(), ["claim", "id", "notes"]);
});

test("claims_bundle_from_concept_bodies_and_evidence_reach", () => {
  const n1 = "aaaaaaaaaaaa";
  const n2 = "bbbbbbbbbbbb";
  const text = `# Payments\n\n- [c1] Retries use backoff.[^${n1}]\n- [c2 human] A person wrote this.\n\n## Open questions\n- [q1] Shared budget?[^${n2}]\n`;
  const bundle = bundleFromConcepts({
    arm: ARM,
    model: "m/x",
    suite: "locomo",
    partition: "dev",
    history: "h1",
    concepts: [{ id: "payments", subject: "payments", scope: "project", text }],
    noteText: (id) => ({ [n1]: "note one", [n2]: "note two" })[id],
    questions: [
      { id: "q1", correct: true, answerBearing: [n1], recalled: ["payments"] },
      { id: "q2", correct: true, answerBearing: [n2], recalled: ["payments"] },
      { id: "q3", correct: false, answerBearing: [n1], recalled: ["payments"] },
      { id: "q4", correct: true, answerBearing: [], recalled: [] },
    ],
  });
  assert.deepEqual(Object.keys(bundle.notes), [n1]);
  const { claims, human } = flattenClaims([bundle]);
  assert.equal(claims.length, 1);
  assert.equal(human, 1);
  // q2's answer-bearing note is only in a question, not a claim: not reachable. q3 is wrong, q4 has no evidence.
  assert.deepEqual(evidenceReach([bundle]), { answered: 2, reached: 1, share: 0.5 });
});

test("calibration_report_carries_ids_and_counts_only", async () => {
  const bundles = offlineFixture();
  const labels = offlineHumanLabels(bundles);
  const report = await runAudit({ bundles, arm: ARM, judges: scriptedJudges(), humanLabels: labels });
  const calibration = await calibratePanel({ rows: report.rows, humanLabels: labels });
  assert.equal(calibration.n, HUMAN_AUDIT_CLAIMS);
  // Every value is a count, a statistic or a table of counts: no string anywhere in the calibration record.
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object") for (const inner of Object.values(value)) walk(inner);
  };
  walk(calibration);
  assert.deepEqual(strings, []);
  const body = JSON.stringify({ calibration, report: report.calibration });
  for (const bundle of bundles) {
    for (const note of Object.values(bundle.notes)) assert.ok(!body.includes(note));
    for (const concept of bundle.concepts) for (const claim of concept.claims) assert.ok(!body.includes(claim.text));
  }
  assert.doesNotThrow(() => assertReportHasNoText({ calibration }, bundles));
});

test("live_audit_refuses_a_panel_judge_that_curated_any_bundle_of_the_arm", () => {
  const bundles = [{ model: "kilo/nvidia/nemotron-3-ultra-550b-a55b:free" }, { model: "commandcode/Qwen/Qwen3.7-Flash" }];
  // A curator of any one bundle is refused, by its exact ref or by the same model through another route.
  assert.throws(
    () => assertNoCuratorJudge({ refs: "commandcode/Qwen/Qwen3.7-Flash,commandcode/meta/muse-spark-1.2-contributor", bundles }),
    /curated claims in this arm/,
  );
  assert.throws(
    () =>
      assertNoCuratorJudge({
        refs: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free,commandcode/meta/muse-spark-1.2-contributor",
        bundles,
      }),
    /curated claims in this arm/,
  );
  assert.throws(
    () => assertNoCuratorJudge({ refs: "openrouter/qwen/qwen3.7-flash,commandcode/meta/muse-spark-1.2-contributor", bundles }),
    /curated claims in this arm/,
  );
  // Unconflicted judges from distinct families pass.
  const panel = assertNoCuratorJudge({
    refs: "commandcode/meta/muse-spark-1.2-contributor,openrouter/google/gemma-4-31b-it:free",
    bundles: [{ model: "kilo/nvidia/nemotron-3-ultra-550b-a55b:free" }],
  });
  assert.equal(panel.refs.length, 2);
});

test("a_mixed_case_judge_model_id_makes_a_valid_package_name", () => {
  // The live audit names one provider package per judge from its model id; npm names are lowercase.
  const name = (model) => `claim-audit-${model.replaceAll(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}`;
  assert.match(name("Qwen/Qwen3.7-Flash"), /^[a-z0-9-]+$/);
  assert.match(name("meta/muse-spark-1.2-contributor"), /^[a-z0-9-]+$/);
});

test("claim_audit_accepts_approved_gate_o1_or_c1_only", () => {
  const ok = (plan, gate) => ({ plan, gate, approved: true, approvedBy: "owner" });
  assert.equal(assertClaimAuditGate(ok(208, "O-1")).gate, "O-1");
  assert.equal(assertClaimAuditGate(ok(210, "C-1")).gate, "C-1");
  assert.throws(() => assertClaimAuditGate(ok(209, "W-1")), /O-1 \(plan 208\) or C-1 \(plan 210\)/);
  assert.throws(() => assertClaimAuditGate({ ...ok(210, "C-1"), approved: false }), /MemoryBenchGate/);
  assert.throws(() => assertClaimAuditGate({ ...ok(210, "C-1"), approvedBy: "assistant" }), /MemoryBenchGate/);
  assert.throws(() => assertClaimAuditGate(null), /MemoryBenchGate/);
});
