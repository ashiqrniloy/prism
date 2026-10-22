# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-store-sqlite` (plan 153 Task 4): the SQLite session store moved out of
  `@arnilo/prism-core/sessions/sqlite` into a source-exported package on the lockstep line. The
  default export is a `definePackage` definition (`capabilities: ["slot:store"]`, config
  `{ path, busyTimeoutMs? }`, and the `sqliteStore({ path })` instance shorthand) whose `setup` claims
  the slot with the `SessionStore` facet of `createSqlitePersistence`. A missing `path` fails the load
  with a field-naming error rather than a schema `required` (plan 152 Task 6's config rule).
- The store gains the two optional `SessionStore` capabilities: `listSessions` (one indexed page on
  `prism_sessions(updated_at, id)`, newest-first with a keyset cursor, entry-metadata ownership scope,
  and the title/`workspaceRoot`/message-count/tip summary fields, with one leaf and one count query per
  page) and `deleteSession` (one transaction over entries, FTS rows, idempotency keys, branches, runs,
  events, tool calls, usage, and the record row; fail-closed and non-enumerating for an absent,
  entry-less, or foreign-scope session). The store now passes `storeConformance` with `reopen` and
  `exerciseConcurrentParentAppend`.
- Companion stores stay named exports from the same package (`createSqliteCheckpointStore`,
  `createSqliteLeaseStore`, `createSqlitePersistenceLifecycle`, the migration and DDL constants, and
  the migration appliers) because they share one database and one migration history; their contracts
  are the `checkpoints`/`leases` service contracts in `@arnilo/prism-workflows` (plan 168 Task 4).
- `@arnilo/prism-core/sessions/sqlite` and `/sessions/codecs` are deleted with no alias. The shared
  codecs now live in `@arnilo/prism-store-codecs`; importers migrate to the packages
  (`@arnilo/prism-core` keeps the codecs as a dependency for its Postgres tree until plan 153 Task 5).

### Changed

- `setup` registers `prism.services.provide("checkpoints", …)` and `prism.services.provide("leases", …)`
  over the same `SqlitePersistence` it puts in the store slot (plan 168 Task 4), so a listed workflows
  package gets durable checkpoints and leases with no second `Database`. The store contracts
  (`CheckpointStore`, `LeaseStore`) now come from `@arnilo/prism-workflows` as `import type` only.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.
