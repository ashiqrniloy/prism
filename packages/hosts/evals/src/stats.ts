import type { EvaluationRecord } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import { HARD_STATS_RESAMPLES } from "./limits.js";
import { mulberry32 } from "./scenarios.js";
import type { EstimateOnlineOptions, OnlineEstimate } from "./types.js";

type ClusterId = string | number;
type Interval = { low: number; high: number };

function paired(a: readonly number[], b: readonly number[]): void {
  check(a.length === b.length, "paired samples must have equal lengths");
  for (const value of a) finite(value);
  for (const value of b) finite(value);
}

/** Cohen (1960); quadratic weights use ranks in the sorted union of categories, as sklearn does. */
export function cohensKappa(a: readonly number[], b: readonly number[], quadratic = false): number | undefined {
  paired(a, b);
  if (!a.length) return undefined;
  const labels = [...new Set([...a, ...b])];
  if (quadratic) labels.sort((x, y) => x - y);
  const indices = new Map(labels.map((label, i) => [label, i]));
  const left = new Array<number>(labels.length).fill(0), right = [...left];
  let observed = 0;
  for (let i = 0; i < a.length; i++) {
    const x = indices.get(a[i]!)!, y = indices.get(b[i]!)!;
    left[x]!++; right[y]!++;
    observed += quadratic ? (x - y) ** 2 : Number(x !== y);
  }
  let expected = 0;
  if (quadratic) {
    let leftFirst = 0, rightFirst = 0, second = 0;
    for (let i = 0; i < labels.length; i++) {
      leftFirst += i * left[i]!; rightFirst += i * right[i]!;
      second += i * i * (left[i]! + right[i]!);
    }
    expected = second - 2 * leftFirst * rightFirst / a.length;
  } else {
    expected = a.length - left.reduce((sum, count, i) => sum + count * right[i]! / a.length, 0);
  }
  return expected === 0 ? undefined : 1 - observed / expected;
}

/** Krippendorff nominal alpha for two complete raters, with finite-population correction. */
export function krippendorffAlpha(a: readonly number[], b: readonly number[]): number | undefined {
  paired(a, b);
  if (!a.length) return undefined;
  const counts = new Map<number, number>();
  for (const values of [a, b]) for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const total = 2 * a.length;
  const expected = [...counts.values()].reduce((sum, count) => sum + count * (total - count), 0) / (total * (total - 1));
  const observed = a.reduce((sum, value, i) => sum + Number(value !== b[i]), 0) / a.length;
  return expected === 0 ? undefined : 1 - observed / expected;
}

/** Spearman's rho: Pearson correlation of average ranks, including tied observations. */
export function spearman(a: readonly number[], b: readonly number[]): number | undefined {
  paired(a, b);
  if (a.length < 2) return undefined;
  const ranks = (values: readonly number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
    const output = new Array<number>(values.length);
    for (let start = 0; start < order.length;) {
      let end = start + 1;
      while (end < order.length && order[end]!.value === order[start]!.value) end++;
      for (let i = start; i < end; i++) output[order[i]!.index] = (start + end - 1) / 2;
      start = end;
    }
    return output;
  };
  const x = ranks(a), y = ranks(b), mean = (a.length - 1) / 2;
  let covariance = 0, xx = 0, yy = 0;
  for (let i = 0; i < a.length; i++) {
    const dx = x[i]! - mean, dy = y[i]! - mean;
    covariance += dx * dy; xx += dx * dx; yy += dy * dy;
  }
  return xx === 0 || yy === 0 ? undefined : Math.max(-1, Math.min(1, covariance / Math.sqrt(xx * yy)));
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new EvalError(message, "ERR_PRISM_EVAL_STATS");
}

function finite(value: number): number {
  check(Number.isFinite(value), "statistics require finite values and results");
  return value;
}

function sample(values: readonly number[]): void {
  check(values.length > 0, "statistics require a nonempty sample");
  for (const value of values) finite(value);
}

function integer(value: number, minimum: number): void {
  check(Number.isSafeInteger(value) && value >= minimum, `expected a safe integer >= ${minimum}`);
}

function probability(value: number): void {
  check(Number.isFinite(value) && value > 0 && value < 1, "expected a probability strictly between 0 and 1");
}

function resampling(resamples: number, seed: number): () => number {
  integer(resamples, 1);
  check(resamples <= HARD_STATS_RESAMPLES, `resamples must not exceed ${HARD_STATS_RESAMPLES}`);
  check(Number.isSafeInteger(seed), "seed must be a safe integer");
  return mulberry32(seed);
}

function groups(values: readonly number[], ids: readonly ClusterId[]): number[][] {
  check(ids.length === values.length, "clusterIds must match the sample length");
  const grouped = new Map<ClusterId, number[]>();
  for (let i = 0; i < values.length; i++) {
    const id = ids[i]!;
    check((typeof id === "string" && id.length > 0) || (typeof id === "number" && Number.isFinite(id)),
      "cluster ids must be nonempty strings or finite numbers");
    const group = grouped.get(id);
    if (group) group.push(values[i]!);
    else grouped.set(id, [values[i]!]);
  }
  return [...grouped.values()];
}

// Acklam's inverse normal rational approximation (absolute error < 4e-9).
function normalQuantile(p: number): number {
  probability(p);
  if (p < .02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((-0.007784894002430293 * q - .3223964580411365) * q - 2.400758277161838) * q -
      2.549732539343734) * q + 4.374664141464968) * q + 2.938163982698783) /
      ((((.007784695709041462 * q + .3224671290700398) * q + 2.445134137142996) * q + 3.754408661907416) * q + 1);
  }
  if (p > 1 - .02425) return -normalQuantile(1 - p);
  const q = p - .5, r = q * q;
  return (((((-39.69683028665376 * r + 220.9460984245205) * r - 275.9285104469687) * r +
    138.357751867269) * r - 30.66479806614716) * r + 2.506628277459239) * q /
    (((((-54.47609879822406 * r + 161.5858368580409) * r - 155.6989798598866) * r +
      66.80131188771972) * r - 13.28068155288572) * r + 1);
}

// Abramowitz & Stegun 26.2.17, absolute CDF error < 7.5e-8.
function normalCdf(x: number): number {
  const t = 1 / (1 + .2316419 * Math.abs(x));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x < 0 ? tail : 1 - tail;
}

/** Wilson (1927): (p + z²/2n ± z sqrt(p(1-p)/n + z²/4n²)) / (1+z²/n). */
export function wilsonInterval(successes: number, n: number, confidence = .95): Interval {
  integer(n, 1);
  integer(successes, 0);
  check(successes <= n, "successes must not exceed n");
  probability(confidence);
  const z = -normalQuantile((1 - confidence) / 2), z2 = z * z, p = successes / n;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator;
  return { low: successes === 0 ? 0 : Math.max(0, center - radius), high: successes === n ? 1 : Math.min(1, center + radius) };
}

/** CR1: sqrt(G/(G-1) × Σ_g (Σ_i∈g (x_i-mean))² / N²). Miller (2024), §2.2 / Appendix A. */
export function clusteredStandardError(values: readonly number[], clusterIds: readonly ClusterId[]): number {
  sample(values);
  const clusters = groups(values, clusterIds);
  check(clusters.length >= 2, "standard error requires at least two clusters");
  const mean = values.reduce((sum, value) => sum + value / values.length, 0);
  const squares = clusters.reduce((sum, cluster) => {
    const residual = cluster.reduce((total, value) => total + (value - mean) / values.length, 0);
    return sum + residual * residual;
  }, 0);
  return finite(Math.sqrt(clusters.length / (clusters.length - 1) * squares));
}

/** Efron & Tibshirani (1993), percentile bootstrap: empirical α/2 and 1-α/2 quantiles.
 * Draw N observations or G whole clusters with replacement; unequal clusters retain their sizes.
 * Runtime is O(resamples × n) for a linear-time statistic, plus sorting the resampled statistics.
 */
export function bootstrapInterval(values: readonly number[], options: {
  statistic: (values: readonly number[]) => number;
  resamples?: number;
  confidence?: number;
  seed: number;
  clusterIds?: readonly ClusterId[];
}): Interval {
  sample(values);
  const { statistic, resamples = 2000, confidence = .95, seed, clusterIds } = options;
  probability(confidence);
  const random = resampling(resamples, seed);
  check(typeof statistic === "function", "statistic must be a function");
  const clusters = clusterIds === undefined ? undefined : groups(values, clusterIds);
  const draws = new Array<number>(resamples);
  const sampled: number[] = [];
  for (let i = 0; i < resamples; i++) {
    sampled.length = 0;
    if (clusters) {
      for (let j = 0; j < clusters.length; j++) {
        for (const value of clusters[Math.floor(random() * clusters.length)]!) sampled.push(value);
      }
    } else {
      for (let j = 0; j < values.length; j++) sampled.push(values[Math.floor(random() * values.length)]!);
    }
    try {
      draws[i] = finite(statistic(sampled));
    } catch (cause) {
      throw new EvalError("bootstrap statistic failed or returned a non-finite result", "ERR_PRISM_EVAL_STATS", { cause });
    }
  }
  draws.sort((a, b) => a - b);
  const quantile = (p: number) => {
    const index = (draws.length - 1) * p, lower = Math.floor(index), weight = index - lower;
    return finite(draws[lower]! * (1 - weight) + draws[Math.ceil(index)]! * weight);
  };
  return { low: quantile((1 - confidence) / 2), high: quantile(1 - (1 - confidence) / 2) };
}

/** McNemar (1947): min(1, 2 P[Binomial(aOnly+bOnly, .5) ≤ min(aOnly,bOnly)]). */
export function mcnemarExact(aOnly: number, bOnly: number): number {
  integer(aOnly, 0);
  integer(bOnly, 0);
  const n = aOnly + bOnly;
  integer(n, 0);
  if (!n) return 1;
  let logTerm = -n * Math.log(2), sum = 0;
  for (let k = 0; k <= Math.min(aOnly, bOnly); k++) {
    sum += Math.exp(logTerm);
    logTerm += Math.log(n - k) - Math.log(k + 1);
  }
  return Math.min(1, 2 * sum);
}

/** Fisher (1935), paired sign-flips: P(|Σ sign_i d_i| ≥ |Σ d_i|).
 * Enumerates all 2^n signs for n ≤ 16; otherwise uses (extreme+1)/(resamples+1).
 */
export function pairedPermutationTest(differences: readonly number[], options: { resamples?: number; seed: number }): number {
  sample(differences);
  const { resamples = 10000, seed } = options, random = resampling(resamples, seed);
  // Scaling keeps sums finite and comparisons invariant, even for very large finite inputs.
  let scale = 0;
  for (const value of differences) scale = Math.max(scale, Math.abs(value));
  if (scale === 0) return 1;
  const values = differences.map((value) => value / scale);
  const observed = Math.abs(values.reduce((sum, value) => sum + value, 0));
  const tolerance = 8 * Number.EPSILON * values.reduce((sum, value) => sum + Math.abs(value), 0);
  const exact = values.length <= 16, draws = exact ? 2 ** values.length : resamples;
  let extreme = 0;
  for (let i = 0; i < draws; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) sum += values[j]! * ((exact ? (i >>> j) & 1 : random() < .5) ? 1 : -1);
    if (Math.abs(sum) >= observed - tolerance) extreme++;
  }
  return exact ? extreme / draws : (extreme + 1) / (draws + 1);
}

/** Benjamini & Hochberg (1995): q_(i) = min_{j≥i}(1, m p_(j)/j), restored to input order. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  sample(pValues);
  check(pValues.every((p) => p >= 0 && p <= 1), "p-values must be in [0, 1]");
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(pValues.length);
  let next = 1;
  for (let i = order.length - 1; i >= 0; i--) {
    next = Math.min(next, order[i]!.p * (order.length / (i + 1)));
    adjusted[order[i]!.index] = next;
  }
  return adjusted;
}

function passParameters(n: number, c: number, k: number): void {
  integer(n, 1);
  integer(c, 0);
  integer(k, 1);
  check(c <= n && k <= n, "c and k must not exceed n");
}

/** Chen et al. (2021), §2.1: unbiased pass@k = 1 - C(n-c,k)/C(n,k), stable product. */
export function passAtK(n: number, c: number, k: number): number {
  passParameters(n, c, k);
  if (n - c < k) return 1;
  let logFailure = 0;
  // The equivalent c-factor product avoids iterating k times when successes are rare.
  if (c < k) {
    for (let i = n - c + 1; i <= n; i++) logFailure += Math.log1p(-k / i);
  } else {
    for (let i = 0; i < k; i++) logFailure += Math.log1p(-c / (n - i));
  }
  return -Math.expm1(logFailure) || 0;
}

/** Yao et al. (2024), τ-bench §3: pass^k = C(c,k)/C(n,k), all k draws succeed. */
export function passHatK(n: number, c: number, k: number): number {
  passParameters(n, c, k);
  if (c < k) return 0;
  if (c === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) result *= (c - i) / (n - i);
  return result;
}

function powerParameters(discordantRate: number, n: number, alpha: number): void {
  finite(discordantRate);
  check(discordantRate > 0 && discordantRate <= 1, "discordantRate must be in (0, 1]");
  integer(n, 1);
  probability(alpha);
}

/** Connor (1987), Biometrics 43:207–211, two-sided normal approximation (no continuity correction).
 * q=discordantRate, d=|effect|: Φ((-z√q-√n d)/√(q-d²)) + Φ((√n d-z√q)/√(q-d²)).
 */
export function pairedProportionPower(options: { discordantRate: number; effect: number; n: number; alpha?: number }): number {
  const { discordantRate: q, effect, n, alpha = .05 } = options;
  powerParameters(q, n, alpha);
  finite(effect);
  const d = Math.abs(effect);
  check(d <= q, "absolute effect must not exceed discordantRate");
  if (d === 0) return alpha;
  const cutoff = -normalQuantile(alpha / 2) * Math.sqrt(q), shift = Math.sqrt(n) * d;
  const sd = Math.sqrt(q - d * d);
  if (sd === 0) return shift > cutoff ? 1 : shift === cutoff ? .5 : 0;
  return Math.min(1, normalCdf((-cutoff - shift) / sd) + normalCdf((shift - cutoff) / sd));
}

/** Invert Connor's two-sided power by bisection on feasible |effect| ∈ [0, discordantRate].
 * Throws if the requested power is unattainable for this n and discordant rate.
 */
export function minimumDetectableEffect(options: { discordantRate: number; n: number; alpha?: number; power?: number }): number {
  const { discordantRate, n, alpha = .05, power = .8 } = options;
  powerParameters(discordantRate, n, alpha);
  probability(power);
  check(power > alpha, "target power must exceed alpha");
  const at = (effect: number) => pairedProportionPower({ discordantRate, n, alpha, effect });
  let low = 0, high = discordantRate;
  // At very small n the normal approximation can peak before the feasible endpoint.
  if (at(high) < power) {
    let left = 0, right = high;
    for (let i = 0; i < 60; i++) {
      const a = left + (right - left) / 3, b = right - (right - left) / 3;
      if (at(a) < at(b)) left = a;
      else right = b;
    }
    high = (left + right) / 2;
    check(at(high) >= power, "target power is unattainable at this n and discordantRate");
  }
  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;
    if (at(middle) < power) low = middle;
    else high = middle;
  }
  return high;
}

/** Invert Connor's paired-proportion power for the smallest integer item count.
 * Default discordance assumes independent baseline p and candidate p-drop outcomes;
 * pilot paired discordance is preferable. Counts use the two-sided normal approximation.
 */
export function powerAnalysis(options: {
  baselinePassRate: number;
  minimumDetectableDrop: number;
  alpha?: number;
  power?: number;
  expectedDiscordance?: number;
}): { items: number } {
  const { baselinePassRate: p, minimumDetectableDrop: d, alpha = .05, power = .8 } = options;
  finite(p);
  finite(d);
  check(p > 0 && p <= 1, "baselinePassRate must be in (0, 1]");
  check(d > 0 && d <= p, "minimumDetectableDrop must be positive and not exceed baselinePassRate");
  const q = options.expectedDiscordance ?? p * (1 - p + d) + (1 - p) * (p - d);
  powerParameters(q, 1, alpha);
  probability(power);
  check(power > alpha, "target power must exceed alpha");
  check(q >= d && q <= Math.min(2 * p - d, 2 * (1 - p) + d),
    "expectedDiscordance is infeasible for the baseline and candidate pass rates");
  const at = (n: number) => pairedProportionPower({ discordantRate: q, effect: d, n, alpha });
  let low = 0, high = 1;
  while (at(high) < power) {
    check(high < Number.MAX_SAFE_INTEGER, "required item count exceeds the safe integer range");
    low = high;
    high = Math.min(high * 2, Number.MAX_SAFE_INTEGER);
  }
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (at(middle) < power) low = middle;
    else high = middle;
  }
  return { items: high };
}


/** Maximize quality and minimize cost (Kapoor et al. 2024); equal points all survive. */
export function paretoFrontier<T>(
  reports: readonly T[],
  axes: { readonly quality: (report: T) => number; readonly cost: (report: T) => number },
): T[] {
  const points = reports.map(report => {
    const quality = finite(axes.quality(report)), cost = axes.cost(report);
    // Infinity represents unavailable billing, as in the report selection example.
    check(Number.isFinite(cost) || cost === Infinity, "Pareto cost must be finite or positive Infinity");
    return { report, quality, cost };
  }).sort((a, b) => a.cost - b.cost || b.quality - a.quality);
  let best = -Infinity, bestCost = Infinity;
  return points.filter(point => {
    if (point.quality < best || (point.quality === best && point.cost > bestCost)) return false;
    best = point.quality;
    bestCost = point.cost;
    return true;
  }).map(point => point.report);
}


/** Fleiss (1971): (observed pair agreement − chance agreement) / (1 − chance).
 * Rows are items, columns are judge labels; all rows need the same number of judges.
 * Matches statsmodels.stats.inter_rater.fleiss_kappa after counting categories per row.
 * Empty evidence or a single observed category has no defined chance-corrected κ.
 */
export function fleissKappa(labels: readonly (readonly string[])[]): number | undefined {
  if (!labels.length) return undefined;
  const raters = labels[0]!.length;
  integer(raters, 2);
  const totals = new Map<string, number>();
  let observed = 0;
  for (const row of labels) {
    check(row.length === raters, "Fleiss kappa requires the same number of raters per item");
    const counts = new Map<string, number>();
    for (const label of row) {
      check(typeof label === "string" && label.trim().length > 0, "judge labels must be nonempty strings");
      counts.set(label, (counts.get(label) ?? 0) + 1);
      totals.set(label, (totals.get(label) ?? 0) + 1);
    }
    for (const count of counts.values()) observed += count * (count - 1) / (raters * (raters - 1)) / labels.length;
  }
  if (totals.size === 1) return undefined;
  let chance = 0;
  for (const count of totals.values()) chance += (count / (raters * labels.length)) ** 2;
  return finite((observed - chance) / (1 - chance));
}

/** Hunter (2004): MM for Bradley–Terry, ties count as half wins.
 * Returns null without a strongly connected win graph or convergence in 1,000 steps.
 * Strengths have geometric mean 1; no pseudocounts or regularization are added.
 */
export function bradleyTerry(pairs: readonly {
  readonly left: string; readonly right: string; readonly preference: "left" | "right" | "tie";
}[]): Readonly<Record<string, number>> | null {
  const names = [...new Set(pairs.flatMap(pair => [pair.left, pair.right]))].sort();
  if (!names.length) return null;
  const indices = new Map(names.map((name, i) => [name, i]));
  const n = names.length, wins = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const pair of pairs) {
    check(typeof pair.left === "string" && pair.left.trim().length > 0 &&
      typeof pair.right === "string" && pair.right.trim().length > 0 && pair.left !== pair.right &&
      ["left", "right", "tie"].includes(pair.preference), "invalid Bradley–Terry pair");
    const i = indices.get(pair.left)!, j = indices.get(pair.right)!;
    wins[i]![j]! += pair.preference === "left" ? 1 : pair.preference === "tie" ? .5 : 0;
    wins[j]![i]! += pair.preference === "right" ? 1 : pair.preference === "tie" ? .5 : 0;
  }
  // Reachability in both directions from one vertex proves strong connectivity.
  for (const reverse of [false, true]) {
    const seen = new Set([0]), pending = [0];
    while (pending.length) {
      const i = pending.pop()!;
      for (let j = 0; j < n; j++) {
        if ((reverse ? wins[j]![i]! : wins[i]![j]!) > 0 && !seen.has(j)) {
          seen.add(j); pending.push(j);
        }
      }
    }
    if (seen.size !== n) return null;
  }
  const totals = wins.map(row => row.reduce((sum, value) => sum + value, 0));
  let strengths = new Array<number>(n).fill(1);
  for (let iteration = 0; iteration < 1000; iteration++) {
    const next = totals.map((total, i) => {
      let denominator = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) denominator += (wins[i]![j]! + wins[j]![i]!) / (strengths[i]! + strengths[j]!);
      }
      return total / denominator;
    });
    const center = next.reduce((sum, value) => sum + Math.log(value) / n, 0);
    let change = 0;
    for (let i = 0; i < n; i++) {
      next[i] = Math.exp(Math.log(next[i]!) - center);
      if (!Number.isFinite(next[i]) || next[i]! <= 0) return null;
      change = Math.max(change, Math.abs(Math.log(next[i]! / strengths[i]!)));
    }
    strengths = next;
    if (change < 1e-9) return Object.fromEntries(names.map((name, i) => [name, strengths[i]!]));
  }
  return null;
}

/** Horvitz & Thompson (1952); Hájek (1971) ratio estimator: (Σ y_i/π_i) / (Σ 1/π_i), with percentile bootstrap CI. */
export function estimateOnline(
  records: readonly EvaluationRecord[],
  options?: EstimateOnlineOptions,
): OnlineEstimate {
  check(Array.isArray(records) && records.length > 0, "estimateOnline requires a nonempty record array");
  const requestedScorerId = options?.scorerId;
  if (requestedScorerId !== undefined) {
    check(typeof requestedScorerId === "string" && requestedScorerId.trim().length > 0, "scorerId must be a nonempty string");
  }
  const matching =
    requestedScorerId === undefined
      ? records
      : records.filter((record) => record && record.scorerId === requestedScorerId);
  check(matching.length > 0, "estimateOnline requires at least one record for the scorer");
  const scorerIds = new Set(matching.map((record) => record?.scorerId));
  check(
    scorerIds.size === 1 && typeof matching[0]?.scorerId === "string" && matching[0].scorerId.trim().length > 0,
    "estimateOnline requires a single scorerId or options.scorerId",
  );
  const scorerId = matching[0]!.scorerId;

  const scores: number[] = [];
  const weights: number[] = [];
  const strata = new Map<string, { n: number; weightedSum: number; weightSum: number }>();

  for (const record of matching) {
    const sampling = record.metadata?.sampling as { stratum?: unknown; probability?: unknown } | undefined;
    check(
      Boolean(
        sampling &&
          typeof sampling === "object" &&
          !Array.isArray(sampling) &&
          typeof sampling.stratum === "string" &&
          sampling.stratum.trim().length > 0 &&
          typeof sampling.probability === "number" &&
          Number.isFinite(sampling.probability) &&
          sampling.probability > 0 &&
          sampling.probability <= 1,
      ),
      "estimateOnline requires metadata.sampling with a nonempty stratum and probability in (0, 1]",
    );
    if (record.status !== "scored") continue;
    check(
      record.sampled !== false &&
        typeof record.score === "number" &&
        Number.isFinite(record.score) &&
        record.score >= 0 &&
        record.score <= 1,
      "scored evaluation record must have a finite score in [0, 1]",
    );
    const weight = 1 / (sampling!.probability as number);
    const score = record.score;
    const stratum = sampling!.stratum as string;
    scores.push(score);
    weights.push(weight);
    const bucket = strata.get(stratum) ?? { n: 0, weightedSum: 0, weightSum: 0 };
    bucket.n += 1;
    bucket.weightedSum += weight * score;
    bucket.weightSum += weight;
    strata.set(stratum, bucket);
  }

  check(scores.length > 0, "estimateOnline requires at least one scored record");
  const indices = scores.map((_, index) => index);
  const hajek = (drawn: readonly number[]): number => {
    let weightedSum = 0;
    let weightSum = 0;
    for (const index of drawn) {
      const weight = weights[index]!;
      weightedSum += weight * scores[index]!;
      weightSum += weight;
    }
    return weightedSum / weightSum;
  };
  const mean = finite(hajek(indices));
  const ci95 = bootstrapInterval(indices, {
    statistic: hajek,
    seed: options?.seed ?? 0,
    ...(options?.resamples === undefined ? {} : { resamples: options.resamples }),
    ...(options?.confidence === undefined ? {} : { confidence: options.confidence }),
  });
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const weightSqSum = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const effectiveN = finite((weightSum * weightSum) / weightSqSum);
  const byStratum = Object.fromEntries(
    [...strata.entries()].map(([stratum, bucket]) => [
      stratum,
      { n: bucket.n, mean: finite(bucket.weightedSum / bucket.weightSum), weightSum: finite(bucket.weightSum) },
    ]),
  );
  return { scorerId, n: scores.length, effectiveN, mean, ci95, byStratum };
}
