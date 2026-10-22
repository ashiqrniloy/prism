# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-memory-wiki` (plan 158 Task 5): the 0.12 LLM Wiki (manifest, ingest, compiler,
  linter, profiles, search, retire/re-point, the `prism-wiki` CLI) moved out of
  `@arnilo/prism-memory/wiki` into its own package, plus the `memoryWiki()` factory, four wiki tools,
  four package commands (`wiki-init`, `wiki-refresh`, `wiki-lint`, `wiki-ingest`), the bundled
  `wiki-searcher` / `wiki-maintainer` skills added with `prism.skills.addDir`, and the
  `wiki-guidance` `context.build` injector.
- URL ingest consumes the `web.fetch` service; a missing service notes a warning at setup and fails
  `wiki_ingest url=...` closed while file ingest keeps working.
- `autoDeploySkills` now defaults to `false`; `true` keeps the 0.12 workspace deploy into
  `.agents/skills/`.

### Removed

- The `./wiki` subpath, the `prism-wiki` bin, and the bundled `skills/` of `@arnilo/prism-memory`;
  their importers now use `@arnilo/prism-memory-wiki`.
- The `extractDocument` and `ocrImages` wiki hooks. No service successor exists, so compressed-PDF,
  CSV-via-host, and image OCR extraction leave the wiki; uncompressed PDF, text, markdown, HTML, and
  the no-OCR image stub stay.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

Prior line. See the root `CHANGELOG.md`.
