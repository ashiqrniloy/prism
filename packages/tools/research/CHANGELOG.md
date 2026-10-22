# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-tools-research`: four bundled research skills, a per-session source ledger on `tool.result`, a read-only `cite` tool, and a `run.end` citation check. Unresolved markers continue once by default (`maxRepairs`), then the verdict is `failed` and the package emits `research.citations.unresolved`. `research.verify` returns `{ verdict, unresolved, ledgerSize }`.
