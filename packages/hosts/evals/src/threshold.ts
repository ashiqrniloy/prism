import { resolveRedactor } from "@arnilo/prism";
import { compareExperiments } from "./compare-experiments.js";
import { EvalError } from "./errors.js";
import { DEFAULT_REPORT_MAX_BYTES, HARD_REPORT_MAX_BYTES } from "./limits.js";
import type { ComparisonReport, EvaluationThresholds, ExperimentReport } from "./types.js";
import { assertFiniteUnitInterval } from "./util.js";

export class EvalThresholdError extends EvalError {
  constructor(message: string) {
    super(message, "ERR_PRISM_EVAL_THRESHOLD");
    this.name = "EvalThresholdError";
  }
}

/** Fail a CI process through a stable thrown error when report thresholds regress. */
export function assertEvaluationThreshold(report: ExperimentReport | ComparisonReport, thresholds: EvaluationThresholds): void {
  const failures: string[] = [];
  const experiment = "aggregate" in report ? report : undefined;
  const comparison = "wins" in report ? report : undefined;
  if (thresholds.minimumMacroMean !== undefined) {
    const minimum = assertFiniteUnitInterval(thresholds.minimumMacroMean, "minimumMacroMean");
    if (!experiment || experiment.aggregate.macroMean === undefined || experiment.aggregate.macroMean < minimum)
      failures.push(`macro mean < ${minimum}`);
  }
  const maximumFailures = thresholds.maximumFailures ?? 0;
  if (!Number.isInteger(maximumFailures) || maximumFailures < 0) throw new EvalThresholdError("maximumFailures must be an integer >= 0");
  const failedCount = experiment?.aggregate.failedCount ?? comparison?.failures ?? 0;
  if (failedCount > maximumFailures) failures.push(`failures > ${maximumFailures}`);
  for (const [scorerId, rawMinimum] of Object.entries(thresholds.minimumByScorer ?? {}).sort()) {
    const minimum = assertFiniteUnitInterval(rawMinimum, `minimumByScorer.${scorerId}`);
    const mean = experiment?.aggregate.scorers[scorerId]?.mean;
    if (mean === undefined || mean < minimum) failures.push(`${scorerId} mean < ${minimum}`);
  }
  for (const [scorerId, { k, minimum: rawMinimum }] of Object.entries(thresholds.minimumPassHatK ?? {}).sort()) {
    if (!Number.isSafeInteger(k) || k < 1) throw new EvalThresholdError(`minimumPassHatK.${scorerId}.k must be an integer >= 1`);
    const minimum = assertFiniteUnitInterval(rawMinimum, `minimumPassHatK.${scorerId}.minimum`);
    const value = experiment?.aggregate.scorers[scorerId]?.passHatK?.[k];
    if (value === undefined || value < minimum) failures.push(`${scorerId} pass^${k} < ${minimum} or unavailable`);
  }
  for (const [scorerId, rawMinimum] of Object.entries(thresholds.minimumLowerBound ?? {}).sort()) {
    const minimum = assertFiniteUnitInterval(rawMinimum, `minimumLowerBound.${scorerId}`);
    const ci = experiment?.aggregate.scorers[scorerId]?.ci95;
    if (!ci || !Number.isFinite(ci.low) || !Number.isFinite(ci.high) || ci.low < 0 || ci.high > 1 || ci.low > ci.high) {
      failures.push(`${scorerId} lower bound < ${minimum}: ci95 unavailable or invalid`);
    } else if (ci.low < minimum) {
      failures.push(`${scorerId} lower bound < ${minimum}: ci95=[${ci.low}, ${ci.high}]`);
    }
  }
  if (thresholds.maximumRegression) {
    const { baseline, delta = 0, alpha = 0.05, scorers } = thresholds.maximumRegression;
    assertFiniteUnitInterval(delta, "maximumRegression.delta");
    if (!experiment) throw new EvalThresholdError("maximumRegression requires an experiment report");
    const compared = compareExperiments(baseline, experiment, { alpha, scorers });
    for (const [scorerId, stats] of Object.entries(compared.scorers)) {
      if (stats.difference < -delta && stats.significant) {
        failures.push(
          `${scorerId} difference ${stats.difference} < -${delta}: ci95=[${stats.ci95.low}, ${stats.ci95.high}], p=${stats.pValue}, q=${stats.qValue} <= alpha=${alpha}`,
        );
      }
    }
  }
  for (const [scorerId, { report: calibration, minimumKappa, minimumN = 30 }] of Object.entries(thresholds.calibrations ?? {}).sort()) {
    if (!Number.isFinite(minimumKappa) || minimumKappa < -1 || minimumKappa > 1 || !Number.isSafeInteger(minimumN) || minimumN < 1) {
      throw new EvalThresholdError(`invalid calibration threshold for ${scorerId}`);
    }
    const used = experiment
      ? experiment.evaluations.some((record) => record.scorerId === scorerId)
      : comparison?.records.some((record) => record.scorerId === scorerId);
    if (!used) continue;
    const ci = calibration?.kappaCi95;
    const validKappa = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
    if (
      !calibration ||
      !Number.isSafeInteger(calibration.n) ||
      calibration.n < minimumN ||
      !validKappa(calibration.cohensKappa) ||
      (ci !== undefined && (!ci || !validKappa(ci.low) || !validKappa(ci.high) || ci.low > ci.high)) ||
      (ci?.low ?? calibration.cohensKappa ?? -Infinity) < minimumKappa
    ) {
      failures.push(`${scorerId} calibration requires n >= ${minimumN} and kappa lower bound >= ${minimumKappa}`);
    }
  }
  for (const [candidate, minimum] of Object.entries(thresholds.minimumCandidateWins ?? {}).sort()) {
    if (!Number.isInteger(minimum) || minimum < 0)
      throw new EvalThresholdError(`minimumCandidateWins.${candidate} must be an integer >= 0`);
    if ((comparison?.wins[candidate] ?? 0) < minimum) failures.push(`${candidate} wins < ${minimum}`);
  }
  if (experiment?.aggregate.invariantsPassed === false) {
    failures.push("hard invariant failed");
  }
  // Requiring invariants means requiring evidence that they ran: an omitted invariant scorer is a gap.
  if (thresholds.requireInvariants === true && experiment?.aggregate.invariantsPassed !== true) {
    const reason = experiment?.aggregate.invariantsPassed === false ? "hard invariant failed" : "no invariant scorers evaluated";
    if (!failures.includes(reason)) failures.push(reason);
  }
  if (failures.length) throw new EvalThresholdError(failures.join("; "));
}

/** Produce deterministic, bounded, optionally redacted JSON suitable for CI artifacts. */
export function serializeEvaluationReport(
  report: unknown,
  options: {
    readonly maxBytes?: number;
    readonly redactor?: import("@arnilo/prism").SecretRedactor;
    readonly secrets?: readonly (string | undefined)[];
  } = {},
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
