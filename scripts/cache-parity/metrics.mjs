/**
 * Pure metric and verdict functions for the cache-parity runner. No I/O, no clock, no network.
 *
 * Token accounting follows plan 182 Task 4's inclusive rule, applied by the wire proxy's own reader:
 * `inputTokens` already contains the cache-read and cache-write tokens, so
 * `hitRate = cacheRead / promptTokens` is a share of the whole prompt.
 */

/** A run that ends with the task done in at least this share of runs counts as "solved" for the cell. */
const SOLVED_SHARE = 2 / 3;

export function median(values) {
  const numbers = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const mid = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 1 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;
}

export function spread(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/** Parse the proxy's `--usage-log` JSONL. A malformed line is a hard error: silent loss would bias the rate. */
export function parseUsageLog(text) {
  const entries = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      throw new Error(`usage log line ${index + 1} is not JSON`);
    }
  }
  // The proxy appends when a reply finishes, so file order can differ from request order.
  return entries.sort((a, b) => (a.exchange ?? 0) - (b.exchange ?? 0));
}

const isGeneration = (entry) => entry.status >= 200 && entry.status < 300;

/**
 * Metrics for one run, from the proxy log only. A non-2xx exchange is counted in `failedRequests` and
 * contributes no tokens: the upstream did not bill a prompt for it.
 */
export function runMetrics(entries, taskSolved) {
  const served = entries.filter(isGeneration);
  const sum = (list, key) => list.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
  const rate = (list) => {
    const prompt = sum(list, "inputTokens");
    return prompt > 0 ? sum(list, "cacheReadTokens") / prompt : null;
  };
  return {
    requests: served.length,
    failedRequests: entries.length - served.length,
    promptTokens: sum(served, "inputTokens"),
    cacheRead: sum(served, "cacheReadTokens"),
    cacheWrite: sum(served, "cacheWriteTokens"),
    hitRate: rate(served),
    firstTurnExcludedHitRate: served.length > 1 ? rate(served.slice(1)) : null,
    taskSolved: taskSolved === true,
  };
}

/** The `turn.completed` usage figures, in order, from a Prism JSONL stream. Failed attempts carry none. */
export function prismTurnUsages(events) {
  const turns = [];
  for (const event of events) {
    if (event?.type !== "turn.completed" || event.error !== undefined || event.usage === undefined) continue;
    turns.push({
      inputTokens: event.usage.inputTokens ?? 0,
      cacheReadTokens: event.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: event.usage.cacheWriteTokens ?? 0,
    });
  }
  return turns;
}

/**
 * pi's `--mode json` usage is a second source. Its buckets are disjoint, so the inclusive prompt
 * total is `input + cacheRead + cacheWrite`.
 */
export function piTurnUsages(events) {
  const turns = [];
  for (const event of events) {
    const message = event?.message;
    if (event?.type !== "message_end" || message?.role !== "assistant" || message.usage === undefined) continue;
    const { input = 0, cacheRead = 0, cacheWrite = 0 } = message.usage;
    turns.push({ inputTokens: input + cacheRead + cacheWrite, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite });
  }
  return turns;
}

/** Compare a harness's own figures with the proxy's per request. Returns `null` on agreement. */
export function compareUsage(reported, entries) {
  const served = entries.filter(isGeneration);
  if (reported.length !== served.length) {
    return `request count differs: harness ${reported.length}, proxy ${served.length}`;
  }
  for (const [index, turn] of reported.entries()) {
    const entry = served[index];
    const fields = [
      ["inputTokens", "inputTokens"],
      ["cacheReadTokens", "cacheReadTokens"],
      ["cacheWriteTokens", "cacheWriteTokens"],
    ];
    for (const [mine, theirs] of fields) {
      if ((turn[mine] ?? 0) !== (entry[theirs] ?? 0)) {
        return `request ${index + 1} ${mine}: harness ${turn[mine] ?? 0}, proxy ${entry[theirs] ?? 0}`;
      }
    }
  }
  return null;
}

const solvedEnough = (runs) => runs.length > 0 && runs.filter((run) => run.metrics.taskSolved).length / runs.length >= SOLVED_SHARE;

function harnessSummary(runs, comparable) {
  const used = comparable ? runs.filter((run) => run.metrics.taskSolved) : runs;
  const rates = used.map((run) => run.metrics.hitRate);
  const warm = used.map((run) => run.metrics.firstTurnExcludedHitRate);
  return {
    runs: runs.length,
    solved: runs.filter((run) => run.metrics.taskSolved).length,
    comparedRuns: used.length,
    hitRate: { median: median(rates), spread: spread(rates) },
    firstTurnExcludedHitRate: { median: median(warm), spread: spread(warm) },
    requests: { median: median(used.map((run) => run.metrics.requests)), spread: spread(used.map((run) => run.metrics.requests)) },
  };
}

/**
 * One cell's verdict. `runs` is `{ prism: Run[], pi: Run[] }`; a run is `{ status, metrics }`.
 *
 * - `usage_mismatch`: any Prism run whose usage events disagree with the proxy. A Prism bug, never averaged away.
 * - `inconclusive`: either harness solved fewer than two of three runs, so the comparison would measure a failed task.
 * - `pass` / `behind`: Prism's median hitRate against pi's, over solved runs only.
 */
export function cellVerdict(runs) {
  const prism = runs.prism ?? [];
  const pi = runs.pi ?? [];
  const mismatch = prism.find((run) => run.status === "usage_mismatch");
  const comparable = solvedEnough(prism) && solvedEnough(pi);
  const summary = { prism: harnessSummary(prism, comparable), pi: harnessSummary(pi, comparable) };
  if (mismatch !== undefined)
    return { verdict: "usage_mismatch", reason: mismatch.detail ?? "usage events disagree with the proxy", ...summary };
  if (!comparable) {
    return { verdict: "inconclusive", reason: "a harness solved fewer than two of three runs", ...summary };
  }
  const mine = summary.prism.hitRate.median;
  const theirs = summary.pi.hitRate.median;
  if (mine === null || theirs === null) {
    return { verdict: "unmeasurable", reason: "no cache counts reported", ...summary };
  }
  return { verdict: mine >= theirs ? "pass" : "behind", ...summary };
}

/** Per-cell request budget: runs × harnesses × per-run ceiling (3 × 2 × 20 = 120 by default). */
export function requestBudget({ runs = 3, harnesses = 2, perRun = 20 } = {}) {
  return runs * harnesses * perRun;
}

/** Verdicts that fail the gate in every mode: a measured shortfall or a Prism/runner defect. */
const HARD_FAIL = new Set(["behind", "usage_mismatch", "budget_exceeded", "reference_config_mutated"]);
/** Verdicts that fail only in strict mode: the comparison could not be made. `deferred` never fails. */
const STRICT_FAIL = new Set(["inconclusive", "unmeasurable"]);

/**
 * The parity gate over a list of cells `{ id, verdict, reason? }` (the verdict is `cellVerdict`'s, or the
 * runner's abort verdict, or `deferred`). It passes when every conclusive cell is `pass`: Prism's median
 * hitRate is at least pi's, and no Prism run reported `usage_mismatch`. There is no tolerance margin
 * (owner: "at least equal"); noise is handled by medians and one rerun of an inconclusive cell.
 */
export function parityGate(cells, { strict = false } = {}) {
  const failures = [];
  for (const cell of cells) {
    if (cell.verdict === "pass" || cell.verdict === "deferred") continue;
    if (HARD_FAIL.has(cell.verdict) || (strict && STRICT_FAIL.has(cell.verdict))) {
      failures.push({ id: cell.id, verdict: cell.verdict, reason: cell.reason ?? null });
    } else if (!STRICT_FAIL.has(cell.verdict)) {
      failures.push({ id: cell.id, verdict: String(cell.verdict), reason: cell.reason ?? "unknown verdict" });
    }
  }
  return { pass: failures.length === 0, failures };
}

/**
 * Whether a cell should be rerun once: only an `inconclusive` verdict on a first attempt. Anything else is
 * either a pass or a finding to investigate (plan 215 Task 24), never averaged away by a retry.
 */
export function shouldRerun(verdict, attempt) {
  return verdict === "inconclusive" && attempt === 0;
}
