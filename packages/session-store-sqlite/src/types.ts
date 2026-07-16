import type Database from "better-sqlite3";
import type { SecretRedactor } from "@arnilo/prism";

/** Default busy timeout in milliseconds (SQLite `busy_timeout` pragma). */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface SqlitePersistenceOptions {
  /** SQLite database file path. Use `:memory:` for ephemeral tests. */
  readonly filename: string;
  /** Enable WAL journal mode. Defaults to `true`. */
  readonly wal?: boolean;
  /** Busy timeout in milliseconds. Defaults to {@link DEFAULT_BUSY_TIMEOUT_MS}. */
  readonly busyTimeoutMs?: number;
  /** Restrictive file mode for newly created database files on Unix (octal). Defaults to `0o600`. */
  readonly fileMode?: number;
  /** Skip automatic migration on open (tests only). */
  readonly skipMigrations?: boolean;
  /** Redacts feedback comments/tags/metadata before durable storage. */
  readonly feedbackRedactor?: SecretRedactor;
  /** Existing open database handle (advanced). Caller owns lifecycle when set. */
  readonly database?: Database.Database;
}

export interface SqlitePersistenceCloseOptions {
  readonly database?: Database.Database;
}
