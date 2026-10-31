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

`AgentConfig.retry` governs run turns and `models.client` alike (one loop, `retryLoop` in `src/models/retry.ts`).
A `models.client` call is retried only before its first event reaches the caller; after that a failure is a
redacted `error` event. `done.stopReason` lands on the closed taxonomy on both paths.

Transience is the `ErrorInfo` the provider failure carries: a numeric status in the transient set, a transient
network code, or a message naming congestion. One exception is deliberate — a failure classified
`failureClass: "quota"` is never retried (`isTransientErrorInfo`), because the same attempt spends the same
allowance and cannot succeed until the caller acts. A plan usage limit (a `429` whose body names usage or quota,
e.g. Sign in with ChatGPT's `subscription_sharing_usage_limit_exceeded`) therefore stops the run and the user sees
where to look, while an ordinary `429` rate limit still backs off.

## Agents with no model

`AgentConfig.model` is optional only for a loop that declares `usesModel: false` (see [loop.md](loop.md)). On such an agent `agent.config.model` is `undefined`, `agent.models.list()` lists only what providers declare, `session.contextMeter()` omits the input cap, and `models.client()` / `models.embeddings()` / `models.decisions()` with no reference throw a `TypeError` naming the missing model. A missing model never falls back to a default provider.

## Provider packages

Prism 0.13.0 ships 9 provider packages: `@arnilo/prism-provider-{hyper, kilo, laya, litellm, liquid, openai-codex, opencode-go, openrouter, typesafe}`. `@arnilo/prism-provider-commandcode` (Chat, Responses, Messages) is built and live-tested in the same tree and ships in the first release after 0.13.0. Other providers can be built on `@arnilo/prism/provider-kit`. `@arnilo/prism-provider-liquid` registers two providers — hosted `liquid` (`d1.1`, `d1-ultra`) and `liquid-local` (`d1-3B` served by llama.cpp `llama-server`).
Listing one registers its provider(s); no package imports a sibling. `apiKey` (and every
other credential field) is an `env:`/`keyring:` ref resolved per request through the `credentials` slot,
OAuth methods go through `host.ui`, and `keyring:` refs resolve through `@arnilo/prism-credentials-keyring`.
A provider package that rotates tokens at request time (an OAuth refresh) persists the new record through
`credentials.store`/`delete`, which needs the `credentials:write` capability; `env:` refs are never writable.
The package README carries the config table, the named exports, and the vendor wire notes:

| Package | README |
| --- | --- |
| `@arnilo/prism-provider-commandcode` | [README](../packages/providers/commandcode/README.md) |
| `@arnilo/prism-provider-kilo` | [README](../packages/providers/kilo/README.md) |
| `@arnilo/prism-provider-litellm` | [README](../packages/providers/litellm/README.md) |
| `@arnilo/prism-provider-hyper` | [README](../packages/providers/hyper/README.md) |
| `@arnilo/prism-provider-laya` | [README](../packages/providers/laya/README.md) |
| `@arnilo/prism-provider-openai-codex` | [README](../packages/providers/openai-codex/README.md) |
| `@arnilo/prism-provider-opencode-go` | [README](../packages/providers/opencode-go/README.md) |
| `@arnilo/prism-provider-openrouter` | [README](../packages/providers/openrouter/README.md) |
| `@arnilo/prism-provider-typesafe` | [README](../packages/providers/typesafe/README.md) |

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
