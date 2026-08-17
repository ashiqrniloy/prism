import type { AgentIdentity, OwnershipScope, ToolEffectStore } from "@arnilo/prism";
import type { EvaluationStore } from "@arnilo/prism-evals";
import type { ModelRouterStateStore } from "@arnilo/prism-model-router";
import type { PolicyDecisionStore } from "@arnilo/prism-policy";
import type { IdempotencyStore } from "@arnilo/prism-work-tools";
import type { Pool, PoolClient, PoolConfig } from "pg";

/** Default PostgreSQL schema for enterprise-state tables. */
export const DEFAULT_ENTERPRISE_SCHEMA = "prism";
/** Default maximum connections for an adapter-owned pool. */
export const DEFAULT_ENTERPRISE_POOL_MAX = 10;

export interface PostgresEnterpriseStateOptions {
  /** Existing `pg` pool. Caller retains lifecycle ownership. */
  readonly pool?: Pool;
  /** Connection string used only when `pool` is omitted. */
  readonly connectionString?: string;
  /** Validated PostgreSQL schema. Defaults to `prism`. */
  readonly schema?: string;
  /** Adapter-owned pool cap. Defaults to 10 and is capped at 100. */
  readonly poolMax?: number;
  /** Additional `pg` pool configuration for an adapter-owned pool. */
  readonly poolConfig?: Omit<PoolConfig, "connectionString" | "max">;
  /** Skip migration/open checks for isolated unit tests only. */
  readonly skipMigrations?: boolean;
}

/** Explicit owner/principal-scoped cleanup request. No global sweep exists. */
export interface EnterpriseStateCleanupInput extends OwnershipScope {
  readonly principalId: string;
  /** Rows to transition/delete across this exact scope. Default 100, maximum 500. */
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface EnterpriseStateCleanupResult {
  /** Rows deleted from expired retained work/router state. */
  readonly removed: number;
  /** Expired work claims/probes converted to durable safe states. */
  readonly transitioned: number;
}

export type ErpOutboxStatus = "pending" | "dispatched" | "retryable" | "completed" | "unknown" | "dead_letter";

export interface ErpOutboxRecord {
  readonly tenantId: string;
  readonly messageId: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly status: ErpOutboxStatus;
  readonly attempt: number;
  readonly version: number;
  readonly claimToken?: string;
  readonly leaseExpiresAt?: string;
  readonly nextAttemptAt: string;
  readonly lastError?: unknown;
  readonly lastActionRef?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ErpOutboxAppendInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly topic: string;
  readonly payload: unknown;
}

export interface ErpInboxRecordInput {
  readonly tenantId: string;
  readonly consumer: string;
  readonly messageId: string;
}

export interface ErpOutboxClaimInput {
  readonly tenantId: string;
  readonly batchSize?: number;
  readonly leaseTtlMs?: number;
  readonly maxAttempts?: number;
  readonly signal?: AbortSignal;
}

export interface ErpOutboxTransitionInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly claimToken: string;
  readonly expectedVersion: number;
  readonly signal?: AbortSignal;
}

export interface ErpOutboxRetryInput extends ErpOutboxTransitionInput {
  readonly error?: unknown;
  readonly delayMs?: number;
  readonly maxAttempts?: number;
}

export interface ErpOutboxUnknownInput extends ErpOutboxTransitionInput {
  readonly error?: unknown;
}

export interface ErpOutboxDeadLetterInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly expectedVersion: number;
  readonly auditRef: string;
  readonly authorizedBy: AgentIdentity;
  readonly claimToken?: string;
  readonly signal?: AbortSignal;
}

export interface ErpOutboxReplayInput {
  readonly tenantId: string;
  readonly messageId: string;
  readonly expectedVersion: number;
  readonly auditRef: string;
  readonly authorizedBy: AgentIdentity;
  readonly signal?: AbortSignal;
}

export interface ErpOutboxStore {
  append(client: PoolClient, input: ErpOutboxAppendInput): Promise<ErpOutboxRecord>;
}

export interface ErpInboxStore {
  record(client: PoolClient, input: ErpInboxRecordInput): Promise<boolean>;
}

export interface ErpOutboxDispatcher {
  claim(input: ErpOutboxClaimInput): Promise<readonly ErpOutboxRecord[]>;
  acknowledge(input: ErpOutboxTransitionInput): Promise<ErpOutboxRecord>;
  retry(input: ErpOutboxRetryInput): Promise<ErpOutboxRecord>;
  markUnknown(input: ErpOutboxUnknownInput): Promise<ErpOutboxRecord>;
  deadLetter(input: ErpOutboxDeadLetterInput): Promise<ErpOutboxRecord>;
  replay(input: ErpOutboxReplayInput): Promise<ErpOutboxRecord>;
}

export interface PostgresErpMessaging {
  readonly outbox: ErpOutboxStore;
  readonly inbox: ErpInboxStore;
  readonly dispatcher: ErpOutboxDispatcher;
}

export interface PostgresErpMessagingOptions {
  /** Existing pool; caller retains lifecycle ownership. */
  readonly pool: Pool;
  /** Validated PostgreSQL schema. Defaults to `prism`. */
  readonly schema?: string;
  /** Default maximum attempts for retry transitions. Defaults to 3. */
  readonly maxAttempts?: number;
}

/** Open enterprise-state composition. Importing package or types never opens a connection. */
export interface PostgresEnterpriseState {
  readonly policy: PolicyDecisionStore;
  readonly evaluations: EvaluationStore;
  readonly workIdempotency: IdempotencyStore;
  /** Durable generic effect claim/recovery store; work connectors retain workIdempotency. */
  readonly toolEffects: ToolEffectStore;
  readonly modelRouter: ModelRouterStateStore;
  /** Transactional outbox/inbox and bounded, at-least-once dispatcher. */
  readonly erpMessaging: PostgresErpMessaging;
  cleanup(input: EnterpriseStateCleanupInput): Promise<EnterpriseStateCleanupResult>;
  /** Ends only an adapter-owned pool. */
  close(): Promise<void>;
}
