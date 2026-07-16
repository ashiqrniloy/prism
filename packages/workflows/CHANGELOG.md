# Changelog

## [Unreleased]

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
