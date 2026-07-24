# Changelog

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

- Initial package: shared work-connector contracts, memory `IdempotencyStore`, CLI runner bounds, and `./microsoft365` adapter with hard-coded `@pnp/cli-microsoft365` argv templates (Outlook/calendar/files; To Do/Planner gated).
- Add `./google-workspace` adapter with hard-coded `@googleworkspace/cli` (`gws`) argv templates (Gmail/Calendar/Drive/Tasks; Docs/Sheets/Slides gated), strict NDJSON page parsing, and shared M365/GWS result normalizers.
