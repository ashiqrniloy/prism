/**
 * Plan 218.3 Task 9: Session-Bench's scorer and its pre-registered analysis.
 *
 * Blind scoring (G7): `scoreRows` reads rows keyed by session, task and check, and refuses any row that names an arm;
 * the runner scores each arm's rows apart and attaches the arm to the result afterwards. Pre-registered analysis (G8):
 * `ANALYSIS` fixes the metrics, the comparisons, the statistic and its seeds before any arm runs; `compareArms` reports
 * every comparison and every metric, never a subset.
 */
import { pairedClusterPermutation } from "../stats.mjs";
import { CHECK_CLASSES } from "./checks.mjs";

/** The pre-registered analysis (G8). Positive `diff` means the second arm of a pair is better. */
export const ANALYSIS = Object.freeze({
  version: "session-bench-analysis-v1",
  unit: "check or task, paired by id across arms; sessions are the clusters",
  statistic:
    "pairedClusterPermutation (scripts/memory-bench/stats.mjs): cluster bootstrap 95% interval of the mean paired difference, sign-flip p",
  iterations: 10_000,
  seed: 7,
  metrics: Object.freeze(["task", ...CHECK_CLASSES]),
  comparisons: Object.freeze([
    ["memory-off-llm", "STM-only"],
    ["STM-only", "STM+WM"],
    ["memory-off-llm", "STM+WM"],
  ]),
  reported:
    "every arm's descriptive scores, every comparison above and every metric, plus re-derivation calls, whole-run tokens per passed task and the prompt-cache share",
});

const ARM_FIELDS = ["arm", "arms", "config", "configHash"];

function assertBlind(rows, what) {
  for (const row of rows)
    for (const field of ARM_FIELDS)
      if (Object.hasOwn(row, field)) throw new Error(`SessionBenchScore: ${what} rows must not name the arm (G7: blind scoring)`);
}

const rate = (pass, total) => (total ? pass / total : null);

/**
 * Score one arm's rows. `checks`: `{ session, task, check, class, pass }`; `tasks`: `{ session, task, rederivations,
 * toolCalls }`. Returns per-session and overall scores, per class, and the paired units for `compareArms`.
 */
export function scoreRows({ checks, tasks = [] }) {
  assertBlind(checks, "check");
  assertBlind(tasks, "task");
  const taskPass = new Map();
  for (const row of checks) {
    const key = `${row.session}:${row.task}`;
    taskPass.set(key, (taskPass.get(key) ?? true) && Boolean(row.pass));
  }
  const sessions = {};
  for (const row of checks) {
    const s = (sessions[row.session] ??= { tasks: 0, tasksPassed: 0, classes: {} });
    const c = (s.classes[row.class] ??= { pass: 0, total: 0 });
    c.total++;
    if (row.pass) c.pass++;
  }
  for (const [key, pass] of taskPass) {
    const s = sessions[key.split(":")[0]];
    s.tasks++;
    if (pass) s.tasksPassed++;
  }
  for (const row of tasks) {
    const s = sessions[row.session];
    if (!s) continue;
    s.rederivations = (s.rederivations ?? 0) + row.rederivations;
    s.toolCalls = (s.toolCalls ?? 0) + row.toolCalls;
  }
  const overall = { tasks: 0, tasksPassed: 0, classes: {}, rederivations: 0, toolCalls: 0 };
  for (const s of Object.values(sessions)) {
    overall.tasks += s.tasks;
    overall.tasksPassed += s.tasksPassed;
    overall.rederivations += s.rederivations ?? 0;
    overall.toolCalls += s.toolCalls ?? 0;
    for (const [cls, c] of Object.entries(s.classes)) {
      const o = (overall.classes[cls] ??= { pass: 0, total: 0 });
      o.pass += c.pass;
      o.total += c.total;
    }
  }
  for (const c of Object.values(overall.classes)) c.rate = rate(c.pass, c.total);
  overall.taskRate = rate(overall.tasksPassed, overall.tasks);
  const units = {
    task: [...taskPass].map(([id, pass]) => ({ id, cluster: id.split(":")[0], value: Number(pass) })),
    ...Object.fromEntries(
      CHECK_CLASSES.map((cls) => [
        cls,
        checks
          .filter((row) => row.class === cls)
          .map((row) => ({ id: `${row.session}:${row.check}`, cluster: row.session, value: Number(row.pass) })),
      ]),
    ),
  };
  return { sessions, overall, units };
}

/**
 * The pre-registered comparisons over scored arms (`{ [arm]: scoreRows(...) }`). A comparison whose arms did not both
 * run is reported `not-run`, never dropped; a metric with no units is `empty`.
 */
export function compareArms(scored, { comparisons = ANALYSIS.comparisons, iterations = ANALYSIS.iterations, seed = ANALYSIS.seed } = {}) {
  return comparisons.map(([a, b]) => {
    if (!scored[a] || !scored[b]) return { a, b, status: "not-run" };
    const metrics = Object.fromEntries(
      ANALYSIS.metrics.map((metric) => {
        const left = scored[a].units[metric];
        const right = scored[b].units[metric];
        if (!left.length) return [metric, { status: "empty" }];
        return [metric, { n: left.length, ...pairedClusterPermutation(left, right, { iterations, seed }) }];
      }),
    );
    return { a, b, status: "compared", metrics };
  });
}

/** G8: a report must carry every arm that ran, every pre-registered comparison and every metric. */
export function assertCompleteReport(report) {
  const arms = Object.keys(report.scores ?? {});
  for (const arm of report.arms ?? [])
    if (!arms.includes(arm)) throw new Error(`SessionBenchScore: arm ${arm} is missing from the report (G8)`);
  if ((report.comparisons ?? []).length !== ANALYSIS.comparisons.length)
    throw new Error("SessionBenchScore: a pre-registered comparison is missing (G8)");
  for (const row of report.comparisons)
    if (row.status === "compared")
      for (const metric of ANALYSIS.metrics)
        if (!row.metrics?.[metric]) throw new Error(`SessionBenchScore: ${row.a} vs ${row.b} lacks ${metric} (G8)`);
  return true;
}
