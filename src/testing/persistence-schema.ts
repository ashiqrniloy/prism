import { createHash } from "node:crypto";
import type { PersistencePage, SessionEntry, SessionEntryQuery } from "../contracts.js";

// ponytail: dialect-neutral persistence schema model and migration contracts for
// SQLite/PostgreSQL adapter packages (Plan 056 Task 1). SQL stays package-local;
// this module defines the shared table/index/pagination/migration expectations
// adapter authors implement and test against before shipping dialect-specific DDL.

/** Current shared persistence schema version for production database adapters. */
export const PERSISTENCE_SCHEMA_VERSION = 3;

export type PersistenceTableName =
  | "prism_tenants"
  | "prism_accounts"
  | "prism_users"
  | "prism_agent_definitions"
  | "prism_sessions"
  | "prism_branches"
  | "prism_session_entries"
  | "prism_session_append_idempotency"
  | "prism_runs"
  | "prism_agent_events"
  | "prism_tool_calls"
  | "prism_usage"
  | "prism_run_feedback"
  | "prism_retention_policies"
  | "prism_migrations";

export type PersistenceColumnType = "text" | "integer" | "number" | "boolean" | "json" | "timestamp";

export interface PersistenceColumnDefinition {
  readonly name: string;
  readonly type: PersistenceColumnType;
  readonly nullable?: boolean;
  /** Portable SQL default literal, if the schema requires one. */
  readonly defaultValue?: string;
  /** Column participates in tenant isolation boundaries when true. */
  readonly tenantScoped?: boolean;
}

export interface PersistenceForeignKeyDefinition {
  readonly columns: readonly string[];
  readonly referencesTable: PersistenceTableName;
  readonly referencesColumns: readonly string[];
  /** When true, tenant_id must participate in the FK boundary for scoped tables. */
  readonly tenantBound?: boolean;
}

export interface PersistenceTableDefinition {
  readonly name: PersistenceTableName;
  readonly columns: readonly PersistenceColumnDefinition[];
  readonly primaryKey: readonly string[];
  readonly uniqueKeys?: readonly (readonly string[])[];
  readonly foreignKeys?: readonly PersistenceForeignKeyDefinition[];
}

export interface PersistenceIndexDefinition {
  readonly name: string;
  readonly table: PersistenceTableName;
  readonly columns: readonly string[];
  readonly unique?: boolean;
  /** Human-readable query-plan purpose for adapter authors and tests. */
  readonly purpose: string;
}

/** Dialect-neutral schema model shared by SQLite and PostgreSQL adapters. */
export interface PersistenceSchemaModel {
  readonly version: number;
  readonly tables: readonly PersistenceTableDefinition[];
  readonly indexes: readonly PersistenceIndexDefinition[];
}

export interface PersistenceMigrationStep {
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  /** SHA-256 of the canonical checked-in migration schema content. */
  readonly checksum: string;
}

/** Versioned migration expectations shared by production database adapters. */
export interface PersistenceMigrationContract {
  readonly targetSchemaVersion: number;
  readonly appliedMigrationsTable: PersistenceTableName;
  readonly steps: readonly PersistenceMigrationStep[];
  /** Advisory-lock or equivalent guidance for concurrent migration setup. */
  readonly lockGuidance: string;
  /** Least-privilege role guidance for migration vs runtime credentials. */
  readonly leastPrivilegeGuidance: string;
}

/** Cursor key shapes adapters must index so pagination avoids full scans. */
export interface PersistencePaginationCursor {
  readonly table: PersistenceTableName;
  readonly columns: readonly string[];
  readonly supportsOrder: readonly ("asc" | "desc")[];
  readonly purpose: string;
}

/** Guidance adapters must follow: values are bound parameters, never interpolated. */
export const PARAMETERIZED_QUERY_GUIDANCE =
  "Bind every user-supplied value (session ids, idempotency keys, tenant ids, timestamps, JSON payloads) as a query parameter. Quote/validate schema and table identifiers only; never interpolate untrusted strings into SQL text.";

const TENANT_COLUMNS: readonly PersistenceColumnDefinition[] = [
  { name: "tenant_id", type: "text", nullable: true, tenantScoped: true },
  { name: "account_id", type: "text", nullable: true, tenantScoped: true },
  { name: "user_id", type: "text", nullable: true, tenantScoped: true },
];

/** Canonical shared schema model for Tasks 2–3 adapter packages. */
export function createPersistenceSchemaModel(): PersistenceSchemaModel {
  return {
    version: PERSISTENCE_SCHEMA_VERSION,
    tables: [
      {
        name: "prism_tenants",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
          { name: "created_at", type: "timestamp" },
          { name: "metadata", type: "json", nullable: true },
        ],
      },
      {
        name: "prism_accounts",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "tenant_id", type: "text", tenantScoped: true },
          { name: "name", type: "text" },
          { name: "created_at", type: "timestamp" },
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["tenant_id"], referencesTable: "prism_tenants", referencesColumns: ["id"], tenantBound: true }],
      },
      {
        name: "prism_users",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "tenant_id", type: "text", tenantScoped: true },
          { name: "account_id", type: "text", nullable: true, tenantScoped: true },
          { name: "name", type: "text" },
          { name: "created_at", type: "timestamp" },
          { name: "metadata", type: "json", nullable: true },
        ],
      },
      {
        name: "prism_agent_definitions",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
          { name: "version", type: "text" },
          { name: "source", type: "text", nullable: true },
          { name: "agent_definition", type: "json" },
          ...TENANT_COLUMNS,
          { name: "created_at", type: "timestamp" },
          { name: "created_by", type: "text", nullable: true },
          { name: "metadata", type: "json", nullable: true },
        ],
        uniqueKeys: [["name", "version"]],
      },
      {
        name: "prism_sessions",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          ...TENANT_COLUMNS,
          { name: "parent_session_id", type: "text", nullable: true },
          { name: "agent_definition_id", type: "text", nullable: true },
          { name: "agent_definition_version", type: "text", nullable: true },
          { name: "created_at", type: "timestamp" },
          { name: "updated_at", type: "timestamp" },
          { name: "expires_at", type: "timestamp", nullable: true },
          { name: "retention_policy_id", type: "text", nullable: true },
          { name: "metadata", type: "json", nullable: true },
        ],
      },
      {
        name: "prism_branches",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "name", type: "text", nullable: true },
          { name: "root_entry_id", type: "text", nullable: true },
          { name: "parent_branch_id", type: "text", nullable: true },
          { name: "leaf_entry_id", type: "text", nullable: true },
          { name: "created_at", type: "timestamp" },
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
      },
      {
        name: "prism_session_entries",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "parent_id", type: "text", nullable: true },
          { name: "run_id", type: "text", nullable: true },
          { name: "timestamp", type: "timestamp" },
          { name: "kind", type: "text" },
          { name: "schema_version", type: "integer", nullable: true },
          { name: "message", type: "json", nullable: true },
          { name: "event", type: "json", nullable: true },
          { name: "model", type: "json", nullable: true },
          { name: "previous_model", type: "json", nullable: true },
          { name: "label", type: "text", nullable: true },
          { name: "summary", type: "text", nullable: true },
          { name: "data", type: "json", nullable: true },
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [
          { columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] },
          { columns: ["parent_id"], referencesTable: "prism_session_entries", referencesColumns: ["id"] },
        ],
      },
      {
        name: "prism_session_append_idempotency",
        primaryKey: ["session_id", "expected_parent_id", "idempotency_key"],
        columns: [
          { name: "session_id", type: "text" },
          { name: "expected_parent_id", type: "text" },
          { name: "idempotency_key", type: "text" },
          { name: "entry_id", type: "text" },
          { name: "created_at", type: "timestamp" },
          ...TENANT_COLUMNS,
        ],
        uniqueKeys: [["session_id", "expected_parent_id", "idempotency_key"]],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
      },
      {
        name: "prism_runs",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "branch_id", type: "text", nullable: true },
          { name: "agent_definition_id", type: "text", nullable: true },
          { name: "agent_definition_version", type: "text", nullable: true },
          { name: "status", type: "text", nullable: true },
          { name: "started_at", type: "timestamp" },
          { name: "finished_at", type: "timestamp", nullable: true },
          { name: "model", type: "json", nullable: true },
          { name: "provider", type: "text", nullable: true },
          { name: "idempotency_key", type: "text", nullable: true },
          { name: "abort_reason", type: "text", nullable: true },
          { name: "error", type: "json", nullable: true },
          ...TENANT_COLUMNS,
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
      },
      {
        name: "prism_agent_events",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "run_id", type: "text", nullable: true },
          { name: "entry_id", type: "text", nullable: true },
          { name: "sequence", type: "integer" },
          { name: "type", type: "text" },
          { name: "timestamp", type: "timestamp" },
          { name: "event", type: "json" },
          { name: "redacted", type: "boolean" },
          ...TENANT_COLUMNS,
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
      },
      {
        name: "prism_tool_calls",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "run_id", type: "text", nullable: true },
          { name: "entry_id", type: "text", nullable: true },
          { name: "tool_call_id", type: "text" },
          { name: "name", type: "text" },
          { name: "arguments", type: "json" },
          { name: "result", type: "json", nullable: true },
          { name: "status", type: "text", nullable: true },
          { name: "reason", type: "text", nullable: true },
          { name: "progress", type: "json", nullable: true },
          { name: "progress_metadata", type: "json", nullable: true },
          { name: "progress_at", type: "timestamp", nullable: true },
          { name: "started_at", type: "timestamp" },
          { name: "finished_at", type: "timestamp", nullable: true },
          { name: "redacted", type: "boolean" },
          ...TENANT_COLUMNS,
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
      },
      {
        name: "prism_usage",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "run_id", type: "text", nullable: true },
          { name: "entry_id", type: "text", nullable: true },
          { name: "scope", type: "text", defaultValue: "'run_total'" },
          { name: "turn", type: "integer", nullable: true },
          { name: "attempt", type: "integer", nullable: true },
          { name: "usage", type: "json" },
          { name: "recorded_at", type: "timestamp" },
          ...TENANT_COLUMNS,
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
      },
      {
        name: "prism_run_feedback",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "run_id", type: "text" },
          { name: "session_id", type: "text" },
          { name: "trace_id", type: "text", nullable: true },
          { name: "rating", type: "number", nullable: true },
          { name: "comment", type: "text", nullable: true },
          { name: "tags", type: "json" },
          { name: "scorer_ids", type: "json" },
          { name: "evaluation_ids", type: "json" },
          { name: "created_at", type: "timestamp" },
          { name: "created_by", type: "text", nullable: true },
          { name: "tenant_id", type: "text", tenantScoped: true },
          { name: "account_id", type: "text", nullable: true, tenantScoped: true },
          { name: "user_id", type: "text", nullable: true, tenantScoped: true },
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["run_id"], referencesTable: "prism_runs", referencesColumns: ["id"] }],
      },
      {
        name: "prism_retention_policies",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          ...TENANT_COLUMNS,
          { name: "name", type: "text", nullable: true },
          { name: "max_age_days", type: "integer", nullable: true },
          { name: "max_entries_per_session", type: "integer", nullable: true },
          { name: "max_total_bytes", type: "integer", nullable: true },
          { name: "archive_store", type: "text", nullable: true },
          { name: "applied_kinds", type: "json", nullable: true },
          { name: "created_at", type: "timestamp" },
          { name: "metadata", type: "json", nullable: true },
        ],
      },
      {
        name: "prism_migrations",
        primaryKey: ["id"],
        columns: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
          { name: "version", type: "text" },
          { name: "applied_at", type: "timestamp" },
          { name: "applied_by", type: "text", nullable: true },
          { name: "checksum", type: "text", nullable: true },
          { name: "metadata", type: "json", nullable: true },
        ],
        uniqueKeys: [["name", "version"]],
      },
    ],
    indexes: [
      { name: "prism_sessions_tenant_created_idx", table: "prism_sessions", columns: ["tenant_id", "account_id", "user_id", "created_at"], purpose: "tenant-scoped session listing" },
      { name: "prism_sessions_expires_idx", table: "prism_sessions", columns: ["expires_at"], purpose: "retention expiry scans" },
      { name: "prism_branches_session_name_idx", table: "prism_branches", columns: ["session_id", "name"], purpose: "named branch lookup" },
      { name: "prism_branches_leaf_idx", table: "prism_branches", columns: ["leaf_entry_id"], purpose: "leaf-to-branch resolution" },
      { name: "prism_session_entries_session_parent_idx", table: "prism_session_entries", columns: ["session_id", "parent_id"], purpose: "parent existence checks and child lookups" },
      { name: "prism_session_entries_session_kind_ts_idx", table: "prism_session_entries", columns: ["session_id", "kind", "timestamp"], purpose: "kind-filtered entry listing" },
      { name: "prism_session_entries_session_run_ts_idx", table: "prism_session_entries", columns: ["session_id", "run_id", "timestamp"], purpose: "run-scoped entry listing" },
      { name: "prism_session_entries_session_ts_id_idx", table: "prism_session_entries", columns: ["session_id", "timestamp", "id"], purpose: "cursor pagination without full scans" },
      { name: "prism_session_entries_session_id_idx", table: "prism_session_entries", columns: ["session_id", "id"], purpose: "append parent validation and recursive branch reads" },
      { name: "prism_session_append_idempotency_unique", table: "prism_session_append_idempotency", columns: ["session_id", "expected_parent_id", "idempotency_key"], purpose: "append retry deduplication (primary key enforces uniqueness)" },
      { name: "prism_runs_session_started_idx", table: "prism_runs", columns: ["session_id", "started_at", "id"], purpose: "run history pagination" },
      { name: "prism_runs_branch_started_idx", table: "prism_runs", columns: ["branch_id", "started_at", "id"], purpose: "branch-scoped runs" },
      { name: "prism_runs_tenant_idempotency_unique", table: "prism_runs", columns: ["tenant_id", "idempotency_key"], unique: true, purpose: "run-level idempotency deduplication per tenant" },
      { name: "prism_agent_events_run_sequence_idx", table: "prism_agent_events", columns: ["run_id", "sequence"], purpose: "stable per-run event timeline pagination" },
      { name: "prism_agent_events_session_ts_id_idx", table: "prism_agent_events", columns: ["session_id", "timestamp", "id"], purpose: "event stream pagination" },
      { name: "prism_tool_calls_session_name_started_idx", table: "prism_tool_calls", columns: ["session_id", "name", "started_at"], purpose: "tool usage by name" },
      { name: "prism_tool_calls_run_started_idx", table: "prism_tool_calls", columns: ["run_id", "started_at"], purpose: "run tool-call listing" },
      { name: "prism_usage_run_recorded_idx", table: "prism_usage", columns: ["run_id", "recorded_at", "id"], purpose: "run usage pagination" },
      { name: "prism_usage_session_recorded_idx", table: "prism_usage", columns: ["session_id", "recorded_at"], purpose: "usage aggregation" },
      { name: "prism_usage_session_scope_recorded_idx", table: "prism_usage", columns: ["session_id", "scope", "recorded_at"], purpose: "scope-safe usage aggregation" },
      { name: "prism_run_feedback_owner_created_idx", table: "prism_run_feedback", columns: ["tenant_id", "account_id", "user_id", "created_at", "id"], purpose: "ownership-scoped feedback pagination" },
      { name: "prism_run_feedback_run_created_idx", table: "prism_run_feedback", columns: ["run_id", "created_at", "id"], purpose: "run feedback lookup" },
      { name: "prism_run_feedback_trace_created_idx", table: "prism_run_feedback", columns: ["trace_id", "created_at", "id"], purpose: "trace feedback lookup" },
      { name: "prism_agent_definitions_name_version_idx", table: "prism_agent_definitions", columns: ["name", "version"], purpose: "definition lookup" },
      { name: "prism_migrations_name_version_idx", table: "prism_migrations", columns: ["name", "version"], purpose: "applied-migration lookup (table constraint enforces uniqueness)" },
    ],
  };
}

function migrationStep(version: number, name: string, description: string): PersistenceMigrationStep {
  const model = createPersistenceSchemaModel();
  const content = version === 1
    ? {
        tables: model.tables
          .filter((table) => table.name !== "prism_run_feedback")
          .map((table) => table.name === "prism_usage"
            ? { ...table, columns: table.columns.filter((column) => !["scope", "turn", "attempt"].includes(column.name)) }
            : table),
        indexes: model.indexes.filter((index) => !index.name.startsWith("prism_usage_session_scope_") && !index.name.startsWith("prism_run_feedback_")),
      }
    : version === 2
      ? { table: "prism_usage", columns: ["scope", "turn", "attempt"], indexes: ["prism_usage_session_scope_recorded_idx"] }
      : { tables: ["prism_run_feedback"], indexes: model.indexes.filter((index) => index.name.startsWith("prism_run_feedback_")).map((index) => index.name) };
  return {
    version,
    name,
    description,
    checksum: createHash("sha256").update(JSON.stringify({ version, name, content })).digest("hex"),
  };
}

/** Canonical migration contract for production adapters. */
export function createPersistenceMigrationContract(): PersistenceMigrationContract {
  return {
    targetSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
    appliedMigrationsTable: "prism_migrations",
    steps: [
      migrationStep(1, "001_init", "Create core session, branch, entry, idempotency, run, ledger, and migration tables."),
      migrationStep(2, "002_usage_scope", "Distinguish provider-turn usage from aggregate run totals."),
      migrationStep(3, "003_run_feedback", "Add immutable ownership-scoped run/trace feedback and evaluation links."),
    ],
    lockGuidance:
      "Acquire a dialect-specific migration lock before applying steps (PostgreSQL advisory lock; SQLite exclusive transaction). Only one process should migrate at a time.",
    leastPrivilegeGuidance:
      "Run migrations with a DDL-capable role; use a separate least-privilege runtime role limited to INSERT/SELECT/UPDATE on adapter tables. Never grant migration credentials to the agent runtime.",
  };
}

/** Indexed cursor columns adapters must support for paginated reads. */
export function getPersistencePaginationCursors(): readonly PersistencePaginationCursor[] {
  return [
    { table: "prism_session_entries", columns: ["session_id", "timestamp", "id"], supportsOrder: ["asc", "desc"], purpose: "entry listing and branch paging" },
    { table: "prism_runs", columns: ["session_id", "started_at", "id"], supportsOrder: ["asc", "desc"], purpose: "run history" },
    { table: "prism_agent_events", columns: ["run_id", "sequence"], supportsOrder: ["asc", "desc"], purpose: "stable per-run event timeline" },
    { table: "prism_agent_events", columns: ["session_id", "timestamp", "id"], supportsOrder: ["asc", "desc"], purpose: "session event stream" },
    { table: "prism_usage", columns: ["run_id", "recorded_at", "id"], supportsOrder: ["asc", "desc"], purpose: "run usage totals" },
    { table: "prism_tool_calls", columns: ["run_id", "started_at"], supportsOrder: ["asc", "desc"], purpose: "run tool-call listing" },
    { table: "prism_run_feedback", columns: ["tenant_id", "account_id", "user_id", "created_at", "id"], supportsOrder: ["asc", "desc"], purpose: "owned feedback listing" },
  ];
}

/** Build a tenant-scoped unique key column list for adapter DDL. */
export function tenantScopedUniqueKey(
  baseColumns: readonly string[],
  tenantColumn: "tenant_id" | "account_id" | "user_id" = "tenant_id",
): readonly string[] {
  return [tenantColumn, ...baseColumns];
}

/** Assert a schema model includes required tables, tenant boundaries, and indexes. */
export function assertPersistenceSchemaModel(model: PersistenceSchemaModel): void {
  const canonical = createPersistenceSchemaModel();
  if (model.version !== canonical.version) {
    throw new Error(`Persistence schema version mismatch: expected ${canonical.version}, got ${model.version}`);
  }

  const tableNames = new Set(model.tables.map((table) => table.name));
  for (const required of canonical.tables.map((table) => table.name)) {
    if (!tableNames.has(required)) throw new Error(`Persistence schema missing required table: ${required}`);
  }

  const idempotency = model.tables.find((table) => table.name === "prism_session_append_idempotency");
  if (!idempotency) throw new Error("Persistence schema missing idempotency side table");
  if (!idempotency.columns.some((column) => column.name === "tenant_id" && column.tenantScoped)) {
    throw new Error("Idempotency table must include tenant-scoped tenant_id for isolation boundaries");
  }
  const hasIdempotencyUnique = (idempotency.uniqueKeys ?? []).some(
    (key) => key.includes("session_id") && key.includes("expected_parent_id") && key.includes("idempotency_key"),
  );
  if (!hasIdempotencyUnique) {
    throw new Error("Idempotency table must declare unique (session_id, expected_parent_id, idempotency_key)");
  }

  const runs = model.tables.find((table) => table.name === "prism_runs");
  if (!runs?.columns.some((column) => column.name === "tenant_id" && column.tenantScoped)) {
    throw new Error("Runs table must include tenant-scoped tenant_id");
  }

  const indexTables = new Set(model.indexes.map((index) => index.table));
  for (const requiredIndex of ["prism_session_append_idempotency", "prism_session_entries", "prism_agent_events", "prism_runs", "prism_run_feedback"]) {
    if (!indexTables.has(requiredIndex as PersistenceTableName)) {
      throw new Error(`Persistence schema missing indexes for ${requiredIndex}`);
    }
  }

  const paginationTables = new Set(getPersistencePaginationCursors().map((cursor) => cursor.table));
  for (const table of paginationTables) {
    if (!tableNames.has(table)) throw new Error(`Pagination cursor references missing table: ${table}`);
  }
}

/** Assert migration steps are strictly increasing and end at the target schema version. */
export function assertPersistenceMigrationContract(contract: PersistenceMigrationContract): void {
  if (contract.targetSchemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
    throw new Error(`Migration contract target version must be ${PERSISTENCE_SCHEMA_VERSION}`);
  }
  if (contract.appliedMigrationsTable !== "prism_migrations") {
    throw new Error("Migration contract must record applied steps in prism_migrations");
  }
  if (!contract.lockGuidance.trim() || !contract.leastPrivilegeGuidance.trim()) {
    throw new Error("Migration contract must document lock and least-privilege guidance");
  }
  if (contract.steps.length === 0) throw new Error("Migration contract must include at least one step");

  let previous = 0;
  const names = new Set<string>();
  for (const step of contract.steps) {
    if (step.version <= previous) throw new Error(`Migration steps must be strictly increasing; ${step.name} is out of order`);
    if (names.has(step.name)) throw new Error(`Duplicate migration step name: ${step.name}`);
    if (!/^[a-f0-9]{64}$/.test(step.checksum)) throw new Error(`Migration step ${step.name} must have a SHA-256 checksum`);
    names.add(step.name);
    previous = step.version;
  }
  if (previous !== contract.targetSchemaVersion) {
    throw new Error(`Last migration step version ${previous} must equal targetSchemaVersion ${contract.targetSchemaVersion}`);
  }
}

export type PersistenceSchemaDialect = "sqlite" | "postgres";

export interface PersistenceSchemaShapeColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultValue?: string;
}

export interface PersistenceSchemaShapeForeignKey {
  readonly columns: readonly string[];
  readonly referencesTable: string;
  readonly referencesColumns: readonly string[];
}

export interface PersistenceSchemaShapeTable {
  readonly name: string;
  readonly columns: readonly PersistenceSchemaShapeColumn[];
  readonly primaryKey: readonly string[];
  readonly uniqueKeys: readonly (readonly string[])[];
  readonly foreignKeys: readonly PersistenceSchemaShapeForeignKey[];
}

export interface PersistenceSchemaShapeIndex {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface PersistenceSchemaShape {
  readonly tables: readonly PersistenceSchemaShapeTable[];
  readonly indexes: readonly PersistenceSchemaShapeIndex[];
}

function schemaKey(columns: readonly string[]): string {
  return columns.join("\u0000");
}

function normalizedDefault(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().replace(/::[a-z_ ]+$/, "");
}

function compatibleColumnType(dialect: PersistenceSchemaDialect, actual: string, expected: PersistenceColumnType): boolean {
  const type = actual.trim().toUpperCase();
  if (dialect === "sqlite") {
    if (expected === "integer" || expected === "boolean") return type === "INTEGER";
    if (expected === "number") return type === "REAL";
    return type === "TEXT";
  }
  if (expected === "integer") return type === "INTEGER";
  if (expected === "boolean") return type === "BOOLEAN";
  if (expected === "number") return type === "DOUBLE PRECISION";
  return type === "TEXT";
}

/** Compare bounded dialect catalog output against every required schema-v3 detail. */
export function assertPersistenceSchemaShape(
  shape: PersistenceSchemaShape,
  dialect: PersistenceSchemaDialect,
  model: PersistenceSchemaModel = createPersistenceSchemaModel(),
): void {
  assertPersistenceSchemaModel(model);
  const actualTables = new Map(shape.tables.map((table) => [table.name, table]));
  for (const expected of model.tables) {
    const actual = actualTables.get(expected.name);
    if (!actual) throw new Error(`Persistence schema missing table ${expected.name}`);
    if (actual.columns.length !== expected.columns.length) throw new Error(`Persistence schema table ${expected.name} has unexpected columns`);
    const actualColumns = new Map(actual.columns.map((column) => [column.name, column]));
    for (const column of expected.columns) {
      const found = actualColumns.get(column.name);
      if (!found) throw new Error(`Persistence schema table ${expected.name} missing column ${column.name}`);
      if (!compatibleColumnType(dialect, found.type, column.type)) {
        throw new Error(`Persistence schema column ${expected.name}.${column.name} has incompatible type`);
      }
      if (found.nullable !== (column.nullable === true)) {
        throw new Error(`Persistence schema column ${expected.name}.${column.name} has incompatible nullability`);
      }
      if (normalizedDefault(found.defaultValue) !== normalizedDefault(column.defaultValue)) {
        throw new Error(`Persistence schema column ${expected.name}.${column.name} has incompatible default`);
      }
    }
    if (schemaKey(actual.primaryKey) !== schemaKey(expected.primaryKey)) {
      throw new Error(`Persistence schema table ${expected.name} has incompatible primary key`);
    }
    const unique = new Set(actual.uniqueKeys.map(schemaKey));
    for (const key of expected.uniqueKeys ?? []) {
      if (!unique.has(schemaKey(key)) && schemaKey(actual.primaryKey) !== schemaKey(key)) {
        throw new Error(`Persistence schema table ${expected.name} missing unique key (${key.join(", ")})`);
      }
    }
    const foreign = new Set(actual.foreignKeys.map((key) => `${schemaKey(key.columns)}>${key.referencesTable}:${schemaKey(key.referencesColumns)}`));
    for (const key of expected.foreignKeys ?? []) {
      if (!foreign.has(`${schemaKey(key.columns)}>${key.referencesTable}:${schemaKey(key.referencesColumns)}`)) {
        throw new Error(`Persistence schema table ${expected.name} missing foreign key (${key.columns.join(", ")})`);
      }
    }
  }
  const actualIndexes = new Map(shape.indexes.map((index) => [index.name, index]));
  for (const expected of model.indexes) {
    const actual = actualIndexes.get(expected.name);
    if (!actual) throw new Error(`Persistence schema missing required index ${expected.name}`);
    if (actual.table !== expected.table || schemaKey(actual.columns) !== schemaKey(expected.columns) || actual.unique !== (expected.unique === true)) {
      throw new Error(`Persistence schema index ${expected.name} has incompatible definition`);
    }
  }
}

export interface AppliedPersistenceMigration {
  readonly name: string;
  readonly version: string;
  readonly checksum: string | null;
}

/** Reject altered migration history before any new DDL or runtime write. */
export function assertAppliedPersistenceMigrations(
  contract: PersistenceMigrationContract,
  applied: readonly AppliedPersistenceMigration[],
): { readonly legacyChecksums: boolean } {
  assertPersistenceMigrationContract(contract);
  if (applied.length > contract.steps.length) throw new Error("Migration history has unknown rows");
  const legacyChecksums = applied.some((row) => row.checksum === null);
  if (legacyChecksums && (applied.length !== contract.steps.length || !applied.every((row) => row.checksum === null))) {
    throw new Error("Migration history has incomplete legacy checksums");
  }
  for (let index = 0; index < applied.length; index++) {
    const row = applied[index]!;
    const expected = contract.steps[index]!;
    if (row.name !== expected.name || row.version !== String(expected.version)) {
      throw new Error(`Migration history row ${index} does not match ${expected.name}`);
    }
    if (!legacyChecksums && row.checksum !== expected.checksum) {
      throw new Error(`Migration history checksum mismatch for ${expected.name}`);
    }
  }
  return { legacyChecksums };
}

/**
 * Assert a dialect-local adapter exposes the canonical table and index names.
 * Adapters pass the table/index names their migration runner created.
 */
export function assertAdapterSchemaMatchesModel(
  adapterTables: readonly string[],
  adapterIndexes: readonly string[],
  model: PersistenceSchemaModel = createPersistenceSchemaModel(),
): void {
  assertPersistenceSchemaModel(model);
  const tables = new Set(adapterTables);
  for (const table of model.tables.map((item) => item.name)) {
    if (!tables.has(table)) throw new Error(`Adapter schema missing table ${table}`);
  }
  for (const index of model.indexes) {
    if (!adapterIndexes.includes(index.name)) {
      throw new Error(`Adapter schema missing required index ${index.name}`);
    }
  }
}

/** Guard adapter SQL tests: reject obvious value interpolation into statement text. */
export function assertParameterizedQuery(sql: string, boundValues: readonly unknown[]): void {
  for (const value of boundValues) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (sql.includes(value)) {
      throw new Error("SQL statement appears to interpolate a bound string value; use parameters instead");
    }
  }
}

/** Simulate migration up + reopen: applied steps must match the contract in order. */
export function assertMigrationUpAndReopen(
  contract: PersistenceMigrationContract,
  appliedAfterUp: readonly AppliedPersistenceMigration[],
  appliedAfterReopen: readonly AppliedPersistenceMigration[],
): void {
  const first = assertAppliedPersistenceMigrations(contract, appliedAfterUp);
  if (appliedAfterUp.length !== contract.steps.length || first.legacyChecksums) {
    throw new Error("Migration up did not apply every checksummed contract step");
  }
  const second = assertAppliedPersistenceMigrations(contract, appliedAfterReopen);
  if (second.legacyChecksums || appliedAfterReopen.length !== appliedAfterUp.length) {
    throw new Error("Reopened adapter migration history diverged");
  }
  for (let index = 0; index < appliedAfterUp.length; index++) {
    if (appliedAfterReopen[index]!.checksum !== appliedAfterUp[index]!.checksum) {
      throw new Error("Reopened adapter migration checksums diverged");
    }
  }
}

export interface PersistenceQueryConformanceFixture {
  readonly seedEntries: (entries: readonly SessionEntry[]) => Promise<void> | void;
  readonly queryEntries: (query: SessionEntryQuery) => Promise<PersistencePage<SessionEntry>>;
}

/** Assert cursor pagination returns stable pages without repeating rows. */
export async function assertPersistenceQueryPaginationConforms(
  fixture: PersistenceQueryConformanceFixture,
  sessionId = "pagination-conformance",
): Promise<void> {
  const entries: SessionEntry[] = [0, 1, 2, 3, 4].map((index) => ({
    id: `page-${index}`,
    sessionId,
    timestamp: `2026-01-01T00:00:0${index}.000Z`,
    kind: "label" as const,
    label: `e${index}`,
  }));
  await fixture.seedEntries(entries);

  const first = await fixture.queryEntries({ sessionId, limit: 2, order: "asc" });
  if (first.items.length !== 2) throw new Error("Pagination first page must honor limit");
  if (!first.nextCursor) throw new Error("Pagination must return nextCursor when more rows exist");

  const second = await fixture.queryEntries({ sessionId, limit: 2, order: "asc", cursor: first.nextCursor });
  const seen = new Set(first.items.map((row) => row.id));
  for (const row of second.items) {
    if (seen.has(row.id)) throw new Error("Pagination cursor returned overlapping rows");
    seen.add(row.id);
  }
  if (seen.size < 3) throw new Error("Pagination did not advance past the first page");
}

/** Assert tenant-filtered queries do not return rows from another tenant. */
export async function assertTenantScopedQueryIsolation(
  queryByTenant: (tenantId: string) => Promise<readonly { readonly tenantId?: string; readonly id: string }[]>,
): Promise<void> {
  const tenantA = await queryByTenant("tenant-a");
  const tenantB = await queryByTenant("tenant-b");
  if (tenantA.some((row) => row.tenantId === "tenant-b")) {
    throw new Error("Tenant-a query leaked tenant-b rows");
  }
  if (tenantB.some((row) => row.tenantId === "tenant-a")) {
    throw new Error("Tenant-b query leaked tenant-a rows");
  }
  const aIds = new Set(tenantA.map((row) => row.id));
  for (const row of tenantB) {
    if (aIds.has(row.id)) throw new Error("Tenant collision: the same primary id appeared in two tenant queries");
  }
}
