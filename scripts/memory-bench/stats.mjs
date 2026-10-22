import { improvementDelta, METRIC_VERSION, metricDefinition, metricValue } from "./metrics.mjs";

/** Two-sided exact binomial McNemar, including the no-discordance case. */
export function mcnemar(aOnly, bOnly) {
  const n = aOnly + bOnly;
  if (!n) return 1;
  let logTerm = -n * Math.log(2),
    sum = 0;
  for (let k = 0; k <= Math.min(aOnly, bOnly); k++) {
    sum += Math.exp(logTerm);
    logTerm += Math.log(n - k) - Math.log(k + 1);
  }
  return Math.min(1, 2 * sum);
}
function randomSource(seed) {
  if (!Number.isSafeInteger(seed)) throw new Error("Statistics requires an integer seed");
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
}
function checkIterations(iterations) {
  if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error("Statistics requires positive iterations");
}
function clusterKey(row, cluster) {
  const key = cluster(row);
  if (!(typeof key === "string" && key.length) && !(typeof key === "number" && Number.isFinite(key))) {
    throw new Error("Statistics requires a nonempty string or finite numeric cluster key");
  }
  return key;
}
function aggregate(items, cluster, metric) {
  if (!items.length) throw new Error("Statistics requires nonempty items");
  const groups = new Map();
  for (const item of items) {
    const key = clusterKey(item, cluster),
      value = metric(item);
    if (!Number.isFinite(value)) throw new Error("Statistics requires finite metrics");
    const group = groups.get(key) ?? { sum: 0, n: 0 };
    group.sum += value;
    group.n++;
    groups.set(key, group);
  }
  return [...groups.values()];
}
function bootstrapGroups(groups, iterations, seed) {
  checkIterations(iterations);
  const random = randomSource(seed),
    samples = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0,
      n = 0;
    for (let j = 0; j < groups.length; j++) {
      const group = groups[Math.floor(random() * groups.length)];
      sum += group.sum;
      n += group.n;
    }
    samples.push(sum / n);
  }
  samples.sort((a, b) => a - b);
  const quantile = (p) => {
    const index = (samples.length - 1) * p,
      low = Math.floor(index);
    return samples[low] + (samples[Math.ceil(index)] - samples[low]) * (index - low);
  };
  return {
    estimate: groups.reduce((sum, group) => sum + group.sum, 0) / groups.reduce((n, group) => n + group.n, 0),
    ci95: [quantile(0.025), quantile(0.975)],
  };
}

/** Resample whole clusters; the estimand is the item-weighted mean of metric(row). */
export function clusterBootstrap(items, { cluster = (row) => row.cluster, metric = metricValue, iterations = 10000, seed = 7 } = {}) {
  return bootstrapGroups(aggregate(items, cluster, metric), iterations, seed);
}
function pairRows(a, b, cluster) {
  const index = new Map(b.map((row) => [row.id, row]));
  if (!a.length || a.length !== b.length || index.size !== b.length || new Set(a.map((row) => row.id)).size !== a.length)
    throw new Error("Statistics requires unique paired ids");
  return a.map((row) => {
    const other = index.get(row.id);
    if (row.id === undefined || !other || clusterKey(row, cluster) !== clusterKey(other, cluster)) {
      throw new Error("Statistics requires matching paired ids and clusters");
    }
    return { cluster: clusterKey(row, cluster), value: metricValue(other) - metricValue(row) };
  });
}
function signFlipP(values, iterations, seed) {
  const observed = Math.abs(values.reduce((sum, value) => sum + value, 0));
  const sums = values.filter((value) => value !== 0);
  const exact = sums.length <= 16,
    draws = exact ? 2 ** sums.length : iterations;
  const random = randomSource(seed);
  let extreme = 0;
  for (let i = 0; i < draws; i++) {
    let sum = 0;
    for (let j = 0; j < sums.length; j++) sum += sums[j] * ((exact ? (i >>> j) & 1 : random() < 0.5) ? 1 : -1);
    if (Math.abs(sum) >= observed) extreme++;
  }
  return exact ? extreme / draws : (extreme + 1) / (draws + 1);
}

/** Positive diff means B improves on A. Swap arms once per cluster, never per session. */
export function pairedClusterPermutation(a, b, { cluster = (row) => row.cluster, iterations = 10000, seed = 7 } = {}) {
  const pairs = pairRows(a, b, cluster);
  const groups = aggregate(
    pairs,
    (row) => row.cluster,
    (row) => row.value,
  );
  const { estimate: diff, ci95 } = bootstrapGroups(groups, iterations, seed);
  return {
    diff,
    ci95,
    p: signFlipP(
      groups.map((group) => group.sum),
      iterations,
      seed,
    ),
  };
}

export function holm(pValues) {
  if (pValues.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("Statistics requires p-values in [0, 1]");
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = [];
  let previous = 0;
  order.forEach(({ p, index }, rank) => {
    previous = Math.min(1, Math.max(previous, p * (order.length - rank)));
    adjusted[index] = previous;
  });
  return adjusted;
}
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail =
    (Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

/** Approximate two-sided alpha=.05 power, equal-size clusters, independent arms. Retained for historical receipts. */
export function powerForDiff({ baseline, diff, clusters, icc, clusterSize = 1 }) {
  if (
    ![baseline, diff, clusters, icc, clusterSize].every(Number.isFinite) ||
    baseline < 0 ||
    baseline > 1 ||
    baseline + diff < 0 ||
    baseline + diff > 1 ||
    !Number.isSafeInteger(clusters) ||
    clusters < 1 ||
    icc < 0 ||
    icc > 1 ||
    clusterSize < 1
  ) {
    throw new Error("Statistics requires valid proportions, clusters, ICC, and cluster size");
  }
  if (diff === 0) return 0.05;
  const effectiveN = (clusters * clusterSize) / (1 + (clusterSize - 1) * icc);
  const alternative = baseline + diff;
  const variance = (baseline * (1 - baseline) + alternative * (1 - alternative)) / effectiveN;
  if (!variance) return 1;
  const shift = Math.abs(diff) / Math.sqrt(variance);
  return normalCdf(-1.959963984540054 - shift) + 1 - normalCdf(1.959963984540054 - shift);
}

function normalRandom(random) {
  const u = Math.max(random(), Number.MIN_VALUE),
    v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Prospective power for the analysis actually used: simulate paired cluster differences
 * and re-run the exact sign-flip test. `icc=1` means no within-cluster noise, so only
 * clusters (not repeated sessions) add information.
 */
export function pairedPowerSimulation({
  baseline = 0.5,
  diff = 0,
  clusters = 12,
  clusterSize = 8,
  icc = 0.5,
  simulations = 200,
  iterations = 2000,
  seed = 7,
  alpha = 0.05,
} = {}) {
  if (
    ![baseline, diff, clusters, clusterSize, icc, alpha].every(Number.isFinite) ||
    baseline < 0 ||
    baseline > 1 ||
    baseline + diff < 0 ||
    baseline + diff > 1 ||
    !Number.isSafeInteger(clusters) ||
    clusters < 1 ||
    clusterSize < 1 ||
    icc < 0 ||
    icc > 1 ||
    alpha <= 0 ||
    alpha >= 1
  ) {
    throw new Error("Statistics requires valid paired simulation inputs");
  }
  if (!Number.isSafeInteger(simulations) || simulations < 1) throw new Error("Statistics requires positive simulations");
  checkIterations(iterations);
  const random = randomSource(seed);
  // The paired difference removes the cluster intercept; only residual noise remains.
  const withinSd = Math.sqrt((2 * (1 - icc)) / clusterSize);
  let significant = 0;
  for (let simulation = 0; simulation < simulations; simulation++) {
    const values = Array.from({ length: clusters }, () => diff + withinSd * normalRandom(random));
    if (signFlipP(values, iterations, (seed + simulation * 7919) >>> 0) < alpha) significant++;
  }
  return significant / simulations;
}

function reportIdentity(report) {
  return {
    metricVersion: report.metricVersion ?? null,
    protocolHash: report.protocolHash ?? null,
    dataset: report.dataset?.sha256 ?? report.dataset?.revision ?? report.dataset?.url ?? null,
  };
}
function assertCompatible(a, b) {
  const left = reportIdentity(a),
    right = reportIdentity(b);
  if (a.metricVersion !== undefined && b.metricVersion !== undefined && left.metricVersion !== right.metricVersion) {
    throw new Error(`Comparison requires the same metric version (${left.metricVersion} vs ${right.metricVersion})`);
  }
  if (left.protocolHash && right.protocolHash && left.protocolHash !== right.protocolHash) {
    throw new Error("Comparison refuses reports from different frozen protocols");
  }
  if (left.dataset && right.dataset && left.dataset !== right.dataset) {
    throw new Error("Comparison refuses reports from different datasets");
  }
}

/** The minimum independent clusters our frozen protocol allows a confirmatory claim on. */
export const CONFIRMATORY_MIN_CLUSTERS = 8;

export function compare(a, b, { iterations = 10000, seed = 7, icc = 1, simulations = 200 } = {}) {
  const index = new Map(b.results.map((row) => [row.id, row]));
  const clustered = [...a.results, ...b.results].some((row) => Object.hasOwn(row, "cluster"));
  const cluster = clustered ? (row) => row.cluster : (row) => row.id;
  if (
    !a.results.length ||
    a.judgeProtocol !== b.judgeProtocol ||
    (a.judge && b.judge && a.judge !== b.judge) ||
    a.suite !== b.suite ||
    a.subset !== b.subset ||
    a.results.some((row) => !index.has(row.id) || index.get(row.id).ability !== row.ability)
  ) {
    throw new Error("Comparison requires paired, uniquely identified, scored questions from the same suite/subset");
  }
  assertCompatible(a, b);
  pairRows(a.results, b.results, cluster);
  const grouped = new Map();
  for (const row of a.results) {
    if (!grouped.has(row.ability)) grouped.set(row.ability, []);
    grouped.get(row.ability).push(row);
  }
  const groups = {};
  for (const [ability, rows] of grouped) {
    const other = rows.map((row) => index.get(row.id));
    const booleanPair = rows.every((row, i) => typeof row.correct === "boolean" && typeof other[i].correct === "boolean");
    const aOnly = booleanPair ? rows.filter((row, i) => row.correct && !other[i].correct).length : null;
    const bOnly = booleanPair ? rows.filter((row, i) => !row.correct && other[i].correct).length : null;
    const definition = metricDefinition(ability);
    const inference = clustered
      ? pairedClusterPermutation(rows, other, { cluster, iterations, seed })
      : booleanPair
        ? (() => {
            const pairs = pairRows(rows, other, cluster);
            const { estimate: diff, ci95 } = clusterBootstrap(pairs, { metric: (row) => row.value, iterations, seed });
            return { diff, ci95, p: mcnemar(aOnly, bOnly) };
          })()
        : pairedClusterPermutation(rows, other, { cluster, iterations, seed });
    const clusters = new Set(rows.map(cluster)).size;
    const valuesA = rows.map(metricValue),
      valuesB = other.map(metricValue);
    const meanA = valuesA.reduce((sum, value) => sum + value, 0) / valuesA.length;
    const meanB = valuesB.reduce((sum, value) => sum + value, 0) / valuesB.length;
    const power = pairedPowerSimulation({
      baseline: meanA,
      diff: inference.diff,
      clusters,
      clusterSize: rows.length / clusters,
      icc,
      simulations,
      seed,
    });
    const metricVersion = a.metricVersion ?? b.metricVersion ?? null;
    Object.defineProperty(groups, ability, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        n: rows.length,
        denominator: rows.length,
        aOnly,
        bOnly,
        ...inference,
        rawMeans: { a: meanA, b: meanB },
        improvementDelta: improvementDelta(meanA, meanB, definition.direction),
        metric: ability,
        metricVersion,
        definition: definition.definition,
        unit: definition.unit,
        direction: definition.direction,
        clusters,
        clusterUnit: clustered ? (a.clusterUnit ?? "row") : "question",
        method: clustered || !booleanPair ? "paired-cluster-signflip" : "mcnemar",
        power,
        powerAssumptions: {
          method: "paired-cluster-signflip-simulation",
          icc,
          clusterSize: rows.length / clusters,
          clusters,
          alpha: 0.05,
          simulations,
          independentArms: false,
        },
        confirmatory:
          metricVersion === METRIC_VERSION &&
          a.status === "completed" &&
          b.status === "completed" &&
          a.usageComplete !== false &&
          b.usageComplete !== false &&
          clusters >= CONFIRMATORY_MIN_CLUSTERS &&
          !definition.unregistered,
      },
    });
  }
  const adjusted = holm(Object.values(groups).map((group) => group.p));
  Object.values(groups).forEach((group, i) => {
    group.pHolm = adjusted[i];
  });
  return groups;
}
