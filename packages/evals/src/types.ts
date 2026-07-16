import type {
  AgentRunResult,
  ErrorInfo,
  OwnershipScope,
  PersistencePage,
  PersistenceQuery,
  SecretRedactor,
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
  readonly runOptions?: import("@arnilo/prism").RunOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly random?: () => number;
  readonly onItem?: (item: ExperimentItemResult<TInput, TExpected>) => void | Promise<void>;
  /** Convert dataset input into agent input. Defaults to string/Message passthrough or JSON.stringify. */
  readonly toAgentInput?: (
    input: TInput,
  ) => string | import("@arnilo/prism").Message | readonly import("@arnilo/prism").Message[];
}
