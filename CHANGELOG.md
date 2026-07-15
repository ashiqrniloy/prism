# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.4] - 2026-07-14

### Added

- Shared bounded provider transport, OpenAI serialization/media helpers, native structured-output contracts, provider/tool timing metadata, and audio/file/document content capability checks.
- Generic checkpoint, atomic lease, and bounded event-multiplexer contracts plus persistence/run-ledger conformance helpers.
- Optional packages for JSON Schema tool validation, MCP, coding approval/sandboxing, OpenTelemetry, encrypted/keychain credentials, SQLite/PostgreSQL persistence, and bounded workflow orchestration.
- Manifest-only `base`, `code`, and `sdk` profiles; `prism-all` now transitively installs every first-party package.
- Workflow, multimodal, persistence/resume, provider telemetry, cache, and external-adapter examples.

### Changed

- Single-shot loops support ordered bounded parallel tools; `ToolDefinition.exclusive` serializes dangerous turns without reducing later concurrency.
- Provider requests, SSE/error bodies, media, schemas, event queues, checkpoints, and workflow fan-out/output use documented finite limits.
- Session/ledger writes preserve order and redact before persistence; revision-loop transcript ordering and OAuth abort polling are hardened.
- All first-party providers use shared bounded transport helpers and expose current structured-output, multimodal, caching, reasoning, telemetry, and retry behavior where supported.

### Security

- Added fail-closed schema/prototype-pollution, SSRF/media, SQL/tenant, path/shell approval, MCP result, credential-envelope, OAuth, redaction, and stale-worker fencing coverage.
- Optional privileged capabilities remain inactive until hosts explicitly register transports/tools, configure roots/credentials/databases, and approve execution.

## [0.0.3] - 2026-07-08

### Added

- New first-party workspace package `@arnilo/prism-coding-agent` providing optional host coding tools (`shell`, `read`, `write`, `edit`) as Prism `ToolDefinition` objects. The package is opt-in and is **not** included in `@arnilo/prism-all` because the tools perform host shell/filesystem operations.
- `createCodingTools`, `createReadOnlyTools`, and `createAllTools` aggregator factories for importing/registering coding tools.
- Documentation: `docs/coding-agent-tools.md`, updated `docs/index.md` and `docs/tools.md`, and expanded `packages/coding-agent/README.md`.

### Changed

- Bumped all package versions from `0.0.2` to `0.0.3` (core, first-party workspace packages, and umbrella packages).
- Updated `@arnilo/prism` peer dependency range in every first-party workspace package to `0.0.3`.
- Updated umbrella package dependency pins to `0.0.3`.
- `docs/release-and-install.md` now documents nine first-party workspace packages, thirteen total manifests, and the explicit install command for `@arnilo/prism-coding-agent`.

## [0.0.2] - 2026-07-05

### Added

- Added `LICENSE` (MIT) and `CHANGELOG.md` to the published `prism` package.
- Added npm package metadata: `license`, `repository`, `bugs`, `homepage`,
  `keywords`, and `sideEffects`.

### Changed

- `files` whitelist now explicitly excludes `dist/__tests__/` and
  `dist/**/*.map` from published tarballs; source maps remain emitted locally
  for debugging but are no longer shipped.
- Core tarball now ships the `/docs` hub.
- Made `prism` a required peer dependency for all first-party workspace packages; it is no longer optional. The peer range remains `0.0.2` and will widen to `^1.0.0` at the 1.x stable release.
- Pinned the no-network `npm test` budget at < 60s on Node 20 (measured baseline ~45s) after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests.

## [0.0.1] - 2026-06-22

### Added

- Initial release of Prism: a framework for building agentic LLM applications
  with configurable providers, sessions, tools, context providers, compaction,
  extensions, and trust boundaries.
