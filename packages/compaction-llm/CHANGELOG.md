# Changelog
## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.


## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to @arnilo/prism-compaction-llm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Changed

- Added finite validated summary/reserve/error defaults and hard caps; provider requests always carry finite `maxTokens` after policy application.
- Summary streams retain bounded text/event counts, stop provider iteration on overflow, preserve UTF-16 boundaries, and bound/redact provider events, throws, factory failures, and policy failures.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

### Changed

- Compaction output budgets map through `model.parameters.maxTokens` to provider wire token limits; shared transport and redaction behavior remain host-configured.

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

- Initial release of @arnilo/prism-compaction-llm.
