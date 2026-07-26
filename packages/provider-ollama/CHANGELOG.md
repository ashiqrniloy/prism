# Changelog

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Changed

- First published release; versioned to the exact 0.0.14 graph and enrolled in `@arnilo/prism-providers`.

## [0.0.13] - 2026-07-24

### Added

- Ollama Cloud / local OpenAI-compatible provider: dynamic model discovery
  (`listOllamaModels`, no hard-coded catalog), cloud/local base-URL presets,
  `reasoning_effort` passthrough, and implicit-only cache accounting
  (`Usage.cacheReadTokens` intentionally undefined — documented ceiling)
  (Plan 077 Task 10).
