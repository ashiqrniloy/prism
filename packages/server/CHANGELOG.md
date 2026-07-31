# Changelog

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
