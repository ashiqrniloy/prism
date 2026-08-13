# Changelog
## [0.2.1] - 2026-08-13

### Changed
- 0.2.1 (plan 021): JWKS fetches DNS-pinned through the core pinnedFetch primitive (redirects rejected, oversized documents fail closed as a parse error never a rotatable transport failure); OAuth2 device flow consolidated onto the shared core pollDeviceCodeToken (bounded reads, fail-closed token shape, [REDACTED] redaction); Microsoft365/Google-Workspace connector consumers stay compatible.



## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Added
- `@arnilo/prism-credentials-node/oidc` subpath: `createOidcIdentityVerifier` — optional OIDC/JWKS identity verifier (plan 011 Task 1) over native `fetch` + WebCrypto (no JOSE dependency): pinned issuer/audience, allowlisted RS256/ES256 (host may only narrow), bounded exp/nbf clock skew, kid key selection with single-flight bounded JWKS cache and exactly one refetch on unknown kid, host revocation callback (fail closed on true/throw), bounded claims + reused core identity limits, host `mapClaims` → `AgentIdentity`. Fail-closed `IdentityError` reasons `ERR_PRISM_OIDC_*` (frozen in `scripts/phase11-freeze-manifest.json`); SSRF-checked pinned JWKS URL (redirects never followed; denials surface `MediaContentError` `ssrf_denied`).

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Changed
- Released with exact 0.0.25 graph.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Changed
- Released with exact 0.0.21 graph.

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Released with exact 0.0.18 graph.

## [0.0.17] - 2026-07-29

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Added

- Generic `createOAuth2Provider` (PKCE/device-code/refresh/revoke) with thin Microsoft 365 + Google Workspace adapters, least-privilege workload scope bundles, and `createOAuthWorkTokenProvider` for per-identity late-bound token env injection (Plan 077 Task 5).

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Changed `encryptBytes()`/`decryptBytes()` to asynchronous scrypt and added finite envelope, vault, KDF work/memory, keychain timeout, and keychain payload limits.
- Encrypted vault loading now strictly validates envelope/base64 shape and existing Unix file mode before KDF work; package-owned plaintext buffers are zeroed and failed writes do not mutate in-memory state.
- Keychain calls now use abort-aware `AsyncEntry` operations outside the JavaScript event loop, with a main-loop timeout and sanitized locked/unavailable/timeout errors; Linux Secret Service/GNOME Keyring `number[]` secret reads are handled.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.

## [0.0.4] - 2026-07-14

- Encrypted-file store enforces scrypt floors, authenticated envelope/vault versions, restrictive atomic writes, namespace isolation, passphrase rotation, and fail-closed keychain behavior.

## [0.0.3]

- Initial release: encrypted-file credential store (AES-256-GCM + scrypt), system keychain adapter (`@napi-rs/keyring`), stored credential resolver, OAuth store adapter, and passphrase rotation.
