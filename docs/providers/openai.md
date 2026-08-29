# OpenAI provider package

## What it does

`@arnilo/prism-provider-openai` provides explicit, side-effect-free setup for the OpenAI
Responses API (`createOpenAIResponsesProvider`) and OpenAI Codex
subscription Responses (`createOpenAICodexProvider`), plus a Codex OAuth provider
implementing RFC 7636 PKCE browser/device-code login.

The package registers providers, model metadata, and `api_key` / `oauth` auth
methods through `createExtensionKernel().load([...])` — no
hidden globals, no automatic provider/model resolution.

## When to use it

Use it when a host app wants OpenAI Responses or Codex-backed runs through
Prism's `AgentSession` runtime, or needs a Codex OAuth login flow (ChatGPT
Plus/Pro/Codex subscription).

Do not use it for Chat Completions-only endpoints (use
[`@arnilo/prism/providers/openai-compatible`](openai-compatible.md) instead), automatic
credential discovery, or real-network tests.

## Inputs / request

```ts
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

createOpenAIProviderPackage(options: OpenAIProviderPackageOptions): ProviderPackage
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver source for the Responses API key. |
| `codexAccessToken` | `CredentialValueSource` | Access token for the Codex subscription backend. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides `https://api.openai.com/v1`. |
| `codexBaseUrl` | `string` | Overrides `https://chatgpt.com/backend-api/codex`. |
| `models` | `readonly ModelConfig[]` | Optional override for registered OpenAI Responses models (defaults to featured `openAIModels`). |
| `codexModels` | `readonly ModelConfig[]` | Optional override for registered Codex models (defaults to featured `openAICodexModels`). |

`ProviderRequest.options.sessionId`, `cacheKey`, `cacheRetention`, `headers`,
`compat`, and `extra` map to request headers/payload fields. Per-turn reasoning
uses official Responses `reasoning: { effort, summary? }` via
`ModelConfig.compat.reasoning` defaults merged with
`ProviderRequestOptions.compat.reasoning` (request wins). Prefer
`applyThinkingLevel(..., "openai_reasoning")` from `@arnilo/prism`.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (downgraded to text), host `tool_call` deltas/finals, provider-hosted `tool_call` events (`authority: "provider-hosted"`), `continuation_required`, `usage`, `done`, and redacted `error` events. |
| Continuation | An incomplete Responses stream self-resumes at most eight HTTP hops using opaque `previous_response_id`; a cursor is at most 4 KiB, is never replayed, and is observable as `continuation_required`. |
| Realtime | `createOpenAIRealtimeSession()` exposes server-session creation, audio in/out, transcript deltas, provider-hosted calls, interrupt, and idempotent close through the neutral `RealtimeSession` seam. |
| Block preservation | User/system text → `input_text`; assistant text → `output_text`; assistant host `tool_call` → top-level `function_call` with `call_id`; provider-hosted calls are not replayed; `tool_result` → top-level `function_call_output`; images/files/audio when declared on the model. Bare thinking without an encrypted Responses reasoning item is omitted on replay. |
| Auth methods | `api_key` for `openai`; host-invoked subscription `oauth` for `openai-codex`. xAI SuperGrok is the other first-party subscription OAuth flow ([xAI](xai.md)). |

Unsupported block placements or unclaimed images fail before `fetch`. Provider-hosted calls are telemetry only: Prism never dispatches them as host tools or sends a `tool_result`.

## Request/response example

Responses request body (Codex subscription shape, abbreviated):

```json
{
  "model": "gpt-5.1",
  "input": [
    { "role": "user", "content": [{ "type": "input_text", "text": "Hello" }] },
    { "role": "assistant", "content": [{ "type": "output_text", "text": "Calling lookup" }] },
    { "type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{\"q\":\"x\"}" },
    { "type": "function_call_output", "call_id": "call_1", "output": "{\"ok\":true}" }
  ],
  "reasoning": { "effort": "high" },
  "prompt_cache_key": "session-1",
  "stream": true,
  "store": false
}
```

Realtime session (OpenAI session creation, abbreviated):

```ts
import { createOpenAIRealtimeSession } from "@arnilo/prism-provider-openai";

const session = createOpenAIRealtimeSession({
  model: { provider: "openai", model: "gpt-realtime-2.1" },
  ownerId: "hashed-host-user-id",
  apiKey,
});
for await (const event of session.events()) {
  if (event.type === "audio_delta") play(event.audio);
}
```

OAuth authorize URL (PKCE, `S256`):

```
https://auth.openai.com/authorize?response_type=code&client_id=...&code_challenge=<base64url(SHA-256(verifier))>&code_challenge_method=S256&redirect_uri=<redirect>&scope=<scope>
```

## Implementation example

```ts
import { createExtensionKernel, createEnvCredentialResolver } from "@arnilo/prism";
import { createOpenAIProviderPackage, listOpenAIModels } from "@arnilo/prism-provider-openai";

const apiKey = createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" });
const models = await listOpenAIModels({ apiKey }); // caller-gated; never runs during setup
const kernel = createExtensionKernel();
await kernel.load([
  createOpenAIProviderPackage({ apiKey, models }),
]);
```

OAuth login (caller-supplied callbacks, mocked in tests):

```ts
import { createOpenAICodexOAuthProvider, createPkceVerifier, computeS256Challenge } from "@arnilo/prism-provider-openai";

const oauth = createOpenAICodexOAuthProvider({
  redirectUri: "http://localhost:1455/auth/callback",
  scope: "openai.chatgpt",
  // callbacks supplied/brand-owned
});
const verifier = createPkceVerifier();
const challenge = computeS256Challenge(verifier);
```

## Extension and configuration notes

- `createOpenAIProviderPackage` wires the API-key Responses backend and the Codex
  OAuth backend separately via `baseUrl` and `codexBaseUrl`; a Codex OAuth access
  token never silently hits the plain `/v1` endpoint.
- `OpenAICodexOAuthOptions.redirectUri` and `scope` are forwarded to the authorize
  URL; `scope` is also sent on the device-code POST body when supplied.
- Hosts/apps control model selection, credential resolution, and cache policy per
  run/model through `RunOptions` and `ModelConfig.compat`.
- OAuth browser/device-code flows run only when the caller explicitly invokes the
  OAuth provider. Login UI and optional durable token storage remain host-owned; no ambient credential discovery or refresh timer is installed.
- Device-code login polls the token endpoint with server-directed `interval` and
  `expires_in`, honors RFC 8628 `authorization_pending` / `slow_down`, and stops
  on terminal errors or expiry. Pass `signal` on `OAuthLoginCallbacks` to abort
  polling promptly.
- `createOpenAIRealtimeSession` requires a stable host `ownerId`; it sends that value as OpenAI's safety identifier and binds the stream to the server `session.created` id. An injected `webSocket(url, { headers })` factory supports Node 22 hosts whose global WebSocket does not expose header options.

### Cache behavior

Official: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

- `prompt_cache_key` is derived from `ProviderRequestOptions.cacheKey` (falling
  back to `sessionId`) and sanitized + clamped to 64 characters via the shared
  `sanitizeCacheKey()` helper. Cache keys are session/customer identifiers only;
  never credentials or raw prompts.
- `prompt_cache_retention` accepts only `"24h"` on pre-GPT-5.6 Responses models
  (extended caching). Prism `cacheRetention: "short"` and `"none"` omit the field
  so default automatic/implicit caching applies and no invalid literal is sent.
  `cacheRetention: "long"` maps to `prompt_cache_retention: "24h"` only when the
  model declares `ModelConfig.cache.longRetention === true`; models without that
  metadata omit the field. Featured `gpt-5.1` declares
  `cache: { kind: "openai_key", longRetention: true, maxKeyLength: 64 }`.
- GPT-5.6+ models use current `prompt_cache_options` instead of retention:
  `listOpenAIModels` / `mapOpenAIModel` set `cache.explicitBreakpoints: true` and
  `longRetention: false` for those ids, so Prism never emits
  `prompt_cache_retention` for them. When the host supplies
  `cache.breakpoints` (or forces `cache.mode: "on"`), Prism emits
  `prompt_cache_options: { mode: "explicit" }` and stamps
  `prompt_cache_breakpoint: { mode: "explicit" }` on the last text block of each
  selected message anchor (shared breakpoint selection with
  `applyCacheControl`, capped at the official 4 cache writes per request;
  `tools` breakpoints are skipped — tool definitions are not markable blocks).
  The only supported TTL is `"30m"` (also the default), so no ttl field is ever
  emitted. `cache.mode: "off"` suppresses explicit options and markers.
- Resolved cache fields win over caller `extra`: `prompt_cache_key`,
  `prompt_cache_retention`, and `prompt_cache_options` are re-applied after the
  `extra` spread, so invalid caller values cannot replace the resolved policy.
- Cache accounting is preserved in normalized `Usage`: OpenAI
  `input_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens` and
  `input_tokens_details.cache_write_tokens` maps to `Usage.cacheWriteTokens`
  (GPT-5.6+ report cache writes; older models omit the field, leaving
  `Usage.cacheWriteTokens` undefined).
- Provider-owned headers (`content-type`, `authorization`, `x-client-request-id`)
  are applied after caller `ProviderRequestOptions.headers` so caller config
  cannot replace credentials, content type, or the session request id; non-owned
  caller headers are kept.

### Model discovery

- `listOpenAIModels({ apiKey, fetch, baseUrl, signal, headers })` calls official
  [`GET /models`](https://developers.openai.com/api/reference/resources/models/methods/list)
  and maps sparse `{ id, created, owned_by }` entries to `ModelConfig` with
  `cache.kind: "openai_key"` and heuristic `longRetention` / `capabilities.reasoning`.
- `createOpenAIProviderPackage` never calls discovery; pass results via `models:`.
- Codex subscription models are **not** listed by `api.openai.com` — keep using
  featured `openAICodexModels` or `codexModels:` override.
- Static `openAIModels` / `openAICodexModels` are offline bootstrap / featured aliases only.

### Reasoning

Official: [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning).

- Body field is top-level `reasoning: { effort, summary?, mode?, context? }`.
- Model defaults: `ModelConfig.compat.reasoning`; per-turn override:
  `ProviderRequestOptions.compat.reasoning` (shallow-merged; request wins).
- Portable helper: `applyThinkingLevel(options, level, "openai_reasoning")`.
- Streaming tool args follow official
  `response.output_item.added` + `response.function_call_arguments.delta`
  (string `delta`), not Chat Completions object deltas.

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport` helpers (`readSseData`, `readBoundedResponseText`).
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup; Prism never
  reads `process.env` on its own.
- API keys/access tokens are resolved per request from caller-supplied values or
  resolvers; OAuth errors redact known token values (`[REDACTED]`) including
  authorization codes, PKCE verifiers, device codes, user codes, and
  access/refresh tokens echoed in token-endpoint failures.
- The PKCE verifier is exchanged at the token endpoint, never sent on the authorize
  URL.
- Realtime uses the documented WebSocket `Authorization` header, never a credential query parameter. API keys are redacted from transcript/error events; audio/transcript input is untrusted, realtime queues are bounded, and disconnect, abort, malformed session identity, or audio/byte/wall-time cap breach closes the session.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default `npm test` is network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`, auth
  methods, request/cache policies, model compat metadata.
- [Credentials and redaction](../credentials-and-redaction.md):
  `createEnvCredentialResolver`, `resolveCredentialValue`, `redactSecrets`.
- [OpenAI-compatible provider](openai-compatible.md): Chat Completions-only adapter.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
