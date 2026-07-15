import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  assertAdapterSchemaMatchesModel,
  assertMigrationUpAndReopen,
  createPersistenceMigrationContract,
  createPersistenceSchemaModel,
} from "@arnilo/prism/testing/persistence-schema";
import { ADAPTER_INDEX_NAMES, ADAPTER_TABLE_NAMES, buildMigration001Ddl } from "./ddl.js";
import { MIGRATION_LOCK_NAMESPACE, qualifyTable, schemaAdvisoryLockKey } from "./identifiers.js";

const MIGRATION_CONTRACT = createPersistenceMigrationContract();

interface AppliedMigrationRow {
  readonly name: string;
  readonly version: string;
}

export async function applyPostgresMigrations(pool: Pool, schema: string): Promise<readonly AppliedMigrationRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      schemaAdvisoryLockKey(schema),
    ]);

    const appliedBefore = await listAppliedMigrations(client, schema);
    const pending = MIGRATION_CONTRACT.steps.filter((step) => !appliedBefore.some((row) => row.name === step.name));
    if (pending.length === 0) {
      await client.query("COMMIT");
      return appliedBefore;
    }

    for (const step of pending) {
      if (step.name === "001_init") {
        await client.query(buildMigration001Ddl(schema));
      } else {
        throw new Error(`Unknown migration step: ${step.name}`);
      }
      await client.query(
        `INSERT INTO ${qualifyTable(schema, "prism_migrations")} (id, name, version, applied_at, applied_by, checksum)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), step.name, String(step.version), new Date().toISOString(), "prism-session-store-postgres", null],
      );
    }

    await client.query("COMMIT");
    return listAppliedMigrations(pool, schema);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assertPostgresSchemaReady(pool: Pool, schema: string): Promise<void> {
  const tables = (
    await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
      [schema],
    )
  ).rows
    .map((row) => String(row.tablename))
    .filter((name) => ADAPTER_TABLE_NAMES.includes(name as (typeof ADAPTER_TABLE_NAMES)[number]));
  const indexes = (
    await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
      [schema],
    )
  ).rows
    .map((row) => String(row.indexname))
    .filter((name) => ADAPTER_INDEX_NAMES.includes(name as (typeof ADAPTER_INDEX_NAMES)[number]));
  assertAdapterSchemaMatchesModel(tables, indexes, createPersistenceSchemaModel());
}

export async function verifyMigrationIdempotency(pool: Pool, schema: string): Promise<void> {
  const first = await listAppliedMigrations(pool, schema);
  const second = await listAppliedMigrations(pool, schema);
  assertMigrationUpAndReopen(MIGRATION_CONTRACT, first, second);
}

async function listAppliedMigrations(
  source: Pool | PoolClient,
  schema: string,
): Promise<AppliedMigrationRow[]> {
  const hasTable = await source.query(
    `SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2 LIMIT 1`,
    [schema, "prism_migrations"],
  );
  if (hasTable.rowCount === 0) return [];
  const result = await source.query(
    `SELECT name, version FROM ${qualifyTable(schema, "prism_migrations")} ORDER BY applied_at ASC`,
  );
  return result.rows as AppliedMigrationRow[];
}
