# Changelog

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

### Fixed

- Anthropic route (`POST /messages`) sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers alongside Bearer, fixing HTTP 401 on MiniMax/Qwen models; caller headers cannot override them.
- `structuredOutput: "json_schema"` is no longer inferred from OpenAI-compatible routing alone. Only live-verified models (`mimo-v2.5`, `mimo-v2.5-pro`) advertise it, fixing HTTP 400 on `deepseek-v4-pro`; hosts can set the capability explicitly via `defineOpenCodeGoModel({ capabilities })`.
- Both stream parsers require protocol completion evidence (`[DONE]` + terminal `finish_reason` on the OpenAI route, `message_stop` on the Anthropic route) and complete tool-call accumulators; truncated streams end with a terminal `error` instead of a false `done`.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to @arnilo/prism-provider-opencode-go will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Changed

- Default base URL is now official `https://opencode.ai/zen/go/v1` (was `https://api.opencode.ai/v1`).
- Featured catalog refreshed to official Go open coding models (Grok/GLM/Kimi/MiMo/MiniMax/Qwen/DeepSeek); removed stale Zen-style `gpt-5.1-go` / `claude-sonnet-4.5-go` aliases.
- Anthropic route assigned to MiniMax + Qwen per official endpoint table; OpenAI route for all others.
- OpenAI route preserves thinking as `reasoning_content` (never folds into text); Anthropic preserveThinking uses shared helper; owned compat keys stripped before opaque spreads.

### Added

- Caller-gated `listOpenCodeGoModels` / `mapOpenCodeGoModel` / `defineOpenCodeGoModel` / `routeForOpenCodeGoModel` against official `GET /zen/go/v1/models`.
- Thinking helpers: `openCodeGoThinking`, `openCodeGoReasoningEffort`, `openCodeGoReasoning`, `openCodeGoPreserveThinking`, `stripOpenCodeGoOwnedCompat`.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

### Changed

- OpenAI and Anthropic routes use shared bounded transport/serialization helpers with protected headers, structured-output mapping, multimodal capability checks, and complete tool-call reconstruction.

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

- Initial release of @arnilo/prism-provider-opencode-go.
