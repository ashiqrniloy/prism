# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-workflows` (plan 168 Task 2): native package porting the 0.12 graph workflow engine out of `@arnilo/prism-core/runtime/workflows`. Definitions, revision hash, limits, Kahn and superstep scheduling, `functionNode`, `conditionalNode`, `routeNode`, `joinNode`, `loopNode`, `workflowNode`, checkpoints, suspend/resume, replay, and graph export. The `toolNode` kind is retired; a definition using `kind: "tool"` fails `defineWorkflow` with `WorkflowDefinitionError`. Sagas, schedules, the coordinator, swarm, commands, active-run status, and the 0.12 event facade stay behind. The package provides a `workflows` service and consumes `checkpoints`/`leases`, falling back to the in-memory defaults with an `info` status note.

- The `checkpoints` and `leases` service contracts (plan 168 Task 3): `CheckpointStore`, `LeaseStore`, their key/record/input/query types, `CheckpointConflictError`/`CHECKPOINT_CONFLICT_CODE`, `LeaseConflictError`/`LEASE_CONFLICT_CODE`, and the bounded in-memory defaults `createMemoryCheckpointStore`/`createMemoryLeaseStore`. `@arnilo/prism-workflows/testing` exports `checkpointConformance` and `leaseConformance`.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
