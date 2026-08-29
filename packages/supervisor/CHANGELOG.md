# Changelog

## [0.3.2] - 2026-08-29 (plan 050)

### Added
- **FEATURE-4 (Clay integration findings)**: opt-in child event passthrough.
  `createSupervisor({ childEvents: true })` projects a redacted, capped milestone
  subset of child `AgentEvent`s (`agent_started`/`finished`/`suspended`/`denied`
  and tool-execution events) onto the supervisor stream as `delegation_child_event`
  tagged with `childId`/`delegationId`/`depth`. Default off (stream unchanged).
  Caps `maxChildEventsPerDelegation` (256/4096) and `maxChildEventBytes`
  (32 KiB/256 KiB); overflow drops further child events and emits one
  `delegation_child_events_capped` marker. Live passthrough is the initial
  `delegate()` session; `resumeNestedRun` rebuilds are not projected in v1.

### Fixed
- **BUG-2 (Clay integration findings)**: both child-factory consumption sites
  (initial delegation and durable resume rebuild) now validate the factory
  result shape (`config` object + `createSession` function) before any policy
  intersection is read. A factory returning a session or any non-`Agent` value
  fails closed at `delegate()`/resume time with
  `SupervisorError: child "<id>" factory must return an Agent, got <type>`
  (constructor name, e.g. `RuntimeAgentSession`) instead of a cryptic
  `Cannot read properties of undefined (reading 'permission')` TypeError.

## [0.3.1] - 2026-08-29

### Changed
- Plan 035-039 changed-package cut: additive runtime performance, tooling, and documentation deltas; peer window refresh.

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

### Added
- Durable child approvals: `checkpoints` + `definitionRevision` on supervisor; `resumeNestedRun` routes hashed attributed decisions without widening child permission.

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

## [0.0.8] - 2026-07-20

- Added host-owned durable A2A task start/get/list/cancel/subscribe with bounded cursor replay, interrupted states, ordered rich task events, and non-disclosing task errors.
- Added opt-in bounded text/raw/URL/data parts; URL policy validates without dereferencing.
- Added capability-gated push config CRUD/client APIs and explicit bounded `deliverA2APushEvent()` retry/timeout/idempotency-key wrapper; webhook transport/credentials remain host-owned and secrets are omitted from responses.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Fixed A2A streaming UTF-8 corruption across chunk boundaries with one fatal streaming decoder and incremental LF/CRLF/multiline SSE parsing; truncated or post-terminal streams fail without changing existing limits.

## [0.0.5] - 2026-07-16

- Added optional bounded child delegation and A2A 1.0 card/server/client interoperability.

## [0.0.4] - 2026-07-14

- Bounded explicit local child delegation with narrowing-only policy composition, derived memory scope IDs, hooks, nested delegation, cancellation, and event subscription.
- A2A protocol 1.0 cards, ES256 JWS signing/verification, authorized web-standard JSON-RPC/SSE handler, and explicit allow-listed remote client.
