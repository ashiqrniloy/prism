# Changelog

## [Unreleased]

### Added

- New provider package (plan 152 Task 4): `@arnilo/prism-provider-clinepass` replaces the
  `@arnilo/prism-providers/clinepass` subpath. The default export is a `definePackage` definition
  that registers the `clinepass` provider, declares `capabilities: ["credentials"]`, and takes a
  ref-only config (`apiKey` defaults to `env:CLINEPASS_API_KEY`). The key resolves through the credentials slot on every request; a
  missing key records a `warn` status note, registers anyway, and fails a run with
  `credential_unavailable`. The featured catalog is the only model source (the vendor publishes no `/models` endpoint). The raw factories, the wire helpers, and the catalog stay
  named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
