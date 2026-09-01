## [0.4.0] - 2026-09-01

- Plan 054: family ships as part of the 11-package 0.4 lockstep; peer `@arnilo/prism@^0.4.0`.

# Changelog

## [0.3.1] - 2026-09-01 (plan 054 Task 6)

### Changed
- **Provider family conversion**: all 17 first-party adapters (`@arnilo/prism-provider-{ai-sdk,alibaba,anthropic,azure,bedrock,clinepass,deepseek,google,kimi,neuralwatt,ollama,openai,opencode-go,openrouter,vertex,xai,zai}`) fold into this package as `./<adapter>` subpaths. Azure, Bedrock, and Vertex stop being special all-only manifests; the required `@arnilo/prism` peer is the only dependency (`@ai-sdk/provider` stays an optional peer on `/ai-sdk`); importing one adapter never evaluates another; public symbols, model catalogs, credential handling, and auth registration semantics are unchanged except import specifiers. Adapter manifest identifiers become the subpath names.

## [0.2.4] - 2026-08-14

### Changed
- Truth wording (plan 024): description and README now state the manifest closure — **11 of 14** first-party provider adapters (omits Azure, Bedrock, Vertex, added separately by `@arnilo/prism-all`); the "What it installs" list was corrected from 9 to the full 11 (`@arnilo/prism-provider-alibaba` and `@arnilo/prism-provider-ollama` were missing). Membership unchanged.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

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

### Added

- Umbrella now installs `@arnilo/prism-provider-anthropic` and `@arnilo/prism-provider-google` (nine first-party provider packages).

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Released with the exact 0.0.8 first-party package graph.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Released with the exact 0.0.6 first-party package graph.

## [0.0.5] - 2026-07-16

- Added `@arnilo/prism-provider-ai-sdk`; the provider umbrella now installs all seven first-party provider adapters.

## [0.0.4] - 2026-07-14

### Added

- Added NeuralWatt to the manifest-only family of all six first-party provider adapters.

### Changed

- First-party adapters share bounded transport/OpenAI primitives and document structured output, telemetry, multimodal support, cache behavior, and protected headers.
