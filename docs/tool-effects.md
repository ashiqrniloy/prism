# Recoverable tool effects

## What it does

Optional tool-effect contracts record whether a tool call may mutate state and how Prism recovers after crash or duplicate delivery. When a host supplies `effectStore` and a tool declares `effect`, dispatch claims before side effects, marks dispatched before execute, and completes or marks unknown after. Ambiguous outcomes never auto-replay. This is at-least-once claim coordination, not exactly-once delivery.

APIs:

- `ToolEffectDeclaration` / `ToolEffectClassifier` on `ToolDefinition.effect`
- `ToolEffectStore` (`get` / `begin` / `markDispatched` / `complete` / `fail` / `markUnknown` / `resolveUnknown` / `cleanup`)
- `createMemoryToolEffectStore()` (in-process reference)
- `deriveToolEffectKey()` / `toolEffectArgumentsHash()` / `canonicalToolEffectJson()`
- Enterprise: `createPostgresEnterpriseState().toolEffects`

## When to use it

Use when tools perform local or external mutations and a host needs durable claim/CAS recovery across process restart. Skip for pure observation tools (`kind: "none"`). Keep `session.subscribe()` for live UI; pair durable events with [Agent events](agent-events.md) when reconnecting replicas.

## Inputs / request

| Field | Values | Meaning |
| --- | --- | --- |
| `kind` | `none` / `local_mutation` / `external_mutation` | Observation vs local vs external side effect |
| `idempotency` | `none` / `optional` / `required` / `tool_managed` / `unsupported` | Whether core claims a key |
| `effectStore` | on `AgentConfig` / `RunOptions` | Opt-in store; required when idempotency is `required` |
| `context.idempotencyKey` | core-derived only | Model-supplied keys are ignored |

Statuses: `pending` → `dispatched` → `completed` | `failed_retryable` | `failed_terminal` | `unknown`. Expired pending becomes retryable; expired dispatched becomes unknown. Unknown needs operator `resolveUnknown`.

## Outputs / response / events

| Outcome | Behavior |
| --- | --- |
| First claim | `begin` acquires; dispatch marks dispatched then executes |
| Duplicate completed | returns bounded stored result; tool body does not rerun |
| Ambiguous crash | `unknown` + `ERR_PRISM_TOOL_EFFECT_UNKNOWN`; never silent replay |
| Unsupported | no store/identity required; host owns recovery |

## Request/response example

```json
{
  "kind": "external_mutation",
  "idempotency": "required"
}
```

## Implementation example

```ts
import { createAgent, createMemoryToolEffectStore, dispatchToolCall } from "@arnilo/prism";

const effectStore = createMemoryToolEffectStore();
const tool = {
  name: "mail.send",
  description: "Send mail",
  parameters: { type: "object", properties: {} },
  effect: { kind: "external_mutation", idempotency: "required" },
  execute: async (_args, context) => ({ toolCallId: context.toolCallId, name: "mail.send", value: { sent: true } }),
};

const agent = createAgent({ model, provider, tools: [tool], effectStore });
```

Runnable demo: `examples/distributed-events-and-tool-effects.ts`.

## Extension and configuration notes

| Surface | Classification |
| --- | --- |
| Coding read/list/search/glob | `none` / `none` |
| Coding write/edit/delete/move/git commit | `local_mutation` / `optional` |
| Coding shell / check | `external_mutation` / `unsupported` |
| Browser observation | `none` / `none` |
| Browser mutation | `external_mutation` / `unsupported` |
| Work connector reads | `none` / `none` |
| Work connector mutations | `external_mutation` / `tool_managed` (core key + store) |
| MCP remote tools | host `effect` policy; default unsupported |
| Supervisor children | inherit parent `identity` + `effectStore` |

## Security and performance notes

- Ownership and verified identity bind every claim key; cursors/keys never select tenants.
- Results/references are byte-bounded and redacted; oversized writes fail closed.
- Claim TTL default 15 min (hard 60); attempts default 3 (hard 10); unknown has no auto-expiry.
- PostgreSQL store uses parameterized CAS; request roles stay `SELECT`/`INSERT`/`UPDATE`/`DELETE` only.
- Recorded p95 claim/transition ≈ 3.1 ms under Task 0 ceilings — see [performance](performance.md).

## Related APIs

- [Tools](tools.md): dispatch harness that hosts effect claim/recovery.
- [Agent events](agent-events.md): durable `AgentEventSource` for replica reconnect (separate from effect claims).
- [Work tools](work-tools.md): connector `tool_managed` reconciliation.
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable `toolEffects` store.
- [Host security](host-security.md): unknown-outcome fail-closed guidance.
