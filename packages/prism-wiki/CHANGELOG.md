# Changelog

All notable changes to `@arnilo/prism-wiki` will be documented in this file.

## [0.0.3] - 2026-08-29

### Changed
- Emitted `.wiki/` trees are OKF v0.2 bundles: root `index.md` carries only
  `okf_version: "0.2"`, per-directory indexes, concept frontmatter
  (`type`/`title`/`description`/`tags`/`sources`/`generated`), date-grouped
  newest-first `log.md`, and plain markdown links. Karpathy compilation body
  and skills are retained. `wiki-lint` flags missing `type`, non-ISO
  `generated.at`, and leftover `[[wikilinks]]`.

## [0.0.1] - 2026-08-24

### Added
- Initial release of `@arnilo/prism-wiki`.
- Karpathy LLM Wiki system integration with `qmd` hybrid search and Context7-style line navigation.
- Commands: `/wiki-init`, `/wiki-refresh`, `/wiki-lint`.
- Tools: `wiki_search`, `wiki_read_page`, `wiki_record_insight`.
- Bundled skills: `wiki-maintainer`, `wiki-searcher` with automatic `.agents/skills/` deployment.
- Codebase, PKM, and Hybrid domain profiles with Merkle hash drift tracking.

## [0.1.0] - 2026-08-09

### Added
- Initial package declaration for `@arnilo/prism-wiki`.

## [0.0.28] - 2026-08-08

### Added
- Reserved package entry for the wiki compiler.
