## [Unreleased]

### Removed

- `/sessions/postgres` (plan 153 Task 5): the PostgreSQL session store (leases, lifecycle, event source, and
  migrations included) moved to `@arnilo/prism-store-postgres`, which declares the `pg` dependency. This
  package drops its `@arnilo/prism-store-codecs` dependency with it — the codecs package existed here only
  for that tree — and its `test:postgres` script now runs the remaining `enterprise/postgres` suite. The
  `pg` peer stays: `enterprise/postgres` and the prompt registry still use it.
- `/sessions/codecs` and `/sessions/sqlite` (plan 153 Task 4): the shared SQL codecs moved to
  `@arnilo/prism-store-codecs` and the SQLite session store (leases, lifecycle, and migrations
  included) moved to `@arnilo/prism-store-sqlite`, which depends on `@arnilo/prism-store-codecs`. This
  package kept the codecs dependency until plan 153 Task 5 moved the Postgres store, then dropped it;
  `@arnilo/prism-store-sqlite` stays a devDependency for this package's own store-backed tests.

## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

# Changelog

All notable changes to `@arnilo/prism-core` will be documented in this file.

## [0.3.3] - 2026-09-01

### Added
- Initial release of `@arnilo/prism-core` family package consolidating runtime, sessions, governance, credentials, enterprise persistence, and work integrations into explicit subpaths.
- `/runtime/server`, `/runtime/supervisor`, `/runtime/workflows`
- `/sessions/codecs`, `/sessions/sqlite`, `/sessions/postgres`, `/sessions/nats`
- `/governance/policy`, `/governance/evals`, `/governance/prompts`, `/governance/model-router`, `/governance/observability`
- `/credentials/node` (including `/credentials/node/oidc`)
- `/enterprise/postgres`
- `/integrations/work` (including `/integrations/work/microsoft365`, `/integrations/work/google-workspace`)
- `/validation/json-schema`

## [0.1.0] - 2026-08-09

### Changed
- Finalized 0.1.0 package baseline.

## [0.0.28] - 2026-08-08

### Added
- Pre-release baseline.
