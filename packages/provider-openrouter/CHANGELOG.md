# Changelog

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
