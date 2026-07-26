# Changelog

## [0.0.15] - 2026-07-26

### Added

- Bounded, exact-identity `exportMemory()` and resumable `rebuildIndex()` pages; exports require explicit visible consent and redact returned records.
- `listByThread()` / `countByThread()` store capabilities, PostgreSQL/pgvector parity, finite-vector checks at export/rebuild boundaries, and expanded shared conformance.

## [0.0.14] - 2026-07-26

### Added

- Memory consent + lifecycle: consent stamping on index, a `recall()` consent filter, and `setConsent`/`correct`/`forget`/`applyRetention` (Plan 077 Task 2).

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Reject empty, non-number, NaN, and infinite embedder/vector-store/pgvector values before scoring or storage; export `assertFiniteVector()` for custom adapters.

## [0.0.5] - 2026-07-16

- Added optional working-memory, semantic-recall, conformance, and PostgreSQL/pgvector adapters.

## [0.0.4] - 2026-07-14

- Initial release: working memory, semantic recall, in-memory Embedder/VectorStore adapters, context provider, optional processor, shared conformance, and PostgreSQL/pgvector production path.
