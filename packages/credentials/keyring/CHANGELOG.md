# Changelog

## [Unreleased]

### Added

- New package (plan 152 Task 7): `@arnilo/prism-credentials-keyring` claims the `credentials` slot
  with the OS keyring (`@napi-rs/keyring`, imported lazily) or an encrypted file
  (`backend: "file"` with `file.path` + `file.keyRef`), resolves `keyring:<name>` refs, and delegates
  `env:` refs to `prism.slots.credentials.default`. `store`/`delete` persist host-captured `secret`
  answers and provider OAuth tokens. An unavailable backend records a `warn` status note, still
  claims the slot, answers `undefined` for reads, and throws `KeyringUnavailableError` on writes —
  never a plaintext fallback. Moves the credential stores out of
  `@arnilo/prism-core/credentials/node` (`keychain-store`, `encrypted-store`, `file-store`,
  `envelope`, `file-io`, `vault`, `types`, `limits`, `errors`, `resolver`, and the host KMS
  envelope); `prism-core` drops its `@napi-rs/keyring` dependency and keeps OIDC, OAuth2, workload
  scopes, the M365/Google Workspace providers, and the work-token helper.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
