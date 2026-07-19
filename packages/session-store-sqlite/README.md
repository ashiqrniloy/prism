# @arnilo/prism-session-store-sqlite

Optional SQLite adapter implementing Prism `SessionStore`, `RunLedger`, `ProductionPersistenceStore`, owned `RunFeedbackStore`, generic `CheckpointStore`, and atomic `LeaseStore` over [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

## Install

```bash
npm install @arnilo/prism-session-store-sqlite @arnilo/prism better-sqlite3
```

## Usage

```ts
import { createAgentSession } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";

const persistence = createSqlitePersistence({ filename: "./prism.db" });

const session = createAgentSession({
  sessionStore: persistence,
  runLedger: persistence,
  // ...
});

// When finished:
persistence.close();
```

The same object satisfies session/run/query contracts and exposes `persistence.checkpoints` for versioned durable state and `persistence.leases` for database-clock claims with monotonic fencing. Workflow hosts pass that capability to `createWorkflowCheckpoints({ store })`.

Open validates ordered SHA-256 migration history and full schema-v3 table/column/type/null/default/key/index shape before runtime writes. Existing complete v0.0.5 rows with `checksum = NULL` are verified then backfilled in the same transaction; altered, partial, unknown, or mismatched history fails closed.

## Options

| Field | Default | Purpose |
| --- | --- | --- |
| `filename` | required | SQLite database path (`:memory:` for tests) |
| `wal` | `true` | Enable WAL journal mode |
| `busyTimeoutMs` | `5000` | SQLite busy timeout (milliseconds) |
| `fileMode` | `0o600` | Restrictive mode for newly created DB files on Unix |

## Conformance

The package runs the shared Prism conformance suites on every test:

- `@arnilo/prism/testing/session-store-conformance` — append/idempotency/conflict/branch/reopen
- `@arnilo/prism/testing/run-ledger-conformance` — run/event/tool/usage durability
- `@arnilo/prism/testing/persistence-schema` — pagination, tenant isolation, migration checksums, and normalized full-schema shape fixtures

## Security

- All values are bound as query parameters; never interpolate user input into SQL text.
- Hosts should create database files with restrictive permissions (`0600` on Unix; configurable via `fileMode`).
- Redact secrets before `append` / ledger writes; the adapter stores rows as provided.
- WAL improves concurrent readers but SQLite still prefers a single writer; use PostgreSQL for heavy multi-writer production workloads.
- Startup catalog checks inspect metadata only, not application rows. Repair drift with an explicit reviewed migration/restore; do not edit `prism_migrations` checksums to bypass verification.

See [SQLite persistence](../../docs/sqlite-persistence.md) and [Database persistence](../../docs/database-persistence.md).
