# Changelog
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
