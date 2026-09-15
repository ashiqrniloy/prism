# Model routing

## What it does

`@arnilo/prism-core/governance/model-router` is an optional governance facade over an existing `ProviderResolver`. It enforces allow-lists, residency, token/cost budgets, rate limits, circuit breaking, and bounded fallbacks before provider selection, and emits redacted selection diagnostics. It does not implement a second provider runtime.

## When to use it

Use it for enterprise hosts that must deny models/regions before any provider call and attribute selection for audit. Skip it when a plain `createProviderResolver` allow-list is enough.

Do not put secrets, prompts, or raw OpenRouter keys into diagnostics. Do not honor `compat.openRouterRouting` unless `allowOpenRouterRouting: true`.

## Inputs / request

| API / field | Meaning |
| --- | --- |
| `createModelRouter({ resolver, stateStore?, ... })` | Wraps host `ProviderResolver`; omit `stateStore` for in-process memory state or pass durable async state. |
| `allowList.providers` / `allowList.models` | Exact provider id / model id or `provider/model` |
| `allowedResidencies` | Request residency must match when configured |
| `budgets` / per-call `maxTokens` / `maxCostUsd` | Finite non-negative ceilings; requests with a per-call cap reserve it atomically at admission; `recordUsage` commits actuals against the reservation |
| `budgets.reservationTtlMs` | How long an admission reservation pins capacity (default 60s); a run that outlives it reconciles as unknown usage |
| `budgets.strict` | When `true`, enables strict hard-budget mode: calls lacking enforceable bounds or candidates lacking cost pricing are denied fail-closed with `ERR_PRISM_MODEL_ROUTER_BUDGET` |
| `rateLimit` | Per identity+model key window |
| `circuit` | Failure threshold + cooldown; keys capped |
| `fallbacks` | Ordered candidates after primary; total attempts capped |
| `allowOpenRouterRouting` | Default `false`; when false, routing metadata is stripped |
| `onDiagnostics` | Optional redacted hook (e.g. policy ledger evidence ref) |
| `router.resolve({ model, identity?, residency?, maxTokens?, taskId?, kind?, attemptId?, ... })` | Rich async selection; accepts optional `taskId` and `kind` (`"generation" \| "embedding" \| "compaction" \| "tool"`); returns `budgetReservation` when a per-request cap was reserved |
| `router.releaseBudget({ identity, provider, model, budgetReservation, taskId?, kind? })` | Explicitly releases a held budget reservation back to the pool |
| `router.renewBudget({ identity, provider, model, budgetReservation, extendTtlMs?, taskId?, kind? })` | Renews an active reservation hold before expiry, returning an updated reservation with an advanced fencing token |
| `router.readBudget({ identity, provider?, model?, taskId? })` | Reads budget utilization; when `taskId` is provided, returns granular `byModel`, `byKind`, and `attributions` breakdowns |
| `createGovernedProvider(options)` / `router.createGovernedProvider(options)` | Wraps an `AIProvider` in an opt-in adapter that automates the full admission, atomic reservation, request-policy application, streaming, and explicit settlement lifecycle (supports `taskId`, `kind`, and `renewBudget()`) |
| `isGovernedProvider(provider)` | Type guard and runtime predicate indicating that a provider has opt-in governance lifecycle wrapping |
| `router.providerSource` | Sync facade for allow-list and residency-only routers without async state, budgets, rate limits, circuits, fallbacks, or selection policies. Throws `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE` or `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` when unenforced governance options are configured; use `router.resolve()` instead. |

Frozen caps (default / hard): attempts `3 / 8`, circuit keys `1,024 / 16,384`, diagnostics `8 KiB / 64 KiB`, rate keys `4,096 / 65,536`, budget keys `4,096 / 65,536`.

## Outputs / response / events

- `ModelRouterResolveResult` — selected `provider` + possibly stripped `model`, `diagnostics`, and `providerRequestPolicy`; `budgetReservation` carries the admission reservation handle when the request had a per-call budget cap.
- Deny throws `ModelRouterError` with code + redacted `diagnostics` (allow-list/residency/budget fail closed without calling resolver); budget denies carry `details.retryAfterMs`.
- `await recordOutcome({ identity, success, circuitProbeToken? })` opens/closes circuits; `await recordUsage({ identity, budgetReservation?, taskId?, kind?, attemptId?, ... })` commits the reservation against actual usage (pass the handle returned by `resolve`) or advances budgets directly. Pass the probe token returned by `resolve` for a half-open outcome.
- `await renewBudget({ identity, provider, model, budgetReservation, extendTtlMs?, taskId?, kind? })` extends hold TTL and advances fencing tokens for long-running workflows. Expired holds fail closed with `ERR_PRISM_MODEL_ROUTER_STATE`.
- `await readBudget({ identity, taskId? })` returns `{ tokens, costUsd, byModel?, byKind?, attributions? }`. When queried with `taskId`, attributions decompose usage across models and paid work categories (`generation`, `embedding`, `compaction`, `tool`).
- A reservation whose TTL elapses before `recordUsage` charges the **reserved** amount and emits one redacted `unknown_usage` diagnostic (deterministic reconciliation, never a silent drop).

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
import { createModelRouter } from "@arnilo/prism-core/governance/model-router";
import { createPostgresEnterpriseState } from "@arnilo/prism-core/enterprise/postgres";

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

// `router.providerSource` is unavailable with durable state or unenforced governance (budgets, rate limits, circuit breaker, fallbacks, selection); resolve before provider I/O.
```

## Extension and configuration notes

Router is optional. Chain returned `providerRequestPolicy` with other `ProviderRequestPolicy` values. Wire `onDiagnostics` to `@arnilo/prism-core/governance/policy` when audit export is required. OpenRouter package behavior is unchanged; routing metadata participates only when this gate allows it.

### Selection policies (0.1.7)

By default the router tries candidates in input order: the primary model, then
`fallbacks` in order. A host can instead supply a `selection` policy on
`createModelRouter` to rank the candidates before the governance checks run:

```ts
import { createCostLatencySelection, createModelRouter } from "@arnilo/prism-core/governance/model-router";

const router = createModelRouter({
  resolver,
  selection: createCostLatencySelection({ latencyWeight: 0.5 }),
  fallbacks: [cheaperModel],
});

// host-measured provider-call latency feeds the policy's EMA:
await router.recordOutcome({ identity, provider, model, success: true, latencyMs: 412 });
```

`ModelRouterSelectionPolicy` is `{ name, rank(candidates, request), observe? }`:

- `rank` must return a **permutation** of the input candidates. Any other
  result (added, dropped, or duplicated candidates) fails closed with
  `ERR_PRISM_MODEL_ROUTER_POLICY` — a policy can never widen the allow-list,
  residency, or budget decisions, because those checks still run per candidate
  after ranking.
- `observe` receives outcome feedback from `router.recordOutcome`, including
  the host-supplied `latencyMs` (validated finite non-negative).
- The policy name is recorded in selection diagnostics (the redaction cap
  still applies). Absent `selection`, behavior is identical to 0.1.6.

`createCostLatencySelection()` is the reference policy:

- Ranks by unit price first: `ModelCost.input` + `output` + `cacheRead`,
  normalized by the cost unit (`per_million_tokens` vs per-token). Models
  without valid cost metadata rank after all priced models, preserving their
  relative input order.
- Breaks cost ties by recent measured latency — an in-memory per-
  provider/model EMA fed from `recordOutcome` `latencyMs`. Cold start (no
  samples) is pure cost order.
- `latencyWeight` (default 0.5) is the EMA smoothing factor: 0 keeps the
  first sample, 1 tracks only the latest. `ponytail:` the EMA is in-memory and
  process-local; durable latency statistics would require a
  `ModelRouterStateStore` contract change and are demand-gated.

### Governed provider adapter (`createGovernedProvider`)

Hosts that want complete, automated governance enforcement across every provider call can wrap their `ModelRouter` in an opt-in `GovernedProvider` adapter instead of manually coordinating `resolve`, `recordUsage`, and `recordOutcome`:

```ts
import { createModelRouter, isGovernedProvider } from "@arnilo/prism-core/governance/model-router";

const router = createModelRouter({
  resolver,
  allowList: { providers: ["anthropic", "openai"] },
  budgets: { maxTokens: 10_000 },
  fallbacks: [{ provider: "openai", model: "gpt-4o" }],
});

const governed = router.createGovernedProvider({
  identity,
  model: { provider: "anthropic", model: "claude-3-5-sonnet" },
  maxTokens: 500,
  onSettlement: (settlement) => {
    console.log(settlement.outcome, settlement.durationMs, settlement.usage);
  },
});

assert.ok(isGovernedProvider(governed));
for await (const event of governed.generate({ model, messages })) {
  // stream events incrementally; bounded chunks, no full-stream buffering
}
```

The adapter executes an explicit six-stage lifecycle for every call:

1. **Admission & Selection**: Runs `router.resolve(...)` across configured candidates. If the primary model fails admission (e.g. not allow-listed, residency mismatch, budget exhausted, or circuit open) and safe fallbacks are configured, the router or adapter evaluates the next candidate.
2. **Atomic Budget Reservation**: When `maxTokens` or `maxCostUsd` is specified, capacity is reserved atomically prior to invoking the provider.
3. **Request Policy Application**: Applies model and provider request policies (e.g., stripping unauthorized OpenRouter metadata) before calling the provider.
4. **Bounded Streaming**: Consumes provider events incrementally without full-response buffering.
5. **Safe Fallback vs Forbidden Replay**:
   - **Safe Fallback**: If an error occurs *before* any output or tool call is emitted, the adapter catches the failure, records outcome feedback, releases any reservation, and seamlessly falls back to the next configured candidate.
   - **Forbidden Fallback**: If a failure happens *after* text deltas or tool calls have already been delivered to the consumer, failover is strictly forbidden to prevent replay of side effects or inconsistent state.
6. **Explicit Settlement**: Idempotently settles the call exactly once across all outcomes:
   - `success`: Commits actual tokens and cost; releases unspent reservations; records positive outcome.
   - `abort` / `error` / `early_close` before output: Releases the reservation cleanly; records outcome.
   - `abort` / `early_close` after output: Commits the held reservation as `unknownUsage: true` (missing actual usage is charged as reserved liability, never assumed to be zero).
   - Upstream EOF without usage: Commits the reservation as `unknownUsage: true`.
   - Usage recording errors: Propagate out on success so persistence failures are not concealed.
   - Invokes `onSettlement` callback with `GovernedInvocationSettlement` telemetry.

### Synchronous facade (`providerSource`) governance matrix

The synchronous `router.providerSource(model)` facade is strictly intended for simple synchronous resolution where allow-lists and residency checks are sufficient. Any configuration requiring asynchronous state or multi-candidate evaluations fails closed at call time:

| Feature / Configuration | Supported in `resolve()` | Supported in `providerSource(model)` | Refusal Code |
| --- | --- | --- | --- |
| Allow-list (`allowList`) | Yes | Yes | `ERR_PRISM_MODEL_ROUTER_ALLOW_LIST` |
| Allowed residencies (`allowedResidencies`) | Yes | Yes (from `model.compat.residency`) | `ERR_PRISM_MODEL_ROUTER_RESIDENCY` |
| Token / cost budgets (`budgets`) | Yes | Refused | `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` |
| Rate limits (`rateLimit`) | Yes | Refused | `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` |
| Circuit breaker (`circuit`) | Yes | Refused | `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` |
| Fallbacks (`fallbacks`) | Yes | Refused | `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` |
| Selection policy (`selection`) | Yes | Refused | `ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED` |
| Durable state (`stateStore`) | Yes | Refused | `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE` |

All refusals and denials occur before any resolver invocation. In untyped JavaScript contexts, malformed model arguments fail closed with `ERR_PRISM_MODEL_ROUTER_VALIDATION`.

## Security and performance notes

- Allow-list and residency denies never call the underlying resolver.
- Zero-budget facade probes or unmetered executions are strictly prevented: `providerSource` never executes wrapped resolver logic when any budget, rate limit, circuit, fallback, selection, or durable state is configured.
- Budget admission is **reservation-based** when the request carries a per-request cap: `resolve` atomically reserves the full cap against remaining capacity (`max − used − reserved`) and returns a `budgetReservation` handle; parallel admissions can never collectively exceed the reserved budget. Commit the handle in `recordUsage` with the actual tokens/cost (a negative remainder is released back); release happens automatically on internal denial (rate limit, circuit open, provider miss), on TTL expiry, or on an explicit late commit (which charges the reserved amount as unknown usage). Requests without a per-request cap keep read-then-compare admission (`used >= cap` denies) and are outside the reservation guarantee.
- Without `stateStore`, budget/rate/circuit state is process-local, memory-capped (rate/budget/circuit keys), and LRU-evicts on insert; a held reservation's budget row is never evicted. It is not a cross-replica production path.
- With `stateStore: createPostgresEnterpriseState(...).modelRouter`, rate/budget updates, reservations, and circuit probes are atomic across replicas, use database time, and are owner/principal/provider/model scoped. Router calls become asynchronous and require verified identity.
- Diagnostics carry identity refs and attempt outcomes only — no prompts/secrets, tokens, or reservation material. Durable state stores at most bounded numeric/timestamp/token material, never prompts or credentials.
- Selection is O(attempts × state operations); no provider network I/O happens inside state updates. Reservation is one atomic UPSERT (denial adds one retry-after query); commit/release are O(1) row updates. Recorded 0.0.23 PostgreSQL p95 point operations stayed under 50 ms and cursor/cleanup pages under 100 ms on the documented fixture.
- **Aggregate task/tenant accounting**: When `taskId` is supplied, admission reservations and usage records are aggregated at the task level rather than per provider/model alone. Parallel requests (tested up to 32 concurrent attempts across models and child workers) share the atomic budget ceiling without oversubscription. Model switches, tool calls, and background jobs attribute separately to `byModel` and `byKind` while sharing a single liability pool.
- **Strict hard-budget mode**: Setting `budgets.strict = true` prevents unmetered or unbounded model execution: requests lacking output/token bounds or models lacking cost pricing are rejected fail-closed with `ERR_PRISM_MODEL_ROUTER_BUDGET`.
- **Hold renewal fencing**: `router.renewBudget()` and `governedProvider.renewBudget()` advance the reservation's fencing token upon extending TTL; previous fencing tokens are immediately invalidated to prevent stale or split-brain commits. Expired holds cannot be renewed and fail closed with `ERR_PRISM_MODEL_ROUTER_STATE`.
- Raising hard caps requires a reviewed release update with tests and docs.

## Related APIs

- [Provider layer](provider-layer.md)
- [Provider request policies](provider-request-policies.md)
- [OpenRouter](providers/openrouter.md)
- [Policy and audit](policy-and-audit.md)
- [Agent identity](agent-identity.md)
- [Enterprise PostgreSQL state](enterprise-postgres-state.md): durable router state, migration, cleanup, and ownership requirements.
- Package README: [`@arnilo/prism-core`](../packages/prism-core/README.md)
