# Changelog

All notable changes to `@arnilo/prism-evals` will be documented in this file.

## [Unreleased]

- **Host library `@arnilo/prism-evals`**: evaluations machinery moved out of `@arnilo/prism-core/governance/evals` into `packages/hosts/evals` as a host library.
- **Controlled failure injection reshaped**: `wrapAgentWithFailureInjection` deleted in favor of `failureInjection(options)` (`AgentConfig.hooks` function using `tool.call` deny and `tool.execute` around for unknown-effect) and `failingStore(store)` wrapping `SessionStore`.
- **Factory-based scenario runner**: `runScenario` supports host agent factories `(extra) => createAgent({ ...extra })`, avoiding agent construction or object spread inside evals.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
