# Model routing

## What it does

`@arnilo/prism-model-router` is an optional governance facade over an existing `ProviderResolver`. It enforces allow-lists, residency, token/cost budgets, rate limits, circuit breaking, and bounded fallbacks before provider selection, and emits redacted selection diagnostics. It does not implement a second provider runtime.

## When to use it

Use it for enterprise hosts that must deny models/regions before any provider call and attribute selection for audit. Skip it when a plain `createProviderResolver` allow-list is enough.

Do not put secrets, prompts, or raw OpenRouter keys into diagnostics. Do not honor `compat.openRouterRouting` unless `allowOpenRouterRouting: true`.

## Inputs / request

| API / field | Meaning |
| --- | --- |
| `createModelRouter({ resolver, stateStore?, ... })` | Wraps host `ProviderResolver`; omit `stateStore` for in-process memory state or pass durable async state. |
| `allowList.providers` / `allowList.models` | Exact provider id / model id or `provider/model` |
| `allowedResidencies` | Request residency must match when configured |
| `budgets` / per-call `maxTokens` / `maxCostUsd` | Finite non-negative ceilings; `recordUsage` charges |
| `rateLimit` | Per identity+model key window |
| `circuit` | Failure threshold + cooldown; keys capped |
| `fallbacks` | Ordered candidates after primary; total attempts capped |
| `allowOpenRouterRouting` | Default `false`; when false, routing metadata is stripped |
| `onDiagnostics` | Optional redacted hook (e.g. policy ledger evidence ref) |
| `router.resolve({ model, identity?, residency?, ... })` | Rich async selection |
| `router.providerSource` | Sync facade only for memory state; with `stateStore` it throws `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE` rather than bypass durable checks. |

Frozen caps (default / hard): attempts `3 / 8`, circuit keys `1,024 / 16,384`, diagnostics `8 KiB / 64 KiB`.

## Outputs / response / events

- `ModelRouterResolveResult` — selected `provider` + possibly stripped `model`, `diagnostics`, and `providerRequestPolicy`.
- Deny throws `ModelRouterError` with code + redacted `diagnostics` (allow-list/residency/budget fail closed without calling resolver).
- `await recordOutcome({ identity, success, circuitProbeToken? })` opens/closes circuits; `await recordUsage({ identity, ... })` advances budgets. Pass the probe token returned by `resolve` for a half-open outcome.

## Request/response example

```json
{
  "outcome": "allow",
  "selectedProvider": "openrouter",
  "selectedModel": "auto",
  "attempts": [
    { "provider": "openai", "model": "gpt-4o", "outcome": "circuit_open", "reason": "circuit_open" },
    { "provider": "openrouter", "model": "auto", "outcome": "selected" }
  ],
  "identityRefs": { "tenantId": "t1", "principalId": "a1", "principalKind": "agent" },
  "openRouterRoutingHonored": false,
  "residency": "eu"
}
```

## Implementation example

```ts
import { createAgent, createProviderResolver } from "@arnilo/prism";
import { createModelRouter } from "@arnilo/prism-model-router";
import { createPostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";

const enterprise = await createPostgresEnterpriseState({ pool, schema: "prism" });
const router = createModelRouter({
  resolver: createProviderResolver(providers),
  stateStore: enterprise.modelRouter,
  allowList: { providers: ["openai", "openrouter"] },
  allowedResidencies: ["eu"],
  fallbacks: [{ provider: "openrouter", model: "auto" }],
  allowOpenRouterRouting: false,
});

const { provider, model, providerRequestPolicy } = await router.resolve({
  model: sessionModel,
  identity,
  residency: "eu",
  maxCostUsd: 0.25,
});

const agent = createAgent({
  model,
  provider,
  providerRequestPolicies: [providerRequestPolicy],
});
await router.recordUsage({ identity, provider: provider.id, model: model.model, tokens: 500 });
await router.recordOutcome({ identity, provider: provider.id, model: model.model, success: true });
await enterprise.close();

// `router.providerSource` is unavailable with durable state; resolve before provider I/O.
```

## Extension and configuration notes

Router is optional. Chain returned `providerRequestPolicy` with other `ProviderRequestPolicy` values. Wire `onDiagnostics` to `@arnilo/prism-policy` when audit export is required. OpenRouter package behavior is unchanged; routing metadata participates only when this gate allows it.

## Security and performance notes

- Allow-list and residency denies never call the underlying resolver.
- Without `stateStore`, budget/rate/circuit state is process-local, memory-capped, and oldest keys evict. It is not a cross-replica production path.
- With `stateStore: createPostgresEnterpriseState(...).modelRouter`, rate/budget updates and circuit probes are atomic across replicas, use database time, and are owner/principal/provider/model scoped. Router calls become asynchronous and require verified identity.
- Diagnostics carry identity refs and attempt outcomes only — no prompts/secrets. Durable state stores at most bounded numeric/timestamp/token material, never prompts or credentials.
- Selection is O(attempts × state operations); no provider network I/O happens inside state updates. Recorded 0.0.23 PostgreSQL p95 point operations stayed under 50 ms and cursor/cleanup pages under 100 ms on the documented fixture.
- Raising hard caps requires a reviewed release update with tests and docs.

## Related APIs

- [Provider layer](provider-layer.md)
- [Provider request policies](provider-request-policies.md)
- [OpenRouter](providers/openrouter.md)
- [Policy and audit](policy-and-audit.md)
- [Agent identity](agent-identity.md)
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable router state, migration, cleanup, and ownership requirements.
- Package README: [`@arnilo/prism-model-router`](../packages/model-router/README.md)
