# Changelog

## [0.0.17] - 2026-07-29

### Changed
- HTTP errors now carry numeric `code` and parsed `Retry-After` (`retryAfterMs`) for transient classification and backpressure-aware retries.
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

### Changed

- Clarified API-key-only authentication: no Gemini CLI subscription OAuth, credential-token, or credential-file import.

## [0.0.11] - 2026-07-22

### Added

- First-party `@arnilo/prism-provider-google` native Gemini `generateContent` provider (`createGoogleProviderPackage` / `createGoogleGenerateContentProvider`), featured Gemini models, caller-gated `listGoogleModels`, tools/media/thinking/usage/abort conformance, and gated live smoke tests. Vertex identity deferred.
