import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  assertAppliedPersistenceMigrations,
  assertMigrationUpAndReopen,
  assertPersistenceSchemaShape,
  createPersistenceMigrationContract,
  createPersistenceSchemaModel,
  type AppliedPersistenceMigration,
  type PersistenceSchemaShape,
} from "@arnilo/prism/testing/persistence-schema";
import { ADAPTER_INDEX_NAMES, buildMigration001Ddl, buildMigration002Ddl, buildMigration003Ddl, buildMigration004Ddl } from "./ddl.js";
import { MIGRATION_LOCK_NAMESPACE, qualifyTable, schemaAdvisoryLockKey } from "./identifiers.js";

const MIGRATION_CONTRACT = createPersistenceMigrationContract();
type Queryable = Pick<Pool, "query"> | PoolClient;

export async function applyPostgresMigrations(pool: Pool, schema: string): Promise<readonly AppliedPersistenceMigration[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [MIGRATION_LOCK_NAMESPACE, schemaAdvisoryLockKey(schema)]);
    let applied = await listAppliedMigrations(client, schema);
    const history = assertAppliedPersistenceMigrations(MIGRATION_CONTRACT, applied);
    if (history.legacyChecksums) {
      await assertPostgresSchemaReady(client, schema);
      await backfillLegacyChecksums(client, schema);
      applied = await listAppliedMigrations(client, schema);
    }
    for (const step of MIGRATION_CONTRACT.steps.slice(applied.length)) {
      if (step.name === "001_init") await client.query(buildMigration001Ddl(schema));
      else if (step.name === "002_usage_scope") await client.query(buildMigration002Ddl(schema));
      else if (step.name === "003_run_feedback") await client.query(buildMigration003Ddl(schema));
      else if (step.name === "004_session_search") await client.query(buildMigration004Ddl(schema));
      else throw new Error(`Unknown migration step: ${step.name}`);
      await client.query(
        `INSERT INTO ${qualifyTable(schema, "prism_migrations")} (id, name, version, applied_at, applied_by, checksum)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), step.name, String(step.version), new Date(Date.now() + step.version).toISOString(), "prism-session-store-postgres", step.checksum],
      );
    }
    await assertPostgresSchemaReady(client, schema);
    applied = await listAppliedMigrations(client, schema);
    assertAppliedPersistenceMigrations(MIGRATION_CONTRACT, applied);
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assertPostgresSchemaReady(source: Queryable, schema: string): Promise<void> {
  assertPersistenceSchemaShape(await readPostgresSchemaShape(source, schema), "postgres", createPersistenceSchemaModel());
}

export async function verifyMigrationIdempotency(pool: Pool, schema: string): Promise<void> {
  const first = await listAppliedMigrations(pool, schema);
  const second = await listAppliedMigrations(pool, schema);
  assertMigrationUpAndReopen(MIGRATION_CONTRACT, first, second);
}

async function listAppliedMigrations(source: Queryable, schema: string): Promise<AppliedPersistenceMigration[]> {
  const hasTable = await source.query("SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2 LIMIT 1", [schema, "prism_migrations"]);
  if (hasTable.rowCount === 0) return [];
  const result = await source.query(`SELECT name, version, checksum FROM ${qualifyTable(schema, "prism_migrations")} ORDER BY applied_at ASC, id ASC`);
  return result.rows.map((row) => ({ name: String(row.name), version: String(row.version), checksum: row.checksum === null ? null : String(row.checksum) }));
}

async function backfillLegacyChecksums(source: Queryable, schema: string): Promise<void> {
  for (const step of MIGRATION_CONTRACT.steps) {
    await source.query(
      `UPDATE ${qualifyTable(schema, "prism_migrations")} SET checksum = $1 WHERE name = $2 AND version = $3 AND checksum IS NULL`,
      [step.checksum, step.name, String(step.version)],
    );
  }
}

async function readPostgresSchemaShape(source: Queryable, schema: string): Promise<PersistenceSchemaShape> {
  const tableNames = createPersistenceSchemaModel().tables.map((table) => table.name);
  const [columnsResult, constraintsResult, indexesResult] = await Promise.all([
    source.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = ANY($2::text[])
       ORDER BY table_name, ordinal_position`,
      [schema, tableNames],
    ),
    source.query(
      `SELECT table_class.relname AS table_name, constraint_row.contype,
              array_agg(column_row.attname ORDER BY key_row.ordinality) FILTER (WHERE column_row.attname IS NOT NULL) AS columns,
              reference_class.relname AS references_table,
              array_agg(reference_column.attname ORDER BY key_row.ordinality) FILTER (WHERE reference_column.attname IS NOT NULL) AS references_columns
       FROM pg_constraint constraint_row
       JOIN pg_class table_class ON table_class.oid = constraint_row.conrelid
       JOIN pg_namespace namespace_row ON namespace_row.oid = table_class.relnamespace
       LEFT JOIN pg_class reference_class ON reference_class.oid = constraint_row.confrelid
       LEFT JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_row(attribute_number, ordinality) ON true
       LEFT JOIN pg_attribute column_row ON column_row.attrelid = table_class.oid AND column_row.attnum = key_row.attribute_number
       LEFT JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS reference_key(attribute_number, ordinality) ON reference_key.ordinality = key_row.ordinality
       LEFT JOIN pg_attribute reference_column ON reference_column.attrelid = reference_class.oid AND reference_column.attnum = reference_key.attribute_number
       WHERE namespace_row.nspname = $1 AND table_class.relname = ANY($2::text[]) AND constraint_row.contype IN ('p', 'u', 'f')
       GROUP BY table_class.relname, constraint_row.contype, reference_class.relname, constraint_row.oid
       ORDER BY table_class.relname, constraint_row.oid`,
      [schema, tableNames],
    ),
    source.query(
      `SELECT index_class.relname AS name, table_class.relname AS table_name, index_row.indisunique AS unique,
              array_agg(column_row.attname ORDER BY key_row.ordinality) AS columns
       FROM pg_index index_row
       JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
       JOIN pg_class table_class ON table_class.oid = index_row.indrelid
       JOIN pg_namespace namespace_row ON namespace_row.oid = table_class.relnamespace
       JOIN LATERAL unnest(index_row.indkey) WITH ORDINALITY AS key_row(attribute_number, ordinality) ON true
       JOIN pg_attribute column_row ON column_row.attrelid = table_class.oid AND column_row.attnum = key_row.attribute_number
       WHERE namespace_row.nspname = $1 AND index_class.relname = ANY($2::text[])
       GROUP BY index_class.relname, table_class.relname, index_row.indisunique
       ORDER BY index_class.relname`,
      [schema, ADAPTER_INDEX_NAMES],
    ),
  ]);
  const tableMap = new Map<string, { name: string; columns: { name: string; type: string; nullable: boolean; defaultValue?: string }[]; primaryKey: string[]; uniqueKeys: string[][]; foreignKeys: { columns: string[]; referencesTable: string; referencesColumns: string[] }[] }>();
  for (const table of tableNames) tableMap.set(table, { name: table, columns: [], primaryKey: [], uniqueKeys: [], foreignKeys: [] });
  for (const row of columnsResult.rows) {
    const table = tableMap.get(String(row.table_name));
    if (table) table.columns.push({ name: String(row.column_name), type: String(row.data_type), nullable: row.is_nullable === "YES", defaultValue: row.column_default === null ? undefined : String(row.column_default) });
  }
  for (const row of constraintsResult.rows) {
    const table = tableMap.get(String(row.table_name));
    if (!table) continue;
    const columns = stringArray(row.columns);
    if (row.contype === "p") table.primaryKey = columns;
    else if (row.contype === "u") table.uniqueKeys.push(columns);
    else if (row.contype === "f") table.foreignKeys.push({ columns, referencesTable: String(row.references_table), referencesColumns: stringArray(row.references_columns) });
  }
  return {
    tables: [...tableMap.values()],
    indexes: indexesResult.rows.map((row) => ({ name: String(row.name), table: String(row.table_name), columns: stringArray(row.columns), unique: row.unique === true })),
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    const values = value.slice(1, -1);
    return values === "" ? [] : values.split(",");
  }
  throw new Error("PostgreSQL catalog returned an invalid identifier array");
}
