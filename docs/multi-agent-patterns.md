# Multi-agent patterns: handoff, crew, supervisor, spawn tool, A2A

## What it does

Maps five Prism answers for "more than one agent" onto one decision table. All five compose existing seams — none introduces a new runtime:

- **In-session handoff (swarm)** — agent A transfers control of the ongoing conversation to agent B by calling a host-built `handoff` tool; the host resolves the target `AgentDefinition` with `resolveAgentDefinition` and opens the specialist against the same session (same store + session id, previous run's `leafId`). One transcript, no new session. No helper primitive ships; the tool factory lives in [`examples/handoff-swarm.ts`](../examples/handoff-swarm.ts).
- **Hierarchical crew** — a manager agent decomposes a goal into typed tasks (`{ tasks: [{ role, instruction }] }`) via structured output ([`Artifact*`](structured-output.md)), fans out to parallel role specialists with bounded `maxFanOut` ([`fanOutNode`](workflows.md)), aggregates deliverables with host reduce ([`joinNode`](workflows.md)), and validates outputs with conditional routing to completion or revision ([`conditionalNode`](workflows.md)). The entire process is a deterministic DAG workflow with zero new runtime primitives. Live demo in [`examples/crew-hierarchy.ts`](../examples/crew-hierarchy.ts).
- **Supervisor delegation** — `@arnilo/prism-core/runtime/supervisor` `delegate()` invokes allow-listed child agents as bounded runs and returns their result to the parent. Separate child transcripts, hooks, budgets, narrowing.
- **In-process spawn tool** — `createSpawnAgentTool({ supervisor })` gives a parent model non-exclusive sync or bounded async `spawn_agent` calls over that same host-owned supervisor catalog; `wait_agent` / `cancel_agent` join or abort local handles. It is an API adapter, not a runtime.
- **A2A 1.0** — cross-service interop over the JSON-RPC/HTTPS binding; the remote peer's lifecycle is host-owned behind `A2ATaskLifecycle`.

## When to use it

| Pattern | Use when | Conversation boundary | Ownership / identity | Telemetry |
| --- | --- | --- | --- | --- |
| In-session handoff | One host, one ongoing conversation; the model decides **when** to transfer; specialists are alternate definitions of the same app | One continuous transcript chain (same store, session id, `leafId`) | Same session scope; give the specialist its own identity via its definition (`AgentConfig.identity` / `RunOptions.identity`) | Attribution is per-run: each `session.run()`'s events/result belong to the active definition — record the swap in host bookkeeping; no `delegated_agent_step` event exists for in-process swaps |
| Hierarchical crew | A goal requires dynamic decomposition by a manager LLM, parallel execution by role specialists, host aggregation, and conditional validation/revision loop | Workflow DAG execution — each specialist executes a bounded child task session; final deliverable returns to host | Workflow tenant/ownership scopes propagate; specialists activate only their own narrowed `tools` | Workflow node events (`node_started`/`node_finished`/`agent_event`); task attribution per role in the aggregated deliverable |
| Supervisor delegation | Host code dynamically selects a bounded child run | Separate runs; child result returns to the host | Parent identity/effectStore propagate; child factories receive derived resource/thread ids and AND-composed permission | Dedicated `delegation_started/finished/rejected/error` events, projectable through observability `handleDelegation()`; opt-in `delegation_child_event` passthrough |
| In-process spawn tool | Parent model needs an allow-listed child as a non-exclusive tool call | Separate runs; sync result returns through `spawn_agent`, async handle joins through `wait_agent` | Host owns catalog, tools, scopes, limits, and local handles; schema accepts only child ID/input/thread ID/mode plus policy args the host ceiling allows | Same supervisor `delegation_*` events; with host opt-in, `child_milestone` / `delegation_child_event` (redacted, capped, rate-coalesced) |
| A2A 1.0 | The other agent is owned by a **different service/deployment**; cross-org or cross-cluster; needs durable task lifecycle, push configs, streaming | Protocol boundary (JSON-RPC/HTTPS agent card); replay/reconnect via host-owned task adapter | Exact-origin verified client, `A2AAuthorization` per operation, principal-scoped push configs | Host-owned task adapter records the remote lifecycle; Prism creates no worker/store |

Rule of thumb: same conversation → handoff; dynamic task decomposition + parallel execution → hierarchical crew; host-selected same-process subtask → supervisor delegation; model-requested allow-listed subtask → in-process spawn tool; different deployment/trust boundary → A2A.

## How in-session handoff works

The pattern is a definition swap over existing seams — triage keeps calling `handoff(target)`; the host authorizes, swaps, and continues the same session:

```ts
// Host-built allow-list tool; untrusted target -> fail-closed tool error result.
const handoffTool: ToolDefinition = {
  name: "handoff",
  description: "Transfer this conversation to a named specialist agent.",
  parameters: { type: "object", required: ["target"], properties: { target: { type: "string" } } },
  execute(args, ctx): ToolResult {
    const target = String((args as { target: string }).target);
    if (!(target in handoffTargets)) {
      return { toolCallId: ctx.toolCallId, name: "handoff", error: { message: `Unknown handoff target: ${target}` } };
    }
    return { toolCallId: ctx.toolCallId, name: "handoff", value: { transferredTo: target } };
  },
};

// Host authorizes the transfer mid-run: resolve the target definition and
// continue the SAME session (same store + sessionId). The previous run's
// leafId carries the transcript pointer; without it the next append forks
// a sibling branch and the specialist loses the carried context.
const specialist = await resolveAgentDefinition(handoffTargets[target], {
  tools: [refundTool],              // narrowed: no handoff tool unless the host allows it
  overrides: { provider: specialistProvider },
});
const specialistSession = createAgentSession({ agent: specialist, store, id: "handoff-demo", leafId: triageRun.leafId });
```

Live demo: [`examples/handoff-swarm.ts`](../examples/handoff-swarm.ts) — triage → billing transfer with fail-closed unknown target, a specialist whose re-handoff attempt is blocked (`unknown_tool`), and zero provider calls for the swap (it is a registry-level operation).

Two non-obvious details the example encodes:

1. **`leafId` carries the transcript pointer.** The specialist session must pass the triage run's `leafId`; creating the session without it appends to a sibling branch and the specialist loses the carried context.
2. **Carried context is the transcript chain itself.** Handoff is not delegation: there is no input-payload boundary to sanitize; whatever was said to triage is what the specialist reads.

## How hierarchical crew orchestration works

Hierarchical multi-agent orchestration (the CrewAI "Hierarchical Process" pattern) decomposes a high-level goal into structured tasks, assigns each task to a role specialist agent in parallel, aggregates deliverables, and validates the outcome in a deterministic workflow:

```ts
// 1. Manager produces a typed task plan via structured output.
//    Untrusted model output is validated against the schema before updating state.
const manager = agentNode({
  agent: "manager",
  input: (ctx) => ({ goal: ctx.workflowInput }),
  output: async (ctx) => {
    const plan = parseTaskPlan(await getSessionOutput(ctx.session));
    if (!plan.ok) throw new Error(`Invalid task plan: ${plan.error}`);
    await ctx.updateState({ plan: plan.value });
    return plan.value;
  },
});

// 2. fan_out maps each task item to its corresponding role specialist.
const fan = fanOutNode({
  items: (ctx) => (ctx.state.plan as TaskPlan).tasks,
  map: async (task, _index, _ctx) => {
    const agent = await resolveAgentDefinition(definitions[task.role], { tools });
    const session = createAgentSession({ agent });
    const result = await session.run(task.instruction);
    return { role: task.role, result: result.text, attribution: { agent: task.role } };
  },
  maxFanOut: 8,
});

// 3. join aggregates all specialist deliverables and computes per-role attribution.
const aggregate = joinNode({
  from: "fan",
  reduce: async (items, ctx) => ({
    deliverables: items,
    summary: items.map((d) => `[${d.role}]: ${d.result}`).join("\n"),
    validationPassed: evaluateQuality(items),
  }),
});

// 4. conditional validation routes to completion or revision.
const validate = conditionalNode({
  when: async (ctx) => Boolean((ctx.upstream.aggregate as AggregatedDeliverable).validationPassed),
  then: ["complete"],
  else: ["revise"],
});

const complete = functionNode({ execute: async (ctx) => formatDeliverable(ctx.upstream.aggregate) });
const revise = functionNode({ execute: async (ctx) => formatRevision(ctx.upstream.aggregate) });

// 5. Entire flow is a single defineWorkflow DAG with fixed revision ID.
const crewWorkflow = defineWorkflow({
  revision: "crew-demo-1",
  id: "hierarchical-crew",
  nodes: { manager, fan, aggregate, validate, complete, revise },
  edges: [
    ["manager", "fan"],
    ["fan", "aggregate"],
    ["aggregate", "validate"],
    ["validate", "complete"],
    ["validate", "revise"],
  ],
  limits: { maxFanOut: 8, maxConcurrency: 4, maxNodes: 32 },
});
```

Live demo: [`examples/crew-hierarchy.ts`](../examples/crew-hierarchy.ts) — manager structured task decomposition, parallel role specialists (`researcher`, `writer`), host reduce aggregation with per-role attribution, and conditional validation/revision routing.

## CrewAI to Prism mapping table

| CrewAI Concept | Prism Primitive | Notes & Documentation |
| --- | --- | --- |
| **Crew** | Workflow ([`defineWorkflow`](workflows.md)) | A deterministic DAG with explicit revision id, node concurrency, and checkpoint persistence. |
| **Manager Agent** | Agent Node ([`agentNode`](workflows.md)) + Structured Output ([`generateValidateReviseLoop`](structured-output.md)) | Manager emits a typed `{ tasks: [{ role, instruction }] }` schema via `ArtifactValidator`/`ArtifactParser`. |
| **Task** | Fan-out item ([`fanOutNode`](workflows.md)) | Bounded dynamic fan-out (`maxFanOut`), mapping each decomposed task to a role specialist session. |
| **Role Agent (Specialist)** | Agent Definition ([`resolveAgentDefinition`](agent-definitions.md)) | Declarative agent with fail-closed tool narrowing; activated per role during `fan_out.map`. |
| **Process (Sequential / Hierarchical)** | Workflow DAG ([`defineWorkflow`](workflows.md) / Edges) | Edges define data and execution dependencies; no unconstrained agent-to-agent loops. |
| **Task Output Aggregation** | Join Node ([`joinNode`](workflows.md) + `reduce`) | Host-controlled reduction aggregating specialist outputs and computing per-role attribution. |
| **Validation & Quality Review** | Conditional Node ([`conditionalNode`](workflows.md)) | Deterministic branch routing to `complete` or `revise` based on validation criteria. |
| **Process Revision Loop** | Node Retries / DAG Branching / Loop Node ([`loopNode`](workflows.md)) | Bounded retry/revision path or bounded in-graph loop iteration. |

## How the in-process spawn tool works

`createSpawnAgentTool({ supervisor })` exposes the host's child catalog as one non-exclusive `spawn_agent` tool, so a parent model can request children the host already allows. It is a thin adapter over [`supervisor.delegate()`](supervisors.md) — no new runtime, no discovery:

- The schema carries only `childId` (an enum of `Supervisor.childIds`), `input`, optional `threadId`, and `mode`. Unknown child IDs fail closed as standard tool errors before any delegation, and model arguments can never supply child tools, identity, scopes, or limits.
- Named tool calls in one tool turn run in parallel under the parent session's `toolConcurrency`, while the supervisor's reservation keeps concurrent children within `maxActiveChildren` — over-cap sync calls fail closed, async calls return handles.
- `mode: "async"` returns a local `{ delegationId, status: "running" }` handle; `createWaitAgentTool` joins it, `createCancelAgentTool` aborts it, and the parent run's abort propagates to running children. Handles are in-process, ownership-scoped, and do not survive host restart.
- Children needing repository isolation wrap their factory with `createWorktreeChildFactory` ([Coding workspaces](coding-workspaces.md#spawn-isolation-supervisor-children)); timeline visibility comes from the supervisor `delegation_*` events, optionally bridged to coding `subagent_started` / `subagent_stopped` ([Coding agent tools](coding-agent-tools.md)).

Live demo: [`examples/spawn-agent-tool.ts`](../examples/spawn-agent-tool.ts) — a narrowed read-only explore child spawned twice in parallel, an uncatalogued child refused, and both handles joined.

### Background agents (session lifetime)

A host can start a background child at session open that reports without occupying the conversation:

```ts
const supervisor = createSupervisor({
  ownership,
  signal: sessionAbort.signal, // host session end stops every child and closes the stream
  children: {
    researcher: {
      policy: { lifetime: "session", report: "milestones", milestone: { everyTurns: 5 }, budgetShare: 0.2 },
      createAgent: ({ resourceId, threadId, permission, signal, delegate }) => createResearchAgent(/* ... */),
    },
  },
});

// Host code or the parent model (spawn_agent routes session lifetime to the async path):
const handle = await supervisor.delegateAsync({ childId: "researcher", input: "watch the build", lifetime: "session" });
await supervisor.wait(handle.delegationId); // join later; cancel(handle.delegationId) ends it explicitly
```

Session-lifetime children detach from the caller and ancestor-child abort signals, hold one `activeChildren` slot until they end, and stop on `cancel_agent` / `cancel(delegationId)` or the supervisor `signal`. `budgetShare` scales the inherited steps/tool-calls/tokens/timeout limits — never above the parent or host ceiling. Reporting stays host-opt-in and redacted: `milestones` emits `child_milestone` every N turns or on a host predicate, `stream` forwards every per-turn provider/tool/turn event (never token deltas), and both are rate-coalesced at `limits.maxChildEventsPerSecond` (10/s per child default) with a `delegation_child_events_coalesced` marker. To surface them on a parent session stream, pass `childEventSink` — it receives the same redacted payload tagged `child: { childId, delegationId, depth }`, so the parent subscriber only reads `event.child`.

## Where Prism is stronger

- **Durable Human-in-the-Loop (HITL)**: Prism workflows support durable pause and resume via [`suspend()`](workflows.md#durable-suspension-and-resumption) and [`resumeWorkflow()`](workflows.md) across worker restarts or approval gates ([Agent durable approval](agent-session-runtime.md)).
- **Strict Budget & Concurrency Caps**: Workflows enforce hard limits on `maxNodes`, `maxFanOut`, `maxConcurrency`, and timeout bounds ([Workflow limits](workflows.md)).
- **Fail-Closed Capability Narrowing**: Specialists receive only their explicitly authorized `tools` via [`resolveAgentDefinition`](agent-definitions.md); managers cannot invoke specialist tools directly, preventing accidental tool leakage.
- **Untrusted Model Output Validation**: Manager task plans are treated as untrusted LLM output and validated against a typed schema before triggering fan-out ([Structured output](structured-output.md)).
- **Durable Audit & Telemetry**: Every node start/finish and agent event is emitted with deterministic sequence numbers and can be persisted to signed audit ledgers ([Policy and audit](policy-and-audit.md), [Observability](observability.md)).

## Security and performance notes

- **Transfers are explicit model-initiated, host-authorized.** The `handoff` tool exists on the triage agent's allow-list only; the target name is validated against the host-authored targets map before any definition resolves. Unknown names fail closed as a standard tool error (`Unknown handoff target: <name>`).
- **No permission escalation through handoff, delegation, or spawn.** The specialist's capabilities come solely from its own `AgentDefinition` or host-owned supervisor child factory (fail-closed for omitted capabilities). Handoff, fan-out, and spawn grant nothing: tools/identity are what the host put on that definition. The specialist cannot invoke manager tools unless its definition explicitly includes them — the standard `unknown_tool` block applies otherwise.
- **Narrowing on transfer, never widening.** If the specialist needs the caller's verified identity, project it through `narrowIdentity` / `assertIdentityPropagation` ([Agent identity](agent-identity.md)) so scopes and tenant cannot widen across the swap. For delegation the same discipline is built in (`narrowIdentity`, AND-composed policies); for A2A the exact-origin client plus per-operation authorization is the boundary.
- **Manager-generated task plans are untrusted model output.** Manager plan outputs are validated against the typed schema via `ArtifactValidator` before being persisted to workflow state or dispatched to `fan_out`. Malformed or invalid plans trigger the artifact repair loop or fail closed before any specialist is invoked.
- **Redaction of carried context.** Handoff carries the raw transcript by design — same rows a human replay would read. Apply the session egress seams on the way out: `redactSessionEntry` / `redactMessage` with a host field policy (see [Data classification](data-classification.md)) and `AgentConfig.redactor`; for durable replay across tenants reuse the redacted transcript seam discipline used by ACP `sessions.transcript` ([ACP interop](acp.md)).
- **Telemetry attribution.** Which agent produced which turn is not stored on message entries; the host knows (it performed the swap or aggregated fan-out results) and should pin it per run via `RunOptions.identity` (principal kind `agent`) so `identityTelemetryAttributes` (`prism.identity.*`) carries redacted attribution on telemetry, or via observability metadata. Supervisor runs emit dedicated `delegation_*` events plus `child_failed` attribution (terminal `status`/`stopReason`, plan-086/087 `RunLimitBreach` when a ceiling fired), and `supervisor.summary()` reports per-child `attempts`/`retries`/`failures`/`failureRadius`/`outcome` — the recovery and cascade-radius counters a host cannot reconstruct from totals alone. An in-process definition swap has no session seam to emit one, so the host records attribution.
- **Performance.** The swap performs zero provider calls; it costs one registry resolution plus one session open (~sub-millisecond in the example fixture). The transferred turn costs what any tool round costs.

## Extension and configuration notes

- Handoff targets may be code-defined `AgentDefinition` objects or `<configRoot>/agents/<name>/AGENT.md` bundles resolved via `resolveAgentBundle` — the allow-list maps names to either.
- Hosts wanting the pattern behind a UI timeline can emit their own step events from the swap.
- A reusable in-session handoff helper was evaluated and **not** shipped in 0.3.x: the unavoidable boilerplate is a ~20-line allow-list tool plus one `createAgentSession` call. Revisit only if multiple hosts show materially different swap semantics.
- Hierarchical crew patterns compose entirely on existing `@arnilo/prism-core/runtime/workflows` and `@arnilo/prism` primitives (`agentNode`, `fanOutNode`, `joinNode`, `conditionalNode`, `ArtifactValidator`, `resolveAgentDefinition`); no separate helper package is needed.

## Related APIs

- [Workflows](workflows.md): `defineWorkflow`, `fanOutNode`, `joinNode`, `conditionalNode`, `runWorkflow`.
- [Structured output](structured-output.md): `ArtifactParser`, `ArtifactValidator`, `generateValidateReviseLoop`.
- [Agent definitions](agent-definitions.md): `resolveAgentDefinition` and fail-closed capability activation — the swap seam itself.
- [Supervisor delegation](supervisors.md): same-process subtasks, model-facing spawn tool, budgets, hooks, and durable nested approvals.
- [Coding workspaces](coding-workspaces.md): per-child worktree isolation for parallel spawns.
- [A2A interoperability](a2a.md): the cross-service protocol boundary.
- [Agent identity](agent-identity.md): verified identity propagation and narrowing (`narrowIdentity`, `assertIdentityPropagation`).
- [Agent events](agent-events.md): `delegated_agent_step` and delegation event surfaces for timelines.
- [Policy and audit](policy-and-audit.md): decision ledger, approval gates, and signed audit export.
- [Observability](observability.md): OpenTelemetry agent/provider/tool hierarchy and metrics.
- [Middleware hooks](middleware-hooks.md): context bridging and redaction without permission grants.