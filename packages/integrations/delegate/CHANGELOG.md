# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-delegate` (plan 160 Task 4): native package adding `delegate`, `delegate_wait`, and `delegate_cancel` tools. Each child runs as its own `createAgent` over the packages named in its `inherit`, reports `delegate.step` package events, and ends or is disposed with the delegation or the parent session. Replaces the in-process supervisor, `createSpawnAgentTool`, and `createDelegatedAgentStep`.
- `@arnilo/prism-observability` (plan 160 Task 3): native package turning run, turn, and tool events into OpenTelemetry spans and metrics through observe handlers. Moved the agent-event instrumentation (`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`) out of `@arnilo/prism-core/governance/observability`. Exports nothing itself.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
