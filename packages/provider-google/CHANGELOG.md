# Changelog

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
- HTTP errors now carry numeric `code` and parsed `Retry-After` (`retryAfterMs`) for transient classification and backpressure-aware retries.
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

### Changed

- Clarified API-key-only authentication: no Gemini CLI subscription OAuth, credential-token, or credential-file import.

## [0.0.11] - 2026-07-22

### Added

- First-party `@arnilo/prism-provider-google` native Gemini `generateContent` provider (`createGoogleProviderPackage` / `createGoogleGenerateContentProvider`), featured Gemini models, caller-gated `listGoogleModels`, tools/media/thinking/usage/abort conformance, and gated live smoke tests. Vertex identity deferred.
