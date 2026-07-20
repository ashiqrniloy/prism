import { EvalError } from "./errors.js";
import { DEFAULT_REPORT_MAX_BYTES, HARD_REPORT_MAX_BYTES } from "./limits.js";
import type { ComparisonReport, EvaluationThresholds, ExperimentReport } from "./types.js";
import { assertFiniteUnitInterval, resolveRedactor } from "./util.js";

export class EvalThresholdError extends EvalError {
  constructor(message: string) {
    super(message, "ERR_PRISM_EVAL_THRESHOLD");
    this.name = "EvalThresholdError";
  }
}

/** Fail a CI process through a stable thrown error when report thresholds regress. */
export function assertEvaluationThreshold(
  report: ExperimentReport | ComparisonReport,
  thresholds: EvaluationThresholds,
): void {
  const failures: string[] = [];
  const experiment = "aggregate" in report ? report : undefined;
  const comparison = "wins" in report ? report : undefined;
  if (thresholds.minimumMean !== undefined) {
    const minimum = assertFiniteUnitInterval(thresholds.minimumMean, "minimumMean");
    if (!experiment || experiment.aggregate.meanScore === undefined || experiment.aggregate.meanScore < minimum) failures.push(`mean score < ${minimum}`);
  }
  const maximumFailures = thresholds.maximumFailures ?? 0;
  if (!Number.isInteger(maximumFailures) || maximumFailures < 0) throw new EvalThresholdError("maximumFailures must be an integer >= 0");
  const failedCount = experiment?.aggregate.failedCount ?? comparison?.failures ?? 0;
  if (failedCount > maximumFailures) failures.push(`failures > ${maximumFailures}`);
  for (const [scorerId, rawMinimum] of Object.entries(thresholds.minimumByScorer ?? {}).sort()) {
    const minimum = assertFiniteUnitInterval(rawMinimum, `minimumByScorer.${scorerId}`);
    const mean = experiment?.aggregate.scoresByScorer[scorerId]?.mean;
    if (mean === undefined || mean < minimum) failures.push(`${scorerId} mean < ${minimum}`);
  }
  for (const [candidate, minimum] of Object.entries(thresholds.minimumCandidateWins ?? {}).sort()) {
    if (!Number.isInteger(minimum) || minimum < 0) throw new EvalThresholdError(`minimumCandidateWins.${candidate} must be an integer >= 0`);
    if ((comparison?.wins[candidate] ?? 0) < minimum) failures.push(`${candidate} wins < ${minimum}`);
  }
  if (failures.length) throw new EvalThresholdError(failures.join("; "));
}

/** Produce deterministic, bounded, optionally redacted JSON suitable for CI artifacts. */
export function serializeEvaluationReport(
  report: unknown,
  options: { readonly maxBytes?: number; readonly redactor?: import("@arnilo/prism").SecretRedactor; readonly secrets?: readonly (string | undefined)[] } = {},
): string {
  const maxBytes = options.maxBytes ?? DEFAULT_REPORT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > HARD_REPORT_MAX_BYTES) {
    throw new EvalError(`maxBytes must be an integer in [1, ${HARD_REPORT_MAX_BYTES}]`, "ERR_PRISM_EVAL_REPORT_BOUNDS");
  }
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const json = JSON.stringify(redactor ? redactor.redact(report) : report, null, 2);
  if (Buffer.byteLength(json) > maxBytes) throw new EvalError("evaluation report byte limit exceeded", "ERR_PRISM_EVAL_REPORT_BOUNDS");
  return json;
}
