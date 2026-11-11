# `@arnilo/prism-ai/openai-codex`

OpenAI Codex provider package for [Prism](https://github.com/ashiqrniloy/prism): runs OpenAI models on a
ChatGPT plan through **Sign in with ChatGPT**, keeps the OAuth grant in a `keyring:` ref, refreshes it per
request, and ships the stateless Responses wire plus the model catalog.

## Install

```sh
bun add @arnilo/prism-ai
```

## Use

```ts
import openaiCodex from "@arnilo/prism-ai/openai-codex";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "openai-codex/gpt-6.1-sol",
  packages: [openaiCodex({ appName: "My Host" })],
});
```

The bare definition uses the schema defaults, so `packages: [openaiCodex]` is the same as
`openaiCodex({ credential: "keyring:openai-codex" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `credential` | `keyring:` ref | `keyring:openai-codex` | Where the grant is kept. An `env:` ref is refused at load: a sign-in writes this ref. |
| `appName` | string, 1–64 | — | The host's name for this app, sent as `agent_name_hint` on first sign-in. Required to sign in; a missing value fails the login, not the load. |
| `baseUrl` | string | `https://api.openai.com/v1` | The base the grant is scoped to. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks `GET /models` with the grant. |
| `callbackPort` | integer | `1455` | Loopback port the sign-in listener tries first; a busy port falls back to an ephemeral one. |

Factory-only options — `id`, `fetch`, and `callback` (`"listen"` or `"paste"`) — are not JSON and cannot come
from a manifest. Set config through the code instance or `AgentConfig.packageConfig` (which wins).

## Sign in with ChatGPT

A sign-in is a host action: the package declares an `oauth` `AuthMethod` on its provider, and nothing in the
kernel runs one. Iterate `provider.auth`, read `kind === "oauth"`, and call `login({ host, credentials })`.
[`docs/host.md`](https://github.com/ashiqrniloy/prism/blob/main/docs/host.md) has the wiring; the flow is:

1. `open-url` sends the person to `auth.openai.com` with PKCE (S256), a `state`, a `nonce`, the scopes
   `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, and
   `resource=https://api.openai.com/v1`.
2. The first sign-in registers the app as `dynamic_agent_client` with the host's `agent_name_hint` and a
   `ext_agent_host_id`; the callback returns the issued client ID, which every later sign-in and refresh reuses.
3. The callback lands on `127.0.0.1:1455/auth/callback` (`callback: "paste"` takes the URL from `input`
   instead, for a host without a loopback listener). The code is exchanged, the ID token is verified against
   the discovery JWKS (issuer, audience, expiry, nonce), the grant must carry `chatgpt.tokens.use.direct`, and
   one record is stored.
4. `openAICodexLogout()` revokes the refresh token at the discovery revocation endpoint and replaces the record with the registration alone (issued client and this host's ID, no token), so signing in again reuses them instead of registering a second client;
   the client registration stays, so the next sign-in is one prompt shorter.

**Headless hosts** import a record instead of running a browser flow: `openAICodexImportCredentials(config)(ctx,
record)` validates the v1 shape and keeps the importing host's own host ID.

**Who may use this.** `@arnilo/prism-ai/openai-codex` runs OpenAI models on a user's ChatGPT plan through
OpenAI's **Sign in with ChatGPT** flow for **open-source and locally hosted** apps. OpenAI's terms for this flow
cover open-source tools used locally, not paid or remotely hosted products. If you embed Prism in a paid or
remotely hosted product, apply through OpenAI's interest form
(<https://openai.com/form/sign-in-with-chatgpt-interest/>) before enabling this provider; do not ship it as a
plan-usage path without OpenAI's approval.

Usage counts against the user's own ChatGPT plan, including the shared five-hour limit and the per-app weekly
cap in ChatGPT Settings → Usage (<https://chatgpt.com/settings/usage>). Prism adds no allowance and cannot see it.

## Behaviour

- **One stateless route.** `POST /responses` with the grant's bearer token, `store: false`, `stream: true`, and
  `include: ["reasoning.encrypted_content"]`. Nothing is stored server-side, so a turn never sends
  `previous_response_id`, and a conversation is replayed in full every time.
- **Prompt caching.** `prompt_cache_key` comes from the codec and is clamped to 64 characters; the same key is
  sent as the `session_id` and `x-client-request-id` headers, so a session lands on the same backend and the same
  cache entry. A measured three-turn probe with the key reused 0.921 and 0.913 of its input; without it, 0, and
  the four-turn probe recorded in `docs/_evidence/cache-probe/` reused 0.983. The wire request matches pi 1.4.0's
  Sign in with ChatGPT request lever for lever: the same key and clamp, the same two headers, `store: false`, the
  same `include`, the same tools, and the same input items — pi carries the prompt in a leading `developer` item
  where this package uses the Responses `instructions` field, with identical text
  (`src/__tests__/fixtures/README.md`). Encrypted reasoning items are replayed byte-for-byte to this provider only,
  so a `store: false` tool loop keeps its reasoning without a stored response.
- **HTTP only, deliberately.** Every request is a `POST /responses` with the full history and `store: false`. The Responses WebSocket with
  `previous_response_id` continuation is not implemented: a two-turn, same-model, same-account comparison shows this route re-reads 98 % of its
  prefix ([8 192 of 8 352][turn2]) while codex-cli 0.164.0 re-reads only half of it once the prompt carries user content, so the socket would add a
  connection lifetime and a fallback path with no measured saving.

[turn2]: ../../../docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json

- **Unsupported fields are never sent.** `temperature`, `top_p`, `metadata`, `truncation`, `user`, `prompt`,
  `conversation`, and eight more are refused by this route, so they are deleted after the body is built — a
  model's `parameters` or a caller's `extra` cannot re-add one. `max_output_tokens` is accepted from 16 upward
  and passes through; a smaller value fails locally with `max_output_tokens_below_minimum`.
- **Plan usage is never retried.** A `429 subscription_sharing_usage_limit_exceeded` classifies `quota` and the
  default retry policy declines it: the same attempt spends the same allowance. Its message names ChatGPT
  Settings → Usage. `…_usage_unavailable` and `…_user_unavailable` (503) are transient with bounded backoff;
  `…_user_not_eligible`, `…_route_not_supported`, and `chatpass_v2_*` (403) are `auth`; a 400 capability
  rejection is `permanent`; `subscription_sharing_invalid_user` (401) asks for a new sign-in.
- **Refresh is invisible.** An access token within five minutes of expiry is refreshed before the request, with
  the saved client ID and no `scope`; the rotated record is persisted before it is used, and two concurrent
  turns make one refresh. A terminal refresh code (`invalid_grant`, `refresh_token_expired`, …) clears the
  record's usability and asks for a new sign-in.
- **Missing grant.** `createAgent` still succeeds: setup records
  `status.note("warn", "openai-codex: not signed in")` and registers the provider, so `agent.models` still lists
  the catalog. A run then fails with `openai_codex_reauthorize`, naming the ref and never a value.
- **Discovery is caller-gated.** Nothing fetches during setup; `models()` runs once when `agent.models.list()`
  is called, keeps entries whose `visibility` is `list`, and maps `context_window`, `input_modalities`, and
  `supported_reasoning_levels` from the response.
- **Secrets never surface.** The access token and the refresh token join the agent's redaction set; the only
  thing a login shows the host is the authorize URL.

## Models

The static catalog is the two slugs the wire probes exercised end to end:

| model | label | context window |
| --- | --- | --- |
| `gpt-6.1-sol` | GPT-6.1 Sol | 500 000 |
| `gpt-6-luna` | GPT-6 Luna | 272 000 |

Both accept text and images, stream, call tools, replay encrypted reasoning, and support native `json_schema`
structured output; reasoning levels are `low`, `medium`, `high`, `xhigh`, and `max`. `GET /models` on a live grant
lists seven more slugs (`gpt-6-astra`, `gpt-6-sol`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and two hidden
entries) at 272 000 tokens; discovery maps them when a host asks. `maxOutputTokens` is not declared: the route
accepts any value from 16 up and the catalog reports no ceiling.

## Named exports

`openAICodex`, the definition, `createOpenAICodexProvider`, `openAICodexAffinity`, `OPENAI_CODEX_RESPONSES_ROUTE`,
`OPENAI_CODEX_SESSION_ID_MAX_LENGTH`, the catalog (`openAICodexModels`, `defineOpenAICodexModel`,
`listOpenAICodexModels`, `mapOpenAICodexModel`, `openAICodexThinkingLevels`), the sign-in client
(`openAICodexAuth`, `openAICodexApiKey`, `openAICodexLogout`, `openAICodexImportCredentials`,
`assertWritableCredentialRef`, `parseCredentialRecord`, `credentialRecordFromSecret`, `credentialRecordToSecret`,
the error classes, and the scope/endpoint constants), and the error mapper (`openAICodexHttpError`,
`openAICodexErrorCode`, `OPENAI_CODEX_ERROR_CLASSES`, `USAGE_LIMIT_NOTE`).

## License

MIT
