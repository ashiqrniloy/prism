# Changelog

## [Unreleased]

### Changed

- Rebuilt `createOpenCodeGoProvider` on the shared routed builder (`createRoutedProvider`) with dual routes: `openai` (`/chat/completions`) and `anthropic` (`/messages`) (plan 183 Task 3).
- Enforced session correlation requirement (`require: { sessionId: true }`) failing closed with `ProviderRequirementError` before any fetch when `options.sessionId` is missing.
- Added session affinity routing via `x-opencode-session` header derived from sanitized `cacheKey ?? sessionId` (clamped to 128 characters).
- Added wire test recordings in `src/__tests__/wire/openai/` with full `providerConformance({ recordings })` coverage across both routes.
- Exported route definitions `OPENCODE_GO_CHAT_ROUTE`, `OPENCODE_GO_MESSAGES_ROUTE`, affinity helper `opencodeSession`, and `OPENCODE_SESSION_ID_MAX_LENGTH`.

### Removed

- Removed obsolete internal wire, cache, and thinking helper exports: `openAIChatBody`, `openAIChatEvents`, `serializeOpenCodeGoChatMessage`, `anthropicMessagesBody`, `anthropicMessagesEvents`, `applyOpencodeAnthropicCacheControl`, `opencodeAnthropicCacheEnabled`, `opencodeOwnedHeaders`, `opencodeSessionId`, `openCodeGoPreserveThinking`, `openCodeGoReasoning`, `openCodeGoReasoningEffort`, `openCodeGoThinking`, `stripOpenCodeGoOwnedCompat`.


- New provider package (plan 152 Task 4): `@arnilo/prism-ai/opencode-go` replaces the
  `@arnilo/prism-providers/opencode-go` subpath. The default export is a `definePackage` definition
  that registers the `opencode-go` provider, declares `capabilities: ["credentials"]`, and takes a
  ref-only config (`apiKey` defaults to `env:OPENCODE_GO_API_KEY`). The key resolves through the credentials slot on every request; a
  missing key records a `warn` status note, registers anyway, and fails a run with
  `credential_unavailable`. `models()` delegates to `listOpenCodeGoModels` and runs only when `agent.models.list()` is called. The raw factories, the wire helpers, and the catalog stay
  named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
