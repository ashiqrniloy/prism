# xAI provider package

## What it does

`@arnilo/prism-providers/xai` provides explicit, side-effect-free setup for the
xAI Grok Chat Completions API (`POST https://api.x.ai/v1/chat/completions`)
with implicit prefix caching via a sanitized `x-grok-conv-id` header, reasoning
replay, and host-invoked SuperGrok / X Premium OAuth.

The package registers a provider, featured Completions models, an `api_key`
auth method, and an `oauth` auth method (`createXaiOAuthProvider`, id `xai`).

## When to use it

Use it when a host wants Grok 4.6 / 4.3 / Build through Prism with either an
xAI API key or a SuperGrok / X Premium subscription login.

Do not use it for Responses-only `grok-4.5`, PKCE loopback, `cli-chat-proxy.grok.com`,
`~/.grok` credential import, or setup-time catalog fetches.

## Inputs / request

```ts
import {
  createXaiOAuthProvider,
  createXaiProviderPackage,
  listXaiModels,
} from "@arnilo/prism-providers/xai";

createXaiProviderPackage(options: XaiProviderPackageOptions): ProviderPackage
createXaiOAuthProvider(options?: XaiOAuthOptions): OAuthProvider
listXaiModels(options?: ListXaiModelsOptions): Promise<ModelConfig[]>
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | API key **or** SuperGrok access token (host wires after `login` / `refreshOAuthCredential`). |
| `fetch` | `typeof fetch` | Optional fetch for tests/hosts. |
| `baseUrl` | `string` | Default `https://api.x.ai/v1`. |
| `id` | `string` | Provider id (default `xai`). |
| `models` | `readonly ModelConfig[]` | Overrides featured `xaiModels`. |
| `oauth` | `XaiOAuthOptions` | Optional client id / endpoints / referrer overrides. |

### Cache header

`x-grok-conv-id` is `sanitizeCacheKey(cache.key ?? cacheKey ?? sessionId, 128)`.
Omitted when `cache.mode` is `off`, `cacheRetention` is `none`, or the key sanitizes empty.

### SuperGrok OAuth

RFC 8628 device-code. Default public client id
`b1a00492-073a-47ea-816f-4c329264a828` is **not a secret**. Scope
`openid profile email offline_access grok-cli:access api:access`. Referrer
default `prism`. Endpoints: `https://auth.x.ai/oauth2/device/code`,
`/token`, `/revoke`. Form-urlencoded bodies. `verification_uri` /
`verification_uri_complete` must be `https:`. Refresh keeps the previous
`refresh_token` when omitted and applies a 5-minute expiry skew. Revoke is
best-effort; `revokeOAuthCredential` still deletes the local store.

No PKCE loopback. Login requires `onDeviceCode`. Setup never logs in.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (`delta.reasoning_content` / `delta.reasoning`), tool-call, `usage`, `done`, redacted `error`. |
| Cache usage | `prompt_tokens_details.cached_tokens` → `cacheReadTokens`. If `cached_tokens > prompt_tokens` (exclusive report), values are kept as-is; unused input is not invented. |
| Auth | `api_key` and `oauth` (`getCredential` → `{ type: "bearer", value: access }`). |
| Images | Allowed when `capabilities.input` includes `image`. Rejected otherwise. |

## Request/response example

```json
{
  "model": "grok-4.6",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

Header: `x-grok-conv-id: sess-1`.

## Implementation example

```ts
import { createExtensionKernel, refreshOAuthCredential } from "@arnilo/prism";
import { createXaiOAuthProvider, createXaiProviderPackage } from "@arnilo/prism-providers/xai";

const kernel = createExtensionKernel();
await kernel.load([createXaiProviderPackage({ apiKey: "fake-xai-key" })]);

const oauth = createXaiOAuthProvider();
const creds = await oauth.login({
  onDeviceCode: ({ userCode, verificationUri }) => {
    console.log(`Open ${verificationUri} and enter ${userCode}`);
  },
});
await store.set("xai", creds);

await kernel.load([
  createXaiProviderPackage({
    apiKey: async () => {
      const current = await store.get("xai");
      return (await refreshOAuthCredential({ provider: oauth, credentials: current, store })).access;
    },
  }),
]);
```

## Extension and configuration notes

- Featured Completions: `grok-4.6` (500k), `grok-4.3` (1M), `grok-build-0.1` (256k). All image + reasoning, `cache.kind: "implicit"`.
- `grok-4.5` / Responses API is not implemented.
- `listXaiModels()` is caller-gated `GET {base}/models`. Setup never fetches.
- Reasoning models replay `reasoning_content` and do not flatten thinking into text.
- Generate always hits `https://api.x.ai/v1/chat/completions` (same backend for API key and SuperGrok access).

## Security and performance notes

- Public client id is documented as not a secret. Device/user/access/refresh codes are redacted.
- HTTPS verification URI only. No PKCE loopback. No `~/.grok/**` or env scan.
- Provider-owned headers (`authorization`, `content-type`) win. Conv-id is never a credential.
- Bounded OAuth and API error bodies. No retry loop. No refresh timer.
- Live API-key smoke: `PRISM_LIVE_PROVIDER_TESTS=1` + `XAI_API_KEY`. SuperGrok login is operator-only (`PRISM_LIVE_XAI_OAUTH=1`).

## Thinking and reasoning

Reasoning models now send `reasoning_effort` (task-065 change — previously dropped): grok-4.6 declares `low/medium/high/xhigh` (default `high`), grok-4.5 `low/medium/high`, grok-4.3 `none/low/medium/high`. Effort snaps to the declared set (nearest, ties up); `grok-build` declares nothing and passes `reasoning_effort` through verbatim. Reasoning models must still replay `reasoning_content` — Featured Completions flatten nothing. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [Provider packages](../provider-packages.md): OAuth support matrix.
- [Credentials and redaction](../credentials-and-redaction.md): SuperGrok is authorized; Claude/Gemini are not.
- [Credential storage](../credential-storage.md): host-owned store after explicit `login`.
- [Provider caching](../provider-caching.md): implicit xAI prefix cache + conv-id.
- [Thinking and reasoning](../thinking-and-reasoning.md): xAI reasoning replay.
- [OpenAI Codex](openai.md): the other first-party subscription OAuth flow.

## Official evidence

- [Prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)
- [OIDC discovery](https://auth.x.ai/.well-known/openid-configuration)
