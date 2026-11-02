# Changelog

## [Unreleased]

### Added

- New provider package (plan 206 Task 2): `@arnilo/prism-provider-ollama-cloud` registers the
  `ollama-cloud` provider with the measured native NDJSON `/api/chat` route (default) and the
  OpenAI-compatible `/v1/chat/completions` route used by `pi-ollama-cloud`.
- Native route streams text, thinking, tool calls, images, and JSON-schema structured output, and maps
  `prompt_eval_cached_count` to `cacheReadTokens`.
- `ollamaCloudBalance()` exposes `/api/balance` session/weekly limits and purchased balance.
- Caller-gated `listOllamaCloudModels()` discovery via `/api/tags` + `/api/show` (concurrency 4), with
  context windows and thinking values.
- Wire recordings for both routes, including the measured overflow body and the fenced structured
  output reply.
- Live scenarios for the native and compat routes.

### Changed

- The shared context-overflow classifier now matches Ollama's measured
  `exceeded max context length` body, and quota classification recognizes session/weekly limit
  wording.
- `providerConformance` no longer mistakes the native `/api/chat` path for an OpenAI Chat route.
- `runProviderLiveScenarios` accepts a `native` route.

### Removed

- No Anthropic Messages route: the native route is the measured default and no reference harness uses
  `/v1/messages`.
