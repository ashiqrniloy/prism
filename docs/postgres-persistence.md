# PostgreSQL persistence

## What it does

The optional `@arnilo/prism-session-store-postgres` package ships a production-oriented PostgreSQL adapter that implements:

- `SessionStore` — atomic `append` / `list` / `get` / `readBranchPath`
- `RunLedger` — durable run, event, tool-call, and usage rows
- `ProductionPersistenceStore` — cursor-paginated `query*` reads plus generic `checkpoints` and atomic `leases` capabilities

Factory:

- `createPostgresPersistence(options)` (async)
- `PostgresPersistenceOptions`
- `PostgresPersistence.close()` (async; ends adapter-owned pools only)

The adapter uses `pg@^8.22.0`, applies versioned migrations from the shared Plan 056 schema model inside a transaction guarded by `pg_advisory_xact_lock`, validates/quotes schema identifiers, and passes the full session-store and run-ledger conformance suites when `PRISM_TEST_POSTGRES_URL` is set.

## When to use it

Use this package when you need server-backed persistence with pooled connections and multi-writer concurrency:

- hosted SaaS agents with PostgreSQL as the system of record
- managed cloud databases (RDS, Cloud SQL, Neon, Supabase, etc.)
- CI integration tests against a real PostgreSQL service

Prefer [`@arnilo/prism-session-store-sqlite`](sqlite-persistence.md) for local CLI tools, single-writer workloads, and network-free default tests. This adapter stores sessions/runs, not semantic vectors; use the separate [`@arnilo/prism-memory` pgvector path](working-and-semantic-memory.md), which rejects non-finite vectors before SQL, when vector recall is needed.

## Inputs / request

```ts
import { Pool } from "pg";
import { createPostgresPersistence } from "@arnilo/prism-session-store-postgres";
```

| Field | Type | Purpose |
| --- | --- | --- |
| `pool` | `Pool` | Existing `pg` pool (caller owns lifecycle). |
| `connectionString` | `string` | Create an adapter-owned bounded pool when `pool` is omitted. |
| `schema` | `string` | PostgreSQL schema for Prism tables. Defaults to `"prism"`. Validated and double-quoted. |
| `poolMax` | `number` | Maximum pool size for adapter-owned pools. Defaults to `10`. |
| `feedbackRedactor` | `SecretRedactor` | Optional redaction for feedback comment/tags/metadata before insert. |
| `poolConfig` | `PoolConfig` | Additional `pg` options (TLS, idle timeout, application name, etc.). |

Hosts own TLS (`ssl` in `poolConfig`), credentials, connection limits, and backup/retention enforcement.

## Outputs / response / events

`createPostgresPersistence()` returns one object implementing the three persistence contracts plus generic checkpoints and leases:

| Method group | Behavior |
| --- | --- |
| `SessionStore.append` | One transaction per append: parent existence check, idempotency dedup, duplicate-id rejection, entry insert. |
| `SessionStore.list` / `get` | Indexed reads by `session_id` and primary key. |
| `SessionStore.readBranchPath` | Recursive ancestor query from `leafId` (or latest leaf) in root→leaf order. |
| `RunLedger.append*` | Inserts run/event/tool/usage rows; events receive monotonic per-run `sequence` values. |
| `ProductionPersistenceStore.query*` | Parameterized cursor pagination on indexed columns with tenant/account/user filters. |
| `checkpoints` | Generic versioned `CheckpointStore` backed by `prism_checkpoints`; ownership, CAS/fencing checks, bounded pagination, and workflow suspended/denied/schedule/state/replay values without a schema migration. |
| `leases` | Atomic `LeaseStore` backed by `prism_leases`; database-clock expiry, opaque renew/release token, monotonic takeover fence. |
| `close()` | Ends the pool when the adapter created it from `connectionString`. |

Migrations run automatically on open and are idempotent across reopen. Concurrent setup uses per-schema advisory transaction locks. While holding that lock, startup verifies ordered contract name/version/SHA-256 rows and full schema-v3 `information_schema`/catalog shape (all required tables, columns/types/nullability/defaults, PK/unique/FK keys, and named indexes) before any runtime write. A complete legacy 0.0.5 history with all `checksum` values `NULL` is shape-verified then backfilled transactionally once. Unknown, duplicate, out-of-order, partial-legacy, checksum, or shape drift rejects open; restore or apply reviewed DDL rather than editing migration rows.

## Request/response example

```json
{
  "connectionString": "postgres://app:***@db.example.com:5432/prism",
  "schema": "prism",
  "poolMax": 10,
  "poolConfig": {
    "ssl": { "rejectUnauthorized": true }
  }
}
```

## Implementation example

```ts
import { Pool } from "pg";
import { createAgentSession } from "@arnilo/prism";
import { createPostgresPersistence } from "@arnilo/prism-session-store-postgres";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: { rejectUnauthorized: true },
});

const persistence = await createPostgresPersistence({ pool, schema: "prism" });

await runSessionStoreConformance(
  async () => createPostgresPersistence({ pool, schema: "prism" }),
  { exerciseReadBranchPath: true, exerciseReopen: true },
);

const session = createAgentSession({
  sessionStore: persistence,
  runLedger: persistence,
});

await session.run("hello");
await persistence.close();
await pool.end();
```

Live conformance and integration tests:

```bash
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres --workspace @arnilo/prism-session-store-postgres
```

## Extension and configuration notes

- The package is optional and workspace-local; `@arnilo/prism` core has no PostgreSQL dependency.
- Schema names must match `^[a-zA-Z_][a-zA-Z0-9_]*$`; the adapter quotes them and never interpolates user values into identifier positions.
- `SessionAppendOptions` idempotency rows are durable in `prism_session_append_idempotency` and survive reopen.
- Schema version **3** applies `001_init`, additive `002_usage_scope`, and `003_run_feedback`. Migration 003 adds immutable `prism_run_feedback` rows with run FK/cascade deletion and owner/run/trace cursor indexes. `persistence.feedback` validates exact run ownership, bounds/redacts through optional `feedbackRedactor`, queries bounded pages, and deletes only exact-owned IDs. SQLite shares the same model with dialect-local DDL.
- Pass an existing `pg` `Pool` when your host already manages pooling, TLS, and credential rotation.

## Security and performance notes

- **Parameterized SQL only.** Session ids, idempotency keys, tenant ids, and JSON payloads are bound parameters (`$1`, `$2`, …).
- **Identifier validation.** Configurable `schema` is validated and double-quoted; table names are fixed constants in adapter SQL.
- **TLS and credentials.** Configure via `pg` `Pool` / `PoolConfig`; the adapter does not read environment variables unless the host passes them into `connectionString` or `poolConfig`.
- **Redaction upstream.** Event and tool-call payloads may contain secrets; redact before ledger writes. The adapter does not scan or rewrite row contents.
- **Optional batching.** PostgreSQL remains write-through by default. Hosts may wrap its ledger with core `createBatchedRunLedger()`; the bounded FIFO retains a failed head record and propagates flush failure instead of silently acknowledging it.
- **Bounded pool.** Adapter-owned pools default to `max: 10`. Hosts with heavy concurrency should supply their own pool sizing.
- **Indexed operations.** Append, parent validation, idempotency dedup, branch reads, and pagination use the indexes documented in [Database persistence](database-persistence.md); normal paths avoid sequential scans.
- **Migration locking.** `pg_advisory_xact_lock` prevents concurrent migration races when multiple processes open the adapter at once. Startup catalog reads are bounded metadata queries, not application-row scans.
- **Tenant isolation.** `tenant_id` / `account_id` / `user_id` columns participate in query filters; hosts must still scope writes correctly.
- **Benchmark target.** Indexed append + paginated branch read on a warm pool should stay under **50 ms p95** for local/CI-sized datasets (≤100k entries per session); measure with your pool size and hardware before production sizing.

## Related APIs

- [Database persistence](database-persistence.md): shared schema model, conditional append pattern, indexes.
- [SQLite persistence](sqlite-persistence.md): file-backed alternative for local/single-writer hosts.
- [Session store conformance](session-store-conformance.md): `assertSessionStoreConforms` / `runSessionStoreConformance`.
- [Run ledger conformance](run-ledger-conformance.md): `assertRunLedgerConforms` / `runRunLedgerConformance`.
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): package matrix and threat model.
- [Workflows](workflows.md): adapt `persistence.checkpoints` and pass `persistence.leases` to `createWorkflowCoordinator()` and `createWorkflowSchedules()` for durable background execution and schedules.
- [Working and semantic memory](working-and-semantic-memory.md): optional `@arnilo/prism-memory` PostgreSQL/pgvector working + semantic stores (separate from session/run persistence).
- [Migration guide](migration.md): moving from JSONL/in-memory to database-backed persistence.
