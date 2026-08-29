# Supervisor delegation

## What it does

`@arnilo/prism-supervisor` adds optional runtime-selected delegation to an explicit local child allow-list. It returns normal `AgentRunResult` values and does not modify core `createAgent()` or deterministic workflows.

## When to use it

Use a supervisor when a host or agent must choose a child dynamically. Use `@arnilo/prism-workflows` for known DAGs, durable checkpoints, schedules, replay, or human suspension.

## Inputs / request

| API/field | Meaning |
| --- | --- |
| `createSupervisor({ ownership, children })` | Creates one ownership-scoped supervisor. |
| `SupervisorChild.createAgent(context)` | Child-owned factory; receives derived resource/thread IDs, narrowed permission, abort signal, and nested `delegate`. |
| `delegate({ childId, input, threadId?, limits?, signal? })` | Invokes one allow-listed child. Input is text and byte-bounded. |
| `hooks.before` | May reject, modify redacted input, or narrow limits/policy. |
| `hooks.after` | Observes redacted terminal summary; failures cannot alter settled result. |
| `limits` | Depth 4/16, active children 4/32, input 64 KiB/1 MiB, steps 8/64, tools 32/256, tokens 20k/1m, timeout 60s/30m, event queue 128/4096 default/hard. Over-cap `delegate()` throws `SupervisorLimitError` before incrementing `activeChildren`. Hook rejection and timeout decrement the count exactly once (no leaked timers). |

## Outputs / response / events

`delegate()` returns the child's `AgentRunResult` or throws its `AgentRunError`/a supervisor denial or limit error. `subscribe()` emits bounded `delegation_started`, `delegation_finished`, `delegation_rejected`, and `delegation_error` metadata events. Graceful close drains already-queued terminal events before the iterator completes (same core multiplexer contract). Hosts may project those events through observability `handleDelegation()` using the parent Prism run ID; no OpenTelemetry dependency enters this package.

## Request/response example

```json
{"childId":"research","input":"Check primary sources","limits":{"maxTokens":4000}}
```

## Implementation example

```ts
import { createSupervisor } from "@arnilo/prism-supervisor";

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

## Durable child approvals

With `checkpoints` + `definitionRevision`, every child run is durable with `interruptBeforeTool: true`. A child that suspends on pending decisions throws `AgentDelegationSuspendedError` out of `delegate()`; when the delegation runs inside a root agent's tool, core converts it into a root suspension whose `interruption.pendingDecisions` carry hashed root-visible approval ids (`sub_<sha256(runId:childApprovalId)>`) and `attribution.path` (redacted child ids, root first, at most 8 deep). Root decisions route back through the same CAS rules: pass `supervisor.resumeNestedRun` as `resumeNestedRun` in the root run's `runState` and in every `resumeAgentRun` options object. The supervisor rebuilds the child from a bounded delegation mapping stored in the same checkpoint store (child id, delegation/thread ids, redacted input, version), re-runs the `before` hook so its narrowing applies to the resumed run (hooks must be idempotent), and re-attributes re-suspensions recursively, so grandchild decisions surface with the full path. A delegating child's own `interruptBeforeTool` also gates its delegate tool, so hosts approve delegation and the child's own side effects as separate stages. Root `*_for_run` stickies record the attribution path and only match the same delegation path; child stickies live on the child run and expire with it. A root approval never widens the child: the child's narrowed permission re-runs at dispatch. Unknown or foreign nested run ids fail closed with one non-enumerating error. Child factories must return stable configs and a durable (or rebuild-stable) session store for resume to work.

## Extension and configuration notes

Child factories resolve their own providers/credentials and construct context/memory using the supplied IDs. Parent, child, returned-agent, budget, and hook permission policies are AND-composed. Child/request/hook limits can only lower inherited limits. A nested factory can call the supplied `delegate()`; immutable path state rejects cycles and depth overflow.

Supervisors propagate parent `identity` and `effectStore` to every child agent/run so delegated tool effects stay under the same ownership scope.

## Security and performance notes

- Child IDs are explicit; no package/provider discovery occurs.
- `resourceId` and `threadId` include supervisor/delegation/child identity. Do not replace them with parent memory IDs.
- Tool budget is checked before side effects. Token usage is enforced on terminal aggregate usage and can exceed by at most one provider turn because providers report tokens after generation.
- Abort and timeout cover hooks, child creation, nested delegation, and the run. Host child code must cooperate with `AbortSignal`.
- Redaction applies before hook input, run metadata/results, completion hooks, and events. Child credentials are never supplied in delegation context.
- When forwarding verified identity into children or A2A, use `narrowIdentity` / `assertIdentityPropagation` so scopes and tenant cannot widen across the boundary.
- Static workflows remain smaller and more reproducible for known graphs.

## Related APIs

- [Agent identity](agent-identity.md): host-verified identity and narrow delegation.
- [A2A interoperability](a2a.md): separate remote protocol boundary. `A2ATaskLifecycle` adapts host durable agent/workflow state directly; it does not route A2A execution through local supervisor child planning.
- [Workflows](workflows.md): preferred deterministic orchestration.
- [Working and semantic memory](working-and-semantic-memory.md): child scope construction.
- [Host security](host-security.md): permission and credential boundaries.
- [Obscura browser engine](obscura.md): optional binary-backed generic tools for child agents.
