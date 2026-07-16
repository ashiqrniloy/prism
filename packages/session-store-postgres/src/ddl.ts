import { qualifyTable, quoteIdentifier } from "./identifiers.js";

/** Build PostgreSQL DDL for Plan 056 schema version 1. Values are always bound at runtime. */
export function buildMigration001Ddl(schema: string): string {
  const schemaQuoted = quoteIdentifier(schema);
  const t = (table: string) => qualifyTable(schema, table);

  return `
CREATE SCHEMA IF NOT EXISTS ${schemaQuoted};

CREATE TABLE IF NOT EXISTS ${t("prism_tenants")} (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS ${t("prism_accounts")} (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (tenant_id) REFERENCES ${t("prism_tenants")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_users")} (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS ${t("prism_agent_definitions")} (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT,
  agent_definition TEXT NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  metadata TEXT,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS ${t("prism_sessions")} (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  parent_session_id TEXT,
  agent_definition_id TEXT,
  agent_definition_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  retention_policy_id TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS ${t("prism_branches")} (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT,
  root_entry_id TEXT,
  parent_branch_id TEXT,
  leaf_entry_id TEXT,
  created_at TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_session_entries")} (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  run_id TEXT,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  schema_version INTEGER,
  message TEXT,
  event TEXT,
  model TEXT,
  previous_model TEXT,
  label TEXT,
  summary TEXT,
  data TEXT,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id),
  FOREIGN KEY (parent_id) REFERENCES ${t("prism_session_entries")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_session_append_idempotency")} (
  session_id TEXT NOT NULL,
  expected_parent_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  PRIMARY KEY (session_id, expected_parent_id, idempotency_key),
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_runs")} (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  branch_id TEXT,
  agent_definition_id TEXT,
  agent_definition_version TEXT,
  status TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  model TEXT,
  provider TEXT,
  idempotency_key TEXT,
  abort_reason TEXT,
  error TEXT,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS prism_runs_tenant_idempotency_unique
  ON ${t("prism_runs")} (tenant_id, idempotency_key)
  WHERE tenant_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${t("prism_agent_events")} (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  entry_id TEXT,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  event TEXT NOT NULL,
  redacted BOOLEAN NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_tool_calls")} (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  entry_id TEXT,
  tool_call_id TEXT NOT NULL,
  name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT,
  status TEXT,
  reason TEXT,
  progress TEXT,
  progress_metadata TEXT,
  progress_at TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  redacted BOOLEAN NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_usage")} (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  entry_id TEXT,
  usage TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${t("prism_sessions")}(id)
);

CREATE TABLE IF NOT EXISTS ${t("prism_retention_policies")} (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  name TEXT,
  max_age_days INTEGER,
  max_entries_per_session INTEGER,
  max_total_bytes INTEGER,
  archive_store TEXT,
  applied_kinds TEXT,
  created_at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS ${t("prism_migrations")} (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  applied_by TEXT,
  checksum TEXT,
  metadata TEXT,
  UNIQUE (name, version)
);

CREATE INDEX IF NOT EXISTS prism_sessions_tenant_created_idx
  ON ${t("prism_sessions")} (tenant_id, account_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS prism_sessions_expires_idx ON ${t("prism_sessions")} (expires_at);
CREATE INDEX IF NOT EXISTS prism_branches_session_name_idx ON ${t("prism_branches")} (session_id, name);
CREATE INDEX IF NOT EXISTS prism_branches_leaf_idx ON ${t("prism_branches")} (leaf_entry_id);
CREATE INDEX IF NOT EXISTS prism_session_entries_session_parent_idx
  ON ${t("prism_session_entries")} (session_id, parent_id);
CREATE INDEX IF NOT EXISTS prism_session_entries_session_kind_ts_idx
  ON ${t("prism_session_entries")} (session_id, kind, timestamp);
CREATE INDEX IF NOT EXISTS prism_session_entries_session_run_ts_idx
  ON ${t("prism_session_entries")} (session_id, run_id, timestamp);
CREATE INDEX IF NOT EXISTS prism_session_entries_session_ts_id_idx
  ON ${t("prism_session_entries")} (session_id, timestamp, id);
CREATE INDEX IF NOT EXISTS prism_session_entries_session_id_idx
  ON ${t("prism_session_entries")} (session_id, id);
CREATE INDEX IF NOT EXISTS prism_session_append_idempotency_unique
  ON ${t("prism_session_append_idempotency")} (session_id, expected_parent_id, idempotency_key);
CREATE INDEX IF NOT EXISTS prism_runs_session_started_idx
  ON ${t("prism_runs")} (session_id, started_at, id);
CREATE INDEX IF NOT EXISTS prism_runs_branch_started_idx
  ON ${t("prism_runs")} (branch_id, started_at, id);
CREATE INDEX IF NOT EXISTS prism_agent_events_run_sequence_idx
  ON ${t("prism_agent_events")} (run_id, sequence);
CREATE INDEX IF NOT EXISTS prism_agent_events_session_ts_id_idx
  ON ${t("prism_agent_events")} (session_id, timestamp, id);
CREATE INDEX IF NOT EXISTS prism_tool_calls_session_name_started_idx
  ON ${t("prism_tool_calls")} (session_id, name, started_at);
CREATE INDEX IF NOT EXISTS prism_tool_calls_run_started_idx
  ON ${t("prism_tool_calls")} (run_id, started_at);
CREATE INDEX IF NOT EXISTS prism_usage_run_recorded_idx
  ON ${t("prism_usage")} (run_id, recorded_at, id);
CREATE INDEX IF NOT EXISTS prism_usage_session_recorded_idx
  ON ${t("prism_usage")} (session_id, recorded_at);
CREATE INDEX IF NOT EXISTS prism_agent_definitions_name_version_idx
  ON ${t("prism_agent_definitions")} (name, version);
CREATE INDEX IF NOT EXISTS prism_migrations_name_version_idx
  ON ${t("prism_migrations")} (name, version);
`;
}

export function buildMigration002Ddl(schema: string): string {
  const usage = qualifyTable(schema, "prism_usage");
  return `
ALTER TABLE ${usage} ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'run_total';
ALTER TABLE ${usage} ADD COLUMN IF NOT EXISTS turn INTEGER;
ALTER TABLE ${usage} ADD COLUMN IF NOT EXISTS attempt INTEGER;
CREATE INDEX IF NOT EXISTS prism_usage_session_scope_recorded_idx
  ON ${usage} (session_id, scope, recorded_at);
`;
}

export function buildMigration003Ddl(schema: string): string {
  const feedback = qualifyTable(schema, "prism_run_feedback");
  return `
CREATE TABLE IF NOT EXISTS ${feedback} (
  id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  trace_id TEXT,
  rating DOUBLE PRECISION,
  comment TEXT,
  tags TEXT NOT NULL,
  scorer_ids TEXT NOT NULL,
  evaluation_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  tenant_id TEXT NOT NULL,
  account_id TEXT,
  user_id TEXT,
  metadata TEXT,
  FOREIGN KEY (run_id) REFERENCES ${qualifyTable(schema, "prism_runs")}(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS prism_run_feedback_owner_created_idx
  ON ${feedback} (tenant_id, account_id, user_id, created_at, id);
CREATE INDEX IF NOT EXISTS prism_run_feedback_run_created_idx
  ON ${feedback} (run_id, created_at, id);
CREATE INDEX IF NOT EXISTS prism_run_feedback_trace_created_idx
  ON ${feedback} (trace_id, created_at, id);
`;
}

export const ADAPTER_TABLE_NAMES = [
  "prism_tenants",
  "prism_accounts",
  "prism_users",
  "prism_agent_definitions",
  "prism_sessions",
  "prism_branches",
  "prism_session_entries",
  "prism_session_append_idempotency",
  "prism_runs",
  "prism_agent_events",
  "prism_tool_calls",
  "prism_usage",
  "prism_run_feedback",
  "prism_retention_policies",
  "prism_migrations",
] as const;

export const ADAPTER_INDEX_NAMES = [
  "prism_sessions_tenant_created_idx",
  "prism_sessions_expires_idx",
  "prism_branches_session_name_idx",
  "prism_branches_leaf_idx",
  "prism_session_entries_session_parent_idx",
  "prism_session_entries_session_kind_ts_idx",
  "prism_session_entries_session_run_ts_idx",
  "prism_session_entries_session_ts_id_idx",
  "prism_session_entries_session_id_idx",
  "prism_session_append_idempotency_unique",
  "prism_runs_session_started_idx",
  "prism_runs_branch_started_idx",
  "prism_runs_tenant_idempotency_unique",
  "prism_agent_events_run_sequence_idx",
  "prism_agent_events_session_ts_id_idx",
  "prism_tool_calls_session_name_started_idx",
  "prism_tool_calls_run_started_idx",
  "prism_usage_run_recorded_idx",
  "prism_usage_session_recorded_idx",
  "prism_usage_session_scope_recorded_idx",
  "prism_run_feedback_owner_created_idx",
  "prism_run_feedback_run_created_idx",
  "prism_run_feedback_trace_created_idx",
  "prism_agent_definitions_name_version_idx",
  "prism_migrations_name_version_idx",
] as const;
