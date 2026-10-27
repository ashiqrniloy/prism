import { test, expect } from "bun:test";
import { benjaminiHochberg, compareExperiments, EvalError, type ExperimentReport } from "../index.js";

function report(scores: Record<string, number[][]>): ExperimentReport {
  const count = Object.values(scores)[0]!.length;
  const items = Array.from({ length: count }, (_, i) => ({
    item: { id: `item-${i}`, input: i }, trials: [],
    evaluations: Object.entries(scores).flatMap(([scorerId, rows]) => rows[i]!.map((score, trial) => ({
      id: `${scorerId}-${i}-${trial}`, scorerId, itemId: `item-${i}`, score,
      status: "scored" as const, sampled: true, createdAt: "2026-10-26",
    }))),
  }));
  return { experimentId: "test", datasetId: "dataset", status: "succeeded", items,
    evaluations: items.flatMap(item => item.evaluations),
    aggregate: { itemCount: count, scoredCount: 0, skippedCount: 0, failedCount: 0, scorers: {} } };
}
const binary = (n: number, passes = n) => Array.from({ length: n }, (_, i) => [Number(i < passes)]);
const unpaired = (fn: () => unknown) => expect(fn).toThrow(expect.objectContaining({ code: "ERR_PRISM_EVAL_COMPARE_UNPAIRED" }));

test("identical_reports_have_zero_difference_and_p_one", () => {
  const baseline = report({ success: binary(40) });
  const result = compareExperiments(baseline, baseline);
  expect(result.pairedItems).toBe(40);
  expect(result.scorers.success).toEqual({ baselineMean: 1, candidateMean: 1, difference: 0,
    ci95: { low: 0, high: 0 }, pValue: 1, qValue: 1, test: "mcnemar", significant: false });
});

test("planted_regression_is_significant_and_pairs_by_id", () => {
  const a = report({ success: binary(40) }), b = report({ success: binary(40, 32) });
  const result = compareExperiments(a, { ...b, items: [...b.items].reverse() }, { seed: 1 });
  const stats = result.scorers.success!;
  expect(stats.difference).toBeCloseTo(-.2);
  expect(stats.pValue).toBeCloseTo(.0078125, 14);
  expect(stats.significant).toBe(true);
  expect(stats.ci95.high).toBeLessThan(0);
  expect(compareExperiments(a, b, { seed: 1 })).toEqual(result);
});

test("continuous_and_repeated_binary_scores_use_item_averages_and_sign_flips", () => {
  const a = report({ continuous: [[0, 1], [0]], repeated: [[0, 1], [1, 1]] });
  const b = report({ continuous: [[1], [.5, .5, .5]], repeated: [[1, 1], [1, 1]] });
  const stats = compareExperiments(a, b, { seed: 2 }).scorers;
  expect(stats.continuous!.baselineMean).toBe(.25);
  expect(stats.continuous!.difference).toBe(.5);
  expect(stats.continuous!.pValue).toBe(.5);
  expect(stats.continuous!.test).toBe("paired_permutation");
  expect(stats.repeated!.test).toBe("paired_permutation");
  const partial = report({ success: binary(3) });
  expect(compareExperiments({ ...partial, trials: { count: 2, sampleCount: 3 } }, partial)
    .scorers.success!.test).toBe("paired_permutation");
});

test("unpaired_reports_throw", () => {
  const a = report({ success: binary(3) });
  unpaired(() => compareExperiments(a, { ...a, datasetId: "other" }));
  unpaired(() => compareExperiments({ ...a, datasetVersion: "1" }, { ...a, datasetVersion: "2" }));
  unpaired(() => compareExperiments({ ...a, manifest: { runtimeRevision: "r", datasetVersion: "1" } },
    { ...a, manifest: { runtimeRevision: "r", datasetVersion: "2" } }));
  unpaired(() => compareExperiments(a, { ...a, items: a.items.slice(0, 1) }));
  unpaired(() => compareExperiments(a, { ...a, items: [a.items[0]!, a.items[0]!] }));
  unpaired(() => compareExperiments(a, a, { scorers: ["missing"] }));
  unpaired(() => compareExperiments(a, report({ other: binary(3) })));
  unpaired(() => compareExperiments(a, { ...a, items: a.items.map(item => ({ ...item, evaluations: [] })) }));
  for (const score of [NaN, Infinity, -1, 2]) unpaired(() => compareExperiments(a, report({ success: [[score], [1], [1]] })));
  const failed = { ...a, items: a.items.map(item => ({ ...item,
    evaluations: item.evaluations.map(row => ({ ...row, status: "failed" as const })) })) };
  unpaired(() => compareExperiments(a, failed));
});

test("shared_items_are_compared_and_bh_controls_across_scorers", () => {
  const a = report({ strong: binary(40), weak: binary(40), same: binary(40) });
  const b = report({ strong: binary(40, 32), weak: binary(40, 36), same: binary(40) });
  const result = compareExperiments(a, b, { seed: 1 });
  const stats = Object.values(result.scorers);
  expect(stats.map(row => row.qValue)).toEqual(benjaminiHochberg(stats.map(row => row.pValue)));
  expect(result.scorers.strong!.significant).toBe(true);
  expect(result.scorers.weak!.significant).toBe(false);
  expect(compareExperiments(a, b, { scorers: ["weak"] }).scorers).toHaveProperty("weak");
  expect(compareExperiments(a, { ...b, items: b.items.slice(1) }).pairedItems).toBe(39);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

test("comparison_validates_options", () => {
  const a = report({ success: binary(2) });
  for (const options of [{ alpha: 0 }, { alpha: 1 }, { alpha: NaN }, { seed: .5 },
    { resamples: 0 }, { resamples: 100001 }, { scorers: [] }, { scorers: ["success", "success"] }]) {
    expect(() => compareExperiments(a, a, options)).toThrow(EvalError);
  }
});


test("compare_refuses_different_hashes", () => {
  const a = report({ ok: binary(4) });
  unpaired(() => compareExperiments({ ...a, datasetContentHash: "sha256:a" }, { ...a, datasetContentHash: "sha256:b" }));
  unpaired(() => compareExperiments({ ...a, datasetContentHash: "sha256:a" }, a));
});

test("by_tag_comparison_controls_bh_across_all_tag_scorer_pairs", () => {
  const tagged = (r: ExperimentReport): ExperimentReport => ({ ...r, items: r.items.map((item, i) =>
    ({ ...item, item: { ...item.item, tags: i < 20 ? ["first", "all"] : ["last", "all"] } })) });
  const a = tagged(report({ strong: binary(40), same: binary(40) }));
  const b = tagged(report({ strong: binary(40, 32), same: binary(40) }));
  const result = compareExperiments(a, b, { byTag: true, seed: 1 });
  assertTagCounts(result.byTag!);
  const stats = Object.values(result.byTag!).flatMap(tag => Object.values(tag.scorers));
  expect(stats.map(x => x.qValue)).toEqual(benjaminiHochberg(stats.map(x => x.pValue)));
  function assertTagCounts(tags: NonNullable<typeof result.byTag>) {
    expect(tags.first!.pairedItems).toBe(20);
    expect(tags.last!.pairedItems).toBe(20);
    expect(tags.all!.pairedItems).toBe(40);
  }
});


test("by_tag_handles_prototype_named_tags_and_omits_singletons", () => {
  const r = report({ ok: binary(3) });
  const tagged = { ...r, items: r.items.map((item, i) => ({ ...item,
    item: { ...item.item, tags: i === 0 ? ["__proto__", "singleton"] : ["__proto__"] } })) };
  const result = compareExperiments(tagged, tagged, { byTag: true });
  expect(Object.keys(result.byTag!)).toEqual(["__proto__"]);
  expect(result.byTag!["__proto__"]!.pairedItems).toBe(3);
});
