# Changelog
## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Changed

- Startup now validates SHA-256 migration history and complete schema-v3 metadata before writes; complete legacy `NULL` checksums backfill transactionally after shape verification, while drift fails closed.

## [0.0.5] - 2026-07-16

### Added

- Schema migration `003_run_feedback` and `persistence.feedback` with exact run ownership, bounded/redacted records, cursor queries, and owned deletion.

## [0.0.4] - 2026-07-14

### Added

- Initial `@arnilo/prism-session-store-sqlite` release: `createSqlitePersistence` implements `SessionStore`, `RunLedger`, and `ProductionPersistenceStore` over `better-sqlite3` with WAL, busy timeout, versioned migrations, parameterized SQL, and full conformance coverage.
- Added persistence-owned generic `CheckpointStore` as `persistence.checkpoints`.
- Added atomic database-clock `LeaseStore` as `persistence.leases`, with opaque claims and monotonic fencing.

## [0.0.3] - 2026-07-14

### Added

- Plan 056 Task 2 SQLite persistence adapter.
