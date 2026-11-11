# @arnilo/prism-ai/litellm

Registers a host-run [LiteLLM Proxy](https://docs.litellm.ai/docs/proxy/quick_start) as a Prism provider:
one Chat Completions route, conservative per-group model discovery, and per-call LiteLLM telemetry
(call id, deployment, cost) on `usage.metadata.litellm`.

## Install

```bash
prism add @arnilo/prism-ai/litellm
```

```jsonc
{
  "packages": ["@arnilo/prism-ai/litellm"],
  "packageConfig": {
    "@arnilo/prism-ai/litellm": { "apiKey": "env:LITELLM_API_KEY" }
  }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | ref only (`env:`/`keyring:`) | `env:LITELLM_API_KEY` | Resolved through credentials per request; never a literal key. |
| `baseUrl` | string | `http://127.0.0.1:4000` | Proxy base. `http:` is accepted **only** for a loopback host; anything else must be `https:`. |
| `models` | ModelConfig[] | discovery | Static catalog; suppresses discovery when supplied, including `[]`. |

`id` and `fetch` belong only to the `litellm(options)` factory, not manifest config.

A proxy started without `master_key` accepts anonymous requests. When `apiKey` does not resolve, the
package registers anyway and emits one `info` note
(`litellm: no key at env:LITELLM_API_KEY; requests are sent without Authorization`); no
`Authorization` header is sent. A proxy that does require a key answers 401, which maps to `auth`.

A non-loopback `http:` base URL fails closed at config time with `ERR_LITELLM_INSECURE_BASE_URL`: Prism
will not send a proxy key in clear text off the machine.

## Running a proxy

```yaml
services:
  litellm:
    image: ghcr.io/berriai/litellm-database:v1.106.6@sha256:7ef0e78fe00ad5ea7ea45666cc1d1f02cb7076aee69091543bf397de52db33ce
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    ports: ["127.0.0.1:4000:4000"] # loopback only; Prism refuses an insecure remote base URL
```

Pin the image by digest, not by tag: a floating tag re-pulls whatever was published last. Task 1 (c) of
plan 214 recorded why this matters here — LiteLLM 1.82.7 and 1.82.8 shipped a credential stealer
(`GHSA-5mg7-485q-xm76`), and a virtual key is a real credential for every backend behind the proxy.
`1.106.6` is the newest release that documents the header, spend-log and call-id behaviour this package
relies on; `GHSA-w4c7-34wj-hqm8` (fixed in 1.105.6) is the reason the pin is at or above that line.

`scripts/litellm/` (plan 214 Task 5) ships the free `prism-free/*` pool, a compose file and a
budget-capped key for local testing. Nothing in this package requires it.

## Models and discovery

`models()` reads `GET /model/info` once and groups rows by `model_name`. A group is a load-balanced set
of deployments, so every claim is the conservative one:

- `limits.contextWindow` / `limits.maxOutputTokens`: the **smallest** across the group;
- `capabilities.tools`, `.reasoning`, `.structuredOutput`: `true` only if **every** deployment says so
  (`supports_function_calling`, `supports_reasoning`, `supports_response_schema`); a `null` flag is not a
  claim;
- `capabilities.input` includes `image` only if every deployment sets `supports_vision`;
- `cost` per 1M tokens: the **largest** per-token cost in the group, so a report never understates spend;
  an unknown cost stays `undefined`, never `0`;
- `compat.deployments`: the deployment count, and `compat.litellmProviders`: the sorted distinct
  `litellm_provider` values (for diagnostics, not routing).

Groups whose only deployments are not `mode: "chat"` are skipped, and so is the catch-all `*` group: it
names no model. If the key may not read deployment details (401/403), discovery falls back to
`GET /v1/models`, which returns ids only — no capability and no cost is then claimed. A host that knows
more can pass `models` explicitly (for example to claim vision on a group the proxy leaves `null`).

## Telemetry

Every request carries a Prism-minted `x-litellm-call-id` (a fresh UUID per call; a caller-supplied value
is discarded). The proxy echoes it and adds its own headers; the provider reads them and merges a scalar
record into `usage.metadata.litellm` on both the `usage` and `done` events:

```jsonc
{
  "type": "turn.completed",
  "usage": {
    "inputTokens": 55, "outputTokens": 24,
    "metadata": {
      "litellm": {
        "callId": "5f571024-818e-4951-b083-06c85e5dd891",
        "modelId": "chat-scout",              // the deployment that answered
        "modelGroup": "prism-free/chat",      // the group the request named
        "version": "1.106.6",
        "apiBase": "https://api.cloudflare.com", // origin only: no path, no query, no credentials
        "responseCost": 0.000156
      }
    }
  }
}
```

Rules that matter for reconciliation:

- Each header value is capped at 256 bytes; a longer value is **dropped**, not truncated.
- `apiBase` is reduced to its origin. The proxy's own header carries the full upstream URL, which can
  name private infrastructure.
- An error event's message ends with `(litellm call id <uuid>)`, so a failed call is still findable in
  the proxy's spend log.
- `usage.metadata.litellm` holds scalars only: never a request body, a response body or a header dump.
- `litellmSpendLogs` reconciles these ids against `/spend/logs` (see "Spend logs"); hosts that ship
  telemetry can hash or drop fields through the observability `fieldPolicy`.

## Cost

`Usage.cost` (USD) comes from `x-litellm-response-cost` when it is present, finite and non-negative. `0` is
a real cost and is reported as `0`. When the header is absent, `cost` stays `undefined` and the kernel
prices from the catalog's `ModelConfig.cost` like it does for every other provider.

**Streams carry no total cost header.** LiteLLM builds streaming response headers when the response
commits, before the stream has a cost, and drops empty values; the `x-litellm-response-cost-*` component
headers appear as `0.0`. The streamed usage chunk may carry `usage.cost` (measured per backend: present on
some free-pool models, absent on others), so expect the catalog to price most streams. Non-streaming free
calls cost $0; anything else costs what the backend behind the proxy charges. This package adds no
surcharge and makes no request beyond the Chat call.

## Prompt caching

Policy is marker-free by default and makes **no parity claim**: per-backend cache parity is planned after
0.13.0 (owner decision, plan 214).

- The default route sends no `cache_control` blocks. The prefix (system, tools and earlier messages) is
  byte-identical across turns, which is what an implicit-cache backend needs.
- A model with `compat.cacheControl: "anthropic-blocks"` (set by the host in `models`; discovery never sets
  it) goes to a second route that marks the shared prefix with `{"type":"ephemeral"}`. That route adds no
  request but **may create backend cache resources that cost money**: a Gemini or Vertex backend turns
  `cache_control` into an explicit `cachedContents` resource with storage cost. Gemini 2.5+ implicit
  caching is free; explicit caching is not.
- `prompt_cache_key` and `prompt_cache_retention` are removed from the body. The proxy accepts both
  (measured), but only OpenAI/Vertex-style backends honour them and the rest drop them; leaving them in
  would imply a client-side lever that the pool does not have.
- Proxy-side checkpoint injection (`litellm_settings.cache_control_injection_points`, a deployment-level
  `litellm_params` key that `/model/info` clears) is the operator's way to get Anthropic-style caching
  without client markers.
- Every reported cache field is mapped: `prompt_tokens_details.cached_tokens` →
  `cacheReadTokens`, `prompt_tokens_details.cache_creation_input_tokens` → `cacheWriteTokens`, and the
  Anthropic top-level `cache_read_input_tokens` / `cache_creation_input_tokens` a Messages-family backend
  leaks into the same usage object. Absent fields stay undefined, never `0`.
- Measured probe figures on the free pool (`prism-free/gemini-3.8-flash@gemini`, 8,192 token prefix, 4 turns):
  75.66% cache reuse ratio across warm turns (`docs/_evidence/cache-probe/litellm-prism-free-gemini-3.8-flash-gemini-2026-11-01.json`).
  Recorded as informational only per owner decision 2026-10-31.

## Reasoning

Historical thinking blocks replay as `reasoning_content` on assistant messages, and a
`reasoning_effort` in the request is passed through unchanged. The pool this package was measured against
required `litellm_settings.drop_params: true`: without it, a backend that does not accept
`reasoning_effort` answers 400 instead of dropping the field. Signed Anthropic thinking blocks
(`thinking_blocks` with signatures) are **not** replayed; that mode is a post-0.13.0 candidate (plan 214
Task 1 (d)).

## Errors

| Status | Class | Hint |
| --- | --- | --- |
| 401 | `auth` | check the `LITELLM_API_KEY` ref; the proxy rejected the key or has no master key |
| 400 + `Invalid model name` | `permanent` | the group is not configured; read `/model/info` |
| 422 + `Budget` | `permanent` | the LiteLLM key's budget is spent (not retried) |
| 403 | `auth` | the key may not use the group, or the backend plan excludes the model |
| 429 | `rate_limited` | out of deployments / cooldown / key rate limit; `Retry-After` is honoured when sent |
| 413 / 400 + overflow text | `context_overflow` | plan 194 compaction applies |
| 5xx | `transient` | retry policy decides |

Notes from the measured surface (plan 214 Task 1b): a budget refusal is a **422**, not a 429, and the
spend that triggers it is cached, so one call can overshoot between flushes. Context overflow arrives as a
**413** whose backend text says `context window limit`; this package rewrites that phrase to the
provider-neutral one the shared classifier knows, so no kernel change is needed. Error bodies print key
fingerprints (a 429 even prints the hash), and those are redacted before they reach a caller. A mid-stream
failure surfaces as a provider error, never as a silent `end_turn`.

## Spend logs

`litellmSpendLogs` reads the proxy's own record for the calls Prism already made, so a host can check that
what it charged matches what the proxy logged. It is opt-in, runs after the fact, and makes **no model
calls**.

```ts
import { litellmSpendLogs } from "@arnilo/prism-ai/litellm";

const { rows, missing } = await litellmSpendLogs({
  baseUrl: "http://127.0.0.1:4000",
  apiKey: async () => process.env.LITELLM_API_KEY!, // the same virtual key the provider uses
  callIds: ["0f2a6f0e-6a1b-4a2e-9a5a-1f0b7c9d2e11"],
  waitMs: 24_000,
});
```

Each row is `{ callId, model, modelGroup, modelId?, spend, promptTokens, completionTokens,
cacheReadTokens?, startTime, endTime, status? }`. Rows are built field by field: `messages`, `response`,
`proxy_server_request`, `api_key`, `api_base` and `metadata` are **never** copied, so evidence carries no
prompt, no completion and no key hash.

- **Reads.** Up to 20 ids are read one indexed `GET /spend/logs?request_id=…` at a time — exact, no time
  window needed, and the proxy returns only that call. More ids (or none) become up to 50 pages of
  `GET /spend/logs/v2` over a date range (`since` defaults to one hour before `until`, `until` to now),
  filtered locally by id. Each body is read with a 4 MiB cap.
- **Filtering is unconditional.** Even a key that can read other tenants' rows returns only the ids you
  asked for.
- **Waits.** Spend rows are written in a batch after the call: measured first visibility was 11.8 s, so the
  default `waitMs` is 24 s (capped at 60 s) with a 3 s poll. Then the result reports what is still
  `missing` rather than pretending it is settled.
- **Keys.** A virtual key reads its own rows on the pinned proxy (measured both on `/spend/logs` and on
  `/spend/logs/v2` once the key's user is an `internal_user`), so no admin key is needed and none is
  accepted here. A key without an owner gets `401` on v2; the error says so. The key is a
  `SecretSource` (`() => Promise<string | undefined>` from `@arnilo/prism/provider-kit`), resolved per call —
  build it with `refSource()` from an `env:`/`keyring:` ref; a literal string does not type-check.
- **Cache hits.** LiteLLM stores a cache hit under `"{request_id}_cache_hit{epoch}"` to keep the primary key
  unique; `callId` prefers `litellm_call_id` and otherwise strips that suffix, so a cached call still
  reconciles.
- **Failures.** A non-2xx response becomes `ERR_LITELLM_SPEND_LOGS: <status> …` with the token redacted.
  The plain-`http:` rule is the same as for chat: loopback only.

`scripts/litellm/reconcile.mjs` compares this against a Prism cost record; see
[`scripts/litellm/README.md`](../../../scripts/litellm/README.md).

## What it changes

Registers provider `litellm`. No tools, hooks, slots, commands or session state. Uses
`POST /chat/completions` with bearer auth and the shared OpenAI Chat codec; discovery is two GETs at most.
`litellmSpendLogs` is an exported function, not a tool or hook: nothing calls it unless the host does.
Response headers are read through a package-local `fetch` wrapper (the provider-kit route API does not
expose them), and one map entry per in-flight call is deleted in `finally`.

## Live tests

```bash
LITELLM_API_KEY=... PRISM_LIVE_LITELLM_BASE_URL=http://127.0.0.1:4000 \
  bun test packages/providers/litellm/src/__tests__/live.test.ts
```

The suite skips, with a reason, when `LITELLM_API_KEY` is unset or `/health/liveliness` does not answer.
`PRISM_LIVE_LITELLM_MODEL` picks the group (default `prism-free/chat`). Offline conformance replays
recordings in `src/__tests__/wire/chat/`; see `src/__tests__/wire/README.md` for provenance.
