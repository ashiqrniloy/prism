# Changelog

## [Unreleased]

### Added

- New provider package (plan 152 Task 6): `@arnilo/prism-provider-bedrock` replaces the retired
  `@arnilo/prism-providers/bedrock` subpath. The default export is a `definePackage` definition that
  registers the vendor provider, declares `capabilities: ["credentials"]`, and takes a ref-only config;
  credentials resolve through the credentials slot on every request, a missing credential records a
  `warn` status note while still registering the provider, and a run then fails with
  `credential_unavailable`. The raw factories and wire helpers stay named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
