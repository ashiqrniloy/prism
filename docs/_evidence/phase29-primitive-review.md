# Phase 29 (0.2.9) primitive review — providers, SuperGrok OAuth, behavior packages

Evidence for plan 029 Task 1. Reviewed 2026-08-19 on the 0.2.8 tree (`a9918b42`) plus official vendor/OIDC pages. Tarball-excluded (`docs/_evidence`). No public behavior change.

**Only new core primitive:** additive options on existing `pollDeviceCodeToken` (`src/oauth-device-code.ts`): `bodyEncoding?: "json" | "form"` (default `"json"`), `extraDeviceParams?`, prefer https `verification_uri_complete`. No `CacheOptimizer`, no `SubscriptionAuthRouter`, no new OAuth framework.

SuperGrok is **authorized**. Cline WorkOS is **not**.

---

## Primitive inventory

| Primitive | Location | Reuse |
| --- | --- | --- |
| `createOpenAICompatibleProvider` | `src/providers/openai-compatible.ts` | All three providers. Hooks: `serializeMessage`, `buildBodyExtra`, `transformBody`, `extraHeaders`, `mapUsage`. Always `stream: true`. `delta.reasoning` and `delta.reasoning_content` already map to thinking. |
| `mapOpenAIChatUsage` | `src/providers/openai-primitives.ts` | Maps `prompt_cache_hit_tokens` and `prompt_tokens_details.cached_tokens` → `cacheReadTokens`. Does **not** invent unused input. Exclusive `cached_tokens > prompt_tokens` stays as-is (no negative unused). |
| `sanitizeCacheKey` | `src/cache-helpers.ts` | xAI `x-grok-conv-id` from `cache.key ?? cacheKey ?? sessionId`. |
| `applyThinkingLevel` / `thinkingCompatFor` | `src/thinking.ts` | Shared `thinking_type` or `reasoning_effort` patch. DeepSeek needs **both** official fields → package-local thinking helper (Z.AI pattern), not a new family. |
| `OAuthProvider` + `AuthMethod` | `src/contracts-core/extensions.ts` | xAI registers `api_key` + `oauth` like Codex (`packages/provider-openai/src/index.ts`). |
| `pollDeviceCodeToken` | `src/oauth-device-code.ts` | Device-code loop, bounded bodies, redaction, abort. Today POSTs `application/json` only. Codex + `createOAuth2Provider` depend on that default. |
| `refreshOAuthCredential` / `revokeOAuthCredential` | `src/credentials.ts` | Host refresh/revoke. Local store delete is the revoke trust boundary. |
| Codex OAuth | `packages/provider-openai/src/oauth.ts` | Template for `login`/`refresh`/`getCredential`. JSON token POST. PKCE branch exists but xAI loopback is not shipped. |
| `createOAuth2Provider` | `packages/credentials-node/src/oauth2.ts` | Also JSON. Providers must not depend on this package. xAI refresh stays in `provider-xai`. |
| `resolveCredentialValue` | `src/credentials.ts` | Late-bound `apiKey` (string / fn / resolver). SuperGrok access is a host `apiKey` function. |
| Z.AI skeleton | `packages/provider-zai/src/{provider,models,thinking}.ts` | Featured catalog + caller-gated `listZaiModels` + `reasoning_content` replay. Copy this, do not add an SDK. |
| Ponytail resolve | `packages/prism-ponytail/src/upstream.ts` | Optional peer **or** `upstreamPath`. Fail-closed, path-escape, 256 KiB cap, redacted errors. |
| Caveman resolve | `packages/prism-caveman/src/upstream.ts` + `skills.ts` | `upstreamPath` required (not on npm). Loader reads every `skills/*/SKILL.md`; missing file throws. |

Security constants (unchanged): no env scan, no setup fetch, provider-owned headers win, no `~/.grok/**` import, tokens redacted.

---

## Implement / defer

| Item | Decision | Evidence |
| --- | --- | --- |
| DeepSeek `/anthropic` | **Defer** | pi-ai Completions only (`https://api.deepseek.com`). Locked out. |
| xAI Responses / `grok-4.5` | **Defer** | pi-ai 0.84.2 catalogs `grok-4.5` under `openai-responses` only. Official generate-text is Responses. Completions may work (third-party benches) but is not required for the featured set. Reusing OpenAI Responses would add a `provider-openai` dependency. Featured: `grok-4.3`, `grok-4.6`, `grok-build-0.1`. |
| xAI exclusive `cached_tokens` | **No new mapper** | Reuse `mapOpenAIChatUsage`. If `cached_tokens > prompt_tokens`, do not invent negative unused. Document the caveat. |
| ClinePass `GET /models` | **Defer helper** | Official surface is `POST https://api.cline.bot/api/v1/chat/completions`. Community reports OpenAI `GET /models` 404. Undocumented `GET /api/v1/ai/cline/recommended-models` is not OpenAI-shaped. Static featured `cline-pass/*` catalog only. |
| Impeccable peer vs `upstreamPath` | **`upstreamPath` required** | npm `impeccable@3.6.0` exports the detector CLI (`./cli/engine/detect-antipatterns.mjs`), not a skill tree. Git source has `skill/SKILL.src.md` (compiled to `dist/universal/`). Host points at a tree with readable `SKILL.md`. No optional peer. |
| Caveman 2 engine | **Defer** | Proxy/compression product. Register extra `SKILL.md` only; skip dirs without it. |
| xAI PKCE loopback | **Defer** | OIDC lists `authorization_code` + `S256`, but xAI rejects loopback from non-allowlisted clients (OpenCode). Device-code is the SuperGrok path. |

---

## SuperGrok OAuth eligibility

Policy (`docs/provider-packages.md`): Claude Code / Claude.ai and Gemini CLI subscription OAuth are forbidden because those vendors **prohibit** third-party subscription routing. A provider-local OAuth flow is allowed only with documented authorize/token/refresh, bounded bodies, abort, redaction, and offline tests. No CLI file scan, refresh timer, or success stub.

xAI is the Codex class, not the Claude/Gemini class:

- Official OIDC `GET https://auth.x.ai/.well-known/openid-configuration` (fetched 2026-08-19): `device_authorization_endpoint` `https://auth.x.ai/oauth2/device/code`, `token_endpoint` `https://auth.x.ai/oauth2/token`, `revocation_endpoint` `https://auth.x.ai/oauth2/revoke`. Grants include `urn:ietf:params:oauth:grant-type:device_code` and `refresh_token`. `token_endpoint_auth_methods_supported` includes `none`. Scopes include `openid`, `profile`, `email`, `offline_access`, `grok-cli:access`, `api:access`.
- Public Grok Build / Grok CLI client `b1a00492-073a-47ea-816f-4c329264a828` is not a secret. Hosts may override `clientId`.
- pi-ai 0.84.2 and OpenCode POST form-urlencoded device/token/refresh; device body includes `referrer`; Bearer access hits `https://api.x.ai/v1` (not `cli-chat-proxy.grok.com`).
- Prism reuse: host-invoked `OAuthProvider` + Task 2 form options on `pollDeviceCodeToken` + `refreshOAuthCredential`. Same seam as `createOpenAICodexOAuthProvider`.

Cline WorkOS stays out (other agents use `CLINE_API_KEY`).

---

## Per-package build plan (no new types)

**DeepSeek** — `createOpenAICompatibleProvider` @ `https://api.deepseek.com`. Featured `deepseek-v4-flash` / `deepseek-v4-pro`. Package `thinking.ts` sends official `thinking` + `reasoning_effort`. Replay `reasoning_content` on tool-turn assistants (Z.AI `toZaiMessage`). Implicit cache. Caller-gated `listDeepSeekModels` (`GET {base}/models`). Canonicalize tool JSON keys in the package if needed.

**xAI** — Completions @ `https://api.x.ai/v1`. `extraHeaders` → sanitized `x-grok-conv-id`. Thinking replay on reasoning models. `createXaiOAuthProvider` implements `OAuthProvider` id `xai` via form `pollDeviceCodeToken` (`referrer` default `prism`, scope includes `grok-cli:access`). Refresh keeps previous refresh token if omitted. `getCredential` → `{ type: "bearer", value: access }`. Caller-gated `listXaiModels`.

**ClinePass** — Completions @ `https://api.cline.bot/api/v1`, slugs `cline-pass/…`. Stream only (`openAIChatEvents` already reads `delta.reasoning`). No WorkOS. No `listClinePassModels`.

**Impeccable** — Caveman-shaped: required `upstreamPath`, fail-closed without `SKILL.md`. Do not run `npx impeccable`, detector, or live browser.

**Ponytail 4.9.0 / Caveman extras** — parser + skip-missing-SKILL.md. No new primitive.
