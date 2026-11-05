# Changelog

## [Unreleased]

- **Experimental in 0.13.0 (plan 215 Task 4).** The README opens with the experimental notice: install with `bun add @arnilo/prism-memory-core@experimental`, outside the stability promise of the stable packages, and the API, config, preset contents and defaults may change or be removed in any release until the package graduates.

### Added

- `createMarkdownMemoryStores({ reviewEdit })` (plan 207 Task 7): the owning package reviews a note whose file changed outside the store before it is indexed. It may accept the file as parsed, return a reviewed record that the store indexes and writes back to the same file (logged as `reviewed`), or reject the edit: the previous version stays indexed, the file is left as written, the rejection is counted in `malformed` and logged once against the writer `human` until the file changes. Never called for an unreadable note. Additive; without the option nothing changes. The fabric uses it for concept notes.

- Export surface (plan 188.11 Task 5): the root keeps the stable tier (errors, `createHashEmbedder`, `createMemoryVectorStore`, revocation and repoint helpers) and the shared tier the sibling memory packages import. The 68 internal helpers and constants (cursor codecs, `parseLineage`, `scanDirectory`, `clampImportance`, `cosineSimilarity`, `HARD_*` caps nobody imports, …) and `validateIdentifier` on `./postgres` are no longer exported. The `export *` barrel is now an explicit list, so a new module export is not public until it is named. `root-exports.test.ts` freezes the root and the three subpaths.

- Forward-compatible note files (plan 188.11 Task 4): `parseNoteFile(content, path, classify?)` marks a note whose `fabric.v` is above 1 (or that `classify` rejects) unreadable and keeps its whole file in `metadata.okf.raw`, which `renderNoteFile` re-emits unchanged; unknown top-level frontmatter keys are kept in `metadata.okf.extra` and written back. `createMarkdownMemoryStores({ classifyNote })`, `reconcile()`/`rebuild()` report `unreadable` and `unreadableReasons`, `stores.unreadable()` returns the same counts, and the store never renames, moves or rewrites an unreadable file. README `## Compatibility` freezes the `VectorStore` and `Embedder` contracts at API level 1.

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
