# Changelog

All notable changes to @arnilo/prism-provider-openai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.4] - 2026-07-14

### Added

- Responses API multimodal mapping for `audio` / `file` / `document` with bounded file upload cache and cleanup.

### Changed

- Responses and Codex routes use shared bounded transport/media primitives, protected authorization headers, structured-output mapping, and OAuth abort polling.
- Inline OpenAI `file_data` now uses `data:<mediaType>;base64,...` so MIME identity is preserved under provider conformance canaries.

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

- Initial release of @arnilo/prism-provider-openai.
