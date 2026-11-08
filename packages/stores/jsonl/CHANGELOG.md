# Changelog

## [Unreleased]

### Added

- Forward compatibility (plan 215 Task 29): a line of an unknown `kind` with a valid envelope, or with a
  `schemaVersion` newer than the kernel's, is returned unchanged as an opaque entry instead of being reported in
  `errors`. The store warns once through the new `logger` option (`createJsonlSessionStore({ dir, logger })`;
  the package passes `prism.log`). A structurally invalid line is still an error. See `docs/compatibility.md`.
- `@arnilo/prism-store-jsonl` (plan 153 Task 3): the JSONL session store moved out of the kernel's
  `./node/session-store-jsonl` subpath. The package default-exports a `definePackage` definition with
  `capabilities: ["slot:store"]` and config `{ dir }`, and claims the slot with
  `prism.slots.store.provide(createJsonlSessionStore({ dir }))`.
- One JSONL file per session (`<dir>/<sessionId>.jsonl`) instead of the 0.12 single caller-named file.
  `listSessions` and `deleteSession` join the store, and `searchSessions`/`list`/`get` work across the
  directory.
- `listSessions` samples the first and last line of each file (never the transcript) and applies the
  ownership scope from those lines; `deleteSession` removes one file and refuses a session outside the
  scope.
- A session id outside the accepted alphabet fails closed with `JsonlSessionStoreError`
  (`invalid_session_id`) before any filesystem call, covering `..` and path separators.
- Exact-retry dedup survives a restart: the keys live in `<dir>/.idempotency.json`, written atomically
  and read fail-soft.
- `readJsonlSessionEntries(path)` is a named export, so a host can parse a file (quarantining bad
  lines) without constructing a store.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.

## [0.0.28] - 2026-08-08

- Prior release anchor carried by the lockstep line.
