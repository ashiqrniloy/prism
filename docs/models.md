# Models

## What it does

A model is named by a `ModelRef`: the string `"provider/model"`, or a `ModelSpec` object. A provider is a
`ModelProvider`. The kernel parses the reference, finds the provider by id in the agent's provider registry,
and calls `generate`. The registry holds the kernel's built-in `openai-compatible` provider first, then each
package's providers in load order.

`ModelSpec` extends `ModelConfig` with the endpoint and credential a run needs. `credential` is a `SECRET_REF`
(`env:NAME` / `keyring:name`), never a value, and `baseUrl` and `credential` are never listed by
`agent.models.list()`.

## When to use it

- A host sets `AgentConfig.model` (or `session.run(input, { model })`) to choose the provider and model for a run.
- A host points the built-in provider at any OpenAI-compatible endpoint with a `ModelSpec` object — no package.
- A package registers a provider (`prism.providers.register`, or `providerPackage` from
  `@arnilo/prism/provider-kit`), or makes an out-of-band call with `PackageAPI.models.client(ref?)`.

## Inputs / request

```ts
export type ModelRef = string | ModelSpec;

export interface ModelSpec extends ModelConfig {
  readonly options?: JsonObject;   // provider-specific request options
  readonly baseUrl?: string;
  readonly credential?: string;    // env:NAME | keyring:name, never a value
}

export interface ModelProvider {
  readonly id: string;
  readonly auth?: readonly AuthMethod[];
  generate(request: ProviderRequest): AsyncIterable<ProviderEvent>;
  models?(): Promise<readonly ModelConfig[]>;
}

export type AuthMethod =
  | { readonly kind: "api-key"; readonly ref: string }
  | { readonly kind: "oauth"; readonly id: string; login(ctx: AuthContext): Promise<void> };
```

`auth` is data for a host's login UI. The kernel never calls `login`. `embeddings?()` and `decisions?()` are the optional capabilities on `ModelProvider`; see [Decisions](decisions.md) for typed decision calls. Speech, transcription, image generation, video, moderation, batch jobs, and realtime sessions are not kernel contracts; providers or host packages implement them directly.

### `parseModelRef(ref: ModelRef): ModelSpec`

A string splits on the **first** `/`, so a model id may contain slashes:
`parseModelRef("openrouter/anthropic/claude-sonnet-4-5")` is
`{ provider: "openrouter", model: "anthropic/claude-sonnet-4-5" }`. An object is returned as it is, with its
limits and capabilities. It throws `ModelRefError` (`code: "model_ref_invalid"`, a `TypeError`) for:

- an empty or non-string `provider` or `model`, or a string with no `/`
- an empty `baseUrl`
- a `credential` that is not an `env:NAME` / `keyring:name` ref. The message never includes the value.

### Where a ref is parsed

- `createAgent({ model })` parses once. `agent.config.model` is the `ModelSpec`.
- `session.run(input, { model })` parses once per run, before any provider call.
- `agent.models.resolve(ref)` and `PackageAPI.models.client(ref?)` parse their argument.

## Outputs / response / events

A provider's `generate` yields `ProviderEvent` values: `content_delta` (text/thinking), `tool_call_delta`,
`tool_call`, `usage`, `error`, and `done` (with the optional `usage` and the closed `stopReason` taxonomy).
A run maps those into the session's `AgentEvent` stream.

`agent.models.list()` returns public fields only: `parameters`, `compat`, `metadata`, `options`, `baseUrl`,
and `credential` are dropped. `agent.models.resolve(ref)` returns the resolved `ModelSpec` and provider.

A missing `baseUrl` fails the run as `model_ref_invalid`. A `credential` the slot cannot resolve fails it as
`credential_unavailable`, with a message that names the ref and never a value. A provider id no package
registered fails as `Unknown provider`.

## Request/response example

```json
{
  "model": { "provider": "openai-compatible", "model": "llama-3.3-70b", "baseUrl": "http://localhost:8080/v1", "credential": "env:LOCAL_KEY" }
}
```

```jsonc
// POST <baseUrl>/chat/completions, Authorization: Bearer <resolved value>
// the SSE body the built-in provider reads
data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"content":" world"}}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":6,"total_tokens":11}}
data: [DONE]
```

## Implementation example

`examples/openai-compatible.ts` starts a loopback `Bun.serve` endpoint that requires a bearer token and runs one
streamed turn plus a second `RunResult` on the built-in provider:

```ts
const agent = await createAgent({
  model: { provider: "openai-compatible", model: "demo", baseUrl: `${server.url}v1`, credential: "env:EXAMPLE_LOCAL_KEY" },
});
const session = await agent.session();
for await (const event of session.stream("Say hello")) {
  if (event.type === "message.delta" && event.content.type === "text") streamed += event.content.text;
}
```

A package making an out-of-band call uses `PackageAPI.models.client`, as in `examples/side-call.ts`:

```ts
const client = prism.models.client("side/side"); // provider "side", model "side"
for await (const event of client.generate({ messages: [{ role: "user", content: [{ type: "text", text: question }] }] })) {
  if (event.type === "content_delta" && event.content.type === "text") text += event.content.text;
}
```

A string ref names only a provider and a model. `client.resolve()` fills in the rest from the provider's own
description of that model (`ModelProvider.models()`, read once per provider per agent): `limits`, `capabilities`
and `compat`, with every field the ref sets winning. `client.generate` sends the resolved model, so provider-side
mappings that read `request.model.compat` (a thinking level, for example) work for side calls too. Without a
matching entry, or when the catalog fails, the ref is used as given; resolution never fails a call. A worker that
maps a thinking level itself does it against `await client.resolve?.()`, as the memory workers do.

## Extension and configuration notes

One per-agent registry serves every path. It holds the kernel's built-in `openai-compatible` provider first,
then each package's providers in load order. A run, `PackageAPI.models.client`, and `agent.models.resolve`
all pick a provider by `ModelSpec.provider` through the same function, so a run with
`{ model: "other/model" }` uses `other`. `AgentConfig.provider`, `AgentConfig.providerSource`, and
`RunOptions.providerSource` are removed: `createAgent` throws a `TypeError` naming `packages` for the first
two, and a package is the only way to give an agent a provider (`providers.register`, or `providerPackage`
from `@arnilo/prism/provider-kit` for a host-owned `ModelProvider`). A duplicate id, including a package that
registers `openai-compatible`, fails `createAgent` closed as `provider_conflict`.

```ts
import { createAgent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";

await createAgent({ model: "acme/fast", packages: [providerPackage("acme-models", [acmeProvider])] });
await createAgent({ model: "mock/demo", packages: [mockProvider([[providerTextDelta("hi"), providerDone()]])] });
```

### The built-in provider

`openai-compatible` speaks Chat Completions to any endpoint. It reads `baseUrl` and `credential` from the
request's `ModelSpec` and resolves the credential through the `credentials` slot on **every request**, never at
construction. A resolved value joins the agent's redaction set before the request is sent, so an error that
echoes the `Authorization` header is redacted. A spec with no `credential` sends no auth header.

### Retry

Retry is on by default. `AgentConfig.retry` governs run turns and `models.client` alike (one loop, `retryLoop`
in `src/models/retry.ts`); `RunOptions.retry` overrides it per run, field by field.

| Setting | Behavior |
| --- | --- |
| `retry` omitted | The default policy: 4 attempts, 500 ms base delay doubling per attempt, 30 s cap, ±25% jitter. |
| `retry: false` (agent or run) | No retry. A run's `retry: { … }` turns it back on for that run. |
| `retry: { maxAttempts, baseDelayMs, maxDelayMs, maxRetryAfterMs }` | The default policy with these fields; omitted fields keep their defaults. |
| `retry: { policy }` | Your `RetryPolicy` decides every retry. |
| `retry: { afterOutput: false }` | A run turn whose stream fails after output began is final, as in 0.14.0. Default `true`. |

A provider's backpressure hint (`retry-after-ms`, or `Retry-After` in seconds or as an HTTP date) is the delay,
exactly, with no jitter and not capped by `maxDelayMs`, when it is at most `maxRetryAfterMs` (default 60,000 ms;
no setting goes above 600,000 ms). A longer hint does not sleep: the turn fails at once with the original error,
its `failureClass` (usually `rate_limited`) and `retryAfterMs`, so the host can decide when to try again. A retry
wait ends at once when the run is aborted or passes its wall limit.

**After output began.** A run turn whose stream fails with a transient failure (by the rule below, which
includes the [timeouts](#timeouts)) after its first event is retried too, under the same policy and attempt
budget. The failed attempt ends with `turn.completed { error }`, appends nothing to the branch and dispatches
none of its tool calls; the next attempt opens with `turn.started { attempt, retry }`, and its output is the
turn's. A consumer drops the deltas of an attempt that ended with `error` ([Events](events.md)). A failure that
is not transient stays final. `afterOutput: false` turns this off.

A `models.client` call is retried only before its first event reaches the caller; after that a failure is a
redacted `error` event (`afterOutput` does not apply). `done.stopReason` lands on the closed taxonomy on both paths.

Transience is read from the structured fields of the `ErrorInfo` the failure carries, never from its message
(`isTransientErrorInfo`):

- **Never retried:** `name: "AbortError"` (the run's own abort), and `failureClass` `quota`, `auth`, `permanent`
  or `context_overflow`.
- **Retried:** a `code` of 408, 425, 429, 500, 502, 503 or 504; a network code (`ECONNRESET`, `ECONNREFUSED`,
  `ECONNABORTED`, `ETIMEDOUT`, `EAI_AGAIN`, `ENETUNREACH`, `ENOTFOUND`, `EPIPE`, `UND_ERR_CONNECT_TIMEOUT`,
  which covers what Bun's `fetch` throws for a reset, a refused connection and a DNS failure); or `failureClass`
  `transient` or `rate_limited`.
- **Anything else is final**, including 409 and a failure that only *says* "timeout" or "unavailable".

Quota is excluded deliberately: the same attempt spends the same allowance and cannot succeed until the caller
acts. A plan usage limit (a `429` whose body names usage or quota, e.g. Sign in with ChatGPT's
`subscription_sharing_usage_limit_exceeded`) therefore stops the run and the user sees where to look, while an
ordinary `429` rate limit still backs off.

**Cost.** A successful turn costs nothing extra. A turn that keeps failing costs at most `maxAttempts - 1`
(by default three) more provider requests, each billed like the first. A stream that drops after output costs
one more request and re-bills that turn's input tokens. Usage the provider reported for a failed attempt is
recorded once; an attempt that reported none and is retried projects no estimate (the retry is metered), while
a final failure keeps its estimate. Set `retry: false`, `afterOutput: false`, or a lower `maxAttempts`, to cap
that.

### Timeouts

Every provider turn request has a connect timeout and an idle timeout, set through
`ProviderRequestOptions.timeouts` on `AgentConfig.providerOptions` or `RunOptions.providerOptions` (a run's
value overrides the agent's field by field):

| Field | Default | Fires when |
| --- | --- | --- |
| `connectMs` | 60,000 | no response headers arrive in time |
| `idleMs` | 300,000 | no bytes arrive for this long while the body is being read |

`null` disables one. A timeout aborts that request and fails it with `code: "ETIMEDOUT"`,
`failureClass: "transient"`, and a message naming the timeout and its duration (no response body), so the default
retry policy retries it like a reset connection. Any bytes keep a stream alive, SSE comments and `ping` frames
included, and the idle timer runs only while a read is pending, so a slow consumer is not a stalled provider.
The run's own abort still wins and is reported as an abort. Catalog, quota, OAuth and spend-log calls are not
turn requests and carry no timer; SystemOne decision calls keep their whole-call `timeoutMs` and also get these
timers per attempt.

```ts
createAgent({ model, providerOptions: { timeouts: { connectMs: 30_000, idleMs: 120_000 } } });
session.run("long job", { providerOptions: { timeouts: { idleMs: null } } }); // this run only: no idle limit
```

## Structured output

A session run asks for structured output with `providerOptions.structuredOutput: { name, schema, strict?, mode?, repair? }`.
The run's result carries `output` (the parsed value) when the final reply parses as JSON (one fenced code block
is tolerated) and satisfies the schema, or `outputError` (`invalid_json` | `schema_mismatch`, at most 8
`{ path, message }` entries) when it does not. `RunResult.text` and `status` do not change.

| `mode` | What the provider request carries |
| --- | --- |
| `"auto"` (default) | Native when the run's model declares `capabilities.structuredOutput` (`true` or `"json_schema"`), else prompted. Resolved once per run, before any provider call or hook. |
| `"native"` | The schema as the wire's response format (`response_format`, `text.format`, Ollama `format`). A model without the capability fails closed with `StructuredOutputError("unsupported_model")`, naming `mode: "prompted"`. |
| `"prompted"` | No native option. One system instruction block carries the schema name and its canonical JSON and asks for a single JSON object as the final answer; tool calls before it stay allowed. The block sits in the stable prefix and is byte-identical on every turn of the run, so it caches. |

The Anthropic Messages wire has no JSON-schema response format: its codec fails closed on a native
request, and Kilo declares the capability on its Chat and Responses routes only, so `auto` sends those
models the prompted block. A direct provider request (`generate()` outside a session run) supports native only.

`repair` (0–3, default 1): when the run ends naturally and the final reply is invalid, `run.end()` sends one
user message listing the violations' paths and expected shapes (never the reply's content) and the loop runs
again, at most `repair` times per run. Repair runs after the `run.end` hook declines to continue, in the
primitive, so every loop that calls `run.end()` gets it. Repairs are counted apart from
`limits.maxContinuations`; a durable resume restarts the count. A reply still invalid after the last repair
ends the run normally with `outputError`.

Cost: each repair is one extra model turn, only on an invalid reply; `repair: 0` disables it. Prompted mode
adds the schema's size in input tokens to every request (cache-stable).

## Agents with no model

`AgentConfig.model` is optional only for a loop that declares `usesModel: false` (see [loop.md](loop.md)). On such an agent `agent.config.model` is `undefined`, `agent.models.list()` lists only what providers declare, `session.contextMeter()` omits the input cap, and `models.client()` / `models.embeddings()` / `models.decisions()` with no reference throw a `TypeError` naming the missing model. A missing model never falls back to a default provider.

## Provider packages

Prism 0.13.0 ships all eleven providers through `@arnilo/prism-ai/<vendor>`, including Command Code (Chat, Responses, Messages) and Ollama Cloud (native NDJSON and OpenAI-compatible routes). Install `@arnilo/prism-ai` once, then list each provider subpath separately in your agent or manifest. Other providers can be built on `@arnilo/prism/provider-kit`. `@arnilo/prism-ai/liquid` registers two providers — hosted `liquid` (`d1.1`, `d1-ultra`) and `liquid-local` (`d1-3B` served by llama.cpp `llama-server`).
Listing one registers its provider(s); no package imports a sibling. `apiKey` (and every
other credential field) is an `env:`/`keyring:` ref resolved per request through the `credentials` slot,
OAuth methods go through `host.ui`, and `keyring:` refs resolve through `@arnilo/prism-extensions/keyring`.
A provider package that rotates tokens at request time (an OAuth refresh) persists the new record through
`credentials.store`/`delete`, which needs the `credentials:write` capability; `env:` refs are never writable.
The package README carries the config table, the named exports, and the vendor wire notes:

| Package | README |
| --- | --- |
| `@arnilo/prism-ai/commandcode` | [README](../packages/providers/commandcode/README.md) |
| `@arnilo/prism-ai/kilo` | [README](../packages/providers/kilo/README.md) |
| `@arnilo/prism-ai/litellm` | [README](../packages/providers/litellm/README.md) |
| `@arnilo/prism-ai/hyper` | [README](../packages/providers/hyper/README.md) |
| `@arnilo/prism-ai/laya` | [README](../packages/providers/laya/README.md) |
| `@arnilo/prism-ai/liquid` | [README](../packages/providers/liquid/README.md) |
| `@arnilo/prism-ai/ollama-cloud` | [README](../packages/providers/ollama-cloud/README.md) |
| `@arnilo/prism-ai/openai-codex` | [README](../packages/providers/openai-codex/README.md) |
| `@arnilo/prism-ai/opencode-go` | [README](../packages/providers/opencode-go/README.md) |
| `@arnilo/prism-ai/openrouter` | [README](../packages/providers/openrouter/README.md) |
| `@arnilo/prism-ai/typesafe` | [README](../packages/providers/typesafe/README.md) |

## Usage and token accounting

Prism enforces a single, inclusive `Usage` contract across all model providers and codecs (roadmap §2.7):

- **Inclusive `inputTokens`**: `Usage.inputTokens` counts all prompt tokens sent to the model on the turn.
- **Cache subsets**: `Usage.cacheReadTokens` (prompt tokens read from cache) and `Usage.cacheWriteTokens` (prompt tokens written to cache) are non-negative subsets of `inputTokens` (`cacheReadTokens + cacheWriteTokens <= inputTokens`).
- **Derived `totalTokens`**: `Usage.totalTokens` reflects total turn tokens. When an upstream provider omits `total_tokens` (e.g. Anthropic), codecs derive `totalTokens = inputTokens + outputTokens`.
- **Codecs normalize upfront**: Upstream protocols with exclusive token definitions (such as Anthropic Messages, where wire `input_tokens` excludes cached tokens) are normalized via `normalizeUsage` from `@arnilo/prism/provider-kit` so that `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. OpenAI Chat Completions already reports inclusive `prompt_tokens`.
- **Cache metrics**: Cache hit rate is `cacheReadTokens / inputTokens` (bounded in `[0, 1]`).
- **Cost catalog pricing**: When a host configures `CostCatalog`, pricing separates uncached input from cached input:
  `cost = (max(0, inputTokens - cacheReadTokens - cacheWriteTokens) * quote.input + cacheReadTokens * quote.cacheRead + cacheWriteTokens * quote.cacheWrite + outputTokens * quote.output) / 1_000_000`.

## Prompt caching and breakpoint defaults

Prism standardizes prompt-cache planning across supported provider codecs (`DEFAULT_CACHE_BREAKPOINTS` in `@arnilo/prism` and `resolvePromptCachePlan` in `@arnilo/prism/provider-kit`):

- **Default Breakpoints**: `DEFAULT_CACHE_BREAKPOINTS` targets `[{ location: "system_prompt" }, { location: "last_message" }]`. In multi-turn agentic loops, marking the newest message (the turn's newest input) allows subsequent turns to reuse the prefix cache with at most 1 uncached turn tail.
- **Breakpoint Locations**:
  - `system_prompt`: marks the system prompt (e.g. Anthropic system blocks).
  - `last_message`: marks the newest message in the turn (`messages.length - 1`).
  - `last_stable_message`: marks the second-to-last message (`messages.length - 2` or `messages.length - 1`), preserved for hosts and providers requiring stable turn boundaries.
  - `tools`: marks the **last tool definition** on codecs supporting definition-level caching (e.g. Anthropic Messages `tools` array), not a tool-result message. `resolveBreakpoint` returns `-1` for `tools` so message indexing is bypassed.
  - `first_user_message`: marks the initial user turn.
- **Empty Block Protection**: Codecs fail open and avoid stamping cache control markers onto empty content blocks (empty text, whitespace-only, empty tool results), looking back up to 20 blocks in the message for valid content.
- **Route Affinity**: Providers can specify `affinity?: (request: ProviderRequest) => Record<string, string>` on routes or codec options to attach routing headers (e.g., sanitized prompt-cache affinity keys) ensuring cached sessions land on the same upstream backend node.

## Security and performance notes

- `ModelSpec.credential` is a ref only. A literal secret fails `parseModelRef` and package config validation
  (`secret_literal`), and the error never echoes the value.
- The built-in provider resolves the credential per request through the `credentials` slot, so a key rotated
  between runs is picked up with no cache. There is no kernel credential cache.
- A resolved value is added to the agent's secret set and redacted from events, notes, logs, errors, and
  `agent.inspect()`. The built-in provider passes the value to its transport's secret list too.
- `agent.models.list()` drops `baseUrl`, `credential`, `options`, `parameters`, `compat`, and `metadata`.

## Related APIs

- `@arnilo/prism/provider-kit`: the wire code a provider package (and the built-in provider) uses.
- `@arnilo/prism/testing`: `mockProvider` and the provider event helpers for tests and examples.
- `docs/packages.md`: `PackageAPI.providers`, `PackageAPI.models`, and the `models` capability.
- `docs/slots.md`: the `credentials` slot the built-in provider resolves refs through.
