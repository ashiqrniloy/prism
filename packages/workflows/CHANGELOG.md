# Changelog

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
- Sourced `resolveRedactor` from `@arnilo/prism` core and deleted the private duplicate; no public API change.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Added

- Proactive schedule capabilities: `createProactiveScheduleCapabilities` with fail-closed `enable`/`revoke`/`assertActive` and policy auditing (Plan 077 Task 2).

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

- Tool nodes now use core `dispatchToolCall()` and accept `RunWorkflowOptions.guardrails`, so shared tool-input/output checks run before execution-policy side effects and output exposure.
- `RunWorkflowOptions.limits` forwards core run budgets to agent nodes.

## [0.0.6] - 2026-07-19

- Require explicit workflow revisions and include parent/nested revisions in durable definition hashes.
- Isolate active runs and cancellation by exact tenant/account/user ownership; reject duplicate exact registrations and definition mismatch before abort/mutation.
- Reject non-finite, unsafe, or above-hard-cap workflow/runtime/node/checkpoint limits.
- Generate workflow run and tool-call IDs with cryptographic UUIDs.

## [0.0.5] - 2026-07-16

- Added ownership-scoped durable one-time/interval/host-calculated schedules, explicit background enqueue, nested workflow nodes, bounded validated shared state/history, and immutable-lineage replay.
- Added optional RPC/MCP commands and authorized Web routes for enqueue, replay, and schedule control; no schedule worker starts automatically and generic persistence needs no migration.

- Added durable `suspend()`/approve/deny workflow state, exact-once expected-version resume, resume validation/redaction/events, and opt-in tool approval that rechecks current execution policy before side effects.

## [0.0.4] - 2026-07-14

- Finalized bounded typed DAG execution, retries/timeouts/abort, fan-out/join, redacted checkpoint resume, event sinks, RPC commands, and fenced multi-process coordination over generic checkpoint/lease stores.

## [0.0.3]

- Added `enqueueWorkflow()` and `createWorkflowCoordinator()` for bounded multi-process scheduling with durable lease renewal, expiry takeover, cancellation requests, checkpoint CAS, and fencing tokens.

- Initial release: typed bounded DAG workflow orchestration (`defineWorkflow`, Kahn scheduler, agent/function/tool/conditional/fan-out/join nodes, `WorkflowEventBus`, in-memory checkpoints, `runWorkflow` / `resumeWorkflow`).
- Durable control: `createWorkflowCheckpoints({ store })` adapts core `CheckpointStore`; first-party persistence packages own SQLite/PostgreSQL storage. Added `cancelWorkflowRun` and optional `createWorkflowCommands()` (`workflow.start` / `status` / `list` / `cancel` / `resume`).
- `WorkflowEventBus` now delegates bounded fan-in and overflow handling to core `createEventMultiplexer()`.
