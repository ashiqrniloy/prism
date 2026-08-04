# Changelog

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Replaced `IdempotencyStore` `get`/`put` replay handling with async `begin`/CAS transitions, retry caps, and explicit `unknown` reconciliation.

### Breaking (minor, pre-1.0)
- Custom idempotency stores must implement the new claim lifecycle; ambiguous effects are never auto-replayed.

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
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Added

- Optional per-identity `tokenProvider` on the M365/GWS CLI adapters: tokens resolved late-bound and injected via env (never argv), fail-closed on missing/expired/revoked/cross-identity/wrong-tenant credentials (Plan 077 Task 5).

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

- Initial package: shared work-connector contracts, memory `IdempotencyStore`, CLI runner bounds, and `./microsoft365` adapter with hard-coded `@pnp/cli-microsoft365` argv templates (Outlook/calendar/files; To Do/Planner gated).
- Add `./google-workspace` adapter with hard-coded `@googleworkspace/cli` (`gws`) argv templates (Gmail/Calendar/Drive/Tasks; Docs/Sheets/Slides gated), strict NDJSON page parsing, and shared M365/GWS result normalizers.
