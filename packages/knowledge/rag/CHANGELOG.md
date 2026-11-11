# Changelog

## [Unreleased]

- **Renamed `@arnilo/prism-rag` and moved to `packages/knowledge/rag` (plan 216 Task 3).** Was `@arnilo/prism-memory-rag`; no alias, no behaviour change.

- **Experimental in 0.13.0 (plan 215 Task 4).** The README opens with the experimental notice: install with `bun add @arnilo/prism-memory-rag@experimental`, outside the stability promise of the stable packages, and the API, config, preset contents and defaults may change or be removed in any release until the package graduates.

### Added

- `@arnilo/prism-memory-rag` (plan 158 Task 3): the 0.12 RAG library (chunking, retrieval, fusion,
  reranking, connectors, sync, ingestion status) moved out of `@arnilo/prism-memory/rag` into its own
  package, plus one `rag_search` tool (`effects: ["read"]`), an opt-in `context.build` block, the
  `embeddings` service, and lazy source indexing. URL sources consume `web.fetch` from
  `@arnilo/prism-tools/web`; the local `WebFetchAdapter`/`WebFetchDocument` are deleted.
- The kernel gains `prism.models.embeddings(ref)` and the optional `ModelProvider.embeddings()`
  adapter, so a package can build an `Embedder` over a model's provider without a vendor registry.

### Removed

- The `./rag`, `./rag/loaders`, and `./rag/parsers` subpaths of `@arnilo/prism-memory`; their
  importers now use `@arnilo/prism-memory-rag`.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.
