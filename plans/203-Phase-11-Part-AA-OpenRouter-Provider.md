# Phase 11 Part AA — OpenRouter provider

## Objectives

- Ship `@arnilo/prism-provider-openrouter` in 0.13.0 as a first-class provider package. It is built only on `@arnilo/prism/provider-kit`, passes provider conformance on recorded wire, is thoroughly live-tested, and documents OpenRouter's routing, attribution, rate-limit, and data-policy behaviour.
- Reach **prompt-cache parity with pi** (the established harness that supports OpenRouter). Prism must send every cache lever pi sends, measure provider-level prefix reuse live, and add an OpenRouter cell to plan 184's harness-level parity gate.
- Fix the shared OpenAI Chat codec where OpenRouter's documented wire breaks it today:
  - mid-stream error frames;
  - `reasoning_details` replay (merged the way pi merges it);
  - Anthropic-style `cache_control` blocks on the Chat wire;
  - access to the chunk-level served model.
- Build the provider-level cache probe (`scripts/cache-parity/provider-probe.mjs`) that plans 204–206 reuse.
- Reverse the retirement of the `openrouter` name (plan 182, the retired-provider gates, plan 187's deprecation list). Give the release-path plans that enumerate providers (184, 185, 186, 187) their OpenRouter rows.
- Feed OpenRouter's overflow evidence into plan 194's landed context-overflow handling, and declare accurate context windows.

## Expected Outcome

- `createAgent({ model: "openrouter/<model id>", packages: [openrouter] })` streams text, tool calls, reasoning, and structured output. Example refs: `openrouter/anthropic/claude-haiku-4.5`, `openrouter/google/gemma-4-31b-it:free`. Usage carries `cost`, cache counts, and `metadata.openrouter.model` (the served model).
- On a 4-turn fixed transcript, `provider-probe.mjs` shows cache reads on every turn after the first:
  - for a pinned `anthropic/*` model, through `cache_control` blocks plus `x-session-id`;
  - for a pinned implicit-cache model, through `x-session-id` stickiness.

  Prism's cache-relevant request fields equal pi 1.4.0's for the same transcript; an offline equivalence test proves this.
- `packages/providers/openrouter` passes `providerConformance({ recordings })` offline. `providers/openrouter` is an active live row and passes strict.
- `docs/_evidence/openrouter-live-<date>.md` records the first strict run and the probe results.
- Live benchmarks and release acceptance stay on their current providers (owner decision 2026-10-24, revised). This plan does not re-point any live campaign.

This plan implements an **owner decision of 2026-10-24** that changes roadmap **Phase 5** (the shipped provider list): OpenRouter ships in 0.13.0 with first-class support. The decision was revised the same day: live benchmarks do **not** move to `openrouter/free`. On 2026-10-25 the owner added **cache parity with established harnesses** for every new provider.

- **Release path.** This is the first of the two provider plans on the 0.13.0 path, 203 → 204 (OpenAI Codex). Plans 205 (Command Code) and 206 (Ollama Cloud) were deferred to the release after 0.13.0 by the owner on 2026-10-25 and are off this path. The two here run **next**, in that order:
  - **after plan 194 completes** (Tasks 1–5 are done; Tasks 6–7 measure Hyper and OpenCode Go and change the reference host, which these plans do not touch), and before 188.11 (not started) and 197;
  - before plan 185 freezes the surface, and before plan 186's strict provider run.
- **Plan 194 (Tasks 1–5 landed, 6–7 in progress):** the `context_overflow` failure class and its body patterns (`src/provider-kit/transport.ts:31-47`), the estimate-vs-window fallback (`contextOverflowEvidence`, `src/agent-session/session/provider-round.ts:203-229`), one compaction-and-retry recovery (`src/agent-session/context-overflow.ts`), fold batch clearing, and context accounting are in the tree.
  - This plan feeds its routes' overflow evidence into them directly instead of amending 194.
  - It declares accurate context windows, which the fallback, the accounting, and 194 Task 7's window-relative OM gate read.
  - 194 Tasks 6–7 (the rot curve on Hyper and OpenCode Go models, and reference-host triggers) need nothing from this plan.
- **Phase review.** This plan creates a package and changes the kernel's `provider-kit` subpath, so **Task 1 is the phase review**, with **Task 1b** carrying its budgeted authenticated live wire probes.
- **Cache-parity method** (shared by plans 203–206; the last two run after 0.13.0):
  - (1) list every cache lever the reference harness sends, from its installed source (`file:line`);
  - (2) prove offline that Prism sends the same levers for the same transcript;
  - (3) measure provider-level prefix reuse live with `provider-probe.mjs`;
  - (4) add a harness-level cell to plan 184, whose runner and gate measure Prism against the harness on one workload.
- **Keys.** Live keys come from `~/.config/prism/live.env` (owner decision 2026-10-15), which gains `OPENROUTER_API_KEY`. The executor never asks for a key in chat. On 2026-10-24 the owner added the key and set the file to `0600`; **authorization is `openrouter/free` only** — no `anthropic/*` request and no pinned `:free` model until the owner says otherwise.
- **Paid spend.** The `anthropic/*` cache rows need credits and are **not authorized** (Task 1 note (H)'s estimate, under $0.10 total, still stands for whenever the owner approves them). No paid request is sent in the meantime.
- **Out of scope here.** No version bump or publish. Reference host impact: none.

**Scope exclusions (Further Actions candidates, not tasks):**
- OpenRouter OAuth PKCE user-key flow (pi has one, `auth/oauth/openrouter.js`).
- The Responses API route (`/api/v1/responses`).
- Server tools.
- The OpenRouter System One decisions path.
- Gemini explicit caching through OpenRouter. pi does not send it, so it is not needed for parity.
- Using OpenRouter for live benchmarks or release acceptance.

## Research summary (2026-10-24/25)

Sources:
- OpenRouter docs through Context7 (`/websites/openrouter_ai`);
- the public `GET https://openrouter.ai/api/v1/models`;
- pi 1.4.0 installed at `~/.bun/install/global/node_modules/@earendil-works/pi-ai/dist` (the reference harness).

| Topic | Finding | Consequence |
| --- | --- | --- |
| Endpoint | `https://openrouter.ai/api/v1/chat/completions` (OpenAI Chat, SSE) with a bearer key. Also `GET /api/v1/models`, `GET /api/v1/key`, `GET /api/v1/generation?id=` | One `openai-chat` route on `createRoutedProvider` |
| Model ids | Vendor-prefixed, plus the routers `openrouter/free` and `openrouter/auto`. `parseModelRef` splits on the first slash (`docs/models.md:49`) | Refs are written `openrouter/<vendor>/<model>` |
| `openrouter/free` | Picks a free model at random per request. The response `model` field names the served model | Usage metadata records the served model. **The only model the owner authorized live (2026-10-24)**, so every live row records its served model and is a sample, not a fixture |
| Free limits | 20 requests per minute. 50 requests per day below 10 purchased credits, otherwise 1,000. `GET /api/v1/key` reports `free_model_daily_requests` | The README documents these limits. A 429 that names the daily limit is classified `quota` |
| Errors | `{error:{code,message,metadata}}`. `Retry-After` on 429 and 503. **Mid-stream errors arrive as a 200 SSE chunk** with `error` and `finish_reason: "error"` | The shared codec must turn that chunk into a classified error |
| Usage | `prompt_tokens_details.{cached_tokens, cache_write_tokens}`, `cost`, `completion_tokens_details.reasoning_tokens` | `mapOpenAIChatUsage` (`openai-primitives.ts:75`) drops `cost`, so the package maps it |
| Reasoning | Request: `reasoning: {effort}`, whose values equal `THINKING_LEVELS` (`thinking.ts:8`). Stream: `delta.reasoning` plus `delta.reasoning_details[]`. Replay `reasoning_details` unchanged | The codec reads `delta.reasoning` (`openai-chat.ts:441`) but cannot replay `reasoning_details` |
| **Caching (docs)** | Sticky routing with `session_id` or `x-session-id` (at most 256 chars), falling back to `prompt_cache_key`. Anthropic models need `cache_control`: either top-level automatic, or at most 4 explicit block breakpoints. Others cache implicitly. `cache_write_tokens` is reported only for explicit-cache models | Prism must send the sticky key and place breakpoints on `anthropic/*` |
| **Caching (pi 1.4.0)** | `api/openai-completions.js`:<br>• `:544-553`: `x-session-id` = sessionId when the provider is OpenRouter (`sendSessionAffinityHeaders` at `:1305`, format at `:1306`);<br>• `:1269`: `cacheControlFormat: "anthropic"` for `anthropic/*` ids;<br>• `:798-810`: `{type:"ephemeral"}` (with `ttl: "1h"` only for long retention plus support) on the system prompt, the **last tool**, and the **last user/assistant/tool message's last text part**;<br>• `:580-583`: **no `prompt_cache_key`** for non-`api.openai.com` bases;<br>• `:416-427`: consecutive `reasoning_details` text and summary deltas are merged, encrypted entries stay discrete;<br>• `:1053`: replayed as `assistant.reasoning_details`;<br>• `:735-737`: `provider` routing passthrough | **The parity levers**: sticky header, 3 breakpoints (system, last tool, last message), reasoning replay, no extra cache fields |
| Routing and attribution | `provider: {order, only, ignore, allow_fallbacks, require_parameters, data_collection, zdr, sort, max_price, quantizations}`. Attribution headers `HTTP-Referer` and `X-OpenRouter-Title` | Validated `routing` field. Optional `appUrl` and `appTitle` |
| Privacy | Free-model routing follows a separate account privacy setting | Actionable error mapping. Live fixtures stay non-sensitive |
| Name history | npm has 0.2.x–0.3.1. Plan 182 retired it (`scripts/retired-providers.test.mjs:26`, `host-completeness-evidence.test.mjs:82`, `scripts/deprecations-0.13.json:239-246` with `range "*"`) | Task 2 reverses the retirement: deprecate `<0.13.0` as a reused name |

## Tasks

- [x] Task 1: Phase review — OpenRouter wire, codec seams, cache levers, and parity harness (read-only, live probes)
  - **Status (2026-10-24): complete for the offline and public-API scope.** Everything the criteria below now ask for is recorded in Notes. The authenticated rows that used to live here moved to **Task 1b** when `~/.config/prism/live.env` turned out to hold no `OPENROUTER_API_KEY` (and mode `0644` instead of `0600`). No key was printed, none was requested in chat.
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Placement and enforcement rows.**
        - The package is `packages/providers/openrouter`, built on `@arnilo/prism/provider-kit` only, with no sibling import.
        - The codec changes go in `src/provider-kit/codecs/openai-chat.ts`. Each names two gateways that use it, or moves into the package.
        - The enforcement-row list, using the `liquid` precedent: `docs/index.md:36`, `docs/models.md:156`, `docs/release.md:137-143`, `scripts/{coverage-thresholds,e2e-coverage,package-truth,live-matrix}.json`, `scripts/live.env.example`, `scripts/phase24-truth.test.mjs:97`, `scripts/phase54-package-map.test.mjs:60`, `src/__tests__/install-smoke.test.ts:64,189`, `src/__tests__/packaging.test.ts:95,446`.
      - (b) **Public wire probes** (no key, run 2026-10-24): `GET /api/v1/models` and `GET /api/v1/models/{slug}/endpoints` — the catalog and its fields, the router ids, the free tool-capable pool and its smallest context window, the cache rates inside `pricing`, and `supports_implicit_caching` per endpoint. The authenticated request rows are **Task 1b**.
      - (c) **Error bodies:** the `401` body observed live, plus the documented `400`/`404`, mid-stream-frame, `429`/`Retry-After`, and `GET /api/v1/key` shapes recorded in Notes and marked hand-written from the docs. The live capture of those, and the `/key` mapping, are **Task 1b**.
      - (d) **Seams:**
        - `Usage.metadata` propagation (`contracts-core/content.ts:247`) into run events and the ledger, with `file:line`.
        - `RoutedProviderRoute.mapUsage` (`routed-provider.ts:35`) has no chunk access today (`openai-chat.ts:428`).
        - `OpenAIStreamChunk` (`openai-chat.ts:494-509`) has no `error` field.
        - `ThinkingContent` (`content.ts:72-78`) can carry `reasoning_details` in `data`.
        - Whether the cache planner (`resolvePromptCachePlan`/`applyCacheControl`, `docs/provider-kit.md:408-420`) can produce pi's three breakpoints (`system_prompt`, `tools`, `last_message`) for the Chat wire, or only for the Anthropic codec today.
        - Which `ProviderRequest.options` field carries the session cache key (`cacheKey`/`sessionId`, as used by `opencode-go/src/provider.ts:12-18`).
      - (e) **Reference harness:**
        - The pi lever inventory above, re-verified against the installed pi version (record the version).
        - Whether `pi -p --mode json --provider openrouter --model <pinned>` runs headless and reports `cacheRead` per turn. This is the plan 184 cell.
        - Whether pi accepts a base-URL override for OpenRouter (a `models.json` provider entry), so its request can be recorded through `scripts/wire-proxy.mjs`. If not, the equivalence test is derived from pi's source lines and recorded as such.
      - (f) **Release-path fit:** what plans 184 (a new parity cell), 185 (`SecretSource` migration), 186 (strict run, preflight), and 187 (counts) need, and whether plan 194's landed overflow classifier (`transport.ts:31-47`) already matches OpenRouter's body. No open plan routes a live benchmark through OpenRouter.
      - (g) **Verdict:** proceed, or re-cut. **Stop condition:** if OpenRouter's chat wire cannot stream tool calls through the routed provider, stop the plan.
    - Performance: n/a (read-only). Probes stay within budget.
    - Code Quality: no code changes. Recordings stay in scratch until Task 4.
    - Security: no credential existed or was sent (public `GET`s only), and the one recorded header dump was scrubbed of `set-cookie` before it was quoted. The `0600` mode and the full scrub rules are **Task 1b**'s, enforced before its first request.
  - Approach:
    - Documentation Reviewed:
      - OpenRouter docs: free and auto routers, limits and `/key`, errors (mid-stream), reasoning tokens, prompt caching (sticky routing, `cache_control`), usage accounting, provider selection, attribution, structured outputs, tool calling, the models API, provider logging (Context7, 2026-10-24).
      - pi 1.4.0 `api/openai-completions.js` (lines in the research table) and `api/openai-prompt-cache.js`.
      - Prism `src/provider-kit/codecs/openai-chat.ts`, `openai-primitives.ts:75-100`, `routed-provider.ts:24-60`, `transport.ts:35-65`, `cache-helpers.ts`, `contracts-core/content.ts`, `packages/providers/opencode-go/src/*`.
      - Plans 183, 184, 196.
    - Options Considered:
      - Docs-only review. Rejected: whether `cache_control` is accepted on Chat text parts and on tools decides Task 3's codec shape, and the docs only show examples.
    - Chosen Approach:
      - A scoped review with budgeted probes through `scripts/wire-proxy.mjs`. The probes become Task 4's recordings.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/wire-proxy.mjs --upstream https://openrouter.ai/api/v1 --listen 127.0.0.1:8787 \
        --record "$SCRATCH/openrouter" --secret-env OPENROUTER_API_KEY
      timeout 300 pi -p --mode json --provider openrouter --model anthropic/claude-haiku-4.5 "…"
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes only.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2–§3.
  - Test Cases to Write:
    - n/a (read-only review).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **(a) Placement and enforcement rows.**
      - Package: `packages/providers/openrouter`, on `@arnilo/prism/provider-kit` only. The shape to match is `packages/providers/opencode-go/package.json`: `peerDependencies: {"@arnilo/prism": ">=0.13.0 <1.0.0"}`, no `dependencies`, `exports: {".": "./src/index.ts"}`. No sibling import is reachable through that manifest, which is what `install-smoke` asserts.
      - Codec changes stay in `src/provider-kit/codecs/openai-chat.ts`, and four gateways share it, so the two-gateway rule holds: `packages/providers/hyper/src/provider.ts:24`, `packages/providers/opencode-go/src/provider.ts:24`, `src/models/builtin.ts:39` (kernel `openai-compatible`), `src/provider-kit/openai-compatible.ts:78`.
      - Enforcement rows, read line by line against the tree (liquid is the precedent):
        - `docs/index.md:36` — the provider link list (`provider-liquid` line today).
        - `docs/models.md:156` — hand-written "ships 5 provider packages" and the `{hyper, laya, liquid, opencode-go, typesafe}` list.
        - `docs/release.md:136-146` — generated `package-truth:providers` block, "5 provider adapters" plus one version row per package; regenerate, do not hand-edit.
        - `scripts/coverage-thresholds.json:145`, `scripts/e2e-coverage.json:676`, `scripts/package-truth.json:41,66`, `scripts/live-matrix.json:108`, `scripts/live.env.example:48`.
        - `scripts/phase24-truth.test.mjs:97` (provider count 5), `scripts/phase54-package-map.test.mjs:60`.
        - `src/__tests__/install-smoke.test.ts:64,189`, `src/__tests__/packaging.test.ts:95,446` (`:446` is a hard-coded `assert.deepEqual(providerDirs, [hyper, laya, liquid, opencode-go, typesafe])`).
        - Not a gate but part of Task 2's sweep: `examples/api-key-auth.ts:7` already carries a fake `OPENROUTER_API_KEY`, so the `rg` sweep must classify it as allowlisted history, not drift.
      - Root `package.json` `workspaces` needs no edit (`packages/providers/*` glob).
    - **(b) Wire probes.** Public, unauthenticated, run 2026-10-24 from `curl`; artifacts kept at `/tmp/prism-openrouter-probe/` (outside the repo, because `.scratch/` is not gitignored). Authenticated rows: **not run** — blocked, see (H).
      - `GET https://openrouter.ai/api/v1/models` → `200`, 466 entries, 789,017 bytes, 0.11 s. Entry keys: `id, canonical_slug, name, created, description, context_length, architecture, pricing, top_provider, per_request_limits, supported_parameters, default_parameters, reasoning, expiration_date, knowledge_cutoff, benchmarks, links`. **No `compat` and no `cache` field**, and `supported_parameters` across the whole catalog contains no cache-related value (no `cache_control`, no `prompt_cache_key`).
      - `openrouter/free` exists: `context_length` 200000, `tools` + `structured_outputs` + `reasoning`/`reasoning_effort` supported, `pricing {prompt: "0", completion: "0"}`. Other routers: `openrouter/auto`, `openrouter/auto-beta`, `openrouter/fusion`, `openrouter/pareto-code`, `openrouter/bodybuilder`, all with `-1` pricing (= "no price", not free).
      - Free pool today: 20 zero-priced models, 17 of them with `tools`. Smallest context among the free tool-capable ones is 65536 (`liquid/lfm-2.5-2.6b:free`, `max_completion_tokens` 8192) — that is the value `openRouterModels['openrouter/free'].limits.contextWindow` must carry (smallest free tool-capable pool), not the router's own 200000. The plan's example `google/gemma-4-31b-it:free` is present: 262144 ctx, `tools`, `text+image+video` input.
      - `anthropic/claude-haiku-4.5`: 200000 ctx, `max_completion_tokens` 64000, `pricing {prompt: 1e-6, completion: 5e-6, input_cache_read: 1e-7, input_cache_write: 1.25e-6, input_cache_write_1h: 2e-6}`. So the paid cache row's cost is computable from the catalog, and `/models` already carries real cache rates. 30 `anthropic/*` ids exist (20 sync plus 10 `:batch`).
      - `GET /api/v1/models/anthropic/claude-4.5-haiku-20251001/endpoints` → `200`, 8 endpoints (Azure global, Bedrock global/us/eu-west-1, Vertex global/us-east5/europe, Anthropic direct), each with `provider_name`, `tag`, `max_completion_tokens`, `supported_parameters`, per-endpoint `pricing` (same cache rates), `supports_implicit_caching: false`, `uptime_last_{5m,30m,1d}`, `latency_last_30m`, `quantization`, `native_tools`. This is the **only** discovery source for implicit-cache support and per-upstream limits; `/models` has neither. Recording it as an option, not a Task 4 requirement (Task 4 maps `/models`).
      - Not run (need a key): text with and without `x-session-id`, the streamed tool loop, `json_schema`, image input, `reasoning: {effort: "high"}` (and whether a tool continuation accepts `reasoning_details` back), the full usage chunk, SSE comments, the over-long prompt, and every paid cache row.
    - **(c) Error bodies.**
      - `401` observed live without a key: `HTTP/2 401`, body `{"error":{"message":"No cookie auth credentials found","code":401}}` — no `metadata`, no account id. `access-control-expose-headers` advertises `X-Generation-Id, X-Provider-Name, request-id, cf-ray`, so the served provider and the `gen-` id are reachable as **response headers** as well as in the body/usage. The dumped headers were scrubbed of `set-cookie` (a Cloudflare `__cf_bm` cookie) before this note; that scrub is the same one Task 4's fixture recorder needs.
      - `400`/`404` unknown model: not observed — an unauthenticated request is rejected at auth before model resolution. Documented shape only.
      - **Mid-stream frame** (hand-written from the docs, marked as such): `{"id":"gen-…","object":"chat.completion.chunk","created":…,"model":"…","provider":"…","error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded","provider_code":"…"}},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}` with HTTP **200**. `provider_code` is omitted on 500s. The canonical `error_type` set is documented (`context_length_exceeded`, `max_tokens_exceeded`, `token_limit_exceeded`, `string_too_long`, `authentication`, `permission_denied`, `payment_required`, `rate_limit_exceeded`, `provider_overloaded`, `provider_unavailable`, `invalid_request`, `invalid_prompt`, `not_found`, `payload_too_large`, `content_policy_violation`, `refusal`, …) and `context_length_exceeded` maps to HTTP **400**.
      - `429` + `Retry-After`: documented example only (`HTTP/1.1 429`, `Retry-After: 60`; also on `503`, and on `402` when `error.metadata.limit_source` is `openrouter_in_flight_budget`). Not reachable without a key.
      - `GET /api/v1/key` and `GET /api/v1/models/user`: not observed. Note for Task 4: pi personalizes its catalog from `/models/user` (`providers/openrouter.js:22`) and treats `401/403/404` there as "catalog unchanged"; Prism's discovery is `/models` per the plan, so `/key` stays a README-documented quota check.
      - Cache-usage evidence, documented and therefore usable without a key: `usage.prompt_tokens_details.{cached_tokens,cache_write_tokens}` and a `cache_discount` field in the body — consistent with `mapOpenAIChatUsage` (`src/provider-kit/openai-primitives.ts:75-88`), which already reads both `cache_write_tokens` and `cache_creation_input_tokens`.
    - **(d) Seams** (`file:line` as of this review).
      - `Usage.metadata` (`src/contracts-core/content.ts:255`) needs no plumbing: `turn.completed` carries the whole `Usage` (`src/agent-session/session/provider-round.ts:377`, and `:393`/`:416` on the abort and error paths), and the ledger writes the same object (`recordProviderUsage` → `usage: effective` at `:151`, appended at `:155`). Only the derived `cacheUsageReport` is flattened into turn `metadata` (`:86-89`, `:375`). `metadata.openrouter` therefore reaches both surfaces for free.
      - `RoutedProviderRoute.mapUsage` (`src/provider-kit/routed-provider.ts:35`, options-level twin at `:58`, wired at `:255-268`) is called with `parsed.usage` only (`src/provider-kit/codecs/openai-chat.ts:428`) — no chunk. Task 3's optional second argument is genuinely new in both signatures.
      - `OpenAIStreamChunk` (`src/provider-kit/codecs/openai-chat.ts:494-510`) has no `error` field and `openAIChatEvents` never reads `parsed.error`. **Confirmed defect today:** a 200 error frame whose `choices[].finish_reason` is `"error"` sets `sawFinishReason`/`finishReason` (`:435-444`), and on the following `[DONE]` the loop emits `done` with stop reason `provider_error` (`src/models/events.ts:114`) and no error event — the provider's message is lost. Without `[DONE]`, strict completion replaces it with the generic "ended without completion evidence" error. Both are why Task 3 exists.
      - `ThinkingContent` (`src/contracts-core/content.ts:72-78`) has `text`, `signature?`, `redacted?`, `data?` — one `reasoning_details` entry fits `data` plus `redacted: true` for encrypted entries, as the plan assumes. No new block type needed.
      - Cache planner: **already supports pi's three breakpoints.** `resolvePromptCachePlan` (`src/provider-kit/cache-helpers.ts:98-161`) accepts `system_prompt`, `last_message`, `last_stable_message`, `first_user_message`, `tools` with `markTools` and `maxBreakpoints`; `applyCacheControl` (`:163-181`) stamps the last non-empty block; `systemCacheControlField` (`:194-209`) emits native text blocks so the system marker survives. The only consumer is `anthropicMessagesBody` (`src/provider-kit/codecs/anthropic-messages.ts:90-112`) — the Chat wire has no cache path at all. Three concrete gaps, all in `openai-chat.ts`: the content loop builds fresh `{type:"text",text}` parts and drops `cache_control` (`:355`, `:358`); a single text part is collapsed to a bare string (`:377-383`) which would destroy a marker; and `tools: request.tools?.map(serializeOpenAITool)` (`:226`) has no `markTools` path. Task 3 is a Chat-wire adapter over the existing planner, not a second planner — as the plan requires.
      - Session cache key: `request.options?.cacheKey ?? request.options?.sessionId` — fields on `ProviderRequestOptions` (`src/contracts-core/provider.ts:54-67`), precedent `packages/providers/opencode-go/src/provider.ts:15-18` with `sanitizeCacheKey(..., 128)`. `sanitizeCacheKey` (`src/provider-kit/cache-helpers.ts:43-53`) replaces `[^A-Za-z0-9_.:-]+` with `-`, trims leading/trailing `-`, then slices; OpenRouter needs the cap at **256**.
      - `affinity` already exists where it is needed: `RoutedProviderRoute.affinity` (`src/provider-kit/routed-provider.ts:32`), applied at `:187-190` with a codec-level fallback through `(route.codec as any)?.affinity` (`:189-190`); `OpenAIChatCodecOptions.affinity` is `src/provider-kit/codecs/openai-chat.ts:114`. The sticky header needs no kernel change. (The `as any` at `:189` is pre-existing; Task 3 touches this region only if it changes codec affinity.)
      - Two package-side escape hatches already exist if a Chat cache path ever must live outside the codec: `mapMessages` (`openai-chat.ts:108`, used `:176`) takes the `Message[]` that `applyCacheControl` returns, and `transformBody` (`:117`, used `:244`) gets the finished `JsonObject` (tool definitions included).
      - Errors: `providerHttpError` (`src/provider-kit/retry-http.ts:52-69`) sets the numeric `code` from `decision.code` and computes `failureClass` with `classifyProviderFailure`, appending the redacted body text to the message — so OpenRouter's JSON body is what the classifier sees.
      - SSE comments already land: `readSseEvents` collects them (`src/provider-kit/transport.ts:151-188`, `readSseEvents` at `:196`) and both codec option sets expose `onComment` (`src/provider-kit/codecs/openai-chat.ts:129,140`).
    - **(e) Reference harness.** pi `1.4.0` (`@earendil-works/pi-ai@1.4.0`), levers re-verified against the installed dist; three line numbers in the plan's research table move.
      - Sticky header: `x-session-id = sessionId` when `compat.sendSessionAffinityHeaders` and `sessionAffinityFormat === "openrouter"` (`dist/api/openai-completions.js:544-553`); detected as `provider === "openrouter"` (`:1305-1306`), overridable per model (`:1346-1347`). pi never sends the body `session_id`.
      - `cacheControlFormat: "anthropic"` only for `provider === "openrouter" && model.id.startsWith("anthropic/")` (`:1269`, override at `:1346`). `getCompatCacheControl` (`:798-806`) yields `{type:"ephemeral"}` plus `ttl:"1h"` only for long retention with support; `applyAnthropicCacheControl` (`:807-810`) places exactly three markers: the first system/developer message's text part (`:811-816`, `:843-845`), the **last tool definition** (`:833-836`), and the last user/assistant/tool message's last text part (`:817-832`, `:846-857`), converting string content to a one-part array (`:858-870`).
      - No `prompt_cache_key` off `api.openai.com` (`:578-583`). `reasoning_details` merge on read (`:416-427`), replay at `:1053`. Routing passthrough `params.provider = model.compat.openRouterRouting` (`:733-737`).
      - **Lever the plan does not list:** pi writes the instruction message as `role: "developer"` (not `system`) when the model reasons and the provider supports it (`:905`), which for OpenRouter means `anthropic/*` and `openai/*` ids (`:1270`); the cache marker lands on that message. Prism writes `role: "system"`. OpenRouter's sticky-key derivation treats "system (or developer)" alike and explicit breakpoints work on either, so this is a documented difference rather than a parity break — but Task 5's fixture must state the decision instead of asserting byte-equal roles.
      - Headless command shape is valid: `pi --help` today lists `--provider <name>` (requires `--model`) and `--model` accepting `provider/id`, so `pi -p --mode json --provider openrouter --model anthropic/claude-haiku-4.5 "…"` parses. `--mode json` emits per-message `usage` with `{input, output, cacheRead, cacheWrite, totalTokens, cost}` (`pi-coding-agent/docs/json.md:41,98,213`; `dist/modes/json-event.js:25`; `dist/types.d.ts:285-302`), so per-turn `cacheRead` is observable. Not executed: needs the key.
      - **Base-URL override: yes.** `models.json` can override a provider's `baseUrl` (`pi-coding-agent/docs/models.md:124`, `docs/models-configuration.md`) and the OpenRouter provider honors `context.baseUrl` (`dist/providers/openrouter.js:19,25`; per-request swap at `dist/models.js:440`). So pi's request **can** be recorded through `scripts/wire-proxy.mjs`, whose flags all exist (`--upstream`, `--listen`, `--record`, `--secret-env`, `--usage-log`; `scripts/wire-proxy.mjs:54-95`, `--secret-env` mandatory with `--record` at `:247`). Task 5 can compare against a recorded pi request and does not need the derived-fixture fallback.
    - **(f) Release-path fit.**
      - **184:** the `release/cache-parity` row and `scripts/cache-parity/{run,metrics,harnesses}.mjs` exist only as plan text (Task 3 unstarted). The openrouter cell needs that row's `requires` to gain `OPENROUTER_API_KEY` (plus the `PRISM_LIVE_OPENROUTER_PAID` opt-in) and a `harnesses.mjs` `pi` entry invoked with `--model openrouter/anthropic/claude-haiku-4.5`; 184's `--mode json --no-session --no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve` shape applies unchanged. `run.mjs` (harness-level) and this plan's `provider-probe.mjs` (provider-level) coexist; 184's runner may later reuse the probe's transcript.
      - **185:** the `SecretSource` migration is a no-op beyond the new package's shape baseline, provided `apiKey` stays a ref only (`env:OPENROUTER_API_KEY`) with no store.
      - **186:** the strict `providers/` run needs the live-matrix row (`status: "active"`, `requires: ["PRISM_LIVE_PROVIDER_TESTS", "OPENROUTER_API_KEY"]`, optional `PRISM_LIVE_OPENROUTER_PAID`, `model[]` env defaults, free-text `cost`) — the exact field set of `scripts/live-matrix.json:108-127`.
      - **187:** counts only ("16 plus openrouter, which is republished"; "15 with range `*`"; `openrouter` `<0.13.0`).
      - **194 fits, with one caveat.** `CONTEXT_OVERFLOW_BODY`'s first alternative is literally `context_length_exceeded` (`src/provider-kit/transport.ts:33-34`), `context_length_exceeded` maps to HTTP 400, and `providerHttpError` appends the redacted body, so the documented pre-stream 400 body classifies `context_overflow` with no kernel edit. The caveat is correction 3 below.
      - **Task 7 needs one extra env var:** the live runner's default credential file is `scripts/live.env` when present (`scripts/live-matrix.mjs:191`), and it is absent, so the strict command must run with `PRISM_LIVE_ENV_FILE=$HOME/.config/prism/live.env`.
    - **(g) Verdict: proceed** — with the corrections below. The stop condition (the chat wire cannot stream tool calls through the routed provider) is **not** met: pi streams tool calls over the same vendor wire, Prism's Chat codec already accumulates `delta.tool_calls` (`src/provider-kit/codecs/openai-chat.ts:445-461`) through `createRoutedProvider`, and the pinned free model declares `tools`. What remains unproven is only the authenticated matrix, blocked on the key.
    - **Plan corrections this review requires** (severity in brackets).
      1. **[Blocker for Task 5]** The probe's "stable prefix of about 3K tokens" is **below the minimum cacheable prefix for the pinned paid model**. OpenRouter documents per-model minimums; `anthropic/claude-haiku-4.5` is **4096 tokens**. A 3K prefix caches nothing, so the probe would report 0 reads and read as a parity failure. Require ≥ 6K, recommend 8K, or pin a 512-token-minimum Claude (Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Haiku 5.5). `DEFAULT_LIVE_CACHE_PREFIX` (`src/testing/provider-live-scenarios.ts:23`) is ~1 KiB, so it is not a substitute.
      2. **[Task 4 config, contradicts cache parity]** OpenRouter: "Sticky routing is not used when you specify a manual provider order via `provider.order`". Task 4's `routing` config exposes `order`. The README and Task 5 must state that setting `order` trades cache reuse for determinism, and no parity test may set it. Sticky sessions also expire after **10 minutes** of inactivity, which sets the floor for probe turn spacing.
      3. **[Changes Task 4 and 194's reach on this route — probe attempted 2026-10-24, still open]** OpenRouter documents that token/length errors (`context_length_exceeded`, `max_tokens_exceeded`, `token_limit_exceeded`, `string_too_long`) are **transformed into successful completions with `finish_reason: "length"`**, not surfaced as failures. Task 1b tried twice and could not reach an overflow: 270,022 tokens fit `nvidia/nemotron-3-ultra-550b-a55b:free`, whose context is 1,000,000, and the largest free context is 1,048,576. Consequences: `openrouter_overflow_classified_and_recovered` must start from a recorded or hand-written body and must not claim a live one, and plan 194's recovery may never fire here — an over-long turn would end as `max_output_tokens` truncation. Do not write Task 4's overflow acceptance as live; leave it a documented-shape row until a pinned paid model is authorized.
      4. **[Task 4 discovery]** `/models` carries no `compat` and no `cache`, and no cache-related `supported_parameters` value exists in the catalog. `compat.cacheControl: "anthropic-blocks"` and `cache.kind` must be derived from the id prefix exactly as pi does (`:1269`), not read from the payload. `supports_implicit_caching` exists only per endpoint under `/models/{slug}/endpoints`.
      5. **[Task 4 cost]** `/models` pricing already has `input_cache_read`, `input_cache_write`, `input_cache_write_1h`; map them onto `CostQuote.cacheRead`/`cacheWrite` instead of inferring rates. `-1` means "no price" (routers), distinct from `0` (free).
      6. **[Task 4 catalog numbers]** 466 models today (README says "about 470" — fine). Free pool 20, of which 17 tool-capable. `openrouter/free` context is 200000, but the smallest free **tool-capable** context is **65536**, which is the value the static entry must declare per the plan's own rule.
      7. **[Task 3 mid-stream classification]** `classifyProviderFailure` reads the *message* text, and a mid-stream frame carries its class in `error.metadata.error_type`, not necessarily in `message`. The terminal error Task 3 builds must include `error_type` in its message (or map it explicitly), otherwise a mid-stream `context_length_exceeded` classifies `permanent` instead of `context_overflow`. The HTTP status must also come from the frame's `error.code` (the transport status is 200), as the plan already says.
      8. **[Task 7 hygiene]** Free models can be retired: `/models` carries `expiration_date`. The strict live test must fail with a "model retired" note (not a bare 404) when the pinned free id disappears, which is also why `PRISM_LIVE_OPENROUTER_MODEL` must stay overridable.
    - **(H) Owner actions — status 2026-10-24.**
      - `0600` on `~/.config/prism/live.env`: **done** (`stat` → `600`).
      - `OPENROUTER_API_KEY`: **added** (73 chars, `GET /api/v1/key` → 200, `limit: 50`, `limit_remaining: 50`, `usage: 0`, `is_free_tier: false`).
      - **Authorization: `openrouter/free` only.** The rows that need any other model are deferred, not approved. Spend actually incurred: **$0** (10 free chat requests).
      - **Spend, if the owner ever widens the authorization:** ≤ 12 requests on `anthropic/claude-haiku-4.5` ($1/M input, $1.25/M cache write, $0.10/M cache read, $5/M output): the 3-turn cache row at an 8K prefix is ≈ $0.013, and nine small probes stay under ≈ $0.012 — **≈ $0.03 total, worst case under $0.05, cap $0.10**.
      - Deferred with it: the `anthropic/*` cache rows, `cache_control` with an observed cache hit, a live `400`/`404`/`429`/mid-stream body, and the overflow body (Task 1b notes record why the free router cannot reach one).

- [x] Task 1b: Authenticated OpenRouter probes — `openrouter/free` only (owner authorization 2026-10-24)
  - Acceptance Criteria:
    - Functional: at most 30 requests total, **all** on `openrouter/free`, recording per row the served `model` and `provider`:
      - text, with and without `x-session-id`, and `prompt_tokens_details.cached_tokens`;
      - a streamed tool-call loop;
      - one `json_schema` request;
      - one image request;
      - one `reasoning: {effort: "high"}` request: `delta.reasoning` versus `delta.reasoning_details` shape;
      - the full usage chunk (`cost`, `prompt_tokens_details`, `completion_tokens_details`);
      - whether an SSE comment frame appears at all;
      - the largest prompt the router accepts, and whether an overflow is reachable on this router (Task 1 correction 3);
      - whether `cache_control` on a Chat text part and on a tool definition is accepted, ignored, or rejected;
      - the `GET /api/v1/key` and `GET /api/v1/models/user` mapping.
    - Functional, **deferred to a new owner decision**: the paid `anthropic/claude-haiku-4.5` 3-turn cache row (prefix ≥ 6 KiB), `cache_control` *with* an observed cache hit, the pinned free tool-capable model, and the live `400`/`404`/`429`/mid-stream bodies. No request outside `openrouter/free` may be sent until the owner says otherwise.
    - Performance: the whole run under 5 minutes (measured ≈ 48 s).
    - Code Quality: no code changes. Recordings stayed in `/tmp/prism-openrouter-probe/` — outside the repo, because `.scratch/` is neither gitignored nor tracked.
    - Security: `live.env` confirmed mode `0600` before the first request; the key was read from the environment into a `0600` header file and never printed or committed; the one recorded header dump was scrubbed of `set-cookie`.
  - Approach:
    - As run: `curl` against `https://openrouter.ai/api/v1/chat/completions` with `Authorization` supplied through a `0600` header file (`printf 'Authorization: Bearer %s\n' "$OPENROUTER_API_KEY" > .hdr`), bodies built with `jq -nc`, responses and SSE streams captured to `/tmp/prism-openrouter-probe/`.
    - `scripts/wire-proxy.mjs` was **not** used: it records one upstream transcript per run, and every row here is a single free request whose value is the served model, not replayable bytes.
    - Export `PRISM_LIVE_ENV_FILE=$HOME/.config/prism/live.env` for every future command; the live runner defaults to the absent `scripts/live.env` (`scripts/live-matrix.mjs:191`).
  - Test Cases to Write:
    - none — this task produces evidence, not code. The `/models` and `/models/user` dumps become Task 4's discovery fixtures; nothing here can serve as Task 5's reference.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Authorized scope (owner, 2026-10-24): `openrouter/free` only.** The owner added `OPENROUTER_API_KEY` to `~/.config/prism/live.env` at mode `0600` and limited all live use to the free router. No `anthropic/*` request and no pinned `:free` model may be sent without a new owner decision, so the paid cache rows are deferred, not merely blocked on a key.
    - **What that costs the plan:** `openrouter/free` serves a **different model per request**, so a row is a sample, not a reproducible fixture, and the router never serves `anthropic/*` — the `cache_control` breakpoint sequence cannot be measured here at all. Every row below names its served model.
    - **Key profile** (`GET /api/v1/key`, 200): the `label` the API returns (masked), `limit: 50`, `limit_remaining: 50`, `usage: 0`, `is_free_tier: false`, `rate_limit.requests: -1` (the API marks that field deprecated). So the 1,000/day free ceiling applies, not the 50/day below-10-credits one.
    - **Rows run (2026-10-24; 10 chat requests plus 4 metadata `GET`s of the 30-request budget; $0 spent):**
      - R1 text, `x-session-id: prism-probe-r1` → `nvidia/nemotron-3.5-lightning:free`, provider `Nvidia`, 24 prompt / 16 completion (all 16 counted as `reasoning_tokens`), `cost: 0`.
      - R2 identical body, no session header → `poolside/laguna-s-2.1:free`, provider `Poolside`, `prompt_tokens_details.cached_tokens: **32**` on a 51-token prompt. Implicit upstream prefix caching is real and visible on free models with no `cache_control` at all.
      - R3 stream + `stream_options.include_usage` → 26 `data:` frames, one `[DONE]`, **no SSE comment frame**, and a final usage chunk carrying the full shape (`cost`, `is_byok`, `prompt_tokens_details.{cached_tokens,cache_write_tokens,…}`, `cost_details`, `completion_tokens_details.reasoning_tokens`). The first delta already carries `reasoning` **and** `reasoning_details: [{type:"reasoning.text",…}]` — exactly the merge target pi implements (`openai-completions.js:416-427`).
      - R4 streamed tool loop with one function → `tool_calls` deltas (`index`, `id`, `type`, `function.name`, then `function.arguments` fragments), `finish_reason: "tool_calls"`, served `nvidia/nemotron-3-ultra-550b-a55b:free`. The Chat wire streams tool calls through `openrouter/free`, so Task 3's premise holds.
      - R5 `response_format: {type:"json_schema", strict:true}` → 200, no error.
      - R6 `reasoning: {effort:"high"}` → 200, `reasoning_tokens: 38`, answer returned. Accepted; no per-model rejection surfaced.
      - R7 image part (1×1 PNG data URL) → 200, `finish_reason: "length"` at `max_tokens: 32`; the router accepted the image and routed to `dots-studio/dots-3-note-preview:free` (512K ctx). No 4xx, but the small output cap leaves the answer inconclusive.
      - R8 `cache_control: {type:"ephemeral"}` on a system text part, a user text part **and** the `function` object of a tool definition → 200, `"ok"`, `cached_tokens: 0`, `cache_write_tokens: 0`, no error. Anthropic-style markers sent to a non-Anthropic free model are **accepted and ignored**: the Task 3 marker path is safe to ship, and this is not evidence of caching.
      - R9 140,008-token prompt → served `recursive/flint-v1.0:free` (262,144 ctx), so it fit; `finish_reason: "length"` there is the output cap.
      - R10 270,022-token prompt → served `nvidia/nemotron-3-ultra-550b-a55b:free`, whose context is **1,000,000**, so that fit too.
      - R11 `GET /api/v1/models/user` → 200, 463 entries, keys `{data, links, total_count}`, the same shape as `/models`.
    - **Task 1 correction 3 stays unproven, and cannot be proven here.** Both large-prompt rows fit their served model, so nothing was transformed. A reliable overflow would need a prompt above the largest free context (1,048,576 tokens, ≈4.5 MB of text) and would still land on a random model. **Do not write Task 4's overflow acceptance against `openrouter/free`** and do not claim the documented transform is verified: on this router it is untested, so Task 4's overflow row must rest on the documented shape and Task 194's recovery stays unproven for this provider.
    - **Caveat now demonstrated:** R5 was routed to `nvidia/nemotron-3.5-content-safety:free`, a safety classifier that answered `User Safety: safe`, and R1/R2 served different vendors for the same body. Tool support, vision, `json_schema` acceptance and `cached_tokens` therefore vary per request; every row above is a sample of one model, not of OpenRouter. This is the owner-decision caveat in the research table, now measured.
    - **What it unblocks:** Task 3's marker safety (R8) and its `reasoning_details` shape (R3, R4). **Still blocked by the authorization:** Task 5's live cache threshold, Task 4's overflow acceptance, and any live `400`/`404`/`429`/mid-stream error body — the documented shapes in Task 1 Notes (c) remain the only evidence there.

- [x] Task 2: Record the owner decision and reverse the `openrouter` retirement
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md`:
        - Phase 5 "Provider packages" adds `openrouter` (owner decision 2026-10-24).
        - The §2.9 row (`roadmap.md:598`) adds it too.
        - The header "Updated" line records the decision and the 2026-10-25 cache-parity requirement for new providers.
        - Plans 204–206 each add their own provider when they run.
      - `openrouter` is removed from `RETIRED_PROVIDERS` (`scripts/retired-providers.test.mjs:26`) and from the regex in `scripts/host-completeness-evidence.test.mjs:82`.
      - The `@arnilo/prism-providers` umbrella successor (`retired-providers.test.mjs:100-105` and its `deprecations-0.13.json` entry) names the shipped packages. Today it says four, which is drift from plan 196.
      - The `@arnilo/prism-provider-openrouter` deprecation becomes `range: "<0.13.0"`, `reused: true`, `successor: "@arnilo/prism-provider-openrouter@0.13.0"`, using the `@arnilo/prism-mcp` message shape.
      - `docs/migrate-to-0.13.md` no longer lists OpenRouter as removed.
      - Plan 187 is amended in place: "17 deleted providers" becomes "16 plus `openrouter`, which is republished", and "16 published at 0.3.1" becomes "15 with range `*`, and `openrouter` `<0.13.0`". The `plans/README.md` descriptions of 182 and 187 are corrected.
      - Sweep: `rg -n "prism-provider-openrouter|providers/openrouter" src packages apps scripts examples docs -g '!dist' -g '!docs/history' -g '!docs/_evidence'`. Every hit is listed in the note, as either allowlisted history or updated.
    - Performance: n/a.
    - Code Quality: no package code yet. `retired_providers` and `packaging` stay green.
    - Security: `bun scripts/registry-deprecate.mjs --generate && --dry-run` shows `<0.13.0` for openrouter and never deprecates the 0.13.0 line.
  - Approach:
    - Documentation Reviewed:
      - `scripts/deprecations-0.13.json:239-246` and the 6 reused entries; `scripts/retired-providers.test.mjs`; plan 187 lines 11–17 and 73; `docs/migrate-to-0.13.md`.
    - Options Considered:
      - A new package name. Rejected: it splits a known name, and plan 175 Task 8 already handles reused names.
      - Keeping `range "*"`. Rejected: it would deprecate 0.13.0.
    - Chosen Approach:
      - Reverse the retirement first, so Task 4 adds the package without breaking a gate.
    - API Notes and Examples:
      ```json
      { "name": "@arnilo/prism-provider-openrouter", "range": "<0.13.0", "reused": true,
        "successor": "@arnilo/prism-provider-openrouter@0.13.0", "anchor": "#012-family-package-native-package-map" }
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `scripts/retired-providers.test.mjs`, `scripts/host-completeness-evidence.test.mjs`, `scripts/deprecations-0.13.json`, `docs/migrate-to-0.13.md`, `plans/187-…md`, `plans/README.md`, `CHANGELOG.md` `## [Unreleased]`.
    - References:
      - plans 182 Task 2 and 175 Task 8.
  - Test Cases to Write:
    - `deprecation_messages_name_supported_providers` (updated): fails if the umbrella omits a shipped provider, or if openrouter is `range "*"`.
    - `registry-deprecate.test.mjs` (existing, run unchanged).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (supported providers, migration guide).
    - Docs pages to create/edit:
      - `docs/migrate-to-0.13.md`; `roadmap.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Landed 2026-10-24.** Files: `scripts/retired-providers.test.mjs` (`openrouter` out of `RETIRED_PROVIDERS`; the umbrella assertion now derives the shipped set from `packages/providers/*` so `liquid` cannot drift out again; a new block pins `openrouter`'s `<0.13.0` / `reused` / successor / message shape), `scripts/host-completeness-evidence.test.mjs` (out of the `isRetired` regex), `scripts/deprecations-0.13.json` (umbrella successor gains `liquid`; `openrouter` becomes the reused-name entry), `docs/migrate-to-0.13.md:74` (shipped list gains `openrouter`, "the 16 other 0.3 vendors"), `roadmap.md` (header `Updated` line with the 2026-10-25 cache-parity requirement, Phase 5 `:1794`, §2.9 `:598`), `plans/187-…md` (16 stay deleted, 15 at `0.3.1` plus `openrouter` on `<0.13.0`, strict `providers/` run is six packages and seven rows), `plans/README.md` (step-2 row, 182 detail, 187 detail), `CHANGELOG.md` `## [Unreleased]`, and `src/__tests__/cli-manifest.test.ts` (scaffold fixture vendor `vertex` → `acme`).
    - **Why the scaffolder fixture moved.** The gate was **already red at HEAD**: `no_live_tree_reference_to_retired_provider` flagged `src/__tests__/cli-manifest.test.ts`, which scaffolds `@acme/prism-provider-vertex`, and `deprecation_messages_name_supported_providers` had already failed because the umbrella string still said four. Both are green now (18 pass across the three script suites). The fixture uses a vendor that is not retired, so the gate keeps meaning what it says instead of gaining an allowlist entry.
    - **Verification.** `bun test scripts/retired-providers.test.mjs scripts/registry-deprecate.test.mjs scripts/host-completeness-evidence.test.mjs` → 18 pass / 0 fail. `bun test src/__tests__/packaging.test.ts scripts/packaging-current.test.mjs` → 389 pass / 0 fail. `bun test src/__tests__/docs.test.ts` → 64 pass / 0 fail. The renamed scaffolder fixture passes on its own.
    - **Deprecation tool.** `bun scripts/registry-deprecate.mjs --generate` writes 33 entries. `--dry-run` reports two **expected** problems for `openrouter`, which is the guard working: `latest 0.3.1 is inside <0.13.0; publish 0.13.0 and move latest first` and `0.13.0 is not published yet`. The name has 46 published versions with latest `0.3.1`, so after the 0.13.0 publish the same command plans every ≤ 0.12.x version and never the 0.13.0 line. Nothing here deprecates 0.13.0.
    - **Sweep** (`rg -n "prism-provider-openrouter|providers/openrouter" src packages apps scripts examples docs -g '!dist' -g '!docs/history' -g '!docs/_evidence'`): 9 hits, all allowlisted history — `scripts/deprecations-0.13.json:240,243,245` (the entry this task ships), `scripts/retired-providers.test.mjs:146,148,153,158` (the assertions that pin it), and `scripts/phase54-package-map.mjs:396` (the frozen 0.12 → 0.13 subpath map, still accurate). No product file references the name.
    - **Pre-existing failure, not this task's:** `src/__tests__/release.test.ts:68` asserts 43 publishable packages while the tree builds 45 — packages added after that count was written, `liquid` among them. This change adds no package, so the count was already stale at HEAD; plans 191/196 own it and Task 4 bumps it anyway.

- [x] Task 3: Shared OpenAI Chat codec — error frames, `reasoning_details`, `cache_control` blocks, chunk-aware usage
  - Acceptance Criteria:
    - Functional:
      - **Error frames.**
        - A chunk with a top-level `error`, or a choice with `finish_reason: "error"`, yields one terminal `providerError`. It carries the status `code`, the redacted `metadata.error_type` and message, and the `classifyProviderFailure` class:
          - 429 → `rate_limited`, or `quota` on daily-limit text;
          - 502 and 503 → transient;
          - 400 and 402 → permanent.
        - No `done` follows the frame.
        - A frame whose `code` is 400 or 413 and whose message matches the overflow patterns classifies `context_overflow`.
          - It arrives before any content delta, so plan 194's recovery (one compaction and one retry) runs.
          - The same frame after output started fails the run with `ContextOverflowError`.
      - **`reasoning_details`.**
        - Reading: `delta.reasoning_details` items are collected by `index`. Consecutive `reasoning.text` and `reasoning.summary` deltas merge into one logical entry, and `reasoning.encrypted` entries stay discrete (pi `openai-completions.js:416-427`). Each entry becomes a `ThinkingContent`:
          - `text` holds the readable text;
          - `data` holds the entry JSON;
          - an encrypted entry is `redacted: true`.

          `delta.reasoning` text is not emitted twice.
        - Writing: `reasoningReplay: "reasoning_details"` replays the entries as `assistant.reasoning_details` unchanged and in order.
      - **`cache_control` blocks.** A new codec option `cacheControl: "anthropic-blocks"` stamps `cache_control: {type: "ephemeral"}` (plus `ttl` only when the model declares long-retention support and the request asks for it) at the breakpoints chosen by `resolvePromptCachePlan`.
        - It puts at most 4 markers on non-empty text parts. A string `content` becomes a one-part array.
        - It marks the last tool definition only when the route declares `cacheControlOnTools: true`. Task 1b (b) verifies acceptance.
        - Default breakpoints: `system_prompt`, `tools`, `last_message`, matching pi's placement (`openai-completions.js:806-810,821-834`).
        - Without the option, the codec emits no `cache_control` (non-regression).
      - **Chunk-aware usage.** `mapUsage(usage, chunk)` on `OpenAIChatEventsOptions` and `RoutedProviderRoute`. The second argument is optional.
      - `assertRecordedStreamConforms` accepts a 200 error-frame recording as an `error` terminal.
    - Performance: no added allocation when the new fields and option are absent. A test asserts that the existing fixtures produce identical events and bodies.
    - Code Quality:
      - Changes stay inside `src/provider-kit/`, and `rg -n -i "openrouter" src/provider-kit` finds nothing.
      - No new `ContentBlock` type.
      - `cache_control` placement reuses `resolvePromptCachePlan` and `applyCacheControl` (`docs/provider-kit.md:408-420`). The planner gains a Chat-wire adapter, not a second planner.
      - `bun scripts/release.mjs gate --update-baseline` rewrites `scripts/compat-baseline/arnilo__prism.txt`, and the diff is attributed to plan 203.
    - Security: error-frame text passes through `redactSecrets`, and `assertNoSecretLeak` covers the fixture. Replayed reasoning goes only to the route that produced it.
  - Approach:
    - Documentation Reviewed:
      - `openai-chat.ts:149-250,254-390,396-509`; `openai-primitives.ts:75-100`; `routed-provider.ts:24-60`; `transport.ts:35-44`; `cache-helpers.ts` (`resolvePromptCachePlan`, `applyCacheControl`).
      - pi `openai-completions.js:416-427,798-870,1040-1056`.
      - OpenRouter error, reasoning, and prompt-caching docs.
    - Options Considered:
      - Package-local codec wrappers. Rejected for error frames and usage: the routed provider owns the stream loop. For `cache_control` blocks: Anthropic models behind OpenAI-compatible gateways are a cross-vendor pattern (pi exposes it as a generic `cacheControlFormat` compat flag, `openai-completions.js:1304,1346`). If Task 1b finds a piece OpenRouter-only, it moves to a package hook.
      - Top-level automatic `cache_control` only. Rejected: pi uses explicit block breakpoints, and parity requires the same levers.
    - Chosen Approach:
      - Four additive provider-kit changes, each tested on hand-built SSE and recorded bodies.
    - API Notes and Examples:
      ```ts
      export interface OpenAIChatCodecOptions {
        readonly reasoningReplay?: "reasoning_content" | "fold" | "drop" | "reasoning_details";
        readonly cacheControl?: "anthropic-blocks";
        readonly cacheControlOnTools?: boolean;
      }
      readonly mapUsage?: (usage: unknown, chunk?: JsonObject) => Usage | undefined;
      ```
    - Files to Create/Edit:
      - `src/provider-kit/codecs/openai-chat.ts`, `src/provider-kit/routed-provider.ts`, `src/provider-kit/cache-helpers.ts`, `src/provider-kit/conformance.ts`.
      - The existing `openAIChatEvents` test file (tentative name `src/__tests__/openai-chat-codec.test.ts`).
      - `scripts/compat-baseline/arnilo__prism.txt`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - plan 182 (codec ownership); plan 194 Task 3 (landed overflow classification, which error frames must feed).
  - Test Cases to Write:
    - `openai_chat_mid_stream_error_frame_is_terminal_error`: 429 class `rate_limited`, no `done`.
    - `openai_chat_finish_reason_error_without_error_object_is_error`.
    - `openai_chat_overflow_error_frame_recovers_once`: a session on a replaying mock gets an overflow frame before output, compacts once, and retries once. After output, the run fails with `ContextOverflowError`.
    - `openai_chat_reasoning_details_merge_and_round_trip`: text deltas merge and encrypted entries stay discrete. Replay is byte-equal.
    - `openai_chat_reasoning_not_duplicated`.
    - `openai_chat_fold_mode_never_sends_reasoning_details`.
    - `openai_chat_cache_control_blocks_match_pi_placement`: system text, last tool (with `cacheControlOnTools`), and the last message's last text part. At most 4 markers, none on empty parts. Fails on any other placement.
    - `openai_chat_no_cache_control_without_option`: existing bodies are unchanged.
    - `routed_provider_map_usage_receives_chunk`.
    - `openai_chat_existing_fixtures_unchanged`: non-regression for hyper and opencode-go.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (`provider-kit` codec options and stream behaviour).
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: "Codec options" gains `reasoningReplay: "reasoning_details"`, `cacheControl`, and `cacheControlOnTools`. A new "Stream errors" paragraph. "Prompt cache planning" covers Chat-wire `cache_control` blocks. "Routes table" covers `mapUsage(usage, chunk)`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Landed 2026-10-24.** Code: `src/provider-kit/codecs/openai-chat.ts` (error frames, `reasoning_details`, cache blocks, `mapUsage(usage, chunk)`, `reasoningReplay: "reasoning_details"`), `src/provider-kit/routed-provider.ts` (both `mapUsage` signatures), `src/provider-kit/wire-replay.ts` (`recordingHasErrorFrame`, so a 200 recording with an error frame must end in `error`). Tests: new `src/__tests__/openai-chat-codec.test.ts`, 12 cases, all plan names plus `marks tools only when the route declares cacheControlOnTools` and `assert_recorded_stream_conformance_accepts_a_200_error_frame`. Docs: `docs/provider-kit.md` (`Stream errors` section, codec options, prompt-cache Chat-wire adapter, routes `mapUsage(usage, chunk)`, wire-replay sentence), `CHANGELOG.md`.
    - **Error frames.** `streamErrorEvent` builds one `Error` from `error.code` (number or 3-digit string), `error.metadata.error_type`, and `error.message`, then hands it to `providerError`, so `classifyProviderFailure` decides the class and `redactSecrets` the text; the loop returns, so no `done` follows. `finish_reason: "error"` without an error object yields the same terminal. Verified by the classification table (429 rate_limited, 429 quota text → quota, 502/503 transient, 400/402 permanent) and by the session cases: an overflow frame before output compacts once and retries once, after output fails with `ContextOverflowError` and no replay.
    - **`reasoning_details`.** Reading merges consecutive `reasoning.text` (and `reasoning.summary`) deltas into one entry with pi's `fillMissingCommonReasoningDetailFields` rule, keeps `reasoning.encrypted` discrete, and emits one `ThinkingContent` per entry with `data` = entry JSON, `redacted: true` only for encrypted. Each block's `signature` carries the ordered entry list, which is what survives session coalescing in `pushCoalescedContent` (it keeps text and signature but drops `data`); the writer prefers `data` blocks and falls back to that list, so replay stays byte-equal either way. `delta.reasoning` is suppressed once details are present, so text is never emitted twice.
    - **Cache blocks.** `chatCachePlan` runs `resolvePromptCachePlan` over the same message array that gets serialized, with pi's defaults (`system_prompt`, `tools`, `last_message`) and `maxBreakpoints` from the model caps (4 when undeclared); `stampCacheControl` marks only the last non-empty text part and turns a string `content` into a one-part array. Tools are marked only with `cacheControlOnTools`, and no `cache_control` appears anywhere without the option.
    - **Verification.** `bun test src/__tests__/openai-chat-codec.test.ts src/__tests__/provider-kit.test.ts src/__tests__/wire-replay.test.ts src/__tests__/cache-helpers.test.ts src/__tests__/provider-cache.test.ts src/__tests__/context-overflow-recovery.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/docs.test.ts` → 155 pass / 0 fail. `bun test packages/providers` → 89 pass / 2 skip / 0 fail. `bunx tsc --noEmit` clean. `bun scripts/release.mjs gate` green.
    - **Budget and baseline.** `scripts/budgets.json` is rebaselined to 1151391 packed / 3749339 unpacked / 39143 source lines / 360 files / 1489 root exports with the reason entry naming this task; the deltas are this codec plus the docs and CHANGELOG that ship in the pack. `bun scripts/release.mjs gate --update-baseline` rewrote `scripts/compat-baseline/arnilo__prism.txt`; this task adds **no** export line (the new knobs are option fields), so that diff carries plan 194's previously unbaselined exports (`ContextOverflowError`, `ProviderOverflowRecovery`, `applyDraft`, `draftFromRequest`, `applyRequestTransforms`, `contextOverflowMessage`).
    - **Scope check.** `rg -n -i "openrouter" src/provider-kit` finds nothing; no new `ContentBlock` type (`git diff -- src/contracts-core src/contracts-protocol.ts` shows only plan 194's work); no second planner.

- [x] Task 4: `@arnilo/prism-provider-openrouter`
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`; `references/prism.md` §4, new package and provider package):
        - the default export plus an `openrouter(options)` factory, with `fetch` and `id` as factory-only options;
        - `requires: { api: 1 }`;
        - minimal `capabilities`.

        Config (JSON Schema, `additionalProperties: false`):

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `apiKey` | ref | `env:OPENROUTER_API_KEY` | `secretRefProperty` |
        | `baseUrl` | string | `https://openrouter.ai/api/v1` | `baseUrlProperty` |
        | `models` | ModelConfig[] | — | when absent, `models()` asks `GET /models` |
        | `appUrl` | https URL | — | `HTTP-Referer` |
        | `appTitle` | string ≤ 100 | — | `X-OpenRouter-Title` |
        | `routing` | object | — | `provider` preferences (the keys listed in the research table); unknown keys rejected |

        A ref that resolves to nothing records a `warn` note and still registers the provider (as in `opencode-go/src/index.ts:68-71`).
      - **Route:** `openai-chat`, `POST /chat/completions`, bearer auth.
        - Affinity: `x-session-id` from `sanitizeCacheKey(cacheKey ?? sessionId, 256)`, the parity lever.
        - Attribution headers when configured, and `provider: routing` when configured.
        - Codec:
          - `reasoningReplay: "reasoning_details"`;
          - `imageInput: "capability-gated"`;
          - thinking → `reasoning: {effort}` (identity map);
          - **`cacheControl: "anthropic-blocks"` for models whose `compat.cacheControl` is `"anthropic-blocks"`**, which discovery stamps on `anthropic/*` ids (pi `openai-completions.js:1269`);
          - `cacheControlOnTools` as Task 1b (b) found.
        - No `prompt_cache_key` is sent, matching pi (`:580-583`).
      - **Usage:** `mapOpenAIChatUsage`, plus `cost` (`currency: "USD"`) and `metadata.openrouter = {model, provider, generationId, reasoningTokens}`.
      - **Errors** (`mapHttpError`), each with a redacted, actionable message:
        - 401 → `auth`;
        - 402 → `permanent` (the shared classifier's class for 402), with a credits message;
        - 429 → `rate_limited`, or `quota` on the free daily limit;
        - a data-policy no-endpoint error is permanent, and its message names the privacy setting and `routing.data_collection`.

        - **Context overflow (plan 194, landed).** The over-long-prompt body must classify `context_overflow` through the shared classifier (`src/provider-kit/transport.ts:31-47`, patterns as data). Task 1b could not reach an overflow on `openrouter/free` (largest free context 1,048,576 tokens), so this acceptance is **documented-shape only** — no live body backs it, and the test must say so in its name or fixture comment.
          - If the body already matches `CONTEXT_OVERFLOW_BODY`, a test proves it. Otherwise the pattern list gains the vendor-neutral phrase, and `overflow_classified_per_supported_route` (`src/__tests__/context-overflow-recovery.test.ts`) gains the recorded body.
          - Errors are built with `providerHttpError` (`src/provider-kit/retry-http.ts`), so the class always comes from `classifyProviderFailure`, never hand-set. An overflow sent as a mid-stream error frame before any output is also recovered (Task 3).
      - **Catalog.** A static `openRouterModels` holds `openrouter/free` with Task 1's capabilities. Its `contextWindow` is the smallest context in the free tool-capable pool, and its cost is 0.
      - **Context windows.** Every static and discovered model declares `limits.contextWindow`, and `maxOutputTokens` when known. Plan 194's estimate fallback, context accounting, and window-relative OM gate read them. A model whose window is unknown is left undefined and listed in the README; it is never guessed.

        `listOpenRouterModels` maps `GET /models`:
        - context length and max completion tokens into the limits;
        - image modality and `supported_parameters` (`tools`, `structured_outputs`, `reasoning`) into capabilities;
        - pricing per token into cost per million tokens, with the `-1` router price meaning no cost;
        - `compat.cacheControl: "anthropic-blocks"` for `anthropic/*` ids, and `cache.kind` set to `cache_control` or implicit to match.
      - **Wire replay fixtures** in `src/__tests__/wire/openai/`, with a README giving date, models, command, and provenance. Where captures are unavailable or unauthorized, use explicitly synthetic documented-shape contracts; these are not live cache evidence (paid/pinned verification remains Tasks 5/7):
        - `text`, `tool-loop`, `thinking` (`reasoning_details`), `structured-output`;
        - `cache-implicit` (the pinned free model with a session header);
        - `cache-anthropic` (the paid model: write on turn 1, read on turns 2–3);
        - `error` (401), the 402 or data-policy error, and `error-mid-stream`.
      - `providerConformance({ recordings })` passes offline.
      - `live.test.ts` runs `runProviderLiveScenarios` twice:
        - the pinned free model (`PRISM_LIVE_OPENROUTER_MODEL`): text, tool loop, structured output, abort, leak scan;
        - the pinned paid `anthropic/*` model (`PRISM_LIVE_OPENROUTER_CACHE_MODEL`): the cache scenario only, gated by the extra opt-in `PRISM_LIVE_OPENROUTER_PAID=1`.

        Both skip cleanly without the key or flags.
    - Performance:
      - Importing the package evaluates no sibling (`install-smoke`).
      - Discovery is one `GET /models` per `models()` call, and only without static models. The README states that the catalog is about 470 entries.
      - The README states the cost trade-off of the paid cache row (about 4 requests per run, under $0.05) and that it defaults off.
    - Code Quality:
      - The opencode-go package shape (`index.ts`, `provider.ts`, `models.ts`); no `as any`.
      - Enforcement rows, all in this task:
        - `packaging.test.ts:95,446` (provider dirs);
        - `install-smoke.test.ts:64,189`;
        - `package-truth.json`;
        - `phase24-truth.test.mjs:97`;
        - `phase54-package-map.test.mjs:60`;
        - `coverage-thresholds.json`, `e2e-coverage.json`;
        - the `live-matrix.json` row `providers/openrouter` (active; requires `PRISM_LIVE_PROVIDER_TESTS` and `OPENROUTER_API_KEY`; optional `PRISM_LIVE_OPENROUTER_PAID`; model env defaults; cost "~8 free requests plus 4 paid when opted in");
        - `live.env.example`;
        - not in `independent-packages.json` (lockstep).
      - `bun scripts/release.mjs gate --update-baseline` rewrites `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt`. The diff is attributed to plan 203, and removed 0.12 exports are noted as inherited from plan 182.
    - Security:
      - The key is ref-only, resolved per request.
      - `assertProviderOwnedHeadersWin` passes.
      - The attribution headers carry config values only.
      - `routing` is schema-validated.
      - The key never appears in events, `inspect()`, errors, or recordings.
      - The README covers the free-model data policy and the `data_collection`/`zdr` opt-ins.
  - Approach:
    - Documentation Reviewed:
      - `packages/providers/opencode-go/src/*`; `docs/provider-kit.md` §"Writing a provider package" and §"Shipping a provider"; `prism new package --provider` (`src/cli-manifest.ts:292`); Task 1 Notes.
    - Options Considered:
      - The kernel `openai-compatible` provider plus a `baseUrl`. Rejected: no sticky header, no `cache_control`, no cost or served model, and no error mapping.
      - A full static catalog. Rejected: it goes stale daily.
      - `openrouter/free` for live rows. Rejected: a random served model makes failures irreproducible (owner decision).
    - Chosen Approach:
      - Scaffold with `prism new package --provider openrouter`, then fill in the route, codec options, mappers, and catalog from Task 1.
    - API Notes and Examples:
      ```ts
      import { createAgent } from "@arnilo/prism";
      import openrouter from "@arnilo/prism-provider-openrouter";
      const agent = await createAgent({ model: "openrouter/anthropic/claude-haiku-4.5", packages: [openrouter] });
      ```
    - Files to Create/Edit:
      - `packages/providers/openrouter/**` (package, tests, recordings, README, CHANGELOG).
      - The enforcement-row files above.
      - `packages/providers/README.md` (drop the stale "All 21 first-party adapters" sentence).
      - `docs/index.md`, `docs/models.md:156`, `docs/release.md:137-143`, `bun.lock`, `CHANGELOG.md`.
    - References:
      - plans 183 and 196; Task 1 Notes.
  - Test Cases to Write:
    - `openrouter_package_conformance` (all recordings).
    - `openrouter_usage_carries_cost_and_served_model`.
    - `openrouter_session_affinity_header`: present, sanitized, truncated to 256; absent when unset.
    - `openrouter_anthropic_models_get_cache_blocks`: discovery stamps `anthropic/*`; a non-Anthropic model gets no `cache_control`.
    - `openrouter_never_sends_prompt_cache_key`.
    - `openrouter_attribution_headers_only_when_configured`.
    - `openrouter_routing_config_rejects_unknown_keys`, `openrouter_routing_passthrough`.
    - `openrouter_thinking_level_maps_to_reasoning_effort`.
    - `openrouter_error_mapping` (401, 402, 429 rate vs quota, data policy; key absent).
    - `openrouter_mid_stream_error_is_error_event`.
    - `openrouter_overflow_classified_and_recovered`: the recorded overflow body classifies `context_overflow`, and a session on a replaying mock compacts once and retries once.
    - `openrouter_catalog_declares_context_windows`.
    - `openrouter_missing_key_notes_and_registers`.
    - `list_openrouter_models_maps_capabilities_cost_and_cache_kind`.
    - Existing gates updated: `packaging`, `install-smoke`, `phase24-truth`, `phase54-package-map`, `docs.test`, `live-matrix.test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new provider package).
    - Docs pages to create/edit:
      - `packages/providers/openrouter/README.md` (package page structure). It includes a **"Prompt caching"** section: the sticky header, Anthropic blocks, implicit caching elsewhere, and what usage reports.
      - Provider counts in `docs/models.md`, `docs/release.md`, `packages/providers/README.md`.
    - `docs/index.md` update: yes. "`@arnilo/prism-provider-openrouter`: OpenRouter provider package for Prism."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Package implemented.** `packages/providers/openrouter/{package.json,tsconfig.json,LICENSE,README.md,CHANGELOG.md,src/index.ts,src/provider.ts,src/models.ts}` follows the existing provider package pattern: default definition, `openrouter` factory, API level 1, ref-only credentials resolved per request, missing-key warning with provider registration, one Chat route, optional attribution/routing, conservative static free catalog and lazy one-GET discovery. Factory-only `id`/`fetch` never enter manifest config. No sibling imports, runtime dependency, version bump, or publish.
    - **Wire and security.** Affinity sanitizes `cacheKey ?? sessionId` to 256 characters. Discovered Anthropic entries derive `compat.cacheControl`/cache capabilities and use the shared block planner, including the last tool; non-Anthropic models send no markers. No `prompt_cache_key`. Portable thinking levels map identically to `reasoning.effort`; details replay uses the shared codec. Usage carries numeric USD cost and served-model/provider/generation/reasoning metadata. HTTP errors use `providerHttpError`, with actionable key, credits, daily-quota and privacy messages. Attribution headers are stripped from caller headers and populated only from validated app config; HTTPS app URLs reject malformed URLs and embedded credentials. Auth/content-type ownership and canary redaction are tested.
    - **Fixture provenance / acceptance clarification.** Nine JSON scenarios under `src/__tests__/wire/openai/` cover text, tool loop, reasoning details, structured output, implicit cache, three-turn Anthropic cache, 401, 402 and HTTP-200 mid-stream error. These are **synthetic documented-shape fixtures**, explicitly labeled in their README; the original `/tmp/prism-openrouter-probe` files are unavailable. No synthetic write/read count is presented as measured evidence. The overflow test is explicitly named `openrouter_documented_shape_overflow_classified_and_recovered`; it proves classification, one compaction and one retry using a mock session, not a live overflow. The fixture criterion above now states this provenance constraint rather than implying unauthorized paid captures. Live paid/pinned validation remains deferred to owner authorization and Tasks 5/7; no authenticated requests were sent for this task.
    - **Live suites.** Two `runProviderLiveScenarios` registrations: pinned `:free` model for text/tools/structured output/abort/leak scan, Anthropic cache only behind `PRISM_LIVE_OPENROUTER_PAID=1`. Both retain the global flag/key gates. Discovery fails with an actionable retired-model message; model overrides are wired. Paid prefix exceeds Haiku's minimum; 128 output tokens cap each request. Current cache helper sends two paid calls, budget allows up to four (approximately under $0.05 at the default model), default off. No live benchmark campaigns or reference-host model selection changed.
    - **Shared seams required by this task.** Recorded `providerConformance` still assumed every HTTP-200 fixture must end in `done`, despite Task 3's separate recorded-stream assertion accepting error frames. It now reuses `recordingHasErrorFrame` from `wire-replay.ts`; explicit barrel exports keep this internal helper out of the public kernel surface. Shared live options gained `scenarios` so paid cache rows cannot accidentally execute unrelated paid probes. Chat cache probes now keep one affinity id and put an explicit marker on `stable_context`, not the changing suffix. `src/__tests__/provider-live-selection.test.ts` proves only cache executes, both requests share affinity, and the marked prefix stays stable. Documented in `docs/testing.md`.
    - **Enforcement/docs.** Updated packaging and isolated-install lists, six-provider count gates, historical topology count 46, 49 still-retired legacy-name docs sweep, seven live provider rows (including Liquid's two routes), coverage/e2e rows, live matrix/env example, `bun.lock`, package truth and generated release/index/evidence tables. The umbrella deprecation successor names all six shipped adapters; OpenRouter still deprecates only `<0.13.0`. Updated `docs/models.md`, provider index README, root CHANGELOG and package README; package linked once in `docs/index.md`. Root workspace glob already includes this directory; lockstep package stays out of `independent-packages.json`.
    - **Verification.** `bun run typecheck` passes (root build, all workspaces and examples). Combined provider/shared codec/conformance/live-helper/overflow/docs/phase24/phase54/live-matrix/retirement suites: **258 pass, 2 skip, 0 fail across 28 files**; skips are existing Liquid live image probes. Packaging + install smoke: **269 pass, 0 fail**. Package behavior/conformance: **18 pass**, with no live network; lint clean for new source/tests. Package coverage meets the new 90% lines / 95% functions floor (100% functions; models 96.97% lines before the additional discovery-error tests, other product modules 100%). `git diff --check` clean. `bun scripts/release.mjs gate --update-baseline` passes for **46 packages**.
    - **Baseline and budget.** `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt` regenerated: 9 additions / 16 removals against the retained 0.12 baseline. Removed legacy body/events/cache/reasoning/model-builder exports are inherited from plan 182's retirement, not compatibility aliases to restore. Added catalog/base URL, routing, usage/error and affinity helpers belong to this task. Root/kit runtime exports have no new public name (verified by importing both barrels). The root baseline scanner nevertheless adds the internal `recordingHasErrorFrame` declaration and two explicit re-export type rows (`RecordedExchange`, `RecordedStreamConformanceOptions`) from this task; its declaration scan includes internal module exports. Other pre-existing baseline changes in the dirty tree belong to earlier tasks/plans. Kernel budget records 1152063 packed / 3751924 unpacked / 39127 source lines / 360 files / 1490 counted module exports, with a Task 4 reason for shared live/conformance changes and shipped docs. The one counted extra is the internally shared error-frame predicate, not a new root export. Retirement-name sweep over `src/ packages/ apps/ scripts/ examples/ docs/` found no live callers of the removed legacy OpenRouter exports (excluding dist, history, evidence and frozen baselines).

- [x] Task 5: Cache parity with pi — lever equivalence, the provider-level probe, and the plan 184 cell
  - Acceptance Criteria:
    - Functional:
      - **Lever equivalence (offline).** `cache_levers_match_pi_openrouter` builds Prism's request for a fixed 3-turn transcript (system prompt, 2 tools, a tool call and its result, a follow-up). It asserts the cache-relevant fields equal the pi reference:
        - the `x-session-id` value derivation;
        - `cache_control` marker count and positions for an `anthropic/*` model, and none for others;
        - `reasoning_details` replay;
        - no `prompt_cache_key`;
        - byte-identical `tools`, system text, and `messages[0..n-1]` across turns, using plan 184's `prefixStabilityConformance` if it exists, or the same assertion inline otherwise.

        The reference is a pi request recorded through the wire proxy when Task 1 (e) found a base-URL override **and the pinned model's capture is authorized**; otherwise use an explicitly source-derived offline fixture with version/line citations in its README. A known base-URL override does not authorize paid or pinned requests. This fallback proves lever equivalence only; Task 7's live thresholds stay deferred until authorized.
      - **Provider-level probe.** `scripts/cache-parity/provider-probe.mjs --provider <id> --model <id> --turns 4`:
        - It replays a fixed transcript with a stable prefix of **8K tokens** (system, tools, history) through the provider package, with one session cache key. It must never go below the target model's minimum cacheable prefix — `anthropic/claude-haiku-4.5` caches nothing under 4096 tokens, so a ~3K prefix would report zero reuse and read as a parity failure.
        - It writes `docs/_evidence/cache-probe/<provider>-<model>-<date>.json`, containing per turn `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and latency.
        - It reports `reuse = Σ cacheRead(turn ≥ 2) / Σ stablePrefixTokens(turn ≥ 2)`.

        Plans 204–206 reuse it unchanged.
      - **Thresholds, recorded by Task 7's live run:**
        - the paid `anthropic/*` model reaches reuse ≥ 0.9 on turns 2–4;
        - the pinned implicit-cache model reports reuse > 0 with the session header and records the value without it.

        **Both threshold rows are deferred:** on 2026-10-24 the owner authorized `openrouter/free` only, which never serves `anthropic/*` and changes model per request, so reuse is not attributable to a model. Until the owner widens the authorization, Task 7 records `unmeasurable` with that reason (the free rows in Task 1b note (R2) already show `cached_tokens` can be non-zero without any lever, which is not parity either).

        If OpenRouter's free endpoints never report cache counts, the probe records `unmeasurable` with the reason; it never claims parity.
      - **Plan 184 cell.** Plan 184 is amended:
        - its parity matrix gains an `openrouter` cell: Prism against `pi -p --mode json --provider openrouter` on the pinned `anthropic/*` model, using the headless command Task 1 (e) verified;
        - the cell is gated by `PRISM_LIVE_OPENROUTER_PAID=1`;
        - the `release/cache-parity` row lists it.
    - Performance: the probe makes `turns` requests per model, stated in its help text and in the matrix `cost` line. It never runs in `release:gate`.
    - Code Quality:
      - The probe imports only the named provider package (dynamic import by name, like `memory-bench/run.mjs:186`).
      - Transcripts are fixtures under `scripts/cache-parity/fixtures/`.
      - No dependency on plan 184's runner, which does not exist yet. Plan 184 may later reuse the probe's transcript.
    - Security: the probe reads keys from the environment loaded from `live.env`, prints no key, and its evidence passes `scan-secrets`.
  - Approach:
    - Documentation Reviewed:
      - plan 184 (objectives, Task 3 runner, Task 4 gate); pi `openai-completions.js` lever lines; `src/testing/provider-live-scenarios.ts` (`DEFAULT_LIVE_CACHE_PREFIX`); `scripts/wire-proxy.mjs`.
    - Options Considered:
      - Building plan 184's whole runner now. Rejected: 184 measures the reference host's workload after plans 194 and 202 change it. A provider-level probe answers "does the wire reuse the prefix" now, and 184 answers "does the harness match pi" at the gate.
      - Claiming parity from lever equivalence alone. Rejected: an upstream can ignore a lever, so only a measured read count shows reuse.
    - Chosen Approach:
      - Equivalence by construction (offline), then a measured provider-level probe (live), then a harness-level cell in 184's gate.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/cache-parity/provider-probe.mjs --provider openrouter --model anthropic/claude-haiku-4.5 --turns 4
      ```
    - Files to Create/Edit:
      - `scripts/cache-parity/provider-probe.mjs`, `scripts/cache-parity/provider-probe.test.mjs`, `scripts/cache-parity/fixtures/three-turn-coding.json`: new.
      - `packages/providers/openrouter/src/__tests__/cache-levers.test.ts` and `fixtures/pi-request-*.json`: new.
      - `plans/184-…md`: openrouter cell.
      - `docs/live-testing.md`: probe usage.
    - References:
      - plan 184; Task 1 (e).
  - Test Cases to Write:
    - `cache_levers_match_pi_openrouter`: fails if a lever is missing, extra, or moved.
    - `provider_probe_reuse_math`: an offline mock provider with scripted usage gives the expected reuse and `unmeasurable` when usage has no cache fields.
    - `provider_probe_imports_only_named_provider`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no package API. Operator procedure only.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: a "Provider cache probe" subsection (command, cost per run, reading the reuse figure).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **Offline reference and proof.** Added `packages/providers/openrouter/src/__tests__/cache-levers.test.ts` and `fixtures/pi-request-openrouter.json` / `fixtures/README.md`. Six reference requests (Anthropic and pinned non-Anthropic, three growing transcript snapshots each) were generated from installed pi-ai **1.4.0**'s actual `stream` with a fake fetch, never an upstream. The README cites `dist/api/openai-completions.js:544–623,799–871,873–1060,1268–1306`, `dist/utils/transcript.js:1–25`, versioned upstream source and the exact input mapping. Current pi provider input needs an initial system message with `toolsAdded`; the old `Context.tools` shape would have omitted tools. Context7's versioned cache/compat docs were checked. `cache_levers_match_pi_openrouter` compares Prism's real provider output against the entire reference messages/tools: session header, all marker values/counts/positions, no markers on the non-Anthropic model, reasoning-detail replay and no `prompt_cache_key`. It byte-compares tools and all previous messages across turns, normalizing only the moving marker and its singleton text wrapper. The existing prefix conformance helper has no wire `encode` option yet, so this remains inline as permitted.
    - **Reference limits / acceptance clarification.** Task 1 found a base-URL override, but that does not authorize a paid/pinned capture. The reference criterion now explicitly permits source-derived offline fixtures while such captures are unauthorized. The fixture uses short retention, plain-string pi user input and `reasoning: false` (system instruction role); historical reasoning details still replay. It does not claim equality for pi's developer-role path, arbitrary user text-array shapes, long retention, header precedence or the actual headless harness workload. Those limits are named in the README, not hidden by normalizing the reference comparison. Paid/pinned wire evidence and measured reuse remain Task 7's deferred threshold rows.
    - **Reusable probe.** Added `scripts/cache-parity/provider-probe.mjs`, `provider-probe.test.mjs` and `fixtures/three-turn-coding.json`. The script dynamically imports exactly `@arnilo/prism-provider-${id}` and finds that package's unique exported provider factory/model-list function; no kernel, sibling provider, pi runtime or future plan 184 runner import. The transcript carries system, two tools, a completed tool call/result and a follow-up. Probe-only padding targets at least 8192 tokens (or a larger declared model cache minimum, bounded at 65536); the first real reported input count must meet that minimum or the run stops `unmeasurable` before further spend. Its reported first-request prompt is the stable-prefix denominator for each later turn, with deterministic suffixes appended and explicit system/tools/anchor boundaries kept fixed. Synthetic thinking/signature canaries are removed from live history; the wire regression asserts none are sent. Generated responses are not inserted.
    - **Measurements and cost.** Evidence contains per-turn `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `stablePrefixTokens` and full-stream latency. Missing fields stay `null`; missing/estimated input or absent warm cache reads is `unmeasurable`, while explicit zero reads measures zero. Invalid read counts fail measurement. Reuse is the specified warm-read sum divided by the stable-prefix sum; no estimate or fabricated zero substitutes for missing provider truth. Reads of an already cached suffix may make reuse slightly above 1; it is not capped. `--turns` defaults to four, accepts 2–20, and bounds generation requests with no retries; each caps output at 128 and has a 60s signal. Existing vendor token-cap aliases are removed before setting that portable cap. One catalog discovery operation precedes a successful run (one GET for OpenRouter). `--without-session` performs a separately authorized, independent cold-prefix run, omits both affinity options and writes a separate report; comparing both modes costs eight generation requests at defaults. This is a provider diagnostic, not a declaration of harness parity.
    - **Security / operation.** Manual execution requires both `PRISM_LIVE_PROVIDER_TESTS=1` and `PRISM_LIVE_CACHE_PARITY=1`; paid OpenRouter additionally requires `PRISM_LIVE_OPENROUTER_PAID=1`. Router aliases `openrouter/free` and `openrouter/auto`, unsafe provider ids, unknown flags and invalid turn counts are rejected. Model discovery must find the pinned model, a sufficient context window and tool capability. Env loading reuses `parseEnvFile`, preserves existing env and refuses non-private credential files; no key arguments or pi auth-file reads. Known-key event/report checks and `scanSecrets` run before atomic publication of mode-0600 metric-only evidence. Raw upstream errors/text/headers never print or persist. Same model/mode/day reruns replace their report, documented so operators archive campaigns deliberately.
    - **Plan 184 cell and docs.** Amended only its unchecked work: explicit five-cell matrix, pinned `anthropic/claude-haiku-4.5`, `pi -p --mode json --provider openrouter` command, paid flag/key, deferred `unmeasurable` reason and strict behavior when explicitly opted in. Its future `release/cache-parity` row now specifies the fifth cell, optional OpenRouter key/paid flag and 120-request per-enabled-cell cost, separately from this four-request diagnostic. No nonexistent full runner or active live-matrix row was fabricated; implementing that row remains plan 184 Task 4. Hyper/OpenCode Go journeys and existing benchmark choices remain unchanged. Updated `plans/README.md`, `docs/live-testing.md` operator procedure, `scripts/live.env.example` and root CHANGELOG. Regenerated the live-doc table, correcting the existing OpenRouter row's ordering drift. No new docs page/index link, package/dependency, host/default, public export, error contract, version or publish.
    - **Tests first and verification.** Probe tests first failed for the missing implementation; lever test first failed for its missing reference. Final combined probe/package/docs/live-doc/live-matrix run: **113 pass, 0 fail across 7 files**. New tests cover reuse arithmetic, unknown/estimated/undersized counts, larger model minima, exact request budget and stable affinity, actual OpenRouter wire prefix/markers/output cap, no fake signatures, named-only import, invalid arguments, incomplete/error streams, secret leaks, private atomic evidence and scanner rejection, no-header filenames, env permissions/precedence and CLI opt-in/help/no-key-output. `bun run typecheck` passes across root, workspaces and examples; lint clean for all three new code/test files. `bun scripts/scan-secrets.mjs scripts/cache-parity packages/providers/openrouter/src/__tests__/fixtures packages/providers/openrouter/src/__tests__/cache-levers.test.ts`: **6 files, 0 findings**. `git diff --check` clean. `bun scripts/release.mjs gate` passes for **46 packages**, `updated: false`; no compat-baseline change was needed.
    - **Budget / live boundary.** Kernel source/export/file-count ceilings are unchanged. Only shipped operator docs and CHANGELOG grew; `scripts/budgets.json` records measured **1154173 packed / 3757280 unpacked** with that reason. Probe scripts and fixtures are outside the kernel pack. **No upstream model requests were sent, no paid spend occurred, no live evidence or cache-hit/parity claim was fabricated.** The paid ≥0.9 and pinned implicit >0/header-off measurements remain explicitly deferred to Task 7 and owner authorization, as the acceptance criteria require. Task 6 remains unchecked.

- [x] Task 6: OpenRouter rows in the open release-path plans
  - Acceptance Criteria:
    - Functional: each listed plan gets the note "Amended 2026-10-24 by plan 203 (OpenRouter ships; live benchmarks and acceptance are unchanged)". Only unchecked tasks are edited:
      - **185:** the `CredentialValueSource` → `SecretSource` migration and the shape baselines include `packages/providers/openrouter`.
      - **186:** the strict `providers/` run and the preflight include `providers/openrouter`. The journeys stay on Hyper and OpenCode Go.
      - **184:** done in Task 5; verify only.
      - **187:** done in Task 2; verify only.

      `rg -n -i "openrouter" plans/{184,188.11,194,201,202}-*.md` finds no instruction to run a live benchmark on OpenRouter. The `plans/README.md` descriptions of 184, 185, and 186 are updated where they enumerate providers.
    - Performance: n/a.
    - Code Quality: only unchecked tasks are edited.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plans 184–187; Task 1 Notes (f); plan 196's header precedent.
    - Options Considered:
      - Leaving them unchanged. Rejected: 185 would freeze without the package's migration, and 186 would skip a shipped provider.
    - Chosen Approach:
      - Amend the provider enumerations only.
    - API Notes and Examples:
      ```markdown
      **Amended 2026-10-24 by plan 203 (OpenRouter ships; live benchmarks and acceptance are unchanged).** …
      ```
    - Files to Create/Edit:
      - `plans/{185,186}-…md`, `plans/README.md`.
    - References:
      - Task 1 Notes (f).
  - Test Cases to Write:
    - `docs.test.ts` plans-index check (existing).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-25):
    - **185 amended.** Added the required `Amended 2026-10-24 by plan 203 (OpenRouter ships; live benchmarks and acceptance are unchanged)` header. Its entry inventory and expected outcome now include all six current provider packages. Task 3 explicitly migrates OpenRouter's factory and discovery option types in `packages/providers/openrouter/src/{provider,models}.ts` from `CredentialValueSource` to `SecretSource`, updates the package wrapper/tests in the same future task, and preserves ref-only manifest config. This is not a no-op: graft found both option interfaces still accept `CredentialValueSource` (`provider.ts:28`, `models.ts:76`) and discovery imports `resolveCredentialValue` (`models.ts:1`), refining Task 1's earlier conditional assessment. Task 4 explicitly includes `scripts/compat-baseline/arnilo__prism-provider-openrouter.txt` and its resolved post-migration shapes. No migration or baseline regeneration was executed by this planning-only task.
    - **186 amended.** Added the same header and OpenRouter to T1, credential/model variables, discovery preflight and the first strict-run procedure: six packages, seven provider rows, five API keys. Both `--suite providers/` and `--suite release/` preflights are now explicit; checking only release rows would miss OpenRouter's key. Its probe uses the package's `listOpenRouterModels`, one catalog GET, never a completion or paid-cache request. The plan explicitly avoids claiming that OpenRouter's public catalog validates a key; authenticated truth comes from authorized T1. Added OpenRouter to the existing future preflight test case. Task 3's ten-scenario journey is unchanged, still exclusively Hyper/OpenCode Go, with unchanged models and budgets. Paid cache remains separately opt-in; the pinned T1 default does not widen the owner's `openrouter/free`-only authorization.
    - **184 / 187 verified only.** Kept both files byte-identical to their contents at this task's start (SHA-256 comparison). Plan 184 already has the exact amendment header, deferred/paid-gated pinned Anthropic cell and unchanged Hyper/OpenCode Go workloads from Task 5. Plan 187 already excludes restored OpenRouter from the retired set, uses its `<0.13.0` deprecation range and requires strict coverage of six packages/seven rows from Task 2; its existing amendment is dated 2026-10-25. No completed task or historical execution note was rewritten.
    - **Index and benchmark sweep.** Updated both summary/detail descriptions of 185/186 in `plans/README.md`; 184's existing description already names its gated OpenRouter cell. Ran the required `rg -n -i "openrouter" plans/{184,188.11,194,201,202}-*.md`: only 184 matches. Those matches are the explicitly authorized optional parity cell/provider diagnostic from Task 5, not instructions to replace a live benchmark or release-acceptance journey. Plans 188.11, 194, 201 and 202 contain no OpenRouter reference. No benchmark routing or existing acceptance workload was changed.
    - **Proof.** Wrote a temporary assert-based acceptance check before edits; it first failed `185 missing amendment`, then passed checks for both headers, the credential/baseline/T1/preflight/index inclusions, fixed journey provider set, unchanged verify-only files and benchmark sweep. `bun test --timeout=0 src/__tests__/docs.test.ts`: **64 pass, 0 fail**, including the existing plans-index check. `bun run typecheck` passes across root/workspaces/examples. `git diff --check` clean. Only plans 185, 186, their index and this Task 6 status/note were edited in this task; no runtime code, public docs, changelog, dependencies, exports or budgets changed, so no compatibility regeneration or packed-release gate was needed. No live requests, credential reads or spend. Task 7 remains unchecked and owner-gated.
  - Notes (executed 2026-10-25; **closed with the paid cache leg deferred**, owner decision):
    - **Scope amendment.** Free tier is proven end to end; the paid `anthropic/*` cache run is deferred, not waived. It stays gated by `PRISM_LIVE_OPENROUTER_PAID=1` in the matrix row, in plan 184's parity cell, and in plan 186's acceptance run, and it runs unchanged once the owner funds credits. Acceptance items for the paid suite and paid probe are satisfied by this deferral, recorded here and in the evidence file.
    - **Credentials.** `~/.config/prism/live.env` is mode `0600` and carries `OPENROUTER_API_KEY` (owner supplied). Key `is_free_tier: false`, key cap `$50` with `$49.94` remaining; account `total_credits: 25`, `total_usage: 25.12` — the funded balance is exhausted.
    - **Defect found by the first strict run (fixed).** Live model discovery failed with `ProviderTransportError: Response body exceeded 65536 bytes`: the catalog now has 466 models, far above the shared 64 KiB request-body cap, so every scenario failed before its first completion. Fix at the narrowest layer: `packages/providers/openrouter/src/models.ts` reads only the catalog with `OPENROUTER_CATALOG_BYTES` (4 MiB) while completions keep the default cap. Regression test `openrouter_catalog_over_request_body_cap_still_parses` (470-entry, >64 KiB catalog) added to the package suite.
    - **Free-tier live row: passes.** `PRISM_LIVE_FILTER=providers/openrouter bun run test:live` → 1 ran, 0 failed. Text, two-turn tool loop with thinking replay, `json_schema` structured output, abort before first request, and error redaction all pass on `recursive/flint-v1.0:free` (served by `Recursive`); paid scenarios skip without the paid flag, as designed.
    - **Model repin (recorded).** The previous default `google/gemma-4-31b-it:free` answered HTTP 429 "temporarily rate-limited upstream" from Google AI Studio's shared free pool on every attempt during the run (same for `google/gemma-4-26b-a4b-it:free`); Prism surfaced that correctly as a redacted `run.failed`. The pin is now `recursive/flint-v1.0:free`, a free tool-capable model that passed every scenario. Because it is a reasoning model, the free suite allows 768 output tokens (128 truncated its JSON answers); the paid cache suite keeps 128. `scripts/live-matrix.json` (pin plus a corrected cost line: ~6 free requests = 5 scenarios + discovery), `scripts/live.env.example`, `docs/live-testing.md` (regenerated table and probe example), and the package README all carry the new pin.
    - **Cache probe, free model.** `provider-probe.mjs --turns 4` with and without the session key: 4 requests each, 8406-token stable prefix, measured reuse `0` both ways (`docs/_evidence/cache-probe/openrouter-recursive-flint-v1.0-free-2026-10-25.json`, `…-without-session-2026-10-25.json`). Both `cacheReadTokens` and `cacheWriteTokens` are 0 on every turn, and no zero-priced catalog entry advertises cache pricing, so the free pool is a zero-reuse subject; the Task 5 implicit threshold (`> 0`) is not reachable on the free tier today and is not evidence against the levers.
    - **Paid Anthropic cache row: deferred.** At 08:14 UTC the two-turn probe **passed** on `anthropic/claude-haiku-4.5` — turn 1 `{read: 0, write: 21604}`, turn 2 `{read: 21604, write: 0}` (reuse 1.0, over the 0.9 Task 5 threshold), with `cache_control: {type: ephemeral}` on the stable-prefix message and no `prompt_cache_key`. That pass has no surviving artifact (the live-matrix report was overwritten by later runs), so it is supporting, not conclusive, evidence. Every later paid attempt returned HTTP 402 from OpenRouter's credit cashier (`Prompt tokens limit exceeded: 19347 > 15535`, then `would exceed your available credits`): the account has no funded credits, and the key's `$50` limit is a cap, not a balance. Subsequent paid runs fail closed — OpenRouter answers the streamed request with an error frame, so no usage arrives and the warm-turn assertion fails. Deferral follows plans 184/186, where the OpenRouter cache measurement is already separately gated; no Prism code change is implied by the 402s.
    - **Budget and security.** 12 free requests (5 scenarios + 1 discovery + 8 probe turns), 8 paid attempts, spend `$0.0598` — inside the approved `< $0.10`. `scan-secrets` over `docs/_evidence` is clean (`389 files, 0 findings`) and the evidence file quotes only redacted upstream text, with no key, account id, or `user_id`. Note that a whole-repo `scan-secrets` run currently aborts on the pre-existing, gitignored `dist-bin/linux-x64/prism-code` (over the 16 MiB file cap), unrelated to this task.
    - **Evidence.** `docs/_evidence/openrouter-live-2026-10-25.md` records models and served providers, free-tier status and quota before/after, request counts, spend, probe reuse against the Task 5 thresholds, the leak scan, and the paid deferral.
    - **Verification.** Package suite 20 pass; `bun run --filter @arnilo/prism-provider-openrouter typecheck` passes; `scripts/live-doc-check.test.mjs`, `scripts/live-matrix.test.mjs`, and `scripts/cache-parity/provider-probe.test.mjs` pass (30 tests). Whole-plan verification steps remain for the closing pass.
    - **Remaining to close the deferral.** With credits funded, run `PRISM_LIVE_STRICT=1 PRISM_LIVE_OPENROUTER_PAID=1 PRISM_LIVE_FILTER=providers/openrouter bun run test:live` and `provider-probe.mjs --provider openrouter --model anthropic/claude-haiku-4.5 --turns 4`, then append the paid figures to the evidence file and record the run in plan 184's parity cell. This is scheduled work for the gated cell, not an open item of this plan.

- [x] Task 7: Strict live run, cache probe, and evidence (the owner provides the key and approves the spend)
  - Acceptance Criteria:
    - Functional:
      - With `OPENROUTER_API_KEY` in `live.env` (mode `0600`):
        - `PRISM_LIVE_STRICT=1 PRISM_LIVE_OPENROUTER_PAID=1 PRISM_LIVE_FILTER=providers/openrouter bun run test:live` passes;
        - `provider-probe.mjs` runs on the pinned free model (with and without the session key) and on the pinned `anthropic/*` model.
      - `docs/_evidence/openrouter-live-<date>.md` records:
        - models and served models;
        - free-tier status and quota before and after;
        - request counts and spend;
        - the probe reuse figures against the Task 5 thresholds;
        - the leak-scan result.

        No key or account id appears.
      - Budget: at most 25 free and 12 paid requests. If free requests run short, wait for the UTC reset and record that.
    - Performance: measured counts are compared with the matrix `cost` line, which is corrected if they differ.
    - Code Quality: no code change unless a defect is found. A defect gets a fixture, a test in the owning file, and a fix at the narrowest layer.
    - Security: `scan-secrets` passes over the evidence. `live.env` permissions are checked first.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md`; plan 196 Task 2.
    - Options Considered:
      - Deferring to plan 186. Rejected: a defect found there lands after the freeze.
    - Chosen Approach:
      - One strict row plus the probe, within the budget.
    - API Notes and Examples:
      ```sh
      timeout 900 env PRISM_LIVE_STRICT=1 PRISM_LIVE_OPENROUTER_PAID=1 PRISM_LIVE_FILTER=providers/openrouter bun run test:live
      ```
    - Files to Create/Edit:
      - `docs/_evidence/openrouter-live-<date>.md`, `docs/_evidence/cache-probe/openrouter-*.json`, and the `scripts/live-matrix.json` cost line.
    - References:
      - Tasks 4–5.
  - Test Cases to Write:
    - n/a (live run). Any defect adds a regression test in the owning file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence files only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-provider-openrouter test`
- `timeout 600 bun run --filter @arnilo/prism-provider-hyper test && timeout 600 bun run --filter @arnilo/prism-provider-opencode-go test` (codec non-regression)
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts`
- `timeout 600 bun test --timeout=0 scripts/retired-providers.test.mjs scripts/host-completeness-evidence.test.mjs scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/registry-deprecate.test.mjs scripts/cache-parity/provider-probe.test.mjs`
- `timeout 120 bun scripts/registry-deprecate.mjs --generate && timeout 120 bun scripts/registry-deprecate.mjs --dry-run`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 900 env PRISM_LIVE_STRICT=1 PRISM_LIVE_OPENROUTER_PAID=1 PRISM_LIVE_FILTER=providers/openrouter bun run test:live` (owner key; Task 7)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
