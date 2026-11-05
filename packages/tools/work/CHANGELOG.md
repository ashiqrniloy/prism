# Changelog

## [Unreleased]

### Changed

- Plan 215 Task 7: the vendored office skills register through `loadWorkSkills()` with `requiresTools: ["work_exec"]` instead of a bare `prism.skills.addDir`, so they are hidden on a request that does not advertise `work_exec`. The vendored `SKILL.md` bytes are untouched. `WORK_SKILL_TOOLS` (the `office_*` names, a `toolNames` declaration nothing used and that would have failed a narrowed run) is replaced by `WORK_SKILL_REQUIRES_TOOLS`, with no alias.

### Added

- Plan 155 Task 5: `@arnilo/prism-tools-work` — the work family as one package with a `definePackage` root entry. `setup` registers the `office_*` document group (read/write effects), `work_exec` inside the host-injected `work.sandbox` service (`execute`), and the `m365_*` / `gws_*` connector tools (`network`, plus `external` for drafts/writes) when a ref-only credential resolves. The bounded document reader is provided as the `work.reader` service and the vendored Hermes productivity skills are added from `vendor/`. A missing optional parser, an unresolved connector credential, or a missing sandbox writes a `warn` status note and registers less; the worker pool closes in `onDispose`.
- Config: `root` (required, absolute), `office`, `work`, `reader` (formats, caps, optional Mistral OCR), `connectors` (M365/Google CLI adapters with ref-only credentials), `env`.
- New tests: `tools_work_package_conformance`, `tools_work_groups_by_config`, `tools_work_missing_parser_drops_formats_with_note`, `tools_work_connector_without_credential_notes`, `tools_work_secrets_never_echoed`, `office_parsers_not_loaded_unless_tools_work_listed`, `tools_work_disposes_worker_pool`.

### Changed

- Moved `packages/prism-work/**` (source, tests, `fixtures/`, `golden/`, `docling/`, `sandbox/`, `vendor/`, `vendor-lock.json`, `THIRD_PARTY_NOTICES`) to `packages/tools/work/**`. The `@arnilo/prism-work` workspace is deleted with no alias; every importer now uses `@arnilo/prism-tools-work` (and its subpaths).
- `createOfficeTools` now declares per-tool `effects` (`read` for parse/import/diff/preview, `write` for generate/patch); `createWorkTools` declares `network` for reads and `network` + `external` for drafts/writes; `work_exec` declares `execute`.
- The package publishes TypeScript source (`exports` targets `./src/...`) instead of `dist/`, so its `build` script is gone and CI builds the workspace with `build:core` only.

## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

## [0.3.0] - 2026-09-01

Initial family cut: `/documents`, `/sheets`, `/diagrams` subpaths (plans 051–053 landed as one package per plan 054 Task 8).

## [0.1.0] - 2026-08-09

Placeholder for the shared 0.1.0 changelog contract (office family first shipped at 0.3.0).

## [0.0.28] - 2026-08-08

- Released with exact 0.0.28 graph.
