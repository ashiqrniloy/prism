# Changelog

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Added
- `createArtifactService` accepts an optional `bodies: ArtifactBodyStore` (core contract from `@arnilo/prism`): when wired, `deliveryLink` resolves through `bodies.presign` and returns an additional bounded-TTL presigned `url` beside the signed link/token; revisions without a recorded `size` fail closed at delivery. `attach`/`revise` accept an optional `size` (validated non-negative safe integer) recorded on the revision.
- New `@arnilo/prism-server/artifact-bodies` subpath: `createS3ArtifactBodyStore` — reference S3-compatible `ArtifactBodyStore` (AWS S3, MinIO, Cloudflare R2) with hand-rolled SigV4 presigning over native fetch + WebCrypto (validated against the official AWS sig-v4-test-suite get-vanilla vector), path-style addressing, single-chunk PUT with exact Content-Length and verified `x-amz-content-sha256`, ownership verification on every operation, size/SHA-256/MIME verification on put and get (fail closed), legal-hold-aware idempotent delete (host `isHeld` callback), host-resolved credentials (never inline), optional host-owned client-side KMS callback, bounded concurrent transfers, and no bucket/path/key disclosure in errors. `S3ArtifactBodyError` carries frozen `ERR_PRISM_S3_*` codes; limits `maxBodyBytes` 64 MiB/512 MiB, `maxConcurrentTransfers` 4/16, `presignTtlMs` 10 min/24 h, `maxRefBytes` 256 B/1 KiB.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Changed
- Released with exact 0.0.26 graph.

## [0.0.25] - 2026-08-06

### Added
- Agent resume accepts batch `decisions: RunDecision[]` (exclusive with legacy binary `decision`) with boundary validation.

### Changed
- Released with exact 0.0.25 graph.

See [migration guide](../../docs/migration.md) for the 0.0.24 → 0.0.25 notes.

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

### Added

- Durable user-scoped conversation service (`createConversationService`/`createConversationHandler`) and durable artifact service with review/approval/authorized delivery links (`createArtifactService`/`createArtifactHandler`) (Plan 077 Tasks 1, 3).

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-23

### Added

- Optional deployment seams: `createPrismHealthHandler`, `createPrismDrainController`, host `rateLimit` adapter (+ `createMemoryRateLimiter`), ownership-scoped `createPrismEventReplay` / `createPrismReplayHandler`, and `createPrismDeploymentLease` for worker/coordinator election over existing leases. No queue adapter (deferred pending measured Postgres polling need).

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

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

- Explicit `agentRuns` lifecycle capabilities expose bounded redacted durable agent status/resume routes through core CAS/fingerprint checks; no lifecycle route is enabled by default.

## [0.0.6] - 2026-07-19

- Workflow cancellation now forwards the registered revised definition and exact authorized ownership for pre-abort hash/owner verification.

## [0.0.5] - 2026-07-16

- Added optional authorized, bounded Web-standard direct/SSE agent and durable workflow handling, including explicitly registered ownership-scoped schedules, background enqueue, and immutable-lineage replay.

## [0.0.4] - 2026-07-14

- Initial optional web-standard agent/workflow handler with explicit authorization, ownership, redaction, streaming, and resource bounds.
