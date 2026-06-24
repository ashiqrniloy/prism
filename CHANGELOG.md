# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `LICENSE` (MIT) and `CHANGELOG.md` to the published `prism` package.
- Added npm package metadata: `license`, `repository`, `bugs`, `homepage`,
  `keywords`, and `sideEffects`.

### Changed

- `files` whitelist now explicitly excludes `dist/__tests__/` and
  `dist/**/*.map` from published tarballs; source maps remain emitted locally
  for debugging but are no longer shipped.
- Core tarball now ships the `/docs` hub.
- Made `prism` a required peer dependency for all first-party workspace packages; it is no longer optional. The peer range remains `0.0.1` and will widen to `^1.0.0` at the 1.x stable release.
- Pinned the no-network `npm test` budget at < 30s on Node 20 (measured baseline ~22s); recorded in `roadmap.md` Phase 17.

## [0.0.1] - 2026-06-22

### Added

- Initial release of Prism: a framework for building agentic LLM applications
  with configurable providers, sessions, tools, context providers, compaction,
  extensions, and trust boundaries.
