import { type RunResult, resolveRedactor } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import {
  DEFAULT_CANDIDATE_MAX_BYTES,
  DEFAULT_COMPARISON_CANDIDATES,
  DEFAULT_JUDGE_MAX_OUTPUT_BYTES,
  HARD_CANDIDATE_MAX_BYTES,
  HARD_COMPARISON_CANDIDATES,
  HARD_JUDGE_MAX_OUTPUT_BYTES,
} from "./limits.js";
import { resolveTrialsConfig } from "./scenarios.js";
import { bootstrapInterval, bradleyTerry } from "./stats.js";
import type { ComparisonRecord, ComparisonReport, RunComparisonOptions } from "./types.js";
import { mapPool, normalizeConcurrency, toErrorInfo } from "./util.js";

/** Run every named candidate per item/trial, then score every stable candidate pair. */
export async function runComparison<TInput = unknown, TExpected = unknown>(
  options: RunComparisonOptions<TInput, TExpected>,
): Promise<ComparisonReport> {
  const candidates = Object.keys(options.candidates).sort();
  const maxCandidates = options.maxCandidates ?? DEFAULT_COMPARISON_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 2 || maxCandidates > HARD_COMPARISON_CANDIDATES) {
    throw new EvalError(`maxCandidates must be an integer in [2, ${HARD_COMPARISON_CANDIDATES}]`, "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
  }
  if (candidates.length < 2 || candidates.length > maxCandidates || !options.scorers.length) {
    throw new EvalError("comparison requires bounded candidates and at least one scorer", "ERR_PRISM_EVAL_COMPARISON");
  }
  const boundedBytes = (value: number | undefined, fallback: number, hard: number, name: string) => {
    const selected = value ?? fallback;
    if (!Number.isInteger(selected) || selected < 1 || selected > hard)
      throw new EvalError(`${name} is out of bounds`, "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
    return selected;
  };
  const maxCandidateBytes = boundedBytes(
    options.maxCandidateBytes,
    DEFAULT_CANDIDATE_MAX_BYTES,
    HARD_CANDIDATE_MAX_BYTES,
    "maxCandidateBytes",
  );
  const maxScorerOutputBytes = boundedBytes(
    options.maxScorerOutputBytes,
    DEFAULT_JUDGE_MAX_OUTPUT_BYTES,
    HARD_JUDGE_MAX_OUTPUT_BYTES,
    "maxScorerOutputBytes",
  );
  const { count: trials } = resolveTrialsConfig(options.trials, options.seed);
  if (options.seed !== undefined && !Number.isSafeInteger(options.seed))
    throw new EvalError("seed must be a safe integer", "ERR_PRISM_EVAL_TRIALS");
  const scorerIds = options.scorers.map((scorer) => scorer.id);
  if (scorerIds.some((id) => !id.trim()) || new Set(scorerIds).size !== scorerIds.length)
    throw new EvalError("comparison scorer ids must be nonempty and unique", "ERR_PRISM_EVAL_COMPARISON");
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const perItem = await mapPool(
    options.dataset.items,
    normalizeConcurrency(options.concurrency),
    async (item) => {
      const records: ComparisonRecord[] = [];
      for (let trialIndex = 0; trialIndex < trials; trialIndex++) {
        const results = new Map<string, RunResult>();
        const errors = new Map<string, unknown>();
        await Promise.all(
          candidates.map(async (name) => {
            try {
              options.signal?.throwIfAborted();
              const result = await options.candidates[name]!(item, options.signal);
              if (Buffer.byteLength(JSON.stringify(result)) > maxCandidateBytes)
                throw new EvalError("candidate output byte limit exceeded", "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
              if (result.status === "failed" || result.status === "aborted")
                throw result.error ?? new Error(`candidate run ${result.status}`);
              results.set(name, result);
            } catch (error) {
              errors.set(name, error);
            }
          }),
        );
        for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
            const left = candidates[leftIndex]!;
            const right = candidates[rightIndex]!;
            for (const scorer of options.scorers) {
              try {
                options.signal?.throwIfAborted();
                if (errors.has(left) && errors.has(right)) throw errors.get(left);
                if (errors.has(left) || errors.has(right)) {
                  records.push({
                    itemId: item.id,
                    trialIndex,
                    scorerId: scorer.id,
                    left,
                    right,
                    status: "scored",
                    preference: errors.has(left) ? "right" : "left",
                    metadata: { forfeit: errors.has(left) ? left : right },
                  });
                  continue;
                }
                const output = await scorer.score({
                  left: { name: left, result: results.get(left)! },
                  right: { name: right, result: results.get(right)! },
                  item,
                  signal: options.signal,
                  redactor,
                });
                if (Buffer.byteLength(JSON.stringify(output)) > maxScorerOutputBytes)
                  throw new EvalError("pairwise scorer output byte limit exceeded", "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
                if (!(["left", "right", "tie"] as const).includes(output.preference)) {
                  throw new EvalError("invalid pairwise preference", "ERR_PRISM_EVAL_COMPARISON_RESULT");
                }
                records.push({
                  itemId: item.id,
                  trialIndex,
                  scorerId: scorer.id,
                  left,
                  right,
                  preference: output.preference,
                  status: "scored",
                  reason: output.reason,
                  metadata: output.metadata,
                });
              } catch (error) {
                records.push({
                  itemId: item.id,
                  trialIndex,
                  scorerId: scorer.id,
                  left,
                  right,
                  status: "failed",
                  error: toErrorInfo(error),
                });
              }
            }
          }
        }
      }
      return records;
    },
    options.signal,
  );
  const records = perItem.flat();
  const safe = redactor ? redactor.redact(records) : records;
  const wins = Object.fromEntries(candidates.map((name) => [name, 0]));
  let ties = 0;
  let failures = 0;
  for (const record of safe) {
    if (record.status === "failed") failures += 1;
    else if (record.preference === "tie") ties += 1;
    else if (record.preference) wins[record.preference === "left" ? record.left : record.right]! += 1;
  }
  const consistency = new Map<string, { consistent: number; total: number }>();
  for (const record of records) {
    if (record.status !== "scored" || typeof record.metadata?.positionInconsistent !== "boolean") continue;
    const counts = consistency.get(record.scorerId) ?? { consistent: 0, total: 0 };
    counts.total++;
    if (!record.metadata.positionInconsistent) counts.consistent++;
    consistency.set(record.scorerId, counts);
  }
  const positionConsistency = Object.fromEntries([...consistency].map(([id, counts]) => [id, counts.consistent / counts.total]));
  const ranking = rankComparisons(records, candidates, scorerIds, options.seed ?? 0);
  return {
    ranking: redactor ? redactor.redact(ranking) : ranking,
    positionConsistency,
    datasetId: options.dataset.id,
    datasetVersion: options.dataset.version,
    candidates,
    records: safe,
    wins,
    ties,
    failures,
  };
}

function rankComparisons(
  records: readonly ComparisonRecord[],
  candidates: readonly string[],
  scorerIds: readonly string[],
  seed: number,
): ComparisonReport["ranking"] {
  return scorerIds.flatMap((scorerId) => {
    const pairs = records.filter(
      (record): record is ComparisonRecord & { preference: "left" | "right" | "tie" } =>
        record.scorerId === scorerId && record.status === "scored" && record.preference !== undefined,
    );
    const fit = bradleyTerry(pairs);
    const complete = fit !== null && candidates.every((name) => Object.hasOwn(fit, name));
    const rows = candidates.map((candidate) => ({
      scorerId,
      candidate,
      strength: complete ? fit[candidate]! : null,
      ci95: null as readonly [number, number] | null,
      rank: null as number | null,
    }));
    if (!complete) return rows;
    const draws: ReturnType<typeof bradleyTerry>[] = [];
    let undefinedDraw = false;
    for (const row of rows) {
      let draw = 0;
      const ci = bootstrapInterval(
        pairs.map((_, i) => i),
        {
          seed,
          resamples: 1000,
          clusterIds: pairs.map((pair) => pair.itemId),
          statistic: (indices) => {
            if (draw === draws.length) draws.push(bradleyTerry(indices.map((i) => pairs[i]!)));
            const fitted = draws[draw++];
            const sampled = fitted && Object.hasOwn(fitted, row.candidate) ? fitted[row.candidate] : undefined;
            if (sampled === undefined) undefinedDraw = true;
            return sampled ?? 0;
          },
        },
      );
      row.ci95 = [ci.low, ci.high];
    }
    // A separated bootstrap draw has no finite MLE: do not discard it and narrow the interval.
    if (undefinedDraw) for (const row of rows) row.ci95 = null;
    else {
      const byInterval = [...rows].sort((a, b) => b.ci95![1] - a.ci95![1] || a.candidate.localeCompare(b.candidate));
      let groupLow = Infinity,
        rank = 1;
      for (const [i, row] of byInterval.entries()) {
        if (row.ci95![1] < groupLow) {
          rank = i + 1;
          groupLow = row.ci95![0];
        } else groupLow = Math.min(groupLow, row.ci95![0]);
        row.rank = rank;
      }
    }
    return rows.sort((a, b) => b.strength! - a.strength! || a.candidate.localeCompare(b.candidate));
  });
}
