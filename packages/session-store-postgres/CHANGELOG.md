# Changelog

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Added
- Root re-exports `createPostgresAgentEventSource`, `ClosablePostgresAgentEventSource`, and `PostgresAgentEventSourceOptions` (FR-6) — the durable `AgentEventSource` is now importable from the package root without a `dist/...` subpath; `persistence.events` remains the canonical bundled path, unchanged.

### Changed
- Placement answer (FR-7): the durable event source stays in this package for the 0.0.26 line; PostgreSQL `LISTEN`/`NOTIFY` remains the reference durable implementation. See [agent events](../../docs/agent-events.md).

## [0.0.25] - 2026-08-06

### Changed
- Released with exact 0.0.25 graph.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Changed
- Released with exact 0.0.21 graph.

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Released with exact 0.0.18 graph.

## [0.0.17] - 2026-07-29

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Row codecs moved to the shared `@arnilo/prism-session-store-codecs` package (`createSessionRowMappers` with an identity `redacted` codec); no public API change.

## [0.0.15] - 2026-07-26

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Added

- Bounded `SessionStore.searchSessions` with metadata filters and Postgres `tsvector` FTS (schema migration `004_session_search`).

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

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Changed

- Advisory-locked startup now validates SHA-256 migration history and complete schema-v3 metadata before writes; complete legacy `NULL` checksums backfill transactionally after shape verification, while drift fails closed.

## [0.0.5] - 2026-07-16

### Added

- Advisory-locked schema migration `003_run_feedback` and `persistence.feedback` with exact run ownership, bounded/redacted records, cursor queries, and owned deletion.

## [0.0.4] - 2026-07-14

### Added

- Initial `@arnilo/prism-session-store-postgres` release: `createPostgresPersistence` implements `SessionStore`, `RunLedger`, and `ProductionPersistenceStore` over `pg@^8.22.0` with versioned migrations, advisory-lock setup, parameterized SQL, configurable schema, and full conformance coverage (opt-in live PostgreSQL).
- Added persistence-owned generic `CheckpointStore` as `persistence.checkpoints`.
- Added atomic database-clock `LeaseStore` as `persistence.leases`, with opaque claims and monotonic fencing.

## [0.0.3] - 2026-07-14

### Added

- Plan 056 Task 3 PostgreSQL persistence adapter.
