import type {
  AgentRunResult,
  ErrorInfo,
  OwnershipScope,
  PersistencePage,
  PersistenceQuery,
  SecretRedactor,
  RunRecord,
  AgentEventRecord,
  ToolCallRecord,
  UsageRecord,
} from "@arnilo/prism";

/** Score payload returned by a scorer. `score` must be finite and within `[0, 1]`. */
export interface ScoreResult {
  readonly score: number;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Input passed to a scorer. Scorers receive results only — no credentials, tools, or workspace. */
export interface ScorerInput<TInput = unknown, TExpected = unknown> {
  readonly result: AgentRunResult;
  readonly item?: DatasetItem<TInput, TExpected>;
  readonly expected?: TExpected;
  readonly signal?: AbortSignal;
  readonly target?: EvaluationTarget;
}

/** Deterministic function scorer. */
export interface Scorer<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly description?: string;
  score(input: ScorerInput<TInput, TExpected>): ScoreResult | Promise<ScoreResult>;
}

/** One dataset row. */
export interface DatasetItem<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly input: TInput;
  readonly expected?: TExpected;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Immutable dataset snapshot. */
export interface Dataset<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly items: readonly DatasetItem<TInput, TExpected>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type EvaluationStatus = "scored" | "skipped" | "failed";

/** Persisted evaluation row linked to run/session/trace IDs. */
export interface EvaluationRecord extends OwnershipScope {
  readonly id: string;
  readonly scorerId: string;
  readonly status: EvaluationStatus;
  readonly score?: number;
  readonly reason?: string;
  readonly sampled: boolean;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly traceId?: string;
  readonly datasetId?: string;
  readonly itemId?: string;
  readonly experimentId?: string;
  readonly error?: ErrorInfo;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Cursor-paginated evaluation query. */
export interface EvaluationQuery extends PersistenceQuery, OwnershipScope {
  readonly id?: string;
  readonly scorerId?: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly experimentId?: string;
  readonly datasetId?: string;
  readonly itemId?: string;
  readonly status?: EvaluationStatus | readonly EvaluationStatus[];
  readonly signal?: AbortSignal;
}

/** Package-local persistence seam for evaluation records. */
export interface EvaluationStore {
  append(record: EvaluationRecord): Promise<void> | void;
  query(query?: EvaluationQuery): Promise<PersistencePage<EvaluationRecord>>;
}

export interface DefineScorerInput<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly description?: string;
  readonly score: Scorer<TInput, TExpected>["score"];
}

export interface DefineDatasetInput<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly items: readonly DatasetItem<TInput, TExpected>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ScoreRunOptions<TInput = unknown, TExpected = unknown> {
  readonly result: AgentRunResult;
  readonly scorers: readonly Scorer<TInput, TExpected>[];
  /** Fraction of runs to score in `[0, 1]`. Defaults to `1`. */
  readonly sampleRate?: number;
  readonly store?: EvaluationStore;
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
  readonly random?: () => number;
}

export interface LiveScoreOptions<TInput = unknown, TExpected = unknown>
  extends Omit<ScoreRunOptions<TInput, TExpected>, "result"> {
  readonly onError?: (error: unknown) => void;
}

export interface ExperimentItemResult<TInput = unknown, TExpected = unknown> {
  readonly item: DatasetItem<TInput, TExpected>;
  readonly result?: AgentRunResult;
  readonly evaluations: readonly EvaluationRecord[];
  readonly error?: ErrorInfo;
}

export interface ExperimentAggregate {
  readonly itemCount: number;
  readonly scoredCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly meanScore?: number;
  readonly scoresByScorer: Readonly<Record<string, { readonly count: number; readonly mean?: number }>>;
}

export interface ExperimentReport<TInput = unknown, TExpected = unknown> {
  readonly experimentId: string;
  readonly datasetId: string;
  readonly datasetVersion?: string;
  readonly status: "succeeded" | "failed" | "aborted";
  readonly items: readonly ExperimentItemResult<TInput, TExpected>[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly aggregate: ExperimentAggregate;
  readonly error?: ErrorInfo;
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
  readonly result: AgentRunResult;
  readonly trace?: EvaluationTrace;
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

export type PairwisePreference = "left" | "right" | "tie";
export interface PairwiseScoreResult {
  readonly preference: PairwisePreference;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface PairwiseScorerInput<TInput = unknown, TExpected = unknown> {
  readonly left: { readonly name: string; readonly result: AgentRunResult };
  readonly right: { readonly name: string; readonly result: AgentRunResult };
  readonly item: DatasetItem<TInput, TExpected>;
  readonly signal?: AbortSignal;
}
export interface PairwiseScorer<TInput = unknown, TExpected = unknown> {
  readonly id: string;
  score(input: PairwiseScorerInput<TInput, TExpected>): PairwiseScoreResult | Promise<PairwiseScoreResult>;
}
export type ComparisonCandidate<TInput = unknown, TExpected = unknown> = (
  item: DatasetItem<TInput, TExpected>, signal?: AbortSignal,
) => Promise<AgentRunResult>;
export interface ComparisonRecord {
  readonly itemId: string;
  readonly scorerId: string;
  readonly left: string;
  readonly right: string;
  readonly preference?: PairwisePreference;
  readonly status: "scored" | "failed";
  readonly reason?: string;
  readonly error?: ErrorInfo;
}
export interface ComparisonReport {
  readonly datasetId: string;
  readonly datasetVersion?: string;
  readonly candidates: readonly string[];
  readonly records: readonly ComparisonRecord[];
  readonly wins: Readonly<Record<string, number>>;
  readonly ties: number;
  readonly failures: number;
}
export interface RunComparisonOptions<TInput = unknown, TExpected = unknown> {
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
  readonly minimumMean?: number;
  readonly maximumFailures?: number;
  readonly minimumByScorer?: Readonly<Record<string, number>>;
  readonly minimumCandidateWins?: Readonly<Record<string, number>>;
}

export interface RunExperimentOptions<TInput = unknown, TExpected = unknown> {
  readonly agent: import("@arnilo/prism").Agent;
  readonly dataset: Dataset<TInput, TExpected>;
  readonly scorers: readonly Scorer<TInput, TExpected>[];
  readonly concurrency?: number;
  readonly sampleRate?: number;
  readonly store?: EvaluationStore;
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
  readonly random?: () => number;
  readonly onItem?: (item: ExperimentItemResult<TInput, TExpected>) => void | Promise<void>;
  /** Convert dataset input into agent input. Defaults to string/Message passthrough or JSON.stringify. */
  readonly toAgentInput?: (
    input: TInput,
  ) => string | import("@arnilo/prism").Message | readonly import("@arnilo/prism").Message[];
}
