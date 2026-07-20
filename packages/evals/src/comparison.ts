import type { AgentRunResult } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import {
  DEFAULT_CANDIDATE_MAX_BYTES,
  DEFAULT_COMPARISON_CANDIDATES,
  DEFAULT_JUDGE_MAX_OUTPUT_BYTES,
  HARD_CANDIDATE_MAX_BYTES,
  HARD_COMPARISON_CANDIDATES,
  HARD_JUDGE_MAX_OUTPUT_BYTES,
} from "./limits.js";
import type { ComparisonRecord, ComparisonReport, RunComparisonOptions } from "./types.js";
import { mapPool, normalizeConcurrency, resolveRedactor, toErrorInfo } from "./util.js";

/** Run every named candidate once per item, then score every stable candidate pair. */
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
    if (!Number.isInteger(selected) || selected < 1 || selected > hard) throw new EvalError(`${name} is out of bounds`, "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
    return selected;
  };
  const maxCandidateBytes = boundedBytes(options.maxCandidateBytes, DEFAULT_CANDIDATE_MAX_BYTES, HARD_CANDIDATE_MAX_BYTES, "maxCandidateBytes");
  const maxScorerOutputBytes = boundedBytes(options.maxScorerOutputBytes, DEFAULT_JUDGE_MAX_OUTPUT_BYTES, HARD_JUDGE_MAX_OUTPUT_BYTES, "maxScorerOutputBytes");
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const perItem = await mapPool(options.dataset.items, normalizeConcurrency(options.concurrency), async (item) => {
    const results = new Map<string, AgentRunResult>();
    const errors = new Map<string, unknown>();
    await Promise.all(candidates.map(async (name) => {
      try {
        options.signal?.throwIfAborted();
        const result = await options.candidates[name]!(item, options.signal);
        if (Buffer.byteLength(JSON.stringify(result)) > maxCandidateBytes) throw new EvalError("candidate output byte limit exceeded", "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
        results.set(name, result);
      } catch (error) {
        errors.set(name, error);
      }
    }));
    const records: ComparisonRecord[] = [];
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const left = candidates[leftIndex]!;
        const right = candidates[rightIndex]!;
        for (const scorer of options.scorers) {
          const failed = errors.get(left) ?? errors.get(right);
          try {
            if (failed) throw failed;
            const output = await scorer.score({
              left: { name: left, result: results.get(left)! },
              right: { name: right, result: results.get(right)! },
              item,
              signal: options.signal,
            });
            if (Buffer.byteLength(JSON.stringify(output)) > maxScorerOutputBytes) throw new EvalError("pairwise scorer output byte limit exceeded", "ERR_PRISM_EVAL_COMPARISON_BOUNDS");
            if (!(["left", "right", "tie"] as const).includes(output.preference)) {
              throw new EvalError("invalid pairwise preference", "ERR_PRISM_EVAL_COMPARISON_RESULT");
            }
            records.push({ itemId: item.id, scorerId: scorer.id, left, right, preference: output.preference, status: "scored", reason: output.reason });
          } catch (error) {
            records.push({ itemId: item.id, scorerId: scorer.id, left, right, status: "failed", error: toErrorInfo(error) });
          }
        }
      }
    }
    return records;
  }, options.signal);
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
  return { datasetId: options.dataset.id, datasetVersion: options.dataset.version, candidates, records: safe, wins, ties, failures };
}
