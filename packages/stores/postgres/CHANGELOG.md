# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-store-postgres` (plan 153 Task 5): the PostgreSQL session store moved out of
  `@arnilo/prism-core/sessions/postgres` into a source-exported package on the lockstep line. The
  default export is a `definePackage` definition (`capabilities: ["slot:store", "credentials"]`, config
  `{ url, schema?, pool? }` with `url` a ref-only `x-prism-secret`, and the `postgresStore({ url })`
  instance shorthand) whose `setup` resolves the `url` ref through `prism.credentials.resolve` and
  claims the slot with the persistence object. `pg` is a dependency of this package alone and loads
  lazily; the kernel and `@arnilo/prism-core` never load it. A missing `url` (without a caller-owned
  pool) fails the load with a field-naming error rather than a schema `required`.
- The store gained `listSessions` (one indexed page on `prism_sessions(updated_at, id)`, keyset
  cursor, ownership scope from entry metadata, leaf id plus message count per page),
  `deleteSession` (one transaction, fail-closed scope check, no row left behind), and
  `mergeSessionMetadata` (the session-record merge the kernel's title path writes through).

### Changed

- `setup` registers `prism.services.provide("checkpoints", …)` and `prism.services.provide("leases", …)`
  over the same pool the store slot uses (plan 168 Task 4), so a listed workflows package gets durable
  checkpoints and leases with no second connection. The store contracts (`CheckpointStore`,
  `LeaseStore`) now come from `@arnilo/prism-workflows` as `import type` only.

## [0.1.0] - 2026-08-09

- Initial `@arnilo/prism-store-postgres` package skeleton.

## [0.0.28] - 2026-08-08

- Pre-release line, kept for the lockstep changelog anchors the docs gate pins.
