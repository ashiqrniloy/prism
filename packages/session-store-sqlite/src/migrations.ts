import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  assertAdapterSchemaMatchesModel,
  assertMigrationUpAndReopen,
  createPersistenceMigrationContract,
  createPersistenceSchemaModel,
} from "@arnilo/prism/testing/persistence-schema";
import { ADAPTER_INDEX_NAMES, ADAPTER_TABLE_NAMES, MIGRATION_001_INIT } from "./ddl.js";
import type { SqlitePersistenceOptions } from "./types.js";
import { DEFAULT_BUSY_TIMEOUT_MS } from "./types.js";

const MIGRATION_CONTRACT = createPersistenceMigrationContract();

interface AppliedMigrationRow {
  readonly name: string;
  readonly version: string;
}

export function configureSqliteDatabase(db: Database.Database, options: Pick<SqlitePersistenceOptions, "wal" | "busyTimeoutMs">): void {
  db.pragma("foreign_keys = ON");
  if (options.wal !== false) {
    db.pragma("journal_mode = WAL");
  }
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
}

export function applySqliteMigrations(db: Database.Database): readonly AppliedMigrationRow[] {
  const appliedBefore = listAppliedMigrations(db);
  const pending = MIGRATION_CONTRACT.steps.filter((step) => !appliedBefore.some((row) => row.name === step.name));
  if (pending.length === 0) return appliedBefore;

  const migrate = db.transaction(() => {
    for (const step of pending) {
      if (step.name === "001_init") {
        db.exec(MIGRATION_001_INIT);
      } else {
        throw new Error(`Unknown migration step: ${step.name}`);
      }
      db.prepare(
        `INSERT INTO prism_migrations (id, name, version, applied_at, applied_by, checksum)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), step.name, String(step.version), new Date().toISOString(), "prism-session-store-sqlite", null);
    }
  });
  migrate();

  return listAppliedMigrations(db);
}

export function assertSqliteSchemaReady(db: Database.Database): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name)
    .filter((name) => ADAPTER_TABLE_NAMES.includes(name as (typeof ADAPTER_TABLE_NAMES)[number]));
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name)
    .filter((name) => ADAPTER_INDEX_NAMES.includes(name as (typeof ADAPTER_INDEX_NAMES)[number]));
  assertAdapterSchemaMatchesModel(tables, indexes, createPersistenceSchemaModel());
}

export function verifyMigrationIdempotency(db: Database.Database): void {
  const first = listAppliedMigrations(db);
  const second = listAppliedMigrations(db);
  assertMigrationUpAndReopen(MIGRATION_CONTRACT, first, second);
}

function listAppliedMigrations(db: Database.Database): AppliedMigrationRow[] {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prism_migrations'")
    .get();
  if (!hasTable) return [];
  return db
    .prepare("SELECT name, version FROM prism_migrations ORDER BY applied_at ASC")
    .all() as AppliedMigrationRow[];
}

export function maybeRestrictFileMode(filename: string, fileMode: number | undefined): void {
  if (filename === ":memory:") return;
  if (!existsSync(filename)) return;
  if (process.platform === "win32") return;
  chmodSync(filename, fileMode ?? 0o600);
}
