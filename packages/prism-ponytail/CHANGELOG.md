# Changelog

## [0.3.1] - 2026-08-29

### Changed
- Plan 035-039 changed-package cut: additive runtime performance, tooling, and documentation deltas; peer window refresh.

## [0.2.8] - 2026-08-19

### Changed
- Peer `@dietrichgebert/ponytail` is `^4.9.0`. Bare `/ponytail` reports current+default mode and does not change mode.

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

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Added
- Initial release: upstream Ponytail skills/commands, mode injector, session `ponytail-mode` persistence.

## [0.0.21] - 2026-07-31

### Added
- Package scaffold with `createPonytailExtension` and fail-closed upstream resolution (`upstreamPath` or optional peer `@dietrichgebert/ponytail`).
- Ponytail skills, commands, mode persistence (`ponytail-mode`), upstream hook instruction injection, bounded config IO, extension events for status/loaded.
