# OpenAI Sign in with ChatGPT — third-party policy evidence

- **Date:** 2026-10-25
- **Reviewer:** plan 204 Task 1 (phase review)
- **Base commit:** `f72663c7`
- **Purpose:** record what OpenAI's own documentation permits a third-party harness to do with a
  user's ChatGPT plan, so plan 204 implements the sanctioned flow and nothing else.
- **Verdict:** the owner's premise holds **with conditions**. OpenAI supports third-party harnesses on
  a user's ChatGPT plan through **Sign in with ChatGPT (SIWC)** for **open-source, locally hosted**
  apps, over the **public `https://api.openai.com/v1` endpoint**. Paid or remotely hosted products
  need OpenAI's interest form. The Codex CLI's private backend route is out of scope and is not used.

Every quotation below was read on 2026-10-25. Page titles and URLs are recorded verbatim.

## 1. Scope: who may use a user's ChatGPT plan

### 1.1 SIWC overview — "ChatGPT plan usage"

URL: <https://developers.openai.com/siwc/token-sharing-open-source>

> "ChatGPT plan usage is an optional capability within Sign in with ChatGPT. In addition to identity
> scopes, your open-source app can request permission to use the user's ChatGPT plan for eligible
> Responses API requests. This does not grant access to their ChatGPT conversations or other account
> context."
>
> "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested
> in offering it in a paid or remotely hosted app, complete the interest form."

URL of the form as published: <https://openai.com/form/sign-in-with-chatgpt-interest/>

### 1.2 ChatGPT Learn — "Sign in with ChatGPT" (end-user page)

URL: <https://learn.chatgpt.com/docs/sign-in-with-chatgpt>

> "Sign in with ChatGPT lets you sign in to participating apps and sites with your ChatGPT account. In
> supported apps, eligible ChatGPT Plus and Pro subscribers can also choose to use their ChatGPT plan
> for AI requests."
>
> "Open-source integrations:" — the page lists **OpenClaw, OpenCode, Pi, T3** as apps with ChatGPT plan
> usage.
>
> "Some apps also let you use your ChatGPT plan for eligible AI requests. It uses your Codex / ChatGPT
> work usage included in your plan."
>
> "App usage counts toward your existing plan limits. Connecting an app does not add a new allowance,
> and the app may have its own fees."
>
> "To set a limit for an app: Under **App limits**, open the percentage menu next to the app. Set its
> weekly limit as a percentage of your overall weekly plan usage."

So a third-party open-source harness on the user's plan is a documented, supported integration class,
not a grey area. It is metered, and the user sets a weekly per-app cap.

### 1.3 Accounts and sessions — how the limit is shared

URL: <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>

> "For ChatGPT Plus users, the five-hour usage limit is shared across all apps where they use their
> ChatGPT plan, including private and open-source clients. Usage in one app contributes to the same
> five-hour usage total, and no app receives a separate allowance. The five-hour usage limit does not
> apply for Pro users."

Consequence for Prism: a Prism session draws on the same five-hour pool as the owner's other tools
(Codex CLI included). Live acceptance runs must be small and counted.

## 2. What the flow is

URL: <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>

> "Start first-time registration with `client_id=dynamic_agent_client`, include the host's
> `ext_agent_host_id`, and set `agent_name_hint` to your app's actual name, used consistently across
> installations. After the user names and authorizes the agent, the callback returns its issued
> `client_id`. Save it with the registration for that ChatGPT account and reuse it for later sign-ins
> to the same account. … `dynamic_agent_client` is the first-time registration entrypoint, not the
> client ID to save or use for token exchange. This direct flow needs neither a client secret nor a
> partner API key."
>
> "Use an HTTP loopback callback on `127.0.0.1` from initial registration onward, for example
> `http://127.0.0.1:1455/auth/callback`. Start the listener before opening the browser. Later sign-ins
> may use another available port, such as `http://127.0.0.1:54321/auth/callback`; only the port may
> vary. Keep the scheme, host, and path unchanged: `/callback` does not match `/auth/callback`. …
> Do not substitute with `localhost`."
>
> "Identity scopes: `openid profile email`. ChatGPT plan usage scopes: `offline_access resource.invoke
> chatgpt.tokens.use.direct`."
>
> "**Validate the ID token.** Verify its signature against OpenAI's published JWKS. Check the issuer,
> audience against the issued client ID, expiration, and the nonce saved for this attempt. Use its
> validated `sub` as the account identity."
>
> "Check the token response's granted scopes for `chatgpt.tokens.use.direct` before proceeding to
> inference. A valid ID token alone does not authorize ChatGPT plan usage."
>
> "Write files atomically with owner-only permissions (`0600` on Unix), and never commit or log them.
> Replace the access token, expiry, granted scopes, and rotating refresh token together after a
> successful refresh."

So the client ID is **issued per user and workspace by the flow itself**, there is no registration form
to file, and the identity check is mandatory in this flow (unlike the private Codex route, where pi
decodes the JWT without verifying it).

### 2.1 Inference

URL: <https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference>

> "To perform inference on behalf of the user, send the OAuth access token as
> `Authorization: Bearer <ACCESS_TOKEN>` to `POST https://api.openai.com/v1/responses`."
>
> "**Supported endpoint:** Use the public Responses API endpoint above for this ChatGPT plan usage
> flow; do not point it at ChatGPT's `backend-api` endpoints."
>
> "**Set `store` to `false` and `stream` to `true` on each HTTP inference request in this flow.**"
>
> "Treat inference as successful only after receiving `response.completed`."
>
> "A usage-limit error can arrive as `response.failed` with `subscription_sharing_usage_limit_exceeded`
> or `subscription_sharing_usage_unavailable` after streaming has begun."

Model discovery on the same token:

```
GET https://api.openai.com/v1/models — keep `visibility == "list"`, `slug` is the id,
`display_name` is the label.
```

### 2.2 Route limitations

URL: <https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations>

> "**HTTP requests:** Set `store: false` and `stream: true`. Send `input` as an array containing the
> context needed for each request. Use `instructions` or developer messages; explicit
> `{type: "message", role: "system"}` items are rejected."
>
> "**Unsupported fields:** Omit `background`, `conversation`, `max_output_tokens`, `max_tool_calls`,
> `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`,
> `temperature`, `top_logprobs`, `top_p`, `truncation`, and `user`."
>
> "**Conversation state:** Omit `previous_response_id` over HTTP and send the required history in
> `input`. WebSocket continuation can reference only responses from the same authenticated connection;
> it does not provide persistent conversation storage."
>
> "**Unsupported tools:** Image generation, file search, Code Interpreter, native computer use, hosted
> MCP/connectors, and Responses `tool_search`."
>
> "**Inputs:** Text, images, and files are supported when the selected model accepts them. Audio/video
> input, the Files upload API, and the transcription API are not supported by this flow."

### 2.3 Token lifetimes

URL: <https://developers.openai.com/siwc/token-sharing-open-source/token-reference>

> "Access tokens are valid for one hour (`expires_in: 3600`)."
>
> "Refresh tokens are valid for 30 days. Each successful refresh returns a replacement refresh token
> with a fresh 30-day lifetime."
>
> "The token response includes `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`,
> `scope`, and `earliest_refresh_at`."

### 2.4 Revocation and refresh races

URL: <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>

> "When signing out, revoke the renewable session using the `revocation_endpoint` from
> `https://auth.openai.com/.well-known/openid-configuration`. Send a form-encoded `POST` with
> `token=<REFRESH_TOKEN>`, `token_type_hint=refresh_token`, and the issued `client_id`. An empty HTTP
> `200` is the revocation success response, including for an already-invalid token."
>
> "Store and use the latest replacement, and serialize refreshes for the same session so two processes
> do not race a rotating token."
>
> "Never put access or refresh tokens in URLs."

Terminal refresh codes, <https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery>:

> "**Unusable refresh token:** `invalid_grant` on refresh, `invalid_refresh_token`, `token_expired`,
> `refresh_token_expired`, `refresh_token_invalidated`, or `refresh_token_reused`. Clear unusable
> tokens and repeat OAuth with the saved issued client ID."

### 2.5 Error codes

URL: <https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery>

| Code | Status | Documented recovery |
| --- | --- | --- |
| `subscription_sharing_user_not_eligible` | 403 | "Explain the restriction; do not repeat the same request or loop through OAuth." |
| `subscription_sharing_usage_limit_exceeded` | 429 | "Pause new requests that use the user's ChatGPT plan and link to ChatGPT settings → Usage. Do not assume the entire plan is empty or infer a reset time from this code alone." |
| `subscription_sharing_usage_unavailable` | 503 | "Preserve credentials and retry later with bounded backoff." |
| `subscription_sharing_unsupported_capability` | 400 | "Inspect `error.param` and remove the unsupported input … Do not retry the same invalid body." |
| `subscription_sharing_route_not_supported` | 403 | Check method and endpoint; "support for another client type or route is not permission to use it here." |
| `subscription_sharing_invalid_user` | 401 | "Ask the user to sign in again after confirmed revocation or a terminal refresh error." |
| `chatpass_v2_scope_not_authorized` / `chatpass_v2_invalid_authorization_context` | 403 | "Check the client and grant configuration rather than retrying or changing billing." |
| `subscription_sharing_user_unavailable` | 503 | "retry with bounded backoff." |

> "Direct-route admission can return a body such as `{"detail":"..."}` before a Responses request
> starts. Treat the message as diagnostic text, not a stable machine-readable code."

### 2.6 Declined plan consent

URL: <https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery>

> "After a successful OAuth exchange, check the returned scopes for `chatgpt.tokens.use.direct`. If the
> result contains a valid ID token without that permission, retain the sign-in but mark ChatGPT plan
> usage as disabled. … When the user explicitly chooses to enable ChatGPT plan usage from your tool's
> settings, including after an earlier decline, repeat OAuth with the saved client ID and the complete
> requested scope set."

Note for plan 204 Task 4: the documented behaviour is to **keep the identity sign-in and mark plan
usage disabled**, offering another billing path. Prism has no API-key mode in this package, so the
package fails the login with `OpenAICodexPlanUsageNotGrantedError` and stores nothing for inference —
which is the same user-visible outcome (no silent paid fallback), and the message offers re-consent.

### 2.7 Self-hosted VMs

URL: <https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms>

> "Before importing credentials, create and persist a stable `ext_agent_host_id` for the VM."
>
> "Transfer the selected registration's protected credential file to the tool's documented VM path over
> a secure channel such as SSH."
>
> "Preserve the host ID assigned to the VM when importing the credentials so a copied laptop ID does not
> overwrite it."
>
> "This procedure transfers an existing credential session. Host-specific usage attribution and
> revocation of ChatGPT plan access for transferred sessions are not yet available."

No device-code flow is documented for this path anywhere in the SIWC section.

### 2.8 UI/UX obligations that reach Prism's README

URL: <https://developers.openai.com/siwc/ui-ux-guidelines>

> "Use **Continue with ChatGPT** when the action starts the sign-in flow."
>
> "You're using your ChatGPT plan — Eligible usage in this app uses your ChatGPT plan. Manage usage in
> your ChatGPT settings."
>
> "When your app receives a usage-limit error, direct the user to ChatGPT usage settings. … Make
> **Manage usage** the primary action. Open <https://chatgpt.com/settings/usage>."
>
> "**Your app must clearly show which of its plans support ChatGPT plan usage.**"

These are host-UI obligations, not SDK ones: Prism delivers the error class and the usage-settings URL
in the message, and the README tells the host what to show.

## 3. The Codex CLI's own route is not this flow

URL: <https://learn.chatgpt.com/docs/auth>

> "Codex supports two ways for a person to sign in when using OpenAI models: Sign in with ChatGPT for
> subscription access; Sign in with an API key for usage-based access."
>
> "Codex caches login details locally in a plaintext file at `~/.codex/auth.json` or in your OS-specific
> credential store. … treat `~/.codex/auth.json` like a password: it contains access tokens."

That page documents Codex's own client, not a third-party integration path. The installed Codex CLI
(0.164.0, `codex-cli 0.164.0`) is authenticated on this machine in ChatGPT mode and is used only as a
**measurement reference** (plan 184 cell, plan 204 Task 6), never as a credential source: its tokens
belong to a first-party client and its base URL is `https://chatgpt.com/backend-api`, which §2.1 tells
third-party tools not to use.

`pi` 1.4.0 ships both routes for comparison:

- `openai-codex` — private route, `https://chatgpt.com/backend-api`, Codex CLI client ID
  `app_EMoamEEZ73f0CkXaXp7hrann` (`~/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.js:10`,
  `auth/oauth/openai-codex.js:15`), unverified JWT decode.
- `openai-chatgpt` — the sanctioned SIWC flow (`auth/oauth/openai-chatgpt.js`): `dynamic_agent_client`,
  loopback listener, issued client ID, JWKS verification. This is the one Prism copies.

## 4. README wording for hosts (owner approval required before Task 5)

The package README must say this in its "Sign in with ChatGPT" section. Proposed text:

> **Who may use this.** `@arnilo/prism-provider-openai-codex` runs OpenAI models on a user's ChatGPT
> plan through OpenAI's **Sign in with ChatGPT** flow for **open-source and locally hosted** apps.
> OpenAI's terms for this flow cover open-source tools used locally, not paid or remotely hosted
> products. If you embed Prism in a paid or remotely hosted product, apply through OpenAI's interest
> form (<https://openai.com/form/sign-in-with-chatgpt-interest/>) before enabling this provider; do not
> ship it as a plan-usage path without OpenAI's approval.
>
> Usage counts against the user's own ChatGPT plan, including the shared five-hour limit and the
> per-app weekly cap in ChatGPT Settings → Usage
> (<https://chatgpt.com/settings/usage>). Prism adds no allowance and cannot see it.

- [x] **Owner approval: granted 2026-10-25.** The owner approved this wording verbatim in the planning
      session, which unblocks Task 5. Any later change to the paragraph needs a fresh approval.

## 5. What this changes in plan 204

1. **Task 4** implements the issued-client flow exactly as §2: `dynamic_agent_client` only for the
   first registration, issued client ID saved with the account, loopback `127.0.0.1:<port>/auth/callback`
   (port may vary, `localhost` violates the docs), `resource=https://api.openai.com/v1`, PKCE S256,
   `state`, `nonce`, `ext_agent_host_id`, `agent_name_hint` only on the first registration, JWKS RS256
   ID-token validation, and `chatgpt.tokens.use.direct` checked from the token response's `scope`.
2. **Task 3**'s Responses codec must never send `role: "system"` items, `previous_response_id` over
   HTTP, or any field in the §2.2 omission list.
3. **Task 5**'s error mapping is exactly §2.5; the usage-limit message carries the usage-settings URL
   because §2.8 makes the *host* responsible for that action, and the README says so.
4. **Live acceptance** (Task 9) stays small: the five-hour pool is shared with every other signed-in
   app (§1.3).
5. **README policy wording** is §4 and is blocked on the owner's confirmation.
