# Changelog

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
