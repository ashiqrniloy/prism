/** Contracts-core persistence family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { AgentEventRecord, AgentEventSource, AgentEventType, RunRecord, RunStatus, ToolCallRecord, ToolCallStatus, UsageRecord, UsageScope } from "../contracts-protocol.js";
import type { AgentDefinition } from "./agent.js";
import type { ErrorInfo, JsonObject, Usage } from "./content.js";
import type { SessionBranchRead, SessionEntry, SessionEntryKind, SessionStore } from "./session.js";
export interface StoreFactory {
    readonly name: string;
    create(config?: JsonObject): Promise<SessionStore> | SessionStore;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Ownership scope identifiers. Hosts may use these for multi-tenant isolation. */
export interface OwnershipScope {
    readonly tenantId?: string;
    readonly accountId?: string;
    readonly userId?: string;
}
/** Cursor-paginated result page. */
export interface PersistencePage<T> {
    readonly items: readonly T[];
    readonly nextCursor?: string;
    readonly total?: number;
}
/** Common query controls for cursor-based pagination. */
export interface PersistenceQuery {
    readonly cursor?: string;
    readonly limit?: number;
    readonly order?: "asc" | "desc";
}
/** Stored session record. Does not include provider objects or credentials. */
export interface SessionRecord extends OwnershipScope {
    readonly id: string;
    readonly parentSessionId?: string;
    readonly agentDefinitionId?: string;
    readonly agentDefinitionVersion?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly expiresAt?: string;
    readonly retentionPolicyId?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    /** Write version for optimistic metadata CAS; undefined on legacy/never-written rows. */
    readonly version?: number;
}
/** Stored branch handle / leaf pointer. The leaf is the current entry id for the branch. */
export interface BranchRecord {
    readonly id: string;
    readonly sessionId: string;
    readonly name?: string;
    readonly rootEntryId?: string;
    readonly parentBranchId?: string;
    /** Durable leaf entry id for this branch (the persistence-side branch tip). */
    readonly leafEntryId?: string;
    readonly createdAt: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface RunFeedbackRecord extends OwnershipScope {
    readonly id: string;
    readonly runId: string;
    readonly sessionId: string;
    readonly traceId?: string;
    readonly rating?: number;
    readonly comment?: string;
    readonly tags: readonly string[];
    readonly scorerIds: readonly string[];
    readonly evaluationIds: readonly string[];
    readonly createdAt: string;
    readonly createdBy?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface AppendRunFeedbackInput extends OwnershipScope {
    readonly id: string;
    readonly runId: string;
    readonly sessionId?: string;
    readonly traceId?: string;
    readonly rating?: number;
    readonly comment?: string;
    readonly tags?: readonly string[];
    readonly scorerIds?: readonly string[];
    readonly evaluationIds?: readonly string[];
    readonly createdAt?: string;
    readonly createdBy?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly signal?: AbortSignal;
}
/** Cursor-paginated, ownership-scoped feedback query. */
export interface RunFeedbackQuery extends PersistenceQuery, OwnershipScope {
    readonly runId?: string;
    readonly sessionId?: string;
    readonly traceId?: string;
    readonly rating?: number;
    readonly scorerId?: string;
    readonly evaluationId?: string;
    readonly tag?: string;
    readonly fromCreatedAt?: string;
    readonly toCreatedAt?: string;
    readonly signal?: AbortSignal;
}
export interface DeleteRunFeedbackInput extends OwnershipScope {
    readonly id: string;
    readonly signal?: AbortSignal;
}
/** Feedback storage seam. Records are append-only; correction uses a new record and deletion is explicit. */
export interface RunFeedbackStore {
    append(input: AppendRunFeedbackInput): Promise<RunFeedbackRecord>;
    query(query: RunFeedbackQuery): Promise<PersistencePage<RunFeedbackRecord>>;
    delete(input: DeleteRunFeedbackInput): Promise<boolean>;
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
    readonly stepId?: string;
    readonly nodeId?: string;
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
/** Persistence seam for evaluation records. */
export interface EvaluationStore {
    append(record: EvaluationRecord): Promise<void> | void;
    query(query?: EvaluationQuery): Promise<PersistencePage<EvaluationRecord>>;
}
/** Content-free experiment summary, bounded by the store codec to 1 MiB. */
export interface ExperimentReportRecord extends OwnershipScope {
    readonly id: string;
    readonly datasetId: string;
    readonly datasetVersion?: string;
    readonly datasetContentHash?: string;
    readonly manifest?: {
        readonly promptId?: string;
        readonly promptVersion?: string;
        readonly toolFingerprint?: string;
        readonly skillsRevision?: string;
        readonly model?: string;
        readonly policyRevision?: string;
        readonly runtimeRevision: string;
        readonly datasetVersion: string;
        readonly datasetContentHash?: string;
    };
    /** Numeric aggregate statistics only; no item content, reasons, or record metadata. */
    readonly aggregate: {
        readonly itemCount: number;
        readonly scoredCount: number;
        readonly skippedCount: number;
        readonly failedCount: number;
        readonly macroMean?: number;
        readonly scorers: Readonly<Record<string, {
            readonly items: number;
            readonly records: number;
            readonly mean: number;
            readonly passRate: number;
            readonly passAtK?: Readonly<Record<number, number>>;
            readonly passHatK?: Readonly<Record<number, number>>;
            readonly passKCounts?: Readonly<Record<number, {
                readonly items: number;
                readonly excludedItems: number;
            }>>;
            readonly se?: number;
            readonly ci95?: {
                readonly low: number;
                readonly high: number;
            };
            readonly judgeAgreement?: number;
            readonly method: "single_item" | "wilson" | "cluster_bootstrap";
        }>>;
        readonly cost?: Omit<Usage, "metadata" | "confidence"> & {
            readonly costComplete: boolean;
            readonly meanPerItem: Omit<Usage, "metadata" | "confidence"> & {
                readonly durationMs?: number;
            };
            readonly durationMs?: {
                readonly p50: number;
                readonly p95: number;
            };
        };
        readonly byTag?: Readonly<Record<string, {
            readonly scorers: ExperimentReportRecord["aggregate"]["scorers"];
        }>>;
        readonly invariantsPassed?: boolean;
    };
    readonly itemMeans: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly createdAt: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Manifest matching compares each supplied field by exact value. Ownership is always exact. */
export interface ExperimentReportQuery extends PersistenceQuery, OwnershipScope {
    readonly id?: string;
    readonly datasetId?: string;
    readonly datasetVersion?: string;
    readonly datasetContentHash?: string;
    readonly manifestMatch?: Partial<NonNullable<ExperimentReportRecord["manifest"]>>;
    readonly signal?: AbortSignal;
}
export interface ExperimentReportStore {
    append(record: ExperimentReportRecord): Promise<void> | void;
    query(query?: ExperimentReportQuery): Promise<PersistencePage<ExperimentReportRecord>>;
    latest(query: ExperimentReportQuery & {
        readonly datasetId: string;
    }): Promise<ExperimentReportRecord | undefined>;
}
/** Stored agent definition version. Does not include provider credentials/resolvers/provider instances. */
export interface AgentDefinitionRecord extends OwnershipScope {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly source?: string;
    readonly agentDefinition: AgentDefinition;
    readonly createdAt: string;
    readonly createdBy?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Stored retention policy. */
export interface RetentionPolicy extends OwnershipScope {
    readonly id: string;
    readonly name?: string;
    readonly maxAgeDays?: number;
    readonly maxEntriesPerSession?: number;
    readonly maxTotalBytes?: number;
    readonly archiveStore?: string;
    readonly appliedKinds?: readonly SessionEntryKind[];
    readonly createdAt: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Stored migration record. */
export interface MigrationRecord {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly appliedAt: string;
    readonly appliedBy?: string;
    readonly checksum?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Query for sessions. */
export interface SessionQuery extends PersistenceQuery, OwnershipScope {
    readonly id?: string;
    readonly parentSessionId?: string;
    readonly agentDefinitionId?: string;
    readonly agentDefinitionVersion?: string;
    readonly retentionPolicyId?: string;
    /** Match sessions whose `metadata` object contains this top-level key (e.g. conversation marker). */
    readonly metadataKey?: string;
    readonly fromCreatedAt?: string;
    readonly toCreatedAt?: string;
    readonly fromUpdatedAt?: string;
    readonly toUpdatedAt?: string;
    readonly hasExpired?: boolean;
}
/** Validate a top-level `SessionRecord.metadata` key used by `SessionQuery.metadataKey` filters. */
export declare function assertSessionMetadataKey(key: string): string;
/** Query for session entries. */
export interface SessionEntryQuery extends PersistenceQuery, OwnershipScope {
    readonly sessionId?: string;
    readonly runId?: string;
    readonly parentId?: string;
    /** Filter to entries on the branch ending at this leaf id. */
    readonly leafId?: string;
    readonly kind?: SessionEntryKind | readonly SessionEntryKind[];
    readonly fromTimestamp?: string;
    readonly toTimestamp?: string;
}
/** Query for branch handles/leaves. */
export interface BranchQuery extends PersistenceQuery {
    readonly sessionId?: string;
    readonly name?: string;
    readonly parentBranchId?: string;
    readonly hasLeaf?: boolean;
}
/** Query for runs. */
export interface RunQuery extends PersistenceQuery, OwnershipScope {
    readonly sessionId?: string;
    readonly branchId?: string;
    readonly agentDefinitionId?: string;
    readonly agentDefinitionVersion?: string;
    readonly status?: RunStatus | readonly RunStatus[];
    readonly fromStartedAt?: string;
    readonly toStartedAt?: string;
    readonly fromFinishedAt?: string;
    readonly toFinishedAt?: string;
    readonly isFinished?: boolean;
}
/** Query for agent event ledger rows. */
export interface AgentEventQuery extends PersistenceQuery, OwnershipScope {
    readonly sessionId?: string;
    readonly runId?: string;
    readonly entryId?: string;
    readonly type?: AgentEventType | readonly AgentEventType[];
    readonly fromTimestamp?: string;
    readonly toTimestamp?: string;
    readonly redacted?: boolean;
}
/** Query for tool-call rows. */
export interface ToolCallQuery extends PersistenceQuery, OwnershipScope {
    readonly sessionId?: string;
    readonly runId?: string;
    readonly entryId?: string;
    readonly name?: string;
    readonly status?: ToolCallStatus | readonly ToolCallStatus[];
    readonly fromStartedAt?: string;
    readonly toStartedAt?: string;
    readonly fromFinishedAt?: string;
    readonly toFinishedAt?: string;
    readonly redacted?: boolean;
}
/** Query for usage rows. */
export interface UsageQuery extends PersistenceQuery, OwnershipScope {
    readonly sessionId?: string;
    readonly runId?: string;
    readonly entryId?: string;
    readonly scope?: UsageScope;
    readonly turn?: number;
    readonly attempt?: number;
    readonly fromRecordedAt?: string;
    readonly toRecordedAt?: string;
}
/** Query for agent definition versions. */
export interface AgentDefinitionQuery extends PersistenceQuery, OwnershipScope {
    readonly name?: string;
    readonly version?: string;
    readonly source?: string;
    readonly fromCreatedAt?: string;
    readonly toCreatedAt?: string;
}
/** Query for retention policies. */
export interface RetentionPolicyQuery extends PersistenceQuery, OwnershipScope {
    readonly name?: string;
    readonly archiveStore?: string;
}
/** Query for migration records. */
export interface MigrationQuery extends PersistenceQuery {
    readonly name?: string;
    readonly version?: string;
    readonly fromAppliedAt?: string;
    readonly toAppliedAt?: string;
}
/**
 * Production database-neutral persistence store contract.
 * Hosts implement this interface to provide durable, paginated storage
 * for sessions, entries, runs, events, tool calls, usage, agent definitions,
 * and migrations. No SQL client, ORM, host file storage, or network dependency is
 * required by the contract. Resumable consumers (workflows, channels) reach the
 * checkpoints and leases capabilities through the service contracts their own
 * packages publish (plan 168 Task 4-5).
 */
export interface ProductionPersistenceStore {
    readonly name?: string;
    /** Optional immutable run/trace feedback storage capability. */
    readonly feedback?: RunFeedbackStore;
    readonly evaluations?: EvaluationStore;
    readonly experiments?: ExperimentReportStore;
    /** Optional durable, cross-replica-capable event source. */
    readonly events?: AgentEventSource;
    querySessions(query: SessionQuery): Promise<PersistencePage<SessionRecord>>;
    queryBranches(query: BranchQuery): Promise<PersistencePage<BranchRecord>>;
    queryEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>>;
    queryRuns(query: RunQuery): Promise<PersistencePage<RunRecord>>;
    queryEvents(query: AgentEventQuery): Promise<PersistencePage<AgentEventRecord>>;
    queryToolCalls(query: ToolCallQuery): Promise<PersistencePage<ToolCallRecord>>;
    queryUsage(query: UsageQuery): Promise<PersistencePage<UsageRecord>>;
    queryAgentDefinitions(query: AgentDefinitionQuery): Promise<PersistencePage<AgentDefinitionRecord>>;
    queryRetentionPolicies(query: RetentionPolicyQuery): Promise<PersistencePage<RetentionPolicy>>;
    queryMigrations(query: MigrationQuery): Promise<PersistencePage<MigrationRecord>>;
    /** Optional session-record write capability (conversation threads, host-managed sessions).
     *  Upserts by id; ownership columns are set on create, `metadata`/`updatedAt` on update.
     *  Additive CAS: pass `expectedVersion` to require the stored version to match before the
     *  write (0 = create-only, a positive number = exact current version); omit it for legacy
     *  last-write-wins. Returns the new `version` when the underlying store supports it. */
    appendSession?(record: SessionRecord & {
        readonly expectedVersion?: number;
    }): Promise<{
        readonly version: number;
    } | undefined>;
    /** DB-friendly branch read (mirrors `SessionStore.readBranchPath`): one ancestor-chain
     *  query instead of `queryEntries({ sessionId })` + in-memory walk. Optional. */
    readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
