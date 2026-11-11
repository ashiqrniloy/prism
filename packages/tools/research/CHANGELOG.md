# Changelog

## [Unreleased]

### Changed

- Plan 215 Task 7: the four skills' descriptions now open with when to use them (at most 300 bytes), and `research-report` declares `metadata.prism-requires-tools: cite`, so a request that does not advertise `cite` hides it instead of offering a procedure the model cannot follow. Checked by `scripts/package-skills-conformance.mjs`.

### Added

- `@arnilo/prism-tools/research`: four bundled research skills, a per-session source ledger on `tool.result`, a read-only `cite` tool, and a `run.end` citation check. Unresolved markers continue once by default (`maxRepairs`), then the verdict is `failed` and the package emits `research.citations.unresolved`. `research.verify` returns `{ verdict, unresolved, ledgerSize }`.
