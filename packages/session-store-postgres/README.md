# @arnilo/prism-session-store-postgres

Optional PostgreSQL adapter implementing Prism `SessionStore`, `RunLedger`, `ProductionPersistenceStore`, generic `CheckpointStore`, and atomic `LeaseStore` over [`pg`](https://node-postgres.com/).

## Install

```bash
npm install @arnilo/prism-session-store-postgres @arnilo/prism pg
```

## Usage

```ts
import { Pool } from "pg";
import { createAgentSession } from "@arnilo/prism";
import { createPostgresPersistence } from "@arnilo/prism-session-store-postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const persistence = await createPostgresPersistence({ pool, schema: "prism" });

const session = createAgentSession({
  sessionStore: persistence,
  runLedger: persistence,
  // ...
});

// When finished:
await persistence.close();
// pool.end() if you own the pool
```

The same object satisfies session/run/query contracts and exposes `persistence.checkpoints` for versioned durable state and `persistence.leases` for database-clock claims with monotonic fencing. Workflow hosts pass that capability to `createWorkflowCheckpoints({ store })`.

## Options

| Field | Default | Purpose |
| --- | --- | --- |
| `pool` | — | Existing `pg` `Pool` (caller owns lifecycle) |
| `connectionString` | — | Create an adapter-owned pool when `pool` is omitted |
| `schema` | `"prism"` | PostgreSQL schema for Prism tables (validated/quoted) |
| `poolMax` | `10` | Maximum pool size when creating a pool from `connectionString` |
| `poolConfig` | — | Additional `pg` pool options (TLS, idle timeout, etc.) |

## Conformance

Offline unit tests run in the default `npm test` suite. Full session-store and run-ledger conformance against a live PostgreSQL instance runs when `PRISM_TEST_POSTGRES_URL` is set:

```bash
PRISM_TEST_POSTGRES_URL="postgres://user:pass@localhost:5432/prism_test" npm run test:postgres
```

Shared suites:

- `@arnilo/prism/testing/session-store-conformance` — append/idempotency/conflict/branch/reopen
- `@arnilo/prism/testing/run-ledger-conformance` — run/event/tool/usage durability
- `@arnilo/prism/testing/persistence-schema` — pagination and tenant isolation fixtures

## Security

- Schema/table identifiers are validated and double-quoted; values are always bound as query parameters.
- Hosts own TLS configuration, credentials, and pool sizing via `pg` `Pool` / `PoolConfig`.
- Redact secrets before `append` / ledger writes; the adapter stores rows as provided.
- Migrations use `pg_advisory_xact_lock` to prevent concurrent setup races.

See [PostgreSQL persistence](../../docs/postgres-persistence.md) and [Database persistence](../../docs/database-persistence.md).
