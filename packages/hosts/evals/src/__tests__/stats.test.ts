import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  bradleyTerry, cohensKappa, krippendorffAlpha, spearman, fleissKappa, benjaminiHochberg, bootstrapInterval, clusteredStandardError, EvalError,
  HARD_STATS_RESAMPLES, mcnemarExact, minimumDetectableEffect,
  pairedPermutationTest, pairedProportionPower, passAtK, passHatK, powerAnalysis, wilsonInterval,
} from "../index.js";
// @ts-expect-error The independent JavaScript benchmark has no TypeScript declarations.
import { mcnemar } from "../../../../../scripts/memory-bench/stats.mjs";

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value / values.length, 0);
const near = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const statsError = (run: () => unknown) => assert.throws(run,
  (error: unknown) => error instanceof EvalError && error.code === "ERR_PRISM_EVAL_STATS");

test("power_analysis_matches_known_table", () => {
  // SciPy 1.18.1: smallest integer n with
  // norm.cdf((-norm.isf(alpha/2)*sqrt(q)-sqrt(n)*d)/sqrt(q-d*d))
  // + norm.cdf((sqrt(n)*d-norm.isf(alpha/2)*sqrt(q))/sqrt(q-d*d)) >= power.
  for (const [baselinePassRate, minimumDetectableDrop, expectedDiscordance, alpha, power, items] of [
    [.85, .05, undefined, .05, .8, 909],
    [.9, .05, undefined, .05, .8, 689],
    [.95, .02, undefined, .05, .8, 2215],
    [.85, .05, .1, .05, .8, 312],
    [.85, .05, .1, .01, .9, 591],
  ] as const) {
    const options = { baselinePassRate, minimumDetectableDrop, expectedDiscordance, alpha, power };
    assert.deepEqual(powerAnalysis(options), { items });
    const p = baselinePassRate, d = minimumDetectableDrop;
    const q = expectedDiscordance ?? p * (1 - p + d) + (1 - p) * (p - d);
    assert.ok(pairedProportionPower({ discordantRate: q, effect: d, n: items, alpha }) >= power);
    assert.ok(pairedProportionPower({ discordantRate: q, effect: d, n: items - 1, alpha }) < power);
    assert.ok(minimumDetectableEffect({ discordantRate: q, n: items, alpha, power }) <= d);
  }
  assert.deepEqual(powerAnalysis({ baselinePassRate: .85, minimumDetectableDrop: .05 }), { items: 909 });
  assert.deepEqual(powerAnalysis({ baselinePassRate: 1, minimumDetectableDrop: 1 }), { items: 4 });
  assert.deepEqual(powerAnalysis({ baselinePassRate: 1, minimumDetectableDrop: 1, alpha: .9, power: .91 }), { items: 1 });
});

test("power_analysis_rejects_infeasible_or_unrepresentable_settings", () => {
  const valid = { baselinePassRate: .85, minimumDetectableDrop: .05 };
  for (const baselinePassRate of [NaN, Infinity, -.1, 0, 1.1]) statsError(() => powerAnalysis({ ...valid, baselinePassRate }));
  for (const minimumDetectableDrop of [NaN, Infinity, 0, -.1, .9, Number.MIN_VALUE]) {
    statsError(() => powerAnalysis({ ...valid, minimumDetectableDrop }));
  }
  for (const expectedDiscordance of [NaN, Infinity, 0, .01, .36, 1.1]) {
    statsError(() => powerAnalysis({ ...valid, expectedDiscordance }));
  }
  for (const alpha of [NaN, 0, 1, .8]) statsError(() => powerAnalysis({ ...valid, alpha }));
  for (const power of [NaN, 0, 1, .05]) statsError(() => powerAnalysis({ ...valid, power }));
});

// Reference calls below target SciPy 1.14 / statsmodels 0.14 APIs; constants also
// rechecked with SciPy 1.18.1 / statsmodels 0.15.0 (available on the local Python 3.14).

test("wilson_matches_statsmodels", () => {
  // statsmodels 0.14: proportion_confint(c, 20, alpha=.05, method="wilson")
  for (const [c, low, high] of [
    [0, 0, 0.16112515805281938],
    [18, 0.6989663547715127, 0.9721335187862318],
    [20, 0.8388748419471806, 1],
  ]) {
    const interval = wilsonInterval(c!, 20);
    near(interval.low, low!);
    near(interval.high, high!);
  }
  // proportion_confint(5, 10, alpha=.01, method="wilson")
  near(wilsonInterval(5, 10, .99).low, 0.1842255182472355);
});

test("clustered_se_equals_iid_for_singleton_clusters", () => {
  // scipy 1.14: stats.sem([1, 2, 3, 4])
  near(clusteredStandardError([1, 2, 3, 4], [0, 1, 2, 3]), 0.6454972243679028);
  near(clusteredStandardError([1, 1], [0, 1]), 0);
});

test("clustered_se_exceeds_iid_for_correlated_trials", () => {
  near(clusteredStandardError([0, 0, 1, 1], ["a", "a", "b", "b"]), .5);
  assert.ok(clusteredStandardError([0, 0, 1, 1], [0, 0, 1, 1]) >
    clusteredStandardError([0, 0, 1, 1], [0, 1, 2, 3]));
  // Unequal clusters: sqrt((2/1) * ((-.75)^2 + .75^2) / 4^2).
  near(clusteredStandardError([0, 1, 1, 1], [0, 1, 1, 1]), .375);
});

test("bootstrap_is_seeded_percentile_and_resamples_whole_clusters", () => {
  const values = [0, 0, 1, 1];
  const options = { statistic: mean, seed: 7, resamples: 2000 };
  assert.deepEqual(bootstrapInterval(values, options), bootstrapInterval(values, options));
  assert.deepEqual(bootstrapInterval(values, { ...options, clusterIds: [0, 0, 1, 1] }), { low: 0, high: 1 });
  assert.deepEqual(bootstrapInterval([3], options), { low: 3, high: 3 });
  const unequal = [0, 1, 1, 1];
  bootstrapInterval(unequal, { ...options, resamples: 20, clusterIds: [0, 1, 1, 1], statistic: (sample) => {
    assert.ok([2, 4, 6].includes(sample.length));
    assert.ok([0, .75, 1].some((expected) => Math.abs(mean(sample) - expected) < 1e-12));
    return mean(sample);
  } });
  // scipy.stats.bootstrap((arange(4),), mean, n_resamples=0, method="percentile",
  // confidence_level=.5, bootstrap_result=BootstrapResult(None, array([2.,3.,1.,0.]), None)).confidence_interval
  // The cached distribution is the four statistics from mulberry32(seed=1).
  const interval = bootstrapInterval([0, 1, 2, 3], { statistic: (sample) => sample[0]!, seed: 1, resamples: 4, confidence: .5 });
  assert.deepEqual(interval, { low: .75, high: 2.25 });
  assert.deepEqual(values, [0, 0, 1, 1]);
});

test("mcnemar_matches_memory_bench", () => {
  // Independent small-count binomial sum, retained after the benchmark shares our implementation.
  for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) {
    let choose = 1, tail = 1;
    for (let k = 1; k <= Math.min(a, b); k++) {
      choose *= (a + b - k + 1) / k;
      tail += choose;
    }
    near(mcnemarExact(a, b), Math.min(1, 2 * tail / 2 ** (a + b)));
  }
  for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) near(mcnemarExact(a, b), mcnemar(a, b));
  // scipy 1.14: stats.binomtest(2, 12, .5).pvalue
  near(mcnemarExact(2, 10), 0.03857421875);
  near(mcnemarExact(1000, 1000), 1);
});

test("pass_at_k_matches_codex_estimator_and_pass_hat_k", () => {
  near(passAtK(10, 3, 5), 11 / 12);
  near(passHatK(10, 3, 2), 1 / 15);
  const choose = (n: number, k: number) => {
    if (k > n) return 0;
    let result = 1;
    for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i;
    return result;
  };
  for (let n = 1; n <= 20; n++) for (let c = 0; c <= n; c++) for (let k = 1; k <= n; k++) {
    near(passAtK(n, c, k), 1 - choose(n - c, k) / choose(n, k));
    near(passHatK(n, c, k), choose(c, k) / choose(n, k));
    assert.equal(passHatK(n, c, k) === 1, c === n);
    near(passAtK(n, c, 1), c / n);
    near(passHatK(n, c, 1), c / n);
    assert.ok(passAtK(n, c, k) >= c / n - 1e-14);
    assert.ok(passHatK(n, c, k) <= c / n + 1e-14);
  }
  near(passAtK(1e12, 1, 1), 1e-12, 1e-24);
});

test("bh_matches_statsmodels", () => {
  // statsmodels 0.14: multipletests([.01,.04,.03,.002,.04,1,0], method="fdr_bh")[1]
  const q = benjaminiHochberg([.01, .04, .03, .002, .04, 1, 0]);
  [0.023333333333333334, .04666666666666667, .04666666666666667, .007, .04666666666666667, 1, 0]
    .forEach((expected, index) => near(q[index]!, expected));
});

test("permutation_is_exact_for_small_n", () => {
  // scipy 1.14: permutation_test((array([1,2,3]),), mean,
  // permutation_type="samples", n_resamples=inf).pvalue
  near(pairedPermutationTest([1, 2, 3], { seed: 7, resamples: 1 }), .25);
  near(pairedPermutationTest([0, 0], { seed: 7 }), 1);
  near(pairedPermutationTest([1, -1], { seed: 7 }), 1);
  near(pairedPermutationTest(Array(16).fill(1), { seed: 1 }), 2 / 65536);
  const differences = Array(17).fill(1);
  const options = { seed: 7, resamples: 100 };
  near(pairedPermutationTest(differences, options), 1 / 101);
  assert.equal(pairedPermutationTest(differences, options), pairedPermutationTest(differences, options));
});

test("power_and_mde_are_inverse", () => {
  const options = { discordantRate: .2, n: 500, alpha: .05 };
  const effect = minimumDetectableEffect({ ...options, power: .8 });
  near(pairedProportionPower({ ...options, effect }), .8);
  near(pairedProportionPower({ ...options, effect: 0 }), .05, 2e-7);
  near(pairedProportionPower({ ...options, effect: .05 }), 0.7065912544069975, 2e-7); // SciPy norm.cdf Connor formula
  near(pairedProportionPower({ ...options, effect: -.05 }), pairedProportionPower({ ...options, effect: .05 }));
  near(pairedProportionPower({ discordantRate: 1, n: 100, effect: 1 }), 1);
  // scipy.optimize.brentq(lambda d: Connor_power(q=1, n=3, d=d)-.1, .01, .6)
  near(minimumDetectableEffect({ discordantRate: 1, n: 3, power: .1 }), 0.4806623008849117, 2e-6);
  statsError(() => minimumDetectableEffect({ discordantRate: .001, n: 1, power: .8 }));
});

test("stats_reject_nan_and_empty", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    statsError(() => wilsonInterval(invalid, 10));
    statsError(() => clusteredStandardError([0, invalid], [0, 1]));
    statsError(() => bootstrapInterval([invalid], { statistic: mean, seed: 1 }));
    statsError(() => mcnemarExact(invalid, 1));
    statsError(() => pairedPermutationTest([invalid], { seed: 1 }));
    statsError(() => benjaminiHochberg([invalid]));
    statsError(() => passAtK(10, 2, invalid));
    statsError(() => passHatK(10, invalid, 1));
    statsError(() => pairedProportionPower({ discordantRate: .2, n: 20, effect: invalid }));
    statsError(() => minimumDetectableEffect({ discordantRate: .2, n: 20, power: invalid }));
  }
  for (const values of [[], [NaN], Array(2)]) {
    statsError(() => bootstrapInterval(values, { statistic: mean, seed: 1 }));
    statsError(() => pairedPermutationTest(values, { seed: 1 }));
    statsError(() => benjaminiHochberg(values));
  }
  for (const run of [
    () => wilsonInterval(2, 1), () => wilsonInterval(0, 0), () => wilsonInterval(1, 2, 1),
    () => clusteredStandardError([1], [0]), () => clusteredStandardError([1, 2], [0, 0]),
    () => clusteredStandardError([1, 2], [0]), () => clusteredStandardError([1, 2], [0, NaN]),
    () => bootstrapInterval([1], { statistic: () => NaN, seed: 1 }),
    () => bootstrapInterval([1], { statistic: () => { throw new Error("bad statistic"); }, seed: 1 }),
    () => bootstrapInterval([1], { statistic: mean, seed: .5 }),
    () => bootstrapInterval([1], { statistic: mean, seed: NaN }),
    () => bootstrapInterval([1], { statistic: mean, seed: 1, confidence: 0 }),
    () => bootstrapInterval([1], { statistic: mean, seed: 1, clusterIds: [] }),
    () => bootstrapInterval([1], { statistic: mean, seed: 1, clusterIds: [""] }),
    () => bootstrapInterval([1], { statistic: mean, seed: 1, resamples: HARD_STATS_RESAMPLES + 1 }),
    () => pairedPermutationTest([1], { seed: 1, resamples: 0 }),
    () => pairedPermutationTest([1], { seed: 1, resamples: HARD_STATS_RESAMPLES + 1 }),
    () => mcnemarExact(-1, 0), () => mcnemarExact(.5, 0),
    () => benjaminiHochberg([1.1]), () => passAtK(3, 4, 1), () => passHatK(3, 1, 4),
    () => passAtK(3, 1, 0), () => passHatK(0, 0, 1),
    () => pairedProportionPower({ discordantRate: .2, n: 20, effect: .3 }),
    () => pairedProportionPower({ discordantRate: 0, n: 20, effect: 0 }),
    () => pairedProportionPower({ discordantRate: 1.1, n: 20, effect: 0 }),
    () => pairedProportionPower({ discordantRate: .2, n: 0, effect: 0 }),
    () => pairedProportionPower({ discordantRate: .2, n: 20, effect: .1, alpha: 1 }),
    () => pairedProportionPower({ discordantRate: .2, n: 20, effect: .1, alpha: Number.MIN_VALUE }),
    () => minimumDetectableEffect({ discordantRate: .2, n: 20, power: .01 }),
    () => minimumDetectableEffect({ discordantRate: .2, n: 20, power: 1 }),
  ]) statsError(run);
});

test("bootstrap_1000_items_2000_resamples_with_headroom", () => {
  const start = performance.now();
  bootstrapInterval(Array.from({ length: 1000 }, (_, i) => i % 2), { statistic: mean, seed: 1 });
  assert.ok(performance.now() - start < 1000);
});


test("fleiss_kappa_matches_statsmodels", () => {
  // statsmodels.stats.inter_rater.fleiss_kappa (Fleiss 1971 example, 14 raters).
  const counts = [[0,0,0,0,14], [0,2,6,4,2], [0,0,3,5,6], [0,3,9,2,0], [2,2,8,1,1],
    [7,7,0,0,0], [3,2,6,3,0], [2,5,3,2,2], [6,5,2,1,0], [0,2,2,3,7]];
  const labels = counts.map(row => row.flatMap((count, category) => Array<string>(count).fill(String(category))));
  near(fleissKappa(labels)!, .20993070442195522, 1e-12);
  near(fleissKappa([["a", "b"], ["a", "b"]])!, -1);
  assert.equal(fleissKappa([["a", "a"], ["b", "b"]]), 1);
  assert.equal(fleissKappa([["a", "a"]]), undefined);
  assert.equal(fleissKappa([]), undefined);
  for (const labels of [[["a"]], [["a", "b"], ["a", "a", "b"]], [["", "b"]]]) {
    statsError(() => fleissKappa(labels));
  }
});

test("calibration_statistics_match_independent_references", () => {
  // sklearn 1.9.1 cohen_kappa_score (category indices), krippendorff 0.8.2 nominal alpha,
  // SciPy 1.18.1 spearmanr; generated with a=[0,0,1,1,2,2], b=[0,1,1,2,1,2].
  const a = [0, 0, .5, .5, 1, 1], b = [0, .5, .5, 1, .5, 1];
  near(cohensKappa(a, b)!, .2499999999999999);
  near(cohensKappa(a, b, true)!, .5714285714285714);
  near(krippendorffAlpha(a, b)!, .2978723404255319);
  near(spearman(a, b)!, .5809475019311127);
  near(cohensKappa([0, 1], [1, 0])!, -1);
  near(spearman([0, 1, 2], [2, 1, 0])!, -1);
  for (const statistic of [cohensKappa, krippendorffAlpha, spearman]) {
    assert.equal(statistic([], []), undefined);
    assert.equal(statistic([1, 1], [1, 1]), undefined);
    statsError(() => statistic([0], []));
    statsError(() => statistic([NaN], [0]));
    statsError(() => statistic([0], [Infinity]));
  }
});

test("bradley_terry_recovers_known_strengths_and_half_wins", () => {
  const pairs: { left: string; right: string; preference: "left" | "right" | "tie" }[] = [];
  for (const [left, right, wins, losses] of [["a", "b", 2, 1], ["a", "c", 4, 1], ["b", "c", 2, 1]] as const) {
    for (let i = 0; i < wins; i++) pairs.push({ left, right, preference: "left" });
    for (let i = 0; i < losses; i++) pairs.push({ left, right, preference: "right" });
  }
  const fit = bradleyTerry(pairs)!;
  near(fit.a!, 2); near(fit.b!, 1); near(fit.c!, .5);
  assert.deepEqual(bradleyTerry([{ left: "a", right: "b", preference: "tie" }]), { a: 1, b: 1 });
  assert.deepEqual(bradleyTerry([...pairs].reverse()), fit);
});

test("bradley_terry_reports_unidentifiable_evidence_and_validates_pairs", () => {
  assert.equal(bradleyTerry([]), null);
  assert.equal(bradleyTerry([{ left: "a", right: "b", preference: "left" }]), null);
  assert.equal(bradleyTerry([{ left: "a", right: "b", preference: "tie" },
    { left: "c", right: "d", preference: "tie" }]), null);
  statsError(() => bradleyTerry([{ left: "a", right: "a", preference: "tie" }]));
  statsError(() => bradleyTerry([{ left: "", right: "b", preference: "tie" }]));
  statsError(() => bradleyTerry([{ left: "a", right: "b", preference: "invalid" as "tie" }]));
});

test("bt_matches_reference_fit", () => {
  // Independently executed choix 0.3.6: exp(ilsr_pairwise(3, data, alpha=0,
  // max_iter=1000, tol=1e-12)); data = [(0,1)]*7+[(1,0)]*3+[(0,2)]*4+
  // [(2,0)]*2+[(1,2)]*5+[(2,1)]*6. No regularization; centered log parameters.
  const pairs: { left: string; right: string; preference: "left" }[] = [];
  for (const [left, right, count] of [["a", "b", 7], ["b", "a", 3], ["a", "c", 4],
    ["c", "a", 2], ["b", "c", 5], ["c", "b", 6]] as const) {
    for (let i = 0; i < count; i++) pairs.push({ left, right, preference: "left" });
  }
  const fit = bradleyTerry(pairs)!;
  near(fit.a!, 1.6684265648640442);
  near(fit.b!, .7090296635899472);
  near(fit.c!, .8453343149463673);
  near(Object.values(fit).reduce((product, value) => product * value, 1), 1);
});
