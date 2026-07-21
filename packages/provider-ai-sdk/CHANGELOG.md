# Changelog
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

## [0.0.6] - 2026-07-19

- Validated against official AI SDK Language Model V4 spec (`@ai-sdk/provider@^4`): host-owned catalog/caching/reasoning; `finish.usage.inputTokens.cacheRead`/`cacheWrite` usage mapping; docs and conformance checklist expanded.
## [0.0.5] - 2026-07-16

- Added the optional AI SDK LanguageModelV4-to-Prism provider adapter.


## [0.0.4] - 2026-07-14

- Initial release: `createAiSdkProvider({ model })` adapts AI SDK `LanguageModelV4` streams to Prism `AIProvider` events with prompt/tool/structured-output mapping and abort propagation.
