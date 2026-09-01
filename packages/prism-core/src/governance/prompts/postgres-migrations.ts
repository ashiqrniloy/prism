import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PromptMigrationError } from "./errors.js";
import { buildPromptMigration001Ddl, buildPromptMigrationMetaDdl, DEFAULT_PROMPT_SCHEMA } from "./postgres-ddl.js";
import { qualifyPromptTable } from "./postgres-identifiers.js";

export interface AppliedPromptMigration {
  readonly name: string;
  readonly version: number;
  readonly checksum: string;
}

export function promptMigrationContract(schema = DEFAULT_PROMPT_SCHEMA): readonly AppliedPromptMigration[] {
  return [
    {
      name: "001_init",
      version: 1,
      checksum: createHash("sha256").update(buildPromptMigration001Ddl(schema), "utf8").digest("hex"),
    },
  ];
}

export async function applyPostgresPromptMigrations(
  pool: Pool,
  schema = DEFAULT_PROMPT_SCHEMA,
): Promise<readonly AppliedPromptMigration[]> {
  const contract = promptMigrationContract(schema);
  const migrations = qualifyPromptTable(schema, "prism_prompt_migrations");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prism-prompts:${schema}`]);
    await client.query(buildPromptMigrationMetaDdl(schema));
    let applied = await listPostgresPromptMigrations(client, migrations);
    assertMigrationHistory(applied, contract);
    for (const step of contract.slice(applied.length)) {
      if (step.name !== "001_init") throw new PromptMigrationError(`unknown prompt migration: ${step.name}`);
      await client.query(buildPromptMigration001Ddl(schema));
      await client.query(
        `INSERT INTO ${migrations} (id, name, version, applied_at, applied_by, checksum)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), step.name, step.version, new Date().toISOString(), "prism-prompts-postgres", step.checksum],
      );
    }
    await assertPostgresPromptSchemaReady(client, schema);
    applied = await listPostgresPromptMigrations(client, migrations);
    assertMigrationHistory(applied, contract);
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPostgresPromptMigrations(client: Pick<PoolClient, "query">, table: string): Promise<AppliedPromptMigration[]> {
  const result = await client.query(`SELECT name, version, checksum FROM ${table} ORDER BY version ASC`);
  return result.rows as AppliedPromptMigration[];
}

export async function assertPostgresPromptSchemaReady(client: Pick<PoolClient, "query">, schema = DEFAULT_PROMPT_SCHEMA): Promise<void> {
  const tableNames = ["prism_prompts", "prism_prompt_labels"] as const;
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
    [schema, [...tableNames]],
  );
  const present = new Set(tables.rows.map((row) => String((row as { table_name: string }).table_name)));
  for (const table of tableNames) {
    if (!present.has(table)) throw new PromptMigrationError(`missing prompt table: ${table}`);
  }
  const required = {
    prism_prompts: ["tenant_id", "account_id", "user_id", "name", "version", "body", "hash", "labels", "metadata", "created_at"],
    prism_prompt_labels: ["tenant_id", "account_id", "user_id", "name", "version", "label"],
  } as const;
  const columns = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
    [schema, [...tableNames]],
  );
  const presentColumns = new Set(columns.rows.map((row) => `${String(row.table_name)}\u0000${String(row.column_name)}`));
  for (const [table, names] of Object.entries(required)) {
    for (const name of names) {
      if (!presentColumns.has(`${table}\u0000${name}`)) throw new PromptMigrationError(`missing prompt column: ${table}.${name}`);
    }
  }
  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = $1 AND indexname = ANY($2::text[])`,
    [schema, ["prism_prompts_list_idx", "prism_prompt_labels_resolve_idx"]],
  );
  const presentIndexes = new Set(indexes.rows.map((row) => String((row as { indexname: string }).indexname)));
  for (const name of ["prism_prompts_list_idx", "prism_prompt_labels_resolve_idx"]) {
    if (!presentIndexes.has(name)) throw new PromptMigrationError(`missing prompt index: ${name}`);
  }
}

function assertMigrationHistory(applied: readonly AppliedPromptMigration[], contract: readonly AppliedPromptMigration[]): void {
  if (applied.length > contract.length) throw new PromptMigrationError("unknown prompt migration history");
  for (const [index, row] of applied.entries()) {
    const expected = contract[index];
    if (!expected || row.name !== expected.name || Number(row.version) !== expected.version) {
      throw new PromptMigrationError("prompt migration history is out of order");
    }
    if (row.checksum !== expected.checksum) throw new PromptMigrationError(`prompt migration checksum mismatch: ${row.name}`);
  }
}
