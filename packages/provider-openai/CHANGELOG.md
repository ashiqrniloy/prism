# Changelog

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to @arnilo/prism-provider-openai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Added

- Caller-gated `listOpenAIModels()` / `mapOpenAIModel()` / `defineOpenAIModel()` against official `GET /models`.
- `createOpenAIProviderPackage({ models?, codexModels? })` catalog overrides.

### Fixed

- Responses input serialization: assistant history uses `output_text`; `function_call` items are top-level with `call_id`.
- SSE tool streaming accepts official string `delta` on `response.function_call_arguments.delta`.
- First-class `reasoning` merge from model + per-turn `compat.reasoning`.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


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
