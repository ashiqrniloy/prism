# Changelog

## [Unreleased]

### Added

- `noteRelPath` is exported from `@arnilo/prism-memory-core/fabric`, so a caller can name a note's OKF file before it is written (`memory:share` shows the target path for approval).

- `MarkdownMemoryStores.writeDerivedFile(scope, name, body)` (plan 188.5 Task 1): writes a derived resource file such as `core.md` under the store lock. The file starts with a `<!-- prism:derived content_hash=… -->` marker that hashes its own body, so a manual edit is detected, overwritten, and logged once in `log.md` (`**overwritten**: core.md — … pinned: true …`); an unchanged body is not rewritten. `LogEntry` gained an optional `note` that `renderLogFile`/`parseLogFile` round-trip after an em dash.

- Memory lifecycle step 2 — the scope clock and the lifecycle scan (plan 188.4 Task 2): three optional `VectorStore` members now let the fabric's maintenance pass read a project without reading its text. `scanMetadata({ scope, limit, cursor? })` pages `{ id, metadata, createdAt, lastAccessedAt }` over every thread of one resource, ordered by `(threadId, id)` and filtered like an export (visible consent, no invalidation or legal hold); `listResources({ tenantId, prefix? })` lists a tenant's resource ids for scope widening; and `scopeCounter.get/increment({ tenantId, resourceId, name: "sessions" })` is one atomic counter per resource. The fabric ticks each active scope's clock once per session on the first `context.build`, storing the counted resources in session state so a restore never double counts; decay and archival can then measure sessions worked instead of calendar days (D7). `MemoryFabric.maintain({ signal })` lands with the capability gate: a store without `scanMetadata` fails closed with `MemoryValidationError("maintenance requires scanMetadata")` while recall and writes keep working. SQLite moves to schema v3 — the index mirrors `status`, `storage` (`importance`) and `last_use_ordinal` as columns, a v2 index migrates in place with a JSON backfill, an unknown version still refuses, and the counter lives in `memory_scope_counter`; the markdown store keeps the counter in `<resource>/.state.json` (an index cannot rebuild it); Postgres adds `<table>_scope_counter` with an idempotent `CREATE TABLE IF NOT EXISTS`. The shared conformance suite checks all four stores for each member it declares. Actions: regenerate the memory-core and memory-fabric compat baselines.

### Fixed

- Store and directory active-note predicates (plan 188.1 Task 11 — D13): `activeDirectoryNote`, SQLite's `ACTIVE_NOTE` predicate, and Postgres's `activeNotePredicate` now exclude `status: "archived"` notes unless `archivedAt > asOf`, aligning active filtering with the separate archive lifecycle. Added optional `listInvalidated` to `Memory`.

### Added

- `./fabric`: `createMarkdownMemoryStores({ root, index?, dimensions? })` — OKF v0.2 markdown files as the canonical store with a derived, rebuildable SQLite index (`.index.sqlite`), a per-resource `.state.json` for control state, atomic file-first writes under a cross-process lock, `reconcile()`/`rebuild()`, and rewritten `index.md`/`log.md`. Files are jailed under `root`, written `0o600`, and never carry embeddings.

- `@arnilo/prism-memory-core` (plan 158 Task 2): the shared memory contracts, in-memory and Postgres
  vector stores, lineage, deletion propagation, repointing, recall scoring, limits, and schema
  helpers moved out of `@arnilo/prism-memory` into a plain library workspace. It default-exports no
  `definePackage`, claims no slot, and `pg` loads only under the `./postgres` subpath.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.
