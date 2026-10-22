/**
 * `@arnilo/prism-store-postgres` — the PostgreSQL session store (with its leases, lifecycle, run
 * ledger, event source, and schema migrations) as the `store` slot, over `pg`.
 *
 * `pg` is a dependency of this package alone and loads lazily: importing this module (or running an
 * agent that does not list it) never loads the driver.
 *
 * ```ts
 * import postgresStore from "@arnilo/prism-store-postgres";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [postgresStore({ url: "env:PRISM_DATABASE_URL" })],
 * });
 * ```
 */

import { type AgentEventSourceOptions, definePackage, type JsonSchema, type PackageInstance, type SecretRedactor } from "@arnilo/prism";
import type { Pool, PoolConfig } from "pg";
import manifest from "../package.json" with { type: "json" };

import { createPostgresPersistence } from "./persistence.js";

export { createPostgresCheckpointStore } from "./checkpoints.js";
export {
  ADAPTER_INDEX_NAMES,
  ADAPTER_TABLE_NAMES,
  buildMigration001Ddl,
  buildMigration002Ddl,
  buildMigration003Ddl,
  buildMigration004Ddl,
  buildMigration005Ddl,
  buildMigration006Ddl,
  buildMigration007Ddl,
  buildMigration008Ddl,
  buildMigration009Ddl,
  buildMigration010Ddl,
} from "./ddl.js";
export {
  type ClosablePostgresAgentEventSource,
  createPostgresAgentEventSource,
  type PostgresAgentEventSourceOptions,
} from "./event-source.js";
export { MIGRATION_LOCK_NAMESPACE, qualifyTable, quoteIdentifier, schemaAdvisoryLockKey, validateIdentifier } from "./identifiers.js";
export { createPostgresLeaseStore } from "./leases.js";
export { createPostgresPersistenceLifecycle } from "./lifecycle.js";
export { applyPostgresMigrations, assertPostgresSchemaReady, verifyMigrationIdempotency } from "./migrations.js";
export type { PostgresPersistence } from "./persistence.js";
export { createPostgresPersistence, DEFAULT_POOL_MAX, DEFAULT_SCHEMA, reopenPostgresPersistence } from "./persistence.js";
export type { PostgresPersistenceOptions } from "./types.js";

/** Pool tuning a JSON config may carry. A live `Pool` or `ssl` options stay code-only. */
export interface PostgresStorePoolConfig {
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
}

/** Validated `packageConfig` for this package. `url` is a ref, never a connection string. */
export interface PostgresStoreConfig {
  readonly url?: string;
  readonly schema?: string;
  readonly pool?: PostgresStorePoolConfig;
}

/** Code-only factory options, for hosts that own a pool or want the store without a config ref. */
export interface PostgresStoreOptions {
  readonly pool?: Pool;
  readonly poolConfig?: Omit<PoolConfig, "connectionString" | "max">;
  readonly skipMigrations?: boolean;
  readonly feedbackRedactor?: SecretRedactor;
  readonly eventSource?: AgentEventSourceOptions;
  readonly eventCursorSecret?: string | Uint8Array;
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    // Ref only: the kernel refuses a literal in an `x-prism-secret` field before load.
    url: { type: "string", "x-prism-secret": true },
    schema: { type: "string", minLength: 1, maxLength: 63 },
    pool: {
      type: "object",
      properties: {
        max: { type: "number", minimum: 1 },
        connectionTimeoutMillis: { type: "number", minimum: 0 },
        idleTimeoutMillis: { type: "number", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  // `url` is checked in setup rather than declared required: a config schema whose required fields
  // cannot validate would fail package conformance, and the setup error names the field (plan 152).
  additionalProperties: false,
};

function definitionFor(options: PostgresStoreOptions) {
  return definePackage<PostgresStoreConfig>({
    name: "@arnilo/prism-store-postgres",
    version: manifest.version,
    description: "PostgreSQL session store with leases, lifecycle, event source, and schema migrations.",
    requires: { api: 1 },
    capabilities: ["slot:store", "credentials"],
    config: configSchema,
    setup: async (prism) => {
      const config = prism.config;
      let connectionString: string | undefined;
      if (!options.pool) {
        const ref = config.url;
        if (typeof ref !== "string" || ref.length === 0) {
          throw new Error("prism-store-postgres: config needs url (an env: or keyring: ref for the PostgreSQL connection string)");
        }
        const secret = await prism.credentials.resolve(ref);
        if (!secret) {
          throw new Error(`prism-store-postgres: could not resolve the url ref ${ref} through the credentials slot`);
        }
        connectionString = secret.value;
      }
      const persistence = await createPostgresPersistence({
        ...options,
        ...(connectionString === undefined ? {} : { connectionString }),
        schema: config.schema,
        poolMax: config.pool?.max,
        poolConfig: {
          ...options.poolConfig,
          ...(config.pool?.connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis: config.pool.connectionTimeoutMillis }),
          ...(config.pool?.idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis: config.pool.idleTimeoutMillis }),
        },
      });
      prism.slots.store.provide(persistence);
      // The workflows service names are the cross-package contract (plan 168 Task 4); both stores share
      // the one pool above, so providing them opens no second connection.
      prism.services.provide("checkpoints", persistence.checkpoints);
      prism.services.provide("leases", persistence.leases);
    },
  });
}

const definition = definitionFor({});

/** The package definition. Pass config through `packageConfig` or use {@link postgresStore}. */
export default definition;

/**
 * The package with `url` (and pool tuning) baked in, for `packages: [postgresStore({ url })]`. Code
 * options carry what a JSON config cannot: a caller-owned `Pool`, a redactor, or an event source
 * policy. A pool supplied here replaces the `url` ref.
 */
export function postgresStore(config: PostgresStoreConfig = {}, options: PostgresStoreOptions = {}): PackageInstance {
  return definitionFor(options)(config);
}
