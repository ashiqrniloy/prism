import type { OwnershipScope } from "@arnilo/prism";
import type { EvaluationStore } from "@arnilo/prism-evals";
import type { ModelRouterStateStore } from "@arnilo/prism-model-router";
import type { PolicyDecisionStore } from "@arnilo/prism-policy";
import type { IdempotencyStore } from "@arnilo/prism-work-tools";
import type { Pool, PoolConfig } from "pg";

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

/** Open enterprise-state composition. Importing package or types never opens a connection. */
export interface PostgresEnterpriseState {
  readonly policy: PolicyDecisionStore;
  readonly evaluations: EvaluationStore;
  readonly workIdempotency: IdempotencyStore;
  readonly modelRouter: ModelRouterStateStore;
  cleanup(input: EnterpriseStateCleanupInput): Promise<EnterpriseStateCleanupResult>;
  /** Ends only an adapter-owned pool. */
  close(): Promise<void>;
}
