# Changelog

## [Unreleased]

### Changed

- Rebuilt `createHyperProvider` on the shared routed builder (`createRoutedProvider`) with dual routes: `openai` (`/chat/completions`) and `anthropic` (`/messages`) (plan 183 Task 2).
- Surfaced Hyper usage monetization fields (`cost.usd`, `cost.hypercredits`, `remaining.hypercredits`) into `Usage.cost`, `Usage.currency`, and `Usage.metadata.hyper`.
- Added wire test recordings in `src/__tests__/wire/` (`openai` and `anthropic`) with full `providerConformance({ recordings })` coverage.
- Exported route definitions `HYPER_CHAT_ROUTE`, `HYPER_MESSAGES_ROUTE`, and usage mapper `withHyperCost`.

### Removed

- Removed obsolete wire and retry helper exports: `hyperChatBody`, `hyperChatEvents`, `serializeHyperChatMessage`, `classifyHyperError`, `hyperHttpError`, `applyHyperAnthropicCacheControl`, `hyperAnthropicCacheEnabled`, `hyperPreserveThinking`, `hyperReasoningEffort`, `hyperThinking`, `stripHyperOwnedCompat`.

### Added

- New provider package (plan 152 Task 5): `@arnilo/prism-ai/hyper` replaces the
  `@arnilo/prism-providers/hyper` subpath. The default export is a `definePackage` definition that
  registers the `hyper` provider, declares `capabilities: ["credentials"]`, and takes a ref-only config
  (`apiKey` defaults to `env:HYPER_API_KEY`, plus `baseUrl`, `models`). The key resolves through the
  credentials slot on every request; a missing key records a `warn` status note, registers anyway, and fails
  a run with `credential_unavailable`. The raw factory, the wire helpers, the cache/thinking helpers, and the
  catalog stay named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
