# `@arnilo/prism-store-postgres`

The PostgreSQL session store — sessions, runs, checkpoints, leases, feedback, lifecycle, and the
durable event source — as the Prism `store` slot, over `pg`.

## Install

```bash
prism add @arnilo/prism-store-postgres
```

```jsonc
// prism.config.json
{
  "packages": {
    "@arnilo/prism-store-postgres": {
      "config": { "url": "env:PRISM_DATABASE_URL", "schema": "prism" }
    }
  },
  "slots": { "store": "@arnilo/prism-store-postgres" }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string (`x-prism-secret`, ref only) | — | `env:`/`keyring:` ref for the connection string. One string, so a password never lands in the manifest; resolved through `prism.credentials.resolve` once at `setup`, and the value joins the agent's secret set. |
| `schema` | string | `prism` | Schema holding the Prism tables. Created by the migrations if it is absent. |
| `pool` | object | — | Pool tuning for the pool this package creates: `max` (default `10`), `connectionTimeoutMillis`, `idleTimeoutMillis`. Anything else (`ssl`, certificates, a caller-owned `Pool`) stays code-only. |

A missing `url` fails the package load with a field-naming error, and an unresolvable ref fails it
naming the ref — never a value. A literal connection string in an `x-prism-secret` field is refused
by the kernel's config check (`secret_literal`) before any connection.

## What it changes

- Claims the `store` slot (`prism.slots.store.provide`) with the whole persistence object, so
  `agent.sessions` (list, get, delete, search, title) and the run ledger light up.
- Runs the numbered schema migrations on open (advisory-locked, checksum-verified, idempotent) unless
  the caller passes `skipMigrations`. The companion stores are named exports:
  `createPostgresCheckpointStore`, `createPostgresLeaseStore`, `createPostgresPersistenceLifecycle`,
  `createPostgresAgentEventSource`, plus the DDL builders and migration appliers. Their contracts
  (`CheckpointStore`, `LeaseStore`) are the `checkpoints`/`leases` service contracts in
  `@arnilo/prism-workflows`; this package depends on them with `import type` only.
- Registers `prism.services.provide("checkpoints", …)` and `prism.services.provide("leases", …)` over the
  same pool the store slot uses, so a listed workflows package gets durable checkpoints and leases with
  no second connection.
- `listSessions` pages newest-first over `prism_sessions(updated_at, id)` with a keyset cursor, and
  filters ownership from the entries' `metadata` (the kernel's `entriesInScope` rule in SQL).
  `deleteSession` removes a session's entries, branches, runs, events, tool calls, usage, search rows,
  and idempotency keys in one transaction, after a fail-closed scope check.
- `mergeSessionMetadata` merges into the session record's `metadata` and bumps `version`, which is
  what the kernel's title path writes through.
- No `ON DELETE CASCADE` cleanup and no tenant table creation happen implicitly: migrations own the
  schema, this store owns the rows.

## Capabilities

`slot:store`, `credentials` (to resolve the `url` ref).

## Cost, security, failure behavior

- Each `append` is one transaction and one round trip; a page of `listSessions` is three queries
  (the page, its leaves, its message counts) regardless of page size. The default pool is 10
  connections (`DEFAULT_POOL_MAX`), created once per agent unless the host passes one.
- `pg` is a dependency of this package only and is loaded lazily: importing the package (or running an
  agent without it) never loads the driver. The kernel never names it.
- Every statement is parameterized; schema and table names are validated identifiers, never
  interpolated values. The connection string never appears in events, `inspect()`, status notes, or
  errors — a failed connection reports the host and the `pg` code, not the DSN.
- Fail closed: an unreachable database, an unresolvable `url` ref, or an unknown schema fails the
  package's `setup`, so the agent is not created (an `optional` entry is skipped instead).

## Example

```ts
import { createAgent } from "@arnilo/prism";
import postgresStore from "@arnilo/prism-store-postgres";

const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [postgresStore({ url: "env:PRISM_DATABASE_URL" })],
});
```

## Tests

`bun test` runs the package's definition checks without a database; `PRISM_TEST_POSTGRES_URL=… bun run
test:postgres` runs the full session-store conformance (including reopen, concurrent parent append,
and the listing/delete/title legs), the run-ledger conformance, and the migration checks against a
real server.

- Session links (`SessionOptions.parent` / `actor`): migration `010_session_links` adds nullable, indexed `agent_id`, `workflow_run_id`, `delegation_id`, `actor_kind`, `actor_agent`, and `actor_vendor` columns to `prism_sessions` (beside `parent_session_id`). The session's first `metadata` entry stays the source of truth and `append` mirrors it into the row in the same transaction. `listSessions` and `searchSessions` filter on the columns. Existing databases migrate forward without data loss and list old sessions with absent links.
