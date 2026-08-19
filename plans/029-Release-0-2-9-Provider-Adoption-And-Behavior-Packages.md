# 029 — Release 0.2.9: Provider adoption, SuperGrok OAuth, behavior packages

Roadmap phase: 0.2.x line, milestone **0.2.9** (`roadmap.md` "0.2.9 - Misc").
Baseline: `@arnilo/prism` **0.2.8** (plan 028 complete; 51 publishable manifests; atomic exact peers).
Target: `@arnilo/prism` **0.2.9** (additive/non-breaking patch).
Status: **locked scope.** Harness review is out. SuperGrok / X Premium OAuth is in.

0.2.9 is an **adoption cut**. New first-party providers follow `createOpenAICompatibleProvider` (Z.AI / OpenCode Go). xAI SuperGrok OAuth follows the host-invoked Codex `OAuthProvider` seam plus official xAI OIDC (`auth.x.ai`). Behavior packages follow Caveman/Ponytail (upstream-owned content, fail-closed resolve, no vendored skill bodies).

## Objectives

- Ship first-party providers for DeepSeek API, xAI Grok, and ClinePass, matching `@earendil-works/pi-ai` 0.84.2 wire choices and official vendor cache/thinking docs.
- Make xAI SuperGrok / X Premium subscription login work: RFC 8628 device-code against `https://auth.x.ai`, refresh, revoke, Bearer access token on `https://api.x.ai/v1`. API key alone is not enough.
- Maximize documented, testable cache-hit behavior for the three providers without inventing request fields the vendor does not accept.
- Add `@arnilo/prism-impeccable` so hosts can run [pbakaus/impeccable](https://github.com/pbakaus/impeccable) inside Prism the same way Ponytail/Caveman work.
- Bump `@arnilo/prism-ponytail` to `@dietrichgebert/ponytail@^4.9.0` and `@arnilo/prism-caveman` to JuliusBrussee/caveman **v2.1.0** skill set.

## Expected Outcome

- Three new dependency-free provider workspaces: `@arnilo/prism-provider-deepseek`, `@arnilo/prism-provider-xai`, `@arnilo/prism-provider-clinepass`. Each is setup-zero-fetch, late-credential-bound, streams Chat Completions, maps cache usage, and has offline conformance + opt-in live smoke.
- `@arnilo/prism-provider-xai` registers **both** `api_key` and host-invoked `oauth`. A SuperGrok / X Premium user can `login()` with a device code, persist tokens on a host `OAuthCredentialStore`, refresh, and run Grok models with no `XAI_API_KEY`.
- Shared `pollDeviceCodeToken` accepts form-urlencoded bodies and extra device-code fields so xAI (and future form-encoded issuers) reuse the Codex/M365 helper. JSON default stays byte-compatible.
- `@arnilo/prism-providers` gains the three adapters (11 → 14 of 17; Azure/Bedrock/Vertex still omitted). `@arnilo/prism-impeccable` stays optional, omitted from `prism-all` (same as Caveman/Ponytail). `PRISM_FAMILY` adds impeccable (9 → 10).
- Publishable graph **51 → 55** at exact **0.2.9**. Atomic-upgrade peers stay exact.
- Docs: three provider pages (xAI includes SuperGrok OAuth), impeccable page, cache-matrix rows, ponytail/caveman updates, OAuth support-matrix row, `docs/index.md` navigation.

## Locked in / out

| Item | Decision | Why |
| --- | --- | --- |
| DeepSeek API provider | **In** | pi-ai Completions at `https://api.deepseek.com`; V4 Flash/Pro; implicit disk cache. |
| xAI Grok provider | **In** | Completions at `https://api.x.ai/v1`; sticky `x-grok-conv-id`. |
| xAI SuperGrok / X Premium OAuth | **In** | Official OIDC device-code + refresh. User requirement. Same seam as Codex. |
| ClinePass provider (API key) | **In** | Official `https://api.cline.bot/api/v1`; `CLINE_API_KEY`. |
| Cache-hit mapping | **In** | Provider-local mapping + stable prefix + thinking replay + tool-schema canonicalize. |
| Impeccable package | **In** | Upstream-skill package. No live browser, no detector engine. |
| Ponytail `^4.9.0` | **In** | Bare `/ponytail` reports status. |
| Caveman v2.1.0 skills | **In** | Require core 7; register extra `SKILL.md`. No Caveman 2 proxy engine. |
| Muse / DeepSeek harness work | **Out** | User cut. No review page, no observers, no Cordis. |
| Cline WorkOS OAuth | **Out** | Other agents use API keys. |
| DeepSeek `/anthropic` route | **Out** | pi-ai Completions only. |
| `~/.grok/auth.json` / grok-cli scan | **Out** | No ambient credential discovery. |
| Independent package versions | **Out** | Breaks 0.2.x Decision A atomic peers. |
| Vent, computer-use Linux, Karpathy wiki, enterprise RAG, coding-tool audit, debug workflow, selective package release | **Out** | Other 0.2.9 roadmap leftovers. Separate cuts. |

## Research record (2026-08-19)

### DeepSeek (`api-docs.deepseek.com`)

- Featured: `deepseek-v4-flash`, `deepseek-v4-pro`. Legacy `deepseek-chat` / `deepseek-reasoner` alias Flash and retire 2026-07-24 15:59 UTC — do not catalog aliases.
- Base: `https://api.deepseek.com` `POST /chat/completions`. Anthropic mirror unused.
- Thinking: default on, effort `high`. Wire `thinking: { type: "enabled"|"disabled" }` + `reasoning_effort: low|high|max`. Medium/xhigh map to `high`.
- Tool turns: assistant `reasoning_content` **must** be replayed or API returns 400.
- Cache: implicit disk prefix, no request field, no write fee. Usage `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` (core `mapOpenAIChatUsage` already maps hit tokens).
- Cost (pi-ai 0.84.2): Flash in 0.14 / cacheRead 0.0028 / out 0.28; Pro in 0.435 / cacheRead 0.003625 / out 0.87. `cacheWrite: 0`.
- Cache busters: date/cwd in system prompt, shuffled tool JSON, compaction rewrite, dropping required thinking on tool turns.

### xAI API + SuperGrok OAuth

- Featured Completions (pi-ai catalog): `grok-4.3` (1M), `grok-4.6` (500k), `grok-build-0.1` (256k). Responses-only `grok-4.5` deferred unless Task 1 proves Completions 400s.
- Cache: automatic prefix. Sticky Completions header `x-grok-conv-id` (sanitized session/cache key). Replay reasoning. Usage `prompt_tokens_details.cached_tokens`. If `cached_tokens > prompt_tokens`, do not invent negative unused input.
- Official OIDC: `GET https://auth.x.ai/.well-known/openid-configuration` (fetched 2026-08-19):
  - `device_authorization_endpoint`: `https://auth.x.ai/oauth2/device/code`
  - `token_endpoint`: `https://auth.x.ai/oauth2/token`
  - `revocation_endpoint`: `https://auth.x.ai/oauth2/revoke`
  - `grant_types_supported`: `authorization_code`, `refresh_token`, `urn:ietf:params:oauth:grant-type:device_code`
  - `scopes_supported` include `openid`, `profile`, `email`, `offline_access`, `grok-cli:access`, `api:access`
  - `token_endpoint_auth_methods_supported` includes `none` (public client)
  - `code_challenge_methods_supported`: `S256`
- Wire used by pi-ai 0.84.2 (`dist/auth/oauth/xai.js`) and OpenCode `packages/opencode/src/plugin/xai.ts`:
  - Public client id `b1a00492-073a-47ea-816f-4c329264a828` (Grok Build / Grok CLI public client, not a secret)
  - Scope `openid profile email offline_access grok-cli:access api:access`
  - Device + token + refresh POSTs are `application/x-www-form-urlencoded`
  - Device body includes `referrer` (`pi` / `opencode`)
  - Prefer `verification_uri_complete` when present; validate `https:`
  - Access token is used as `Authorization: Bearer` against `https://api.x.ai/v1` (not `cli-chat-proxy.grok.com`)
  - Refresh may omit `refresh_token`; keep the previous refresh token
  - Default `expires_in` 3600 s; refresh skew 2–5 minutes
- Eligibility vs Prism OAuth policy (`docs/provider-packages.md`): Claude/Gemini are forbidden because those vendors **prohibit** third-party subscription routing. xAI publishes OIDC + a public Grok Build client and documents subscription login for Grok Build. Warp and Kilo document SuperGrok OAuth as a supported product path. This is the same class as Codex: a documented, host-invoked, provider-authorized subscription flow. Default client id is the published public client (xAI allowlists it for device-code). Hosts may override `clientId`. Loopback PKCE is **not** shipped — xAI rejects loopback from non-allowlisted clients.
- Forbidden: scan `~/.grok/auth.json`, auto login on import, refresh timer, success stub.

### ClinePass (`docs.cline.bot/getting-started/clinepass`)

- `POST https://api.cline.bot/api/v1/chat/completions`, bearer `CLINE_API_KEY`.
- Official slugs: `cline-pass/glm-5.2`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `deepseek-v4-pro`, `deepseek-v4-flash`, `mimo-v2.5`, `mimo-v2.5-pro`, `minimax-m3`, `qwen3.8-max`, `qwen3.7-max`, `qwen3.7-plus`.
- Stream SSE is OpenAI-shaped. Non-stream wraps `{ data, success }` ([cline#12647](https://github.com/cline/cline/issues/12647)). Prism always streams.
- Cache is upstream-implicit. Map cache tokens when present.

### Impeccable / Ponytail / Caveman

- Impeccable (`pbakaus/impeccable`): one skill, 23 commands, 59 detector rules. npm `impeccable` is the CLI; skill payload lives in the git tree. Resolve `upstreamPath` (and optional peer only if Task 1 finds `skills/impeccable/SKILL.md`). Do not run `npx impeccable install`. Do not implement live browser or the detector engine.
- Ponytail npm `@dietrichgebert/ponytail@4.9.0`. Bare `/ponytail` reports status. Prism empty-args currently **sets** mode.
- Caveman v2.1.0: original 7 skills remain. Extra `SKILL.md` dirs exist (`caveman-discover`, `caveman-explore`, …). Engine/proxy is a separate product — out. Current loader already scans every skills dir; it must skip dirs without `SKILL.md` so engine junk does not fail closed.

## Tasks

- [x] Task 0 — Freeze manifest and baseline
  - Acceptance Criteria:
    - Functional: `scripts/phase29-freeze-manifest.json` lists allowed surfaces (three provider packages, impeccable, ponytail/caveman, `src/oauth-device-code.ts` additive options, listed docs/scripts) and forbidden categories (Cline WorkOS, DeepSeek Anthropic route, grok-cli file scan, harness/Cordis/Muse observers, independent versions, 0.2.9-deferred leftovers). Empty deviation log at freeze.
    - Functional: `scripts/phase29-baseline.json` records 0.2.8 `exitGate` counts, audit 0 moderate, 51-package graph, compat baseline status.
    - Performance: freeze test is schema-only; no live network.
    - Code Quality: `scripts/phase29-freeze.test.mjs` wired into `npm test` after phase27; deviation entries require task+change+rationale.
    - Security: restates audit `--audit-level=moderate` = 0, additive-only compat, no new runtime deps in core, SuperGrok OAuth is host-invoked and eligibility-gated (not Claude/Gemini piggyback).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` 0.2.9; `scripts/phase27-freeze-manifest.json` / `scripts/phase27-freeze.test.mjs`; `docs/release-and-install.md` Decision A; `docs/provider-packages.md` subscription OAuth matrix; `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Keep the previous harness-review 029: rejected — user cut harness work.
      - Skip freeze: rejected — 0.2.x precedent is machine-checked scope.
    - Chosen Approach:
      - Same phase-N freeze triad as 014/027. Scope table above is locked.
    - API Notes and Examples:
      ```jsonc
      { "release": "0.2.9", "line": "0.2.x", "type": "adoption",
        "allowed": ["packages/provider-deepseek/**", "packages/provider-xai/**",
                    "packages/provider-clinepass/**", "packages/prism-impeccable/**",
                    "packages/prism-ponytail/**", "packages/prism-caveman/**",
                    "packages/prism-providers/**", "src/oauth-device-code.ts",
                    "docs/**", "scripts/phase29-*", "scripts/package-truth.mjs"],
        "forbidden": ["cline-workos-oauth", "deepseek-anthropic-route",
                      "grok-cli-auth-file-scan", "harness-rewrite",
                      "independent-package-versions"],
        "deviations": [] }
      ```
    - Files to Create/Edit:
      - `scripts/phase29-freeze-manifest.json`: create.
      - `scripts/phase29-freeze.test.mjs`: create.
      - `scripts/phase29-baseline.json`: create.
      - `package.json`: add `scripts/phase29-freeze.test.mjs` to `npm test`.
      - `roadmap.md`: replace 0.2.9 leftover bullets with this locked list.
      - `plans/README.md`: 029 row (this file).
    - References:
      - `plans/027-Release-0-2-7-Enterprise-ERP-Production-Readiness.md` Task 0; `plans/014-Release-0-1-2-Alibaba-Provider-Enrichment.md` Task 0.
  - Test Cases to Write:
    - freeze schema: required keys, deviation shape.
    - forbidden-category tripwire present; SuperGrok OAuth listed as allowed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (process evidence).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (docs-not-required path).

- [x] Task 1 — Primitive review and OAuth eligibility
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase29-primitive-review.md` inventories existing primitives vs each new package and records implement-or-defer for: DeepSeek Anthropic route, xAI Responses (`grok-4.5`), xAI exclusive cached-token reporting, ClinePass `GET /models`, Impeccable peer vs `upstreamPath`, Caveman 2 engine, xAI PKCE loopback.
    - Functional: OAuth eligibility section cites official `auth.x.ai` OIDC, Grok Build public client, Codex seam reuse, and the Claude/Gemini contrast. SuperGrok is **authorized**. Cline WorkOS is **not**.
    - Functional: names the only new core primitive: additive options on `pollDeviceCodeToken` (form encoding, extra device params, https verification URI, optional `verification_uri_complete`). No new OAuth framework.
    - Performance: docs/evidence only.
    - Code Quality: one evidence file; no `CacheOptimizer` / `SubscriptionAuthRouter` type.
    - Security: restates no env scan, no setup fetch, provider-owned headers win, no grok-cli file import, tokens redacted.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md` (OAuth matrix), `docs/providers/openai.md` (Codex OAuth), `docs/credentials-and-redaction.md`, `docs/credential-storage.md`, `docs/providers/openai-compatible.md`, `docs/provider-caching.md`, `docs/ponytail.md`, `docs/caveman.md`.
      - `src/oauth-device-code.ts`, `src/credentials.ts` (`refreshOAuthCredential` / `revokeOAuthCredential`), `packages/provider-openai/src/oauth.ts`, `packages/credentials-node/src/oauth2.ts`, `src/providers/openai-compatible.ts`, `packages/provider-zai/**`.
      - pi-ai 0.84.2 `dist/auth/oauth/xai.js`, `dist/providers/xai.js`, `dist/providers/data/xai.json`.
      - `https://auth.x.ai/.well-known/openid-configuration`.
      - OpenCode `packages/opencode/src/plugin/xai.ts` (form-urlencoded, `referrer: "opencode"`, Bearer on `api.x.ai`).
    - Options Considered:
      - New core `XaiOAuth` type: rejected — `OAuthProvider` already exists.
      - Depend on `@arnilo/prism-credentials-node` `createOAuth2Provider`: rejected — that helper POSTs JSON; providers peer only `@arnilo/prism`.
      - Depend on `@arnilo/prism-provider-openai` for xAI Responses: rejected unless Task 1 proves `grok-4.5` is Completions-impossible.
      - Ship PKCE loopback plus device-code: rejected — xAI rejects loopback from non-allowlisted clients. Device-code is the SuperGrok path.
    - Chosen Approach:
      - Reuse `createOpenAICompatibleProvider` + Z.AI-style hooks. Reuse Codex `OAuthProvider` + `pollDeviceCodeToken` after Task 2 adds form encoding. Static featured catalogs + caller-gated `list*Models`. Behavior packages copy Ponytail/Caveman resolve/load.
    - API Notes and Examples:
      ```ts
      api.registerAuthMethod({ kind: "api_key", provider: "xai", credentialName: "apiKey" });
      api.registerAuthMethod({ kind: "oauth", provider: "xai", oauth: createXaiOAuthProvider() });
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase29-primitive-review.md`: create.
      - `scripts/phase29-freeze-manifest.json`: record verified deferrals.
    - References:
      - create-plan primitive-review rule; `docs/provider-packages.md` first-party skeleton and OAuth eligibility paragraph.
  - Test Cases to Write:
    - freeze test: evidence file contains tokens `pollDeviceCodeToken`, `auth.x.ai`, `grok-cli:access`, `createOpenAICompatibleProvider`, `upstreamPath`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal evidence). Public OAuth docs land with Tasks 2 and 4.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Extend `pollDeviceCodeToken` for form-encoded issuers
  - Acceptance Criteria:
    - Functional: `PollDeviceCodeTokenOptions` gains additive optional `bodyEncoding?: "json" | "form"` (default `"json"`), `extraDeviceParams?: Readonly<Record<string, string>>`, and prefers `verification_uri_complete` when it is a non-empty `https:` URL. Existing Codex / credentials-node JSON callers stay byte-compatible.
    - Functional: `form` encoding POSTs `application/x-www-form-urlencoded` for both the device-code request and every token poll. `extraDeviceParams` merge into the device-code body only (e.g. `referrer`). `extraTokenParams` still merge into every token poll.
    - Functional: `verification_uri` and `verification_uri_complete` that are not `https:` fail closed before `onDeviceCode`. `example.test` HTTPS fixtures still pass.
    - Performance: same poll cadence (`authorization_pending` continue, `slow_down` +5 s, expiry, abort). Bounded success/error bodies unchanged.
    - Code Quality: no new module, no strategy class. Optional fields only.
    - Security: device/user/access/refresh codes still redacted; verification URI cannot be `http:` / `javascript:` / custom scheme.
  - Approach:
    - Documentation Reviewed:
      - RFC 8628; `src/oauth-device-code.ts`; Codex and credentials-node callers; xAI OIDC `token_endpoint_auth_methods_supported: none`.
    - Options Considered:
      - Duplicate a poll loop inside provider-xai: rejected — plan 021 consolidated this helper on purpose.
      - Flip the helper default to form: rejected — would change Codex/M365 request bytes.
    - Chosen Approach:
      - Opt-in `bodyEncoding: "form"` + `extraDeviceParams`. Default JSON path is the existing implementation.
    - API Notes and Examples:
      ```ts
      await pollDeviceCodeToken({
        fetchImpl, deviceCodeUrl, tokenUrl, clientId, scope,
        bodyEncoding: "form",
        extraDeviceParams: { referrer: "prism" },
        errorPrefix: "xAI",
        callbacks, parseTokenCredentials,
      });
      ```
    - Files to Create/Edit:
      - `src/oauth-device-code.ts`: additive options + https URI gate + form encoder.
      - `src/__tests__/oauth-device-code.test.ts`: create (or extend the nearest existing helper test if one already covers the helper directly).
      - `docs/credentials-and-redaction.md`: note form encoding + https verification URI.
      - `src/__tests__/docs.test.ts`: tripwire tokens if that page is asserted.
    - References:
      - plan 021 Task 5 helper contract; pi-ai / OpenCode form bodies.
  - Test Cases to Write:
    - default JSON still sends `application/json` with `{ client_id, scope }`.
    - `bodyEncoding: "form"` sends urlencoded device + token bodies; `referrer` only on device POST.
    - `verification_uri_complete` (https) is what `onDeviceCode` receives.
    - `http:` / invalid URI fails closed, no poll.
    - `authorization_pending` / `slow_down` / expiry / abort / oversized body / missing `access_token` unchanged.
    - secrets still `[REDACTED]` in thrown errors.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive options on exported `pollDeviceCodeToken`.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: form encoding, extra device params, https verification URI.
    - `docs/index.md` update: no (existing credentials entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — `@arnilo/prism-provider-deepseek`
  - Acceptance Criteria:
    - Functional: `createDeepSeekProvider` / `createDeepSeekProviderPackage` register provider `deepseek`, featured `deepseek-v4-flash` and `deepseek-v4-pro` (1M context, 384k max out, `cache.kind: "implicit"`, reasoning+tools, text-only input), auth `api_key`/`apiKey`. No network on import/setup.
    - Functional: body sends `max_tokens` (not `maxTokens`), official `thinking` + `reasoning_effort` from `applyThinkingLevel` / compat. Assistant messages replay `reasoning_content` when the transcript has a tool call after that assistant. Tool JSON Schema keys are canonicalized (sorted) before send.
    - Functional: `listDeepSeekModels` is caller-gated `GET {base}/models`. Usage maps `prompt_cache_hit_tokens` via existing `mapOpenAIChatUsage`.
    - Performance: one POST per generate; bounded error bodies; no provider retry loop.
    - Code Quality: peer `@arnilo/prism` exact; no SDK dep; side-effect-free; Z.AI skeleton.
    - Security: `resolveCredentialValue` per request; provider `authorization` wins; `redactSecrets`; no filesystem/env reads.
  - Approach:
    - Documentation Reviewed:
      - https://api-docs.deepseek.com/guides/thinking_mode/
      - https://api-docs.deepseek.com/guides/kv_cache/
      - https://api-docs.deepseek.com/api/create-chat-completion
      - pi-ai `deepseek.js` / `deepseek.json`
      - `packages/provider-zai/src/{index,provider,models,thinking}.ts`
    - Options Considered:
      - Also implement `/anthropic`: rejected (pi + YAGNI).
      - Strip old thinking to shrink prefix: rejected — 400 on tool turns.
      - Compaction gating inside provider: rejected — wrong layer.
    - Chosen Approach:
      - Z.AI-shaped package. Implicit cache. Canonical tools + required thinking replay are the cache/correctness work.
    - API Notes and Examples:
      ```ts
      const ds = createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY });
      // thinking off: compat { thinking: { type: "disabled" } }
      ```
    - Files to Create/Edit (tentative until Task 1):
      - `packages/provider-deepseek/{package.json,tsconfig.json,LICENSE,README.md,CHANGELOG.md}`
      - `packages/provider-deepseek/src/{index,provider,models,thinking,cache}.ts`
      - `packages/provider-deepseek/src/__tests__/{deepseek,index,live}.test.ts`
    - References:
      - `packages/provider-zai/**`; core `mapOpenAIChatUsage`.
  - Test Cases to Write:
    - featured catalog ids/cost/cache kind.
    - thinking enabled/disabled + effort map (medium→high).
    - tool-turn assistant includes `reasoning_content`; non-tool may omit.
    - tool schema key order stable under shuffled `properties`/`required`.
    - usage `prompt_cache_hit_tokens` → `cacheReadTokens`.
    - abort / HTTP error redacts key.
    - `listDeepSeekModels` not called from `createDeepSeekProviderPackage`.
    - live smoke gated `PRISM_LIVE_PROVIDER_TESTS=1` + `DEEPSEEK_API_KEY`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new provider package.
    - Docs pages to create/edit:
      - `docs/providers/deepseek.md`: full API page (What it does, When to use it, Inputs, Outputs, examples, cache, security, related).
    - `docs/index.md` update: yes — add DeepSeek under Provider packages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — `@arnilo/prism-provider-xai` (API key + SuperGrok OAuth)
  - Acceptance Criteria:
    - Functional: `createXaiProvider` / `createXaiProviderPackage` against `https://api.x.ai/v1`. Featured Completions: `grok-4.6`, `grok-4.3`, `grok-build-0.1`. `grok-4.5` / Responses deferred (Task 1). Image input where catalog declares it.
    - Functional: sanitized `x-grok-conv-id` from `cache.key ?? cacheKey ?? sessionId` via `sanitizeCacheKey`. No header when cache mode/retention is `off`/`none`. Reasoning replay required on reasoning models. `cached_tokens` maps to `cacheReadTokens` without inventing negative unused input.
    - Functional: `createXaiOAuthProvider(options?)` implements `OAuthProvider` id `xai`:
      - `login({ onDeviceCode, signal })` runs RFC 8628 via Task 2 helper: form-urlencoded, default client id `b1a00492-073a-47ea-816f-4c329264a828`, scope `openid profile email offline_access grok-cli:access api:access`, `referrer` default `prism`, endpoints `https://auth.x.ai/oauth2/device/code` and `https://auth.x.ai/oauth2/token`.
      - `onDeviceCode` receives https `verification_uri_complete` when present.
      - `refresh` POSTs form `grant_type=refresh_token`; if response omits `refresh_token`, keep the previous refresh token; `expires` applies a 5-minute skew (pi).
      - `revoke` POSTs form to `https://auth.x.ai/oauth2/revoke` (best-effort; local store delete still fail-closed via `revokeOAuthCredential`).
      - `getCredential` returns `{ type: "bearer", value: access }`.
    - Functional: `createXaiProviderPackage` registers `api_key` **and** `oauth`. Setup/import never login, never refresh, never read `~/.grok/**` or env. Host wires `apiKey` from `XAI_API_KEY` **or** from stored SuperGrok access (after explicit `login` / `refreshOAuthCredential`).
    - Functional: generate with a SuperGrok access token sends `Authorization: Bearer <access>` to `https://api.x.ai/v1/chat/completions` (same backend as API key). No `cli-chat-proxy.grok.com` unless Task 1 records a live-proven deviation.
    - Performance: streaming Completions; bounded OAuth and API error bodies; no retry loop; no refresh timer.
    - Code Quality: same skeleton as Task 3 plus `oauth.ts`. No `openai` / xAI SDK. Client id / endpoints / referrer overridable for tests and for a host-owned client.
    - Security: public client id is documented as not a secret. Device/user/access/refresh codes redacted. HTTPS verification URI only. No PKCE loopback. No grok-cli file scan. Provider headers win.
  - Approach:
    - Documentation Reviewed:
      - https://docs.x.ai/developers/advanced-api-usage/prompt-caching
      - https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits
      - https://auth.x.ai/.well-known/openid-configuration
      - https://docs.x.ai/build/overview (Grok Build subscription login)
      - pi-ai `dist/auth/oauth/xai.js`, `dist/providers/xai.js`
      - OpenCode `packages/opencode/src/plugin/xai.ts`
      - `packages/provider-openai/src/oauth.ts`, `docs/providers/openai.md`
    - Options Considered:
      - API-key-only (previous draft): rejected — user requires SuperGrok.
      - Register a Prism-owned xAI client first: rejected for 0.2.9 — xAI allowlists the published Grok-CLI public client for device-code; host may override later.
      - Hit `cli-chat-proxy.grok.com` with Grok-CLI identity headers: rejected unless live smoke proves `api.x.ai` rejects subscription tokens (pi and OpenCode use `api.x.ai`).
      - Ambient `~/.grok/auth.json` import: rejected (credential scan).
    - Chosen Approach:
      - One provider `xai`, two auth methods. Device-code SuperGrok login copies pi/OpenCode wire on top of Prism `OAuthProvider` + Task 2 helper. Completions + sticky conv-id + thinking replay.
    - API Notes and Examples:
      ```ts
      import { createXaiOAuthProvider, createXaiProvider } from "@arnilo/prism-provider-xai";
      import { refreshOAuthCredential } from "@arnilo/prism";

      const oauth = createXaiOAuthProvider();
      const creds = await oauth.login({
        onDeviceCode: ({ userCode, verificationUri }) => {
          console.log(`Open ${verificationUri} and enter ${userCode}`);
        },
        signal,
      });
      await store.set("xai", creds);

      const provider = createXaiProvider({
        apiKey: async () => {
          const current = await store.get("xai");
          const fresh = await refreshOAuthCredential({ provider: oauth, credentials: current, store });
          return fresh.access;
        },
      });
      ```
    - Files to Create/Edit:
      - `packages/provider-xai/{package.json,tsconfig.json,LICENSE,README.md,CHANGELOG.md}`
      - `packages/provider-xai/src/{index,provider,models,thinking,cache,oauth}.ts`
      - `packages/provider-xai/src/__tests__/{xai,oauth,index,live}.test.ts`
    - References:
      - Codex OAuth tests (`packages/provider-openai/src/__tests__/codex-oauth.test.ts`); OpenCode/pi form bodies.
  - Test Cases to Write:
    - conv-id present/absent/clamped; never a secret.
    - reasoning replay on assistant with thinking.
    - inclusive vs exclusive cached_tokens mapping.
    - image part rejected when model lacks image capability.
    - OAuth device-code: form body, client id, scope, `referrer=prism`, https complete URI surfaced.
    - pending / slow_down / denied / expired_token / abort / http verification URI rejected.
    - refresh keeps previous refresh token when omitted; applies skew; redacts tokens.
    - revoke posts form to revoke endpoint; missing endpoint/token is a no-op.
    - package setup does not fetch, login, or read files.
    - generate with OAuth access uses Bearer on `api.x.ai`.
    - live API-key smoke `PRISM_LIVE_PROVIDER_TESTS=1` + `XAI_API_KEY`.
    - SuperGrok live login stays operator-only (`PRISM_LIVE_XAI_OAUTH=1`); default CI never waits on a browser.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new provider package and the second first-party subscription OAuth flow.
    - Docs pages to create/edit:
      - `docs/providers/xai.md`: full API page including SuperGrok login, refresh, revoke, cache header, OAuth security.
      - `docs/provider-packages.md`: add xAI row to the subscription OAuth matrix.
      - `docs/credentials-and-redaction.md` / `docs/credential-storage.md`: SuperGrok is authorized; still no Claude/Gemini/grok-cli file import.
    - `docs/index.md` update: yes — add xAI under Provider packages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — `@arnilo/prism-provider-clinepass`
  - Acceptance Criteria:
    - Functional: `createClinePassProvider` / `createClinePassProviderPackage` at `https://api.cline.bot/api/v1`, model ids are official `cline-pass/…` slugs from Task 1. Always `stream: true`.
    - Functional: per-model thinking maps (Task 1 copies pi-clinepass + official). Implicit cache. No Anthropic `cache_control`. No WorkOS.
    - Functional: no `listClinePassModels` (Task 1: no documented OpenAI `GET /models`; community 404). Static `cline-pass/*` catalog only.
    - Performance: streaming only; bounded errors.
    - Code Quality: same skeleton; no Cline SDK.
    - Security: `CLINE_API_KEY` via caller `apiKey`; non-stream `data` wrap documented as unsupported.
  - Approach:
    - Documentation Reviewed:
      - https://docs.cline.bot/getting-started/clinepass
      - https://github.com/jellydn/pi-clinepass-provider
      - https://github.com/cline/cline/issues/12647
    - Options Considered:
      - Parse non-stream `{data,success}`: rejected — Prism streams.
      - Share Cline OAuth store: rejected.
    - Chosen Approach:
      - Thin OpenAI-compatible gateway package + static featured catalog.
    - API Notes and Examples:
      ```bash
      curl -X POST https://api.cline.bot/api/v1/chat/completions \
        -H "Authorization: Bearer $CLINE_API_KEY" \
        -d '{"model":"cline-pass/deepseek-v4-flash","stream":true,"messages":[...]}'
      ```
    - Files to Create/Edit:
      - `packages/provider-clinepass/{package.json,tsconfig.json,LICENSE,README.md,CHANGELOG.md}`
      - `packages/provider-clinepass/src/{index,provider,models,thinking}.ts`
      - `packages/provider-clinepass/src/__tests__/{clinepass,index,live}.test.ts`
    - References:
      - `packages/provider-openrouter` as multi-upstream-model catalog precedent.
  - Test Cases to Write:
    - every featured slug registered once.
    - thinking map per family (DeepSeek high/off, GLM, Kimi as documented).
    - stream path only; fixture that a non-stream `data` wrapper is not parsed.
    - live smoke `CLINE_API_KEY`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new provider package.
    - Docs pages to create/edit:
      - `docs/providers/clinepass.md`.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Cache matrix, thinking docs, provider-packages matrix
  - Acceptance Criteria:
    - Functional: `docs/provider-caching.md` gains DeepSeek / xAI / ClinePass rows (kind, explicit hints, multi-turn notes, caveats). `docs/provider-packages.md` Phase 10 matrix + first-party cache bullets + OAuth matrix updated. `docs/thinking-and-reasoning.md` notes DeepSeek tool-turn replay and xAI reasoning replay.
    - Performance: docs only.
    - Code Quality: tables stay generic (`implicit` / `openai_key`); no vendor branching in core.
    - Security: cache keys never secrets; conv-id sanitized; SuperGrok tokens never used as cache keys.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-caching.md`; `docs/provider-packages.md`; `docs/thinking-and-reasoning.md`.
    - Options Considered:
      - New `cache.kind: "sticky_header"`: rejected — xAI header is package-local `extraHeaders`.
    - Chosen Approach:
      - DeepSeek/ClinePass = `implicit`. xAI = `openai_key` (session id → sticky header).
    - API Notes and Examples:
      ```ts
      await session.run(prompt, { inputLayout: "cache_aware", cache: { key: sessionId } });
      ```
    - Files to Create/Edit:
      - `docs/provider-caching.md`, `docs/provider-packages.md`, `docs/thinking-and-reasoning.md`
      - `src/__tests__/docs.test.ts`: tripwire tokens for the three providers + SuperGrok.
    - References:
      - Task 3–5 decision records.
  - Test Cases to Write:
    - docs test: `x-grok-conv-id`, `prompt_cache_hit_tokens`, `cline-pass/`, `reasoning_content`, `auth.x.ai` present on the right pages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents new provider cache and OAuth behavior.
    - Docs pages to create/edit: the three files above.
    - `docs/index.md` update: no (existing entries).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — `@arnilo/prism-impeccable`
  - Acceptance Criteria:
    - Functional: `createImpeccableExtension(options)` requires `upstreamPath` (Task 1: npm `impeccable` is the detector CLI, not a skill tree). Fail-closed without a readable `SKILL.md` (compiled checkout, e.g. `dist/universal/impeccable` or host-linked skills dir). Registers skill `impeccable` plus command `impeccable` that dispatches `load_skill`. Do not invent 23 Prism-native commands.
    - Functional: does not spawn browsers, does not run the detector CLI, does not write `PRODUCT.md`/`DESIGN.md` itself.
    - Performance: O(skills dir) bounded reads; `MAX_SKILL_FILE_BYTES` 256 KiB.
    - Code Quality: copy Caveman resolve/redact/path-escape helpers. No optional peer. Add name to `PRISM_FAMILY` in `scripts/package-truth.mjs`.
    - Security: path escape rejected; errors redacted; no `npx` / hook install.
  - Approach:
    - Documentation Reviewed:
      - https://github.com/pbakaus/impeccable README + SKILL.md
      - `packages/prism-ponytail/src/{extension,upstream,skills,commands}.ts`
      - `docs/ponytail.md`, `docs/caveman.md`
    - Options Considered:
      - Shell out to `npx impeccable`: rejected (network, implicit install).
      - Vendor skill bodies: rejected (Ponytail/Caveman rule).
      - Live-mode protocol in core: rejected (host + `@arnilo/prism-browser`).
    - Chosen Approach:
      - Thin contribution package. Host points at an impeccable checkout (or future peer).
    - API Notes and Examples:
      ```ts
      createImpeccableExtension({
        upstreamPath: "/path/to/impeccable",
        getEntries, appendEntry,
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-impeccable/{package.json,tsconfig.json,LICENSE,README.md,CHANGELOG.md}`
      - `packages/prism-impeccable/src/{index,extension,upstream,skills,commands,types}.ts`
      - `packages/prism-impeccable/src/__tests__/*.test.ts`
      - `packages/prism-impeccable/fixtures/upstream-minimal/skills/impeccable/SKILL.md`
      - `scripts/package-truth.mjs`: add `@arnilo/prism-impeccable` to `PRISM_FAMILY`.
      - `docs/impeccable.md`
    - References:
      - plan 005 Caveman/Ponytail packages.
  - Test Cases to Write:
    - missing upstream fails closed, zero registrations.
    - path escape rejected.
    - skill name `impeccable`; command dispatches `load_skill`.
    - oversized SKILL.md rejected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new behavior package.
    - Docs pages to create/edit:
      - `docs/impeccable.md`: full API page.
    - `docs/index.md` update: yes — Third-party integrations, next to Ponytail/Caveman.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — Ponytail 4.9.0
  - Acceptance Criteria:
    - Functional: peer `@dietrichgebert/ponytail` is `^4.9.0`. Bare `/ponytail` (empty args) reports current+default mode and does **not** change mode (4.9.0). `default <mode>` and explicit `lite|full|ultra|off` unchanged.
    - Functional: required skill set still the six names; fixtures still parse.
    - Performance: no new IO.
    - Code Quality: smallest command-parser diff (`parsePonytailCommand` empty → `{ type: "status" }`).
    - Security: config write bounds unchanged.
  - Approach:
    - Documentation Reviewed:
      - https://github.com/DietrichGebert/ponytail/releases/tag/v4.9.0
      - `packages/prism-ponytail/src/commands.ts` empty-text branch
    - Options Considered:
      - Vendor 4.9.0 files: rejected.
    - Chosen Approach:
      - Empty parse → status instead of set-mode.
    - API Notes and Examples:
      ```ts
      // 4.9.0
      /ponytail          → status
      /ponytail default full
      /ponytail lite
      ```
    - Files to Create/Edit:
      - `packages/prism-ponytail/package.json` peer
      - `packages/prism-ponytail/src/commands.ts`
      - `packages/prism-ponytail/src/__tests__/ponytail.test.ts`
      - `docs/ponytail.md`, `packages/prism-ponytail/README.md`, `CHANGELOG.md`
    - References:
      - upstream 4.9.0 notes.
  - Test Cases to Write:
    - empty args → status, mode unchanged.
    - explicit mode still sets.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — command semantics.
    - Docs pages to create/edit: `docs/ponytail.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — Caveman v2.1.0 skills
  - Acceptance Criteria:
    - Functional: core seven skills still required. Additional upstream dirs that contain `SKILL.md` register as optional skills/commands. Dirs without `SKILL.md` (engine junk: `*.mjs`, `registry.json`, `generated/`) are skipped, not fatal.
    - Functional: Caveman 2 compression proxy/engine is **not** a Prism runtime. Docs say so.
    - Performance: still O(skills dir), bounded reads.
    - Code Quality: keep "require core + register extras"; do not hard-code a 20-name list.
    - Security: same path/size/redact rules.
  - Approach:
    - Documentation Reviewed:
      - https://github.com/JuliusBrussee/caveman/releases (v2.0.0, v2.1.0)
      - `packages/prism-caveman/src/skills.ts` (already scans every skills dir)
    - Options Considered:
      - Adopt Caveman 2 engine as a package: rejected (proxy product).
      - Keep only the original 7 and ignore extras: rejected — user asked latest.
    - Chosen Approach:
      - Require original 7; register every other `skills/*/SKILL.md`; skip missing files.
    - API Notes and Examples:
      ```ts
      // required: caveman, caveman-commit, caveman-review, caveman-stats,
      //           caveman-compress, caveman-help, cavecrew
      // extras if present: caveman-discover, caveman-explore, …
      ```
    - Files to Create/Edit:
      - `packages/prism-caveman/src/{skills,commands}.ts`
      - `packages/prism-caveman/src/__tests__/*`
      - `packages/prism-caveman/fixtures/**` if needed for extras/skip
      - `docs/caveman.md`, README, CHANGELOG
    - References:
      - v2.1.0 `skills/` listing.
  - Test Cases to Write:
    - missing core skill fails closed.
    - extra `SKILL.md` registers; dir without `SKILL.md` is ignored.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — registered skill set may grow.
    - Docs pages to create/edit: `docs/caveman.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 10 — Umbrella, package-truth, examples, 0.2.9 release cut
  - Acceptance Criteria:
    - Functional: three providers added to `@arnilo/prism-providers`. Impeccable omitted from `prism-all`. `scripts/package-truth.mjs` regenerated; counts 55 publishable / provider 17 / family 10. All manifests **0.2.9** exact peers. `docs/migration.md` 0.2.8→0.2.9: compatible, no store migration; SuperGrok OAuth is additive.
    - Functional: one example per new provider (offline mock), one SuperGrok login example (mocked fetch), one impeccable kernel example.
    - Performance: `sdk:ready` + `release:check` green; pack dry-run 55/55; audit 0 moderate; additive compat only.
    - Code Quality: package-truth tests updated; client-neutrality still green.
    - Security: live tests remain env-gated; no secrets in fixtures; SuperGrok live login is `protected` in the skip manifest, never a silent pass.
  - Approach:
    - Documentation Reviewed:
      - `scripts/package-truth.mjs`, `docs/release-and-install.md` Decision A, plan 024/028 exit gates.
    - Options Considered:
      - Put Impeccable in `prism-all`: rejected (optional upstream, like Ponytail).
      - Independent versions: rejected (0.2.x atomic).
    - Chosen Approach:
      - Same release-cut ritual as 0.2.8 with +4 packages.
    - API Notes and Examples:
      ```bash
      node scripts/package-truth.mjs
      npm run sdk:ready
      npm run release:check
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/package.json` + README
      - `package.json` version
      - `scripts/package-truth.json` (generated)
      - `docs/index.md`, `docs/migration.md`, `docs/release-and-install.md`, `CHANGELOG.md`, root `README.md`
      - `examples/provider-deepseek.ts`, `examples/provider-xai.ts`, `examples/provider-xai-oauth.ts`, `examples/provider-clinepass.ts`, `examples/impeccable.ts`
      - every workspace `package.json` version/peer bump via existing release script
    - References:
      - `docs/release-and-install.md` 0.2.8 publish handoff.
  - Test Cases to Write:
    - package-truth: 55 manifests, 17 providers, family 10, impeccable not in prism-all, three new names in prism-providers.
    - packed consumer: new packages resolve `@arnilo/prism@0.2.9`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — catalog/umbrella/version.
    - Docs pages to create/edit: index, migration, release-and-install, CHANGELOG, README.
    - `docs/index.md` update: yes — current-line 0.2.9 + new links.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- SuperGrok uses the published Grok CLI public client id (host-overridable). Device-code only.
- Cline WorkOS, DeepSeek `/anthropic`, grok-4.5/Responses, Caveman 2 engine, Impeccable live/detector deferred as planned.
- Historical phase27 freeze budget stays 51; current graph asserted by phase24-truth + phase29.

- Known up front (not post-execution):
  - SuperGrok uses the published Grok Build / Grok CLI public client id by default (host-overridable). Prism does not register a separate xAI app in this cut.
  - Device-code only. PKCE loopback deferred (xAI rejects non-allowlisted loopback clients).
  - Cline WorkOS, DeepSeek `/anthropic`, grok-cli `auth.json` scan, Muse/Cordis, Caveman 2 engine, Impeccable live/detector, independent package versions, and the other 0.2.9 roadmap leftovers stay out.
  - xAI Responses / `grok-4.5` deferred unless Task 1 proves Completions cannot serve it.

## Further Actions

- Operator publication: signed `v0.2.9` + npm OIDC after `sdk:ready` / `release:check` on a clean tree.
- Compat baseline `--update-baseline` at gate time (additive provider/OAuth/impeccable exports + version literal).
- grok-4.5/Responses, Cline WorkOS, Impeccable live detector if demanded.
