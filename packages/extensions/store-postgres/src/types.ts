import type { AgentEventSourceOptions, SecretRedactor, SessionQueryLimits } from "@arnilo/prism";
import type { RunFeedbackLimits } from "@arnilo/prism-extensions/store-codecs";
import type { Pool, PoolConfig } from "pg";

/** Default PostgreSQL schema for Prism tables. */
export const DEFAULT_SCHEMA = "prism";

/** Default maximum pool size when the adapter creates its own pool. */
export const DEFAULT_POOL_MAX = 10;

export interface PostgresPersistenceOptions {
  /** Existing `pg` pool (advanced). Caller owns lifecycle when set. */
  readonly pool?: Pool;
  /** Connection string used when `pool` is omitted. */
  readonly connectionString?: string;
  /** PostgreSQL schema for Prism tables. Defaults to {@link DEFAULT_SCHEMA}. */
  readonly schema?: string;
  /** Maximum pool size when creating a pool from `connectionString`. Defaults to {@link DEFAULT_POOL_MAX}. */
  readonly poolMax?: number;
  /** Additional pool options when creating a pool from `connectionString`. */
  readonly poolConfig?: Omit<PoolConfig, "connectionString" | "max">;
  /** Redacts feedback comments/tags/metadata before durable storage. */
  readonly feedbackRedactor?: SecretRedactor;
  /** Redacts evaluation reasons/errors/metadata and experiment metadata before storage. */
  readonly evaluationRedactor?: SecretRedactor;
  /** Bounds durable event pages, subscriptions, polling, and retention operations. */
  readonly eventSource?: AgentEventSourceOptions;
  /** Stable HMAC secret shared by replicas that resume durable event cursors. */
  readonly eventCursorSecret?: string | Uint8Array;
  /**
   * Store query limits (plan 239 Task 5): the largest list and search page, the search text, cursor and snippet
   * bytes, and the full-text candidate rows ranked per search. Host-only; each defaults to the kernel's value.
   */
  readonly queryLimits?: SessionQueryLimits;
  /** Largest page of a checkpoint, lifecycle or feedback listing. Default 500 (`DEFAULT_MAX_STORE_PAGE_SIZE`). */
  readonly maxPageSize?: number;
  /** Bounds of one run-feedback record: comment and metadata bytes, tags, links. Defaults from `@arnilo/prism-extensions/store-codecs`. */
  readonly feedbackLimits?: Omit<RunFeedbackLimits, "maxPageSize">;
  /** Skip automatic migration on open (tests only). */
  readonly skipMigrations?: boolean;
}
