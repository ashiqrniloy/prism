# Model routing

## What it does

`@arnilo/prism-model-router` is an optional governance facade over an existing `ProviderResolver`. It enforces allow-lists, residency, token/cost budgets, rate limits, circuit breaking, and bounded fallbacks before provider selection, and emits redacted selection diagnostics. It does not implement a second provider runtime.

## When to use it

Use it for enterprise hosts that must deny models/regions before any provider call and attribute selection for audit. Skip it when a plain `createProviderResolver` allow-list is enough.

Do not put secrets, prompts, or raw OpenRouter keys into diagnostics. Do not honor `compat.openRouterRouting` unless `allowOpenRouterRouting: true`.

## Inputs / request

| API / field | Meaning |
| --- | --- |
| `createModelRouter({ resolver, ... })` | Wraps host `ProviderResolver` |
| `allowList.providers` / `allowList.models` | Exact provider id / model id or `provider/model` |
| `allowedResidencies` | Request residency must match when configured |
| `budgets` / per-call `maxTokens` / `maxCostUsd` | Finite non-negative ceilings; `recordUsage` charges |
| `rateLimit` | Per identity+model key window |
| `circuit` | Failure threshold + cooldown; keys capped |
| `fallbacks` | Ordered candidates after primary; total attempts capped |
| `allowOpenRouterRouting` | Default `false`; when false, routing metadata is stripped |
| `onDiagnostics` | Optional redacted hook (e.g. policy ledger evidence ref) |
| `router.resolve({ model, identity?, residency?, ... })` | Rich async selection |
| `router.providerSource` | Sync `ProviderResolver` facade for `AgentConfig` |

Frozen caps (default / hard): attempts `3 / 8`, circuit keys `1,024 / 16,384`, diagnostics `8 KiB / 64 KiB`.

## Outputs / response / events

- `ModelRouterResolveResult` — selected `provider` + possibly stripped `model`, `diagnostics`, and `providerRequestPolicy`.
- Deny throws `ModelRouterError` with code + redacted `diagnostics` (allow-list/residency/budget fail closed without calling resolver).
- `recordOutcome({ success })` opens/closes circuits; `recordUsage` advances budgets.

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

const router = createModelRouter({
  resolver: createProviderResolver(providers),
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
// or: providerSource: router.providerSource
```

## Extension and configuration notes

Router is optional. Chain returned `providerRequestPolicy` with other `ProviderRequestPolicy` values. Wire `onDiagnostics` to `@arnilo/prism-policy` when audit export is required. OpenRouter package behavior is unchanged; routing metadata participates only when this gate allows it.

## Security and performance notes

- Allow-list and residency denies never call the underlying resolver.
- Budget/rate/circuit state is memory-capped; oldest keys evict.
- Diagnostics carry identity refs and attempt outcomes only — no prompts/secrets.
- Selection is O(attempts × map ops); no network I/O inside the router.
- Raising hard caps requires Phase 8 freeze + tests + docs updates.

## Related APIs

- [Provider layer](provider-layer.md)
- [Provider request policies](provider-request-policies.md)
- [OpenRouter](providers/openrouter.md)
- [Policy and audit](policy-and-audit.md)
- [Agent identity](agent-identity.md)
- Package README: [`@arnilo/prism-model-router`](../packages/model-router/README.md)
