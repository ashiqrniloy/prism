# Changelog

## [Unreleased]

- Added optional host-owned `resumeAuthority` for coordination with other resume entry points.

### Added

- `@arnilo/prism-remote`: protocol `prism.remote/1` (JSON-RPC 2.0 method table, capability negotiation, bounded frame dispatcher, memory and stdio transports) (plan 170 Task 2).
- `@arnilo/prism-remote`: `serveAgent` and `remoteHostUi` — sessions, runs, steering, commands, and durable suspension on disconnect (plan 170 Task 3).
- `@arnilo/prism-remote`: `connectAgent` — an `Agent` proxy over stdio or an in-process transport, with `origin.remote` attribution, `executedBy: "external"` tool events, local `host.ui` routing, and optional session mirroring (plan 170 Task 4).

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
