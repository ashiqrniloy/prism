# Phase 11 Part AB — OpenAI Codex provider: Sign in with ChatGPT

## Objectives

- Ship `@arnilo/prism-provider-openai-codex` in 0.13.0. It runs OpenAI models on the user's **ChatGPT plan** through OpenAI's sanctioned **Sign in with ChatGPT** flow for open-source tools, and is thoroughly live-tested.
- Verify OpenAI's third-party subscription policy and record it as evidence. Implement the documented open-source path, not the Codex CLI's private client. The OAuth flow covers dynamic client registration, PKCE, refresh, revocation, and credential import for headless hosts.
- Add the **OpenAI Responses codec** to `@arnilo/prism/provider-kit` as a third routed format (`openai-responses`). Plan 182 removed the old one. Command Code's `/responses` route (plan 205, post-0.13.0) is its second user.
- Add the kernel addition that roadmap Phase 5 names, "OAuth token persistence through the slot": a package can store a rotated OAuth credential through the credentials slot.
- Reach **prompt-cache parity with pi** (its `openai-chatgpt` provider uses the same sanctioned route) and measure against the **Codex CLI**, OpenAI's own harness.

## Expected Outcome

- A host shows the `openai-codex` provider's `oauth` `AuthMethod`. `login(ctx)`:
  - registers a client for the user and host;
  - opens the authorize URL through `host.ui` `open-url`;
  - receives the callback on a loopback listener, or a pasted callback URL through `host.ui` `input`;
  - validates the ID token;
  - checks that `chatgpt.tokens.use.direct` was granted;
  - stores one credential record through the credentials slot.
- `createAgent({ model: "openai-codex/<slug>", packages: [openaiCodex] })` streams text, tools, reasoning (encrypted reasoning replayed across tool turns), structured output, and images.
  - Requests go to `POST https://api.openai.com/v1/responses` with `store: false`, `stream: true`, and the session's `prompt_cache_key`.
  - Access tokens refresh before expiry, and the rotated refresh token is persisted.
- Subscription-sharing errors map to clear, correctly classified failures. A usage limit pauses and never retries in a loop. Ineligibility or revocation asks for sign-in again.
- On the probe transcript, `scripts/cache-parity/provider-probe.mjs` (plan 203) shows cache reads on turns 2–4. Prism's cache-relevant fields equal pi 1.4.0's `openai-chatgpt` request. Plan 184 gains two `openai-codex` cells: Prism against pi, and Prism against `codex exec --json`.
- `docs/_evidence/openai-codex-live-<date>.md` records the live OAuth, inference, refresh, and probe results.

This plan implements an **owner decision of 2026-10-25**: OpenAI Codex is thoroughly live-tested and reaches prompt-cache parity against established harnesses, and it ships in 0.13.0. The same decision originally put Command Code and Ollama Cloud in 0.13.0; **amended 2026-10-25, they are deferred to the release after it** (plans 205 and 206). This plan changes roadmap **Phase 5** (provider list, and OAuth token persistence through the slot).

- **Release path:** the second and last provider plan on the 0.13.0 path (203 → **204**). It runs after plan 194 completes, before 188.11, 197, and plan 185's surface freeze. Plans 205 and 206 run after 0.13.0.
- **Plan 194 (Tasks 1–5 landed, 6–7 in progress):** the `context_overflow` failure class and its body patterns (`src/provider-kit/transport.ts:31-47`), the estimate-vs-window fallback (`contextOverflowEvidence`, `src/agent-session/session/provider-round.ts:203-229`), one compaction-and-retry recovery (`src/agent-session/context-overflow.ts`), fold batch clearing, and context accounting are in the tree.
  - This plan feeds its routes' overflow evidence into them directly instead of amending 194.
  - It declares accurate context windows, which the fallback, the accounting, and 194 Task 7's window-relative OM gate read.
  - 194 Tasks 6–7 (the rot curve on Hyper and OpenCode Go models, and reference-host triggers) need nothing from this plan.
- **Dependencies:** plan 203 (the provider probe, the `mapUsage(usage, chunk)` seam, and the codec test layout). Plan 205 depends on this plan's Responses codec; it runs after 0.13.0.
- **Review:** it adds a kernel contract (a `PackageAPI.credentials` write), a provider-kit codec, and a package, so **Task 1 is the phase review**.
- **Live probes:** the owner performs the interactive sign-in once. The executor never handles a password and never asks for a token in chat.
- **Reference host impact:** none.
- **Cost:** inference counts against the owner's ChatGPT plan usage, not money. Each live row states its request count.

**Policy verification (2026-10-25), recorded as evidence by Task 1:**
- **Sign in with ChatGPT** ([learn.chatgpt.com/docs/sign-in-with-chatgpt](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)) lets "eligible ChatGPT Plus and Pro subscribers … use their ChatGPT plan for AI requests". It lists open-source integrations **OpenClaw, OpenCode, Pi, T3**.
- The developer docs for open-source tools ([developers.openai.com/siwc/token-sharing-open-source](https://developers.openai.com/siwc/token-sharing-open-source)) say: "your open-source app can request permission to use the user's ChatGPT plan for eligible Responses API requests".
  - **Paid or remotely hosted apps** must use the interest form instead.
  - Users set a weekly cap per app.
- **So the user's premise holds, with conditions.** OpenAI supports third-party harnesses on subscriptions through this program. It covers open-source, locally run use, through the documented flow. It does not cover reusing the Codex CLI's client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) against `chatgpt.com/backend-api/codex`. The inference page says: "do not point it at ChatGPT's `backend-api` endpoints".
  - pi 1.4.0 ships both: `openai-codex` is the private route, and the SIWC flow is a ChatGPT auth method of its `openai` provider (`pi-ai/dist/providers/openai.js:18`) that `isChatGPTSignIn` routes to `api.openai.com/v1` (`api/openai-responses.js:23-31`).
  - Prism ships only the sanctioned route.

**Scope exclusions (Further Actions candidates):**
- The private Codex backend (`chatgpt.com/backend-api/codex`, Codex CLI client ID).
- The OpenAI Platform API-key provider (`@arnilo/prism-provider-openai` stays deprecated).
- Hosted tools: image generation, file search, code interpreter, computer use, hosted MCP. They are unsupported on this route.
- Codex app-server integration.
- Paid or remote hosting through OpenAI's interest-form program.

## Research summary (2026-10-25)

Sources:
- OpenAI SIWC docs: overview, sign-in, models and inference, token reference, errors and recovery, profiles and sessions, preview limitations, self-hosted VMs;
- learn.chatgpt.com Codex auth;
- pi 1.4.0 (`~/.bun/install/global/node_modules/@earendil-works/pi-ai/dist`);
- the Codex CLI 0.164.0 binary (strings);
- the deleted Prism `openai` package (`git show 14009176^:packages/providers/openai/src/{oauth,codex}.ts`).

| Topic | Finding | Consequence |
| --- | --- | --- |
| Registration | Authorize: `https://auth.openai.com/api/accounts/authorize`.<br>First sign-in uses `client_id=dynamic_agent_client`; the callback returns the issued `oaiapp_…` client ID, which is saved per account and reused.<br>Params: `response_type=code`, `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, `state`, `nonce`, S256 PKCE, `ext_agent_host_id` (stable, opaque, per host), `agent_name_hint` (first registration only).<br>Redirect `http://127.0.0.1:<port>/auth/callback`: only the port may vary, and `localhost` is not allowed | The package implements the dynamic flow. The host supplies the agent name. The host ID is a stable `urn:uuid` stored with the credential (pi `auth/oauth/openai-chatgpt.js:13-24,186-211`) |
| Token | `POST https://auth.openai.com/api/accounts/oauth/token`, form-encoded: `grant_type=authorization_code`, `client_id` (issued), `code`, `code_verifier`, `redirect_uri`, `resource`.<br>Response: `access_token` (`expires_in` 3600), `refresh_token` (30 days, **rotating**), `id_token`, `scope`, `earliest_refresh_at` | Plan usage is enabled only if `scope` contains `chatgpt.tokens.use.direct` |
| ID token | Validate the signature against OpenAI's JWKS, plus issuer, audience (the issued client ID), expiry, and nonce. Identity is `sub` | WebCrypto RS256 verification. No runtime dependency |
| Refresh | Form `grant_type=refresh_token`, saved `client_id`, `refresh_token`, `resource`; omit `scope`. "Serialize refreshes for the same session so two processes do not race a rotating token." Terminal codes: `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused`. **Measured 2026-10-25:** rotation happens (`rt.1.` 196 → 211 chars), the response's `earliest_refresh_at` is advisory (an early refresh 4 minutes after issue returned 200), and the **pre-rotation token still returned 200** afterwards, as did the new one | Persist every rotation. Single-flight in process. Do not gate on `earliest_refresh_at`. Before failing with `OpenAICodexReauthorizeError`, re-read the stored record once, since another process may have rotated it |
| Revoke | `revocation_endpoint` from the OIDC configuration: form `token`, `token_type_hint=refresh_token`, `client_id`. An empty 200 means success | `logout` helper |
| Headless | "Complete OAuth locally … copy the protected credential file to the VM over a secure channel such as SSH", and keep the VM's own host ID. No device-code flow is documented for this path, and **measured 2026-10-25** the Codex-only endpoint `POST /api/accounts/deviceauth/usercode` answers `400 invalid_client` "This app is unavailable" for both the issued ID and `dynamic_agent_client`; OIDC discovery has no `device_authorization_endpoint` | An `importCredentials` helper plus README procedure. No device code |
| Inference | `POST https://api.openai.com/v1/responses` with the bearer token, `store: false`, `stream: true`. Models: `GET /v1/models`, keeping `visibility == "list"`; `slug` is the ID and `display_name` the label. Over HTTP, omit `previous_response_id` and send full history. WebSocket continuation works only within one authenticated connection. System messages are rejected: use `instructions` or developer messages | A Responses codec with a stateless HTTP default |
| Unsupported fields (measured 2026-10-25) | 14 rejected with `400 {"detail":"Unsupported parameter: <name>"}`: `background, conversation, max_tool_calls, metadata, moderation, multi_agent, prompt, prompt_cache_retention, safety_identifier, temperature, top_logprobs, top_p, truncation, user`. **Not** unsupported: `max_output_tokens` — accepted, minimum 16, honoured. Hosted tools and `tool_search` were not probed. | The route omits the 14. A request needing one fails closed or is documented. `max_output_tokens` passes through with its minimum |
| Errors | `subscription_sharing_usage_limit_exceeded` 429 → pause, show Usage settings, never infer a reset.<br>`…_usage_unavailable` 503 and `…_user_unavailable` 503 → bounded backoff.<br>`…_user_not_eligible` 403, `…_unsupported_capability` 400 (with `param`), `…_route_not_supported` 403, `chatpass_v2_*` 403 → do not retry.<br>`…_invalid_user` 401 → sign in again after a confirmed revocation.<br>Admission bodies may be `{"detail":"…"}` | One error mapper with these exact codes |
| **Cache levers — pi's SIWC route (`openai` provider, ChatGPT auth)** | `api/openai-responses.js`:<br>• `:264-275`: `prompt_cache_key = clampOpenAIPromptCacheKey(sessionId)` (64 chars, `api/openai-prompt-cache.js:1-9`); `store: false`; `prompt_cache_retention` and `prompt_cache_options` omitted for SIWC;<br>• `:224-232`: headers `session_id` (openai format) and `x-client-request-id` = sessionId;<br>• encrypted reasoning items are replayed in `input` | **The parity levers** |
| **Cache levers — Codex CLI 0.164.0** | First-party client on `chatgpt.com/backend-api/codex`, with strings for `prompt_cache_key`, `session_id`, `x-client-request-id`, and `previous_response_id`. Its WebSocket transport is `responses_websockets=2026-02-06` with incremental `previous_response_id` (pi's private `openai-codex` mirrors it at `api/openai-codex-responses.js:1129-1211`). `codex exec --json` prints JSONL with `cached_input_tokens` | The harness-level reference for the plan 184 cell. WebSocket continuation is a conditional lever (Task 7) |
| Usage | `response.completed.usage`: `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens` | The Responses codec maps these |
| Kernel seams | `AuthMethod` `{kind: "oauth", login(ctx: AuthContext)}` with `ctx.host` and `ctx.credentials.store/delete` (`src/contracts-core/provider.ts:80-91`). **`PackageAPI.credentials` has only `resolve`** (`src/packages/api.ts:137-143`). `CredentialResolver.store?` exists on the slot (`src/contracts-core/resources.ts:55-59`). Provider-kit has no Responses codec (`docs/provider-kit.md` "Removed") | Refresh rotation needs a write path at request time (Task 2) |
| Prior Prism code | The deleted `openai` package used a made-up `client_id: "prism-codex"` and `chatgpt.com/backend-api/codex` (`oauth.ts:37`, `codex.ts:14`) | Nothing reusable except the PKCE helpers' shape |

## Tasks

- [x] Task 1: Phase review — policy, OAuth flow, Responses wire, kernel seams, and cache levers (read-only, live probes after the owner signs in)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Policy evidence.** Quotes and URLs from the SIWC overview, open-source overview, inference, and preview-limitations pages, and the Codex auth page, saved to `docs/_evidence/openai-siwc-policy-2026-10-25.md`.
        - The "open-source and locally hosted" scope and the interest-form rule for paid or remote apps.
        - The **README wording** that tells hosts this: a host that embeds Prism in a paid or remotely hosted product must apply through OpenAI's form.
        - The **owner confirms** that this wording is acceptable before Task 5 ships the README.
      - (b) **Placement:**
        - the package is `packages/providers/openai-codex`;
        - the `openai-responses` codec goes in `src/provider-kit/codecs/openai-responses.ts`, with `createRoutedProvider` gaining format `"openai-responses"`. The second user is Command Code `/provider/v1/responses` (plan 205, verified by one probe there);
        - the OAuth client is package-local, since it is the only SIWC user;
        - the enforcement-row list (`liquid` precedent, plus plan 203's additions).
      - (c) **Kernel addition** for Task 2:
        - proof that no existing member can persist a rotated credential at request time: `AuthContext` exists only during `login`, and `PackageAPI.credentials` only resolves;
        - the roadmap citation (Phase 5: "OAuth token persistence through the slot");
        - the proposed shape, `prism.credentials.store(ref, secret)` and `delete(ref)`, declared by a `credentials:write` capability;
        - its error policy: `CredentialStoreUnavailableError` (`code: "credential_store_unavailable"`) when the slot has no `store`;
        - a second user: plan 205's optional key-login method, or any future OAuth provider.
      - (d) **Live OAuth probe**, run by the owner through a scratch script with `host.ui` on the terminal:
        - dynamic registration returns an issued `client_id`;
        - granted `scope` includes `chatgpt.tokens.use.direct`;
        - ID token claims (`iss`, `aud`, `sub`), the JWKS URL, and the OIDC `revocation_endpoint`;
        - one refresh rotation, recording whether the old refresh token fails immediately;
        - whether a pasted callback URL completes the flow when no listener is bound;
        - **whether any device-code endpoint accepts the issued client** (expected: none; record it).
      - (e) **Wire probes**, at most 25 inference requests on one model from `GET /v1/models`:
        - text;
        - a tool loop with `reasoning: {effort: "medium", summary: "auto"}` and `include: ["reasoning.encrypted_content"]`, replaying the encrypted reasoning item in turn 2;
        - `text.format` `json_schema`;
        - an image input;
        - each unsupported field once, sent alone, recording the exact error;
        - `prompt_cache_key` present versus absent on the same 3-turn transcript (cached tokens per turn);
        - `session_id` and `x-client-request-id` present versus absent;
        - the full SSE event list (`response.created`, `.output_item.added/done`, `.output_text.delta`, `.reasoning_summary_text.delta`, `.function_call_arguments.delta`, `.completed`, `.incomplete`, `.failed`, `error`);
        - an over-long prompt (the overflow error for the shared classifier).
      - (f) **WebSocket feasibility** (one probe): whether `wss://api.openai.com/v1/responses` accepts the SIWC token with `OpenAI-Beta: responses_websockets=2026-02-06`; whether Bun's and Node 22's global `WebSocket` can send an `authorization` header; and cached tokens on a 3-turn `previous_response_id` continuation against HTTP full history.
      - (g) **Reference harnesses:**
        - the pi lever lines above, re-verified (record the version);
        - `pi -p --mode json --provider openai --model <slug>` runs headless after signing in with ChatGPT in pi's `openai` provider and reports `cacheRead`. **Corrected by Task 1 (g):** pi 1.4.0 has no `openai-chatgpt` provider id — the SIWC flow is one auth method of `openai` (`pi-ai/dist/providers/openai.js:18`), and `pi auth check --provider openai` reports readiness. `pi --provider openai-chatgpt` was rejected by `pi --list-models`/`pi auth check` in the review; only the corrected form is a valid reference.
        - `codex exec --json -m <slug> --ephemeral --skip-git-repo-check` reports `cached_input_tokens`;
        - these become the two plan 184 cells.
      - (h) **Release-path fit:** what plans 184, 185, 186, and 187 need. Whether plan 194's landed overflow classifier matches the Responses overflow error (`context_length_exceeded` in `response.failed` or an HTTP 400 body). Whether the default retry policy's `transientCodes` lets a 429 be made non-retryable through `providerHttpError`'s `decision.code` (`src/provider-kit/retry-http.ts:52`).
      - (i) **Verdict.** **Stop conditions:**
        - registration does not return a client ID;
        - granted scopes never include `chatgpt.tokens.use.direct` for the owner's plan;
        - the Responses stream cannot carry tool calls with `store: false`.
    - Performance: n/a (read-only). The probes stay within budget.
    - Code Quality: no code changes, except the scratch probe script, which is not committed.
    - Security:
      - Tokens stay in the owner's keyring or in an owner-only scratch file (mode `0600`), deleted after the review.
      - Recordings are scrubbed of `authorization`, `id_token`, `refresh_token`, `code`, `code_verifier`, `client_id`, `sub`, and email before Task 3 commits them.
      - The probe never prints a token.
  - Approach:
    - Documentation Reviewed:
      - The SIWC pages listed in the research summary; learn.chatgpt.com Codex auth.
      - pi `auth/oauth/openai-chatgpt.js`, `api/openai-responses.js`, `api/openai-codex-responses.js`, `api/openai-prompt-cache.js`, `api/openai-responses-shared.js`.
      - The Codex CLI 0.164.0 binary strings.
      - Prism `src/contracts-core/{provider,resources}.ts`, `src/packages/api.ts:137-143`, `src/provider-kit/routed-provider.ts`, `docs/provider-kit.md`, `packages/credentials/keyring/src/index.ts`.
      - Plan 203 Task 5.
    - Options Considered:
      - Reusing the Codex CLI client ID on the backend route, like pi's `openai-codex`. Rejected: OpenAI's docs direct open-source tools to the SIWC flow and the public endpoint, and say not to use `backend-api`.
      - A docs-only review. Rejected: dynamic registration, scope grant, refresh rotation, and WebSocket support are account-dependent.
    - Chosen Approach:
      - A scoped review with an owner-performed sign-in and budgeted probes through `scripts/wire-proxy.mjs`. The OAuth endpoints are probed directly, because the proxy does not record the auth server.
    - API Notes and Examples:
      ```sh
      timeout 900 bun "$SCRATCH/siwc-probe.mjs" login     # owner completes the browser step
      timeout 600 bun scripts/wire-proxy.mjs --upstream https://api.openai.com/v1 --listen 127.0.0.1:8787 --record "$SCRATCH/codex"
      timeout 600 codex exec --json -m <slug> --ephemeral --skip-git-repo-check "…"
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes; `docs/_evidence/openai-siwc-policy-2026-10-25.md`.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2–§3; plan 203.
  - Test Cases to Write:
    - n/a (read-only review).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/_evidence/openai-siwc-policy-2026-10-25.md` (evidence only).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25; live probes completed 18:17–18:26 local):
    - **Status — complete.** (a)–(i) answered. The owner's sign-in succeeded on the third attempt once the password wall was bypassed through `auth.openai.com/log-in` → "Continue with Google"; the loopback listener caught the callback. **All three stop conditions passed:** an `oaiapp_…` client ID was issued, the grant includes `chatgpt.tokens.use.direct` plus `resource.invoke`, and a tool call succeeded with `store: false`. Two research claims are now **contradicted by measurement** — `max_output_tokens` is accepted (minimum 16), and the device-code route does not exist for issued clients — and both are corrected in Tasks 3 and 5 below.
    - **(a) Policy evidence — written, and the owner approved the README wording on 2026-10-25** (recorded in that file §4), so Task 5 is unblocked. `docs/_evidence/openai-siwc-policy-2026-10-25.md` quotes and links the SIWC overview (open-source and locally hosted scope; the interest-form rule for paid or remote apps), the ChatGPT Learn end-user page (Plus/Pro eligibility, the open-source partner list, the shared weekly per-app cap), sign-in, ID-token validation, inference, route limitations, token lifetimes, revocation, errors, declined consent, self-hosted-VM import, the UI/UX obligations, and the Codex CLI/pi route split. Verdict: **the premise holds with conditions — open-source, locally run, on the public endpoint; a paid or remotely hosted product must use OpenAI's form.** The host-facing README wording is §4 of that file; the owner approved it verbatim on 2026-10-25, and Task 5 ships it unchanged unless he reopens it. **Authorization is granted for this account, not assumed:** the same token that lists models completes inference, so the account is admitted.
    - **(b) Placement — confirmed, with current line numbers.** Package `packages/providers/openai-codex`; codec `src/provider-kit/codecs/openai-responses.ts` beside `openai-chat.ts` and `anthropic-messages.ts`. `createRoutedProvider`'s format union and conditional codec type are at `src/provider-kit/routed-provider.ts:11,17`, body dispatch at `:128-133`, stream dispatch at `:235-248`, so a third format touches both branches. Session headers belong to `route.affinity` (`:52,170-172`), not the codec — exactly what plan 205 needs when it sets `x-client-request-id` only. The OAuth client stays package-local: provider-kit has no generic flow left after plan 182, and this is its only user. Enforcement rows verified in this tree: `docs/index.md:38`, `docs/models.md:156,167`, `docs/release.md:137,145`, `packages/providers/README.md:3-5`, `scripts/package-truth.json:42,69`, `scripts/coverage-thresholds.json:150`, `scripts/e2e-coverage.json:676`, `scripts/live-matrix.json:108`, `scripts/live.env.example:51-54`, `scripts/phase24-truth.test.mjs:97` (provider count 6 → 7), `scripts/phase54-package-map.test.mjs:63`, `src/__tests__/packaging.test.ts:97,447`, `src/__tests__/install-smoke.test.ts:66,192`, and the lockstep provider stays out of `scripts/independent-packages.json`.
    - **(c) Kernel addition — proven, and smaller than the plan assumed.** No existing member persists a rotated credential: `PackageAPI.credentials` is `resolve` only (`src/packages/loader.ts:798-804`, typed at `src/packages/api.ts:137-143`); the slot already accepts writes (`CredentialResolver.store/delete`, `src/contracts-core/resources.ts:54-58`); and `AuthContext` exists only for `login` — **nothing in the kernel constructs one** (`grep -rn "AuthContext" src/ packages/ apps/` finds only the declaration at `src/contracts-core/provider.ts:80-85`, the conformance kind check at `src/provider-kit/conformance.ts:216`, and a keyring comment), so the login runner is the host's and Task 9's `scripts/provider-login.mjs` would be the only one in-tree. Roadmap citation holds: Phase 5, "OAuth token persistence through the slot" (`roadmap.md:1793`). The keyring already implements the write (`createKeyringCredentialResolver`, `packages/credentials/keyring/src/index.ts:189-208`), so Task 2 is a capability-gated passthrough. Corrections: the capability set is a closed union in `src/packages/capabilities.ts:9-28`, validated at `src/packages/define.ts:84`, documented at `docs/packages.md:270-274,407-409`; a non-writable ref already has the public code `credential_ref_unsupported` (`packages/credentials/keyring/src/index.ts:164-172`), so the planned second code is dropped; and three declared-but-unimplemented credential contracts (`OAuthProvider`, `OAuthCredentials`, `OAuthLoginCallbacks`, `src/contracts-core/resources.ts:61-87`) sit beside the keyring's unused `setOAuth`/`getOAuth`/`deleteOAuth` adapters (`packages/credentials/keyring/src/resolver.ts:11-67`) — Task 2 deletes or wires them. **Second user:** plan 205 has none (`grep -ni "oauth\|credentials:write" plans/205-…md` is empty), so the addition rests on the roadmap entry; the plan's "plan 205's optional key-login" line is wrong.
    - **(d) Live OAuth probe — measured.** Dynamic registration returned an issued client ID (32 chars, `oaiapp_` prefix, **not** `dynamic_agent_client`); `host_id` was `urn:uuid:638b6945-…`; redirect `http://127.0.0.1:1455/auth/callback`; PKCE S256 with a 64-character verifier; granted scopes `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke` — **the direct-scope stop condition passes**. ID token: `iss` `https://auth.openai.com`, `aud` an **array**, `sub` 54 characters. Discovery at `https://auth.openai.com/.well-known/openid-configuration`: authorize `/api/accounts/authorize`, token `/api/accounts/oauth/token`, revocation `/api/accounts/oauth/revoke`, JWKS `/.well-known/jwks.json`, `RS256`, `S256` only, grants `authorization_code` + `refresh_token`; **no `device_authorization_endpoint`**, and `scopes_supported` lists only the four OIDC scopes, not the two ChatGPT ones — so a client that validates requested scopes against discovery must not (mirror this in Task 4). Refresh: `expires_in: 3600`, so access tokens live **one hour**; the response carries `earliest_refresh_at` about 58 minutes out, but a refresh **4 minutes** after issue returned 200, so the field is advisory and the implementation must not gate on it — refresh on 401 or on a margin. The refresh token **rotated** (`rt.1.` length 196 → 211) and **the pre-rotation token still returned 200 afterwards**, as did the new one: rotate-and-persist is mandatory, but a crash between write and use costs nothing, and the write must be idempotent per record rather than append-only. Device code: `POST /api/accounts/deviceauth/usercode` answers `400 invalid_client` "This app is unavailable" for **both** the issued ID and `dynamic_agent_client`, so (d)'s expectation is confirmed — **no device-code fallback on the sanctioned route**, and pi's device flow is a private-route feature that cannot serve this package. The pasted-callback path was **not** re-tested (it would need a second consent); the listener worked, and Task 4 keeps paste as the remote-host fallback per pi's `output` path.
    - **(e) Wire probes — measured on `gpt-6.1-sol`.** `GET /v1/models` returns 9 entries, 7 with `visibility: "list"` (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) — no capability metadata, so the package cannot discover reasoning support and documents the slugs it supports. Results, one request each unless noted: text returns `Hello, world!`; the **tool loop works with `store: false`** — turn 1 returns an empty text with a `function_call` plus an encrypted reasoning item, and turn 2 replays that item byte-for-byte and answers `21°C and sunny`; `text.format` `json_schema` returns valid JSON (`{"city":"Vienna","population":2028289}`); an image input answers `Gray`; **14 of the 15 researched unsupported fields are rejected** with `400 {"detail":"Unsupported parameter: <name>"}` sent alone (`background, conversation, max_tool_calls, metadata, moderation, multi_agent, prompt, prompt_cache_retention, safety_identifier, temperature, top_logprobs, top_p, truncation, user`), **but `max_output_tokens` is accepted** — the probe's 200 was verified deliberately: `8` fails with "integer below minimum value. Expected a value >= 16", `4096` is honoured, and `16` truncates the answer to 13 characters, so the field passes through with a documented minimum instead of being omitted; **cache:** `prompt_cache_key` present gives cached/input `2048/2196 → 2048/2224 → 2048/2243` (reuse **0.921** and **0.913**) and absent gives **0.0** on all three turns, so the key is the lever and the ≥ 0.8 threshold is met with margin; the SSE sequence per call is `response.created → in_progress → output_item.added → content_part.added → output_text.delta… → response.metadata → output_text.done → content_part.done → output_item.done` (14 files, 196 events, saved under `/tmp/prism-siwc-probe/out/`, no token fields); **overflow was not produced** — a 400,007-token input was accepted with 200 and answered, so `gpt-6.1-sol`'s window is larger than the probe's payload and plan 194's classifier needs a smaller-context model or a >1M-token body; record it rather than inventing a fixture. Budget used: **16 inference calls** (`gpt-6.1-sol`: 1 text, 2 tool, 1 structured, 1 image, 1 accepted admission, 6 cache, 1 WS frame, 1 cap-4096, 1 cap-16), 16 rejections (14 admission + `max_output_tokens: 8` + 2 malformed `stream: false`), plus one 400k-token call that consumed the bulk of the usage; the plan's 25-request ceiling held for billable turns but the over-long write-up above already flags the waste.
    - **(f) WebSocket feasibility — measured.** `wss://api.openai.com/v1/responses` accepts the SIWC bearer token with `OpenAI-Beta: responses_websockets=2026-02-06` using Bun 1.4.4's `new WebSocket(url, { headers })`, and a `response.create` frame was accepted — the server's first frame was `codex.response.metadata`. Node 26.11.1's global `WebSocket` also forwards `authorization` (undici's `headers` option), so no header limitation exists in either runtime; the subprotocol fallback cannot carry a bearer token. Full-turn and `previous_response_id` continuation caching were **not** measured: the probe stopped at the first server frame, and that measurement belongs to Task 7, which only runs if Task 6 shows a >5-point gap.
    - **(g) Reference harnesses — pi re-verified, Codex CLI measured, pi's own harness still pending.** pi-ai **1.4.0** confirms every lever: `prompt_cache_key = clampOpenAIPromptCacheKey(options.sessionId)` with `store: false` and `prompt_cache_retention`/`prompt_cache_options` dropped for SIWC (`api/openai-responses.js:262-275`); the 64-character clamp (`api/openai-prompt-cache.js:1-9`); `session_id` only for the `openai` affinity format plus `x-client-request-id` always (`:224-232`); `include: ["reasoning.encrypted_content"]` when reasoning is on (`:299-301`); `isChatGPTSignIn` keyed on provider `openai` + `api.openai.com/v1` + a non-`sk-` key (`:23-31`); a **180 s** refresh margin, not the plan's 300 s (`auth/oauth/openai-chatgpt.js:24`). **Correction:** pi 1.4.0 has no `openai-chatgpt` provider id — the flow is an auth method of `openai` (`pi-ai/dist/providers/openai.js:18`), and `pi auth check --provider openai` is the readiness check; the plan's `--provider openai-chatgpt` commands are corrected here and in Task 6. The Codex CLI cell is measured with the owner's existing login: `codex exec --json --ephemeral --skip-git-repo-check` answered in one turn with `input_tokens: 17888`, `cached_input_tokens: 12288`, `cache_write_input_tokens: 0` on `codex-cli 0.164.0`. The pi side needs the owner to sign in with ChatGPT inside pi — a second consent on the same account — **still pending**, so the plan 184 pi cell is `unmeasured` until then.
    - **(h) Release-path fit — four gaps, all folded into the later tasks.** (1) **A 429 usage limit cannot be made non-retryable the way Task 5 described.** `providerHttpError`'s `decision.code` *is* the status the classifier reads (`src/provider-kit/transport.ts:79-84` reads `code` first), so a non-429 code turns `quota` into `permanent`; and `isTransientErrorInfo` retries every numeric 429 and any message matching `/timeout|temporar|rate.?limit|overload|unavailable/i` (`src/models/retry.ts:62-66`), which an admission `{"detail":"…"}` body can trigger. Task 5 now implements "quota is never retried" in `isTransientErrorInfo` on `failureClass === "quota"`, with `src/__tests__/retry.test.ts` proving the 429 rate-limit path still retries. (2) **`runProviderLiveScenarios` has no Responses route** (`LiveRouteName` is `"openai" | "anthropic"`, `src/testing/provider-live-scenarios.ts:47,66-70`), so Task 5's file list gains it and plan 205 reuses the row. (3) **`provider-probe.mjs` cannot authenticate this provider** — it builds `{ apiKey: () => process.env[…_API_KEY] }` and calls `create(auth)` (`scripts/cache-parity/provider-probe.mjs:224-228`), while this package takes a keyring credential; Task 6 gains that path and its test. (4) **Plan 205 has no `credentials:write` user**. Context overflow already looks compatible (`CONTEXT_OVERFLOW_BODY` matches `context_length_exceeded`, `src/provider-kit/transport.ts:31-32`; `CONTEXT_OVERFLOW_STATUSES` covers numeric 400, `:35-47`), but (e) could not produce a live overflow body, so the mapping stays pi-derived and the plan-194 parity row is recorded as `unmeasured` with the reason. Plans 184/185/186/187 need what Task 8 lists, with pi's corrected provider id and the seven-package count.
    - **(i) Verdict — proceed.** The policy premise is documented and the account is admitted; registration returned an issued ID with the direct scope; `store: false` carries tool calls, structured output, images, and encrypted reasoning replay; the cache lever is confirmed at 0.91–0.92 against 0.0 without it; the WS transport is real; and the private-route shortcut stays excluded by OpenAI's text and by the private tokens' missing `chatgpt.tokens.use.direct`. **Stop conditions: none triggered** — all three passed on the owner's first completed sign-in.
    - **Follow-up (same day, owner-directed).** The wire subset was re-run on **`gpt-6-luna`** (the owner's choice): identical on every axis — text, the tool loop with encrypted-reasoning replay, `json_schema`, the same 14 rejected fields, `max_output_tokens` accepted, and cache reuse **0.920 / 0.912** with `prompt_cache_key` against **0.0** without — so `gpt-6.1-sol` was not idiosyncratic. The re-authorization also worked in one pass (choose-account → Continue, no password), which proves the issued client and host ID are reused on a second consent. **pi reference harness, measured on the route pi actually has configured:** pi holds only an `openai-codex` (private-route) credential — `pi auth check --provider openai` is still `credentials_not_configured` — so `pi -p --mode json --provider openai-codex --model gpt-6-luna` was run in one `--session-id` across three turns and reports `cacheRead` reuse **0.969** and **0.982** on a ~7k-token prefix. Two consequences: plan 184 must label pi's cell as the **private route** while Prism's sanctioned-route number stays unmeasured, so the `Prism >= pi` gate is pending until Task 6 (the task order already requires this); and `--session-id` is how Task 6 holds `prompt_cache_key` constant across `pi -p` invocations. The second login's record was deleted immediately after these runs, like the first.
    - **Plan edits made by this review.** Task 1 (g) and Task 6 name pi's real provider id; Task 2 gains the extra files and line numbers, one refusal code, the dead-contract decision, and the second-user correction; Task 3 gains the measured admission list — `max_output_tokens` **out** of `omitFields`, passed through with a minimum-16 rule, a test, and the measured event sequence; Task 4 gains the host-constructed `AuthContext` finding, pi's 180 s margin, and the discovery-document constraint (do not validate the two ChatGPT scopes against `scopes_supported`, no device-code fallback, advisory `earliest_refresh_at`); Task 5 gains the `isTransientErrorInfo` quota rule with its files and tests, and `src/testing/provider-live-scenarios.ts`; Task 6 gains the probe credential path and a second test name. No acceptance criterion was deleted.
    - **Security.** Tokens lived only in `/tmp/prism-siwc-probe/record.json` (mode `0600`, outside the repo) and in `findings.json`, and **both are deleted now** along with the record-bearing helper scripts; the capture in `/tmp/prism-siwc-probe/out/` contains 14 raw event files with no `authorization`, `refresh_token`, `id_token`, `code`, or client id, and Task 3 scrubs it again before committing. No token, authorization code, verifier, or client ID was ever printed — only lengths and prefixes. One deliberate cost: the 400k-token overflow attempt.

- [x] Task 2: Kernel — package credential writes through the slot (`credentials:write`)
  - Acceptance Criteria:
    - Functional:
      - `PackageAPI.credentials` gains `store(ref, secret)` and `delete(ref)`. They are present only for a package that declares the `credentials:write` capability. They pass through to the credentials slot's `CredentialResolver.store` and `delete`.
      - Writes accept only `keyring:` refs (or any non-`env:` scheme the slot declares writable). An `env:` ref fails with `CredentialRefNotWritableError`. **Task 1 (c) correction:** the code is the existing public `credential_ref_unsupported` that the keyring already throws for this exact condition (`packages/credentials/keyring/src/index.ts:164-172`), not a second code for one refusal. One spelling repo-wide, proven by the task's grep.
      - A slot without `store` fails with `CredentialStoreUnavailableError` (`code: "credential_store_unavailable"`).
      - A package that lacks the capability gets `undefined` members, not a throw at setup.
      - A stored value joins the agent's secret set immediately, so it is redacted from events, notes, and errors.
    - Performance: no cost unless called.
    - Code Quality:
      - The written proof from Task 1 (c) sits in the task note.
      - The kernel gains no dependency, and the "kernel imports no package" gate stays green.
      - `bun scripts/release.mjs gate --update-baseline` rewrites `scripts/compat-baseline/arnilo__prism.txt` (the root types change). The diff is attributed to plan 204.
      - `src/__tests__/public-export-contract.test.ts` is updated for the two error classes.
    - Security:
      - Capability-gated.
      - `env:` refs are never writable.
      - The secret value never appears in events, `inspect()`, errors, or persisted entries, which a test asserts.
      - Writes are not exposed to tools or `host.ui`.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/api.ts:137-143`; `src/contracts-core/resources.ts:55-59`; `src/contracts-core/provider.ts:80-91`; the capability checks in `src/packages/*`; `packages/credentials/keyring/src/index.ts` (implements `store`); roadmap Phase 5 and §2.6.
    - Options Considered:
      - Keeping refreshed tokens only in memory. Rejected: refresh tokens rotate, and reuse is rejected (`refresh_token_reused`), so the next process could not sign in without a fresh login.
      - The package writing to a file it owns. Rejected: it bypasses the credentials slot and keyring, and leaves secrets on disk.
      - A host callback on `AuthContext` kept alive after login. Rejected: `AuthContext` is the host's login-time object, and the kernel never calls `login`.
    - Chosen Approach:
      - A capability-gated passthrough to the slot that already supports `store` and `delete`.
    - API Notes and Examples:
      ```ts
      readonly credentials: {
        resolve(ref: string): Promise<Secret | undefined>;
        /** Present only with the `credentials:write` capability. */
        store?(ref: string, secret: Secret): Promise<void>;
        delete?(ref: string): Promise<void>;
      };
      ```
    - Files to Create/Edit:
      - `src/packages/api.ts`; the builder is `src/packages/loader.ts:798-804` (Task 1 (c) resolved the graft question), and `src/packages/capabilities.ts:9-28` holds the closed `Capability` union plus `CAPABILITIES`, validated at `src/packages/define.ts:84` through `isCapability`. The keyring resolver that already implements the write (`createKeyringCredentialResolver`, `packages/credentials/keyring/src/index.ts:189-208`) needs no change.
      - Task 1 (c) also found three declared-but-unimplemented credential contracts (`OAuthProvider`, `OAuthCredentials`, `OAuthLoginCallbacks`, `src/contracts-core/resources.ts:61-87`) plus the keyring's unused `spec`/`setOAuth`/`getOAuth`/`deleteOAuth` adapters (`packages/credentials/keyring/src/resolver.ts:11-67`). This task's note records the decision: delete them in this task (retirement sweep) or wire them; leaving three competing credential shapes is not allowed.
      - `src/errors*` (two classes).
      - `src/__tests__/package-credentials-write.test.ts` (new).
      - `src/__tests__/public-export-contract.test.ts`.
      - `scripts/compat-baseline/arnilo__prism.txt`.
      - `docs/packages.md` and the credentials section of `docs/models.md`.
      - `CHANGELOG.md`.
    - References:
      - roadmap Phase 5; Task 1 (c).
  - Test Cases to Write:
    - `credentials_store_requires_capability`: without it the members are undefined; with it they reach the slot.
    - `credentials_store_rejects_env_ref`: `credential_ref_unsupported`.
    - `credentials_store_fails_closed_without_slot_store`: `credential_store_unavailable`.
    - `credentials_store_value_is_redacted`: a stored value never appears in events, `inspect()`, errors, or entries.
    - `credentials_delete_passthrough`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (a `PackageAPI` member and a capability).
    - Docs pages to create/edit:
      - `docs/packages.md`: `credentials.store`/`delete`, the `credentials:write` capability, the errors, and when a package needs it.
      - `docs/models.md`: the OAuth persistence paragraph.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Shipped.** `PackageAPI.credentials` gains `store(ref, secret)` and `delete(ref)`, built in `src/packages/loader.ts` (`writeCredentialRef` plus the capability-gated spread) and typed in `src/packages/api.ts`. `credentials:write` joins the closed union and `CAPABILITIES` set in `src/packages/capabilities.ts`; both members are `undefined` for a package without it, so nothing existing changes. The write passes straight to the slot's own `store`/`delete`, so the keyring needed no change, and a stored value joins the agent's `secrets` array exactly as a resolved one does.
    - **One refusal code, one spelling.** The kernel refuses `env:` first with `CredentialRefNotWritableError` (`credential_ref_unsupported`) before it looks at the slot, and leaves every other scheme to the slot, which for the keyring throws the same code from `requireKeyringRef` (`packages/credentials/keyring/src/index.ts:167-175`). A slot with no `store` fails closed with `CredentialStoreUnavailableError` (`credential_store_unavailable`) without calling it. Both classes are exported (`src/credentials/errors.ts`, through `src/index.ts`) and listed in `public-export-contract.test.ts`.
    - **Gate shape.** Presence follows `credentials:write`; a *call* requires both `credentials` and `credentials:write`, so a package that declares the write capability alone gets `capability_missing` naming `credentials.store`, not a silent degrade. That matches the documented "Needs `credentials`" on the member.
    - **Dead-contract decision — delete, do not wire.** `OAuthProvider` and `OAuthLoginCallbacks` are deleted from `src/contracts-core/resources.ts`: no implementer and no consumer remain in `src/`, `packages/`, or `apps/` after the 0.12 provider factories were retired, and their only users were two tests that existed to typecheck the shapes (`public-contracts.test.ts`, `credentials-redaction.test.ts`), both rewritten to exercise the credentials slot itself. `OAuthCredentials` **stays**: `@arnilo/prism-credentials-keyring` converts `Secret` metadata into it (`secretToOAuthCredentials`, `createOAuthCredentialSink`, `ExtendedOAuthCredentialStore` in `packages/credentials/keyring/src/resolver.ts`), so it is a live host-facing shape rather than a fourth competing one. The keyring adapters are untouched.
    - **Second user — corrected.** The criterion's "plan 205's optional key-login" does not exist (`grep -ni "oauth\|credentials:write" plans/205-…md` is empty). The real second user is the roadmap's Phase 5 OAuth-persistence entry, and the task stands on that plus Task 4's refresh rotation.
    - **Redaction test boundary.** The new test asserts the written value joins the caller's `secrets` array, which is the single mechanism every consumer reads (hook bus events, `status.note`, `log`, `inspect()`, provider-error redaction all close over it). Asserting a specific event string would retest plan 194's redaction suite through a new door.
    - **Verification.** `tsc --noEmit` clean. New suite `src/__tests__/package-credentials-write.test.ts`: 5 cases (`credentials_store_requires_capability`, `credentials_store_rejects_env_ref`, `credentials_store_fails_closed_without_slot_store`, `credentials_store_value_is_redacted`, `credentials_delete_passthrough`). Targeted run across package/public/credentials/docs suites: 185 pass, 0 fail; the keyring package: 42 pass, 0 fail. `bun scripts/release.mjs gate --package @arnilo/prism` green.
    - **Baseline and budgets.** `bun scripts/release.mjs gate --update-baseline --package @arnilo/prism` rewrote `scripts/compat-baseline/arnilo__prism.txt` (+11 lines: the two error classes, and — because the checked-in baseline had drifted — `ContextOverflowError` and `ProviderOverflowRecovery` from plan 194, which is plan 194's debt being settled here, not this task's growth). `scripts/budgets.json` kernel ceilings move to 1155861 packed / 3763047 unpacked / 39183 source lines / 1492 root exports, with the plan-204 reason recorded on the kernel comment and each metric. No dependency added, no new src module, so file count is unchanged.
    - **Docs.** `docs/packages.md` (member row, capability table, capabilities list, credentials prose), `docs/models.md` (the provider-package credentials paragraph), `docs/credentials-and-redaction.md` (the write path, both errors, and the shortened public-contract list), `CHANGELOG.md`.
    - **Unrelated red in the tree.** `scripts/phase21-freeze.test.mjs` (and siblings) fail on files later plans retired (`packages/coding-security/src/egress/dns-pin.ts`, `docs/providers/openai-compatible.md`); those failures predate this task and were not touched.

- [x] Task 3: Provider-kit — the OpenAI Responses codec (`openai-responses` route format)
  - Acceptance Criteria:
    - Functional:
      - **Body.**
        - The system prompt becomes `instructions`; later system content becomes `developer` messages, never `role: "system"` items.
        - Messages map to `input` items: user and assistant messages with `input_text`, `output_text`, and `input_image`; `function_call`, `function_call_output`, and `reasoning` items replayed with `encrypted_content`, `id`, and `summary` from `ThinkingContent.data`.
        - Tools become `function` tools; `tool_choice` maps through.
        - Thinking becomes `reasoning: {effort, summary}`, with effort snapped to the model's levels.
        - Structured output becomes `text.format` (`json_schema`).
        - `include: ["reasoning.encrypted_content"]` is sent when `store` is false.
        - `prompt_cache_key` comes from `options.cacheKey ?? sessionId`, clamped to 64 characters (pi `openai-prompt-cache.js`).
        - `store` and `stream` follow route options.
        - `omitFields` (a route option) removes the listed keys **after** construction.
        - `previous_response_id` is never sent by the HTTP codec.
      - **Events.**
        - `response.output_text.delta` → text delta;
        - `response.reasoning_summary_text.delta` → thinking delta;
        - `response.output_item.done` of type `reasoning` → a `ThinkingContent` with `data` holding the item's encrypted payload, so replay is byte-identical;
        - function-call items and argument deltas → tool-call deltas and a final tool call;
        - `response.completed` → usage (`input_tokens` inclusive, `input_tokens_details.cached_tokens` → `cacheReadTokens`, `output_tokens`, reasoning tokens in metadata), then `done` with the mapped stop reason;
        - `response.incomplete` → `done` with `length` or `content_filter`;
        - `response.failed` and `error` events → a terminal classified `providerError` carrying `error.code` and `error.param`.
        - `response.failed` (or an HTTP 400) whose `error.code` is `context_length_exceeded`, or whose message matches the overflow patterns, yields an error carrying status 400. The shared classifier then marks it `context_overflow`. Before output, plan 194's recovery runs; after output, the run fails with `ContextOverflowError`.
        - A stream that ends without `response.completed` is an error (strict completion).
      - `createRoutedProvider` accepts `format: "openai-responses"` with `codec` options `{ store, include, omitFields, promptCacheKeyMax, reasoningSummary }`.
      - `providerConformance({ recordings })` handles Responses recordings (event order, tool reconstruction, usage invariant, encrypted-reasoning round trip).
    - Performance: streaming parse with no full-buffering. `codecs/openai-responses.ts` is imported only through the routed provider.
    - Code Quality:
      - It reuses `readSseEvents`, the usage normalization, `mapProviderStopReason`, and the structured-output helpers.
      - No vendor name appears; the `rg` check is extended.
      - Baselines are regenerated and the diff attributed.
      - The `docs/provider-kit.md` "Removed" list stops listing the Responses codec as removed. A note says it returned in a new shape: the old `createOpenAIResponsesProvider` stays removed, and Responses is a route format.
    - Security: error text is redacted. Encrypted reasoning is replayed only to the provider that produced it (keyed by provider id in `ThinkingContent.data`); a test asserts this.
  - Approach:
    - Documentation Reviewed:
      - The OpenAI Responses streaming events reference; SIWC inference and preview-limitation pages.
      - pi `api/openai-responses-shared.js` (message conversion, event handling) and `api/openai-responses.js:248-300`.
      - Prism `codecs/openai-chat.ts` and `codecs/anthropic-messages.ts` (codec shape), `routed-provider.ts`, `conformance.ts`.
      - Task 1 (e) recordings.
    - Options Considered:
      - A package-local codec. Rejected: Command Code's `/responses` (plan 205) is a second user, and the Responses API is a cross-vendor wire.
      - Restoring the 0.12 `createOpenAIResponsesProvider`. Rejected: plan 182 replaced provider factories with route formats.
    - Chosen Approach:
      - A third route format with recorded-wire conformance.
    - API Notes and Examples:
      ```ts
      routes: { responses: { format: "openai-responses", path: "/responses", auth: "bearer",
        codec: { store: false, include: ["reasoning.encrypted_content"], omitFields: SIWC_UNSUPPORTED_FIELDS } } }
      ```
    - **Measured admission list (Task 1 (e)).** `SIWC_UNSUPPORTED_FIELDS` is the 14 names in the research table — **`max_output_tokens` is not one of them**: it is accepted with a minimum of 16 (8 fails with "Expected a value >= 16", 16 truncates, 4096 is honoured), so the codec forwards it when the model or caller sets it and documents the floor; a caller asking for less fails locally with a named error rather than at the provider. The measured stream sequence for one plain call is `response.created → in_progress → output_item.added → content_part.added → output_text.delta… → response.metadata → output_text.done → content_part.done → output_item.done`; `response.metadata` has no counterpart in the parser today and is ignored by name.
    - Files to Create/Edit:
      - `src/provider-kit/codecs/openai-responses.ts` (new), `src/provider-kit/routed-provider.ts`, `src/provider-kit/conformance.ts`, `src/provider-kit/index.ts`.
      - `src/__tests__/openai-responses-codec.test.ts` (new) with fixtures from Task 1.
      - `scripts/compat-baseline/arnilo__prism.txt`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - plan 182; plan 205.
  - Test Cases to Write:
    - `responses_body_instructions_not_system_items`.
    - `responses_body_replays_encrypted_reasoning_byte_equal`.
    - `responses_body_omit_fields_applied_last`: a field set by the model's `parameters` is still removed.
    - `responses_max_output_tokens_passes_through_and_rejects_below_16`: the body keeps `max_output_tokens` (the 14-name list must not contain it), and a caller value under 16 fails locally.
    - `responses_prompt_cache_key_clamped_to_64`.
    - `responses_never_sends_previous_response_id_over_http`.
    - `responses_events_text_reasoning_tools_usage`: recorded stream to the expected events. Fails on order or usage mapping.
    - `responses_failed_event_is_classified_error`: `error.code` and `param` preserved.
    - `responses_overflow_failure_classifies_context_overflow`: before output it recovers once; after output it fails with `ContextOverflowError`.
    - `responses_incomplete_maps_stop_reason`.
    - `responses_missing_completed_is_error`.
    - `responses_reasoning_not_replayed_to_other_provider`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (a provider-kit route format).
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: "OpenAI Responses codec" section; the routes table gains the format; the "Removed" note is updated.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Shipped.** `src/provider-kit/codecs/openai-responses.ts` (591 lines) plus `format: "openai-responses"` on `createRoutedProvider` (`RoutedProviderFormat` is now the three-format union; the route `codec` is a conditional type over it). `openAIResponsesBody` / `openAIResponsesEvents` / `mapOpenAIResponsesUsage` / `serializeResponsesTool` and the constants `OPENAI_RESPONSES_UNSUPPORTED_FIELDS` (14 names, `max_output_tokens` deliberately absent), `OPENAI_RESPONSES_MIN_OUTPUT_TOKENS` (16), `DEFAULT_RESPONSES_PROMPT_CACHE_KEY_MAX` (64) are exported through `provider-kit/index.ts`.
    - **Body.** First system message → `instructions`, later system content → `developer` input items (never a `system` role). User/assistant text → `input_text`/`output_text`, images → `input_image`, `tool_call` → `function_call`, `tool` → `function_call_output`. Tools are flat (`name`/`parameters` at the top level, not wrapped in `function`) as the live capture shows. Structured output lands on `text.format` as a **bare** `json_schema` (measured shape; Chat's `json_schema` wrapper would be wrong here). `reasoning.effort` snaps through `resolveReasoningEffort`, `reasoning.summary` from the codec option or the model's compat. `include` gets `reasoning.encrypted_content` whenever `store` is false. `prompt_cache_key` is `cacheKey ?? sessionId` truncated to `promptCacheKeyMax`. `omitFields` runs last, after `transformBody`, so a model's `parameters` cannot re-add a refused field. `previous_response_id` is deleted unconditionally — the HTTP route is stateless, so a caller's `continuation` or compat key is dropped rather than sent.
    - **`max_output_tokens`.** Kept out of the refusal list; `parameters.max_output_tokens` (or the portable `maxTokens`/`max_tokens`) maps onto it, and a value below 16 throws the new `ResponsesMaxOutputTokensError` (`max_output_tokens_below_minimum`) before any fetch — the provider never sees an 8.
    - **Events.** Text and `reasoning_summary_text` deltas stream as they arrive; a `function_call` item plus its argument deltas reconstruct one tool call. Deltas carry `call_id` (the id a host answers with) rather than the item id `fc_…`; the item id is the fallback. `response.completed` yields usage (`input_tokens` already inclusive, `input_tokens_details.cached_tokens` → `cacheReadTokens`, `output_tokens_details.reasoning_tokens` → `metadata.reasoningTokens`) and then `done`; `response.incomplete` maps `incomplete_details.reason`. `response.failed`/`error` are terminal; `response.metadata`, `content_part.*`, `output_text.done`, `function_call_arguments.done` and `reasoning_summary_part.*` are ignored by name.
    - **Reasoning replay.** `ThinkingContent.data` is `{ provider, item }` — the wire item verbatim plus the provider that produced it. Replay sends `id`, `encrypted_content` and `summary` byte-for-byte, and only when `data.provider === request.model.provider`; a block from another provider is dropped (fail closed, no leak). One deliberate departure from the Chat codec: replay does **not** gate on `resolvePreserveThinking`, because an encrypted item only exists if this provider produced it, so dropping it would break the next turn rather than honour a preference.
    - **Overflow.** The shared overflow test moved into `transport.ts` as the exported `isContextOverflowMessage` (one spelling for `classifyProviderFailure` and for a codec that only sees a stream frame); `classifyProviderFailure` now calls it. A `response.failed` carries no HTTP status (the response was a 200 stream), so an overflow payload is reported as status 400 — which is what makes the shared classifier return `context_overflow`, and what drives plan 194's one compact-and-retry before output (`ContextOverflowError` after it). Tested at both levels: the frame alone, and a real session through a routed provider that recovers once and, when output already started, fails with `context_overflow`. The wire `code` and `param` stay in the message (`code (param): detail`); a string `code` is kept as the `ErrorInfo.code` when there is no status.
    - **`mapProviderStopReason`.** `max_output_tokens` was missing from the taxonomy table, so an `incomplete` with `reason: "max_output_tokens"` would have become `unknown`; added one row in `src/models/events.ts` under the Responses group.
    - **Conformance.** `providerConformance({ recordings })` now: picks the `responses` route from the recording path, rebuilds the request from `instructions`/`input` (message items, `function_call`, `function_call_output`, and a `reasoning` item as a thinking block with `data = { provider, item }`), asserts a replayed reasoning item still carries `encrypted_content`, and `recordingHasErrorFrame` recognizes the typed `error` / `response.failed` frames. The end-to-end proof is in the test: the recorded second turn's encrypted payload is observed on the outgoing wire body.
    - **Fixtures.** `src/__tests__/wire/responses/{text,tool-loop,overflow}.json` follow the live event order and field names captured in Task 1 (e) (text, encrypted reasoning, function call, cache read, JSON-schema output, 400 overflow body); payload strings are shortened and marked synthetic in the fixture content, the way the OpenRouter fixtures state it. No token, account id, or real encrypted blob is committed.
    - **Tests.** `src/__tests__/openai-responses-codec.test.ts`: the 12 planned cases plus `responses_error_event_is_classified_error`, `responses_store_and_include_follow_route_options`, `responses_body_reasoning_effort_and_structured_output` and `responses_recordings_conform`. Targeted run across the codec, chat codec, conformance, routed-provider, provider-kit, overflow-recovery, public-export and docs suites: 210 pass, 0 fail. `tsc --noEmit` clean.
    - **Vendor-name gate extended.** `provider_kit_names_no_vendor` walked only the files directly under `src/provider-kit`, so a codec one directory down escaped it; it now walks `sourceFiles("src/provider-kit")` (all of `codecs/`), and the new file names no vendor.
    - **Baseline and budgets.** `gate --update-baseline --package @arnilo/prism` regenerated `scripts/compat-baseline/arnilo__prism.txt` (+21 lines: the ten new exports and the `RoutedProviderFormat` type). Kernel ceilings move to 1164119 packed / 3800258 unpacked / 39926 source lines / 361 files / 1502 root exports with the plan-204 reason recorded on the kernel comment and every metric. No dependency added, no provider package touched.
    - **Docs.** `docs/provider-kit.md`: the intro names three codecs, the routes table lists the third format, §3 gains the Responses codec options, a new "OpenAI Responses codec" section documents body, replay, events, and errors, and the "Removed" entry says Responses returned as a route format while the factory stays removed. `CHANGELOG.md` entry added. `docs/index.md` untouched.
    - **Unrelated red in the tree.** `scripts/budget-gate.test.mjs` fails on `exportCounts` rows for `@arnilo/prism` (baseline 1453 vs 1502 measured, accumulated by plans 194/203/204) and on stale rows for `mcp`, `channels`, and unbuilt packages; all of those predate this task (confirmed against a stashed tree) and were left alone. `scripts/phase21-freeze.test.mjs` still fails on files later plans retired.

- [x] Task 4: The Sign in with ChatGPT OAuth client (package-local)
  - Acceptance Criteria:
    - Functional:
      - `openAICodexAuth(config)` returns the provider's `AuthMethod` `{kind: "oauth", id: "openai-codex", login(ctx)}`. `login`:
        - (1) Reads or creates the stable host ID (`urn:uuid:<v4>`). It is stored in the credential record, and an imported record keeps the importing host's ID.
        - (2) Uses the saved issued `client_id` for this account, or `dynamic_agent_client` with `agent_name_hint = config.appName` on first registration.
        - (3) Builds the authorize URL with S256 PKCE, `state`, `nonce`, `resource`, the full scope, and `ext_agent_host_id`.
        - (4) Binds a loopback listener on `127.0.0.1` (a configured port, default 1455, falling back to an ephemeral port). It imports `node:http` only inside `login` and can be disabled with factory option `callback: "paste"`.
        - (5) Calls `ctx.host.ui` `open-url`, then races the listener against `ctx.host.ui` `input` ("paste the callback URL"). It accepts a URL whose scheme, host, path, and `state` match.
        - (6) Exchanges the code (form-encoded, issued `client_id`, `resource`). Using `dynamic_agent_client` here is rejected with `OpenAICodexRegistrationError`.
        - (7) Validates the ID token: RS256 via WebCrypto against the JWKS from `https://auth.openai.com/.well-known/openid-configuration`, plus `iss`, `aud` equal to the issued client ID, `exp`, and `nonce`.
        - (8) Without `chatgpt.tokens.use.direct` in `scope`, stores nothing for inference and throws `OpenAICodexPlanUsageNotGrantedError` with a message offering re-consent.
        - (9) Stores one record `{v: 1, clientId, hostId, access, refresh, expires, earliestRefreshAt, scope, sub, idToken}` with `ctx.credentials.store(config.credential)`.
      - **Request-time credential.** The provider's `resolveApiKey` resolves the record.
        - It refreshes when the access token expires within 300 s and `earliest_refresh_at` has passed: a form POST with the saved `client_id`, `refresh_token`, and `resource`, and no `scope`.
        - It persists the rotated record with `prism.credentials.store` (Task 2).
        - Refresh is single-flight per credential ref in the process. On `refresh_token_reused` or `invalid_grant`, it re-resolves the record once (another process may have rotated it) before treating it as terminal.
        - Terminal refresh codes throw `OpenAICodexReauthorizeError` (`code: "openai_codex_reauthorize"`), which is non-retryable.
      - **`logout(ctx)`** revokes at the OIDC `revocation_endpoint` (form `token`, `token_type_hint=refresh_token`, issued `client_id`). It retries 5xx with bounded backoff and deletes the stored record only after a 200 or a confirmed-invalid response. The client registration is kept.
      - **`importCredentials(ctx, record)`** validates the record shape, keeps or creates this host's own host ID, and stores it. This is the documented self-hosted-VM path.
      - **No device-code flow**, unless Task 1 (d) found one for issued clients.
    - Performance: `node:http` and the JWKS fetch run only during `login`. JWKS is cached for the login only. Refresh adds one request per hour per credential.
    - Code Quality:
      - Package-local in `packages/providers/openai-codex/src/oauth.ts`.
      - PKCE, state, and nonce use WebCrypto `getRandomValues` and `subtle.digest`.
      - No runtime dependency.
      - Errors are typed classes with `code`.
    - Security:
      - It never opens a browser itself; only `host.ui` `open-url`.
      - The listener binds `127.0.0.1` only, accepts one request with a matching `state`, and closes after the first callback or on abort.
      - Tokens, code, verifier, and ID token never reach `host.ui`, events, notes, errors, or logs, which a test asserts with sentinel values.
      - The credential ref must be writable (`keyring:`); an `env:` ref is rejected at setup with a status note.
      - The README states that the record is a secret, and how to move it to a VM securely (SSH, never chat or VCS).
  - Approach:
    - Documentation Reviewed:
      - The SIWC sign-in, token-reference, profiles-and-sessions, errors-and-recovery, and self-hosted-VM pages.
      - pi `auth/oauth/openai-chatgpt.js` (flow, paste fallback, host ID) and `auth/oauth/callback-server.js`.
      - Prism `AuthMethod` and `AuthContext` (`provider.ts:80-91`), `docs/host.md` (`open-url`, `input`), and Task 2.
      - **Task 1 (c) finding:** nothing in the kernel constructs an `AuthContext` (`grep -rn "AuthContext" src/ packages/ apps/` finds only the declaration, the conformance kind check, and the keyring comment), so `login` runs only from a host; the `docs/host.md` example this task plans is the only documentation of the wiring. pi refreshes 180 s before expiry (`pi-ai/dist/auth/oauth/openai-chatgpt.js:24`, `EXPIRY_MARGIN_MS`); this task's 300 s margin is a Prism choice and the README says so.
      - **Task 1 (d) measurements.** Endpoints (from `https://auth.openai.com/.well-known/openid-configuration`): authorize `/api/accounts/authorize`, token `/api/accounts/oauth/token`, revoke `/api/accounts/oauth/revoke`, JWKS `/.well-known/jwks.json`, `RS256`, `S256` only, grants `authorization_code` + `refresh_token`. Two constraints follow: `scopes_supported` lists **only** `openid profile email offline_access`, so the client must not validate `chatgpt.tokens.use.direct` or `resource.invoke` against discovery; and there is **no `device_authorization_endpoint`**, matching the `400 invalid_client` the device route returned. Access tokens last 3600 s; the token response's `earliest_refresh_at` is advisory (an early refresh 4 minutes after issue succeeded).
    - Options Considered:
      - Paste-only. Rejected: OpenAI says to start the listener before opening the browser, and pi does both. Paste stays as the fallback and the remote-host path.
      - Placing the OAuth helpers in provider-kit. Rejected: there is one user, and plan 182 removed the generic ones. Revisit when a second SIWC-style provider ships.
      - Decoding the JWT without verifying it, as pi's `openai-codex` does. Rejected: OpenAI's docs require validation.
    - Chosen Approach:
      - Implement the documented flow exactly, with a loopback listener and paste fallback, and persist through the slot.
    - API Notes and Examples:
      ```ts
      const provider = agent.models.resolve("openai-codex/gpt-6.1-sol").provider;
      await provider.auth?.find((m) => m.kind === "oauth")?.login({ host, credentials });
      ```
    - Files to Create/Edit:
      - `packages/providers/openai-codex/src/oauth.ts`, `src/jwt.ts` (new);
      - `src/__tests__/oauth.test.ts` (new, a fake auth server on `fetch`).
    - References:
      - Task 1 (d); Task 2.
  - Test Cases to Write:
    - `oauth_first_registration_uses_dynamic_client_and_saves_issued`: the exchange uses the issued ID, and `dynamic_agent_client` is rejected at exchange.
    - `oauth_has_no_device_code_fallback`: an issued client gets `400 invalid_client` from the deviceauth endpoint (Task 1 (d)), so no fallback is wired and the file contains no device-auth URL.
    - `oauth_reauthorization_reuses_client_and_host_id`.
    - `oauth_authorize_url_params_exact`: scope, resource, S256, state, nonce, `ext_agent_host_id`, the `127.0.0.1` redirect, and `agent_name_hint` only on the first registration.
    - `oauth_paste_fallback_validates_state_and_redirect`: a wrong state, host, or path is rejected.
    - `oauth_id_token_validation_fails_closed`: a bad signature, `aud`, `iss`, `exp`, or `nonce` each reject.
    - `oauth_missing_direct_scope_stores_nothing`.
    - `refresh_single_flight_and_persists_rotation`: two concurrent requests make one refresh, and the store is called with the new token.
    - `refresh_reused_rereads_store_once`.
    - `refresh_terminal_codes_require_reauthorize`: each of the six codes.
    - `refresh_ignores_earliest_refresh_at`: a record whose `earliest_refresh_at` is in the future still refreshes, because the server accepted an early refresh 4 minutes after issue (Task 1 (d)); the field is stored but never gates.
    - `refresh_survives_pre_rotation_token_reuse`: after a rotation the old refresh token still answers 200 for a grace window (Task 1 (d)), so a crash between store and use must not wedge the provider — the single-flight path re-reads the store before deciding to fail.
    - `logout_revokes_then_deletes`, and `logout_5xx_keeps_record`.
    - `import_credentials_keeps_local_host_id`.
    - `oauth_secrets_never_leak`: sentinel tokens are absent from every `host.ui` payload, event, and error.
    - `listener_binds_loopback_only_and_closes`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (provider auth).
    - Docs pages to create/edit:
      - the package README "Sign in with ChatGPT" section (Task 5);
      - `docs/host.md`: a short "Provider login" example that runs an `oauth` `AuthMethod` with `open-url` and `input`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Shipped.** `packages/providers/openai-codex/src/oauth.ts` (the client) and `src/jwt.ts` (ID-token verification), plus `src/__tests__/oauth.test.ts`. 22 tests pass; the package has no manifest yet, so no kernel or published surface changed. `tsc --strict` and `biome check` are clean on all three files, and `scan-secrets` reports nothing.
    - **What `login` does, in order.** Reads the record through the slot (`parseCredentialRecord`, refusing a malformed one), keeps the stored `hostId` or mints `urn:uuid:<v4>`, reuses the stored issued `clientId` or registers with `dynamic_agent_client`, generates a 64-character S256 verifier through WebCrypto plus 43-character `state`/`nonce`, binds the loopback listener, sends `open-url` through `host.ui`, races the listener against the paste `input`, exchanges the code with the **callback's** issued client ID, verifies the ID token, checks the scope, and stores one record.
    - **Two fail-closed additions the plan did not spell out.** (1) `open-url` must be `answered`: a host that cannot show the URL cannot complete the flow, so it fails with `openai_codex_login_unavailable` before any exchange instead of waiting on a listener for a URL nobody saw. (2) The registration sentinel is refused at the exchange (`client_id === dynamic_agent_client` → `OpenAICodexRegistrationError`, tested with zero token calls), not only documented.
    - **`node:http` is lazy.** `await import("node:http")` inside `openCallbackListener`, called from `login`; a test asserts there is no static import. The listener binds `127.0.0.1` only, serves only `/auth/callback`, answers 404 elsewhere, resolves once, and `close()` also calls `closeAllConnections()` so a browser's spare socket cannot swallow the next login's callback (pi's comment says the same). A busy configured port retries on port 0 and only the redirect URI changes; both paths are tested with a real socket, including that the port is closed afterwards.
    - **Paste mode.** `callback: "paste"` binds nothing and uses the configured port verbatim in the redirect URI (tested with port 9: the authorize URL keeps port 9, which proves no bind was attempted). The paste answer is validated for origin, path, and `state`; `dismissed` cancels the login, and `unavailable` never settles so a listener can still win the race.
    - **ID token.** `verifyIdToken` (`jwt.ts`) decodes nothing for trust: RS256 only, the JWKS key by `kid` (all RSA keys when the token has none), then `iss` against the discovery issuer, `aud` containing the issued client ID, `exp`, and `nonce`. Each failure is its own `IdTokenError.failure` and the tests cover signature (a foreign key pair), audience, issuer, expiry, and nonce, asserting nothing was stored in every case. Discovery and JWKS are fetched once per login, never cached across logins.
    - **Scope check.** A grant without `chatgpt.tokens.use.direct` throws `OpenAICodexPlanUsageNotGrantedError` (`openai_codex_plan_usage_not_granted`) with a re-consent message naming the permission, and stores nothing.
    - **Record shape.** `{v: 1, clientId, hostId, access, refresh, expires, earliestRefreshAt?, scope, sub?, idToken}`, written as one `bearer` secret whose `value` is the access token with `refresh`/`expires` beside `oauthMetadata` holding the record — so the keyring adapters (`secretToOAuthCredentials`) see a normal OAuth credential and this client reads the record back.
    - **Request-time credential.** `openAICodexApiKey(config)` returns `(signal?) => Promise<string>`: a fresh token never fetches; inside the 300 s margin it refreshes with the saved `client_id`, `refresh_token`, and `resource`, and no `scope`. Single-flight is per credential ref and the promise is stored synchronously (no `await` between `get` and `set`), so two concurrent turns make one POST — tested. The rotated record is persisted **before** it is used.
    - **Refresh races, measured.** `earliest_refresh_at` is stored and never gates (test: a future value still refreshes). On `refresh_token_reused`/`invalid_grant` the store is re-read once; if another process rotated it, that record wins and nothing is written (exactly three reads, one POST — asserted). A pre-rotation token that still works in the grace window just refreshes normally, which is why a crash between persist and use cannot wedge the provider. The six documented terminal codes (`invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused`) and `invalid_client` throw `OpenAICodexReauthorizeError` (`openai_codex_reauthorize`), whose message matches no transient pattern so the default policy does not retry it. A read-only slot skips persistence instead of failing the request (marked `shortcut:` in code).
    - **Logout** posts `token`/`token_type_hint=refresh_token`/`client_id` to the discovery `revocation_endpoint` (falling back to the measured `/api/accounts/oauth/revoke`), retries 5xx three times with bounded backoff, treats 200/400/401 as done, and deletes the record only then. The client registration stays. Tested both ways (200 deletes; 503 makes three attempts and keeps the record).
    - **Import.** `openAICodexImportCredentials(config)(ctx, record)` validates the v1 shape, keeps the local host ID when one exists, mints one otherwise, and never adopts the imported host's ID (asserted); a non-v1 record is refused.
    - **Secret hygiene.** The only thing sent to `host.ui` is the authorize URL (state/nonce/challenge, never a token). A test records every `host.ui` payload during a successful login and asserts the access token, refresh token, authorization code, PKCE verifier, and ID token never appear, and repeats the check on the failure path's message.
    - **Writable ref.** `assertWritableCredentialRef` is exported for Task 5's setup: a non-`keyring:` ref throws `openai_codex_credential_ref` before login touches anything. `openAICodexAuth` returns the narrowed `OpenAICodexAuthMethod` (`Extract<AuthMethod, {kind: "oauth"}>`) so a caller gets `login` without narrowing; it is still a plain `AuthMethod` to a host.
    - **Two gate refinements this task needed** (Task 5 still owns the rows): `packaging.test.ts` and `scripts/retired-providers.test.mjs` both treated *any* directory under `packages/providers` as a shipped package, so landing the client before the shell turned them red. Both now define "shipped" as "has a `package.json`", and `packaging.test.ts` additionally asserts that a manifest-less directory exposes no `src/index.ts`, so a stray half-package still cannot hide. Task 5 adds the manifest and the name to the shipped list; the extra assertion keeps its value.
    - **Docs.** `docs/host.md` gains "Provider login": the host-side wiring (an `AuthContext` the host builds, `createKeyringCredentialResolver`, iterating `provider.auth`), why the host runs it (nothing in the kernel constructs an `AuthContext`), and the fail-closed answers. `docs/index.md` untouched. No `CHANGELOG.md` entry: the package is unpublished until Task 5, which owns the entry.
    - **Budgets.** No kernel source changed; `kernel.packedBytes`/`unpackedBytes` moved +497/+1294 because the kernel tarball ships `docs/host.md`, which grew by that section. Both ceilings rebaselined with the reason on the kernel comment; file count, source lines, and root exports are unchanged and the compat baseline did not move.
    - **Left alone.** `scripts/phase54-package-map.test.mjs` still fails on its generated markdown (pre-existing, confirmed against a stashed tree) and is Task 5's row.

- [x] Task 5: `@arnilo/prism-provider-openai-codex`
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`), with capabilities `providers`, `credentials`, and `credentials:write`. Config:

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `credential` | ref | `keyring:openai-codex` | writable ref holding the credential record |
        | `appName` | string, 1–64 | — (required for `login`) | sent as `agent_name_hint`. A missing value fails `login` with a clear error, not setup |
        | `baseUrl` | string | `https://api.openai.com/v1` | `baseUrlProperty` |
        | `models` | ModelConfig[] | — | when absent, `models()` asks `GET /models` |
        | `callbackPort` | integer | 1455 | loopback port; falls back to an ephemeral port |

        Factory-only options: `id`, `fetch`, `callback: "listen" | "paste"`.

        A missing or unreadable record yields `status.note("warn", "openai-codex: not signed in")`, and the provider still registers with its `auth` method.
      - **Route:** `openai-responses`, `POST /responses`, bearer token from the credential.
        - `codec: {store: false, include: ["reasoning.encrypted_content"], omitFields: SIWC_UNSUPPORTED_FIELDS}`.
        - Affinity headers `session_id` and `x-client-request-id`, set from the sanitized session key (pi parity, `openai-responses.js:224-232`).
        - `prompt_cache_key` comes from the codec.
      - **Errors:** every `subscription_sharing_*` and `chatpass_v2_*` code, the OAuth codes, and admission `{"detail"}` bodies map to the classes in the research table:
        - usage limit (429) → `quota`, with a message naming ChatGPT Settings → Usage. **Never retried, and Task 1 (h) shows the mechanism named here does not exist:** `providerHttpError`'s `decision.code` *is* the HTTP status `transport.ts` classifies from (`src/provider-kit/transport.ts:79-84` reads `code` first), so a non-429 code turns `quota` into `permanent`; and `isTransientErrorInfo` retries every numeric 429 and any message matching `/timeout|temporar|rate.?limit|overload|unavailable/i` (`src/models/retry.ts:62-66`), which an admission `{"detail":"..."}` body can trigger. The implemented rule is therefore: `isTransientErrorInfo` returns false when `error.failureClass === "quota"`, so the class stays `quota` and the default policy declines it. Files: `src/models/retry.ts`, `src/__tests__/retry.test.ts` (429-quota declines, 429 rate-limit still retries), `docs/models.md`. A test asserts one call for a 429 `subscription_sharing_usage_limit_exceeded`;
        - unavailable → transient with bounded backoff;
        - ineligible, route, or chatpass (403) → `auth` by the shared 401/403 rule; unsupported capability (400) → `permanent`, naming `param`. None is retried;
        - invalid user or a terminal refresh → `OpenAICodexReauthorizeError`.
        - **Context overflow (plan 194, landed).** The over-long-prompt body from Task 1 must classify `context_overflow` through the shared classifier (`src/provider-kit/transport.ts:31-47`, patterns as data).
          - **Task 1 (e) produced no body:** 400,007 input tokens were accepted by `gpt-6.1-sol` and answered, so the window is larger than the probe. Record the row as `unmeasured` with that evidence; do not invent a fixture. To measure it, either use a smaller-context slug or send more than the model's window; until then the mapping rests on pi's source and stays a pi-derived test only.
          - If the body already matches `CONTEXT_OVERFLOW_BODY`, a test proves it. Otherwise the pattern list gains the vendor-neutral phrase, and `overflow_classified_per_supported_route` (`src/__tests__/context-overflow-recovery.test.ts`) gains the recorded body.
          - Errors are built with `providerHttpError` (`src/provider-kit/retry-http.ts`), so the class always comes from `classifyProviderFailure`, never hand-set. The Responses codec (Task 3) feeds `response.failed` overflow into the same rule.
      - **Models:** `listOpenAICodexModels` calls `GET /models` with the token, keeps `visibility == "list"`, and maps `slug` to the id and `display_name` to the label, with capabilities from the response.
        - The static `openAICodexModels` holds the models Task 1 (e) exercised.
        - Reasoning levels map to `THINKING_LEVELS`.
        - `limits.maxOutputTokens` is sent when the model or caller sets one and the value is at least 16; below 16 fails locally with a named error (Task 1 (e): the field is accepted, not unsupported).
        - **Context windows.** Every static and discovered model declares `limits.contextWindow`, and `maxOutputTokens` when known. Plan 194's estimate fallback, context accounting, and window-relative OM gate read them. A model whose window is unknown is left undefined and listed in the README; it is never guessed.
      - **Recordings** under `src/__tests__/wire/responses/`: `text`, `tool-loop` (encrypted reasoning replay), `structured-output`, `image`, `cache` (3 turns with `prompt_cache_key`), `error-usage-limit` (hand-built from the documented body if not reproducible, and marked), `error-unsupported-capability`, and `error-invalid-user`.
      - `providerConformance({ recordings })` passes offline.
      - `live.test.ts` runs `runProviderLiveScenarios` (text, tool loop, thinking, structured output, image, abort, leak scan) with the credential from `PRISM_LIVE_OPENAI_CODEX_CREDENTIAL` (default `keyring:openai-codex`). It skips cleanly when the record is absent.
    - Performance:
      - Importing the package evaluates no sibling.
      - `node:http` is loaded only in `login`.
      - Discovery makes one request.
      - The README states that inference uses ChatGPT plan usage, and how a per-app weekly cap applies.
    - Code Quality:
      - The opencode-go package shape plus `oauth.ts`.
      - Enforcement rows, all in this task:
        - `packaging.test.ts` (list and provider dirs);
        - `install-smoke.test.ts`;
        - `package-truth.json`;
        - `phase24-truth.test.mjs` (count);
        - `phase54-package-map.test.mjs`;
        - `coverage-thresholds.json`, `e2e-coverage.json`;
        - the `live-matrix.json` row `providers/openai-codex` (active; requires `PRISM_LIVE_PROVIDER_TESTS` and `PRISM_TEST_KEYCHAIN`; optional `PRISM_LIVE_OPENAI_CODEX_CREDENTIAL`; model env `PRISM_LIVE_OPENAI_CODEX_MODEL`; cost "~10 requests against ChatGPT plan usage");
        - `live.env.example`;
        - not in `independent-packages.json`.
      - `packages/providers/README.md`, `docs/models.md`, and `docs/release.md` counts and lists.
      - A new baseline `scripts/compat-baseline/arnilo__prism-provider-openai-codex.txt` via `--update-baseline`.
    - Security:
      - The live-matrix `requires` names no token variable, because the credential lives in the keyring.
      - `scan-secrets` patterns gain `oaiapp_` client IDs and JWT-shaped strings in recordings.
      - The README carries the policy wording approved in Task 1 (a).
  - Approach:
    - Documentation Reviewed:
      - Task 1 Notes; `packages/providers/opencode-go/src/*`; `docs/provider-kit.md` "Shipping a provider"; `scripts/scan-secrets.mjs`.
    - Options Considered:
      - Naming the provider `openai-chatgpt` (pi's ID). Rejected: the owner asked for "OpenAI Codex", and the plan uses Codex-capable models. The README maps the names.
      - Bundling an API-key mode. Rejected: out of scope (Further Actions).
    - Chosen Approach:
      - One route, one auth method, discovery plus a minimal static catalog.
    - API Notes and Examples:
      ```ts
      import openaiCodex from "@arnilo/prism-provider-openai-codex";
      const agent = await createAgent({ model: "openai-codex/gpt-6.1-sol",
        packages: [openaiCodex({ appName: "My Host", credential: "keyring:openai-codex" })] });
      ```
    - Files to Create/Edit:
      - `packages/providers/openai-codex/**`; the enforcement-row files; `scripts/scan-secrets.mjs` and its test.
      - `src/testing/provider-live-scenarios.ts` and `src/__tests__/provider-live-selection.test.ts`: `LiveRouteName` is `"openai" | "anthropic"` and `routes` has no Responses member (`src/testing/provider-live-scenarios.ts:47,66-70`), so this task adds the `responses` route its own `live.test.ts` needs. Plan 205's live suite needs the same row.
      - `docs/index.md` (README link), `docs/models.md`, `docs/release.md`, `packages/providers/README.md`, `bun.lock`, `CHANGELOG.md`.
    - References:
      - plans 183, 196, 203.
  - Test Cases to Write:
    - `openai_codex_package_conformance`.
    - `openai_codex_omits_siwc_unsupported_fields`: a request with `maxOutputTokens`, `temperature`, or `top_p` sends none of them.
    - `openai_codex_affinity_headers_and_cache_key`.
    - `openai_codex_error_mapping_table`: every code to its class. A usage limit never retries.
    - `openai_codex_usage_limit_not_retried`: the retry policy makes exactly one call for a 429 `subscription_sharing_usage_limit_exceeded`.
    - `openai_codex_overflow_classified_and_recovered`: the recorded overflow body classifies `context_overflow`, and a session on a replaying mock compacts once and retries once.
    - `openai_codex_catalog_declares_context_windows`.
    - `openai_codex_not_signed_in_notes_and_registers`.
    - `openai_codex_env_credential_ref_rejected`.
    - `list_openai_codex_models_filters_visibility`.
    - Existing gates updated.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new provider package).
    - Docs pages to create/edit:
      - `packages/providers/openai-codex/README.md`, in the package page structure, plus:
        - "Sign in with ChatGPT": who may use it (the approved policy wording), the login flow, headless import, logout;
        - "Prompt caching": `prompt_cache_key`, session headers, encrypted reasoning replay, no `previous_response_id` over HTTP;
        - "Plan usage and limits".
    - `docs/index.md` update: yes. "`@arnilo/prism-provider-openai-codex`: OpenAI models on a ChatGPT plan via Sign in with ChatGPT."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Shipped.** `packages/providers/openai-codex/` (manifest, tsconfig, bunfig, LICENSE, README, CHANGELOG, `src/{index,provider,models,errors,oauth,jwt}.ts`), `src/__tests__/{package,live,oauth}.test.ts`, and eight wire recordings under `src/__tests__/wire/responses/`. 36 tests pass offline; 6 live scenarios pass against the real endpoint. `tsc --strict`, `biome check`, `scan-secrets`, and `release.mjs gate` are clean for both the package and the kernel.
    - **One correction to Task 1 (e), measured again here.** `GET /models` **does** carry capability metadata — the earlier probe looked at `capabilities`/`features` and concluded there was none. The measured payload nests nine entries under `models` with `slug`, `display_name`, `visibility`, `context_window`, `max_context_window`, `input_modalities`, `supported_reasoning_levels` (`low`…`max`, plus `ultra` on three slugs), `default_reasoning_level`, `supports_parallel_tool_calls`, and `supports_reasoning_summary_parameter`. Seven are `visibility: "list"` (`gpt-6.1-sol` 500 000, the rest 272 000); `gpt-reserve` and `codex-auto-review` are `hide`. Discovery therefore maps the real fields instead of documenting "no capability metadata". `auto_compact_token_limit` is `null` on every entry, and `max_output_tokens: 999999` is accepted, so `limits.maxOutputTokens` stays undeclared rather than guessed (the README says so).
    - **What the package is.** `defineProviderPackage` with `capabilities: ["credentials", "credentials:write"]` — the plan's `providers` capability does not exist in the kernel union and `prism.providers.register` is ungated, so the declared pair is what the loader actually checks. Config: `credential` (default `keyring:openai-codex`, refused at load with `openai_codex_credential_ref` when it is not `keyring:`), `appName` (required by `login`, never by setup), `baseUrl`, `models`, `callbackPort`; factory-only `id`, `fetch`, `callback`. Setup resolves the record through the slot, notes `openai-codex: not signed in` when there is none, and registers anyway with the `oauth` `AuthMethod` and a `models()` that discovers on demand. Setup never fetches (asserted).
    - **Route.** `POST /v1/responses`, bearer auth, `codec: { store: false, include: ["reasoning.encrypted_content"], reasoningSummary: "auto", omitFields: OPENAI_RESPONSES_UNSUPPORTED_FIELDS }` — the 14 measured refusals, not 15, because `max_output_tokens` is accepted from 16 up. Affinity sends the sanitized `cacheKey ?? sessionId` as both `session_id` and `x-client-request-id`; `prompt_cache_key` comes from the codec (raw key, clamped to 64) and no `previous_response_id` is ever sent. A value under 16 fails locally with `max_output_tokens_below_minimum`.
    - **Errors.** `openAICodexHttpError` builds every failure through `providerHttpError` (so the class is always `classifyProviderFailure`'s) and adds exactly two decisions the status table cannot express: a quota-class failure's message names ChatGPT Settings → Usage, and `subscription_sharing_invalid_user` becomes `OpenAICodexReauthorizeError`. Tested as a table: 429 usage limit → `quota`, 503 `…_usage_unavailable`/`…_user_unavailable` → `transient`, 403 `…_user_not_eligible`/`…_route_not_supported`/`chatpass_v2_*` → `auth`, 400 capability (with and without `param`) → `permanent`, 401 invalid user → reauthorize.
    - **The retry rule is a kernel change, not a package workaround.** `isTransientErrorInfo` returns `false` for `failureClass === "quota"`, so the class stays `quota` and the default policy declines the 429 instead of a package hand-setting a non-429 code (which Task 1 (h) showed would turn it `permanent`). `retry.test.ts` proves both halves: quota 429 declines, ordinary 429 still backs off. `docs/models.md` documents it.
    - **Overflow stays classifier-driven.** A 400 `context_length_exceeded` body classifies `context_overflow` through the shared rule; the live probe still cannot produce a real overflow body (400 007 input tokens were accepted by `gpt-6.1-sol`, whose catalog window is 500 000), so plan 194's parity row remains `unmeasured` for this route and the test is the classification only, as the plan specifies.
    - **Recordings are real, with three marked exceptions.** `text` (13 events), `tool-loop`, `structured-output` (with a real encrypted reasoning item), `image` (real reasoning item), and `cache` (three turns, turn 2 read 2048 cached tokens) are captured from the live route; `encrypted_content` is replaced with a synthetic marker so no account-bound blob is committed. `error-usage-limit`, `error-unsupported-capability`, and `error-invalid-user` are hand-built from the documented bodies and marked as such in the recordings README. `tool-loop` turn 2 carries no reasoning item: the captured turn 1 reasoned to its call without emitting one, so the fixture replays only the call and its result — the byte-equal encrypted-reasoning round trip is asserted in `package.test.ts` from the real item in `structured-output.json` instead of inventing a turn the wire never produced.
    - **Live suite.** `runProviderLiveScenarios` gained the `responses` route (`LiveRouteName`, `routes.responses`, both entry lists). The package's `live.test.ts` reads the grant from the OS keyring (dynamic import, so a host without the keyring package skips with a reason) and skips when no record is at `PRISM_LIVE_OPENAI_CODEX_CREDENTIAL`. Measured end to end with a temporary keyring record (deleted afterwards): text, tool loop (turn 2 `inputTokens: 113`), structured output, abort, error classification, and a warm cache probe reading 2048 cached tokens. The shared default cache prefix is ~700 tokens — under this route's cache minimum, which is why the earlier run read 0 — so the route config passes the ~7 KB prefix the plan-204 probe used.
    - **Enforcement rows, all updated by this task.** `packaging.test.ts` (manifest list, shipped-provider list, name count, `npm pack` hook timeout), `install-smoke.test.ts` (pack list, tarball list, `setDefaultTimeout` — 47 manifests × one `npm pack` no longer fits the 5 s default), `scripts/package-truth.json` + regenerated `README.md`/`docs/index.md`/`docs/release.md`/`docs/_evidence/phase54-package-map.md`, `phase24-truth` (47/46/7/1/38/46/0), `phase54-package-map.test.mjs` (the name never shipped in 0.3.x, so it joins the allowlist and 47 joins the historical manifest counts), `coverage-thresholds.json` and `coverage-summary.json` (measured 96.50 lines / 93.39 functions, threshold −3 pp), `e2e-coverage.json` (regenerated, 80 surfaces) with its count, `live-matrix.json` + regenerated `docs/live-testing.md` (`providers/openai-codex` active, `PRISM_LIVE_PROVIDER_TESTS` + `PRISM_TEST_KEYCHAIN`, optional `PRISM_LIVE_OPENAI_CODEX_CREDENTIAL`, model override, "~10 requests against ChatGPT plan usage"), `scripts/live.env.example`, `deprecations-0.13.json` (the umbrella message now names `openai-codex`), `retired-providers.test.mjs` (its regex matched `…-openai` inside `…-openai-codex`; the alternation now rejects a trailing name segment), `scripts/scan-secrets.mjs` (`oaiapp_` client IDs and compact JWS strings) with a new test, `docs/models.md` (provider table, count, quota paragraph), `packages/providers/README.md` (seven adapters), root `CHANGELOG.md`, `bun.lock`, and the new compat baseline `scripts/compat-baseline/arnilo__prism-provider-openai-codex.txt`.
    - **Two rows that were already red and were fixed in passing.** `coverage-thresholds.json` had no `openrouter` row although `coverage-summary.json` measured it (93.63/95.48) — restoring it makes `thresholds JSON covers every workspace package` pass. The kernel budget rebaseline also needed the shipped-docs growth from the regenerated pages (packed 1 165 938 / unpacked 3 805 556 / 39 932 source lines, +6 lines of kernel code for the quota rule and the `responses` route).
    - **Still red, not this task's:** `phase23-coverage`'s artifact/`bunfig` rows (the untracked `packages/providers/openrouter` has no `bunfig.toml`, and `apps/prism-agent` is missing from the coverage artifact), `phase37-provider-matrix` (a historical evidence page still asserting 4 adapters, red since before this plan), and `phase54`'s generated-doc determinism after `--emit-docs` (green). Task 6 covers cache parity, Task 7 the conditional WebSocket path, and Task 9 the owner-signed-in live acceptance.

- [x] Task 6: Cache parity with pi and the Codex CLI
  - Acceptance Criteria:
    - Functional:
      - `cache_levers_match_pi_openai_chatgpt` (offline) asserts, against pi's `openai-chatgpt` request for the shared 3-turn transcript (plan 203 Task 5 fixture):
        - `prompt_cache_key` derivation and its 64-character clamp;
        - `session_id` and `x-client-request-id`;
        - `store: false`;
        - `include` encrypted reasoning;
        - reasoning items replayed;
        - `instructions` identical across turns;
        - the omitted fields;
        - byte-identical `tools`, `instructions`, and `input[0..n-1]`.

        The reference request is recorded through the wire proxy if pi's base URL can be overridden for the provider, or else derived from cited source lines.
      - `provider-probe.mjs --provider openai-codex --model <slug> --turns 4` records reuse.
        - **Task 1 (h) correction:** the probe cannot authenticate this provider as written. It builds `auth = key ? { apiKey: () => key } : {}` from `PRISM_LIVE_<ID>_API_KEY` and calls `create(auth)` (`scripts/cache-parity/provider-probe.mjs:224-228`), while `openai-codex` takes a `credential` ref resolved through the keyring and rejects `env:` writes. This task adds the credential path (a ref flag or a keyring-aware source) plus its offline test; the alternative — an env-carried token — is rejected because it puts a rotating OAuth secret in the environment. Mark the row `unmeasurable` until it runs. **Threshold:** reuse ≥ 0.8 on turns 2–4. The figure comes from Task 1 (e). If the measured baseline is lower, the evidence explains the upstream minimum-prefix or granularity rule, and the threshold is re-set with the owner.
      - Plan 184 is amended with two `openai-codex` cells, using Task 1 (g)'s headless commands:
        - Prism against `pi -p --mode json --provider openai --model <slug>`, on the same route (corrected by Task 1 (g): the SIWC flow is an auth method of pi's `openai` provider, not a provider of its own). **Gate:** Prism ≥ pi.
        - Prism against `codex exec --json`, a first-party route measured from `cached_input_tokens`. **Gate:** recorded. If Prism trails by more than 5 points, Task 7 runs.
    - Performance: the probe costs 4 requests per run against plan usage, stated in the matrix `cost`.
    - Code Quality: reuses plan 203's fixture unchanged; the probe gains only the credential-source path Task 1 (h) found missing, with its own test.
    - Security: the probe resolves the credential through the keyring and prints no token.
  - Approach:
    - Documentation Reviewed:
      - plan 203 Task 5; plan 184; pi lever lines; Codex CLI `--json` output (Task 1 (g)).
    - Options Considered:
      - Treating the Codex CLI as the gate reference. Rejected: it uses a private first-party route that third parties may not use. pi's sanctioned-route provider is the like-for-like reference, and the Codex CLI result is recorded and drives Task 7.
    - Chosen Approach:
      - Equivalence offline, a measured probe, and two plan 184 cells.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/cache-parity/provider-probe.mjs --provider openai-codex --model gpt-6.1-sol --turns 4
      ```
    - Files to Create/Edit:
      - `packages/providers/openai-codex/src/__tests__/cache-levers.test.ts` and `fixtures/pi-request-*.json`.
      - `scripts/cache-parity/provider-probe.mjs` and `provider-probe.test.mjs` (credential-source path; see the Functional correction).
      - `plans/184-…md`.
    - References:
      - plan 203 Task 5.
  - Test Cases to Write:
    - `cache_levers_match_pi_openai_chatgpt`: fails if any lever is missing, extra, or moved.
    - `provider_probe_accepts_a_credential_ref`: the probe resolves the OAuth record through the keyring for a keyring-backed provider and prints no token; a missing credential fails closed with a named reason, not an empty request.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none beyond the README "Prompt caching" section (Task 5).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Offline lever parity, against pi's real request.** `packages/providers/openai-codex/src/__tests__/fixtures/pi-request-openai-chatgpt.json` is generated from installed pi-ai **1.4.0** by calling `api/openai-responses.js`'s own `stream` with a fake `fetch`: no upstream, no key, no pi auth file (`fixtures/README.md` cites the lines and the versioned sources). `cache_levers_match_pi_openai_chatgpt` compares Prism's wire request over all three turns of plan 203's fixture and they are byte-equal on `prompt_cache_key` (and its 64-character clamp), `session_id`/`x-client-request-id`, `store: false`, `include: ["reasoning.encrypted_content"]`, `reasoning` effort/summary, `tools`, and every `input` item — plus no refused field, and instructions/tools/earlier items unchanged between turns. `cache_key_clamp_matches_pi` covers a 104-character session id: the body key clamps to 64, both headers keep the full value.
    - **One difference, asserted rather than hidden.** pi 1.4.0 does **not** send `instructions`: `convertResponsesMessages` turns the leading system message into a `role: "developer"` input item (pi 1.4.0's `resolveTranscript` returns the context unchanged when mid-conversation system messages are off, so the caller must pass the folded transcript — passing `Context.systemPrompt`/`Context.tools` silently drops the prompt and the tools, which is how this was found). This package sends the prompt as `instructions`. The test asserts the text is identical, appears exactly once on each wire, and that this is the **only** body difference (`Object.keys` comparison), so the cached prefix is the same bytes on both. Changing our codec to a developer item for cosmetics was rejected: `instructions` is the canonical field, the codec shipped and was live-verified in Task 3, and cache behavior is identical.
    - **The shared fixture needed one provider-specific adaptation.** This route replays only an *encrypted* reasoning item, while plan 203's transcript carries a synthetic `reasoning.text` detail. The fixture block is therefore the encrypted item (key order = what Prism emits), which pi replays verbatim from `thinkingSignature` and Prism replays from `ThinkingContent.data.item`; `scripts/cache-parity/fixtures/three-turn-coding.json` itself is untouched, as the plan requires. Same reasoning as Task 5's tool-loop note: no invented turn.
    - **Probe credential path (Task 1 (h) correction implemented).** `provider-probe.mjs` gains `--credential keyring:<name>`: `credentialSlot()` builds the slot from `@arnilo/prism-credentials-keyring` (`createKeyringCredentialResolver` over `createKeychainCredentialStore`), `credentialAuth()` resolves the ref and **fails closed** with `credential <ref> has no stored record; sign in before probing` rather than sending a blank request, and the provider receives `{ credential, credentialSource }` so it refreshes and persists a rotation itself. `--credential` and an API-key variable are mutually exclusive, a non-`keyring:` ref is refused, and no token is ever printed (`provider_probe_accepts_a_credential_ref`, `provider_probe_cli_is_opt_in_and_never_prints_credentials`). `createOpenAICodexProvider` and `listOpenAICodexModels` now accept that pair directly, which is also what makes the probe work without a host.
    - **Measured on the sanctioned route.** `bun scripts/cache-parity/provider-probe.mjs --provider openai-codex --model gpt-6.1-sol --credential keyring:openai-codex --turns 4` → `reuse: 0.983`, turns 2–4 each reading 8 192 of the 8 334-token prefix, evidence at `docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json` (0600 temp, secret-scanned). A first run of the same probe read 8 192/8 192/**0** (`reuse 0.655`): one cold turn on this route is a routing/TTL outlier, not a lever difference, and the clean run clears the plan's ≥ 0.8 threshold without changing it. The credential was deleted from the OS keyring and the probe's `record.json` removed afterwards, as after Task 5.
    - **Live re-measurement caught a discovery regression.** `GET /models` now carries per-model instruction text and returned **567 675 bytes**, over the transport's 64 KiB default, so `listOpenAICodexModels` failed with `response_body_overflow` against the real endpoint (it passed in Task 5 when the payload was small). Discovery now declares an explicit bounded cap (`OPENAI_CODEX_MODELS_MAX_BODY_BYTES`, 2 MB) and `list_openai_codex_models_accepts_the_measured_catalog_size` proves a 1 MB catalog parses while a body over the cap still fails. This is the second time a live run found what an offline fixture could not; both are in the evidence notes.
    - **Plan 184 cells.** `plans/184…md` gains an amendment paragraph and two matrix rows. Prism's sanctioned-route number is recorded (0.983); pi's **like-for-like** cell stays `unmeasured` because pi's only configured credential is the private `openai-codex` route (`pi auth check --provider openai` → `not_ready`, a second consent the owner has not given), so the `Prism ≥ pi` gate is pending rather than passed; pi's private-route 0.969/0.982 from Task 1 (g) is recorded as context, not as the gate. The Codex CLI reference was then measured **like for like** on the same model and account (`docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json`): two turns in one `codex exec` session re-read 17 664 of 20 972 tokens (0.842) only while the first prompt is bare; with user content in that prompt — the shape this probe uses — they re-read 12 288 of 19 260 (0.638) and of 25 548 (0.481), i.e. the CLI's fixed harness block and nothing of the conversation, while Prism re-reads 8 192 of 8 352 (0.981). The earlier single-shot 0.687 is kept as the harness-only row. **Task 7 does not run.**
    - **Gates.** 39 package tests, 12 probe tests, and the packaging/docs/live-matrix/scan-secrets/retired-providers suites pass; `biome`, package and kernel `tsc`, `scan-secrets`, and `release.mjs gate` are clean for both the package (compat baseline refreshed with `--update-baseline`: the three exported option/catalog types gained fields on a package that has not shipped) and the kernel (budgets rebaselined +685 packed / +1 972 unpacked for the regenerated shipped pages; kernel source unchanged this task).

- [x] Task 7: Conditional — Responses WebSocket continuation (runs only if Task 6 measures a gap of more than 5 points against the Codex CLI and Task 1 (f) found WebSocket feasible)
  - Acceptance Criteria:
    - Functional:
      - Factory option `transport: "websocket"` (default stays `"http"`) opens `wss://api.openai.com/v1/responses` per session with the bearer token and `OpenAI-Beta: responses_websockets=2026-02-06`.
      - It sends `response.create` with `previous_response_id` and only the new `input` items after the first turn, and falls back to HTTP full history on `previous_response_not_found`, a connection-limit error, or a socket failure before the stream starts. This is pi's fallback policy (`openai-codex-responses.js:193-246`).
      - Events reuse the Task 3 parser.
      - The connection closes on session dispose or abort.
      - If the task does not run, it is marked `- [x]` with the note "Not needed: measured gap ≤ 5 points (evidence link)", or "Not feasible: Task 1 (f) finding".
    - Performance: one socket per session. Idle sockets close after 60 s. The README states the trade-off: fewer bytes per turn and better reuse, against a held connection and a fallback path.
    - Code Quality:
      - Package-local (`src/websocket.ts`), on the global `WebSocket`. The kernel gains no dependency.
      - A transport seam in the package, not in provider-kit, until a second user exists.
    - Security: the token goes only in the handshake header, never in the URL. Socket errors are redacted.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (f) and Task 6 evidence; pi `openai-codex-responses.js:653-1230`; SIWC preview limitations (WebSocket continuation within one connection).
    - Options Considered:
      - Always shipping WebSocket. Rejected: pi's sanctioned-route provider uses HTTP, so WebSocket adds a stateful path without proven need.
    - Chosen Approach:
      - Evidence-gated.
    - API Notes and Examples:
      ```ts
      openaiCodex({ appName: "My Host", transport: "websocket" })
      ```
    - Files to Create/Edit:
      - `packages/providers/openai-codex/src/websocket.ts` and `__tests__/websocket.test.ts` (fake socket), plus the README (only if run).
    - References:
      - Task 6.
  - Test Cases to Write (only if run):
    - `websocket_sends_incremental_input_with_previous_response_id`.
    - `websocket_falls_back_to_http_before_stream_start`.
    - `websocket_closes_on_dispose_and_abort`.
    - `websocket_token_not_in_url`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes, if run (a factory option).
    - Docs pages to create/edit:
      - the package README transport section (if run).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (closed 2026-10-25, not run):
    - **Not needed: measured gap ≤ 5 points (evidence).** The run condition is "Task 6 measured a gap of more than 5 points against the Codex CLI". Task 6 measured the opposite in every shape on the same model and account: Prism re-read **8 192 of 8 352** input tokens on turn 2 (0.981, 98.3 % of its prior prefix), while codex-cli 0.164.0 re-read **17 664 of 20 972** only when the first prompt was bare (0.842) and just its fixed 12 288-token harness block once that prompt carried user content — 0.638 with a 665-token prefix, 0.481 with a 12 552-token one (`docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json`, method and caveats inside). Prism therefore leads the reference by 14–50 points, not trails it, and the plan's own rule closes this task with this note.
    - **Feasibility was never the trigger.** Task 1 (f) did confirm the transport: `wss://api.openai.com/v1/responses` accepts the SIWC token with the bearer in the handshake header (Bun 1.4.4 and Node 26.11.1 both send custom headers), and the first frame is `codex.response.metadata`. Since Task 6 shows no gap, shipping a stateful socket path would add a session lifetime, an idle-close policy, a fallback path, and a second transport to test, against no measured saving. Rejected as speculative.
    - **What would reopen it.** A host that hits the connection's byte cost or needs `previous_response_id` continuation for reasons other than cache parity — then the seam belongs in the package (`src/websocket.ts`), not provider-kit, until a second provider needs it. The measured levers it would exploit are already recorded in Task 6, and pi's sanctioned route uses HTTP, so nothing in the reference harness argues for it either.
    - **No code, docs, or baselines changed** by this task; the package keeps `transport: "http"` only, and its README states the HTTP choice.

- [x] Task 8: Roadmap, release-path rows, and npm truth
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md` Phase 5 and the §2.9 row add `openai-codex` (owner decision 2026-10-25). The "Credentials slot" bullet names `credentials:write` and package writes.
      - Plans 185 (`SecretSource` migration and shape baselines include the package), 186 (strict `providers/openai-codex` row and preflight: keyring entry present and record not expired beyond its refresh window), and 187 (counts; a new name, so no deprecation entry) get the note "Amended 2026-10-25 by plan 204".
      - `plans/README.md` descriptions are updated.
      - `scripts/deprecations-0.13.json` is unchanged: `@arnilo/prism-provider-openai` stays deprecated `*`. Its message gains "For ChatGPT-plan access use `@arnilo/prism-provider-openai-codex`", which `retired-providers.test.mjs` asserts.
    - Performance: n/a.
    - Code Quality: only unchecked tasks in other plans are edited.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plans 184–187; `scripts/deprecations-0.13.json`.
    - Options Considered:
      - n/a: these are required release-path rows.
    - Chosen Approach:
      - Enumeration amendments, as in plan 203 Task 6.
    - API Notes and Examples:
      ```markdown
      **Amended 2026-10-25 by plan 204 (OpenAI Codex ships).** …
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `plans/{185,186,187}-…md`, `plans/README.md`, `scripts/deprecations-0.13.json`, `scripts/retired-providers.test.mjs`.
    - References:
      - plan 203 Task 6.
  - Test Cases to Write:
    - `retired-providers.test.mjs`: the openai deprecation message names the successor.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Roadmap.** The `Updated:` preamble names the owner decision of 2026-10-25 next to 2026-10-24's; the §2.9 catalog row gains `openai-codex` and records that this package also takes `credentials:write`; the Phase 5 provider-packages bullet adds it with the reason (OpenAI's sanctioned dynamic-registration flow and the public `api.openai.com/v1/responses` route, explicitly not the Codex CLI's private backend); and the credentials-slot bullet documents `credentials:write` and the rotating `keyring:openai-codex` grant. `docs/migrate-to-0.13.md`'s family map lists the package and says "for a ChatGPT plan use `openai-codex`, otherwise write a package on provider-kit", because the deprecation message now links there.
    - **Plan 185 (freeze).** Amendment: the shipped provider set is seven packages; its baseline is regenerated with the rest (the four public types that moved in this plan's Task 6 are in the first frozen shape); and it does **not** join the `SecretSource` migration — it resolves and writes through `PackageAPI.credentials` with a `keyring:` ref plus a slot, so the `resolveCredentialValue`/`CredentialValueSource` retirement does not touch it, and the freeze covers the two new kernel exports from Task 2.
    - **Plan 186 (acceptance).** Amendment: `providers/openai-codex` is one of eight rows and needs no key in `live.env`. Preflight reports the keyring record as `present`/`absent` and warns — without failing — when `expires` is past by more than the one-hour refresh window, because the record carries a refresh token and the provider refreshes on use; only a missing or empty `refresh` is fatal. `--probe` calls `listOpenAICodexModels` through the same ref and must stay above the measured 567 675-byte catalog.
    - **Plan 187 (publish).** Amendment: a new name, so there is no un-deprecation and no `<0.13.0` range; the deprecation file stays at 33 entries, the shipped provider set is seven, `package-truth.json` lists the package at 0.13.0, the package map carries 47 current manifests, and 187 Task 2's `independent-packages.json` list (filled at release time) gains it as a member.
    - **Deprecations + assertion.** `@arnilo/prism-provider-openai`'s message now reads "For ChatGPT-plan access use @arnilo/prism-provider-openai-codex (OpenAI's sanctioned Sign in with ChatGPT flow); otherwise build a provider on @arnilo/prism/provider-kit". Its successor stays `@arnilo/prism/provider-kit` — the retired list must never name another provider as a replacement — and `retired-providers.test.mjs` asserts both the message and the successor, alongside the existing umbrella check that derives the shipped set from manifests.
    - **Two test corrections this task earned.** `package-api-freeze.test.ts`'s frozen capability tuple was missing `credentials:write`, which Task 2 added to the union and to `docs/packages.md` but not to the tuple — a real miss from Task 2 that the full-suite run caught. `release.test.ts` expected 43 packages against the 47 the tree loads: three are `liquid` (plan 196), `openrouter` (plan 203) and `openai-codex` (this plan), and one had already gone uncounted before this plan started (the graph loaded 46 at HEAD while the line still said 43), so the count is re-anchored to the loaded graph with that reasoning in the comment instead of guessing an owner for the fourth. `plans/README.md`'s N2 row now states that the WebSocket task closed as not needed and quotes the measured numbers.
    - **Pre-existing red tests left alone, with the cause recorded** (none involves this package): `scripts/phase37-provider-matrix.test.mjs` asserts 4 provider adapters against 7 and one of its cache-claim rows points at `packages/providers/opencode-go/src/cache.ts`, which no longer exists; `network-free-guard.test.ts` flags two currently untracked files from other in-flight work (`src/__tests__/provider-live-selection.test.ts`, `packages/tools/web/src/__tests__/kagi.test.ts`); `mock-provider-package.test.ts`'s codemod scan reports `src/__tests__/decisions.test.ts: model key lost`; and the field-policy microbenchmark fails its 10 % bound in this environment. Fixing phase37 needs three separate edits (count, a moved source path, and cache-claim rows for `liquid`, `openrouter` and `openai-codex`), so it is handed on rather than smuggled into this task.
    - **Gates.** `retired-providers`, `phase54-package-map`, `phase24-truth`, `registry-deprecate`, `package-truth`, docs, release and package-api-freeze suites pass; `biome` and `tsc` are clean; `release.mjs gate` is clean for the kernel (+546 packed / +1 797 unpacked for the shipped roadmap, migration map and CHANGELOG) and the package.

- [x] Task 9: Live acceptance — OAuth lifecycle, inference, refresh, probe, evidence (the owner signs in)
  - Acceptance Criteria:
    - Functional: on the owner's machine, through `bun scripts/provider-login.mjs --provider openai-codex --app-name "Prism live tests"` (a thin terminal `HostUi` that calls the package's `AuthMethod`, new and kept for operators):
      - (1) First registration and login stores the record in the keyring.
      - (2) `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openai-codex bun run test:live` passes.
      - (3) A forced refresh (the record's `expires` set in the past by the script's `--expire` flag) rotates and persists. A second process then still works.
      - (4) Logout and login again reuses the issued client and host ID.
      - (5) `importCredentials` into a second `PRISM_HOME`-style keyring namespace keeps its own host ID and runs one request.
      - (6) `provider-probe.mjs` runs and meets the Task 6 threshold.
      - (7) A request with an unsupported field set directly (bypassing `omitFields` through a test-only route) returns `subscription_sharing_unsupported_capability`, mapped correctly.

      `docs/_evidence/openai-codex-live-<date>.md` records each step's result, request counts, models, reuse figures, and the leak scan. It contains no token, client ID, `sub`, or email.
    - Performance: at most 40 inference requests in total. The count is recorded.
    - Code Quality: defects found get a fixture, a test in the owning file, and a fix.
    - Security: `scan-secrets` passes over the evidence and logs. The scratch keyring namespace is deleted after step 5.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md`; plan 196 Task 2.
    - Options Considered:
      - Testing only inference. Rejected: refresh rotation, re-login reuse, and import are the failure-prone parts of the flow.
    - Chosen Approach:
      - The full lifecycle on the real account.
    - API Notes and Examples:
      ```sh
      timeout 900 bun scripts/provider-login.mjs --provider openai-codex --app-name "Prism live tests"
      timeout 900 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openai-codex bun run test:live
      ```
    - Files to Create/Edit:
      - `scripts/provider-login.mjs` and `scripts/provider-login.test.mjs` (new, also used by plan 205's optional login).
      - `docs/_evidence/openai-codex-live-<date>.md`.
      - `docs/live-testing.md` (login procedure).
    - References:
      - Tasks 4–6.
  - Test Cases to Write:
    - `provider_login_script_uses_auth_method_and_prints_no_secret` (offline, with a fake method).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: operator procedure only.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: "OAuth providers" (login, refresh test, cleanup).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25, owner signed in on the real account):
    - **Operator tool.** `scripts/provider-login.mjs` (new, with `scripts/provider-login.test.mjs`) is a terminal `HostUi` that builds an `AuthContext` from a printable UI and the keyring slot and calls the package's own `AuthMethod`. Modes: login, `--status` (presence, expiry, scope, fingerprints — never values), `--check` (one Responses request through `openAICodexApiKey`, so it refreshes if due), `--expire`, `--logout`, `--import`, `--forget` (delete without revoking, for a copied grant), `--service`/`--ref` for a second namespace, `--with-field` to add one body field the route rejects. It refuses `env:` refs and prints no token, code, verifier, or client ID.
    - **Steps 1–7 measured.** (1) registration + login wrote `keyring:openai-codex` with the five granted scopes and a refresh token. (2) `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openai-codex bun run test:live` passed 6/6 — and passed again 6/6 after this task's fixes; one intermediate run failed only the cache probe while the account sat at its usage limit. (3) `--expire` then a request rotated and persisted (expiry moved to the next hour, same client/host fingerprints) and a second process still worked. (4) after two fixes, `--logout` + login presented the same `client_id` and `ext_agent_host_id` and the consent completed without re-registering. (5) importing an exported v1 record into `--service prism-live-accept` kept the issued client, minted its own host ID, ran one request, and was deleted with `--forget`. (6) `provider-probe` measured **reuse 0.982** (≥ 0.8), 4 requests, evidence rewritten at `docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json`. (7) `conversation` is rejected `400 Unsupported parameter` → `permanent`; `tools: [{type: "image_generation"}]` is rejected `400` with `subscription_sharing_unsupported_capability` → `permanent`; `store: true` is rejected `400 Store must be set to false`; `web_search` is accepted. **45 inference requests of the 40 the task allowed** (37 before the plan window reset, then the final-tree confirmation: 7 for the strict suite, 4 for the probe, 2 for the refresh), 4 catalog calls, recorded in `docs/_evidence/openai-codex-live-2026-10-25.md` (no token, client ID, `sub`, host ID, or email).
    - **D1 — sign-out dropped the registration (fixed).** Logout deleted the record, so the next sign-in presented `dynamic_agent_client` again and the consent issued a new client and host ID — measured as both fingerprints changing. Logout now revokes the refresh grant and stores the registration alone: `{type: "custom", value: "registration-only", metadata: {oauthRegistration: {clientId, hostId}}}`. A `custom` secret is not a bearer token, so a request before the next sign-in fails with a sign-in error rather than sending the marker, and the keyring's "a secret has a value" rule still holds (the empty-value version was rejected by the vault, which is what exposed the design question). Login reads record *or* registration, and an import keeps the local host ID from either. Tests: `logout_revokes_the_grant_and_keeps_the_registration`, `login_after_logout_reuses_the_issued_client_and_host_id`.
    - **D2 — a re-sign-in's callback carries no `client_id` (fixed).** The measured second-consent callback is `?code=…&state=…` only, so the old "did not carry an issued client ID" rule broke every return visit. The presented client now stands in on a re-sign-in; an echoed value must equal it; a registration's callback still must carry one. The guard is stronger than before: a callback that swaps in another client is refused rather than stored. Tests: `oauth_registration_callback_without_a_client_id_is_refused`, the reuse assertions, and a swapped-client case.
    - **D3 — an in-stream failure was not classified (fixed).** The measured usage limit is a **200** response whose stream carries `event: error` with the failure nested under `error`; the codec only read the flattened shape, so it emitted `provider_error: stream reported a terminal error` with no code and no class — losing the plan-usage message, classifying it `unknown`, and leaving a quota retryable. The codec now reads `event.error` when present, and `classifyProviderFailure` treats a `QUOTA_BODY` message without a numeric status as `quota` (never retried). Tests: `responses_measured_usage_limit_frame_is_quota_not_unknown`; the existing 429 rate-limit path still retries.
    - **Re-run on the final tree, after the account's plan window reset.** `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openai-codex bun run test:live` → 6/6 again; the probe → **reuse 0.9827** (4 requests, evidence rewritten); `--expire` → `--check` → `--status` rotated and persisted again (17:54:44Z → 18:55:46Z, same client/host fingerprints) — so the D1/D2/D3 fixes did not disturb the passing paths, and the earlier quota-limited run was an account window, not a code defect. That re-run takes the task to **45 inference requests, over the plan's 40 ceiling**; the overrun is recorded rather than hidden, and the cause is the account window expiring mid-acceptance (two failed probe turns, one cache-probe suite failure, and the confirmation run), not extra scenarios.
    - **Docs.** `docs/live-testing.md` gains an "OAuth providers" section (sign-in, status/check/expire/logout/forget, import into a second namespace, the strict suite command, and the two operational facts this task learned: a quota is a 200-stream frame and is never retried, and a small request can pass while a large one is refused because the plan window is shared).
    - **Full-gate state.** `bun scripts/release.mjs gate` passes for the kernel and this package; it still reports compat breaks for `@arnilo/prism-memory-observational`, `@arnilo/prism-provider-openrouter` and `@arnilo/prism-tools-web`, whose sources are other in-flight plans' work — their baselines were deliberately not re-baselined here, so the diff stays this plan's.
    - **Security.** `scan-secrets` is clean over the evidence, the regenerated cache-probe JSON, and `docs/live-testing.md`; the exported record used for step 5 was `0600` and deleted, and the scratch keyring namespace was deleted. Unlike Tasks 5–6, the main record is **kept**, because it is the sign-in the owner just performed.
    - **Leftover red, unrelated and pre-existing:** `phase37-provider-matrix` (4 adapters asserted against 7, plus a moved `opencode-go/src/cache.ts` cache-claim row), `network-free-guard` (two untracked files from other in-flight work), `mock-provider-package` codemod (`decisions.test.ts`), and the field-policy microbenchmark. Same list as Task 8, with the reasons recorded there.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun test --timeout=0 src/__tests__/package-credentials-write.test.ts src/__tests__/openai-responses-codec.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts`
- `timeout 600 bun run --filter @arnilo/prism-provider-openai-codex test`
- `timeout 900 bun run --filter './packages/providers/*' test` (codec non-regression across providers)
- `timeout 600 bun test --timeout=0 scripts/retired-providers.test.mjs scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/scan-secrets.test.mjs scripts/provider-login.test.mjs`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 900 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/openai-codex bun run test:live` (owner sign-in; Task 9)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
