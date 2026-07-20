export {
  DEFAULT_EVALUATION_PAGE_SIZE,
  DEFAULT_EXPERIMENT_CONCURRENCY,
  DEFAULT_SAMPLE_RATE,
  HARD_EVALUATION_PAGE_CAP,
  HARD_EXPERIMENT_CONCURRENCY_CAP,
  DEFAULT_TRACE_PAGE_SIZE,
  HARD_TRACE_PAGE_SIZE,
  DEFAULT_TRACE_PAGES,
  HARD_TRACE_PAGES,
  DEFAULT_TRACE_MAX_BYTES,
  HARD_TRACE_MAX_BYTES,
  DEFAULT_JUDGE_TIMEOUT_MS,
  HARD_JUDGE_TIMEOUT_MS,
  DEFAULT_JUDGE_MAX_ATTEMPTS,
  HARD_JUDGE_MAX_ATTEMPTS,
  DEFAULT_JUDGE_MAX_OUTPUT_BYTES,
  HARD_JUDGE_MAX_OUTPUT_BYTES,
  DEFAULT_COMPARISON_CANDIDATES,
  HARD_COMPARISON_CANDIDATES,
  DEFAULT_REPORT_MAX_BYTES,
  HARD_REPORT_MAX_BYTES,
  HARD_DATASET_ITEMS,
  DEFAULT_CANDIDATE_MAX_BYTES,
  HARD_CANDIDATE_MAX_BYTES,
  DEFAULT_JUDGE_MAX_INPUT_BYTES,
  HARD_JUDGE_MAX_INPUT_BYTES,
  DEFAULT_JUDGE_MAX_RUBRIC_BYTES,
  HARD_JUDGE_MAX_RUBRIC_BYTES,
} from "./limits.js";

export { EvalDatasetError, EvalError, EvalScoreError } from "./errors.js";
export { defineScorer } from "./scorer.js";
export { defineDataset } from "./dataset.js";
export { createMemoryEvaluationStore } from "./store.js";
export { appendEvaluationFeedback } from "./feedback.js";
export type { AppendEvaluationFeedbackInput } from "./feedback.js";
export { defaultToAgentInput, scoreRun, scoreRunLive } from "./score.js";
export { runExperiment } from "./experiment.js";
export { createPersistenceTraceResolver } from "./trace.js";
export { createModelJudge } from "./judge.js";
export { runComparison } from "./comparison.js";
export { assertEvaluationThreshold, EvalThresholdError, serializeEvaluationReport } from "./threshold.js";

export type {
  Dataset,
  DatasetItem,
  DefineDatasetInput,
  DefineScorerInput,
  EvaluationQuery,
  EvaluationRecord,
  EvaluationStatus,
  EvaluationStore,
  ExperimentAggregate,
  ExperimentItemResult,
  ExperimentReport,
  LiveScoreOptions,
  RunExperimentOptions,
  ScoreResult,
  ScoreRunOptions,
  Scorer,
  ScorerInput,
  EvaluationTarget,
  EvaluationTrace,
  TraceLimits,
  TraceResolver,
  TraceResolverInput,
  ModelJudgeOptions,
  ModelJudgeRequest,
  PairwisePreference,
  PairwiseScoreResult,
  PairwiseScorerInput,
  PairwiseScorer,
  ComparisonCandidate,
  ComparisonRecord,
  ComparisonReport,
  RunComparisonOptions,
  EvaluationThresholds,
} from "./types.js";
