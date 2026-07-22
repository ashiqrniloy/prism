# Workflows

## What it does

`@arnilo/prism-workflows` is an optional package for typed, bounded DAG orchestration over Prism sessions, tools, events, and persistence seams. Hosts define acyclic workflows with agent/function/tool/conditional/fan-out/join/nested-workflow nodes; the package runs a Kahn-style scheduler with a bounded worker pool, emits package-local `WorkflowEvent`s, checkpoints progress, and can coordinate queued runs across multiple host processes using durable leases and fencing.

Primary exports:

| Export | Purpose |
| --- | --- |
| `defineWorkflow` / `buildGraph` | Validate definitions (acyclicity, edge refs, limits) and build deterministic successor/indegree maps |
| `agentNode`, `functionNode`, `toolNode`, `conditionalNode`, `fanOutNode`, `joinNode`, `workflowNode` | Typed node factories, including composition through the same runner |
| `runWorkflow` / `resumeWorkflow` / `suspend` / `replayWorkflow` | Execute, durably suspend, exactly-once resume, or create an immutable-lineage replay from a succeeded node |
| `createMemoryWorkflowCheckpoints` | In-process `WorkflowCheckpointAdapter` over core `createMemoryCheckpointStore()` |
| `createWorkflowCheckpoints` | Adapt core `CheckpointStore` (including SQLite/PostgreSQL persistence capabilities) to workflow checkpoint shapes |
| `createWorkflowEventBus` | Bounded pub/sub for `WorkflowEvent` with overflow policy |
| `getWorkflowRun` / `listWorkflowRuns` / `cancelWorkflowRun` | Status, paginated list, and cancel helpers |
| `createWorkflowCommands` | Optional `CommandDefinition[]` for direct/background/replay/status/list/cancel/resume and, when selected, schedule control |
| `enqueueWorkflow` / `startWorkflowBackground` / `createWorkflowCoordinator` | Persist queued work and atomically claim/renew/execute it across processes using `LeaseStore` |
| `createWorkflowSchedules` | Explicit ownership-scoped one-time/interval/host-calculated schedules over existing checkpoint/lease stores |

Included through `@arnilo/prism-sdk` and `@arnilo/prism-all`; installing either profile does not start workflows. Interactive TUI is out of scope (C-012 deferred).

## When to use it

Use this package when a host needs multi-node dependency scheduling, conditionals, bounded fan-out/join, retries/timeouts, workflow events, or checkpoint/resume — without putting graph vocabulary into core.

Use `createWorkflowCoordinator()` when multiple processes share SQLite/PostgreSQL persistence and must claim queued work exclusively. It is a database-backed coordinator, not a separate broker, DSL parser, provider abstraction, or terminal UI. Agent nodes call public `AgentSession.run()` only; tool nodes go through ordinary `ToolDefinition` dispatch and optional `ExecutionPolicy`.

## Inputs / request

`defineWorkflow({ id, revision, nodes, edges, limits? })`:

| Field | Notes |
| --- | --- |
| `id` | Stable workflow id (required) |
| `revision` | Non-empty host-authored definition revision (required); parent and nested revisions enter `definitionHash` |
| `nodes` | Record of node definitions (`kind` + typed fields) |
| `edges` | `[from, to]` pairs; must be acyclic; unknown ids rejected |
| `limits.maxNodes` | Default 1,000 / hard cap 10,000 |
| `limits.maxFanOut` | Default 64 / hard cap 1,024 |
| `limits.maxConcurrency` | Default 8 / hard cap 256 |
| `limits.maxNodeOutputBytes` | Default 4 MiB / hard cap 16 MiB |
| `limits.maxCheckpointBytes` | Default 1 MiB / hard cap 8 MiB |
| `limits.maxNestedDepth` / hard cap | 8 / 32; inherited by child workflows |
| `limits.maxStateBytes` / hard cap | 64 KiB / 512 KiB |
| `limits.maxStateHistory` / hard cap | 32 / 128 state snapshots; updates stop before evidence would be discarded |
| `limits.maxReplayDepth` / hard cap | 8 / 32 lineage generations |
| `state.initial` / `state.schema` | Initial shared JSON object and optional host-validated schema |

All workflow limits and runtime `concurrency` reject non-safe integers, zero, negatives, NaN, `Infinity`, and values above the named hard cap. Node retries allow 0–100; an explicit node timeout allows 1–86,400,000 ms. Omitting `timeoutMs` remains an explicit host choice.

`runWorkflow(workflow, input, options?)`:

| Option | Notes |
| --- | --- |
| `concurrency` | Worker pool size; positive safe integer, hard cap 256, and capped by the workflow limit |
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
| `resume` | For suspended runs: `{ decision: "approve" | "deny", input?, expectedVersion }`; version is mandatory for an exact-once CAS claim |
| `validateResume` | Host validator for resume input; required when `suspend()` declares `resumeSchema` |
| `validateState` | Host validator for every initial/restored/updated state; required when workflow declares `state.schema` |
| `initialState` | Optional host initial state override; nested workflows receive parent state automatically |

A function node returns `suspend({ reason, data?, resumeSchema? })` to persist `status: "suspended"`. Its next invocation receives `ctx.resume` only after an approved resume. `resumeWorkflow(workflow, { runId }, options)` validates schema/version/ownership/`definitionHash`, claims the checkpoint before node execution, and continues the suspended node. Denial persists terminal `denied` status without invoking it. Existing failed/aborted checkpoint resume remains available without a human decision.

Coding-agent ask-user glue (opt-in, no Goal DB): `suspendAskUserDecision(request)` wraps `suspend` with durable question/options/`selectionMode`/`allowCustom` data + resume schema; resume with `createAskUserDecisionResumeValidator()` or `validateAskUserDecisionResume`. Goal→verify: `runCodingGoalVerify` / `createCodingGoalVerifyWorkflow` compose plan Markdown → named checks → approve suspend → bounded handoff over the same primitives (`examples/coding-goal-verify.ts`).

Every node receives bounded `ctx.state`, `ctx.stateVersion`, and async `ctx.updateState(patch, { mode: "merge" | "replace" })`. Updates serialize, validate, redact, and snapshot before checkpoint save. `workflowNode({ workflow })` runs its child with the same ownership, agent/tool registries, execution policy, redactor, signal, checkpoints, and event bus; child state replaces parent state after success.

`replayWorkflow(workflow, { sourceRunId, fromNodeId, runId? }, options)` requires a succeeded source/node, creates a new checkpoint, copies terminal evidence outside the selected node's downstream closure, restores selected-node pre-state, and records `{ sourceRunId, fromNodeId, rootRunId, depth }`. Source evidence is untouched. Copying any prior nested/tool approval is rejected; replay from that approval node or earlier so Phase 8 approval executes again.

`createWorkflowCoordinator({ coordinatorId, workflows, checkpoints, leases, ... })` polls queued/running checkpoints with bounded pages, atomically claims each run, renews its lease, and aborts/fences work after lease loss. Key controls: `leaseTtlMs` (default 30s), `renewalIntervalMs` (default TTL/3), `pollIntervalMs` (default 1s), `maxConcurrentRuns` (default 4), and `pageSize` (default 100, maximum 500).

`createWorkflowSchedules({ store, leases, checkpoints, workflows, ownership, ownerId, calculators? })` is inert until its host calls `pollOnce()` or `run({ signal })`. Ownership requires `tenantId` plus `accountId` or `userId`. Methods are `create`, `get`, `list`, `pause`, `resume`, `trigger`, `delete`, `pollOnce`, and `run`. A record has one required `nextRunAt`, optional fixed `intervalMs` or registered `calculatorId` (never both), bounded input/metadata, status, version, and last-fire attribution. Manual trigger requires an idempotency key. Scheduled run IDs derive from schedule ID plus fire timestamp, so retry after enqueue-before-advance finds the same queued checkpoint instead of duplicating it. Defaults: page 100/hard 500, due claims 16/hard 256, input 256 KiB/hard 1 MiB, poll 1s, fire lease 30s.

## Outputs / response / events

`runWorkflow` / `resumeWorkflow` resolve to `WorkflowRunResult`:

| Field | Notes |
| --- | --- |
| `runId`, `workflowId`, `status` | `queued` / `running` / `suspended` / `succeeded` / `failed` / `denied` / `aborted` |
| `outputs` | Map of succeeded node outputs |
| `state` | Final/current bounded shared JSON state |
| `lineage` | Replay source/root/node/depth record when this is a replay |
| `suspension` | Current/persisted `{ nodeId, reason, data?, resumeSchema?, requestedAt }` |
| `resume` | Attributable resume decision/input/version/time record |
| `version` | Checkpoint CAS identity shown to reviewers and required on suspended resume |

Schedule `onEvent` receives bounded-attribution `schedule_fired` or metadata-only `schedule_failed`; schedule input is never copied into these events.

Package-local `WorkflowEvent` types: `workflow_started`, `workflow_suspended`, `workflow_resumed`, `workflow_finished`, `node_started`, `node_finished`, `node_failed`, `node_skipped`, `checkpoint_saved`, `agent_event` (wraps a redacted `AgentEvent`), `workflow_event_overflow`. Sequences are monotonic; drain/order is deterministic by `(sequence, nodeId)`.

## Request/response example

```json
{
  "id": "research-draft",
  "revision": "2026-07-19.1",
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
  createWorkflowSchedules,
  replayWorkflow,
  workflowNode,
  suspend,
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
const publish = functionNode({
  execute: async (ctx) => ctx.resume
    ? publishDraft(ctx.upstream.draft, ctx.resume.input)
    : suspend({
        reason: "publish",
        data: { draft: ctx.upstream.draft },
        resumeSchema: { type: "object", required: ["reviewer"] },
      }),
});

const workflow = defineWorkflow({
  id: "research-draft",
  revision: "2026-07-19.1",
  nodes: { research, draft, publish },
  edges: [["research", "draft"], ["draft", "publish"]],
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

// Durable human resume after process restart. Use result.version shown to reviewer.
if (result.status === "suspended") {
  await resumeWorkflow(workflow, { runId: result.runId }, {
    checkpoints,
    agentFactory: (name) => agents.resolve(name).createSession(),
    ownership: { tenantId: "t1" },
    resume: {
      decision: "approve",
      input: { reviewer: "Ada" },
      expectedVersion: result.version,
    },
    validateResume: ({ value }) => validateResumePayload(value),
  });
}

await cancelWorkflowRun({
  workflowId: workflow.id,
  runId: result.runId,
  workflow,
  checkpoints,
  ownership: { tenantId: "t1" },
});

// Optional host control via existing CLI/RPC CommandDefinition seam:
const schedules = createWorkflowSchedules({
  store: persistence.checkpoints,
  leases: persistence.leases,
  checkpoints,
  workflows: { [workflow.id]: workflow },
  ownership: { tenantId: "t1", userId: "ops" },
  ownerId: process.env.HOSTNAME ?? "scheduler-1",
});
await schedules.create({
  id: "daily-research",
  workflowId: workflow.id,
  nextRunAt: "2026-07-17T00:00:00.000Z",
  intervalMs: 86_400_000,
  input: { topic: "hooks" },
});
// Host calls schedules.pollOnce() from an existing timer, or explicitly starts schedules.run({ signal }).

const replay = await replayWorkflow(workflow, {
  sourceRunId: result.runId,
  fromNodeId: "draft",
}, { checkpoints, ownership: { tenantId: "t1" }, agentFactory });

runRpcServer({
  createSession,
  commands: createWorkflowCommands({
    workflows: { [workflow.id]: workflow },
    checkpoints,
    schedules,
    runOptions: { ownership: { tenantId: "t1" }, agentFactory },
  }),
});
```

## Extension and configuration notes

- Workflow semantics stay in this optional package; generic checkpoint persistence and bounded event fan-in live in core.
- `ProductionPersistenceStore.checkpoints` and `.leases` are optional generic capabilities. First-party SQLite/PostgreSQL adapters own `prism_checkpoints` / `prism_leases`; workflows only adapt them.
- `createWorkflowEventBus()` delegates queueing, source fan-in, overflow, abort, and close behavior to core `createEventMultiplexer()`.
- `createWorkflowCommands()` is optional; hosts can drive `workflow.start` / `enqueue` / `replay` / `status` / `list` / `cancel` / `resume`. The six `schedule.*` commands appear only when a scoped `schedules` service is supplied.
- Hosts may bridge `WorkflowEvent` into OpenTelemetry or custom sinks; there is no built-in TUI.
- Agent exclusivity is per session: one active `run()` at a time, same as core.

## Security and performance notes

- Definitions require a non-empty host-authored `revision` and fail closed on cycles, unknown edges, self-edges, invalid limits, and `maxNodes` overflow. Revision and every nested revision enter the deterministic definition hash; hosts must bump revision when function/tool behavior changes.
- Fan-out length is bounded by `maxFanOut`; concurrency by `maxConcurrency`; every count/byte/runtime option has a finite hard cap.
- Node outputs, shared state/history, schedule input/records, and checkpoints are byte/count/depth bounded. Checkpoint size remains the final aggregate ceiling.
- Event buses use a bounded buffer (default 2048) with `close` / `drop_oldest` / `drop_newest` overflow.
- Checkpoints redact suspension/resume payloads via `SecretRedactor` / `secrets` before save; resume rejects tenant, schema, definition-hash, and expected-version mismatch.
- Suspension requires a checkpoint adapter, consumes no worker/polling slot, and is ignored by distributed coordinators until explicit resume.
- Concurrent resumes race on checkpoint CAS before node execution; one wins and stale/duplicate reviewers fail closed. Approved tool nodes then re-run current `ExecutionPolicy`, so durable approval cannot grant stale permissions.
- `toolNode({ approval: { reason, data?, resumeSchema? } })` suspends before tool execution. Denial is terminal `denied`; no tool side effect occurs.
- `cancelWorkflowRun` requires the current workflow definition and exact tenant/account/user ownership. It verifies recursive definition hash before abort/mutation, then aborts local runs or writes a durable cancellation request for remotely leased work. Tenant-only or missing ownership cannot cancel a more-specific owned run.
- Active registry identity includes workflow ID, run ID, and exact ownership. Exact duplicates fail instead of overwriting; distinct owners remain isolated in lookup/list/cancel/unregister.
- Tool nodes attach `workflowId` / `nodeId` on `ExecutionAction.metadata` for approval/audit context.
- Nested workflows inherit host registries/policies and cannot inject broader tools, agents, ownership, or credentials. Nested depth is inherited; child suspension bubbles to the parent review cursor.
- Replay source ownership/hash/status/node eligibility are checked before a new checkpoint is created. Source records are immutable, lineage is bounded, and copied approval-bearing paths are rejected.
- Schedule services are ownership-scoped and explicitly started. Per-fire leases plus deterministic run IDs/CAS prevent duplicate enqueue across coordinators and crash retry. Host calculator IDs resolve only from the supplied map; no callback or cron expression is persisted.
- Scheduler stores O(nodes + active outputs + bounded state history); ready-node work uses indegree maps, not repeated full scans.
- Lease acquisition is atomic; opaque tokens protect renew/release; monotonically increasing fencing tokens plus checkpoint compare-and-swap prevent expired workers from committing after takeover. Node functions must honor `ctx.signal` for prompt cooperative cancellation.

Use workflows for known, durable, replayable graphs. Use optional supervisor delegation only when child selection must be dynamic at runtime; do not replace deterministic nodes with model routing without a concrete need.

## Related APIs

- Examples: `examples/workflow-research-and-review.ts`, `examples/workflow-parallel-research.ts`, `examples/workflow-tool-approval.ts`, `examples/workflow-multimodal-document.ts`, `examples/workflow-sqlite-resume.ts`, `examples/workflow-postgres-resume.ts`, `examples/workflow-event-sink.ts`, `examples/workflow-rpc-cancel.ts`, `examples/workflow-distributed-coordinator.ts` — offline runnable demos; PostgreSQL safely skips unless `PRISM_TEST_POSTGRES_URL` is set.
- [Workflow orchestration primitives](workflow-orchestration-primitives.md): Task 0–1 inventory and locked adapter contracts
- [Agent/session runtime](agent-session-runtime.md): `AgentSession.run()`/`stream()`, abort, subscribe
- [Guardrails](guardrails.md): `RunWorkflowOptions.guardrails` routes tool nodes through core dispatch before policy and side effects.
- [Supervisor delegation](supervisors.md): bounded dynamic child selection.
- [A2A interoperability](a2a.md): hosts may adapt existing exact-owner workflow status/list/cancel/checkpoint/event surfaces to `A2ATaskLifecycle`; A2A package adds no workflow worker, queue, or schema.
- [Agent events](agent-events.md): core `AgentEvent` wrapped by `agent_event`
- [Session stores and branching](session-stores-and-branching.md): session `leafId` reuse on resume
- [CLI/RPC](cli-rpc.md): host control seam; wire `createWorkflowCommands()` into `runRpcServer`
- [Database persistence](database-persistence.md): generic `CheckpointStore` and `LeaseStore` capabilities
- [SQLite persistence](sqlite-persistence.md): durable `persistence.checkpoints`
- [PostgreSQL persistence](postgres-persistence.md): durable `persistence.checkpoints`
- [Observability](observability.md): exporting workflow/agent events
- [Coding execution approval and sandboxing](coding-security.md): `ExecutionPolicy` for tool nodes
- [Coding agent tools](coding-agent-tools.md): opt-in `createGitTools()` / `git_pr_handoff` produce bounded host-owned PR payloads; durable coding plans/todos are workspace Markdown plus `state.coding` metadata helpers — workflows may compose them for restart/resume/background branches but Prism never pushes or opens PRs
- [Release and install](release-and-install.md): atomic and profile installs
