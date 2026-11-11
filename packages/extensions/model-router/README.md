# @arnilo/prism-extensions/model-router

Native model router package for `@arnilo/prism`: cost- and latency-aware turn routing, token and cost budget reservation, circuit breakers, rate limits, and fallback over `model.call`.

## Install

```bash
prism add @arnilo/prism-extensions/model-router
```

```ts
import modelRouter from "@arnilo/prism-extensions/model-router";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "mock/fast",
  packages: [
    mockFastProvider(),
    mockLargeProvider(),
    modelRouter({
      candidates: ["mock/fast", "other/large"],
      select: "ordered",
      circuit: { failureThreshold: 3, cooldownMs: 30_000 },
      budgets: { maxTokens: 10_000, maxCostUsd: 5.0 },
    }),
  ],
});
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `candidates` | `ModelRef[]` | (required) | Ordered candidate models to route turns between (at least 1). |
| `select` | `"ordered" \| "cost-latency"` | `"ordered"` | Selection policy to rank candidates. `cost-latency` computes cost unit pricing and exponential moving average (EMA) latencies. |
| `allow` | `ModelRef[]` | `undefined` | Allow-list of models and providers. Candidates not listed are denied. |
| `budgets` | `ModelRouterBudgets` | `undefined` | Token and cost budgets (`maxTokens`, `maxCostUsd`, `windowMs`, `reservationTtlMs`, `strict`). |
| `rateLimit` | `ModelRouterRateLimit` | `undefined` | Rate limit (`maxRequests`, `windowMs`). |
| `circuit` | `ModelRouterCircuitConfig` | `undefined` | Circuit breaker (`failureThreshold`, `cooldownMs`). |
| `residency` | `string` | `undefined` | Required residency tag for model candidates. |
| `openRouterRouting` | `boolean` | `undefined` | Switch for OpenRouter routing transform on `model.request`. |

## What it changes

The router registers an `around` handler on the catalog hook `model.call`:
- Each turn resolves an eligible candidate through `createModelRouter().resolve()`.
- If the resolved candidate belongs to the run's active provider, execution calls `next({ ...request, model })`.
- If the resolved candidate is on a different provider, execution skips `next` and routes via `prism.models.client(candidate).generate(request)`.
- If a candidate errors before emitting any output event (`message_start`, `content_delta`, `tool_call_delta`), the router records the failure, updates circuit state, releases the reservation, and falls through to the next eligible candidate. An error occurring after output has begun is treated as the turn's error and does not trigger fallback.
- Budgets reserve capacity atomically at admission and commit on turn completion based on actual usage. Aborted runs release their reservations.
- Every candidate decision emits a `package.event` named `router.decision` recording the candidate, outcome, and attempt index.

## Performance and Fallback Cost

- In-process candidate resolution adds a single lookup per turn and zero extra provider round-trips when candidates succeed.
- Fallback adds exactly one provider call per failed candidate.
- Budget and circuit state defaults to process memory unless backed by a durable service.

## State Scope

- In-memory state by default (`createMemoryModelRouterStateStore()`).
- Durable multi-tenant state may be provided by registering a `model-router.state` service (`ModelRouterStateStore`). The 0.12 enterprise postgres adapter is retired.
- Budgets and rate windows are keyed by `principal.id`, or by the verified tenant and principal when `@arnilo/prism-extensions/governance` provides the `governance.identity` service.

## Failure Behavior

Fail closed at every boundary:
- If all candidates are exhausted or denied by budget, rate limit, circuit, or allow-list, routing rejects with `ModelRouterError` (`ERR_PRISM_MODEL_ROUTER_*`).
- The turn fails closed with that error and never falls back to an unrouted model.
- An empty candidate configuration fails `createAgent` validation.

## Capabilities

`models`

## Example

`examples/model-router.ts` demonstrates turn routing and failover across two mock providers: candidate 1 fails before output, candidate 2 answers, `router.decision` events record both attempts, and `turn.completed` delivers settled usage metadata.
