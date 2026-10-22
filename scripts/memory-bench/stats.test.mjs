import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareFamily } from "./report.mjs";
import { clusterBootstrap, compare, holm, pairedClusterPermutation, powerForDiff } from "./stats.mjs";

const arms = (n = 10) => {
  const a = Array.from({ length: n * 4 }, (_, id) => ({ id, cluster: Math.floor(id / 4), ability: "recall", correct: false }));
  return [a, a.map((row) => ({ ...row, correct: true }))];
};
const report = (results) => ({ suite: "lifecycle", subset: "test", results });

test("compare_refuses_changed_judge_protocol", () => {
  const [a, b] = arms();
  assert.throws(() => compare({ ...report(a), judgeProtocol: "plain-v1" }, { ...report(b), judgeProtocol: "enum-json-v1" }));
});

test("cluster_bootstrap_covers_true_rate_at_nominal_level", () => {
  let state = 19,
    covered = 0;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let trial = 0; trial < 150; trial++) {
    const items = Array.from({ length: 80 }, (_, cluster) => ({ cluster, correct: random() < 0.4 }));
    const { ci95 } = clusterBootstrap(items, { iterations: 1000, seed: trial });
    covered += Number(ci95[0] <= 0.4 && ci95[1] >= 0.4);
  }
  assert.ok(covered / 150 >= 0.9 && covered / 150 <= 0.99, String(covered));
});

test("paired_cluster_permutation_detects_constructed_effect_and_not_null", () => {
  const [a, b] = arms();
  const effect = pairedClusterPermutation(a, b, { seed: 7 });
  assert.equal(effect.diff, 1);
  assert.deepEqual(effect.ci95, [1, 1]);
  assert.equal(effect.p, 2 / 2 ** 10);
  assert.deepEqual(pairedClusterPermutation(a, a), { diff: 0, ci95: [0, 0], p: 1 });
  // Repeating sessions cannot manufacture independent clusters.
  assert.equal(pairedClusterPermutation(...arms(2)).p, 0.5);
  assert.deepEqual(pairedClusterPermutation(a, [...b].reverse()), effect);
  const balancedA = a.map((row) => ({ ...row, correct: row.cluster % 2 === 0 }));
  const balancedB = balancedA.map((row) => ({ ...row, correct: !row.correct }));
  assert.equal(pairedClusterPermutation(balancedA, balancedB).p, 1);
  assert.equal(pairedClusterPermutation(balancedA, balancedB).diff, 0);
  const large = arms(20);
  assert.deepEqual(pairedClusterPermutation(...large, { seed: 3 }), pairedClusterPermutation(...large, { seed: 3 }));
});

test("bootstrap_preserves_cluster_sizes_and_validates_inputs", () => {
  const items = [{ cluster: "a", correct: true }, ...Array.from({ length: 9 }, () => ({ cluster: "b", correct: false }))];
  assert.equal(clusterBootstrap(items).estimate, 0.1);
  assert.deepEqual(clusterBootstrap(items).ci95, [0, 1]);
  assert.throws(() => clusterBootstrap([]));
  assert.throws(() => clusterBootstrap([{ correct: true }]));
  assert.throws(() => clusterBootstrap(items, { iterations: 0 }));
  assert.throws(() => clusterBootstrap(items, { seed: NaN }));
  assert.throws(() => clusterBootstrap(items, { metric: () => NaN }));
  const [a, b] = arms();
  assert.throws(() => pairedClusterPermutation(a, b.slice(1)));
  assert.throws(() =>
    pairedClusterPermutation(
      a,
      b.map((row) => ({ ...row, cluster: "other" })),
    ),
  );
  assert.throws(() =>
    pairedClusterPermutation(
      a,
      b.map((row) => ({ ...row, correct: undefined })),
    ),
  );
});

test("holm_adjusts_in_step_down_order", () => {
  assert.deepEqual(holm([0.03, 0.01, 0.04, 0.002]), [0.06, 0.03, 0.06, 0.008]);
  assert.deepEqual(holm([1, 1, 0]), [1, 1, 0]);
  assert.deepEqual(holm([]), []);
  assert.throws(() => holm([NaN]));
  assert.throws(() => holm([-0.1]));
});

test("power_is_bounded_and_accounts_for_design_effect", () => {
  assert.ok(Math.abs(powerForDiff({ baseline: 0.5, diff: 0, clusters: 100, icc: 0 }) - 0.05) < 1e-6);
  const options = { baseline: 0.5, diff: 0.2, clusters: 100, clusterSize: 8, icc: 0 };
  assert.ok(powerForDiff(options) > powerForDiff({ ...options, icc: 0.8 }));
  assert.ok(powerForDiff(options) > powerForDiff({ ...options, clusters: 10 }));
  assert.ok(powerForDiff(options) <= 1);
  // Python math.erf: Phi(-z-shift) + 1-Phi(z-shift), shift=.2/sqrt(.46/100).
  assert.ok(Math.abs(powerForDiff({ ...options, clusterSize: 1 }) - 0.8386383403083618) < 1e-6);
  assert.equal(
    clusterBootstrap([{ project: "p", value: 3 }], {
      cluster: (row) => row.project,
      metric: (row) => row.value,
    }).estimate,
    3,
  );
  assert.throws(() => powerForDiff({ ...options, baseline: 0.9 }));
});

test("compare_selects_clustered_or_unclustered_and_rejects_mixed_clusters", () => {
  const [a, b] = arms();
  assert.equal(compare(report(a), report(b)).recall.method, "paired-cluster-signflip");
  const unclustered = (rows) => rows.map(({ cluster, ...row }) => row);
  const result = compare(report(unclustered(a)), report(unclustered(b))).recall;
  assert.equal(result.method, "mcnemar");
  assert.equal(result.diff, 1);
  assert.deepEqual(result.ci95, [1, 1]);
  assert.throws(() => compare(report(a), report(unclustered(b))));
});

test("report_is_byte_identical_for_same_seed", async () => {
  const [a, b] = arms(20);
  const family = [report(b), report(a)];
  const first = compareFamily(report(a), family, { seed: 7 });
  assert.equal(JSON.stringify(first), JSON.stringify(compareFamily(report(a), family, { seed: 7 })));
  const groups = first.flatMap((result) => Object.values(result));
  assert.deepEqual(
    groups.map((group) => group.pHolm),
    holm(groups.map((group) => group.p)),
  );
  const dir = await mkdtemp(join(tmpdir(), "memory-stats-"));
  try {
    const paths = ["a", "b", "c"].map((name) => join(dir, `${name}.json`));
    await Promise.all([report(a), ...family].map((data, i) => writeFile(paths[i], JSON.stringify(data))));
    const run = () => Bun.spawnSync(["bun", "scripts/memory-bench/report.mjs", "--compare", ...paths]);
    const one = run(),
      two = run();
    assert.equal(one.exitCode, 0, one.stderr.toString());
    assert.equal(one.stdout.toString(), two.stdout.toString());
    assert.ok(JSON.parse(one.stdout.toString())[0].recall.ci95);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bootstrap_10000_iterations_1000_items_under_two_seconds", () => {
  const items = Array.from({ length: 1000 }, (_, cluster) => ({ cluster, correct: cluster % 2 === 0 }));
  const start = performance.now();
  clusterBootstrap(items, { iterations: 10000, seed: 7 });
  assert.ok(performance.now() - start < 2000);
});

import { lifecycleCluster } from "./lifecycle/suite.mjs";
import { METRIC_VERSION } from "./metrics.mjs";
import { summarize } from "./report.mjs";
import { pairedPowerSimulation } from "./stats.mjs";

const reportV2 = (results) => ({
  suite: "lifecycle",
  subset: "test",
  judgeProtocol: "enum-json-v1",
  metricVersion: METRIC_VERSION,
  clusterUnit: "persona",
  status: "completed",
  usageComplete: true,
  results,
});

test("fractional_recall_comparison_matches_reported_mean", () => {
  // .25 -> .75 must read +.5; an all-needed boolean would read 0.
  const a = Array.from({ length: 4 }, (_, cluster) => ({ id: cluster, cluster, ability: "rightTimeRecall", value: 0.25, correct: false }));
  const b = a.map((row) => ({ ...row, value: 0.75 }));
  const result = compare(reportV2(a), reportV2(b)).rightTimeRecall;
  assert.equal(result.diff, 0.5);
  assert.equal(result.rawMeans.a, 0.25);
  assert.equal(result.rawMeans.b, 0.75);
  assert.equal(result.improvementDelta, 0.5);

  // Historical lifecycle receipts: full .2625 vs fabric .90625 → +.64375 on raw means, not the all-needed +.75.
  const full = Array.from({ length: 16 }, (_, id) => ({
    id,
    cluster: id,
    ability: "rightTimeRecall",
    value: id < 4 ? 1 : id === 4 ? 0.2 : 0,
  }));
  const fabric = full.map((row) => ({ ...row, value: row.id < 14 ? 1 : row.id === 14 ? 0.5 : 0 }));
  const historical = compare(reportV2(full), reportV2(fabric)).rightTimeRecall;
  assert.equal(historical.diff, 0.64375);
});

test("risk_metric_raw_rate_and_improvement_direction_are_explicit", () => {
  const a = Array.from({ length: 4 }, (_, cluster) => ({
    id: cluster,
    cluster,
    ability: "crossProjectLeakage",
    value: 0.5,
    correct: false,
  }));
  const b = a.map((row) => ({ ...row, value: 0.75 }));
  const result = compare(reportV2(a), reportV2(b)).crossProjectLeakage;
  assert.equal(result.direction, "lower");
  assert.equal(result.rawMeans.a, 0.5);
  assert.equal(result.rawMeans.b, 0.75);
  assert.equal(result.diff, 0.25, "raw risk diff stays B-A");
  assert.equal(result.improvementDelta, -0.25, "improvement is inverted for lower-is-better");
  const legacyA = [{ id: 1, cluster: "p", ability: "crossProjectLeakage", value: false, correct: true }];
  const legacyB = [{ id: 1, cluster: "p", ability: "crossProjectLeakage", value: true, correct: false }];
  assert.equal(compare(reportV2(legacyA), reportV2(legacyB)).crossProjectLeakage.diff, 1, "raw value wins over inverted correct");
});

test("null_denominator_is_not_zero_success", () => {
  const report = summarize(reportV2([{ id: "1", cluster: "p", ability: "rightTimeRecall", value: null, correct: false }]));
  assert.equal(report.abilities.rightTimeRecall.valueMean, null);
  assert.equal(report.rightTimeRecall, undefined);
  assert.equal(report.answerSessionHitAtK, null);
});

test("shared_agent_state_clusters_at_persona_not_project", () => {
  assert.equal(lifecycleCluster("persona-1"), "persona-1");
  const rows = ["p1"].flatMap((persona) =>
    ["a", "b", "c"].map((project, i) => ({
      id: `${persona}-${project}`,
      cluster: persona,
      ability: "crossProjectLeakage",
      value: i === 0 ? 1 : 0,
      correct: i !== 0,
    })),
  );
  const result = compare(reportV2(rows), reportV2(rows.map((row) => ({ ...row, value: 0 })))).crossProjectLeakage;
  assert.equal(result.clusters, 1);
  assert.equal(result.clusterUnit, "persona");
});

test("three_clusters_cannot_claim_high_confirmatory_power", () => {
  const rows = [0, 1, 2].flatMap((cluster) =>
    Array.from({ length: 4 }, (_, i) => ({ id: `${cluster}-${i}`, cluster, ability: "rightTimeRecall", value: 0.25, correct: false })),
  );
  const better = rows.map((row) => ({ ...row, value: 0.75 }));
  const result = compare(reportV2(rows), reportV2(better)).rightTimeRecall;
  assert.equal(result.clusters, 3);
  assert.equal(result.confirmatory, false);
  assert.ok(result.power < 0.8, String(result.power));
});

test("paired_power_simulation_matches_analysis_design", () => {
  const options = { baseline: 0.5, diff: 0.3, clusters: 12, clusterSize: 4, icc: 0.8, seed: 7, simulations: 60 };
  const power = pairedPowerSimulation(options);
  assert.equal(power, pairedPowerSimulation(options));
  assert.ok(power > pairedPowerSimulation({ ...options, clusters: 4 }));
  const rows = [0, 1, 2].flatMap((cluster) =>
    Array.from({ length: 4 }, (_, i) => ({ id: `${cluster}-${i}`, cluster, ability: "rightTimeRecall", value: 0.25, correct: false })),
  );
  const better = rows.map((row) => ({ ...row, value: 0.75 }));
  const result = compare(reportV2(rows), reportV2(better), { simulations: 40 }).rightTimeRecall;
  assert.equal(result.powerAssumptions.method, "paired-cluster-signflip-simulation");
  assert.equal(result.powerAssumptions.independentArms, false);
  assert.ok(result.power <= 1);
});

test("incompatible_metric_or_protocol_reports_refuse_comparison", () => {
  const rows = [{ id: 1, cluster: "p", ability: "taskSuccess", value: 1, correct: true }];
  assert.throws(() => compare(reportV2(rows), { ...reportV2(rows), metricVersion: METRIC_VERSION + 1 }), /metric version/);
  assert.throws(
    () => compare({ ...reportV2(rows), protocolHash: "a".repeat(64) }, { ...reportV2(rows), protocolHash: "b".repeat(64) }),
    /protocol/,
  );
  assert.throws(
    () => compare({ ...reportV2(rows), dataset: { sha256: "a" } }, { ...reportV2(rows), dataset: { sha256: "b" } }),
    /datasets/,
  );
});

test("locomo_f1_and_model_judge_accuracy_remain_distinct", () => {
  const report = summarize({
    suite: "locomo",
    subset: "base",
    judgeProtocol: "enum-json-v1",
    metricVersion: METRIC_VERSION,
    results: [
      { id: "1", cluster: "c1", ability: "tokenF1", correct: true, f1: 0.2, value: 0.2 },
      { id: "2", cluster: "c1", ability: "accuracy", correct: false, value: 0 },
    ],
    injections: [],
    inputTokens: 0,
    cacheReadTokens: 0,
    turns: 0,
  });
  assert.equal(report.abilities.tokenF1.f1, 0.2);
  assert.equal(report.abilities.tokenF1.accuracy, 1);
  assert.equal(report.abilities.accuracy.accuracy, 0);
  assert.match(report.metricDefinitions.tokenF1.definition, /token-level F1/);
  assert.match(report.metricDefinitions.accuracy.definition, /judge accuracy, not token F1/);
});
