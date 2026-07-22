import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  assertAppliedPersistenceMigrations,
  assertMigrationUpAndReopen,
  assertPersistenceSchemaShape,
  createPersistenceMigrationContract,
  createPersistenceSchemaModel,
  type AppliedPersistenceMigration,
  type PersistenceSchemaShape,
  type PersistenceSchemaShapeForeignKey,
} from "@arnilo/prism/testing/persistence-schema";
import { ADAPTER_INDEX_NAMES, MIGRATION_001_INIT, MIGRATION_002_USAGE_SCOPE, MIGRATION_003_RUN_FEEDBACK, MIGRATION_004_SESSION_SEARCH } from "./ddl.js";
import type { SqlitePersistenceOptions } from "./types.js";
import { DEFAULT_BUSY_TIMEOUT_MS } from "./types.js";

const MIGRATION_CONTRACT = createPersistenceMigrationContract();

export function configureSqliteDatabase(db: Database.Database, options: Pick<SqlitePersistenceOptions, "wal" | "busyTimeoutMs">): void {
  db.pragma("foreign_keys = ON");
  if (options.wal !== false) db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
}

export function applySqliteMigrations(db: Database.Database): readonly AppliedPersistenceMigration[] {
  return db.transaction(() => {
    let applied = listAppliedMigrations(db);
    const history = assertAppliedPersistenceMigrations(MIGRATION_CONTRACT, applied);
    if (history.legacyChecksums) {
      assertSqliteSchemaReady(db);
      backfillLegacyChecksums(db);
      applied = listAppliedMigrations(db);
    }
    for (const step of MIGRATION_CONTRACT.steps.slice(applied.length)) {
      if (step.name === "001_init") db.exec(MIGRATION_001_INIT);
      else if (step.name === "002_usage_scope") db.exec(MIGRATION_002_USAGE_SCOPE);
      else if (step.name === "003_run_feedback") db.exec(MIGRATION_003_RUN_FEEDBACK);
      else if (step.name === "004_session_search") db.exec(MIGRATION_004_SESSION_SEARCH);
      else throw new Error(`Unknown migration step: ${step.name}`);
      db.prepare(
        `INSERT INTO prism_migrations (id, name, version, applied_at, applied_by, checksum)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), step.name, String(step.version), new Date(Date.now() + step.version).toISOString(), "prism-session-store-sqlite", step.checksum);
    }
    assertSqliteSchemaReady(db);
    applied = listAppliedMigrations(db);
    assertAppliedPersistenceMigrations(MIGRATION_CONTRACT, applied);
    return applied;
  })();
}

export function assertSqliteSchemaReady(db: Database.Database): void {
  assertPersistenceSchemaShape(readSqliteSchemaShape(db), "sqlite", createPersistenceSchemaModel());
}

export function verifyMigrationIdempotency(db: Database.Database): void {
  const first = listAppliedMigrations(db);
  const second = listAppliedMigrations(db);
  assertMigrationUpAndReopen(MIGRATION_CONTRACT, first, second);
}

function listAppliedMigrations(db: Database.Database): AppliedPersistenceMigration[] {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prism_migrations'").get();
  if (!hasTable) return [];
  return db.prepare("SELECT name, version, checksum FROM prism_migrations ORDER BY applied_at ASC, rowid ASC").all() as AppliedPersistenceMigration[];
}

function backfillLegacyChecksums(db: Database.Database): void {
  const update = db.prepare("UPDATE prism_migrations SET checksum = ? WHERE name = ? AND version = ? AND checksum IS NULL");
  for (const step of MIGRATION_CONTRACT.steps) update.run(step.checksum, step.name, String(step.version));
}

function readSqliteSchemaShape(db: Database.Database): PersistenceSchemaShape {
  const model = createPersistenceSchemaModel();
  const tables = model.tables.map((table) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(table.name)})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];
    const indexRows = db.prepare(`PRAGMA index_list(${quote(table.name)})`).all() as { name: string; unique: number; origin: string }[];
    const primaryKey = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    const uniqueKeys = indexRows
      .filter((index) => index.unique === 1 && index.origin !== "p")
      .map((index) => indexColumns(db, index.name));
    const foreignKeys = new Map<number, PersistenceSchemaShapeForeignKey>();
    for (const row of db.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all() as { id: number; seq: number; table: string; from: string; to: string }[]) {
      const current = foreignKeys.get(row.id) ?? { columns: [], referencesTable: row.table, referencesColumns: [] };
      (current.columns as string[])[row.seq] = row.from;
      (current.referencesColumns as string[])[row.seq] = row.to;
      foreignKeys.set(row.id, current);
    }
    return {
      name: table.name,
      columns: columns.map((column) => ({ name: column.name, type: column.type, nullable: column.notnull === 0, defaultValue: column.dflt_value ?? undefined })),
      primaryKey,
      uniqueKeys,
      foreignKeys: [...foreignKeys.values()],
    };
  });
  const indexes = (
    db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as { name: string; tbl_name: string }[]
  )
    .filter((index) => ADAPTER_INDEX_NAMES.includes(index.name as (typeof ADAPTER_INDEX_NAMES)[number]))
    .map((index) => ({
      name: index.name,
      table: index.tbl_name,
      columns: indexColumns(db, index.name),
      unique: ((db.prepare(`PRAGMA index_list(${quote(index.tbl_name)})`).all() as { name: string; unique: number }[]).find((row) => row.name === index.name)?.unique ?? 0) === 1,
    }));
  return { tables, indexes };
}

function indexColumns(db: Database.Database, index: string): string[] {
  return (db.prepare(`PRAGMA index_info(${quote(index)})`).all() as { seqno: number; name: string }[])
    .sort((a, b) => a.seqno - b.seqno)
    .map((column) => column.name);
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function maybeRestrictFileMode(filename: string, fileMode: number | undefined): void {
  if (filename === ":memory:" || !existsSync(filename) || process.platform === "win32") return;
  chmodSync(filename, fileMode ?? 0o600);
}
