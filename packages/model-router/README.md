# @arnilo/prism-model-router

Optional model governance router over Prism `ProviderResolver`: allow-list, residency, budgets, rate limits, circuit breaking, bounded fallbacks, redacted diagnostics, and an OpenRouter routing gate.

Install explicitly. Not in `prism-code` / `prism-sdk` (Task 10 enrolls `prism-all` only).

## Install

```bash
npm install @arnilo/prism-model-router @arnilo/prism
```

## Usage

```ts
import { createProviderResolver } from "@arnilo/prism";
import { createModelRouter } from "@arnilo/prism-model-router";

const router = createModelRouter({
  resolver: createProviderResolver(providers),
  allowList: { providers: ["openai", "openrouter"], models: ["gpt-4o", "openrouter/auto"] },
  allowedResidencies: ["eu"],
  budgets: { maxTokens: 200_000, maxCostUsd: 5 },
  rateLimit: { maxRequests: 60, windowMs: 60_000 },
  circuit: { failureThreshold: 3, coolDownMs: 30_000 },
  fallbacks: [{ provider: "openrouter", model: "auto" }],
  allowOpenRouterRouting: false, // set true only when policy permits
  onDiagnostics: (d) => { /* optional @arnilo/prism-policy evidence ref */ },
});

const { provider, model, providerRequestPolicy, diagnostics } = await router.resolve({
  model: { provider: "openai", model: "gpt-4o" },
  identity,
  residency: "eu",
  maxCostUsd: 0.25,
});

// AgentConfig.providerSource = router.providerSource
// AgentConfig.providerRequestPolicies = [providerRequestPolicy]
router.recordOutcome({ provider: provider.id, model: model.model, success: true });
```

See [Model routing](../../docs/model-routing.md).
