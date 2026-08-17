# @arnilo/prism-workflows

Optional typed bounded DAG workflow orchestration for Prism. Defines acyclic and nested workflows, schedules dependency-ready nodes with a Kahn worker pool, supports bounded shared state and immutable-lineage replay, emits package-local `WorkflowEvent`s, and adds linear durable sagas with reverse compensation/reconciliation. Agent nodes call public `AgentSession.run()` only. `RunWorkflowOptions.guardrails` routes tool nodes through core tool dispatch; see root [Guardrails](../../docs/guardrails.md) guide.

Included through `@arnilo/prism-sdk` and `@arnilo/prism-all`, or install explicitly when only workflow orchestration is needed.

## Install

```bash
npm install @arnilo/prism-workflows @arnilo/prism
```

## Usage

```ts
import {
  defineWorkflow,
  runWorkflow,
  functionNode,
  agentNode,
  createMemoryWorkflowCheckpoints,
  resumeWorkflow,
  suspend,
} from "@arnilo/prism-workflows";

const research = agentNode({
  agent: "researcher",
  input: (ctx) => ctx.workflowInput,
});
const draft = functionNode({
  execute: async (ctx) => ctx.resume
    ? publish(ctx.resume.input)
    : suspend({ reason: "publish", data: { draft: ctx.upstream.research } }),
});

const workflow = defineWorkflow({
  id: "research-draft",
  revision: "2026-07-19.1",
  nodes: { research, draft },
  edges: [["research", "draft"]],
  limits: { maxNodes: 256, maxFanOut: 32, maxConcurrency: 4 },
});

const checkpoints = createMemoryWorkflowCheckpoints();
const result = await runWorkflow(workflow, { topic: "hooks" }, {
  agentFactory: (name) => agents.resolve(name).createSession(),
  checkpoints,
  ownership: { tenantId: "t1" },
  signal: AbortSignal.timeout(60_000),
  onEvent: (event) => console.log(event.type, event),
});
```

### Durable linear saga

```ts
import { createMemoryLeaseStore } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  defineSaga,
  runSaga,
} from "@arnilo/prism-workflows";

const invoiceSaga = defineSaga({
  id: "post-invoice",
  revision: "1",
  steps: [{
    id: "reserve-budget",
    run: ({ operationId, input }) => reserve(input, operationId),
    compensate: ({ operationId, output }) => release(output, operationId),
    reconcile: ({ operationId, phase }) => lookupReservation(operationId, phase),
  }],
});

const result = await runSaga(invoiceSaga, {
  checkpoints: createMemoryWorkflowCheckpoints(), // use createWorkflowCheckpoints({ store: persistence.checkpoints }) in production
  leases: createMemoryLeaseStore(),
  ownerId: "worker-1",
  tenantId: "tenant-1",
  runId: "invoice-1",
  input: { invoiceId: "inv-1" },
  onEvent: (event) => metrics.record(event),
});
```

Each step needs stable operation keys, `compensate`, and `reconcile`. Throw an error with `unknown: true` (or `code: "ERR_PRISM_SAGA_UNKNOWN"`) for an ambiguous external outcome; reconciliation runs before retry. `resumeSaga` takes over after lease expiry. Manual resolution requires current checkpoint version, active verified `AgentIdentity`, reason, and host audit reference. Compensation is not database rollback and delivery is not exactly-once.

## Node kinds

| Kind | Factory | Behavior |
| --- | --- | --- |
| `agent` | `agentNode` | Runs `AgentSession` from `agentFactory` |
| `function` | `functionNode` | Host async function |
| `tool` | `toolNode` | Dispatches a `ToolDefinition` after `ExecutionPolicy` check |
| `conditional` | `conditionalNode` | Predicate; skips successors via `then`/`else` |
| `fan_out` | `fanOutNode` | Bounded map over a list |
| `join` | `joinNode` | Reduces an upstream array |

## Limits (defaults)

| Limit | Default / hard cap |
| --- | ---: |
| `maxNodes` | 1,000 / 10,000 |
| `maxFanOut` | 64 / 1,024 |
| `maxConcurrency` | 8 / 256 |
| `maxNodeOutputBytes` | 4 MiB / 16 MiB |
| `maxCheckpointBytes` | 1 MiB / 8 MiB |
| event buffer | 2048 |

## Checkpointing and host control

- `createMemoryWorkflowCheckpoints()` — in-process resume over core `createMemoryCheckpointStore()`
- `createWorkflowCheckpoints({ store: persistence.checkpoints })` — durable resume through generic core `CheckpointStore`
- SQLite/PostgreSQL checkpoint tables and queries are owned by their persistence packages, not this workflow package
- `suspend()` — persist human review data and release the worker; approved resume requires checkpoint `expectedVersion`
- `toolNode({ approval })` — suspend before tool side effects, then recheck current `ExecutionPolicy` after approval
- `cancelWorkflowRun({ workflow, ownership, ... })` — verify current recursive definition hash and exact ownership before aborting in-flight/suspended runs or marking orphaned checkpoints `aborted`
- `createWorkflowCommands()` — optional RPC/MCP commands for direct/background/replay/status/list/cancel/resume plus selected schedules
- `workflowNode()` — nested execution through the same runner with inherited ownership/tools/policy/abort/checkpoints
- `ctx.updateState()` — merge/replace bounded shared JSON state with optional host validation
- `replayWorkflow()` — new run from a succeeded node with immutable source lineage and fresh approval enforcement
- `createWorkflowSchedules()` — ownership-scoped one-time/interval/host-calculated durable schedules; host explicitly starts polling
- `enqueueWorkflow()` + `createWorkflowCoordinator()` — bounded multi-process polling, atomic lease claims, heartbeat renewal, expiry takeover, and durable remote cancellation through `persistence.leases`

## Security

- Definitions require a non-empty host-authored `revision`; parent/nested revisions enter checkpoint identity. Limits reject non-finite/unsafe/out-of-range values before scheduling.
- Active runs are keyed by workflow/run/exact ownership; duplicate exact registrations fail and partial ownership cannot cancel a more-specific run.
- Tool nodes attach `workflowId` / `nodeId` to `ExecutionAction.metadata`.
- Checkpoints redact via `SecretRedactor` / `secrets` and enforce byte bounds.
- Suspended resume fails closed on tenant, schema, definition hash, validation, and stale/duplicate expected version; payloads are redacted before persistence.
- Cancellation uses `AbortSignal` / active-run registry and aborts in-flight agent sessions.
- Distributed workers use opaque lease tokens, ownership scopes, checkpoint CAS, and monotonic fencing tokens; stale workers cannot commit after takeover.
- Sagas persist only bounded JSON state through `WorkflowCheckpointAdapter` over core `CheckpointStore`; step definitions and handlers remain host code. Forward and compensation cursors are durable, and only durably succeeded steps compensate in reverse order.
- Saga retries are capped (default 3 / hard 10). Ambiguous forward or compensation outcomes require `reconcile`; unresolved outcomes stop at `manual_intervention` instead of guessing. Stable operation keys make host handlers idempotency-aware but do not claim exactly-once effects.
- Saga records require tenant ownership. Input/output/error snapshots pass the configured `SecretRedactor` before checkpointing or compensation; manual resolution checks active verified identity, exact checkpoint version, bounded reason, and an audit reference; Prism records the reference but the host owns the audit ledger.

See [Workflows](../../docs/workflows.md) and [Workflow orchestration primitives](../../docs/workflow-orchestration-primitives.md).
