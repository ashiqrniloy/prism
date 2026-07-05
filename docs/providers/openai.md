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

`ProviderRequest.options.sessionId`, `cacheKey`, `cacheRetention`, `headers`,
`compat`, and `extra` map to request headers/payload fields.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (downgraded to text), `tool_call` deltas/finals, `usage`, `done`, redacted `error` events. |
| Block preservation | Text, thinking (downgraded), assistant `tool_call` → `function_call` input items, `tool_result` → `function_call_output` input items, images when `capabilities.input` includes `"image"`. |
| Auth methods | `api_key` for `openai`; `oauth` for `openai-codex`. |

Unsupported block placements or unclaimed images fail before `fetch`.

## Request/response example

Responses request body (Codex subscription shape, abbreviated):

```json
{
  "model": "gpt-5-codex",
  "instructions": "You are a coding agent.",
  "input": [{ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "Hello" }] }],
  "stream": true
}
```

OAuth authorize URL (PKCE, `S256`):

```
https://auth.openai.com/authorize?response_type=code&client_id=...&code_challenge=<base64url(SHA-256(verifier))>&code_challenge_method=S256&redirect_uri=<redirect>&scope=<scope>
```

## Implementation example

```ts
import { createExtensionKernel, createEnvCredentialResolver } from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

const kernel = createExtensionKernel();
await kernel.load([
  createOpenAIProviderPackage({
    apiKey: createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" }),
  }),
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
  OAuth provider.

### Cache behavior

- `prompt_cache_key` is derived from `ProviderRequestOptions.cacheKey` (falling
  back to `sessionId`) and sanitized + clamped to 64 characters via the shared
  `sanitizeCacheKey()` helper. Cache keys are session/customer identifiers only;
  never credentials or raw prompts.
- `prompt_cache_retention` accepts only `"24h"` on the OpenAI Responses API
  (extended caching). Prism `cacheRetention: "short"` and `"none"` omit the field
  so default automatic/implicit caching applies and no invalid literal is sent.
  `cacheRetention: "long"` maps to `prompt_cache_retention: "24h"` only when the
  model declares `ModelConfig.cache.longRetention === true`; models without that
  metadata omit the field. The catalog `gpt-5.1` model declares
  `cache: { kind: "openai_key", longRetention: true, maxKeyLength: 64 }`.
- Cache accounting is preserved in normalized `Usage`: OpenAI
  `input_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`. OpenAI
  Responses does not report a cache-write token field.
- Provider-owned headers (`content-type`, `authorization`, `x-client-request-id`)
  are applied after caller `ProviderRequestOptions.headers` so caller config
  cannot replace credentials, content type, or the session request id; non-owned
  caller headers are kept.

## Security and performance notes

- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup; Prism never
  reads `process.env` on its own.
- API keys/access tokens are resolved per request from caller-supplied values or
  resolvers; OAuth errors redact known token values (`[REDACTED]`).
- The PKCE verifier is exchanged at the token endpoint, never sent on the authorize
  URL.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default `npm test` is network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`, auth
  methods, request/cache policies, model compat metadata.
- [Credentials and redaction](../credentials-and-redaction.md):
  `createEnvCredentialResolver`, `resolveCredentialValue`, `redactSecrets`.
- [OpenAI-compatible provider](openai-compatible.md): Chat Completions-only adapter.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
