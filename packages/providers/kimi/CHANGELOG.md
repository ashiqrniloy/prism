# Changelog

## [Unreleased]

### Added

- New provider package (plan 152 Task 4): `@arnilo/prism-provider-kimi` replaces the
  `@arnilo/prism-providers/kimi` subpath. The default export is a `definePackage` definition
  that registers the `kimi-coding` (and an optional `moonshot`) providers, declares `capabilities: ["credentials"]`, and takes a
  ref-only config (`kimiApiKey` defaults to `env:KIMI_API_KEY` and `moonshotApiKey` to `env:MOONSHOT_API_KEY`). The key resolves through the credentials slot on every request; a
  missing key records a `warn` status note, registers anyway, and fails a run with
  `credential_unavailable`. `kimi-coding` returns its featured catalog; the optional `moonshot` provider delegates to `listKimiModels`. Discovery runs only when `agent.models.list()` is called. The raw factories, the wire helpers, and the catalog stay
  named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
