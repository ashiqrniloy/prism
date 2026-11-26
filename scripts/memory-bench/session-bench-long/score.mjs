/**
 * Plan 218.5 Task 6: the long bench's pre-registered analysis (`ANALYSIS_LONG`, G8) and its verdict (`longVerdict`).
 *
 * Scoring stays blind (G7): units are built from check rows that never name an arm (`../session-bench/score.mjs`
 * `scoreRows` refuses one), and the arm is attached afterwards. The statistic is `../stats.mjs`
 * `pairedClusterPermutation` (paired by check or task id, sessions as clusters, 10,000 resamples, seed 7), and Holm's
 * step-down (`holm`) sets the level of each WM arm's interval. `longVerdict` is a pure function of the units and the
 * cost per passed task, so every branch is tested on synthetic units (`verdict.test.mjs`).
 *
 * Pooling (owner-facing choice, Task 4 finding 4): the bucket metrics `before` and `after` pool `D1`–`D4` only, so both
 * buckets hold the same class mix (1 : 3 : 1 : 3). `D2R` exists in `after` only and is reported as its own metric.
 */

import { scoreRows } from "../session-bench/score.mjs";
import { clusterBootstrap, holm, pairedClusterPermutation } from "../stats.mjs";
import { DEPENDENCY_CLASSES, LONG_CHECK_CLASSES, REVOKE_CLASS } from "./checks.mjs";

/** The classes the bucket metrics pool: every dependency class but the revoke (Task 4 finding 4). */
export const POOLED_CLASSES = Object.freeze(DEPENDENCY_CLASSES.filter((cls) => cls !== REVOKE_CLASS));
export const BUCKETS = Object.freeze(["before", "after"]);
/**
 * Jobs whose `C` checks the control guard leaves out (plan 218.5 Task 7, owner 2026-11-25). In the pilot nearly every
 * `C` failure in every arm was `count-errors` (the main model counting `ERROR` lines in a 6-9K-token log): `amnesic`,
 * with no memory, failed it most, and two arms that were identical until task 98 failed it 5 and 18 times on one
 * session. It measures the model's counting, not memory, so it stays in `C` and `task` but not in `C-stable`.
 */
export const NOISY_JOBS = Object.freeze(["count-errors"]);
/** The control metric: `C` checks of every job but {@link NOISY_JOBS}. */
export const CONTROL_METRIC = "C-stable";
/**
 * The pressure-relative `after` bucket (analysis v3, owner 2026-11-26). WM can only help once STM's pool is past its
 * bound, and the task where that happens moves with the memory worker's recording rate (Task 7: 75-90, then 93-102).
 * So an `after` check is scored only at or past {@link PRESSURE_ARM}'s first pool overflow in its session plus
 * {@link PRESSURE_MARGIN_TASKS}, and a session where that arm never overflowed scores no `after` check. `before` is
 * unchanged. The rows keep their generator bucket; only the units leave the early checks out.
 */
export const PRESSURE_ARM = "STM-only";
export const PRESSURE_MARGIN_TASKS = 10;

/**
 * The first task each session's `after` checks are scored from: `firstOverflowTask + margin` of the pressure arm's
 * instrumentation summary (`report.pressure[PRESSURE_ARM]`), or null when it never overflowed.
 */
export function pressureTasksFrom(summaries = {}, margin = PRESSURE_MARGIN_TASKS) {
  return Object.fromEntries(
    Object.entries(summaries).map(([id, summary]) => [
      id,
      typeof summary?.firstOverflowTask === "number" ? summary.firstOverflowTask + margin : null,
    ]),
  );
}

/** The pre-registered analysis (G8). Positive `diff` means the second arm of a pair is better. */
export const ANALYSIS_LONG = Object.freeze({
  version: "session-bench-long-analysis-v3",
  unit: "check or task, paired by id across arms; sessions are the clusters",
  statistic:
    "pairedClusterPermutation (scripts/memory-bench/stats.mjs): cluster bootstrap interval of the mean paired difference, sign-flip p",
  iterations: 10_000,
  seed: 7,
  alpha: 0.05,
  metrics: Object.freeze([
    "task",
    ...LONG_CHECK_CLASSES,
    CONTROL_METRIC,
    ...BUCKETS,
    ...BUCKETS.flatMap((b) => POOLED_CLASSES.map((cls) => `${b}:${cls}`)),
  ]),
  pooled: "before and after pool D1-D4 only (same class mix in both buckets); D2R is its own metric (after only)",
  pressure:
    "after (pooled, per class, and D2R) scores a check only at or past STM-only's first pool overflow in its session plus 10 tasks (pressureTasksFrom); a session where STM-only never overflowed scores no after check",
  control: "C-stable: the C checks of every job but count-errors (NOISY_JOBS); every check row of class C carries its task's job",
  comparisons: Object.freeze([
    ["STM-only", "STM-only-protect"],
    ["STM-only", "STM+WM"],
    ["STM-only", "STM+WM-deterministic"],
    ["STM-only-protect", "STM+WM"],
    ["STM-only-protect", "STM+WM-deterministic"],
    ["memory-off-llm", "STM-only"],
    ["memory-off-llm", "STM-only-protect"],
    ["mem0", "STM-only"],
    ["mem0", "STM-only-protect"],
  ]),
  reported:
    "every arm's scores per class and bucket, every comparison above on every metric, whole-run tokens per passed task, the pressure counts and the after checks each session scored, and the effect detectable at N",
});

/** The pre-registered decision (plan 218.5 Task 6; owner, Task 2: the three-way rule). Points are fractions. */
export const LONG_DECISION = Object.freeze({
  reference: Object.freeze({
    base: "STM-only",
    candidate: "STM-only-protect",
    metric: "after",
    dependencyLowerAbove: 0,
    controlLowerAbove: -0.05,
    text: "STM-only-protect becomes the reference, and protect-user the eviction default, if it beats STM-only on after dependency checks (95% lower bound > 0) and its C-stable lower bound is > -5 points; otherwise the reference is STM-only",
  }),
  wm: Object.freeze({
    arms: Object.freeze(["STM+WM", "STM+WM-deterministic"]),
    metric: "after",
    keepLowerAbove: 0,
    controlLowerAbove: -0.05,
    maxCostRatio: 1.5,
    dropUpperBelow: 0.05,
    cost: "whole-run tokens (main and workers, input and output, plus embeddings) per passed task",
    text: "Each WM arm against the reference on after dependency checks, Holm-adjusted over the two WM arms. Keep WM if a WM arm's lower bound is > 0, its C-stable lower bound > -5 points and its whole-run tokens per passed task <= 1.5x the reference's (the best such arm sets WM's default policy under a host scope). Drop WM if both WM arms' upper bounds are < +5 points. Otherwise the owner decides",
  }),
  baselines: Object.freeze({
    arms: Object.freeze(["memory-off-llm", "mem0"]),
    metric: "after",
    beatsLowerAbove: 0,
    controlLowerAbove: -0.05,
    text: "The reference against each baseline (memory-off-llm: LLM compaction; mem0) on after dependency checks, Holm-adjusted over the two baselines. The memory system beats a baseline if the reference's lower bound is > 0 and its C-stable lower bound > -5 points. Dev sessions decide the configuration only; the claim is read on held-out sessions (a later rule)",
  }),
  stmAtLength: Object.freeze({
    against: "memory-off-llm",
    text: "if reference - memory-off-llm has a lower bound <= 0 on after while before's lower bound is > 0, the report sends a P1 STM finding to the owner",
  }),
});

/** (z_0.975 + z_0.8): the 80%-power, two-sided 5% detectable effect. */
const Z_DETECT = 1.959963984540054 + 0.8416212335729143;

/**
 * One arm's paired units from its rows: `task`, every class, the pooled buckets and each pooled class per bucket.
 * `checks` rows are blind (`scoreRows` refuses a row naming an arm).
 */
export function longUnits({ checks, tasks = [] }, { pressureTasks } = {}) {
  const scored = scoreRows({ checks, tasks });
  const unit = (row) => ({ id: `${row.session}:${row.check}`, cluster: row.session, value: Number(row.pass) });
  // Analysis v3: with `pressureTasks` (by session), an `after` row counts only at or past its session's task.
  const inBucket = (row, bucket) => {
    if (row.bucket !== bucket) return false;
    if (bucket !== "after" || !pressureTasks) return true;
    const from = pressureTasks[row.session];
    return typeof from === "number" && row.task >= from;
  };
  const units = { task: scored.units.task };
  for (const cls of LONG_CHECK_CLASSES)
    units[cls] = checks.filter((row) => row.class === cls && (cls !== REVOKE_CLASS || inBucket(row, "after"))).map(unit);
  units[CONTROL_METRIC] = checks.filter((row) => row.class === "C" && !NOISY_JOBS.includes(row.job)).map(unit);
  for (const bucket of BUCKETS) {
    units[bucket] = checks.filter((row) => inBucket(row, bucket) && POOLED_CLASSES.includes(row.class)).map(unit);
    for (const cls of POOLED_CLASSES)
      units[`${bucket}:${cls}`] = checks.filter((row) => inBucket(row, bucket) && row.class === cls).map(unit);
  }
  return { overall: scored.overall, sessions: scored.sessions, units };
}

const shared = (left, right) => {
  const ids = new Set(right.task.map((unit) => unit.cluster));
  return new Set(left.task.map((unit) => unit.cluster).filter((id) => ids.has(id)));
};
const only = (units, keep) =>
  Object.fromEntries(Object.entries(units).map(([key, list]) => [key, list.filter((u) => keep.has(u.cluster))]));

/**
 * A cluster bootstrap interval at `level` over paired differences (`{ cluster, value }`). `stats.mjs` reports 95% only,
 * and its file is pinned by earlier audits, so the wider Holm level is read here with the same estimator: resample whole
 * sessions, the item-weighted mean, percentile bounds. Seeded like `stats.mjs` (mulberry32 on `seed`).
 */
export function clusterInterval(rows, { level, iterations = ANALYSIS_LONG.iterations, seed = ANALYSIS_LONG.seed }) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.cluster) ?? { sum: 0, n: 0 };
    group.sum += row.value;
    group.n++;
    groups.set(row.cluster, group);
  }
  const list = [...groups.values()];
  if (!list.length) throw new Error("SessionBenchLongScore: an interval needs rows");
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < list.length; j++) {
      const group = list[Math.floor(random() * list.length)];
      sum += group.sum;
      n += group.n;
    }
    samples.push(sum / n);
  }
  samples.sort((a, b) => a - b);
  const quantile = (p) => {
    const index = (samples.length - 1) * p;
    const low = Math.floor(index);
    return samples[low] + (samples[Math.ceil(index)] - samples[low]) * (index - low);
  };
  const tail = (1 - level) / 2;
  return [quantile(tail), quantile(1 - tail)];
}

/** The paired statistic, with its interval at `level` (95%: the statistic's own; wider: `clusterInterval`). */
function pairedAt(left, right, { level, iterations, seed }) {
  const base = pairedClusterPermutation(left, right, { iterations, seed });
  if (level === 0.95) return { ...base, ci: base.ci95, level };
  const index = new Map(right.map((row) => [row.id, row]));
  const diffs = left.map((row) => ({ cluster: row.cluster, value: index.get(row.id).value - row.value }));
  return { ...base, ci: clusterInterval(diffs, { level, iterations, seed }), level };
}

/** Per-session rate differences (b − a) on one metric: the detectable effect and the bucket interaction read these. */
function sessionDiffs(left, right) {
  const rate = (units) => {
    const by = {};
    for (const unit of units) {
      const row = (by[unit.cluster] ??= { pass: 0, total: 0 });
      row.total++;
      row.pass += unit.value;
    }
    return by;
  };
  const l = rate(left);
  const r = rate(right);
  return Object.fromEntries(
    Object.keys(l)
      .filter((id) => r[id])
      .map((id) => [id, r[id].pass / r[id].total - l[id].pass / l[id].total]),
  );
}
const sdOf = (values) => {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

/**
 * One comparison of arm `b` against arm `a` (positive: `b` better), paired on the sessions both finished, on every
 * metric at 95%, plus `levels` (metric → interval level) for the Holm-adjusted reads.
 */
export function compareLong(units, [a, b], { iterations = ANALYSIS_LONG.iterations, seed = ANALYSIS_LONG.seed, levels = {} } = {}) {
  if (!units[a] || !units[b]) return { a, b, status: "not-run" };
  const keep = shared(units[a], units[b]);
  if (!keep.size) return { a, b, status: "not-run" };
  const left = only(units[a], keep);
  const right = only(units[b], keep);
  const metrics = {};
  for (const metric of ANALYSIS_LONG.metrics) {
    if (!left[metric]?.length) {
      metrics[metric] = { status: "empty" };
      continue;
    }
    metrics[metric] = {
      n: left[metric].length,
      ...pairedAt(left[metric], right[metric], { level: levels[metric] ?? 0.95, iterations, seed }),
    };
  }
  const after = Object.values(sessionDiffs(left.after, right.after));
  const sd = sdOf(after);
  return {
    a,
    b,
    status: "compared",
    sessions: keep.size,
    metrics,
    detectableEffect: sd === null ? null : (Z_DETECT * sd) / Math.sqrt(after.length),
  };
}

/**
 * The owner's hypothesis read directly: (b − a on `after`) − (b − a on `before`), per session, with a session bootstrap
 * 95% interval. Positive: `b`'s gain grows with distance.
 */
export function bucketInteraction(units, [a, b], { iterations = ANALYSIS_LONG.iterations, seed = ANALYSIS_LONG.seed } = {}) {
  if (!units[a] || !units[b]) return null;
  const after = sessionDiffs(units[a].after, units[b].after);
  const before = sessionDiffs(units[a].before, units[b].before);
  const rows = Object.keys(after)
    .filter((id) => id in before)
    .map((id) => ({ cluster: id, value: after[id] - before[id] }));
  if (!rows.length) return null;
  const { estimate, ci95 } = clusterBootstrap(rows, { metric: (row) => row.value, iterations, seed });
  return { sessions: rows.length, diff: estimate, ci95 };
}

const lower = (row, metric) => row?.metrics?.[metric]?.ci?.[0];
const upper = (row, metric) => row?.metrics?.[metric]?.ci?.[1];

/**
 * The verdict (pure). `input.units[arm]` are `longUnits(...).units`; `input.costPerPassedTask[arm]` the whole-run tokens
 * per passed task. Returns step 1 (the reference), step 2 (keep / drop / owner), step 3 (the reference against each
 * baseline: beats / not shown) and the STM-at-length finding.
 */
export function longVerdict(input, { decision = LONG_DECISION, iterations = ANALYSIS_LONG.iterations, seed = ANALYSIS_LONG.seed } = {}) {
  const { units, costPerPassedTask = {} } = input;
  const options = { iterations, seed };
  // Step 1: the STM reference.
  const ref = decision.reference;
  const step1 = compareLong(units, [ref.base, ref.candidate], options);
  const protectWins =
    step1.status === "compared" &&
    lower(step1, ref.metric) > ref.dependencyLowerAbove &&
    lower(step1, CONTROL_METRIC) > ref.controlLowerAbove;
  const reference = protectWins ? ref.candidate : ref.base;
  // Step 2: each WM arm against the reference; Holm's step-down over the two arms' sign-flip p on `after`.
  const wm = decision.wm;
  const alpha = ANALYSIS_LONG.alpha;
  const raw = wm.arms.map((arm) => compareLong(units, [reference, arm], options));
  const ran = raw.filter((row) => row.status === "compared" && row.metrics[wm.metric]?.p !== undefined);
  let levels = {};
  if (ran.length === wm.arms.length) {
    const p = raw.map((row) => row.metrics[wm.metric].p);
    const adjusted = holm(p);
    const order = p.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
    // Holm's step-down as intervals: the arm with the smaller p reads a 1 - alpha/2 interval; the other a 1 - alpha
    // interval only when the first was rejected, else 1 - alpha/2 as well.
    const firstRejected = adjusted[order[0].index] < alpha;
    levels = Object.fromEntries(
      order.map(({ index }, rank) => [index, rank === 0 || !firstRejected ? 1 - alpha / 2 : 1 - alpha]).map(([i, l]) => [wm.arms[i], l]),
    );
    levels.adjustedP = Object.fromEntries(wm.arms.map((arm, index) => [arm, adjusted[index]]));
  }
  const refCost = costPerPassedTask[reference] ?? null;
  const arms = wm.arms.map((arm, index) => {
    const level = levels[arm] ?? 1 - alpha / 2;
    const row =
      raw[index].status === "compared"
        ? compareLong(units, [reference, arm], { ...options, levels: { [wm.metric]: level, [CONTROL_METRIC]: level } })
        : raw[index];
    const cost = costPerPassedTask[arm] ?? null;
    const costRatio = refCost && cost ? cost / refCost : null;
    const compared = row.status === "compared";
    const keeps =
      compared &&
      lower(row, wm.metric) > wm.keepLowerAbove &&
      lower(row, CONTROL_METRIC) > wm.controlLowerAbove &&
      costRatio !== null &&
      costRatio <= wm.maxCostRatio;
    return {
      arm,
      status: row.status,
      level,
      adjustedP: levels.adjustedP?.[arm] ?? null,
      after: compared ? row.metrics[wm.metric] : null,
      control: compared ? row.metrics[CONTROL_METRIC] : null,
      task: compared ? row.metrics.task : null,
      costPerPassedTask: cost,
      costRatio,
      keeps,
      underDropBound: compared && upper(row, wm.metric) < wm.dropUpperBelow,
      detectableEffect: compared ? row.detectableEffect : null,
      interaction: bucketInteraction(units, [reference, arm], options),
    };
  });
  const complete = arms.every((row) => row.status === "compared");
  const keepers = arms.filter((row) => row.keeps).sort((x, y) => y.after.diff - x.after.diff);
  const outcome = !complete ? "incomplete" : keepers.length ? "keep" : arms.every((row) => row.underDropBound) ? "drop" : "owner";
  // The STM-at-length finding.
  const length = compareLong(units, [decision.stmAtLength.against, reference], options);
  const stmAtLength =
    length.status === "compared" && lower(length, "after") <= 0 && lower(length, "before") > 0
      ? { finding: "P1", text: `${reference} - memory-off-llm: after lower bound <= 0 while before's is > 0` }
      : null;
  // Step 3: the reference against each baseline (positive diff: the reference is better), Holm over the baselines.
  const base = decision.baselines;
  const step3Raw = base.arms.map((arm) => compareLong(units, [arm, reference], options));
  let baseLevels = {};
  if (step3Raw.every((row) => row.status === "compared" && row.metrics[base.metric]?.p !== undefined)) {
    const p = step3Raw.map((row) => row.metrics[base.metric].p);
    const adjusted = holm(p);
    const order = p.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
    const firstRejected = adjusted[order[0].index] < alpha;
    baseLevels = Object.fromEntries(
      order.map(({ index }, rank) => [base.arms[index], rank === 0 || !firstRejected ? 1 - alpha / 2 : 1 - alpha]),
    );
    baseLevels.adjustedP = Object.fromEntries(base.arms.map((arm, index) => [arm, adjusted[index]]));
  }
  const baselines = base.arms.map((arm, index) => {
    const level = baseLevels[arm] ?? 1 - alpha / 2;
    const row =
      step3Raw[index].status === "compared"
        ? compareLong(units, [arm, reference], { ...options, levels: { [base.metric]: level, [CONTROL_METRIC]: level } })
        : step3Raw[index];
    const compared = row.status === "compared";
    const beats = compared && lower(row, base.metric) > base.beatsLowerAbove && lower(row, CONTROL_METRIC) > base.controlLowerAbove;
    return {
      baseline: arm,
      status: row.status,
      level,
      adjustedP: baseLevels.adjustedP?.[arm] ?? null,
      after: compared ? row.metrics[base.metric] : null,
      before: compared ? (row.metrics.before ?? null) : null,
      control: compared ? row.metrics[CONTROL_METRIC] : null,
      task: compared ? row.metrics.task : null,
      outcome: !compared ? "incomplete" : beats ? "beats" : "not-shown",
    };
  });
  return {
    analysis: ANALYSIS_LONG.version,
    step1: {
      base: ref.base,
      candidate: ref.candidate,
      status: step1.status,
      after: step1.metrics?.after ?? null,
      control: step1.metrics?.[CONTROL_METRIC] ?? null,
      protectWins,
      reference,
      evictionDefault: protectWins ? "protect-user" : "relevance",
      rule: ref.text,
    },
    step2: {
      reference,
      referenceCostPerPassedTask: refCost,
      arms,
      outcome,
      wmDefaultPolicy: outcome === "keep" ? (keepers[0].arm === "STM+WM" ? "model" : "deterministic") : null,
      rule: wm.text,
    },
    stmAtLength: {
      comparison: length.status === "compared" ? { after: length.metrics.after, before: length.metrics.before } : null,
      finding: stmAtLength,
    },
    step3: { reference, baselines, rule: base.text },
    summary: {
      reference,
      evictionDefault: protectWins ? "protect-user" : "relevance",
      wm: outcome,
      baselines: Object.fromEntries(baselines.map((row) => [row.baseline, row.outcome])),
      stmAtLengthFinding: Boolean(stmAtLength),
    },
  };
}
