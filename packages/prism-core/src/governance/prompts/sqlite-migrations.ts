import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { PromptMigrationError } from "./errors.js";
import { PROMPT_INDEX_NAMES, PROMPT_MIGRATION_001_INIT } from "./sqlite-ddl.js";

export interface AppliedPromptMigration {
  readonly name: string;
  readonly version: number;
  readonly checksum: string;
}

export const PROMPT_MIGRATION_CONTRACT = Object.freeze([
  Object.freeze({
    name: "001_init",
    version: 1,
    checksum: createHash("sha256").update(PROMPT_MIGRATION_001_INIT, "utf8").digest("hex"),
  }),
]);

export function applySqlitePromptMigrations(db: Database.Database): readonly AppliedPromptMigration[] {
  return db.transaction(() => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS prism_prompt_migrations (
        id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        applied_by TEXT NOT NULL,
        checksum TEXT NOT NULL,
        UNIQUE (name, version)
      )`,
    );
    let applied = listSqlitePromptMigrations(db);
    assertMigrationHistory(applied);
    for (const step of PROMPT_MIGRATION_CONTRACT.slice(applied.length)) {
      if (step.name !== "001_init") throw new PromptMigrationError(`unknown prompt migration: ${step.name}`);
      db.exec(PROMPT_MIGRATION_001_INIT);
      db.prepare(
        `INSERT INTO prism_prompt_migrations (id, name, version, applied_at, applied_by, checksum)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), step.name, step.version, new Date().toISOString(), "prism-prompts-sqlite", step.checksum);
    }
    assertSqlitePromptSchemaReady(db);
    applied = listSqlitePromptMigrations(db);
    assertMigrationHistory(applied);
    return applied;
  })();
}

export function listSqlitePromptMigrations(db: Database.Database): AppliedPromptMigration[] {
  return db.prepare("SELECT name, version, checksum FROM prism_prompt_migrations ORDER BY version ASC").all() as AppliedPromptMigration[];
}

export function assertSqlitePromptSchemaReady(db: Database.Database): void {
  for (const table of ["prism_prompts", "prism_prompt_labels"]) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) throw new PromptMigrationError(`missing prompt table: ${table}`);
  }
  for (const index of PROMPT_INDEX_NAMES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index);
    if (!exists) throw new PromptMigrationError(`missing prompt index: ${index}`);
  }
  const columns = db.prepare("PRAGMA table_info(prism_prompts)").all() as { name: string }[];
  for (const column of ["tenant_id", "account_id", "user_id", "name", "version", "body", "hash", "labels", "metadata", "created_at"]) {
    if (!columns.some((entry) => entry.name === column)) throw new PromptMigrationError(`missing prompt column: ${column}`);
  }
}

function assertMigrationHistory(applied: readonly AppliedPromptMigration[]): void {
  if (applied.length > PROMPT_MIGRATION_CONTRACT.length) throw new PromptMigrationError("unknown prompt migration history");
  for (const [index, row] of applied.entries()) {
    const expected = PROMPT_MIGRATION_CONTRACT[index];
    if (!expected || row.name !== expected.name || row.version !== expected.version) {
      throw new PromptMigrationError("prompt migration history is out of order");
    }
    if (row.checksum !== expected.checksum) throw new PromptMigrationError(`prompt migration checksum mismatch: ${row.name}`);
  }
}
