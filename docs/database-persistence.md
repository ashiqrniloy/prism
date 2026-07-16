# Database persistence

## What it does

The production persistence contracts describe database-neutral types for durable, multi-tenant storage of Prism sessions, branch handles, session entries, runs, agent-event ledger rows, tool-call rows, usage rows, agent-definition versions, retention policies, and migration records. They also define cursor-paginated query shapes so hosts can implement SQL, NoSQL, or object-store adapters without changing Prism runtime internals.

Prism itself does not ship a production database adapter. The built-in `SessionStore` contract (`append` / `list` / optional `get`) remains the runtime seam; `ProductionPersistenceStore` is the optional adapter-facing contract for hosts that need paginated reads, tenant isolation, audit tables, retention, and optional generic `CheckpointStore` / `LeaseStore` capabilities.

Plan 056 Task 1 adds dialect-neutral shared primitives under `@arnilo/prism/testing/persistence-schema`, `@arnilo/prism/testing/session-store-conformance`, and `@arnilo/prism/testing/run-ledger-conformance`. Task 2 ships `@arnilo/prism-session-store-sqlite` (see [SQLite persistence](sqlite-persistence.md)); Task 3 ships `@arnilo/prism-session-store-postgres` (see [PostgreSQL persistence](postgres-persistence.md)). Both implement dialect-local SQL against the shared model; Prism core still ships no ORM, driver, or migration runner.

## When to use it

Use these contracts when you write a database-backed `SessionStore` or a separate persistence adapter that needs:

- paginated branch/session/event reads via cursor, limit, and order
- filters by `sessionId`, `runId`, `parentId`, branch `leafId`, timestamps, tenant/account/user, event type, and entry kind
- durable tables for runs, events, tool calls, usage, and agent-definition versions
- retention policies and migration records

Do not use these contracts as a required runtime dependency. The agent/session runtime only requires `SessionStore`. `ProductionPersistenceStore` is an extension point for hosts that want richer querying. A network-free, runnable reference adapter that implements `SessionStore` + `RunLedger` + `ProductionPersistenceStore` reads against in-memory tables lives at [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts) — lift its contract shapes into your own SQL/NoSQL adapter. The example also calls `assertSessionStoreConforms(..., { exerciseReadBranchPath: true })`, so adapter authors have an executable baseline before adding database-specific tests.

## Inputs / request

Import the contracts from the root package:

```ts
import type {
  ProductionPersistenceStore,
  PersistencePage,
  PersistenceQuery,
  SessionRecord,
  SessionQuery,
  BranchRecord,
  BranchQuery,
  SessionEntryQuery,
  SessionBranchRead,
  RunRecord,
  RunQuery,
  AgentEventRecord,
  AgentEventQuery,
  ToolCallRecord,
  ToolCallQuery,
  UsageRecord,
  UsageQuery,
  AgentDefinitionRecord,
  AgentDefinitionQuery,
  RetentionPolicy,
  RetentionPolicyQuery,
  MigrationRecord,
  MigrationQuery,
  OwnershipScope,
} from "@arnilo/prism";
```

Important shapes:

| Contract | Purpose |
| --- | --- |
| `ProductionPersistenceStore` | Adapter-facing interface with `query*` methods plus optional `readBranchPath(query)`, all returning `PersistencePage<T>`. No SQL/ORM/host file storage/network dependency is required. |
| `PersistencePage<T>` | `{ items; nextCursor?; total? }` cursor page. |
| `PersistenceQuery` | `{ cursor?; limit?; order?: "asc" \| "desc" }`. |
| `OwnershipScope` | `{ tenantId?; accountId?; userId? }` included in records and queries for multi-tenant isolation. |
| `SessionRecord` | Stored session with ids, timestamps, optional parent session, agent-definition reference, retention policy, and ownership scope. |
| `BranchRecord` | Branch handle / leaf pointer with `sessionId`, optional `name`, `rootEntryId`, `parentBranchId`, and `leafEntryId`. |
| `SessionEntryQuery` | Cursor query for entry ranges by session/run/parent/leaf/kind/time. |
| `SessionBranchRead` | `{ sessionId, leafId?, cursor?, limit? }` request for one branch's ancestor chain. Used by `readBranchPath` so runtime branch reads avoid `list(sessionId)`. |
| `RunRecord` | Stored run with `sessionId`, `branchId`, status (`queued` \| `running` \| `succeeded` \| `failed` \| `aborted`), `model`, `provider`, `idempotencyKey`, `abortReason`, and `error`. |
| `AgentEventRecord` | Event ledger row with `event: AgentEvent` and a `redacted` flag. Hosts redact before storage. |
| `ToolCallRecord` | Tool-call row with `arguments`, optional `result: ToolResult`, `reason`, `progress` snapshots, status, and a `redacted` flag. |
| `UsageRecord` | Scoped provider-turn or aggregate run usage with session/run/entry and turn/attempt linkage. |
| `AgentDefinitionRecord` | Versioned agent definition snapshot. Only stores `AgentDefinition` data; never provider credentials/resolvers/instances. |
| `RetentionPolicy` | Policy with `maxAgeDays`, `maxEntriesPerSession`, `maxTotalBytes`, `archiveStore`, and `appliedKinds`. |
| `MigrationRecord` | Applied migration with name, version, timestamp, checksum, and applied-by. |

## Outputs / response / events

Each `query*` method returns a `PersistencePage<T>`:

```ts
{
  items: readonly T[];
  nextCursor?: string;
  total?: number;
}
```

`nextCursor` is opaque to Prism; hosts encode whatever cursor they need. Absent `nextCursor` means the end of the result set. `total` is optional because exact counts can be expensive on some stores.

## Reference relational schema

This schema is a reference, not generated DDL. Hosts map these tables/columns to their chosen database. Names snake_case here map to the camelCase TypeScript contracts in `src/contracts.ts`.

### Multi-tenant ownership (host-managed)

Hosts that need tenant/account/user isolation can use these optional tables. The persistence contracts only require `tenantId`/`accountId`/`userId` strings on records.

| Table | Key columns |
| --- | --- |
| `prism_tenants` | `id`, `name`, `created_at`, `metadata` |
| `prism_accounts` | `id`, `tenant_id`, `name`, `created_at`, `metadata` |
| `prism_users` | `id`, `tenant_id`, `account_id`, `name`, `created_at`, `metadata` |

### Agent definitions

| Table | Key columns |
| --- | --- |
| `prism_agent_definitions` | `id` PK, `name`, `version`, `source`, `agent_definition` JSONB, `tenant_id`, `account_id`, `user_id`, `created_at`, `created_by`, `metadata` JSONB |

The `agent_definition` column stores the `AgentDefinition` shape: name, description, model, tools, skills, context, system prompt, instructions, loop, and metadata. It never stores provider credentials, resolvers, or provider instances.

### Sessions

| Table | Key columns |
| --- | --- |
| `prism_sessions` | `id` PK, `tenant_id`, `account_id`, `user_id`, `parent_session_id`, `agent_definition_id`, `agent_definition_version`, `created_at`, `updated_at`, `expires_at`, `retention_policy_id`, `metadata` JSONB |

### Branches

| Table | Key columns |
| --- | --- |
| `prism_branches` | `id` PK, `session_id` FK, `name`, `root_entry_id`, `parent_branch_id`, `leaf_entry_id`, `created_at`, `metadata` JSONB |

A branch leaf (`leaf_entry_id`) is the current entry id for that branch. Rebuild logic walks `parent_id` from the leaf back to the root.

### Session entries

| Table | Key columns |
| --- | --- |
| `prism_session_entries` | `id` PK, `session_id` FK, `parent_id`, `run_id`, `timestamp`, `kind`, `schema_version`, `message` JSONB, `event` JSONB, `model` JSONB, `previous_model` JSONB, `label`, `summary`, `data` JSONB, `metadata` JSONB |

Maps directly to `SessionEntry`. `kind` is one of the `SessionEntryKind` values. `schema_version` defaults to `1`. `parent_id` may be null for the root entry of a session.

`SessionAppendOptions.idempotencyKey` is not part of `SessionEntry`; store it in an adapter-owned side table when you need durable retry detection:

| Table | Key columns |
| --- | --- |
| `prism_session_append_idempotency` | `session_id`, `expected_parent_id`, `idempotency_key`, `entry_id`, `created_at`, `tenant_id`, `account_id`, `user_id` |

Use a unique key on `(session_id, expected_parent_id, idempotency_key)` (plus tenant/account columns when scoped). That matches the runtime retry shape: the same run may append several entries with one run-level key, but each append has a different `expectedParentId` as the leaf advances.

### Runs

| Table | Key columns |
| --- | --- |
| `prism_runs` | `id` PK, `session_id` FK, `branch_id`, `agent_definition_id`, `agent_definition_version`, `status`, `started_at`, `finished_at`, `model` JSONB, `provider`, `idempotency_key`, `abort_reason`, `error` JSONB, `tenant_id`, `account_id`, `user_id`, `metadata` JSONB |

`status` values: `queued`, `running`, `succeeded`, `failed`, `aborted`. Hosts that do not queue runs will only see `running`, `succeeded`, `failed`, and `aborted` from the runtime.

### Agent event ledger

| Table | Key columns |
| --- | --- |
| `prism_agent_events` | `id` PK, `session_id` FK, `run_id`, `entry_id`, `sequence`, `type`, `timestamp`, `event` JSONB, `redacted` boolean, `tenant_id`, `account_id`, `user_id`, `metadata` JSONB |

The `event` JSONB stores a redacted `AgentEvent`. The `sequence` column is an implementation aid for stable ordering when timestamps collide. Set `redacted = true` after applying a `SecretRedactor`.

### Tool calls

| Table | Key columns |
| --- | --- |
| `prism_tool_calls` | `id` PK, `session_id` FK, `run_id`, `entry_id`, `tool_call_id`, `name`, `arguments` JSONB, `result` JSONB, `status`, `reason`, `progress` JSONB, `progress_metadata` JSONB, `progress_at`, `started_at`, `finished_at`, `redacted` boolean, `tenant_id`, `account_id`, `user_id`, `metadata` JSONB |

`status` values: `started`, `finished`, `error`, `blocked`. Progress snapshots are stored with status `started` and the `progress`/`progress_metadata`/`progress_at` columns populated. `arguments` and `result` must be redacted before storage when they contain secrets.

### Usage

| Table | Key columns |
| --- | --- |
| `prism_usage` | `id` PK, `session_id` FK, `run_id`, `entry_id`, `scope`, `turn`, `attempt`, `usage` JSONB, `recorded_at`, `tenant_id`, `account_id`, `user_id`, `metadata` JSONB |

The `usage` JSONB stores the `Usage` shape: input/output/total/cache tokens, cost, and currency.

### Retention policies

| Table | Key columns |
| --- | --- |
| `prism_retention_policies` | `id` PK, `tenant_id`, `account_id`, `user_id`, `name`, `max_age_days`, `max_entries_per_session`, `max_total_bytes`, `archive_store`, `applied_kinds` JSONB, `created_at`, `metadata` JSONB |

`applied_kinds` is a JSON array of `SessionEntryKind` values; null means all kinds.

### Migrations

| Table | Key columns |
| --- | --- |
| `prism_migrations` | `id` PK, `name`, `version`, `applied_at`, `applied_by`, `checksum`, `metadata` JSONB |

Prism does not run migrations; hosts own migration tooling and use this table to record applied changes.

## Shared schema model and migration contract

Adapter packages import the shared model instead of copying table names piecemeal:

```ts
import {
  createPersistenceSchemaModel,
  createPersistenceMigrationContract,
  assertPersistenceSchemaModel,
  assertAdapterSchemaMatchesModel,
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
  getPersistencePaginationCursors,
  PARAMETERIZED_QUERY_GUIDANCE,
} from "@arnilo/prism/testing/persistence-schema";
import { assertSessionStoreConforms, runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";
import { assertRunLedgerConforms, runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";

const model = createPersistenceSchemaModel();
assertPersistenceSchemaModel(model);

await runSessionStoreConformance(() => createStore(testDatabase), { exerciseReopen: true });
await runRunLedgerConformance(() => createLedger(testDatabase), { exerciseReopen: true });
```

| Primitive | Purpose |
| --- | --- |
| `PersistenceSchemaModel` | Versioned table/column/index model covering sessions, entries, parent chain, idempotency side table, runs, events, tool calls, usage, tenant columns, and `prism_migrations` |
| `createPersistenceMigrationContract()` | Strictly increasing migration steps, `prism_migrations` recording, advisory-lock guidance, and least-privilege migration/runtime role guidance |
| `getPersistencePaginationCursors()` | Indexed `(session_id, timestamp, id)`, `(run_id, sequence)`, `(run_id, recorded_at, id)` cursor shapes that avoid offset scans |
| `assertPersistenceQueryPaginationConforms()` | Generic cursor pagination fixture for `queryEntries` |
| `assertTenantScopedQueryIsolation()` | Tenant-filtered reads must not leak rows or primary-id collisions across tenants |
| `PARAMETERIZED_QUERY_GUIDANCE` | Values are always bound parameters; only validated identifiers may be quoted |

Dialect-local SQL remains in optional adapter packages. The shared model is the contract both adapters must satisfy before release.

## Adapter readiness checklist

Before using a host database adapter in production:

- Implement `SessionStore.append()` transactionally with duplicate-id rejection, `expectedParentId` existence validation, and `(session_id, expected_parent_id, idempotency_key)` retry deduplication.
- Implement `readBranchPath(query)` for large sessions and run `assertSessionStoreConforms(adapter, { exerciseReadBranchPath: true })` from `@arnilo/prism/testing/session-store-conformance` in adapter tests.
- Implement `RunLedger` writes for runs, events, tool calls, and usage if the host needs audit replay, billing, or observability; query those rows through `ProductionPersistenceStore` or host-specific read APIs.
- Prove secrets stay out of durable rows: no provider credentials, provider instances, credential resolvers, API keys, raw provider clients, or unredacted payloads in session, branch, ledger, usage, idempotency, migration, or definition records.
- Keep Prism core dependency-free: no ORM, migrations, connection pool, or database driver belongs in `@arnilo/prism`.

## Adapter performance guidance

Database adapters should keep Prism reads and writes cursor-shaped and indexed. Do not add an ORM or adapter dependency to Prism core; implement this in host code.

Minimum production guidance:

- **Branch context:** implement `SessionStore.readBranchPath(query)` with an ancestor query / recursive CTE. Treat `SessionStore.list(sessionId)` as an O(n) development fallback only.
- **Cursor pagination:** every `query*` method should honor `cursor`, `limit`, and `order`. Encode cursors from indexed columns such as `(timestamp, id)`, `(started_at, id)`, `(recorded_at, id)`, or `(run_id, sequence)`; never use offset pagination for long sessions.
- **Batch appends:** `SessionStore.append()` is single-entry because the runtime advances one branch leaf at a time. Hosts may batch inside their DB/ledger adapters for `RunLedger` rows, but the adapter must preserve per-run event order and must not acknowledge writes before durable enqueue/commit.
- **Event sequence allocation:** allocate a monotonic `sequence` per `run_id` when inserting `prism_agent_events`. Use it with `run_id` for stable event timeline pagination when timestamps collide.
- **Run/event/usage query shapes:** runs page by `(session_id, started_at, id)` or `(branch_id, started_at, id)`; events page by `(run_id, sequence)` or `(session_id, timestamp, id)`; usage pages by `(run_id, recorded_at, id)` or `(session_id, recorded_at, id)`.
- **Host-owned sizing:** hosts own connection pools, transaction timeouts, page-size caps, queue/batch size, retention jobs, partitioning, and tenant/account/user isolation. Prism does not guess production limits.
- **Security:** persist redacted `SessionEntry`, `AgentEventRecord`, `ToolCallRecord`, and `UsageRecord` data only. Never store provider objects, credential resolvers, API keys, or raw provider clients.

## Indexes

Recommended indexes for the reference schema. Hosts should add DB-specific partial or expression indexes as needed.

| Table | Index | Supports |
| --- | --- | --- |
| `prism_sessions` | `(tenant_id, account_id, user_id, created_at)` | tenant-scoped session listing |
| `prism_sessions` | `(expires_at)` | retention expiry scans |
| `prism_sessions` | `(agent_definition_id, agent_definition_version)` | definition-version usage |
| `prism_branches` | `(session_id, name)` | named branch lookup |
| `prism_branches` | `(leaf_entry_id)` | leaf-to-branch resolution |
| `prism_session_entries` | `(session_id, parent_id)` | parent existence checks and child lookups |
| `prism_session_entries` | `(session_id, kind, timestamp)` | kind-filtered entry listing |
| `prism_session_entries` | `(session_id, run_id, timestamp)` | run-scoped entry listing |
| `prism_session_entries` | `(session_id, timestamp, id)` | cursor pagination |
| `prism_session_entries` | `(session_id, id)` | append parent validation and recursive branch reads |
| `prism_session_append_idempotency` | unique `(session_id, expected_parent_id, idempotency_key)` | append retry deduplication |
| `prism_runs` | `(session_id, started_at)` | run history |
| `prism_runs` | `(branch_id, started_at)` | branch-scoped runs |
| `prism_runs` | `(status, finished_at)` | retention/completion scans |
| `prism_agent_events` | `(session_id, timestamp, id)` | event stream pagination |
| `prism_agent_events` | `(run_id, timestamp, id)` | run event stream |
| `prism_agent_events` | `(run_id, sequence)` | stable per-run event timeline pagination |
| `prism_agent_events` | `(session_id, type, timestamp)` | event-type filtering |
| `prism_agent_events` | `(entry_id)` | entry-to-event lookup |
| `prism_tool_calls` | `(session_id, name, started_at)` | tool usage by name |
| `prism_tool_calls` | `(run_id, started_at)` | run tool-call listing |
| `prism_tool_calls` | `(tool_call_id)` | deduplication / replay |
| `prism_usage` | `(session_id, recorded_at)` | usage pagination |
| `prism_usage` | `(session_id, scope, recorded_at)` | scope-safe billing/aggregate queries |
| `prism_usage` | `(run_id, recorded_at)` | run usage |
| `prism_agent_definitions` | `(name, version)` | definition lookup |
| `prism_retention_policies` | `(tenant_id, account_id, user_id)` | policy listing |
| `prism_migrations` | `(name, version)` | applied-migration uniqueness |

Run idempotency keys are written by the runtime into `RunRecord.idempotencyKey` and the `prism_runs.idempotency_key` column. Hosts should add a unique index on `(tenant_id, idempotency_key)` or `(account_id, idempotency_key)` in `prism_runs` for run-level deduplication. Append idempotency uses the separate `prism_session_append_idempotency` unique key above because `SessionEntry` itself does not carry `idempotencyKey`.

## Conditional append transaction pattern

Implement `SessionStore.append(entry, options)` in one DB transaction:

1. If `options.idempotencyKey` exists, insert `(session_id, expected_parent_id, idempotency_key, entry_id)` into `prism_session_append_idempotency`. A unique-key hit means an exact retry; raise/return a `SessionAppendConflictError` with `idempotencyDuplicate: true` (or no-op if your adapter deliberately chooses idempotent success).
2. If `options.expectedParentId` exists, verify that `(session_id, id)` exists in `prism_session_entries`. If missing, rollback and raise `SessionAppendConflictError` with `expectedParentId`.
3. Insert the `prism_session_entries` row. A duplicate entry id should fail the transaction.
4. Optionally update a `prism_branches.leaf_entry_id` row with a compare-and-swap if the host wants one-writer linear branches. Prism's built-in stores use existence-validation so checkout/fork can intentionally create two children of the same existing parent.

This keeps append guards O(1) with indexes, prevents dangling parent links, and deduplicates exact retries without forcing every branch to be linear.

## Run, event, and usage query shapes

Use cursor columns that match query filters:

```sql
-- Run history for one session.
CREATE INDEX prism_runs_session_started_idx ON prism_runs (session_id, started_at, id);

-- Stable event pagination within one run.
CREATE INDEX prism_agent_events_run_sequence_idx ON prism_agent_events (run_id, sequence);

-- Usage totals / billing reads by run.
CREATE INDEX prism_usage_run_recorded_idx ON prism_usage (run_id, recorded_at, id);
```

For NoSQL stores, use equivalent partition/sort keys: partition by `session_id` or `run_id`; sort by `started_at`, `recorded_at`, or event `sequence`. Keep page sizes capped by host policy. `total` is optional because counting large partitions can be expensive.

## Branch reads: no full-session scan

Implement `readBranchPath(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>` on database-backed stores. It should return the selected leaf's ancestor chain (any order is allowed; Prism's helper re-walks and orders it). Use one recursive CTE / ancestor query, for example:

```sql
WITH RECURSIVE branch AS (
  SELECT * FROM prism_session_entries
  WHERE session_id = $1
    AND id = COALESCE($2, (SELECT leaf_entry_id FROM prism_branches WHERE session_id = $1 LIMIT 1))
  UNION ALL
  SELECT parent.*
  FROM prism_session_entries parent
  JOIN branch child ON child.parent_id = parent.id
  WHERE parent.session_id = $1
)
SELECT * FROM branch;
```

Use `cursor`/`limit` when an adapter pages very long branches. Do not implement common runtime reads by `list(sessionId)` followed by an in-memory parent walk for large production sessions; that is the development fallback only.

## Retention policies

A retention policy is a host-managed rule attached to sessions via `retention_policy_id`. Enforcement is host-owned and typically runs as a background job:

1. Select policies whose `max_age_days`, `max_entries_per_session`, or `max_total_bytes` thresholds are exceeded.
2. For each affected session, delete or archive entries older than the policy age, beyond the entry count, or over the byte budget.
3. Respect `applied_kinds` — only delete kinds listed in the policy (null means all kinds).
4. Compact or soft-delete sessions whose `expires_at` has passed.
5. Write audit metadata to the migration or host audit log; do not delete the policy row unless explicitly requested.

Retention jobs should not run inside the agent/session runtime. They are a host concern.

## Migrations

Hosts own schema migrations. Prism publishes only the TypeScript contracts; no DDL is generated or executed by the core library. Recommended migration practices:

- Use a sequential or timestamped migration naming convention.
- Store applied migrations in `prism_migrations` with `name`, `version`, `applied_at`, `applied_by`, and `checksum`.
- Make entry-kind and schema-version changes additive when possible; new kinds and versions fail closed in the JSONL parser, so DB schemas should accept the same additive expansion.
- Index new query columns before deploying code that uses them.
- Back-fill redacted flags and ownership columns before enforcing tenant isolation.

## NoSQL mapping notes

For document or wide-column stores, map the relational tables above to the store's native partitioning model:

- **Partition key:** `session_id` is usually the best partition key. For multi-tenant workloads, use a composite partition key (`tenant_id`, `session_id`) or a synthetic `tenant_session_id`.
- **Sort/range key:** Use `timestamp` + `id` for entries and events; use `started_at` + `id` for runs and tool calls. This supports cursor pagination and branch rebuild.
- **Global secondary indexes / collections:** Duplicate run, kind, type, and name dimensions into GSIs or secondary collections so queries by `run_id`, `kind`, `type`, or `tool_call_id` remain efficient without full scans.
- **JSON payloads:** Store `AgentEvent`, `ToolResult`, `Message`, `Usage`, `AgentDefinition`, and `data`/`metadata` values as nested documents or serialized JSONB. Redact sensitive fields before writing.
- **Branches:** In document stores, a branch can be a lightweight document keyed by `leaf_entry_id` that points to the session and root. Rebuild still walks `parent_id` links in entries.
- **Retention:** Use TTL columns or scheduled map-reduce/streaming jobs. TTL on `expires_at` or entry timestamps is the simplest NoSQL implementation.

The Node JSONL session store is a single-process development adapter. It has no cross-process locking, no migrations, no retention enforcement, and no tenant isolation. Do not use it as a production multi-writer store.

## Request/response example

```json
{
  "sessionId": "session-1",
  "runId": "run-7",
  "kind": ["message", "event"],
  "fromTimestamp": "2024-01-01T00:00:00Z",
  "toTimestamp": "2024-12-31T23:59:59Z",
  "tenantId": "tenant-a",
  "limit": 50,
  "order": "desc"
}
```

Example page:

```json
{
  "items": [
    { "id": "e3", "sessionId": "session-1", "kind": "message", "timestamp": "2024-06-15T10:00:00Z" }
  ],
  "nextCursor": "eyJpZCI6ImUzIn0=",
  "total": 128
}
```

## Implementation example

```ts
import type {
  ProductionPersistenceStore,
  SessionEntryQuery,
  SessionBranchRead,
  PersistencePage,
  SessionEntry,
} from "@arnilo/prism";

const dbStore: ProductionPersistenceStore = {
  name: "host-postgres-store",
  async queryEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>> {
    // Host owns SQL/NoSQL implementation.
    return { items: [], nextCursor: undefined };
  },
  async readBranchPath(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>> {
    // Use one recursive/ancestor query, not list(sessionId) + in-memory scan.
    return { items: [], nextCursor: undefined };
  },
  // ...other query methods
};
```

## Extension and configuration notes

- `ProductionPersistenceStore` is an optional extension point. The runtime does not require it.
- `ProductionPersistenceStore.checkpoints?: CheckpointStore` exposes generic versioned save/load/bounded-list/delete with compare-and-swap and fencing tokens, without workflow vocabulary.
- `ProductionPersistenceStore.leases?: LeaseStore` exposes atomic acquire/renew/release/get with opaque claim tokens, expiries, ownership scope, and monotonic fencing tokens.
- `ProductionPersistenceStore.feedback?: RunFeedbackStore` exposes immutable append, bounded owned query, and owned deletion. First-party adapters store migration-003 rows in `prism_run_feedback`, FK-link `run_id`, and index owner/run/trace creation cursors.
- Hosts choose the database, schema, transaction, and indexing strategy. The contracts specify query and checkpoint capability shapes.
- `SessionStore` (`append`/`list`/`get`/optional `readBranchPath`) can be implemented on top of `ProductionPersistenceStore` or kept separate.
- Cursor values and idempotency keys are host-defined and opaque to Prism.
- First-party SQLite/PostgreSQL adapters expose `persistence.checkpoints` and `persistence.leases`, backed by package-owned `prism_checkpoints` / `prism_leases` tables. `@arnilo/prism-workflows` consumes them for durable resume, human suspension, multi-process coordination, Phase 11 schedule records/fire leases, shared state, and replay lineage; workflow code owns no SQL table. `suspended`/`denied`, schedules, state history, and replay lineage remain namespaces/categories plus bounded checkpoint JSON values, so Phases 8 and 11 need no database migration.

## Security and performance notes

- **No credentials in storage.** The contracts never include `CredentialResolver`, `AIProvider`, `ProviderResolver`, provider API keys, or credential values.
- **Redact before storage.** Runtime session entries are redacted before `SessionStore.append`; `AgentEventRecord.event` and `ToolCallRecord.result` may contain secrets, so hosts must redact them (for example with `redactAgentEvent()` and a `SecretRedactor`) before writing to durable storage and set `redacted: true`.
- **Tenant isolation.** `OwnershipScope` fields are available on records and queries, but enforcement is the host's responsibility. First-party feedback stores require tenant plus account/user and use exact run ownership on append, query, and delete.
- **Feedback retention/deletion.** Comments, tags, and metadata are redacted and bounded before insert. `RunFeedbackStore.delete()` provides explicit erasure; deleting a run cascades its feedback in first-party SQL schemas. Apply host retention policy to `created_at`.
- **Pagination and branch reads.** Every query supports `cursor`/`limit`/`order` so hosts can avoid full-table or full-session scans. Loading an entire large session into memory to serve a provider context is an anti-pattern; implement `readBranchPath` and use branch-relevant filters / recursive ancestor queries.
- **Indexes.** Production schemas should index `sessionId`, `runId`, `parentId`, `leafId`, timestamps, tenant/account/user, event type, entry kind, and feedback owner/run/trace creation cursors. See the reference indexes above.

## Related APIs

- [Session store conformance](session-store-conformance.md): executable adapter baseline for append/idempotency/conflict/branch invariants.
- [Migration guide](migration.md): before/after shapes for moving from in-memory/JSONL to this contract.
- [Performance limits](performance.md): production sizing, subscriber queues, branch-read limits, and database adapter guidance.
- [Session stores and branching](session-stores-and-branching.md): `SessionStore`, `SessionEntry`, branch helpers, and runtime branch semantics.
- [Node JSONL session store](node-jsonl-session-store.md): development-only file adapter; not for production multi-writer storage.
- [Agent/session runtime](agent-session-runtime.md): sessions, runs, and event emission.
- [Agent events](agent-events.md): `AgentEvent` variants and redaction.
- [Tools](tools.md): `ToolResult`, `ToolCallContent`, and tool execution events.
- [Public contracts](public-contracts.md): full public contract inventory.
- [Workflows](workflows.md): package-local durable checkpoint adapters on shared SQLite/Postgres handles.
