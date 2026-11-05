/** Plan 208 Task 5: the development report's rows on synthetic run reports. No network, no model call. */
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOntologyDevReport, loadScreenReports, o1Row, o2Row, o7Row, pairedCriteria, triggerPolicyRow } from "./ontology-report.mjs";
import { SCREEN208_PAIRED_MODELS as SCREEN208_MODELS } from "./ontology-screen.mjs";

const [large, small] = SCREEN208_MODELS;

/** 12 questions in 6 clusters: 6 `multi-hop` (consolidation-sensitive) and 6 `single-hop` (other). */
function report(correctOf, extra = {}) {
  const results = Array.from({ length: 12 }, (_, i) => ({
    id: `q${i}`,
    ability: i % 2 ? "multi-hop" : "single-hop",
    cluster: `c${i % 6}`,
    correct: correctOf(i),
    ingest: { archived: 100 },
  }));
  return { results, roleUsage: { product: { inputTokens: 1200 } }, ...extra };
}

function reportsFor(model, { base, twin }) {
  return new Map([
    [`208-screen.${model.key}.P.locomo`, report(base)],
    [`208-screen.${model.key}.P+O.locomo`, report(twin, { roleUsage: { product: { inputTokens: 1260 } } })],
  ]);
}

test("o1_o2_o7_read_paired_diffs_per_model_and_stay_pending_without_data", () => {
  // Benefit on the multi-hop questions only: P+O gets every odd question right, P gets half of them.
  const reports = new Map([
    ...reportsFor(large, { base: (i) => i % 4 === 1 || i % 2 === 0, twin: () => true }),
    ...reportsFor(small, { base: (i) => i % 2 === 0, twin: (i) => i % 2 === 0 }),
  ]);
  const perModel = SCREEN208_MODELS.map((model) => ({ model, paired: pairedCriteria({ reports, model }) }));
  const [first] = perModel;
  assert.equal(first.paired.sensitive.n, 6);
  assert.ok(first.paired.sensitive.diff > 0);
  assert.equal(first.paired.other.diff, 0, "no change on the other abilities");
  const o1 = o1Row(perModel);
  assert.equal(o1.models.length, SCREEN208_MODELS.length);
  assert.equal(o1.modelsPassing, 1);
  assert.equal(o1.providersPassing, 1);
  assert.equal(o1.pass, false, "one passing model from one provider cannot satisfy O1's two-model, two-provider rule");
  assert.equal(o2Row(perModel).models[0].pooledOther.pass, true);
  assert.equal(o7Row(perModel).pass, true);
  // No reports: nothing passes by default.
  const empty = SCREEN208_MODELS.map((model) => ({ model, paired: pairedCriteria({ reports: new Map(), model }) }));
  assert.equal(o1Row(empty).pass, null);
  assert.equal(o2Row(empty).pass, null);
  assert.equal(o7Row(empty).pass, null);
});

test("o2_fails_when_the_other_abilities_regress_beyond_the_margin", () => {
  const reports = reportsFor(large, { base: () => true, twin: (i) => i % 2 === 1 });
  const perModel = [{ model: large, paired: pairedCriteria({ reports, model: large }) }];
  const row = o2Row(perModel);
  assert.equal(row.models[0].pooledOther.pass, false);
  assert.ok(row.models[0].abilitiesBelowFloor.length > 0);
  assert.equal(row.pass, false);
});

test("trigger_policy_comparison_uses_the_same_scored_questions_and_names_the_loser", () => {
  const make = (_suffix, twin, calls) => report(twin, { ontologySummary: { curator: { calls, inputTokens: calls * 1000 } } });
  const reports = new Map([
    [`208-screen.muse.P+O.series-default.locomo`, make("d", () => true, 40)],
    [`208-screen.muse.P+O.series-readtime.locomo`, make("r", () => true, 10)],
  ]);
  const row = triggerPolicyRow({ reports, audits: [] });
  assert.equal(row.n, 12);
  assert.equal(row.diffPoints, 0);
  assert.equal(row.nonInferior, true);
  assert.equal(row.mayAdoptReadTimeOnly, true, "equal accuracy at a quarter of the curator calls");
  assert.equal(row.loserForPlan210, "three default policies");
  assert.ok(row.cost.readTime.callsPer1kExchanges < row.cost.default.callsPer1kExchanges);
});

test("report_loads_latest_attempt_reads_dev_only_and_holds_no_text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prism-208-report-"));
  try {
    const evidence = join(dir, "screen");
    await mkdir(evidence, { recursive: true });
    const write = (name, value) => writeFile(join(evidence, name), JSON.stringify(value));
    await write(
      "run-208-task5-208-screen.large.P.locomo.json",
      report(() => false),
    );
    await write(
      "run-208-task5-208-screen.large.P.locomo-2.json",
      report(() => true),
    );
    const loaded = await loadScreenReports(evidence);
    assert.equal(loaded.size, 1);
    assert.equal(loaded.get("208-screen.large.P.locomo").results[0].correct, true, "the later attempt wins");
    await assert.rejects(buildOntologyDevReport({ partition: "heldout-b", evidence }), /dev partition only/);
    const built = await buildOntologyDevReport({
      evidence,
      auditDir: join(dir, "none"),
      safetyPath: join(dir, "none.json"),
    });
    assert.equal(built.rows.O8.pass, null);
    assert.equal(built.rows.O6.pass, null);
    assert.equal(built.noText, true);
    assert.ok(built.ledger.some((item) => item.feature === "the tier as a whole"));
    assert.ok(!JSON.stringify(built).includes("question"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o3_row_flags_assistant_labelled_human_set", async () => {
  const { o3Summary } = await import("./ontology-report.mjs");
  const audit = { arm: "P+O.large", o3: { valid: true, pass: true, kappa: 0.85 }, groups: { beam: { supportedShare: 0.97 } } };
  assert.equal(o3Summary([audit]).humanLabelDeviation, null);
  const row = o3Summary([audit], { humanLabelSource: "assistant (owner-delegated 2026-11-03)" });
  assert.match(row.humanLabelDeviation, /not panel-versus-human/);
  assert.equal(row.pass, true);
});
