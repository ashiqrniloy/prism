# Workflows

## What it does

`@arnilo/prism-workflows` is an optional package for typed, bounded DAG orchestration over Prism sessions, tools, events, and persistence seams. Hosts define acyclic workflows with agent/function/tool/conditional/fan-out/join nodes; the package runs a Kahn-style scheduler with a bounded worker pool, emits package-local `WorkflowEvent`s, checkpoints progress, and can coordinate queued runs across multiple host processes using durable leases and fencing.

Primary exports:

| Export | Purpose |
| --- | --- |
| `defineWorkflow` / `buildGraph` | Validate definitions (acyclicity, edge refs, limits) and build deterministic successor/indegree maps |
| `agentNode`, `functionNode`, `toolNode`, `conditionalNode`, `fanOutNode`, `joinNode` | Typed node factories |
| `runWorkflow` / `resumeWorkflow` | Execute or resume a run with concurrency, abort, redaction, and optional checkpoints |
| `createMemoryWorkflowCheckpoints` | In-process `WorkflowCheckpointAdapter` over core `createMemoryCheckpointStore()` |
| `createWorkflowCheckpoints` | Adapt core `CheckpointStore` (including SQLite/PostgreSQL persistence capabilities) to workflow checkpoint shapes |
| `createWorkflowEventBus` | Bounded pub/sub for `WorkflowEvent` with overflow policy |
| `getWorkflowRun` / `listWorkflowRuns` / `cancelWorkflowRun` | Status, paginated list, and cancel helpers |
| `createWorkflowCommands` | Optional `CommandDefinition[]` for `runRpcServer` (`workflow.start` / `status` / `list` / `cancel` / `resume`) |
| `enqueueWorkflow` / `createWorkflowCoordinator` | Persist queued work and atomically claim/renew/execute it across processes using `LeaseStore` |

Included through `@arnilo/prism-sdk` and `@arnilo/prism-all`; installing either profile does not start workflows. Interactive TUI is out of scope (C-012 deferred).

## When to use it

Use this package when a host needs multi-node dependency scheduling, conditionals, bounded fan-out/join, retries/timeouts, workflow events, or checkpoint/resume — without putting graph vocabulary into core.

Use `createWorkflowCoordinator()` when multiple processes share SQLite/PostgreSQL persistence and must claim queued work exclusively. It is a database-backed coordinator, not a separate broker, DSL parser, provider abstraction, or terminal UI. Agent nodes call public `AgentSession.run()` only; tool nodes go through ordinary `ToolDefinition` dispatch and optional `ExecutionPolicy`.

## Inputs / request

`defineWorkflow({ id, nodes, edges, limits? })`:

| Field | Notes |
| --- | --- |
| `id` | Stable workflow id (required) |
| `nodes` | Record of node definitions (`kind` + typed fields) |
| `edges` | `[from, to]` pairs; must be acyclic; unknown ids rejected |
| `limits.maxNodes` | Default 1000 |
| `limits.maxFanOut` | Default 64 |
| `limits.maxConcurrency` | Default 8 |
| `limits.maxNodeOutputBytes` | Default 4 MiB |
| `limits.maxCheckpointBytes` | Default 1 MiB |

`runWorkflow(workflow, input, options?)`:

| Option | Notes |
| --- | --- |
| `concurrency` | Worker pool size (capped by workflow/global limits) |
| `checkpoints` | `WorkflowCheckpointAdapter` for save/load/list |
| `agentFactory` | `(agentName) => AgentSession` for agent nodes |
| `tools` | Tool registry/lookup for tool nodes |
| `executionPolicy` | Optional `ExecutionPolicy`; tool actions include `workflowId`/`nodeId` metadata |
| `runLedger` | Optional `RunLedger` for agent-event bridging |
| `ownership` | Tenant/account/user scope copied into checkpoints |
| `redactor` / `secrets` | Redaction before checkpoint persistence and event emission |
| `signal` | Cancels the run and in-flight agent sessions |
| `onEvent` | Synchronous `WorkflowEvent` sink |
| `runId` | Caller-supplied id; otherwise generated (`wfr_…`) |

`resumeWorkflow(workflow, { runId }, options)` loads the checkpoint, validates schema/version/tenant/`definitionHash`, and continues pending/ready nodes only.

`createWorkflowCoordinator({ coordinatorId, workflows, checkpoints, leases, ... })` polls queued/running checkpoints with bounded pages, atomically claims each run, renews its lease, and aborts/fences work after lease loss. Key controls: `leaseTtlMs` (default 30s), `renewalIntervalMs` (default TTL/3), `pollIntervalMs` (default 1s), `maxConcurrentRuns` (default 4), and `pageSize` (default 100, maximum 500).

## Outputs / response / events

`runWorkflow` / `resumeWorkflow` resolve to `WorkflowRunResult`:

| Field | Notes |
| --- | --- |
| `runId`, `workflowId`, `status` | `succeeded` / `failed` / `aborted` |
| `outputs` | Map of succeeded node outputs |
| `error` | First fail-fast error when status is `failed` |
| `version`, `definitionHash`, `createdAt`, `updatedAt` | Checkpoint identity |

Package-local `WorkflowEvent` types: `workflow_started`, `workflow_finished`, `node_started`, `node_finished`, `node_failed`, `node_skipped`, `checkpoint_saved`, `agent_event` (wraps a redacted `AgentEvent`), `workflow_event_overflow`. Sequences are monotonic; drain/order is deterministic by `(sequence, nodeId)`.

## Request/response example

```json
{
  "id": "research-draft",
  "nodes": ["research", "draft"],
  "edges": [["research", "draft"]],
  "limits": { "maxNodes": 256, "maxFanOut": 32, "maxConcurrency": 4 }
}
```

Successful run shape:

```json
{
  "runId": "wfr_01HZX…",
  "workflowId": "research-draft",
  "status": "succeeded",
  "outputs": { "research": "…", "draft": "…" },
  "version": 3
}
```

## Implementation example

```ts
import {
  defineWorkflow,
  runWorkflow,
  resumeWorkflow,
  functionNode,
  agentNode,
  createWorkflowCheckpoints,
  createWorkflowCommands,
  cancelWorkflowRun,
  enqueueWorkflow,
  createWorkflowCoordinator,
} from "@arnilo/prism-workflows";
import { runRpcServer } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";

const research = agentNode({
  agent: "researcher",
  input: (ctx) => ctx.workflowInput,
});
const draft = functionNode({
  execute: async (ctx) => `Draft from ${String(ctx.upstream.research)}`,
});

const workflow = defineWorkflow({
  id: "research-draft",
  nodes: { research, draft },
  edges: [["research", "draft"]],
  limits: { maxNodes: 256, maxFanOut: 32, maxConcurrency: 4 },
});

const persistence = createSqlitePersistence({ filename: "prism.db" });
const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints });

const queued = await enqueueWorkflow(workflow, { topic: "hooks" }, {
  checkpoints,
  ownership: { tenantId: "t1" },
});
const coordinator = createWorkflowCoordinator({
  coordinatorId: process.env.HOSTNAME ?? "worker-1",
  workflows: { [workflow.id]: workflow },
  checkpoints,
  leases: persistence.leases,
  ownership: { tenantId: "t1" },
  runOptions: { agentFactory: (name) => agents.resolve(name).createSession() },
  maxConcurrentRuns: 4,
});
await coordinator.run({ signal: shutdownSignal });

// Direct single-process execution remains available:
const result = await runWorkflow(workflow, { topic: "hooks" }, {
  agentFactory: (name) => agents.resolve(name).createSession(),
  checkpoints,
  ownership: { tenantId: "t1" },
  signal: AbortSignal.timeout(60_000),
  onEvent: (event) => sink.push(event),
});

// Durable resume after process restart (reopen persistence, then adapt its store):
await resumeWorkflow(workflow, { runId: result.runId }, {
  checkpoints,
  agentFactory: (name) => agents.resolve(name).createSession(),
  ownership: { tenantId: "t1" },
});

await cancelWorkflowRun({
  workflowId: workflow.id,
  runId: result.runId,
  checkpoints,
  ownership: { tenantId: "t1" },
});

// Optional host control via existing CLI/RPC CommandDefinition seam:
runRpcServer({
  createSession,
  commands: createWorkflowCommands({
    workflows: { [workflow.id]: workflow },
    checkpoints,
    runOptions: { ownership: { tenantId: "t1" }, agentFactory },
  }),
});
```

## Extension and configuration notes

- Workflow semantics stay in this optional package; generic checkpoint persistence and bounded event fan-in live in core.
- `ProductionPersistenceStore.checkpoints` and `.leases` are optional generic capabilities. First-party SQLite/PostgreSQL adapters own `prism_checkpoints` / `prism_leases`; workflows only adapt them.
- `createWorkflowEventBus()` delegates queueing, source fan-in, overflow, abort, and close behavior to core `createEventMultiplexer()`.
- `createWorkflowCommands()` is optional; hosts that already use `runRpcServer({ commands })` can drive start/status/list/cancel/resume without a TUI.
- Hosts may bridge `WorkflowEvent` into OpenTelemetry or custom sinks; there is no built-in TUI.
- Agent exclusivity is per session: one active `run()` at a time, same as core.

## Security and performance notes

- Definitions fail closed on cycles, unknown edges, self-edges, and `maxNodes` overflow.
- Fan-out length is bounded by `maxFanOut`; concurrency by `maxConcurrency`.
- Node outputs and checkpoints are byte-bounded (`maxNodeOutputBytes`, `maxCheckpointBytes`).
- Event buses use a bounded buffer (default 2048) with `close` / `drop_oldest` / `drop_newest` overflow.
- Checkpoints redact via `SecretRedactor` / `secrets` before save; resume rejects tenant, schema, and definition-hash mismatch.
- `cancelWorkflowRun` aborts local runs immediately and writes a durable cancellation request for a remotely leased run; workers check it during lease renewal.
- Tool nodes attach `workflowId` / `nodeId` on `ExecutionAction.metadata` for approval/audit context.
- Scheduler stores O(nodes + active outputs); ready-node work uses indegree maps, not repeated full scans.
- Lease acquisition is atomic; opaque tokens protect renew/release; monotonically increasing fencing tokens plus checkpoint compare-and-swap prevent expired workers from committing after takeover. Node functions must honor `ctx.signal` for prompt cooperative cancellation.

## Related APIs

- Examples: `examples/workflow-research-and-review.ts`, `examples/workflow-parallel-research.ts`, `examples/workflow-tool-approval.ts`, `examples/workflow-multimodal-document.ts`, `examples/workflow-sqlite-resume.ts`, `examples/workflow-postgres-resume.ts`, `examples/workflow-event-sink.ts`, `examples/workflow-rpc-cancel.ts`, `examples/workflow-distributed-coordinator.ts` — offline runnable demos; PostgreSQL safely skips unless `PRISM_TEST_POSTGRES_URL` is set.
- [Workflow orchestration primitives](workflow-orchestration-primitives.md): Task 0–1 inventory and locked adapter contracts
- [Agent/session runtime](agent-session-runtime.md): `AgentSession.run()`, abort, subscribe
- [Agent events](agent-events.md): core `AgentEvent` wrapped by `agent_event`
- [Session stores and branching](session-stores-and-branching.md): session `leafId` reuse on resume
- [CLI/RPC](cli-rpc.md): host control seam; wire `createWorkflowCommands()` into `runRpcServer`
- [Database persistence](database-persistence.md): generic `CheckpointStore` and `LeaseStore` capabilities
- [SQLite persistence](sqlite-persistence.md): durable `persistence.checkpoints`
- [PostgreSQL persistence](postgres-persistence.md): durable `persistence.checkpoints`
- [Observability](observability.md): exporting workflow/agent events
- [Coding execution approval and sandboxing](coding-security.md): `ExecutionPolicy` for tool nodes
- [Release and install](release-and-install.md): atomic and profile installs
