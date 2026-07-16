import type { Pool, PoolConfig } from "pg";
import type { SecretRedactor } from "@arnilo/prism";

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
  /** Skip automatic migration on open (tests only). */
  readonly skipMigrations?: boolean;
}

export interface PostgresPersistenceCloseOptions {
  readonly pool?: Pool;
}
