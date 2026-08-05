# Changelog

## [0.0.25] - 2026-08-06

### Changed
- Released with exact 0.0.25 graph.

## [0.0.24] - 2026-08-04

### Added
- Durable `AgentEventSource` (memory + PostgreSQL LISTEN/NOTIFY), recoverable `ToolEffectStore`, and AG-UI MCP/MCP Apps/A2A fronting for Phase 7.

### Changed
- Publishable graph remains **47** manifests at **0.0.24**; peers and lockfile move together.

See [migration guide](../../docs/migration.md) for the 0.0.23 → 0.0.24 notes.

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.

## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Changed
- Released with exact 0.0.21 graph.

## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.

## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Released with exact 0.0.18 graph.

## [0.0.17] - 2026-07-29

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Changed

- Released with exact 0.0.14 graph.

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

### Fixed

- Malformed streamed tool-call arguments yield recoverable tool calls via `toolCallFromArgumentsText` instead of throwing `ProviderTransportError` / terminal stream errors.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

All notable changes to @arnilo/prism-provider-neuralwatt will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-07-19

### Changed

- NeuralWatt featured catalog refreshed to official aliases (`gemma-4-31b` added, legacy `kimi-k2` removed); GLM reasoning models default `reasoning_effort: "max"`.
- `preserve_thinking` / `clear_thinking` compat flags now route into `chat_template_kwargs` per official gateway docs; `stripNeuralWattOwnedCompat` prevents opaque compat spread from overwriting resolved thinking controls.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.

## [0.0.4] - 2026-07-14

### Added

- Complete provider package with featured model metadata, reasoning controls, tool-call reconstruction, implicit prefix-cache usage/cost mapping, quota/model discovery, energy/cost telemetry, and retry classification.

### Changed

- Uses shared bounded transport/OpenAI primitives; setup and generation never invoke quota or model discovery implicitly.

## [0.0.2] - 2026-07-05

### Added

- Initial workspace scaffolding for `@arnilo/prism-provider-neuralwatt`:
  `package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`, and the
  `src/{index,provider,models}.ts` module shells.
- Added npm package metadata: `license`, `repository`, `bugs`, `homepage`,
  `keywords`, and `sideEffects`.
- Made `prism` a required peer dependency.

## [0.0.1] - 2026-07-01

### Added

- Initial release of @arnilo/prism-provider-neuralwatt.
