# Changelog
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

All notable changes to @arnilo/prism-provider-zai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Added

- Caller-gated `listZaiModels()` / `mapZaiModel()` (OpenAI-compatible `GET /models`).
- Official `clear_thinking` + Preserved Thinking (`reasoning_content` replay).
- Featured catalog refreshed to official GLM-5.x / 4.7 / 4.6 / 4.5 ids.

### Changed

- Default base URL is official international `https://api.z.ai/api/paas/v4`.
- Docs aligned to official thinking / reasoning_effort / tool_stream fields (removed obsolete compat docs names).
- Resolved `thinking` / `reasoning_effort` / `tool_stream` win over raw compat spreads.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

### Changed

- Uses shared bounded transport/OpenAI helpers with GLM thinking/reasoning, structured-output, multimodal, tool-stream, telemetry, and protected-header behavior documented per model.

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

- Initial release of @arnilo/prism-provider-zai.
