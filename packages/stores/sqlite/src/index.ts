/// <reference path="./bun-sqlite.d.ts" />
/**
 * `@arnilo/prism-store-sqlite` — the SQLite session store (with its leases, lifecycle, and schema
 * migrations) as the `store` slot. `bun:sqlite` is built in; the module fails closed with a
 * runtime-naming error when it is imported outside Bun.
 *
 * ```ts
 * import sqliteStore from "@arnilo/prism-store-sqlite";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [sqliteStore({ path: ".prism/sessions.db" })],
 * });
 * ```
 */

import { definePackage, type JsonSchema, type PackageInstance } from "@arnilo/prism";
import manifest from "../package.json" with { type: "json" };

import { createSqlitePersistence } from "./persistence.js";

export { createSqliteCheckpointStore } from "./checkpoints.js";
export {
  ADAPTER_INDEX_NAMES,
  ADAPTER_TABLE_NAMES,
  MIGRATION_001_INIT,
  MIGRATION_002_USAGE_SCOPE,
  MIGRATION_003_RUN_FEEDBACK,
  MIGRATION_004_SESSION_SEARCH,
  MIGRATION_005_LIFECYCLE_HOLD_QUOTA,
  MIGRATION_006_AGENT_EVENT_SOURCE,
  MIGRATION_007_AGENT_EVENT_RETENTION_INDEX,
  MIGRATION_008_SESSION_VERSION,
  MIGRATION_009_RUN_PROMPT_VERSION,
  MIGRATION_010_SESSION_LINKS,
  MIGRATION_011_EVALUATIONS,
} from "./ddl.js";
export { createSqliteLeaseStore } from "./leases.js";
export { createSqlitePersistenceLifecycle } from "./lifecycle.js";
export {
  applySqliteMigrations,
  assertSqliteSchemaReady,
  configureSqliteDatabase,
  maybeRestrictFileMode,
  verifyMigrationIdempotency,
} from "./migrations.js";
export type { SqlitePersistence } from "./persistence.js";
export { createSqlitePersistence, DEFAULT_BUSY_TIMEOUT_MS, reopenSqlitePersistence } from "./persistence.js";
export type { SqlitePersistenceOptions } from "./types.js";

/** Validated `packageConfig` for this package. The host resolves `path` against the process cwd. */
export interface SqliteStoreConfig {
  readonly path: string;
  readonly busyTimeoutMs?: number;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 4096 },
    busyTimeoutMs: { type: "number", minimum: 0 },
  },
  // `path` is checked in setup rather than declared required: a config schema whose defaults cannot
  // validate would fail package conformance, and the setup error names the field (plan 152 Task 6).
  additionalProperties: false,
};

const definition = definePackage<SqliteStoreConfig>({
  name: "@arnilo/prism-store-sqlite",
  version: manifest.version,
  description: "SQLite session store with leases, lifecycle, and schema migrations.",
  requires: { api: 1 },
  capabilities: ["slot:store"],
  config: configSchema,
  setup: (prism) => {
    const path = prism.config.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("prism-store-sqlite: config needs path (the SQLite database file; use :memory: for tests)");
    }
    const persistence = createSqlitePersistence({ filename: path, busyTimeoutMs: prism.config.busyTimeoutMs });
    prism.slots.store.provide(persistence);
    // The workflows service names are the cross-package contract (plan 168 Task 4); both stores share the
    // one open `Database` above, so providing them opens no second handle.
    prism.services.provide("checkpoints", persistence.checkpoints);
    prism.services.provide("leases", persistence.leases);
  },
});

/** The package definition. Pass `path` through `packageConfig` or use {@link sqliteStore}. */
export default definition;

/** The package with `path` baked in, for `packages: [sqliteStore({ path })]`. */
export function sqliteStore(config: SqliteStoreConfig): PackageInstance {
  return definition(config);
}
