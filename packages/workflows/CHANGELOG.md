# Changelog

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
