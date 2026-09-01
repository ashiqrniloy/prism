# Workflows

## What it does

`@arnilo/prism-workflows` is an optional package for typed, bounded DAG orchestration over Prism sessions, tools, events, and persistence seams. Hosts define acyclic workflows with agent/function/tool/conditional/fan-out/join/nested-workflow/loop nodes; the package runs a Kahn-style scheduler with a bounded worker pool, emits package-local `WorkflowEvent`s, checkpoints progress, can coordinate queued runs across multiple host processes using durable leases and fencing, and can run bounded linear sagas with durable compensation.

Primary exports:

| Export | Purpose |
| --- | --- |
| `defineWorkflow` / `buildGraph` | Validate definitions (acyclicity, edge refs, limits) and build deterministic successor/indegree maps |
| `agentNode`, `functionNode`, `loopNode`, `toolNode`, `conditionalNode`, `fanOutNode`, `joinNode`, `workflowNode` | Typed node factories, including bounded iterative refinement and composition through the same runner |
| `runWorkflow` / `resumeWorkflow` / `suspend` / `replayWorkflow` | Execute, durably suspend, exactly-once resume, or create an immutable-lineage replay from a succeeded node |
| `createMemoryWorkflowCheckpoints` | In-process `WorkflowCheckpointAdapter` over core `createMemoryCheckpointStore()` |
| `createWorkflowCheckpoints` | Adapt core `CheckpointStore` (including SQLite/PostgreSQL persistence capabilities) to workflow checkpoint shapes |
| `createWorkflowEventBus` | Bounded pub/sub for `WorkflowEvent` with overflow policy |
| `getWorkflowRun` / `listWorkflowRuns` / `cancelWorkflowRun` | Status, paginated list, and cancel helpers |
| `createWorkflowCommands` | Optional `CommandDefinition[]` for direct/background/replay/status/list/cancel/resume and, when selected, schedule control |
| `enqueueWorkflow` / `startWorkflowBackground` / `createWorkflowCoordinator` | Persist queued work and atomically claim/renew/execute it across processes using `LeaseStore` |
| `defineSaga` / `runSaga` / `resumeSaga` | Bounded linear durable forward steps, reverse compensation, unknown-outcome reconciliation, lease fencing, and manual resolution over existing checkpoint/lease stores |
| `createWorkflowSchedules` | Explicit ownership-scoped one-time/interval/host-calculated schedules over existing checkpoint/lease stores |
| `createProactiveScheduleCapabilities` | Scoped, expiring, revocable capability tokens that enable proactive schedules; revocation stops firing fail-closed |

Included through `@arnilo/prism-sdk` and `@arnilo/prism-all`; installing either profile does not start workflows. Interactive TUI is out of scope (C-012 deferred).

## When to use it

Use this package when a host needs multi-node dependency scheduling, conditionals, bounded fan-out/join, retries/timeouts, workflow events, or checkpoint/resume — without putting graph vocabulary into core.

Use `createWorkflowCoordinator()` when multiple processes share SQLite/PostgreSQL persistence and must claim queued work exclusively. It is a database-backed coordinator, not a separate broker, DSL parser, provider abstraction, or terminal UI. Agent nodes call public `AgentSession.run()` only; tool nodes go through ordinary `ToolDefinition` dispatch and optional `ExecutionPolicy`.

Use `defineSaga`/`runSaga` for a linear business sequence whose remote effects need explicit reverse compensation. Sagas are not a second scheduler or rollback engine: hosts supply handlers, `WorkflowCheckpointAdapter` persists bounded state, and `LeaseStore` fences one owner at a time.

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
| loop `maxIterations` | Required per loop / hard cap 64 |
| `state.initial` / `state.schema` | Initial shared JSON object and optional host-validated schema |

### Node kinds

| Kind | Factory | Behavior |
| --- | --- | --- |
| `agent` | `agentNode` | Runs `AgentSession` from `agentFactory` |
| `function` | `functionNode` | Runs one host async function |
| `loop` | `loopNode` | Runs one bounded inline or function/tool body repeatedly until `until(ctx)` is true |
| `tool` | `toolNode` | Dispatches one registered tool, optionally behind durable approval |
| `conditional` | `conditionalNode` | Evaluates a predicate and skips configured successors |
| `fan_out` | `fanOutNode` | Maps a bounded list with workflow concurrency |
| `join` | `joinNode` | Reduces an upstream array |
| `workflow` | `workflowNode` | Runs a nested workflow with inherited capabilities |

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

> **Contract — resume-aware nodes.** After an approved resume, the **same** node's `execute` is re-invoked with `ctx.resume`. Returning `suspend(...)` unconditionally re-suspends silently; downstream nodes never run. Branch on `ctx.resume`:
>
> ```ts
> execute: async (ctx) => ctx.resume
>   ? handle(ctx.resume)
>   : suspendAskUserDecision({ ... }),
> ```
>
> Live demo: [`examples/autonomous-coding-loop.ts`](../examples/autonomous-coding-loop.ts) (`gate` node).

Coding-agent ask-user glue (opt-in, no Goal DB): `suspendAskUserDecision(request)` wraps `suspend` with durable question/options/`selectionMode`/`allowCustom` data + resume schema; resume with `createAskUserDecisionResumeValidator()` or `validateAskUserDecisionResume`. Goal→verify: `runCodingGoalVerify` / `createCodingGoalVerifyWorkflow` compose plan Markdown → named checks → approve suspend → bounded handoff over the same primitives (`examples/coding-goal-verify.ts`). When a workflow node wraps a durable agent run, that run's shared pending-decision batch (Task 2) is the approval authority — workflow `suspend`/`resume` stay workflow-scoped and do not mint a parallel decision store.

Every node receives bounded `ctx.state`, `ctx.stateVersion`, and async `ctx.updateState(patch, { mode: "merge" | "replace" })`. Updates serialize, validate, redact, and snapshot before checkpoint save. A rejected state or checkpoint write stays rejected (nothing committed) and recovers the per-run chain so a later valid write can run. `workflowNode({ workflow })` runs its child with the same ownership, agent/tool registries, execution policy, redactor, signal, checkpoints, and event bus; child state replaces parent state after success.

`replayWorkflow(workflow, { sourceRunId, fromNodeId, runId? }, options)` requires a succeeded source/node, creates a new checkpoint, copies terminal evidence outside the selected node's downstream closure, restores selected-node pre-state, and records `{ sourceRunId, fromNodeId, rootRunId, depth }`. Source evidence is untouched. Copying any prior nested/tool approval is rejected; replay from that approval node or earlier so Phase 8 approval executes again.

`createWorkflowCoordinator({ coordinatorId, workflows, checkpoints, leases, ... })` polls queued/running checkpoints with bounded pages, atomically claims each run, renews its lease, and aborts/fences work after lease loss. Key controls: `leaseTtlMs` (default 30s), `renewalIntervalMs` (default TTL/3), `pollIntervalMs` (default 1s), `maxConcurrentRuns` (default 4), and `pageSize` (default 100, maximum 500).

`defineSaga({ id, revision, steps })` validates a bounded linear definition. Each step supplies `run`, `compensate`, and `reconcile`; handlers receive a stable tenant-scoped `operationId`, redacted bounded input/output, prior outputs, and an abort signal. `runSaga(definition, { checkpoints, leases, ownerId, tenantId, runId?, input?, maxAttempts?, leaseTtlMs?, redactor?, onEvent? })` stores a surrogate workflow checkpoint through `WorkflowCheckpointAdapter`, acquires a fenced `LeaseStore` lease, and advances one cursor at a time. `resumeSaga` takes over an expired run; it never replays durably succeeded steps. Forward or compensation handlers mark ambiguous failures with `unknown: true` (or `ERR_PRISM_SAGA_UNKNOWN`), and `reconcile` must return `succeeded`, `failed`, or `unknown` before retry.

Saga statuses are `running → completed`, `running → compensating → compensated`, or `manual_intervention`. Compensation visits only completed forward steps in reverse order. A manual resolution may set `completed` or `compensated` only with the current checkpoint version, active verified actor, bounded reason, and host audit reference; the reference is stored as provenance, not verified against the host audit system by Prism.

`createWorkflowSchedules({ store, leases, checkpoints, workflows, ownership, ownerId, calculators? })` is inert until its host calls `pollOnce()` or `run({ signal })`). Ownership requires `tenantId` plus `accountId` or `userId`. Methods are `create`, `get`, `list`, `pause`, `resume`, `trigger`, `delete`, `pollOnce`, and `run`. A record has one required `nextRunAt`, optional fixed `intervalMs` or registered `calculatorId` (never both), bounded input/metadata, status, version, and last-fire attribution. Manual trigger requires an idempotency key. Scheduled run IDs derive from schedule ID plus fire timestamp, so retry after enqueue-before-advance finds the same queued checkpoint instead of duplicating it. Defaults: page 100/hard 500, due claims 16/hard 256, input 256 KiB/hard 1 MiB, poll 1s, fire lease 30s.

`createProactiveScheduleCapabilities({ schedules, store, ownership, ownerId, defaultTtlMs?, maxTtlMs?, onCapability? })` wraps a `WorkflowSchedules` facade in explicit user enablement. `enable({ workflowId, scope, actor, nextRunAt, intervalMs?|calculatorId?, input?, ttlMs? })` creates the schedule plus a scoped, expiring `ScheduleCapabilityToken` (default TTL 24h / hard 31d, record ≤ 16 KiB) stamped with redacted actor refs. `revoke(tokenId, actor)` marks the token revoked and pauses the underlying schedule so `pollOnce()` never fires it (fail-closed). `assertActive(tokenId)` is a fail-closed guard for manual trigger paths — it throws on missing/revoked/expired tokens. `onCapability` emits `capability_enabled` / `capability_revoked` / `capability_denied` events (redacted refs only) that hosts bridge to `@arnilo/prism-policy` for an auditable ledger. Tokens are ownership-scoped checkpoint records; no cron expression or secret is persisted.

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

`runSaga` / `resumeSaga` resolve to `SagaRunResult`:

| Field | Notes |
| --- | --- |
| `sagaId`, `runId`, `status` | `running`, `compensating`, `completed`, `compensated`, or `manual_intervention` |
| `version` | Checkpoint CAS version; required as `manualResolution.expectedVersion` |
| `completedStepIds` | Forward steps durably marked succeeded, in completion order |
| `compensatedStepIds` | Completed steps durably compensated; list follows original forward completion order |
| `manualResolution` | Redacted reason, audit reference, checkpoint revision, and verified actor reference when manually resolved |

Saga `onEvent` callbacks receive metadata-only `saga_transition` events with tenant/saga/run/step/status/phase/version; input, output, error bodies, and secrets are excluded.

Schedule `onEvent` receives bounded-attribution `schedule_fired` or metadata-only `schedule_failed`; schedule input is never copied into these events.

Package-local `WorkflowEvent` types: `workflow_started`, `workflow_suspended`, `workflow_resumed`, `workflow_finished`, `node_started`, `node_finished`, `node_iteration_started`, `node_iteration_finished`, `node_failed`, `node_skipped`, `checkpoint_saved`, `agent_event` (wraps a redacted `AgentEvent`), `workflow_event_overflow`. Loop iteration-finished events carry bounded/redacted output and stable `iterationId`. Sequences are monotonic; drain/order is deterministic by `(sequence, nodeId)`.

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
  loopNode,
  agentNode,
  createWorkflowCheckpoints,
  createWorkflowCommands,
  cancelWorkflowRun,
  enqueueWorkflow,
  createWorkflowCoordinator,
  createWorkflowSchedules,
  defineSaga,
  replayWorkflow,
  resumeSaga,
  runSaga,
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

const invoiceSaga = defineSaga({
  id: "post-invoice",
  revision: "1",
  steps: [{
    id: "reserve-budget",
    run: ({ operationId, input }) => reserveBudget(input, operationId),
    compensate: ({ operationId, output }) => releaseBudget(output, operationId),
    reconcile: ({ operationId, phase }) => reconcileBudget(operationId, phase),
  }],
});
const sagaResult = await runSaga(invoiceSaga, {
  checkpoints,
  leases: persistence.leases,
  ownerId: process.env.HOSTNAME ?? "worker-1",
  tenantId: "t1",
  runId: "invoice-1",
  input: { invoiceId: "inv-1" },
  onEvent: (event) => sink.push(event),
});

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

## Iterative refinement (`loopNode`)

`loopNode` keeps the workflow graph acyclic while executing one body repeatedly. `ctx.iteration` is zero-based, `ctx.iterationId` is a stable compensation key (tenant-prefixed when ownership is supplied), and the body receives the prior body output as `ctx.previousOutput`. `until(ctx)` receives the current body output through that same property. Body and predicate can use `ctx.updateState()` for durable accumulation.

Use inline `execute` for pure refinement, or `body` for one interior function/tool sub-step. A tool body uses the normal durable approval gate; approval suspends before its side effect and an approved resume re-enters the same iteration. Completed prior iterations remain in the checkpoint ledger and are not re-executed.

`maxIterations` is required and capped at 64 (`HARD_MAX_LOOP_ITERATIONS`). The scheduler enforces the cap even when `until` never passes. Exhaustion throws `WorkflowLoopLimitError` with code `ERR_PRISM_WORKFLOW_LOOP_LIMIT`, `iterations`, and a bounded/redacted `lastOutput`. Each completed iteration stores a versioned, bounded/redacted output record before the next body starts; `maxNodeOutputBytes` applies to every body output.

### Frozen budget accounting

`maxNodes` counts declared DAG nodes once. `maxIterations` independently caps loop body executions; iterations never consume `maxNodes`. Both limits are validated before execution and fail closed at their hard caps.

`node_iteration_started` and `node_iteration_finished` events expose `iteration` and `iterationId`; finished events also expose `done` and bounded/redacted output. A replay started from a completed loop re-runs its body and emits the same iteration sequence for the new run. Hosts that persist events should treat `iterationId` as the idempotency key.

```ts
const refine = loopNode({
  execute: async (ctx) => ({
    iteration: ctx.iteration,
    draft: improve((ctx.previousOutput as { draft?: string } | undefined)?.draft),
  }),
  until: (ctx) => (ctx.previousOutput as { passed?: boolean } | undefined)?.passed === true,
  maxIterations: 5,
});

const approvedRefine = loopNode({
  body: toolNode({
    tool: publishDraft,
    args: () => ({ action: "refine" }),
    approval: { reason: "approve refinement side effect" },
  }),
  until: (ctx) => ctx.previousOutput === "accepted",
  maxIterations: 3,
});

const workflow = defineWorkflow({
  id: "refine-draft",
  revision: "1",
  nodes: { refine, approvedRefine },
});
```

### Saga compensation boundary

A loop remains one DAG node and one host saga step. Persist the loop's `iterations` as that step's aggregate output, and register external compensation under each record's `iterationId`; compensate records in reverse iteration order. The workflow runner does not invoke saga handlers implicitly, so the host retains ownership of side-effect policy and audit records while replay/resume stay deterministic.

## Bounded iterate-until-done (host-loop pattern)

Workflows can now use `loopNode` for bounded in-graph refinement. A host `for`/`while` over `runWorkflow` remains useful when each iteration must be a separate run id, use a different workflow definition, or run on versions before this node kind. Runnable proof: [`examples/autonomous-coding-loop.ts`](../examples/autonomous-coding-loop.ts) (N runs, mid-loop human gate with simulated restart, typed budget exhaustion).

1. Keep the DAG acyclic (roadmap → execute → validate → gate → compact).
2. Pass `{ goal, iteration }` as `runWorkflow` input — never a back-edge.
3. Bound the host loop (`MAX_ITERATIONS`). Per-child tool/token caps stay on `supervisor.delegate` / `RunOptions`.
4. Explicit predicate (`passed(outputs)`). Exhaustion throws a typed error — fail-closed, never hang.
5. Human gate is ordinary `suspend` / `resumeWorkflow` (CAS `expectedVersion`). Restart = new runtime, same checkpoint store.
6. Audit **each iteration** with `replayWorkflow({ sourceRunId, fromNodeId })`. The host loop is N run ids — `listWorkflowRuns` lists them; `replayWorkflow` does not replay the `for`.

```ts
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const run = await runWorkflow(phase, { goal, iteration: i }, { checkpoints, ownership });
  if (run.status === "suspended") break; // resumeWorkflow later with expectedVersion
  if (run.status !== "succeeded") throw new Error(run.status);
  if (passed(run.outputs)) break;
}
if (!passed(last.outputs)) throw new BudgetExhaustedError(MAX_ITERATIONS);
```

For a single bounded refinement, prefer `loopNode`. Keep this host-loop pattern when separate run ids, per-run checkpoints, or a new workflow definition are part of the contract.

## Extension and configuration notes

- Workflow semantics stay in this optional package; generic checkpoint persistence and bounded event fan-in live in core.
- `ProductionPersistenceStore.checkpoints` and `.leases` are optional generic capabilities. First-party SQLite/PostgreSQL adapters own `prism_checkpoints` / `prism_leases`; workflows only adapt them. Sagas use the same `WorkflowCheckpointAdapter` and `LeaseStore`; they add no SQL table or scheduler.
- `createWorkflowEventBus()` delegates queueing, source fan-in, overflow, abort, and close behavior to core `createEventMultiplexer()`, including its single-consumer contract: a second concurrent `subscribe()` is rejected with `EventMultiplexerError` (`ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`) instead of silently splitting the stream. Graceful `close()` stops new emits/sources and drains already-queued events (in `(sequence, nodeId)` order) before the subscriber completes; overflow `close` still emits one `workflow_event_overflow` notice and terminates. Loop iteration events carry bounded/redacted output and stable `iterationId` values for durable sinks.
- The in-process active-run registry (`registerActiveWorkflowRun` / `getActiveWorkflowRun` / `abortActiveWorkflowRun`) is **non-durable, in-process only — it does not survive restart**; durable active-run recovery is a later milestone. It is bounded: every register sweeps aborted/leaked entries (runs whose promise never settled) and the registry fails closed at `MAX_ACTIVE_WORKFLOW_RUNS` (512) rather than evicting a live run; `sweepActiveWorkflowRuns()` is available for hosts. Cross-tenant lookups stay ownership-isolated.
- `createWorkflowCommands()` is optional; hosts can drive `workflow.start` / `enqueue` / `replay` / `status` / `list` / `cancel` / `resume`. The six `schedule.*` commands appear only when a scoped `schedules` service is supplied.
- Hosts may bridge `WorkflowEvent` into OpenTelemetry or custom sinks; there is no built-in TUI.
- Agent exclusivity is per session: one active `run()` at a time, same as core.
- Saga definitions remain host code and only their revision, ordered step IDs, bounded JSON snapshots, cursors, attempt counters, and redacted error/provenance metadata are persisted. The surrogate workflow checkpoint namespace is private to the package.

## Security and performance notes

- Definitions require a non-empty host-authored `revision` and fail closed on cycles, unknown edges, self-edges, invalid limits, and `maxNodes` overflow. Revision and every nested revision enter the deterministic definition hash; hosts must bump revision when function/tool behavior changes. Loop `maxIterations` is required and capped at 64.
- Loop bodies run serially inside one scheduler node; every body output and durable iteration record is bounded/redacted with `maxNodeOutputBytes`, and the scheduler persists the completed-iteration cursor before advancing. Approved durable resumes re-enter only the incomplete iteration.
- Fan-out length is bounded by `maxFanOut`. Independent `map` items run in a local worker pool capped by the resolved workflow `maxConcurrency` (and `options.concurrency`); output stays in input order. Abort or the first map failure stops further items. There is no extra global admission service.
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
- Replay source ownership/hash/status/node eligibility are checked before a new checkpoint is created. Source records are immutable, lineage is bounded, and copied approval-bearing paths are rejected. Replaying from a completed loop starts a fresh loop cursor and emits its per-iteration records; it never mutates source evidence.
- Schedule services are ownership-scoped and explicitly started. Per-fire leases plus deterministic run IDs/CAS prevent duplicate enqueue across coordinators and crash retry. Host calculator IDs resolve only from the supplied map; no callback or cron expression is persisted.
- Proactive schedules require an explicit capability grant. Revocation pauses the schedule (never fired by `pollOnce`) and `assertActive` fails closed on missing/revoked/expired tokens; enable/revoke/deny events carry redacted actor refs for the host policy ledger. Capability TTL is capped (default 24h / hard 31d) and the token record is byte-bounded (≤ 16 KiB); tokens are ownership-scoped, so foreign access fails closed rather than leaking existence.
- Scheduler stores O(nodes + active outputs + bounded state history); ready-node work uses indegree maps, not repeated full scans.
- Lease acquisition is atomic; opaque tokens protect renew/release; monotonically increasing fencing tokens plus checkpoint compare-and-swap prevent expired workers from committing after takeover. Node functions must honor `ctx.signal` for prompt cooperative cancellation.
- Saga runs require `tenantId`; checkpoint keys and leases include tenant ownership. Every transition uses checkpoint CAS plus the current lease fence. Forward/compensation retries are capped at 3 by default / 10 hard; ambiguous outcomes require reconciliation and unresolved state becomes `manual_intervention`.
- Saga input, step outputs, and error text are byte-bounded and passed through the configured `SecretRedactor` before persistence or compensation. A loop used as one saga step remains one aggregate compensation record; hosts register and compensate its durable iteration IDs in reverse order. Manual resolution requires an active verified actor for the tenant, exact checkpoint version, bounded reason, and a non-empty host audit reference; Prism does not pretend to verify the external audit record.

Use workflows for known, durable, replayable graphs. Use optional supervisor delegation only when child selection must be dynamic at runtime; do not replace deterministic nodes with model routing without a concrete need.

## Related APIs

- Examples: `examples/workflow-research-and-review.ts`, `examples/workflow-parallel-research.ts`, `examples/workflow-tool-approval.ts`, `examples/workflow-multimodal-document.ts`, `examples/workflow-sqlite-resume.ts`, `examples/workflow-postgres-resume.ts`, `examples/workflow-event-sink.ts`, `examples/workflow-rpc-cancel.ts`, `examples/workflow-distributed-coordinator.ts`, `examples/autonomous-coding-loop.ts` (host-loop iterate-until-done) — offline runnable demos; PostgreSQL safely skips unless `PRISM_TEST_POSTGRES_URL` is set.
- [Workflow orchestration primitives](workflow-orchestration-primitives.md): Task 0–1 inventory and locked adapter contracts
- [Agent/session runtime](agent-session-runtime.md): `AgentSession.run()`/`stream()`, abort, subscribe
- [Guardrails](guardrails.md): `RunWorkflowOptions.guardrails` routes tool nodes through core dispatch before policy and side effects.
- [Supervisor delegation](supervisors.md): bounded dynamic child selection.
- [Obscura browser engine](obscura.md): optional binary-backed generic tools for `toolNode`/`agentNode` composition.
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
