# Changelog

## [Unreleased]

### Added

- New provider package (plan 152 Task 5): `@arnilo/prism-ai/laya` replaces the
  `@arnilo/prism-providers/laya` subpath. The default export is a `definePackage` definition that
  registers the `laya` provider, declares `capabilities: ["credentials"]`, and takes a ref-only config
  (`apiKey` defaults to `env:LAYA_API_KEY`, plus `baseUrl`, `models`). The key resolves through the
  credentials slot on every request; a missing key records a `warn` status note, registers anyway, and fails
  a run with `credential_unavailable`. The raw factory, the wire helpers, the cache/thinking helpers, and the
  catalog stay named exports.

### Changed

- Rebuilt on `systemOneProviderPackage` from `@arnilo/prism/provider-kit` sharing single-shape decision-provider implementation with TypeSafe Jev.
- Renamed `DEFAULT_LAYA_BASE_URL` to `LAYA_DEFAULT_BASE_URL` and added `LAYA_DEFAULT_API_KEY_REF`. Removed obsolete `layaBaseUrl`.
- Plaintext remote endpoint warning now warns through System One in `provider-kit`, printing only the origin without userinfo.
- Implemented `systemOneConformance` coverage and added skip probe for local `laya-serve` instance in `live.test.ts`.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
