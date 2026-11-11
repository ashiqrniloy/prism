import type { EvaluationTelemetry } from "@arnilo/prism-extensions/observability";
import type {
  Agent,
  AgentEventRecord,
  ErrorInfo,
  ModelConfig,
  OwnershipScope,
  EvaluationRecord,
  EvaluationStore,
  ExperimentReportStore,
  RunRecord,
  RunResult,
  SecretRedactor,
  ToolCallRecord,
  Usage,
  UsageRecord,
} from "@arnilo/prism";

/** JSON configuration; bind an agent with createUserSimulator before execution. */
export interface UserSimulatorSpec {
  readonly persona: string;
  readonly goal: string;
  readonly maxTurns?: number;
  readonly stop?: string;
  readonly timeoutMs?: number;
}

export interface UserSimulator extends UserSimulatorSpec {
  readonly simulatorModel: Pick<ModelConfig, "provider" | "model">;
}

export interface UserSimulation {
  readonly turns: readonly { readonly user: string; readonly assistant: string }[];
  readonly stopReason: "goal_reached" | "max_turns" | "agent_stopped";
  readonly simulatorModel: Pick<ModelConfig, "provider" | "model">;
}

export type ScenarioInput = {
  readonly kind: "scenario";
  readonly maxTurns?: number;
  readonly scoreTurns?: "last" | "each";
} & (
  | { readonly turns: readonly (string | import("./scenario-runner.js").ScenarioTurn)[]; readonly user?: never }
  | { readonly user: UserSimulatorSpec; readonly turns?: never }
);

export interface ExecutionStep {
  readonly id: string;
  readonly parentId?: string;
  readonly kind: string;
  readonly name: string;
  readonly order: number;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: ErrorInfo;
  readonly usage?: Usage;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecutionTimeline {
  readonly schemaVersion: 1;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly workflowRevision?: string;
  readonly traceId?: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly input?: unknown;
  readonly result?: unknown;
  readonly usage?: Usage;
  readonly steps: readonly ExecutionStep[];
  readonly redacted?: boolean;
  readonly content?: string;
}

export interface TimelineFolder {
  push(event: unknown): void;
  snapshot(): ExecutionTimeline;
}

/** Score payload returned by a scorer. `score` must be finite and within `[0, 1]`. */
export interface ScoreResult {
  readonly score: number;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Input a scorer needs. Declared on the scorer, enforced by every entry point before a run. */
export type ScorerRequirement = "timeline" | "trace" | "environment";

/** Input passed to a scorer. Scorers receive results only — no credentials, tools, or workspace. */
export interface ScorerInput<TInput = unknown, TExpected = unknown> {
  readonly result: RunResult;
  readonly item?: DatasetItem<TInput, TExpected>;
  readonly expected?: TExpected;
  readonly signal?: AbortSignal;
  readonly target?: EvaluationTarget;
  readonly timeline?: ExecutionTimeline;
  /** The step under evaluation when `forEach` is set; undefined for a whole-run score. */
  readonly step?: ExecutionStep;
  readonly environment?: unknown;
  /**
   * The entry point's resolved redactor (`redactor` or `secrets`), when the host configured one.
   * Everything else here is raw: a scorer that sends `result`, `item` or `timeline` text out of the
   * process (a judge prompt, a simulator turn) must redact it with this first.
   */
  readonly redactor?: SecretRedactor;
}

/** Deterministic function scorer. */
export interface Scorer<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  /** Known judge identity, used by panels to check model diversity before scoring. */
  readonly judgeModel?: Pick<ModelConfig, "provider" | "model">;
  readonly description?: string;
  /**
   * Inputs this scorer cannot work without. An entry point that cannot supply one throws
   * `EvalError` (`ERR_PRISM_EVAL_{TIMELINE,TRACE,ENVIRONMENT}_REQUIRED`) naming the scorer instead
   * of scoring a missing input as an agent failure.
   */
  readonly requires?: readonly ScorerRequirement[];
  /**
   * A hard invariant: the run is disqualified unless every record scores `1`. `scoreRun` stamps
   * `metadata.invariant` on every record of such a scorer, so a throwing invariant still fails the gate.
   * A `metadata.invariant` returned by `score` is ignored.
   */
  readonly invariant?: boolean;
  /** A scored record passes at or above this value in [0, 1]. Default: 1. */
  readonly passThreshold?: number;
  score(input: ScorerInput<TInput, TExpected>): ScoreResult | Promise<ScoreResult>;
}

export type Split = "dev" | "test" | "heldout";

/** One dataset row. */
export interface DatasetItem<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly input: TInput;
  readonly expected?: TExpected;
  readonly split?: Split;
  readonly tags?: readonly string[];
  readonly label?: {
    readonly source: "human" | "model" | "curated" | "synthetic";
    readonly adjudicated?: boolean;
    readonly by?: string;
  };
  readonly expectedTrajectory?: readonly import("./trajectory.js").ToolCallSpec[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Immutable dataset snapshot. */
export interface Dataset<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly canary?: string;
  readonly contentHash: string;
  readonly items: readonly DatasetItem<TInput, TExpected>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DefineScorerInput<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly judgeModel?: Scorer<TInput, TExpected>["judgeModel"];
  readonly description?: string;
  readonly requires?: readonly ScorerRequirement[];
  readonly invariant?: boolean;
  /** A scored record passes at or above this value in [0, 1]. Default: 1. */
  readonly passThreshold?: number;
  readonly score: Scorer<TInput, TExpected>["score"];
}

export interface DefineDatasetInput<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly canary?: string;
  readonly items: readonly DatasetItem<TInput, TExpected>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Optional observer; exceptions never alter evaluation records. */
export interface EvaluationTelemetrySink {
  handleEvaluation(evaluation: EvaluationTelemetry): void;
}

export interface EvaluationSamplingMetadata {
  readonly stratum: string;
  readonly probability: number;
}

export interface EvaluationSampling {
  /** Default per-run inclusion probability in `[0, 1]`. Defaults to `1`. */
  readonly rate?: number;
  /** Optional classifier mapping a run result to its stratum name (called once per run). */
  readonly strata?: (result: RunResult) => string;
  /** Optional per-stratum inclusion probabilities in `[0, 1]`, overriding `rate`. */
  readonly rates?: Readonly<Record<string, number>>;
  /** Optional predicate forcing inclusion with `probability: 1` (e.g. failed or denied runs). */
  readonly always?: (result: RunResult) => boolean;
  /** Optional seed for per-run RNG (`mulberry32(hash32(seed, runId, 0))`). */
  readonly seed?: number;
}

export interface EstimateOnlineOptions {
  /** Scorer id to estimate; optional when all supplied records share one scorerId. */
  readonly scorerId?: string;
  /** Bootstrap seed, default 0. */
  readonly seed?: number;
  /** Bootstrap resamples, default 2,000, maximum HARD_STATS_RESAMPLES. */
  readonly resamples?: number;
  /** Interval coverage in (0, 1), default 0.95. */
  readonly confidence?: number;
}

export interface OnlineEstimate {
  readonly scorerId: string;
  readonly n: number;
  readonly effectiveN: number;
  readonly mean: number;
  readonly ci95: { readonly low: number; readonly high: number };
  readonly byStratum: Readonly<
    Record<
      string,
      {
        readonly n: number;
        readonly mean: number;
        readonly weightSum: number;
      }
    >
  >;
}

export interface ScoreRunOptions<TInput = unknown, TExpected = unknown> {
  readonly result: RunResult;
  readonly scorers: readonly Scorer<TInput, TExpected>[];
  /** Stratified, weighted sampling configuration. Defaults to `rate: 1` when supplied. */
  readonly sampling?: EvaluationSampling;
  /** Seed for per-run RNG (`mulberry32(hash32(seed, runId, 0))`) when `random` is omitted. */
  readonly seed?: number;
  readonly store?: EvaluationStore;
  readonly telemetry?: EvaluationTelemetrySink;
  readonly ownership?: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
  readonly datasetId?: string;
  readonly itemId?: string;
  readonly item?: DatasetItem<TInput, TExpected>;
  readonly experimentId?: string;
  readonly traceId?: string;
  /** Optional explicit resolver; requires ownership, sessionId, and runId. */
  readonly traceResolver?: TraceResolver;
  readonly traceLimits?: TraceLimits;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Injectable RNG for deterministic sampling tests. Returns `[0, 1)`. */
  /** Explicit RNG overrides `seed`. One shared stream, so decisions depend on completion order. */
  readonly random?: () => number;
  /** Hooks for the agent factory. With an `Agent` instance they throw: it cannot be reconfigured. */
  readonly hooks?: import("@arnilo/prism").AgentConfig["hooks"];
  /** Slots for the agent factory. With an `Agent` instance they throw: it cannot be reconfigured. */
  readonly slots?: import("@arnilo/prism").AgentConfig["slots"];
  /** Timeline projection mode. Defaults to "off". */
  readonly timeline?: "off" | "metadata" | "redacted_io";
  /** Injected timeline instance (bypasses trace projection when supplied). */
  readonly injectedTimeline?: ExecutionTimeline;
  /** Optional host-supplied environment state snapshot. */
  readonly environment?: unknown;
  /** Evaluate scorers per step matching kind rather than once per run. */
  readonly forEach?: "tool" | "workflow_node";
  /** Maximum step evaluations per run under forEach. Default 32, hard 128. */
  readonly maxStepScores?: number;
}

export interface LiveScoreOptions<TInput = unknown, TExpected = unknown> extends Omit<ScoreRunOptions<TInput, TExpected>, "result"> {
  readonly onError?: (error: unknown) => void;
}

export interface ExperimentItemResult<TInput = unknown, TExpected = unknown> {
  readonly item: DatasetItem<TInput, TExpected>;
  readonly result?: RunResult;
  readonly trials: readonly {
    readonly usage?: Usage;
    readonly durationMs?: number;
    readonly status: RunResult["status"];
    /** Every observed provider attempt was priced in the same currency. */
    readonly costComplete: boolean;
    readonly simulation?: UserSimulation;
  }[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly error?: ErrorInfo;
}

export interface ScorerStats {
  readonly items: number;
  readonly records: number;
  readonly mean: number;
  readonly passRate: number;
  /** Item-averaged reliability estimates; present only with multiple configured trials. */
  readonly passAtK?: Readonly<Record<number, number>>;
  readonly passHatK?: Readonly<Record<number, number>>;
  /** Counts include dataset items with no scored trials; estimates omit k with zero eligible items. */
  readonly passKCounts?: Readonly<Record<number, { readonly items: number; readonly excludedItems: number }>>;
  readonly se?: number;
  readonly ci95?: { readonly low: number; readonly high: number };
  /** Fleiss’ κ over complete panel label rows; absent when undefined or unavailable. */
  readonly judgeAgreement?: number;
  readonly method: "single_item" | "wilson" | "cluster_bootstrap";
}

export interface ExperimentAggregate {
  readonly itemCount: number;
  readonly scoredCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly macroMean?: number;
  /** Always produced by runExperiment; optional for externally constructed score-only reports. */
  readonly cost?: Usage & {
    readonly costComplete: boolean;
    readonly meanPerItem: Usage & { readonly durationMs?: number };
    /** Nearest-rank percentiles of measured trial run times, excluding scoring. */
    readonly durationMs?: { readonly p50: number; readonly p95: number };
  };
  readonly scorers: Readonly<Record<string, ScorerStats>>;
  readonly byTag?: Readonly<Record<string, { readonly scorers: Readonly<Record<string, ScorerStats>> }>>;
  /** True when all hard invariant scorers passed with score 1.0. */
  readonly invariantsPassed?: boolean;
}

export interface ExperimentTrials {
  readonly count: number;
  readonly seed?: number;
  readonly sampleCount: number;
}

export interface ExperimentReport<TInput = unknown, TExpected = unknown> {
  readonly experimentId: string;
  readonly datasetId: string;
  readonly datasetVersion?: string;
  /** Present on reports produced by runExperiment; optional for external score-only reports. */
  readonly datasetContentHash?: string;
  readonly split?: Split | readonly Split[];
  readonly canary?: string;
  readonly status: "succeeded" | "failed" | "aborted";
  readonly items: readonly ExperimentItemResult<TInput, TExpected>[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly aggregate: ExperimentAggregate;
  readonly manifest?: EvalManifest;
  readonly trials?: ExperimentTrials;
  readonly error?: ErrorInfo;
}

/** Options for paired baseline-versus-candidate inference. */
export interface CompareExperimentsOptions {
  /** Defaults to the union of observed scorer ids; each must score every paired item. */
  readonly scorers?: readonly string[];
  readonly byTag?: boolean;
  readonly seed?: number;
  /** Bootstrap default 2,000; permutation default 10,000. Maximum HARD_STATS_RESAMPLES. */
  readonly resamples?: number;
  /** BH-adjusted significance level, default 0.05. Does not change ci95 coverage. */
  readonly alpha?: number;
}

export interface ExperimentComparison {
  /** BH correction across all tag/scorer pairs; tags with fewer than two paired items are omitted. */
  readonly byTag?: Readonly<Record<string, ExperimentComparison>>;
  readonly pairedItems: number;
  readonly scorers: Readonly<
    Record<
      string,
      {
        readonly baselineMean: number;
        readonly candidateMean: number;
        /** Candidate minus baseline. */
        readonly difference: number;
        readonly ci95: { readonly low: number; readonly high: number };
        readonly pValue: number;
        readonly qValue: number;
        readonly test: "mcnemar" | "paired_permutation";
        readonly significant: boolean;
      }
    >
  >;
}

export interface TraceLimits {
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxBytes?: number;
}

export interface EvaluationTrace {
  readonly run: RunRecord;
  readonly events: readonly AgentEventRecord[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly usage: readonly UsageRecord[];
}

export interface EvaluationTarget {
  readonly result: RunResult;
  readonly trace?: EvaluationTrace;
  readonly timeline?: ExecutionTimeline;
}

export interface TraceResolverInput extends OwnershipScope {
  readonly sessionId: string;
  readonly runId: string;
  readonly limits?: TraceLimits;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export type TraceResolver = (input: TraceResolverInput) => Promise<EvaluationTrace>;

export interface ModelJudgeRequest<TInput = unknown, TExpected = unknown> {
  readonly rubric: string;
  readonly rubricVersion: string;
  readonly target: EvaluationTarget;
  readonly item?: DatasetItem<TInput, TExpected>;
  readonly signal: AbortSignal;
}

export interface ModelJudgeOptions<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly rubric: string;
  readonly rubricVersion: string;
  readonly judge: (request: ModelJudgeRequest<TInput, TExpected>) => Promise<ScoreResult>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
  readonly maxRubricBytes?: number;
}

export interface JudgeRubric {
  readonly id: string;
  readonly version: string;
  readonly criteria: string;
  readonly scale: readonly { readonly label: string; readonly score: number; readonly description: string }[];
}

export interface RubricJudgeOptions<TInput = unknown, TExpected = unknown> {
  /** Defaults to the rubric id. */
  readonly id?: string;
  /** Host-owned; the scorer closes each session, but never disposes the agent. */
  readonly agent: Agent | (() => Agent | Promise<Agent>);
  readonly rubric: JudgeRubric;
  readonly reference?: (item: DatasetItem<TInput, TExpected>) => string | undefined;
  readonly include?: "answer" | "answer+timeline";
  /** Actual candidate model, including any run override. Missing identity fails closed unless allowed. */
  readonly judgedModel?:
    | Pick<ModelConfig, "provider" | "model">
    | ((input: ScorerInput<TInput, TExpected>) => Pick<ModelConfig, "provider" | "model"> | undefined);
  readonly allowSelfJudging?: boolean;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxRubricBytes?: number;
}

export interface JudgePanelOptions<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly judges: readonly Scorer<TInput, TExpected>[];
  readonly combine: "majority" | "mean" | "median";
  /** Default true: every judge must declare a known, distinct judgeModel at construction. */
  readonly requireDistinctModels?: boolean;
}

export interface PairwiseJudgeOptions<TInput = unknown, TExpected = unknown>
  extends Omit<RubricJudgeOptions<TInput, TExpected>, "rubric" | "reference" | "include" | "judgedModel"> {
  readonly rubric: Pick<JudgeRubric, "id" | "version" | "criteria">;
  readonly allowTie?: boolean;
  /** Actual models for both candidates, including run overrides. Missing identities fail closed unless allowed. */
  readonly judgedModels?:
    | { readonly left: Pick<ModelConfig, "provider" | "model">; readonly right: Pick<ModelConfig, "provider" | "model"> }
    | ((
        input: PairwiseScorerInput<TInput, TExpected>,
      ) => { readonly left: Pick<ModelConfig, "provider" | "model">; readonly right: Pick<ModelConfig, "provider" | "model"> } | undefined);
}

export type PairwisePreference = "left" | "right" | "tie";
export interface PairwiseScoreResult {
  readonly preference: PairwisePreference;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface PairwiseScorerInput<TInput = unknown, TExpected = unknown> {
  readonly left: { readonly name: string; readonly result: RunResult };
  readonly right: { readonly name: string; readonly result: RunResult };
  readonly item: DatasetItem<TInput, TExpected>;
  /** Redact before sending candidate or item content to a judge. */
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
}
export interface PairwiseScorer<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  score(input: PairwiseScorerInput<TInput, TExpected>): PairwiseScoreResult | Promise<PairwiseScoreResult>;
}
export type ComparisonCandidate<TInput = unknown, TExpected = unknown> = (
  item: DatasetItem<TInput, TExpected>,
  signal?: AbortSignal,
) => Promise<RunResult>;
export interface ComparisonRecord {
  readonly trialIndex: number;
  readonly itemId: string;
  readonly scorerId: string;
  readonly left: string;
  readonly right: string;
  readonly preference?: PairwisePreference;
  readonly status: "scored" | "failed";
  readonly reason?: string;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface ComparisonReport {
  /** Separate fit per scorer; null means unavailable evidence, never a confident rank. */
  readonly ranking: readonly {
    readonly scorerId: string;
    readonly candidate: string;
    readonly strength: number | null;
    readonly ci95: readonly [number, number] | null;
    readonly rank: number | null;
  }[];
  /** Consistent / successful swapped judgments; scorers without swap evidence are omitted. */
  readonly positionConsistency: Readonly<Record<string, number>>;
  readonly datasetId: string;
  readonly datasetVersion?: string;
  readonly candidates: readonly string[];
  readonly records: readonly ComparisonRecord[];
  readonly wins: Readonly<Record<string, number>>;
  readonly ties: number;
  readonly failures: number;
}
export interface RunComparisonOptions<TInput = unknown, TExpected = unknown> {
  readonly trials?: number;
  /** Seed for item-bootstrap intervals; does not seed host candidate or scorer calls. */
  readonly seed?: number;
  readonly dataset: Dataset<TInput, TExpected>;
  readonly candidates: Readonly<Record<string, ComparisonCandidate<TInput, TExpected>>>;
  readonly scorers: readonly PairwiseScorer<TInput, TExpected>[];
  readonly concurrency?: number;
  readonly maxCandidates?: number;
  readonly maxCandidateBytes?: number;
  readonly maxScorerOutputBytes?: number;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
}

export interface EvaluationThresholds {
  readonly calibrations?: Readonly<
    Record<
      string,
      {
        readonly report: CalibrationReport;
        readonly minimumKappa: number;
        readonly minimumN?: number;
      }
    >
  >;
  readonly minimumMacroMean?: number;
  readonly maximumFailures?: number;
  readonly minimumByScorer?: Readonly<Record<string, number>>;
  /** Require a valid 95% interval whose lower bound meets the minimum. Missing evidence fails. */
  readonly minimumLowerBound?: Readonly<Record<string, number>>;
  /** Gate candidate-minus-baseline drops using BH-adjusted significance against zero. */
  readonly maximumRegression?: {
    readonly baseline: ExperimentReport;
    readonly delta?: number;
    readonly alpha?: number;
    readonly scorers?: readonly string[];
  };
  readonly minimumPassHatK?: Readonly<Record<string, { readonly k: number; readonly minimum: number }>>;
  readonly minimumCandidateWins?: Readonly<Record<string, number>>;
  /**
   * If true, the report must contain invariant records and all of them must score `1`. Omitted, a
   * present-but-failing invariant still fails; an absent one only fails when this is set.
   */
  readonly requireInvariants?: boolean;
}

export interface CalibrationItem<TInput = unknown, TExpected = unknown> {
  readonly item: DatasetItem<TInput, TExpected>;
  readonly result: RunResult;
  readonly humanScore: number;
}

export interface CalibrationReport {
  /** Successfully scored human/judge pairs; failures do not count toward minimumN. */
  readonly n: number;
  readonly judgeFailures: number;
  readonly cohensKappa: number | null;
  readonly weightedKappa?: number | null;
  /** Nominal alpha, also when the optional kappa scale is ordinal. */
  readonly krippendorffAlpha: number | null;
  readonly spearman: number | null;
  /** Rows are human scores; columns are judge scores. */
  readonly confusion: { readonly labels: readonly number[]; readonly counts: readonly (readonly number[])[] };
  readonly kappaCi95?: { readonly low: number; readonly high: number };
}

export interface EvalManifest {
  readonly promptId?: string;
  readonly promptVersion?: string;
  readonly toolFingerprint?: string;
  readonly skillsRevision?: string;
  readonly model?: string;
  readonly policyRevision?: string;
  readonly runtimeRevision: string;
  readonly datasetVersion: string;
  readonly datasetContentHash?: string;
}

export interface RunExperimentOptions<TInput = unknown, TExpected = unknown> {
  readonly agent:
    | import("@arnilo/prism").Agent
    | ((
        extra: Pick<import("@arnilo/prism").AgentConfig, "hooks" | "slots"> & { readonly item: DatasetItem<TInput, TExpected> },
      ) => Promise<import("@arnilo/prism").Agent>);
  readonly dataset: Dataset<TInput, TExpected>;
  readonly split?: Split | readonly Split[];
  readonly allowHeldout?: boolean;
  readonly scorers: readonly Scorer<TInput, TExpected>[];
  readonly concurrency?: number;
  readonly sampling?: EvaluationSampling;
  readonly store?: EvaluationStore;
  readonly telemetry?: EvaluationTelemetrySink;
  readonly experimentStore?: ExperimentReportStore;
  readonly ownership?: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly signal?: AbortSignal;
  readonly experimentId?: string;
  readonly traceId?: string;
  readonly traceResolver?: TraceResolver;
  readonly traceLimits?: TraceLimits;
  readonly runOptions?: import("@arnilo/prism").RunOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Explicit RNG overrides `seed`. One shared stream, so decisions depend on completion order. */
  readonly random?: () => number;
  /** Hooks for the agent factory. With an `Agent` instance they throw: it cannot be reconfigured. */
  readonly hooks?: import("@arnilo/prism").AgentConfig["hooks"];
  /** Slots for the agent factory. With an `Agent` instance they throw: it cannot be reconfigured. */
  readonly slots?: import("@arnilo/prism").AgentConfig["slots"];
  readonly onItem?: (item: ExperimentItemResult<TInput, TExpected>) => void | Promise<void>;
  /** Convert dataset input into agent input. Defaults to string/Message passthrough or JSON.stringify. */
  readonly toAgentInput?: (input: TInput) => string | import("@arnilo/prism").Message | readonly import("@arnilo/prism").Message[];
  /** Timeline projection mode. Defaults to "off". */
  readonly timeline?: "off" | "metadata" | "redacted_io";
  /** Optional callback to resolve host-trusted environment snapshot per item. */
  readonly toEnvironment?: (
    item: DatasetItem<TInput, TExpected>,
    result?: RunResult,
    timeline?: ExecutionTimeline,
  ) => unknown | Promise<unknown>;
  /** Repeated trials count. Defaults to 1, hard cap 16. */
  readonly trials?: number;
  /**
   * Seed for per-trial RNG: each `(itemId, trialIndex)` gets `mulberry32(hash32(seed, itemId, trialIndex))`,
   * so sampling decisions are the same at any concurrency. Not a claim of LLM determinism.
   */
  readonly seed?: number;
  /** Eval manifest binding runtime, dataset, model, and policy revisions. */
  readonly manifest?: EvalManifest;
}
