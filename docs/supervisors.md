# Supervisor delegation

## What it does

`@arnilo/prism-core/runtime/supervisor` adds optional runtime-selected delegation to an explicit local child allow-list. It returns normal `AgentRunResult` values and does not modify core `createAgent()` or deterministic workflows.

## When to use it

Use a supervisor when a host or agent must choose a child dynamically. Use `@arnilo/prism-core/runtime/workflows` for known DAGs, durable checkpoints, schedules, replay, or human suspension.

## Inputs / request

**Option surfaces** — `CreateSupervisorOptions` (ownership, child catalog, hooks, `childEvents`, `childEventSink`, `signal`, limits), `SupervisorLimits` / `ResolvedSupervisorLimits` (depth, active children, child events, bytes, per-second rate), `SupervisorChildPolicy` (lifetime, report, milestone, budget share), `DelegationRequest` (child, input, thread, limits, lifetime, report, milestone, budget share, signal), `DelegationWaitOptions` (`timeoutMs`, `signal`), `SupervisorRunSummary` / `SupervisorChildSummary` (recovery counters), `CreateSpawnAgentToolOptions` / `CreateDelegationControlToolOptions` (supervisor, tool name, sync/async mode), `WorktreeChildFactoryOptions` (workspace lifecycle, repository, roots), and `ObserveSupervisorLifecycleOptions` (supervisor, emit, redactor, steps).

| API/field | Meaning |
| --- | --- |
| `createSupervisor({ ownership, children, signal? })` | Creates one ownership-scoped supervisor. Aborting `signal` (session end) ends every running child and closes the event stream. |
| `SupervisorChild.createAgent(context)` / `policy` | Child-owned factory; receives derived resource/thread IDs, narrowed permission, abort signal, and nested `delegate`. `policy` carries host ceilings/defaults for lifetime, report, milestone cadence, and budget share. |
| `delegate({ childId, input, threadId?, limits?, lifetime?, report?, milestone?, budgetShare?, signal? })` | Invokes one allow-listed child. Input is text and byte-bounded. Sync `delegate()` rejects `lifetime: "session"`. |
| `delegateAsync({ ... })` | Starts one local child and returns `{ delegationId, status: "running" }`. `lifetime: "session"` detaches the child from the caller signal so it survives caller turns. |
| `wait(delegationId)` / `cancel(delegationId)` | Joins one local async child (capped at supervisor timeout) or aborts it, session-lifetime included. Unknown and foreign IDs share one denial. |
| `createSpawnAgentTool({ supervisor, name? })` | Returns non-exclusive `spawn_agent` tool for a parent model. Its closed schema exposes only host child IDs, input, optional thread ID, `mode`, `lifetime`, `report`, `milestone.everyTurns`, and `budgetShare`. |
| `createWaitAgentTool` / `createCancelAgentTool` | Return `wait_agent` / `cancel_agent` tools for host-owned async handles. |
| `Supervisor.childIds` | Frozen advertised child-id list the spawn tool's schema enum is built from; model arguments cannot extend it. |
| `hooks.before` | May reject, modify redacted input, or narrow limits/policy. |
| `hooks.after` | Observes redacted terminal summary; failures cannot alter settled result. |
| `limits` | Depth 4/16, active children 4/32, input 64 KiB/1 MiB, steps 8/64, tools 32/256, tokens 20k/1m, timeout 60s/30m, event queue 128/4096, child events/delegation 256/4096, child-event bytes 32 KiB/256 KiB, child events/second 10/1000 default/hard. Over-cap `delegate()` throws `SupervisorLimitError` before incrementing `activeChildren`. Hook rejection and timeout decrement the count exactly once (no leaked timers). |

## Outputs / response / events

`delegate()` returns the child's `AgentRunResult` or throws its `AgentRunError`/a supervisor denial or limit error. A failure (an error or a run-limit death) publishes `child_failed` before the terminal `delegation_error`: the redacted `reason`, the terminal `status` and `stopReason`, the plan-086/087 `RunLimitBreach` (`limit`, `maximum`, `observed`) in `limit` when a configured ceiling fired, and terminal `usage`. Host cancels, policy denials, and hook rejections are not failures and never emit it. `delegateAsync()` returns a local running handle; `wait()` returns its result (or `{ status: "cancelled" }` after `cancel()`), and stays idempotent while its terminal record is retained (bounded by `limits.maxQueuedEvents`; an evicted or foreign id returns the same non-enumerating error). `subscribe()` emits bounded `delegation_started`, `delegation_finished`, `delegation_rejected`, and `delegation_error` metadata events, plus the opt-in child-event family below. Aborting `CreateSupervisorOptions.signal` aborts every running child (session- and task-lifetime) and closes the stream. Hosts routing child events onto a parent session stream pass `childEventSink`; it receives the identical payload the supervisor stream carries — a redacted, capped, rate-coalesced `AgentEvent` tagged with `child: { childId, delegationId, depth }` (contract type `ChildEventOrigin`) — so a parent subscriber can route it with `event.child` and no per-type handling. Hosts may project the lifecycle events through observability `handleDelegation()` using the parent Prism run ID; no OpenTelemetry dependency enters this package.

### Child lifetime, reporting, and budget share

Every `SupervisorChild` may carry a `policy` of host ceilings/defaults; a `DelegationRequest` may only narrow them (report is clamped to the ceiling, `everyTurns` can only be raised, budget share takes the lower value, and session lifetime is denied unless the host enabled it). Defaults are exactly the 0.8 behavior: `lifetime: "task"`, `report: "on-complete"`, no milestone, no share.

- **Lifetime.** `task` children stay linked to the caller signal. `session` children must be started with `delegateAsync` (`spawn_agent` routes them to it automatically): they detach from the caller and ancestor-child signals, keep running across parent turns, hold an `activeChildren` slot until they end, and stop on `cancel(delegationId)` or when `CreateSupervisorOptions.signal` aborts.
- **Report.** `on-complete` publishes nothing per turn (the default). `milestones` publishes `child_milestone` (`turn`, redacted `childEvent`) when `milestone.everyTurns` divides the child turn or a host `milestone.predicate` matches; with neither configured it reports the milestone event subset. `stream` publishes every per-turn provider/tool/turn event as `delegation_child_event` — never per-token `message_delta` or full `message_*` payloads; the supervisor-wide `childEvents: true` does the same for children without their own policy.
- **Budget share.** `budgetShare` (0, 1] scales the inherited `maxSteps`/`maxToolCalls`/`maxTokens`/`timeoutMs` before `narrowSupervisorLimits` clamps them, so a child can never exceed its parent or host limits. It is a fraction of the *inherited supervisor limits*, not of live parent-run usage (the tool boundary carries no parent budget snapshot).
- **Caps and rate.** Projected child events pass the supervisor `redactor` first, are capped by `limits.maxChildEventsPerDelegation` and `limits.maxChildEventBytes`, and are rate-coalesced to `limits.maxChildEventsPerSecond` (default 10/s per child, floor 1/s window). A capped child publishes one `delegation_child_events_capped`; coalescing publishes `delegation_child_events_coalesced` with the dropped count when a window closes or the pump stops, so gaps are never silent. Size the rate to the host event loop: 10/s per child is trivial for a UI; raise it only for a child whose tool events are the UI.

### Child event passthrough (opt-in)

`createSupervisor({ childEvents: true })` raises the default report ceiling to `stream` for children without their own `policy.report`: it projects redacted, size-capped child `AgentEvent`s onto the same stream as `delegation_child_event` (tagged `childId`, `delegationId`, `depth`). Covered: run start/finish/`suspended`/`denied`, tool-execution started/finished/error/blocked, and turn/provider-turn started/finished — not per-token `message_delta` or full `message_*` payloads. Default off: the stream is byte-identical to today (no subscribe, no allocation). Per-child `policy.report` is authoritative; a model request can only lower it. Caps: `limits.maxChildEventsPerDelegation` (256/4096), `limits.maxChildEventBytes` (32 KiB/256 KiB), and `limits.maxChildEventsPerSecond` (10/1000); exceeding count/bytes drops further child events and emits one `delegation_child_events_capped` marker, exceeding the rate coalesces into `delegation_child_events_coalesced` (never throws). Events pass through the supervisor `redactor` before emission. Children never receive supervisor internals or store/subscription access. Resume-path rebuilds (`resumeNestedRun`) replay the persisted report/every-turns/share policy onto the rebuilt child session, so a delegation that suspended for approval keeps projecting milestones after the root run resumes; counters restart per pump, so each attempt gets the full cap.

### Recovery telemetry

`summary()` returns one frozen row per allow-listed child — `{ childId, attempts, retries, failures, failureRadius, outcome }` — maintained incrementally (O(1) per delegation, O(children) to read) and cumulative for the supervisor's lifetime, so a host can diff snapshots per root run or watch a long-lived supervisor without host-side aggregation.

- `outcome` is `idle` before the first delegation, `running` while any is live, otherwise the `delegation_finished.status` vocabulary (`succeeded`/`failed`/`aborted`/`suspended`/`denied`) or `rejected` for a hook denial. Resuming a suspended run updates the outcome but is not a new attempt.
- `attempts` counts started delegations, hook rejections included. `retries` counts attempts started after a `failed`/`aborted` outcome — the recovery re-dispatch metric.
- `failures` counts delegations that died on an error or a limit; host cancels, denials, and hook rejections are excluded.
- `failureRadius` is the blast radius of the child's most recent failure: task-lifetime descendant delegations still live at that moment. An unrelated or already-finished child is not counted, and a session-lifetime child is detached from the failed subtree by design.

Failure attribution is the same object the `child_failed` event carries, so a host that only keeps the summary and one that only keeps events read the same taxonomy.

## Request/response example

```json
{"childId":"research","input":"Check primary sources","limits":{"maxTokens":4000}}
```

## Implementation example

```ts
import { createSupervisor } from "@arnilo/prism-core/runtime/supervisor";

const supervisor = createSupervisor({
  ownership: { tenantId: "tenant", userId: "user" },
  permission: parentPolicy,
  children: {
    research: {
      permission: readOnlyPolicy,
      createAgent: ({ resourceId, threadId, permission, delegate }) =>
        createResearchAgent({ resourceId, threadId, permission, delegate }),
    },
  },
  hooks: { before: ({ input }) => ({ input, limits: { maxTokens: 4000 } }) },
});

const result = await supervisor.delegate({ childId: "research", input: "Check sources" });
```

## Model-facing spawn tool

`createSpawnAgentTool({ supervisor })` turns the same host-owned child allow-list into non-exclusive `spawn_agent` tool calls, so independent calls use the parent session's `toolConcurrency`. The schema has only `childId`, `input`, optional `threadId`, `mode: "sync" | "async"` (default `sync`), `lifetime: "task" | "session"`, `report`, `milestone.everyTurns`, and `budgetShare`; unknown children and malformed policy args fail closed as standard tool errors before delegation. Model arguments cannot supply child tools, identity, scopes, predicate functions, or higher limits. Async returns only a local `{ delegationId, status: "running" }` handle; a `lifetime: "session"` spawn is always async. Install `wait_agent` once per handle for wait-all, or `cancel_agent` to abort it (also the explicit end for a session-lifetime child); cancellation is terminally reported by `wait_agent`. Parent-run abort propagates to running task-lifetime children only. Handles are in-process, ownership-scoped, and bounded — they do not survive host restart.

```ts
import { createAgent } from "@arnilo/prism";
import { createCancelAgentTool, createSpawnAgentTool, createWaitAgentTool } from "@arnilo/prism-core/runtime/supervisor";

const parent = createAgent({
  /* parent model/provider */
  tools: [createSpawnAgentTool({ supervisor }), createWaitAgentTool({ supervisor }), createCancelAgentTool({ supervisor })],
});
await parent.createSession().run("Research auth and billing", {
  loop: { strategy: "single-shot", toolConcurrency: 2 },
});
```

> **Contract — child factories return `Agent`.** `createAgent` must return an `Agent`, not an `AgentSession` (or a plain object). Wrong type throws `SupervisorError: child "<id>" factory must return an Agent, got <type>` on both initial `delegate()` and nested resume. Nested approvals also need a **stable config** plus a **durable (or rebuild-stable) store** — calling `createSession()` inside the factory and returning that session loses the child's checkpointed leaf. Live demo: [`examples/autonomous-coding-loop.ts`](../examples/autonomous-coding-loop.ts) (`childAgent` returns `createAgent(...)`).

## Durable child approvals

With `checkpoints` + `definitionRevision`, every child run is durable with `interruptBeforeTool: true`. A child that suspends on pending decisions throws `AgentDelegationSuspendedError` out of `delegate()`; when the delegation runs inside a root agent's tool, core converts it into a root suspension whose `interruption.pendingDecisions` carry hashed root-visible approval ids (`sub_<sha256(runId:childApprovalId)>`) and `attribution.path` (redacted child ids, root first, at most 8 deep). Root decisions route back through the same CAS rules: pass `supervisor.resumeNestedRun` as `resumeNestedRun` in the root run's `runState` and in every `resumeAgentRun` options object. The supervisor rebuilds the child from a bounded delegation mapping stored in the same checkpoint store (child id, delegation/thread ids, redacted input, version), re-runs the `before` hook so its narrowing applies to the resumed run (hooks must be idempotent), and re-attributes re-suspensions recursively, so grandchild decisions surface with the full path. A delegating child's own `interruptBeforeTool` also gates its delegate tool, so hosts approve delegation and the child's own side effects as separate stages. Root `*_for_run` stickies record the attribution path and only match the same delegation path; child stickies live on the child run and expire with it. A root approval never widens the child: the child's narrowed permission re-runs at dispatch. Unknown or foreign nested run ids fail closed with one non-enumerating error. A resumed attempt is terminal-symmetric with live `delegate()`: it publishes `delegation_finished` (`delegation_rejected` when the re-run `before` hook denies) and runs `hooks.after` once with the original `childId`/`delegationId`, which is what lets an isolated child's worktree be cleaned up. A suspended child stays non-terminal — no finish event, no `after` — and a rebuild that throws before the run starts (stale version, fingerprint drift) publishes nothing and runs no terminal hook, so a duplicate resume attempt can never clean up a live suspended child. Child factories must return stable configs and a durable (or rebuild-stable) session store for resume to work.

## Extension and configuration notes

Parallel isolated children: wrap one catalog factory with `createWorktreeChildFactory` from `@arnilo/prism-coding-tools/agent` and pass its `after` as the supervisor's terminal hook — the supervisor stays git-agnostic, and the child context gains `cwd` pointing at its own linked worktree. See [Coding workspaces](coding-workspaces.md#spawn-isolation-supervisor-children).

Child factories resolve their own providers/credentials and construct context/memory using the supplied IDs. Parent, child, returned-agent, budget, and hook permission policies are AND-composed. Child/request/hook limits can only lower inherited limits. A nested factory can call the supplied `delegate()`; immutable path state rejects cycles and depth overflow.

Supervisors propagate parent `identity` and `effectStore` to every child agent/run so delegated tool effects stay under the same ownership scope. Set host-authored `SupervisorChild.scopes` to derive a child identity with `narrowIdentity`; `assertIdentityPropagation` rejects scope widening before its factory runs.

## Security and performance notes

- Child IDs are explicit; no package/provider discovery occurs.
- `resourceId` and `threadId` include supervisor/delegation/child identity. Do not replace them with parent memory IDs.
- Tool budget is checked before side effects. Token usage is enforced on terminal aggregate usage and can exceed by at most one provider turn because providers report tokens after generation.
- Abort and timeout cover hooks, child creation, nested delegation, and the run. Host child code must cooperate with `AbortSignal`.
- Redaction applies before hook input, run metadata/results, completion hooks, and events. Child credentials are never supplied in delegation context.
- When forwarding verified identity into children or A2A, use `narrowIdentity` / `assertIdentityPropagation` so scopes and tenant cannot widen across the boundary.
- Static workflows remain smaller and more reproducible for known graphs.

## Related APIs

- [Multi-agent patterns](multi-agent-patterns.md): the decision table comparing this delegation pattern with in-session handoff (swarm) and A2A; handoff keeps one transcript, delegation keeps separate child runs — choose by boundary, budget, and telemetry needs.
- [Agent identity](agent-identity.md): host-verified identity and narrow delegation.
- [A2A interoperability](a2a.md): separate remote protocol boundary. `A2ATaskLifecycle` adapts host durable agent/workflow state directly; it does not route A2A execution through local supervisor child planning.
- [Workflows](workflows.md): preferred deterministic orchestration.
- [Coding workspaces](coding-workspaces.md): opt-in per-child worktree isolation via `createWorktreeChildFactory`.
- [Coding agent tools](coding-agent-tools.md): opt-in `observeSupervisorLifecycle` bridges supervisor `delegation_*` events to coding `subagent_started` / `subagent_stopped` for host timelines; `supervisor.summary()` covers recovery counters (`retries`, `failures`, `failureRadius`) that the lifecycle bridge does not carry.
- Examples: [`examples/autonomous-coding-loop.ts`](../examples/autonomous-coding-loop.ts) — per-child models, factory returns `Agent`; [`examples/spawn-agent-tool.ts`](../examples/spawn-agent-tool.ts) — two model-requested explore children in one tool turn.
- [Working and semantic memory](working-and-semantic-memory.md): child scope construction.
- [Host security](host-security.md): permission and credential boundaries.
- [Obscura browser engine](obscura.md): optional binary-backed generic tools for child agents.
