# `@arnilo/prism-extensions/store-postgres`

The PostgreSQL session store — sessions, runs, checkpoints, leases, feedback, lifecycle, and the
durable event source — as the Prism `store` slot, over `pg`.

## Install

```bash
prism add @arnilo/prism-extensions/store-postgres
```

```jsonc
// prism.config.json
{
  "packages": {
    "@arnilo/prism-extensions/store-postgres": {
      "config": { "url": "env:PRISM_DATABASE_URL", "schema": "prism" }
    }
  },
  "slots": { "store": "@arnilo/prism-extensions/store-postgres" }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string (`x-prism-secret`, ref only) | — | `env:`/`keyring:` ref for the connection string. One string, so a password never lands in the manifest; resolved through `prism.credentials.resolve` once at `setup`, and the value joins the agent's secret set. |
| `schema` | string | `prism` | Schema holding the Prism tables. Created by the migrations if it is absent. |
| `pool` | object | — | Pool tuning for the pool this package creates: `max` (default `10`), `connectionTimeoutMillis`, `idleTimeoutMillis`. Anything else (`ssl`, certificates, a caller-owned `Pool`) stays code-only. |
| `queryLimits` | object | kernel defaults | Store query limits: `maxListLimit` (100), `maxSearchLimit` (100), `maxSearchQueryBytes`, `maxSearchCursorBytes`, `searchSnippetBytes` (512), `ftsCandidates` (1,000). Host-only; a list or search page above the store's limit is refused. |
| `maxPageSize` | integer | `500` | Largest checkpoint, lifecycle or run-feedback page. |

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
  `@arnilo/prism-extensions/workflows`; this package depends on them with `import type` only.
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

The store declares `tipCheck` (plan 230 Task 2): a `tip: true` append is inserted with `linear = 1`, and the
partial unique index `prism_session_entries_linear_parent_unique` on `(session_id, parent_id) WHERE linear =
1` rejects a second one at the same parent inside the insert, with no extra round trip. The `23505` on that
index becomes `SessionAppendConflictError`; the current leaf is read only on that failure path. Migration
`012_session_entry_linear` adds the column with a constant `DEFAULT 0` (a catalog-only change, no table
rewrite) and builds the index; existing sibling branches stay valid. Several processes can safely run one
session: the second writer's run fails with `session_conflict` instead of forking the branch.

`readBranchPath({ from: "compaction" })` (plan 230 Task 3) reads only the branch's tail in two recursive
statements: the walk from the leaf stops at the newest compaction, the second goes on to its `throughEntryId`;
a third statement reads the older entries its `keepEntryIds` name, when there are any. The kernel uses it for
every session snapshot (5,000 entries compacted at 4,800: 221 rows and ~2.7 ms instead of 5,000 rows and ~36 ms
over a local socket). No schema change.

`append` is one statement (plan 230 Task 4): data-modifying CTEs check the parent, the idempotency key, and the
entry id, then upsert the session row (and its link columns, for the links entry), insert the entry, upsert its
search row, and record the key. A failed check writes nothing and maps to the same error as before. A
concurrent writer that passed the same checks hits a unique index instead: the linear index is
`SessionAppendConflictError`, the idempotency primary key an idempotency duplicate, the entry primary key a
duplicate id. There is no explicit transaction, so no `ROLLBACK` can hide the original error. Migration
`013_session_entry_seq` adds `prism_session_entries.seq`, a `BIGINT` identity backfilled in the old
`timestamp, ctid` order, and the `(session_id, seq)` index; `list()`, the latest-leaf lookup, and the session
index order by it instead of `ctid`, which `VACUUM FULL` and `CLUSTER` rewrite. The backfill updates every
entry row once, under the migration lock.

`appendMany` (plan 230 Task 5) writes a batch in one statement: each column is one array parameter (`unnest …
WITH ORDINALITY`), so the parameter count does not grow with the batch, and rows are inserted in batch order so
`seq` follows the branch. An `ok` CTE checks that every parent outside the batch is in the session and no id is
taken; a failed check writes nothing, not even the session row. Batch rows are not linear. `session.fork()`
uses it: a 5,000-entry fork is 2 statements (~0.43 s over a local socket) instead of one per entry (5,001
statements, ~5.0 s; 30,001 statements and 9.85 s before plan 230 Task 4).

## Cost, security, failure behavior

- Each `append` is one statement and one round trip (1 ms RTT: ~3 ms instead of ~19–23 ms; 20 ms RTT: ~22 ms
  instead of ~145–186 ms); a page of `listSessions` is three queries
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
import postgresStore from "@arnilo/prism-extensions/store-postgres";

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

## Durable evaluations

`createPostgresPersistence` returns `evaluations` and `experiments`. Migration
`011_evaluations` adds `prism_evaluations` and `prism_experiment_reports` in place,
with owner/created and dataset indexes, plus evaluation run, experiment, session,
and scorer indexes. Each append is one insert (one row per evaluation or experiment
summary), validated and capped at 1 MiB by `@arnilo/prism-extensions/store-codecs`.
`evaluationRedactor` is a code-only factory option for reasons, errors and metadata.

Queries match all three ownership fields exactly; omitted fields match only absent
fields, so an unscoped query sees only unowned records. Queries default to 100 rows
(maximum 1,000); use the returned opaque `nextCursor` for the next page.
`experiments.latest({ datasetId, ...ownership, manifestMatch })` returns the newest
matching content-free summary. Session deletion and retention remove associated
evaluations; experiment summaries remain independent of session lifetime.

## Optional peer

Install the optional peer with `bun add pg` unless you supply a pool. Without it, setup records a status note and registers no store.
