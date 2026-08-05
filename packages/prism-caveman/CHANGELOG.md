# Changelog

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
- Initial release: upstream Caveman skills/commands, level injector, session `caveman-level` persistence.

## [0.0.21] - 2026-07-31

### Added
- Caveman skills, commands, level persistence, upstream prompt injection, and config bounds.
- Registers upstream skills (`caveman`, `caveman-commit`, `caveman-review`, `caveman-stats`, `caveman-compress`, `caveman-help`, `cavecrew`).
- Commands: `caveman`, `caveman-commit`, `caveman-review`, `caveman-stats`, `caveman-compress`, `caveman-init`.
- Session custom `caveman-level` persistence; `caveman-mode` instruction injector; deactivation via `stop caveman` / `normal mode`.
