# SQLite persistence

## What it does

The optional `@arnilo/prism-session-store-sqlite` package ships a production-oriented SQLite adapter that implements:

- `SessionStore` — atomic `append` / `list` / `get` / `readBranchPath`
- `RunLedger` — durable run, event, tool-call, and usage rows
- `ProductionPersistenceStore` — cursor-paginated `query*` reads plus generic `checkpoints` and atomic `leases` capabilities

Factory:

- `createSqlitePersistence(options)`
- `SqlitePersistenceOptions`
- `SqlitePersistence.close()`

The adapter uses `better-sqlite3@^12.11.1`, enables WAL and foreign keys, applies versioned migrations from the shared Plan 056 schema model, and passes the full session-store and run-ledger conformance suites including process reopen.

## When to use it

Use this package when you want a small, file-backed persistence layer on Node without operating a database server:

- local CLI tools and desktop hosts
- single-writer or low-concurrency deployments
- integration tests that need durable reopen semantics

Do **not** use it as a substitute for PostgreSQL when you need heavy multi-writer concurrency, server-side pooling, or managed TLS. See [`@arnilo/prism-session-store-postgres`](postgres-persistence.md) for that path.

## Inputs / request

```ts
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
```

| Field | Type | Purpose |
| --- | --- | --- |
| `filename` | `string` | SQLite database path. Use `:memory:` for ephemeral tests. |
| `wal` | `boolean` | Enable WAL journal mode. Defaults to `true`. |
| `busyTimeoutMs` | `number` | SQLite `busy_timeout` in milliseconds. Defaults to `5000`. |
| `feedbackRedactor` | `SecretRedactor` | Optional redaction for feedback comment/tags/metadata before insert. |
| `fileMode` | `number` | Unix file mode for newly created database files. Defaults to `0o600`. |
| `database` | `Database` | Advanced: supply an existing `better-sqlite3` handle (caller owns lifecycle). |

## Outputs / response / events

`createSqlitePersistence()` returns one object implementing the three persistence contracts plus generic checkpoints and leases:

| Method group | Behavior |
| --- | --- |
| `SessionStore.append` | One transaction per append: parent existence check, idempotency dedup, duplicate-id rejection, entry insert. |
| `SessionStore.list` / `get` | Indexed reads by `session_id` and primary key. |
| `SessionStore.readBranchPath` | Recursive ancestor query from `leafId` (or latest leaf) in root→leaf order. |
| `RunLedger.append*` | Inserts run/event/tool/usage rows; events receive monotonic per-run `sequence` values. |
| `ProductionPersistenceStore.query*` | Parameterized cursor pagination on indexed columns. |
| `checkpoints` | Generic versioned `CheckpointStore` backed by `prism_checkpoints`; ownership, CAS/fencing checks, bounded pagination, and workflow suspended/denied/schedule/state/replay values without a schema migration. |
| `leases` | Atomic `LeaseStore` backed by `prism_leases`; database-clock expiry, opaque renew/release token, monotonic takeover fence. |
| `close()` | Closes the underlying database when the adapter opened it. |

Migrations run automatically on open and are idempotent across reopen.

## Request/response example

```json
{
  "filename": "./prism.db",
  "wal": true,
  "busyTimeoutMs": 5000,
  "fileMode": 384
}
```

## Implementation example

```ts
import { createAgentSession } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";

const persistence = createSqlitePersistence({ filename: "./prism.db" });

await runSessionStoreConformance(
  () => createSqlitePersistence({ filename: "./prism.db" }),
  { exerciseReadBranchPath: true, exerciseReopen: true },
);

const session = createAgentSession({
  sessionStore: persistence,
  runLedger: persistence,
});

await session.run("hello");
persistence.close();
```

For resume/timeline flows, use `queryRuns`, `queryEvents`, `queryToolCalls`, and `queryUsage` the same way as the reference mock in [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts).

## Extension and configuration notes

- The package is optional and workspace-local; `@arnilo/prism` core has no SQLite dependency.
- Hosts choose the database path and own backup, retention enforcement, and filesystem permissions.
- `SessionAppendOptions` idempotency rows are durable in `prism_session_append_idempotency` and survive reopen.
- Schema version **3** applies `001_init`, additive `002_usage_scope`, and `003_run_feedback`. Migration 003 adds immutable `prism_run_feedback` rows with run FK/cascade deletion and owner/run/trace cursor indexes. `persistence.feedback` validates exact run ownership, bounds/redacts through optional `feedbackRedactor`, queries bounded pages, and deletes only exact-owned IDs. PostgreSQL shares the same model with dialect-local DDL.
- Pass an existing `better-sqlite3` `Database` via `database` when your host already manages connections.

## Security and performance notes

- **Parameterized SQL only.** Session ids, idempotency keys, tenant ids, and JSON payloads are bound parameters.
- **File ownership.** Create database files on a host-controlled path with restrictive permissions (`0600` default on Unix via `fileMode`).
- **No path interpolation.** The adapter opens exactly the caller-supplied `filename`; it does not expand environment variables or discover paths.
- **Redaction upstream.** Event and tool-call payloads may contain secrets; redact before ledger writes. The adapter does not scan or rewrite row contents.
- **WAL + busy timeout.** WAL is enabled by default; busy timeout defaults to 5 seconds. This meets the Plan 056 local workload target but SQLite still serializes writers — prefer PostgreSQL for high write concurrency.
- **Indexed operations.** Append, parent validation, idempotency dedup, branch reads, and pagination use the indexes documented in [Database persistence](database-persistence.md); normal paths avoid whole-database scans.
- **Tenant isolation.** `tenant_id` / `account_id` / `user_id` columns on run and ownership tables participate in query filters; hosts must still scope writes correctly.

## Related APIs

- [Database persistence](database-persistence.md): shared schema model, conditional append pattern, indexes.
- [Session store conformance](session-store-conformance.md): `assertSessionStoreConforms` / `runSessionStoreConformance`.
- [Run ledger conformance](run-ledger-conformance.md): `assertRunLedgerConforms` / `runRunLedgerConformance`.
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): package matrix and threat model.
- [Node JSONL session store](node-jsonl-session-store.md): dev-only single-process alternative.
- [Workflows](workflows.md): adapt `persistence.checkpoints` and pass `persistence.leases` to `createWorkflowCoordinator()` and `createWorkflowSchedules()` for durable background execution and schedules.
- [Migration guide](migration.md): moving from JSONL/in-memory to database-backed persistence.
