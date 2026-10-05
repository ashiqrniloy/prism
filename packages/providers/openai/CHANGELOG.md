# Changelog

## [Unreleased]

### Added

- New provider package (plan 152 Task 3): `@arnilo/prism-provider-openai` replaces the
  `@arnilo/prism-providers/openai` subpath. The default export is a `definePackage` definition that
  registers the `openai` and `openai-codex` providers, declares
  `capabilities: ["credentials", "host-ui"]`, and takes a ref-only config (`apiKey` defaults to
  `env:OPENAI_API_KEY`, `codexAccessToken` to `keyring:openai-codex`, plus `baseUrl` and `models`).
  Keys resolve through the credentials slot on every request; a missing key records a `warn` status
  note, registers anyway, and fails a run with `credential_unavailable`. Codex OAuth ships as an
  `auth` descriptor that drives the legacy `OAuthProvider` through `ctx.host` and stores the tokens
  through `ctx.credentials.store`, failing closed with `OAuthUnavailableError` when the host has no
  UI. `models()` delegates to `listOpenAIModels` for Responses and returns the static catalog for
  Codex, running only when `agent.models.list()` is called.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
