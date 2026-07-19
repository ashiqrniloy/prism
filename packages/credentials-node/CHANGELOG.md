# Changelog

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
