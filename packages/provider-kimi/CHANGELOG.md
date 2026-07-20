# Changelog

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

### Added

- Featured Moonshot catalog adds `kimi-k2.7-code-highspeed`, `kimi-k2.6`, and `kimi-k2.5` with official thinking defaults (K2.5 intentionally without Preserved Thinking).

### Fixed

- Featured Coding `k3` defaults `reasoning_effort: "high"` per official Kimi Code docs (Open Platform `kimi-k3` keeps `"max"`); 256K-class featured context windows corrected to the exact official `262_144`.
- `stripKimiThinkingCompat()` also strips `route` and `preserve_thinking`, so provider-owned routing/serialization keys no longer leak into Anthropic or Chat Completions request bodies.
- Coding route sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers alongside Bearer per the official third-party setup; caller headers cannot override them.
- Both stream parsers require protocol completion evidence (`message_stop` on the Coding route, `[DONE]` + terminal `finish_reason` on the Moonshot route) and complete tool-call accumulators; truncated streams end with a terminal `error` instead of a false `done`.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to @arnilo/prism-provider-kimi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

- Released with the exact 0.0.6 first-party package graph.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

### Changed

- Migrated streaming/error handling to shared bounded transport and OpenAI/Anthropic argument helpers; documented structured-output capability, reasoning, cache, telemetry, and protected-header behavior.

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

- Initial release of @arnilo/prism-provider-kimi.
