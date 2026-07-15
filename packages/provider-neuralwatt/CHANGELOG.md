# Changelog

All notable changes to @arnilo/prism-provider-neuralwatt will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
