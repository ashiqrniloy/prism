# Changelog

## [Unreleased]

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

- Encrypted-file store enforces scrypt floors, authenticated envelope/vault versions, restrictive atomic writes, namespace isolation, passphrase rotation, and fail-closed keychain behavior.

## [0.0.3]

- Initial release: encrypted-file credential store (AES-256-GCM + scrypt), system keychain adapter (`@napi-rs/keyring`), stored credential resolver, OAuth store adapter, and passphrase rotation.
