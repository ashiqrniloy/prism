import type { Database } from "bun:sqlite";
import type { SecretRedactor, SessionQueryLimits } from "@arnilo/prism";
import type { RunFeedbackLimits } from "@arnilo/prism-extensions/store-codecs";

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
  /** Redacts feedback comments/tags/metadata before durable storage. */
  readonly feedbackRedactor?: SecretRedactor;
  /** Redacts evaluation reasons/errors/metadata and experiment metadata before storage. */
  readonly evaluationRedactor?: SecretRedactor;
  /** Existing open database handle (advanced). Caller owns lifecycle when set. */
  readonly database?: Database;
}
