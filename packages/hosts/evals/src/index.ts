export type { CitationIntegrityItem, CitationIntegrityScorerOptions } from "./citations.js";
export { createCitationIntegrityScorer } from "./citations.js";
export {
  approvalEvidenceIntact,
  checkCitationIntegrity,
} from "./citation-integrity.js";
export type {
  CitationIntegrityReason,
  CitationIntegrityResult,
  CitationLiveSource,
} from "./citation-integrity.js";
export { compareExperiments } from "./compare-experiments.js";
export type { Split } from "./types.js";
export type { CompareExperimentsOptions, ExperimentComparison } from "./types.js";
export { runComparison } from "./comparison.js";
export { calibrateJudge, labeledItemsFromFeedback } from "./calibration.js";
export type { CalibrateJudgeOptions, LabeledItemsFromFeedbackOptions } from "./calibration.js";
export type { CalibrationItem, CalibrationReport } from "./types.js";
export { bradleyTerry, cohensKappa, krippendorffAlpha, spearman } from "./stats.js";
export type {
  CuratedItemDraft,
  CuratedRun,
  CurateResult,
  CurateToItem,
  CurationSkip,
  DatasetFromRunsInput,
} from "./curate.js";
export { datasetFromRuns, defaultCurateToItem } from "./curate.js";
export { defineDataset } from "./dataset.js";
export { createErpInvariantScorers, ERP_INVARIANT_SCHEMA_VERSION, erpInvariantDataset } from "./erp-invariants.js";
export { EvalDatasetError, EvalError, EvalScoreError } from "./errors.js";
export { runExperiment } from "./experiment.js";
export type { AppendEvaluationFeedbackInput } from "./feedback.js";
export { appendEvaluationFeedback } from "./feedback.js";
export { createJudgePanel } from "./judge-panel.js";
export type { JudgePanelOptions } from "./types.js";
export { createModelJudge } from "./judge.js";
export { createRubricJudge, createPairwiseJudge, PAIRWISE_JUDGE_TEMPLATE_VERSION, RUBRIC_JUDGE_TEMPLATE_VERSION } from "./rubric-judge.js";
export type { JudgeRubric, RubricJudgeOptions, PairwiseJudgeOptions } from "./types.js";
export {
  DEFAULT_CANDIDATE_MAX_BYTES,
  DEFAULT_COMPARISON_CANDIDATES,
  DEFAULT_EVALUATION_PAGE_SIZE,
  DEFAULT_EXPERIMENT_CONCURRENCY,
  DEFAULT_JUDGE_MAX_ATTEMPTS,
  DEFAULT_RUBRIC_JUDGE_MAX_ATTEMPTS,
  DEFAULT_JUDGE_MAX_INPUT_BYTES,
  DEFAULT_JUDGE_MAX_OUTPUT_BYTES,
  DEFAULT_JUDGE_MAX_RUBRIC_BYTES,
  DEFAULT_JUDGE_TIMEOUT_MS,
  DEFAULT_MAX_STEP_SCORES,
  DEFAULT_REPORT_MAX_BYTES,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_TRACE_MAX_BYTES,
  DEFAULT_TRACE_PAGE_SIZE,
  DEFAULT_TRACE_PAGES,
  DEFAULT_TRIALS_COUNT,
  HARD_CANDIDATE_MAX_BYTES,
  HARD_COMPARISON_CANDIDATES,
  HARD_CURATION_ITEM_MAX_BYTES,
  HARD_DATASET_ITEMS,
  HARD_EVALUATION_PAGE_CAP,
  HARD_EXPERIMENT_CONCURRENCY_CAP,
  HARD_JUDGE_MAX_ATTEMPTS,
  HARD_JUDGE_MAX_INPUT_BYTES,
  HARD_JUDGE_MAX_OUTPUT_BYTES,
  HARD_JUDGE_MAX_RUBRIC_BYTES,
  HARD_JUDGE_TIMEOUT_MS,
  HARD_MAX_STEP_SCORES,
  HARD_MAX_TRIALS,
  HARD_REPORT_MAX_BYTES,
  HARD_STATS_RESAMPLES,
  HARD_TRACE_MAX_BYTES,
  HARD_TRACE_PAGE_SIZE,
  HARD_TRACE_PAGES,
} from "./limits.js";
export type {
  AgentFactory,
  FailureInjectionOptions,
  RunScenarioOptions,
  ScenarioDefinition,
  ScenarioResult,
  ScenarioTurn,
} from "./scenarios.js";
export {
  DEFAULT_MAX_SCENARIO_TURNS,
  failureInjection,
  failingStore,
  HARD_MAX_SCENARIO_TURNS,
  resolveTrialsConfig,
  runScenario,
  validateEvalManifest,
  validateReleaseEvalManifest,
} from "./scenarios.js";
export { defaultToAgentInput, scoreRun, scoreRunLive } from "./score.js";
export { defineScorer } from "./scorer.js";
export { createStateMatchScorer } from "./state-match.js";
export type { StateMatchScorerOptions } from "./state-match.js";
export {
  estimateOnline, fleissKappa, benjaminiHochberg, bootstrapInterval, clusteredStandardError, mcnemarExact,
  minimumDetectableEffect, pairedPermutationTest, pairedProportionPower, powerAnalysis,
  paretoFrontier, passAtK, passHatK, wilsonInterval,
} from "./stats.js";
export { toExperimentReportRecord } from "./report-record.js";
export { assertEvaluationThreshold, EvalThresholdError, serializeEvaluationReport } from "./threshold.js";
export { createPersistenceTraceResolver } from "./trace.js";
export type {
  ApprovalBeforeEffectScorerOptions,
  ErrorClassScorerOptions,
  GuardrailPackScorerOptions,
  NoLoopScorerOptions,
  SchemaScorerOptions,
  StepBudgetScorerOptions,
  ToolCallMatchMode,
  ToolCallMatchScorerOptions,
  ToolCallSpec,
} from "./trajectory.js";
export {
  createApprovalBeforeEffectScorer,
  createErrorClassScorer,
  createGuardrailPackScorer,
  createNoLoopScorer,
  createSchemaScorer,
  createStepBudgetScorer,
  createToolCallMatchScorer,
  DEFAULT_MAX_EXPECTED_CALLS,
  DEFAULT_PACK_RULE_PREFIX,
  HARD_MAX_EXPECTED_CALLS,
} from "./trajectory.js";
export type {
  ComparisonCandidate,
  ComparisonRecord,
  ComparisonReport,
  Dataset,
  DatasetItem,
  DefineDatasetInput,
  DefineScorerInput,
  EvalManifest,
  EvaluationTarget,
  EvaluationThresholds,
  EvaluationTrace,
  ExperimentAggregate,
  ExperimentItemResult,
  ExperimentReport,
  ExperimentTrials,
  LiveScoreOptions,
  ModelJudgeOptions,
  ModelJudgeRequest,
  PairwisePreference,
  PairwiseScoreResult,
  PairwiseScorer,
  PairwiseScorerInput,
  RunComparisonOptions,
  RunExperimentOptions,
  ScoreResult,
  ScoreRunOptions,
  Scorer,
  ScorerInput,
  TraceLimits,
  TraceResolver,
  TraceResolverInput,
} from "./types.js";
export { mapPool, normalizeConcurrency, randomId, toErrorInfo } from "./util.js";

export type { ScorerStats } from "./types.js";

export type { ScenarioInput, UserSimulatorSpec, UserSimulator, UserSimulation } from "./types.js";

export { createUserSimulator, USER_SIMULATOR_TEMPLATE_VERSION } from "./user-simulator.js";

export { BUILTIN_INJECTION_ATTACKS, createInjectionDataset, injectionHooks, runInjectionSuite } from "./injection.js";
export type { InjectionAttack, InjectionCarrier, InjectionSpec, InjectionRate, InjectionMetrics, RunInjectionSuiteOptions } from "./injection.js";

export type { EvaluationTelemetrySink, EvaluationSampling, EvaluationSamplingMetadata, EstimateOnlineOptions, OnlineEstimate } from "./types.js";
