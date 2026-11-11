# @arnilo/prism-extensions/workflows

Typed graph workflows (DAG and cyclic) that orchestrate any set of `Agent`s from outside their sessions, with checkpoints, suspend/resume, replay, and graph export.

## Install

```bash
prism add @arnilo/prism-extensions/workflows
```

```jsonc
// manifest entry — no config fields
{ "packages": ["@arnilo/prism-extensions/workflows"] }
```

## Configuration

None. The package reads no config and registers no schema.

## What it changes

- **Hooks:** none. `runCheckpointRestoreHooks` and `createEventMultiplexer` live here, not on the kernel.
- **Tools, skills, providers:** none.
- **Commands:** none by itself; `workflowCommand(prism, name, def, { args? })` builds one for your package to register (see Commands).
- **Slot:** none by itself; `workflowLoop(def)` is a separate package that claims `slot:loop` (see Single-agent loops).
- **Capabilities:** `session-state` for the parent transition log.
- **Events:** `workflow.*` package events (see Events below).
- **Services provided:** `workflows` — the resolved `WorkflowRuntime` (`{ checkpoints, leases, log, events }`), so a host package or the Part B command runs a workflow without re-wiring the services.
- **Services consumed:** `checkpoints` and `leases`. `@arnilo/prism-extensions/store-sqlite` and `@arnilo/prism-extensions/store-postgres` provide both. With neither present the package falls back to the in-memory defaults and adds one `info` status note: `no checkpoints service; workflow runs are not durable across processes`.

## The engine

`defineWorkflow({ id, revision, nodes, edges, limits?, state?, execution? })` builds a frozen, revision-hashed definition. Node kinds:

| Factory | Runs |
| --- | --- |
| `functionNode` | a function over the node context |
| `conditionalNode` | `when()` picks `then`/`else` successors; the rest are skipped |
| `routeNode` | `select()` returns the declared successors to activate (or suspends) |
| `joinNode` | reduces the upstream fan-out's array |
| `agentNode` | any `Agent` (including a driver agent) in a child session linked to the run; see below |
| `gateNode` | a deterministic `check()`; a failure routes back (see below) |
| `humanGate` | a `host.ui` request; no UI suspends the run durably (see below) |
| `fanOut` | routes each item to an agent, function, or workflow node, under `maxFanOut`, `maxConcurrency`, and profile pacing (see below) |
| `loopNode` | an inline `execute` or a `body` sub-step, bounded by `maxIterations` |
| `workflowNode` | a nested definition, with optional scoped state |

A graph with a cycle, a route node, or `limits.maxSupersteps` runs on the superstep scheduler; every other graph runs on the Kahn scheduler. `limits` bounds nodes, fan-out, concurrency, supersteps, node output bytes, checkpoint bytes, nesting depth, state bytes, state history, and replay depth, each with a hard cap.

`runWorkflow(def, input, options)` runs; `resumeWorkflow(def, { runId }, { checkpoints, resume })` resumes a suspended run exactly once; `suspend({ reason, data?, resumeSchema? })` returns from a node to pause durably; `replayWorkflow(def, { sourceRunId, fromNodeId }, { checkpoints })` forks a new run from one completed node without mutating the source; `serializeWorkflowGraph` / `workflowGraphToMermaid` / `workflowGraphToDot` project the definition for a UI.

### `agentNode`

```ts
agentNode({ agent: uiEngineer, worktree: true, input: (ctx) => ctx.workflowInput, output: (result) => result.text })
```

`agentNode({ agent, session?, input?, runOptions?, worktree?, output? })` runs any `Agent` through its public session API. By default each attempt opens a new child session with `parent: { sessionId: <host parent session>, agentId: agent.id, workflowRunId }`, so `createSessionIndex(store).list({ workflowRunId })` finds it. `session(ctx)` supplies one instead. `output(result, ctx)` maps the child's `RunResult`; the default is the final assistant text. A child run that suspends (an approval) suspends the workflow with reason `child_session_suspended` and the child session id in the suspension data.

`worktree: true` (or `{ dispose: "keep" | "dispose" }`) creates a worktree through the `workspace` service (`@arnilo/prism-tools/coding`) bound to the child session, so its tools resolve to it. After the run the node calls `workspace.diff(path)`, emits each change as an `agent.file` package event (`source: "diff"`, with `sessionId`, `workflowRunId`, `nodeId`), and returns `{ output, worktree: { path, branch, truncated } }` for a merge gate. Without the `workspace` service, or without a host parent, the node fails with `WorkflowRuntimeError` code `missing_service`; it never falls back to the main tree. The worktree is kept by default for the merge gate, so the host or the gate disposes it; `dispose: "dispose"` force-disposes it when the node ends. Cost: one child session per attempt and one `diff` call per worktree node.

### `fanOut`

`fanOut({ items, route, maxConcurrency })` evaluates `items(ctx)` (at most `maxFanOut`), asks `route(item, index, ctx)` for the node that runs each item (an `agentNode`, `functionNode`, or `workflowNode`), and outputs the item results in item order. At most `maxConcurrency` items run at once (also capped by the workflow's `maxConcurrency`); an item cannot suspend.

**Profile pacing.** An item whose run start fails with the driver kit's `profile_busy` (a structured `code`, never parsed from the message) is re-queued behind the other items, so a waiting item holds no process or session. It starts again when a sibling item finishes, or after a bounded backoff (100 ms doubling to `maxProfileBackoffMs`, default 2000) when the holder is outside the workflow. The workflow never surfaces `profile_busy`, and the driver kit's process-wide cap per profile home means no more than `maxConcurrentRuns` runs are ever active on one profile, even across agents. Any other driver error, including `profile_principal_mismatch`, fails the node and is not retried.

```ts
fanOut({ items: (ctx) => ctx.upstream.plan.tasks, maxConcurrency: 3,
  route: (task) => agentNode({ agent: task.ui ? uiEngineer : host, worktree: true, input: () => task.prompt }) });
```

### Gates

```ts
planOk: gateNode({ check: (ctx) => validatePlan(ctx.upstream.plan) }),
approve: humanGate({ request: { kind: "confirm", title: "Execute this plan?" } }),
```

`gateNode({ check, onFail?, maxIterations? })` runs `check(ctx)` and returns `{ pass: true, output? }` or `{ pass: false, reason, route? }`. A pass activates the gate's successors except the failure target; a failure activates only the failure target: `route`, else `onFail`, else the gate's predecessor. The target must be a declared successor, so the graph needs the back edge (`["planOk", "plan"]`), and the node it returns to needs `activation: "any"` plus an entry node upstream. A graph with a back edge already requires `limits.maxSupersteps`; exceeding it throws `WorkflowSuperstepLimitError`, and exceeding the gate's own `maxIterations` (default and cap 64) throws `WorkflowLoopLimitError`. A gate never calls a model, and a `check` that throws or returns a malformed result is a failed gate with reason `check_threw` / `check_invalid` (fail closed; the error text is dropped). The gate's output is `{ pass, output? | reason, route }`. Each gate finish emits `workflow.gate` with `pass`, and with `reason` and `route` on a failure. `reason` is persisted in the parent log (256 characters, redacted), so a check must not put node inputs or outputs in it. A gate adds no write beyond its transition records.

`humanGate({ request, onFail?, maxIterations? })` sends `request` through `host.ui` as `@arnilo/prism-extensions/workflows` (the kernel stamps the package and session). Any kind except `terminal` and `secret` is allowed; those two throw `WorkflowDefinitionError` at `humanGate()`, since a gate never runs a terminal or collects secrets. `answered` stores the value as the node output (a `confirm` answer of `false` is a failed gate with reason `declined`); `dismissed` is a failed gate with reason `dismissed`. With no UI, or an `unavailable` answer, the workflow suspends with reason `human_gate_unavailable` (this needs a `checkpoints` service); `resumeWorkflow(def, { runId }, { checkpoints, resume: { decision: "approve", input: answer, expectedVersion } })` continues it with `input` as the answer. The package declares `host-ui` for this; a host that strips the capability gets `WorkflowDefinitionError` when the gate first asks.

## Events

`startWorkflow(def, input, { prism, session: ctx.session, ...runOptions })` takes the caller's host
session as the workflow parent. `prism` is the caller package's API and `ctx.session` is the bound
context passed to its command, hook, or tool. Persistence and observe-hook emission use the workflows
service's own package API, so records and events remain namespaced to `@arnilo/prism-extensions/workflows`. The returned handle has `id`, `parentSessionId`,
`result()` (a promise), `stream()`, `steer(nodeId, input)`, and `abort(reason?)`. The run id is the `workflowRunId`.
`workflowCommand` will open or bind this session in Part B Task 8; automatic parent creation is not part of this entry point. `runWorkflow` remains the headless engine entry point.

Names are exported once in `WORKFLOW_EVENTS`:

| Name | Meaning |
| --- | --- |
| `workflow.node.started` | Node execution starts |
| `workflow.node.completed` | Node succeeds, or is skipped (`status: "skipped"`) |
| `workflow.node.failed` | Node fails or aborts |
| `workflow.gate` | A conditional or route node selects successor ids |
| `workflow.suspended` | Durable review is requested |
| `workflow.notice` | Stream-only, never persisted: the live stream closed because the consumer fell behind |

Each event contains bounded JSON (at most 16 KiB before the session's additional redaction):
`workflowRunId`, `nodeId`, `attempt`, `superstep`, and `status`, with `childSessionId`, `route`, or
`reason` where applicable. Reasons are fixed codes (`node_failed`, `review_required`), never error
messages or review text. Node inputs, outputs, and review data are excluded. A gate's `route` contains
only declared successor ids. The parent log and live channel both use the stored, redacted payload.

Transitions append to `prism.state.log("workflow")` on the parent's current branch before
`prism.events.emit(name, data)` and live publication. A failed append fails the run before the node
can proceed. Reopening the session restores the runtime service's `log.entries(ctx.session)`.
There are **two writes per executed node** (start and completion/failure/suspension), one per skipped
node, plus one decision record per conditional/route node. Retries inside an execution update the
terminal attempt; loop iterations do not add parent records. Child events never add parent log writes.
Checkpoint service writes are separate.

```ts
// Inside a host command, with workflows installed and a bound ctx.session:
const run = startWorkflow(def, input, { prism, session: ctx.session, checkpoints: runtime.checkpoints });
for await (const event of run.stream()) render(event.origin?.agent ?? "workflow", event);
await run.steer("execute", "prefer the existing Button component");
const result = await run.result();
```

### Running a workflow: `stream`, `steer`, `abort`

`run.stream()` is one single-consumer async iterable that merges, in arrival order, the redacted
`workflow.*` package events with every child session's `AgentEvent`s. Child events keep their
`origin` (external agents, sub-agent scopes) and are already redacted by the child session. Each child
is subscribed when its session opens, before its first run, through public `Session.subscribe` (one
subscription per child, closed when the node's attempt ends), so a child that starts late loses nothing.
Narrow with `event.type === "package.event"` for transitions.

The queue is bounded (`maxQueuedEvents`, default `DEFAULT_EVENT_BUFFER`). On overflow the stream
**closes** after a single stream-only `workflow.notice` (`reason: "slow_consumer"`); the parent log stays
the durable source. `run.steer(nodeId, text)` calls `session.steer()` on that node's active child
sessions (every active item of a `fanOut`) and rejects with `WorkflowRuntimeError` code
`node_not_running` when none is active. A driver child that cannot take steering reports it as its own
`agent.notice` (`steer_unsupported`); the workflow continues. `run.abort(reason?)` aborts the run and
every active child (each driver within its abort ladder); `result()` then reports `aborted`.

`prism.events.emit` supplies the host observe-hook channel; `session.subscribe(parent)` does not carry
these events. No kernel catalog event is added.

The former event bus and engine callback option are retired with no aliases. Engine observers use
`createWorkflowTransitionChannel({ workflowId, runId })`, pass it as `transitions`, and consume
`channel.subscribe()` with `for await`; the outer scheduler closes it, including on failure or
suspension. Nested workflows share it until the outer run finishes. `channel.stream()` exposes the
persisted parent package transitions merged with child events; `subscribe()` retains scheduler diagnostics for graph/timeline
projectors and observes child sessions through public `Session.subscribe`.

## Checkpoints and leases

The package owns two service contracts (roadmap §2.12.13):

- `CheckpointStore` — `saveCheckpoint` / `loadCheckpoint` / `listCheckpoints` / `deleteCheckpoint` over a versioned, ownership-scoped record. `version` strictly increases; `expectedVersion` is the compare-and-swap guard (`0` is create-only); `fencingToken` stops a stale worker from replacing a fenced record.
- `LeaseStore` — `tryAcquireLease` / `renewLease` / `releaseLease` / `getLease`. Expired rows retain their `fencingToken`, so a new holder always fences higher than the last.

`createMemoryCheckpointStore()` and `createMemoryLeaseStore()` are the bounded in-process defaults: 10 000 records / 1 MiB per value for checkpoints, and a lease map that sweeps expired rows only at 1024 entries. They make no I/O and are not durable across processes. A store package provides the durable implementations under the `checkpoints` and `leases` service names; the engine consumes them through `createWorkflowRuntime(prism)`.

Both contracts ship a conformance suite in `@arnilo/prism-extensions/workflows/testing`:

```ts
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism-extensions/workflows";
import { checkpointConformance, leaseConformance } from "@arnilo/prism-extensions/workflows/testing";

await checkpointConformance(() => createMemoryCheckpointStore());
await leaseConformance(() => createMemoryLeaseStore());
```

`checkpointConformance` covers create, CAS on `expectedVersion`, create-only, fencing tokens, ownership isolation, list pagination, and delete. `leaseConformance` covers acquire, exclusive hold, renew, release, foreign-owner rejection, and a fencing counter that survives release and expiry.

Sizing: a durable store writes one checkpoint per node completion and one lease renew per `ttlMs/2` while a run is claimed. The memory default writes nothing but loses runs on restart — the package notes that once when no `checkpoints` service is present.

## Durable resume after a process kill

`resumeWorkflow(def, runId | { runId, workflowId? }, options)` continues a run whose process died (SIGKILL, OOM, host restart) or that suspended for a review. Pass `prism` (a `PackageAPI`) to resolve the registered `checkpoints` and `leases` services, or pass `checkpoints` and `leases` directly.

1. **Claim.** The run is claimed through the `leases` service under `workflow-run` / `<workflowId>/<runId>`, scoped by `ownership`. One resumer wins; a second gets `LeaseConflictError` (`ERR_PRISM_LEASE_CONFLICT`). The lease is renewed every `leaseTtlMs / 2` (default TTL 30 s), its fencing token guards every checkpoint write, losing it aborts the run, and it is released at the end. The lease token is never logged or placed in an event.
2. **Read.** One checkpoint is read for the run; completed nodes take their outputs from it and never run again. The definition hash must match (`WorkflowCheckpointError` otherwise), and the resumer's `ownership` must equal the run's: a foreign tenant cannot claim it.
3. **Decide per node.** A node left `running` is decided by its `idempotent` field:

| Policy | Default for | On resume |
| --- | --- | --- |
| `"rerun"` | every kind but `agent` | runs again |
| `"resume-session"` | `agentNode` (valid only there) | reopens the same child session and runs the node input again, so the transcript continues |
| `"fail"` | none | the run fails with `WorkflowRuntimeError` code `not_idempotent`; the node stays failed, so a second resume refuses too |

A suspended `agentNode` resumes through the child: pass the reviewer's **complete** `Decision[]` batch as `resume.input` and the child continues with `session.resume(decisions)`. A partial, unknown, or duplicated batch is rejected by the session, and a non-array `resume.input` fails with `invalid_resume`.

A worktree node that died mid-run resumes only in its recorded worktree. The node first asks the workspace service for its binding, then calls `workspace.worktree.rebind` to re-adopt the recorded path after a process kill; if neither yields that worktree (gone, or not the service's), the node fails with `worktree_lost`. It never creates a new worktree or runs in the main tree.

Cost: one checkpoint read per resume, one lease held per run, one extra checkpoint write per agent attempt (after its session and worktree are recorded, so a kill can find them), and one extra write at node start for a `"fail"` node on the superstep scheduler. A node that finishes between the last checkpoint and the kill is indistinguishable from one that never started: that is the window `idempotent` exists for.

## Commands

`workflowCommand` returns a `PackageCommand` that starts a workflow on the caller's session.

```ts
setup: (prism) =>
  prism.commands.register(
    workflowCommand(prism, "build", () => build, { args: { type: "object", required: ["goal"], properties: { goal: { type: "string" } } } }),
  ),
```

- The kernel validates the arguments against `args` before `run`; a failure starts nothing. The validated arguments are the workflow input.
- `run` calls `startWorkflow` with the command's bound `ctx.session` as the parent. With no caller session it opens one on the agent, runs the command in it, and closes it.
- It returns `{ workflowRunId, status }`. `checkpoints`, `leases`, `workspace`, and `host` resolve at call time through the `prism` you pass.
- `onRun(run)` receives the live `WorkflowRun` before the command awaits its result, so the host can render `run.stream()`, `steer`, or `abort` without re-implementing the command. The command resolves when the run ends, so consume the stream inside the hook or hand `run` to another task. A throw aborts the run and fails the command.
- `() => def` is resolved on the first run, so the definition can name agents created after `setup`.

## Single-agent loops

`workflowLoop(def)` returns a package that claims `slot:loop` and runs `def` inside one agent's run. `loopAgentNode({ input?, tools?, system?, output?, activation? })` is its agent step: it appends the optional `input` as a user message, then runs `run.turn()` and `run.executeTools()` until the model stops calling tools, so every tool call fires `tool.call` and is gated by `@arnilo/prism-extensions/approval` or any host gate. Gates, functions, routes, and conditionals run as usual; a failed `gateNode` routes back for a revision.

```ts
packages: [workflowLoop(generateValidateRevise), approvalPackage({ mode: "ask" })]
```

- A loop is one agent and one session: an `agentNode` anywhere in the definition (including a nested workflow) fails `workflowLoop(def)` with `WorkflowDefinitionError`. Use `workflowCommand` to orchestrate several agents. A `loopAgentNode` in a `fanOut` route or loop body is not bound; place it at the top level.
- Steps of parallel branches take turns on the run. The run's `limits` and `tool.call` gates apply as in any run.
- The loop adds no model call beyond its steps' turns. It is not resumable: an `ask` with no `host.ui` denies instead of suspending. It keeps no checkpoints (an in-memory run).
- `workflowLoopStrategy(def)` returns the bare `LoopStrategy`, which `loopConformance` from `@arnilo/prism/testing` takes.
- Runnable: [`examples/workflow-loop.ts`](../../../examples/workflow-loop.ts).

## Capabilities

`session-state` (the parent-session transition log) and `host-ui` (`humanGate` requests).

## Cost, security, and failure behavior

- **Cost:** one checkpoint write per node transition and per loop iteration; no model calls of its own. A `fanOut` adds concurrency, not calls.
- **Security:** checkpoint values are bounded and redacted through the run's `SecretRedactor`; ownership (`tenantId`/`accountId`/`userId`) is part of every key, so a foreign tenant gets a miss, never an ownership-shaped oracle. `WorkflowDefinitionError` never echoes node input values.
- **Failure:** an unknown node kind, an unknown edge target, a cycle without `maxSupersteps`, and a bad limit all fail at `defineWorkflow`. A resume with a mismatched definition hash, a stale expected version, a foreign tenant's resume, or an interrupted `idempotent: "fail"` node fails closed (`WorkflowCheckpointError`, or `not_idempotent`).
- **Durability:** with the `checkpoints` service, a suspended run survives a process restart. Without it, runs stay in memory and the package notes that once.

## Example

```ts
import workflows, { defineWorkflow, functionNode, routeNode, runWorkflow } from "@arnilo/prism-extensions/workflows";
import { createAgent } from "@arnilo/prism";

const triage = defineWorkflow({
  id: "triage",
  revision: "1",
  nodes: {
    classify: functionNode({ execute: (ctx) => ({ kind: "bug" }) }),
    route: routeNode({ select: (ctx) => [ctx.upstream.classify.kind] }),
    fix: functionNode({ execute: () => "fixed" }),
  },
  edges: [["classify", "route"], ["route", "fix"]],
});

const agent = await createAgent({ model: "mock/main", packages: [workflows] });
const result = await runWorkflow(triage, { text: "…" });
console.log(result.status, result.outputs);
```

### A multi-agent build

`examples/build-workflow.ts` runs the full orchestration offline: a mock host agent, a planner and a UI engineer on the `stream-cli` reference adapter, and a validator on the `rpc-server` reference adapter, all over `createScriptedCli`, with sessions, vendor state, checkpoints, and leases in one SQLite file and a temp git repository behind the `workspace` service.

```ts
const build = defineWorkflow({
  id: "build", revision: "1", limits: { maxSupersteps: 24 },
  nodes: {
    research: agentNode({ agent: host, input: (ctx) => `Research: ${ctx.workflowInput}` }),
    plan: agentNode({ agent: planner, activation: "any" }),
    planOk: gateNode({ check: (ctx) => validatePlan(ctx.upstream.plan) }),       // fails once, routes back to plan
    approve: humanGate({ request: { kind: "confirm", title: "Execute this plan?" }, onFail: "plan" }),
    execute: fanOut({ activation: "any", items: () => tasks, maxConcurrency: 4,
      route: (task) => agentNode({ agent: task.ui ? uiEngineer : host, worktree: true, input: () => task.prompt }) }),
    merge: gateNode({ check: mergeWorktrees }),                                    // workspace.merge per worktree
    validate: agentNode({ agent: validator, activation: "any" }),
    tests: gateNode({ check: runTests }),
  },
  edges: [["research", "plan"], ["plan", "planOk"], ["planOk", "plan"], ["planOk", "approve"], ["approve", "plan"],
          ["approve", "execute"], ["execute", "merge"], ["merge", "execute"], ["merge", "validate"],
          ["validate", "tests"], ["tests", "validate"]],
});
```

Every gate needs a back edge to its failure target, and a node a gate routes back to needs `activation: "any"`. A failed child run fails its `agentNode` carrying the child's error code, so a driver's `profile_busy` makes the `fanOut` item wait. Native children carry no `origin`; an external child's `origin.agent` is its adapter name, and a sub-agent's events carry `depth` and `subagentId`.
