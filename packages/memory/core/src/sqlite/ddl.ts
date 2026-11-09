import { quoteIdentifier, validateIdentifier } from "../postgres/postgres-identifiers.js";

/**
 * Schema v3 (plan 188.4 Task 2): the lifecycle scan reads `status`/`storage`/`last_use_ordinal` as
 * columns instead of parsing every record's JSON, and `memory_scope_counter` holds the scope clock.
 */
export const SQLITE_MEMORY_SCHEMA_VERSION = 3;
export const SQLITE_MEMORY_APPLICATION_ID = 1347571021;

/** Applied verbatim to a v2 index; idempotent except for the ALTERs, which the version gate runs once. */
export function buildSqliteMemoryV3Migration(): string {
  return `
ALTER TABLE semantic_memory ADD COLUMN status TEXT;
ALTER TABLE semantic_memory ADD COLUMN storage REAL;
ALTER TABLE semantic_memory ADD COLUMN last_use_ordinal INTEGER;
-- Backfill from the records already indexed, so old notes are visible to the scan too.
UPDATE semantic_memory SET
  status = json_extract(record,'$.metadata.status'),
  storage = json_extract(record,'$.importance'),
  last_use_ordinal = CASE WHEN json_type(record,'$.metadata.fabric.uses')='array'
    THEN json_extract(record,'$.metadata.fabric.uses[#-1].s') END
WHERE json_valid(record);
CREATE TABLE ${quoteIdentifier("memory_scope_counter")} (
  tenant_id TEXT NOT NULL, resource_id TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, name)
);
PRAGMA user_version = ${SQLITE_MEMORY_SCHEMA_VERSION};
`;
}

export function buildSqliteMemoryDdl(tableInput = "semantic_memory"): string {
  const table = validateIdentifier(tableInput, "table");
  const t = quoteIdentifier(table);
  const f = quoteIdentifier(`${table}_fts`);
  return `
CREATE TABLE ${t} (
  tenant_id TEXT NOT NULL, resource_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  id TEXT NOT NULL, text TEXT NOT NULL, record TEXT NOT NULL,
  lex_text TEXT NOT NULL DEFAULT '', lex_keys TEXT NOT NULL DEFAULT '',
  status TEXT, storage REAL, last_use_ordinal INTEGER,
  PRIMARY KEY (tenant_id, resource_id, thread_id, id)
);
-- The index holds pre-analyzed terms (see lexical.ts), so BM25 and coverage use the same tokens.
CREATE VIRTUAL TABLE ${f} USING fts5(lex_text, lex_keys, content='${table}', content_rowid='rowid');
CREATE TRIGGER ${quoteIdentifier(`${table}_insert`)} AFTER INSERT ON ${t} BEGIN
  INSERT INTO ${f}(rowid, lex_text, lex_keys) VALUES (new.rowid, new.lex_text, new.lex_keys);
END;
CREATE TRIGGER ${quoteIdentifier(`${table}_delete`)} AFTER DELETE ON ${t} BEGIN
  INSERT INTO ${f}(${f}, rowid, lex_text, lex_keys) VALUES ('delete', old.rowid, old.lex_text, old.lex_keys);
END;
CREATE TRIGGER ${quoteIdentifier(`${table}_update`)} AFTER UPDATE ON ${t} BEGIN
  INSERT INTO ${f}(${f}, rowid, lex_text, lex_keys) VALUES ('delete', old.rowid, old.lex_text, old.lex_keys);
  INSERT INTO ${f}(rowid, lex_text, lex_keys) VALUES (new.rowid, new.lex_text, new.lex_keys);
END;
CREATE TABLE memory_state (
  tenant_id TEXT NOT NULL, resource_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, thread_id, kind, id)
);
CREATE TABLE memory_config (id INTEGER PRIMARY KEY CHECK (id = 1), dimensions INTEGER);
CREATE TABLE memory_scope_counter (
  tenant_id TEXT NOT NULL, resource_id TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, resource_id, name)
);
PRAGMA application_id = ${SQLITE_MEMORY_APPLICATION_ID};
PRAGMA user_version = ${SQLITE_MEMORY_SCHEMA_VERSION};
`;
}
