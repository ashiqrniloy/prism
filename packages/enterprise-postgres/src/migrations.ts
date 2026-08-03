import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ENTERPRISE_INDEX_NAMES, ENTERPRISE_TABLE_NAMES, buildEnterpriseMigration001Ddl } from "./ddl.js";
import { EnterprisePostgresError, asEnterprisePostgresError } from "./errors.js";
import { ENTERPRISE_MIGRATION_LOCK_NAMESPACE, qualifyTable, schemaAdvisoryLockKey } from "./identifiers.js";

interface EnterpriseMigration {
  readonly name: "001_enterprise_state";
  readonly version: "1";
  readonly checksum: string;
}

interface AppliedEnterpriseMigration {
  readonly name: string;
  readonly version: string;
  readonly checksum: string;
}

interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
}

interface ExpectedTable {
  readonly name: (typeof ENTERPRISE_TABLE_NAMES)[number];
  readonly columns: readonly ExpectedColumn[];
  readonly primaryKey: readonly string[];
  readonly uniqueKeys?: readonly (readonly string[])[];
}

interface ExpectedIndex {
  readonly name: (typeof ENTERPRISE_INDEX_NAMES)[number];
  readonly table: (typeof ENTERPRISE_TABLE_NAMES)[number];
  readonly columns: readonly string[];
  readonly partial?: boolean;
}

type Queryable = Pick<Pool, "query"> | PoolClient;

const MIGRATION: EnterpriseMigration = {
  name: "001_enterprise_state",
  version: "1",
  checksum: createHash("sha256").update(buildEnterpriseMigration001Ddl("prism"), "utf8").digest("hex"),
};

const OWNER_COLUMNS = [
  { name: "tenant_id", type: "text", nullable: false },
  { name: "account_key", type: "text", nullable: false },
  { name: "user_key", type: "text", nullable: false },
] as const;
const ROUTER_OWNER_COLUMNS = [...OWNER_COLUMNS, { name: "principal_id", type: "text", nullable: false }] as const;

const EXPECTED_TABLES: readonly ExpectedTable[] = [
  {
    name: "prism_enterprise_migrations",
    columns: [
      { name: "id", type: "text", nullable: false },
      { name: "name", type: "text", nullable: false },
      { name: "version", type: "text", nullable: false },
      { name: "checksum", type: "text", nullable: false },
      { name: "applied_at", type: "timestamp with time zone", nullable: false },
    ],
    primaryKey: ["id"],
    uniqueKeys: [["name", "version"]],
  },
  {
    name: "prism_policy_decisions",
    columns: [
      { name: "id", type: "text", nullable: false },
      ...OWNER_COLUMNS,
      { name: "policy_id", type: "text", nullable: false },
      { name: "policy_version", type: "text", nullable: false },
      { name: "outcome", type: "text", nullable: false },
      { name: "actor", type: "jsonb", nullable: false },
      { name: "target", type: "jsonb", nullable: false },
      { name: "reason", type: "text", nullable: true },
      { name: "evidence_refs", type: "jsonb", nullable: false },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "expires_at", type: "timestamp with time zone", nullable: true },
    ],
    primaryKey: ["id"],
  },
  {
    name: "prism_evaluations",
    columns: [
      { name: "id", type: "text", nullable: false },
      ...OWNER_COLUMNS,
      { name: "scorer_id", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "score", type: "double precision", nullable: true },
      { name: "reason", type: "text", nullable: true },
      { name: "sampled", type: "boolean", nullable: false },
      { name: "session_id", type: "text", nullable: true },
      { name: "run_id", type: "text", nullable: true },
      { name: "trace_id", type: "text", nullable: true },
      { name: "dataset_id", type: "text", nullable: true },
      { name: "item_id", type: "text", nullable: true },
      { name: "experiment_id", type: "text", nullable: true },
      { name: "error", type: "jsonb", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "metadata", type: "jsonb", nullable: true },
    ],
    primaryKey: ["id"],
  },
  {
    name: "prism_work_idempotency",
    columns: [
      ...ROUTER_OWNER_COLUMNS,
      { name: "idempotency_key", type: "text", nullable: false },
      { name: "op", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "attempt", type: "integer", nullable: false },
      { name: "version", type: "integer", nullable: false },
      { name: "claim_token", type: "text", nullable: true },
      { name: "result", type: "jsonb", nullable: true },
      { name: "failure", type: "jsonb", nullable: true },
      { name: "created_at", type: "timestamp with time zone", nullable: false },
      { name: "updated_at", type: "timestamp with time zone", nullable: false },
      { name: "expires_at", type: "timestamp with time zone", nullable: true },
    ],
    primaryKey: ["tenant_id", "account_key", "user_key", "principal_id", "idempotency_key"],
  },
  {
    name: "prism_model_router_budgets",
    columns: [
      ...ROUTER_OWNER_COLUMNS,
      { name: "provider", type: "text", nullable: false },
      { name: "model", type: "text", nullable: false },
      { name: "window_ms", type: "bigint", nullable: false },
      { name: "window_started_at", type: "timestamp with time zone", nullable: false },
      { name: "tokens", type: "double precision", nullable: false },
      { name: "cost_usd", type: "double precision", nullable: false },
      { name: "last_used_at", type: "timestamp with time zone", nullable: false },
      { name: "expires_at", type: "timestamp with time zone", nullable: false },
    ],
    primaryKey: ["tenant_id", "account_key", "user_key", "principal_id", "provider", "model", "window_ms"],
  },
  {
    name: "prism_model_router_rates",
    columns: [
      ...ROUTER_OWNER_COLUMNS,
      { name: "provider", type: "text", nullable: false },
      { name: "model", type: "text", nullable: false },
      { name: "window_ms", type: "bigint", nullable: false },
      { name: "window_started_at", type: "timestamp with time zone", nullable: false },
      { name: "request_count", type: "integer", nullable: false },
      { name: "last_used_at", type: "timestamp with time zone", nullable: false },
      { name: "expires_at", type: "timestamp with time zone", nullable: false },
    ],
    primaryKey: ["tenant_id", "account_key", "user_key", "principal_id", "provider", "model", "window_ms"],
  },
  {
    name: "prism_model_router_circuits",
    columns: [
      ...ROUTER_OWNER_COLUMNS,
      { name: "provider", type: "text", nullable: false },
      { name: "model", type: "text", nullable: false },
      { name: "failures", type: "integer", nullable: false },
      { name: "cool_down_ms", type: "bigint", nullable: false },
      { name: "open_until", type: "timestamp with time zone", nullable: false },
      { name: "probe_token", type: "text", nullable: true },
      { name: "probe_expires_at", type: "timestamp with time zone", nullable: true },
      { name: "last_used_at", type: "timestamp with time zone", nullable: false },
      { name: "expires_at", type: "timestamp with time zone", nullable: true },
    ],
    primaryKey: ["tenant_id", "account_key", "user_key", "principal_id", "provider", "model"],
  },
];

const EXPECTED_INDEXES: readonly ExpectedIndex[] = [
  {
    name: "prism_policy_decisions_owner_created_idx",
    table: "prism_policy_decisions",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "created_at", "id"],
  },
  {
    name: "prism_policy_decisions_owner_policy_created_idx",
    table: "prism_policy_decisions",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "policy_id", "policy_version", "created_at", "id"],
  },
  {
    name: "prism_policy_decisions_owner_outcome_created_idx",
    table: "prism_policy_decisions",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "outcome", "created_at", "id"],
  },
  {
    name: "prism_evaluations_owner_created_idx",
    table: "prism_evaluations",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "created_at", "id"],
  },
  {
    name: "prism_evaluations_owner_scorer_created_idx",
    table: "prism_evaluations",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "scorer_id", "created_at", "id"],
  },
  {
    name: "prism_evaluations_owner_session_created_idx",
    table: "prism_evaluations",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "session_id", "created_at", "id"],
  },
  {
    name: "prism_evaluations_owner_run_created_idx",
    table: "prism_evaluations",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "run_id", "created_at", "id"],
  },
  {
    name: "prism_evaluations_owner_experiment_created_idx",
    table: "prism_evaluations",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "experiment_id", "created_at", "id"],
  },
  {
    name: "prism_evaluations_owner_dataset_item_created_idx",
    table: "prism_evaluations",
    columns: [...OWNER_COLUMNS.map((column) => column.name), "dataset_id", "item_id", "created_at", "id"],
  },
  {
    name: "prism_work_idempotency_expiry_idx",
    table: "prism_work_idempotency",
    columns: [...ROUTER_OWNER_COLUMNS.map((column) => column.name), "status", "expires_at", "idempotency_key"],
    partial: true,
  },
  {
    name: "prism_model_router_budgets_expiry_idx",
    table: "prism_model_router_budgets",
    columns: [...ROUTER_OWNER_COLUMNS.map((column) => column.name), "expires_at"],
    partial: true,
  },
  {
    name: "prism_model_router_rates_expiry_idx",
    table: "prism_model_router_rates",
    columns: [...ROUTER_OWNER_COLUMNS.map((column) => column.name), "expires_at"],
    partial: true,
  },
  {
    name: "prism_model_router_circuits_expiry_idx",
    table: "prism_model_router_circuits",
    columns: [...ROUTER_OWNER_COLUMNS.map((column) => column.name), "expires_at"],
    partial: true,
  },
];

/** Apply/check enterprise migration under an advisory transaction lock. */
export async function applyEnterpriseMigrations(pool: Pool, schema: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [ENTERPRISE_MIGRATION_LOCK_NAMESPACE, schemaAdvisoryLockKey(schema)]);
    const applied = await listAppliedMigrations(client, schema);
    assertEnterpriseMigrationHistory(applied);
    if (applied.length === 0) {
      await client.query(buildEnterpriseMigration001Ddl(schema));
      await client.query(
        `INSERT INTO ${qualifyTable(schema, "prism_enterprise_migrations")} (id, name, version, checksum, applied_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())`,
        [randomUUID(), MIGRATION.name, MIGRATION.version, MIGRATION.checksum],
      );
    }
    await assertEnterpriseSchemaReady(client, schema);
    assertEnterpriseMigrationHistory(await listAppliedMigrations(client, schema));
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration error; client release still runs.
    }
    throw asEnterprisePostgresError(error, "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION", "Enterprise PostgreSQL migration failed");
  } finally {
    client.release();
  }
}

/** Verify ordered checksum-protected history. Exported for package-local migration tests only. */
export function assertEnterpriseMigrationHistory(applied: readonly AppliedEnterpriseMigration[]): void {
  if (applied.length !== 0 && applied.length !== 1) migrationError();
  if (applied.length === 0) return;
  const row = applied[0]!;
  if (row.name !== MIGRATION.name || row.version !== MIGRATION.version || row.checksum !== MIGRATION.checksum) migrationError();
}

/** Verify required table/column/key/index catalog shape before runtime writes. */
export async function assertEnterpriseSchemaReady(source: Queryable, schema: string): Promise<void> {
  try {
    // node-postgres requires serial statements on one checked-out transaction client.
    const columns = await source.query(
      `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = ANY($2::text[])
       ORDER BY table_name, ordinal_position`,
      [schema, ENTERPRISE_TABLE_NAMES],
    );
    const constraints = await source.query(
      `SELECT table_class.relname AS table_name, constraint_row.contype,
              array_agg(column_row.attname ORDER BY key_row.ordinality) AS columns
       FROM pg_constraint constraint_row
       JOIN pg_class table_class ON table_class.oid = constraint_row.conrelid
       JOIN pg_namespace namespace_row ON namespace_row.oid = table_class.relnamespace
       JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_row(attribute_number, ordinality) ON true
       JOIN pg_attribute column_row ON column_row.attrelid = table_class.oid AND column_row.attnum = key_row.attribute_number
       WHERE namespace_row.nspname = $1 AND table_class.relname = ANY($2::text[]) AND constraint_row.contype IN ('p', 'u')
       GROUP BY table_class.relname, constraint_row.contype, constraint_row.oid
       ORDER BY table_class.relname, constraint_row.oid`,
      [schema, ENTERPRISE_TABLE_NAMES],
    );
    const indexes = await source.query(
      `SELECT index_class.relname AS name, table_class.relname AS table_name, index_row.indisunique AS unique,
              index_row.indpred IS NOT NULL AS partial,
              array_agg(column_row.attname ORDER BY key_row.ordinality) AS columns
       FROM pg_index index_row
       JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
       JOIN pg_class table_class ON table_class.oid = index_row.indrelid
       JOIN pg_namespace namespace_row ON namespace_row.oid = table_class.relnamespace
       JOIN LATERAL unnest(index_row.indkey) WITH ORDINALITY AS key_row(attribute_number, ordinality) ON true
       JOIN pg_attribute column_row ON column_row.attrelid = table_class.oid AND column_row.attnum = key_row.attribute_number
       WHERE namespace_row.nspname = $1 AND index_class.relname = ANY($2::text[])
       GROUP BY index_class.relname, table_class.relname, index_row.indisunique, index_row.indpred
       ORDER BY index_class.relname`,
      [schema, ENTERPRISE_INDEX_NAMES],
    );
    for (const table of EXPECTED_TABLES) {
      const actualColumns = columns.rows
        .filter((row) => String(row.table_name) === table.name)
        .map((row) => ({ name: String(row.column_name), type: String(row.data_type), nullable: row.is_nullable === "YES" }));
      if (!sameColumns(actualColumns, table.columns)) schemaError();
      const tableConstraints = constraints.rows.filter((row) => String(row.table_name) === table.name);
      const primary = tableConstraints.find((row) => row.contype === "p");
      if (!primary || !sameArray(stringArray(primary.columns), table.primaryKey)) schemaError();
      const unique = tableConstraints.filter((row) => row.contype === "u").map((row) => stringArray(row.columns));
      if (!sameKeySets(unique, table.uniqueKeys ?? [])) schemaError();
    }
    for (const expected of EXPECTED_INDEXES) {
      const actual = indexes.rows.find((row) => String(row.name) === expected.name);
      if (!actual || String(actual.table_name) !== expected.table || !sameArray(stringArray(actual.columns), expected.columns))
        schemaError();
      if (Boolean(actual.partial) !== Boolean(expected.partial)) schemaError();
    }
  } catch (error) {
    throw asEnterprisePostgresError(error, "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA", "Enterprise PostgreSQL schema verification failed");
  }
}

function migrationError(): never {
  throw new EnterprisePostgresError("Enterprise PostgreSQL migration history is invalid", "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION");
}

function schemaError(): never {
  throw new EnterprisePostgresError("Enterprise PostgreSQL schema does not match required shape", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
}

async function listAppliedMigrations(source: Queryable, schema: string): Promise<AppliedEnterpriseMigration[]> {
  const table = await source.query("SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2 LIMIT 1", [
    schema,
    "prism_enterprise_migrations",
  ]);
  if (table.rowCount === 0) return [];
  const result = await source.query(
    `SELECT name, version, checksum FROM ${qualifyTable(schema, "prism_enterprise_migrations")} ORDER BY applied_at ASC, id ASC`,
  );
  return result.rows.map((row) => ({ name: String(row.name), version: String(row.version), checksum: String(row.checksum) }));
}

function sameColumns(actual: readonly ExpectedColumn[], expected: readonly ExpectedColumn[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((column, index) => {
      const match = expected[index];
      return match !== undefined && column.name === match.name && column.type === match.type && column.nullable === match.nullable;
    })
  );
}

function sameKeySets(actual: readonly (readonly string[])[], expected: readonly (readonly string[])[]): boolean {
  return actual.length === expected.length && expected.every((key) => actual.some((candidate) => sameArray(candidate, key)));
}

function sameArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    const values = value.slice(1, -1);
    return values === "" ? [] : values.split(",");
  }
  throw new EnterprisePostgresError("PostgreSQL catalog returned invalid shape", "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA");
}
