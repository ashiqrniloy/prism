import type { SecretRedactor } from "@arnilo/prism";
import type { ComparisonCandidate, ComparisonReport, Dataset, EvaluationThresholds, PairwiseScorer } from "../evals/index.js";
import { PromptError, PromptValidationError } from "./errors.js";
import type { PromptOwnership, PromptRecord, PromptStore } from "./types.js";

/**
 * Eval-gated promotion verdict: `promote` only when every configured gate
 * passes; `hold` otherwise, with the reasons and a bounded JSON report.
 */
export interface PromptPromotionVerdict {
  readonly verdict: "promote" | "hold";
  readonly name: string;
  readonly candidate: PromptRecord;
  readonly baseline: PromptRecord;
  readonly datasetId: string;
  readonly datasetVersion?: string;
  readonly perScorer: Readonly<Record<string, PromptPromotionScorerStats>>;
  /** candidate wins / scored comparisons; undefined when nothing scored. */
  readonly winRate?: number;
  readonly report: ComparisonReport;
  /** `serializeEvaluationReport(report)` — redacted and byte-bounded for CI artifacts. */
  readonly reportJson: string;
  readonly reasons: readonly string[];
}

export interface PromptPromotionScorerStats {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly failures: number;
}

export interface AssertPromptPromotionOptions<TInput = unknown, TExpected = unknown> {
  /** Read-only access: only `resolve` is called — no writes during evaluation. */
  readonly store: PromptStore;
  readonly ownership?: PromptOwnership;
  readonly name: string;
  /** Defaults to the latest version; `label` picks the latest labeled version. */
  readonly candidate?: { readonly version?: number; readonly label?: string };
  /** Defaults to the latest version; must resolve to a different version than the candidate. */
  readonly baseline?: { readonly version?: number; readonly label?: string };
  readonly dataset: Dataset<TInput, TExpected>;
  readonly scorers: readonly PairwiseScorer<TInput, TExpected>[];
  /** Host bridge from a resolved prompt record to an A/B candidate runner. */
  readonly run: (prompt: PromptRecord) => ComparisonCandidate<TInput, TExpected>;
  /** Forwarded to `assertEvaluationThreshold` (e.g. `minimumCandidateWins: { candidate: n }`). */
  readonly thresholds?: EvaluationThresholds;
  /** Convenience gate: minimum fraction of scored comparisons the candidate must win in `[0, 1]`. */
  readonly minimumWinRate?: number;
  readonly concurrency?: number;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

/** Load the optional `@arnilo/prism-evals` peer or fail closed with install guidance. */
async function loadEvals(): Promise<typeof import("../evals/index.js")> {
  try {
    return await import("../evals/index.js");
  } catch {
    throw new PromptError(
      "assertPromptPromotion requires the optional peer @arnilo/prism-evals; install it (npm i @arnilo/prism-evals)",
      "ERR_PRISM_PROMPT_EVALS_PEER",
    );
  }
}

function assertWinRate(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PromptValidationError("minimumWinRate must be a finite number in [0, 1]");
  }
}

/** Aggregate one pairwise report into per-scorer candidate-vs-baseline stats. */
function perScorerStats(report: ComparisonReport): Record<string, PromptPromotionScorerStats> {
  const stats: Record<string, { wins: number; losses: number; ties: number; failures: number }> = {};
  for (const record of report.records) {
    const entry = (stats[record.scorerId] ??= { wins: 0, losses: 0, ties: 0, failures: 0 });
    if (record.status === "failed") entry.failures += 1;
    else if (record.preference === "tie" || record.preference === undefined) entry.ties += 1;
    else if ((record.preference === "left" ? record.left : record.right) === "candidate") entry.wins += 1;
    else entry.losses += 1;
  }
  return stats;
}

/**
 * Resolve two prompt versions, run them head-to-head over the dataset through
 * `runComparison`, and gate promotion on the configured thresholds. Verdicts
 * are returned — never applied: promotion itself stays a host decision.
 */
export async function assertPromptPromotion<TInput = unknown, TExpected = unknown>(
  options: AssertPromptPromotionOptions<TInput, TExpected>,
): Promise<PromptPromotionVerdict> {
  if (options.minimumWinRate !== undefined) assertWinRate(options.minimumWinRate);
  const { runComparison, assertEvaluationThreshold, serializeEvaluationReport } = await loadEvals();
  const candidate = await options.store.resolve({
    name: options.name,
    version: options.candidate?.version,
    label: options.candidate?.label,
    ...(options.ownership ?? {}),
  });
  if (!candidate) throw new PromptValidationError(`candidate version of "${options.name}" not found`);
  const baseline = await options.store.resolve({
    name: options.name,
    version: options.baseline?.version,
    label: options.baseline?.label,
    ...(options.ownership ?? {}),
  });
  if (!baseline) throw new PromptValidationError(`baseline version of "${options.name}" not found`);
  if (candidate.version === baseline.version) {
    throw new PromptValidationError(`candidate and baseline resolved to the same version (${candidate.version}) of "${options.name}"`);
  }
  const report = await runComparison<TInput, TExpected>({
    dataset: options.dataset,
    scorers: options.scorers,
    candidates: {
      candidate: options.run(candidate),
      baseline: options.run(baseline),
    },
    concurrency: options.concurrency,
    redactor: options.redactor,
    secrets: options.secrets,
    signal: options.signal,
  });
  const reasons: string[] = [];
  const stats = perScorerStats(report);
  const scored = report.wins.candidate! + report.wins.baseline! + report.ties;
  const winRate = scored > 0 ? report.wins.candidate! / scored : undefined;
  // Default gate: a candidate must win strictly more scored comparisons than the
  // baseline loses to it. Explicit minimumWinRate/thresholds layers on top.
  if (report.wins.candidate! <= report.wins.baseline!) {
    reasons.push(`candidate wins ${report.wins.candidate} <= baseline wins ${report.wins.baseline}`);
  }
  if (options.minimumWinRate !== undefined && (winRate === undefined || winRate < options.minimumWinRate)) {
    reasons.push(`candidate win rate ${winRate ?? "none"} < ${options.minimumWinRate}`);
  }
  if (options.thresholds !== undefined) {
    try {
      assertEvaluationThreshold(report, options.thresholds);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    verdict: reasons.length === 0 ? "promote" : "hold",
    name: options.name,
    candidate,
    baseline,
    datasetId: report.datasetId,
    datasetVersion: report.datasetVersion,
    perScorer: stats,
    winRate,
    report,
    reportJson: serializeEvaluationReport(report, { redactor: options.redactor, secrets: options.secrets }),
    reasons,
  };
}
