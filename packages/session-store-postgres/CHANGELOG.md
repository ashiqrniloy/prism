# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.4] - 2026-07-14

### Added

- Initial `@arnilo/prism-session-store-postgres` release: `createPostgresPersistence` implements `SessionStore`, `RunLedger`, and `ProductionPersistenceStore` over `pg@^8.22.0` with versioned migrations, advisory-lock setup, parameterized SQL, configurable schema, and full conformance coverage (opt-in live PostgreSQL).
- Added persistence-owned generic `CheckpointStore` as `persistence.checkpoints`.
- Added atomic database-clock `LeaseStore` as `persistence.leases`, with opaque claims and monotonic fencing.

## [0.0.3] - 2026-07-14

### Added

- Plan 056 Task 3 PostgreSQL persistence adapter.
