# LiteLLM live acceptance — 2026-11-01

Plan 214 Task 7. Strict live acceptance against the local LiteLLM free test pool container stack,
with owner-approved container run and zero cost ceiling.

## Container images and configuration

| Component | Pinned image / tag | Digest |
|---|---|---|
| LiteLLM Proxy | `ghcr.io/berriai/litellm-database:v1.106.6` | `sha256:7ef0e78fe00ad5ea7ea45666cc1d1f02cb7076aee69091543bf397de52db33ce` |
| PostgreSQL | `postgres:17.11-alpine` | `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b` |
| Jaeger (trace nesting) | `jaegertracing/all-in-one:1.60.0` | `sha256:12c48324bfefd3a0e6988849b2521f7eeae5fbe431f4a475d4ecdfd95a203f3a` |

Rendered groups and backends:
- `prism-free/smoke`: Groq (`openai/gpt-oss-20b`), Google AI Studio (`gemini-3.8-flash`), OpenRouter (`gemma-4-26b-a4b-it:free`), Cloudflare Workers AI (`@cf/openai/gpt-oss-20b`)
- `prism-free/gpt-oss-120b`: Groq (`openai/gpt-oss-120b`), Cloudflare Workers AI (`@cf/openai/gpt-oss-120b`)
- `prism-free/gpt-oss-120b@groq`: Groq (`openai/gpt-oss-120b`)
- `prism-free/gpt-oss-20b@groq`: Groq (`openai/gpt-oss-20b`)
- `prism-free/gpt-oss-120b@cloudflare`: Cloudflare Workers AI (`@cf/openai/gpt-oss-120b`)
- `prism-free/gpt-oss-20b@cloudflare`: Cloudflare Workers AI (`@cf/openai/gpt-oss-20b`)
- `prism-free/gemini-3.8-flash@gemini`: Google AI Studio (`gemini-3.8-flash`)
- `prism-free/gemma-4-26b@openrouter`: OpenRouter (`google/gemma-4-26b-a4b-it:free`)
- `prism-free/nemotron-3.5-lightning@openrouter`: OpenRouter (`nvidia/nemotron-3.5-lightning:free`)
- `prism-free/priced`: Priced test route (`input_cost_per_token: 0.000001`) for budget verification

## Strict live run

```sh
PRISM_LIVE_ENV_FILE=~/.config/prism/live.env \
PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/litellm \
bun run test:live
```

Result: **5 pass, 0 fail, 2 skipped**
- `providers/litellm live text`: pass
- `providers/litellm live tool loop`: pass
- `providers/litellm live structured output`: skipped by design (pool reports `supports_response_schema: null`, capability unclaimed)
- `providers/litellm live warm prefix cache probe`: skipped by design (exempt from cache parity cells for 0.13.0)
- `providers/litellm live abort before request`: pass
- `providers/litellm live error mapping`: pass
- `providers/litellm live agent kernel smoke`: pass

Kernel smoke (`packages/providers/litellm/src/__tests__/live-agent.test.ts`):
- Multi-turn `createAgent` session with a tool execution turn, a follow-up turn consuming tool result replay, and an image turn.
- Every `usage` event was verified to carry `usage.metadata.litellm.callId` (UUID) and `modelId`.
- Verified that no master or virtual keys leak into events, usage metadata, or error payloads.

## Budget fail-closed check

A temporary virtual key was minted with `max_budget: 0.000001` against the `prism-free/priced` route:
1. First request succeeded and consumed the budget.
2. Second request immediately failed closed: LiteLLM returned HTTP 422 with `type: budget_exceeded` and `message: Budget has been exceeded! Current cost: ... Max budget: 0.000001`.
3. `@arnilo/prism-provider-litellm` mapped this status to a permanent non-retryable error: `The LiteLLM key's budget is spent.`

## Spend logs & reconciliation

Reconciliation verification via `scripts/litellm/reconcile.mjs`:
Calls were issued with `x-litellm-call-id` correlation headers. `reconcile.mjs` pulled spend records from `/spend/logs` matching the call IDs:
```
Totals: prism 0.00000000 USD, litellm 0.00000000 USD, delta 0.00000000 USD.
Missing rows: none.
Verdict: reconciled.
```
All call IDs were matched; the total delta was within the `1e-6` USD tolerance; process exited with code 0.

## OpenTelemetry trace nesting

Verified end-to-end W3C trace context propagation:
1. Jaeger container running on the pool default network at `10.89.1.4:4318`.
2. LiteLLM proxy started with `--otel http://10.89.1.4:4318/v1/traces`.
3. Agent run executed with `observability({ propagateTraceContext: true })` injecting:
   `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-1234567890abcdef-01`.
4. Jaeger trace query confirmed:
   - Trace ID: `4bf92f3577b34da6a3ce929d0e0e4736`
   - LiteLLM root span: `Received Proxy Server Request` (spanID `6d75f79495c8a513`) has `parentSpanID: 1234567890abcdef` (`refType: CHILD_OF`).
   - Children spans correctly nested under LiteLLM root: `auth`, `proxy_pre_call`, `router`, `self`, `litellm_request`, and `raw_gen_ai_request`.

## Bench smoke & served-model guard

1. Refusal check: `assertComparableServedDeployments` was tested with a forced deployment mismatch (`{ "pin-oss20b-groq": 5 }` vs `{ "pin-oss20b-cloudflare": 5 }`). It immediately threw `MemoryBenchServedModel`: `Served deployment sets differ`.
2. Wire proxy check: Captured calls through the proxy and verified `servedDeploymentsFromRows` records exact deployment counts (`{ "pin-oss20b-groq": 2 }`) and inlines `servedCallIds`.
3. Dataset ingestion: Ran write phase on `locomo` with `fabric-x` and `prism-free/gpt-oss-120b`, completing all questions.

## Informational cache probe

Probed single-deployment pinned group `prism-free/gemini-3.8-flash@gemini` with 4 turns over an 8,192-token padding fixture (8,341 actual prefix tokens).

| Turn | Input tokens | Cache read tokens | Latency |
|---:|---:|---:|---:|
| 1 | 8,341 | 0 | 50.3 s |
| 2 | 8,351 | 6,299 | 24.8 s |
| 3 | 8,361 | 6,311 | 6.0 s |
| 4 | 8,371 | 6,323 | 4.4 s |

- Status: `measured`
- Reuse ratio: **0.7566** (75.66%)
- Evidence: `docs/_evidence/cache-probe/litellm-prism-free-gemini-3.8-flash-gemini-2026-11-01.json`
- Note: Per owner decision 2026-10-31, `@arnilo/prism-provider-litellm` is exempt from cache-parity thresholds for 0.13.0; these figures are recorded as informational only.

## Budget and safety

- Request counts: 5 strict matrix scenarios + 3 kernel agent turns + 2 budget verification calls + 4 cache probe turns + memory bench smoke calls = **74 total requests**.
- Spend: **$0.00** across all free pool legs. The priced budget test consumed `< $0.000001` virtual test credits.
- `live.env` verified before running: mode `0600`, stored outside git repository.
- Secret leak scan: `bun scripts/scan-secrets.mjs` reports **0 findings**. No API key, token, or Postgres secret was leaked.
