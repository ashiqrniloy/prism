# @arnilo/prism-store-sqlite

The SQLite session store — sessions, entries, branches, runs, checkpoints, leases, and lifecycle,
with numbered schema migrations — as the `store` slot, over Bun's built-in `bun:sqlite`.

## Install

```bash
prism add @arnilo/prism-store-sqlite
```

```jsonc
// manifest entry, with every config field that has no default
{
  "name": "@arnilo/prism-store-sqlite",
  "version": "^0.12.1",
  "integrity": "sha512-…",
  "config": { "path": ".prism/sessions.db" }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | `string` | none (required) | SQLite database file. A relative path resolves against the process cwd; `:memory:` is supported for tests. Missing `path` fails the package load with a field-naming error. |
| `busyTimeoutMs` | `number` | `5000` (`DEFAULT_BUSY_TIMEOUT_MS`) | `busy_timeout` pragma, in milliseconds, before a locked database fails. |

The factory options that are not JSON — `wal`, `fileMode`, `skipMigrations`, `database`,
`feedbackRedactor` — stay code-only on `createSqlitePersistence(options)`.

## What it changes

Claims the `store` slot with the `SessionStore` facet of `createSqlitePersistence({ filename: path, busyTimeoutMs })`.
Migrations run on open (idempotent across reopen, verified against the shared
`@arnilo/prism/testing/persistence-schema` contract), the database file is created mode `0600` on Unix,
and `PRAGMA foreign_keys = ON` is always set.

The store implements the full `SessionStore` contract plus the two optional capabilities:

- `readBranchPath` reads one branch's ancestor chain with a recursive CTE and an ownership-scope
  filter, so a branch read never scans the session.
- `listSessions` returns one indexed page (keyset cursor on `prism_sessions(updated_at, id)`, newest
  first, `limit` 1–100, default 20) of scope-filtered session summaries with the branch tip, the
  message count, the title, and `workspaceRoot` — plus one leaf query and one count query per page,
  never a transcript and never a per-row query.
- `deleteSession` removes every row the session owns — entries (and their FTS rows and idempotency
  keys), branches, runs (feedback cascades from the run foreign key), events, tool calls, usage, and
  the session record — inside one transaction, and answers `false` without writing anything when the
  session is absent, entry-less, or outside the requested scope.

Ownership scope follows the kernel's `entriesInScope` rule: a session is inside a scope only when
**every** entry carries each named `tenantId`/`accountId`/`userId` value. A host that stamps entries
(the runtime does) gets scope filtering on `listSessions`, `deleteSession`, `readBranchPath`, and
`searchSessions`; a row whose record columns carry the scope but whose entries do not is still visible
to `searchSessions` (record-scoped) but not to `listSessions`.

Companion stores ship as named exports from the same persistence object, because they share one
database and one migration history: `createSqliteCheckpointStore`, `createSqliteLeaseStore`,
`createSqlitePersistenceLifecycle`, the migration/DDL constants (`MIGRATION_001_INIT` …
`MIGRATION_009_RUN_PROMPT_VERSION`, `ADAPTER_TABLE_NAMES`, `ADAPTER_INDEX_NAMES`), and
`applySqliteMigrations`/`assertSqliteSchemaReady`/`verifyMigrationIdempotency`. Their *contracts* stay
in `@arnilo/prism`; their placement is roadmap Phase 11.

## Capabilities

`["slot:store"]`. The package depends on `@arnilo/prism-store-codecs` for the shared row codecs and
ownership helpers.

## Cost, security, and failure behavior

- **Bun only.** Importing the package outside Bun fails closed with
  `@arnilo/prism-store-sqlite requires the Bun runtime (bun:sqlite).` An agent that does not list this
  package never loads `bun:sqlite`.
- **Parameterized SQL.** Every statement binds values; no query interpolates a session id, a cursor,
  or a scope value.
- **One writer, many readers.** SQLite serializes writers; WAL mode (default) keeps readers
  unblocked. `busyTimeoutMs` bounds how long a lock wait takes before failing.
- **No secrets.** The store persists session entries and metadata it is given; redaction runs in the
  kernel *before* append, and feedback redaction is the optional `feedbackRedactor`. Search hits carry
  only `title` and `workspaceRoot` from metadata.

## Example

```ts
import sqliteStore, { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import { createAgent, mockProvider } from "@arnilo/prism/testing";

const agent = await createAgent({
  model: mockProvider([{ text: "hello" }]).model,
  packages: [sqliteStore({ path: ".prism/sessions.db" })],
});

// Or drive the persistence object directly (companions included):
const persistence = createSqlitePersistence({ filename: ".prism/sessions.db" });
await persistence.append({ id: "e1", sessionId: "s1", timestamp: new Date().toISOString(), kind: "label", label: "start" });
```

## License

MIT
