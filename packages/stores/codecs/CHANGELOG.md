# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-store-codecs` (plan 153 Task 4): the row codecs, cursor codecs, ownership-scope
  helpers, and SQL query-semantics helper moved out of `@arnilo/prism-core/sessions/codecs` and
  `@arnilo/prism-core/sessions/query-semantics` into a plain library workspace that the SQL store
  packages share. It default-exports no `definePackage` and claims no slot.
- `@arnilo/prism-core/sessions/codecs` is deleted, so the SQL codecs now have exactly one home.
  `@arnilo/prism-core` depends on this package while its Postgres tree is still in the family package
  (it moves to `@arnilo/prism-store-postgres` in plan 153 Task 5).

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.
