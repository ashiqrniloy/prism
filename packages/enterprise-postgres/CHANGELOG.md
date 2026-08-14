# Changelog

## [0.2.2] - 2026-08-13

### Changed
- Durable Postgres router reservations (migration 003 adds a reservations JSONB column to prism_model_router_budgets), durable reserve/commit/release with CTE eviction and expired-reservation pruning, and the state-concurrency conformance legs for router reservations and idempotency against real Postgres. See docs/migration.md and docs/enterprise-postgres-state.md.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

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

### Added
- Initial optional PostgreSQL enterprise-state composition: checksum-verified migrations, policy/evaluation stores, work claim/CAS reconciliation, durable model-router rate/budget/circuit state, and explicit owner-scoped cleanup.

## Unreleased

- Added PostgreSQL enterprise-state package infrastructure, checksum-protected schema migration, and explicit bounded cleanup lifecycle.
