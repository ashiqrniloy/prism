# Changelog
## [0.2.1] - 2026-08-13

### Changed
- 0.2.1 (plan 021): model-discovery and embeddings success reads migrated to the bounded readBoundedResponseJson reader (65,536-byte ceiling, depth/property/shape caps); strict completion opt-in retained.



## [0.1.2] - 2026-08-10

### Added
- `createAlibabaEmbedder` over the OpenAI-compatible `POST {base}/embeddings` (text-embedding-v3/v4): structural `Embedder` shape (assignable to `@arnilo/prism-memory`'s without a dependency), inputs chunked at the DashScope cap (10/request), vectors in input order, empty input returns `[]` without a fetch, `dimensions` 64–2048 (default 1024) + `encoding_format` passthrough, key resolved per call and redacted from all errors.
- Video input in chat serialization: `file` blocks with `video/*` media types map to compatible-mode `video_url` content parts on Qwen-VL models, gated on the `file` input capability; `mapAlibabaModel` advertises `["text", "image", "file"]` for the qwen-vl family.
- Opt-in live probe: `PRISM_LIVE_DASHSCOPE_KEY=… npm run test:live --workspace @arnilo/prism-provider-alibaba` (skips when env absent; never in CI).

### Deferred (documented in the verified decision table)
- Document input: no OpenAI-compatible content part; compatible path is the OpenAI Files API `file-extract` + `fileid://` reference (qwen-long) — demand-gated follow-up.
- Rerank: only workspace-dedicated `compatible-api/v1/reranks` exists (`qwen3-rerank`), not on the public presets — demand-gated follow-up.

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

- First published release; versioned to the exact 0.0.14 graph and enrolled in `@arnilo/prism-providers`.

## [0.0.13] - 2026-07-24

### Added

- Alibaba Cloud (Model Studio / DashScope, incl. Coding Plan) OpenAI-compatible
  provider: dynamic model discovery (`listAlibabaModels`, no hard-coded catalog),
  context-cache usage accounting (implicit prefix cache + explicit `cache_control`
  markers capped at 4), and Qwen `enable_thinking` passthrough (Plan 077 Task 9).
