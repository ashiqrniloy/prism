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
| `limits` | Depth 4/16, active children 4/32, input 64 KiB/1 MiB, steps 8/64, tools 32/256, tokens 20k/1m, timeout 60s/30m, event queue 128/4096 default/hard. |

## Outputs / response / events

`delegate()` returns the child's `AgentRunResult` or throws its `AgentRunError`/a supervisor denial or limit error. `subscribe()` emits bounded `delegation_started`, `delegation_finished`, `delegation_rejected`, and `delegation_error` metadata events. Hosts may project those events through observability `handleDelegation()` using the parent Prism run ID; no OpenTelemetry dependency enters this package.

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

## Extension and configuration notes

Child factories resolve their own providers/credentials and construct context/memory using the supplied IDs. Parent, child, returned-agent, budget, and hook permission policies are AND-composed. Child/request/hook limits can only lower inherited limits. A nested factory can call the supplied `delegate()`; immutable path state rejects cycles and depth overflow.

## Security and performance notes

- Child IDs are explicit; no package/provider discovery occurs.
- `resourceId` and `threadId` include supervisor/delegation/child identity. Do not replace them with parent memory IDs.
- Tool budget is checked before side effects. Token usage is enforced on terminal aggregate usage and can exceed by at most one provider turn because providers report tokens after generation.
- Abort and timeout cover hooks, child creation, nested delegation, and the run. Host child code must cooperate with `AbortSignal`.
- Redaction applies before hook input, run metadata/results, completion hooks, and events. Child credentials are never supplied in delegation context.
- Static workflows remain smaller and more reproducible for known graphs.

## Related APIs

- [A2A interoperability](a2a.md): separate remote protocol boundary. `A2ATaskLifecycle` adapts host durable agent/workflow state directly; it does not route A2A execution through local supervisor child planning.
- [Workflows](workflows.md): preferred deterministic orchestration.
- [Working and semantic memory](working-and-semantic-memory.md): child scope construction.
- [Host security](host-security.md): permission and credential boundaries.
