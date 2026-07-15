import type { PersistencePage, SessionEntry, SessionEntryQuery } from "../contracts.js";

// ponytail: dialect-neutral persistence schema model and migration contracts for
// SQLite/PostgreSQL adapter packages (Plan 056 Task 1). SQL stays package-local;
// this module defines the shared table/index/pagination/migration expectations
// adapter authors implement and test against before shipping dialect-specific DDL.

/** Current shared persistence schema version for production database adapters. */
export const PERSISTENCE_SCHEMA_VERSION = 1;

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
  | "prism_retention_policies"
  | "prism_migrations";

export type PersistenceColumnType = "text" | "integer" | "boolean" | "json" | "timestamp";

export interface PersistenceColumnDefinition {
  readonly name: string;
  readonly type: PersistenceColumnType;
  readonly nullable?: boolean;
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
          { name: "schema_version", type: "integer" },
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
        uniqueKeys: [["tenant_id", "idempotency_key"]],
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
          { name: "usage", type: "json" },
          { name: "recorded_at", type: "timestamp" },
          ...TENANT_COLUMNS,
          { name: "metadata", type: "json", nullable: true },
        ],
        foreignKeys: [{ columns: ["session_id"], referencesTable: "prism_sessions", referencesColumns: ["id"] }],
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
      { name: "prism_session_append_idempotency_unique", table: "prism_session_append_idempotency", columns: ["session_id", "expected_parent_id", "idempotency_key"], unique: true, purpose: "append retry deduplication" },
      { name: "prism_runs_session_started_idx", table: "prism_runs", columns: ["session_id", "started_at", "id"], purpose: "run history pagination" },
      { name: "prism_runs_branch_started_idx", table: "prism_runs", columns: ["branch_id", "started_at", "id"], purpose: "branch-scoped runs" },
      { name: "prism_runs_tenant_idempotency_unique", table: "prism_runs", columns: ["tenant_id", "idempotency_key"], unique: true, purpose: "run-level idempotency deduplication per tenant" },
      { name: "prism_agent_events_run_sequence_idx", table: "prism_agent_events", columns: ["run_id", "sequence"], purpose: "stable per-run event timeline pagination" },
      { name: "prism_agent_events_session_ts_id_idx", table: "prism_agent_events", columns: ["session_id", "timestamp", "id"], purpose: "event stream pagination" },
      { name: "prism_tool_calls_session_name_started_idx", table: "prism_tool_calls", columns: ["session_id", "name", "started_at"], purpose: "tool usage by name" },
      { name: "prism_tool_calls_run_started_idx", table: "prism_tool_calls", columns: ["run_id", "started_at"], purpose: "run tool-call listing" },
      { name: "prism_usage_run_recorded_idx", table: "prism_usage", columns: ["run_id", "recorded_at", "id"], purpose: "run usage pagination" },
      { name: "prism_usage_session_recorded_idx", table: "prism_usage", columns: ["session_id", "recorded_at"], purpose: "usage aggregation" },
      { name: "prism_agent_definitions_name_version_idx", table: "prism_agent_definitions", columns: ["name", "version"], purpose: "definition lookup" },
      { name: "prism_migrations_name_version_idx", table: "prism_migrations", columns: ["name", "version"], unique: true, purpose: "applied-migration uniqueness" },
    ],
  };
}

/** Canonical migration contract for production adapters. */
export function createPersistenceMigrationContract(): PersistenceMigrationContract {
  return {
    targetSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
    appliedMigrationsTable: "prism_migrations",
    steps: [
      { version: 1, name: "001_init", description: "Create core session, branch, entry, idempotency, run, ledger, and migration tables." },
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
  for (const requiredIndex of ["prism_session_append_idempotency", "prism_session_entries", "prism_agent_events", "prism_runs"]) {
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
    names.add(step.name);
    previous = step.version;
  }
  if (previous !== contract.targetSchemaVersion) {
    throw new Error(`Last migration step version ${previous} must equal targetSchemaVersion ${contract.targetSchemaVersion}`);
  }
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
  appliedAfterUp: readonly { readonly name: string; readonly version: string }[],
  appliedAfterReopen: readonly { readonly name: string; readonly version: string }[],
): void {
  assertPersistenceMigrationContract(contract);
  if (appliedAfterUp.length !== contract.steps.length) {
    throw new Error("Migration up did not apply every contract step");
  }
  for (let i = 0; i < contract.steps.length; i++) {
    const step = contract.steps[i]!;
    const row = appliedAfterUp[i]!;
    if (row.name !== step.name || row.version !== String(step.version)) {
      throw new Error(`Applied migration row ${i} does not match contract step ${step.name}`);
    }
  }
  if (appliedAfterReopen.length !== appliedAfterUp.length) {
    throw new Error("Reopened adapter must not re-apply migrations; applied row count changed");
  }
  for (let i = 0; i < appliedAfterUp.length; i++) {
    if (appliedAfterReopen[i]!.name !== appliedAfterUp[i]!.name) {
      throw new Error("Reopened adapter migration history diverged");
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
