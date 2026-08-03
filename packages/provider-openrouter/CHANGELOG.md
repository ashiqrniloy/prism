# Changelog

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
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

### Fixed

- Malformed streamed tool-call arguments yield recoverable tool calls via `toolCallFromArgumentsText` instead of throwing `ProviderTransportError` / terminal stream errors.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to @arnilo/prism-provider-openrouter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Added

- Caller-gated `listOpenRouterModels()` / `mapOpenRouterModel()` via official `GET /api/v1/models`.
- `resolveOpenRouterReasoning()` merge (model defaults + per-turn override) and assistant `reasoning` replay for tool-call continuity.
- Top-level automatic `cache_control` when caching is enabled without explicit breakpoints.

### Changed

- Owned compat keys (`reasoning`, `openRouterRouting`, `openRouterCache`, `preserveThinking`) are stripped before opaque body spreads.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.

## [0.0.4] - 2026-07-14

### Changed

- Uses shared bounded transport/OpenAI helpers and documents per-model structured-output, multimodal, routing, reasoning, cache-control, usage, and protected-header behavior.

## [0.0.2] - 2026-07-05

### Added

- Added `LICENSE` (MIT) and `CHANGELOG.md`.
- Added npm package metadata: `license`, `repository`, `bugs`, `homepage`,
  `keywords`, and `sideEffects`.

### Changed

- `files` whitelist now explicitly excludes `dist/__tests__/` and
  `dist/**/*.map` from published tarballs.
- Made `prism` a required peer dependency; it is no longer optional.

## [0.0.1] - 2026-06-22

### Added

- Initial release of @arnilo/prism-provider-openrouter.
