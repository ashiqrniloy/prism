# First-Class Hyper (Charm) and Command Code Providers

Full evaluation and implementation plan for adding first-class provider support to Prism for:

1. **Charm Hyper** — coding-optimized inference from Charm (Charmbracelet), `https://hyper.charm.land/v1`.
2. **Command Code Provider API** — the model aggregator behind the Command Code coding CLI, `https://api.commandcode.ai/provider/v1`.

Both land as new `@arnilo/prism-providers/<adapter>` subpaths, following the existing first-party
package conventions (offline-first, zero setup network, caller-supplied credentials, provider-owned
headers, conformance suite, gated live smoke tests, docs pages, cache-kind metadata).

---

## Provider evaluation summary (docs-verified, fetched 2026-07)

### Charm Hyper — https://hyper.charm.land

| Aspect | Finding |
| --- | --- |
| Product | Coding-agent inference ("Hyperinference"): open source reasoning models, zero data retention, Hypercredits (1 HC = 5¢; 100 free/month; $20/mo = 250 HC refreshing daily; prepaid bundles never expire; master + sub keys for teams). |
| Base URL | `https://hyper.charm.land/v1` |
| Auth | `Authorization: Bearer sk-hyper-…` on all routes; `/v1/messages` additionally accepts `X-Api-Key` (Claude Code compat) + `anthropic-version: 2023-06-01`. Env convention: `HYPER_API_KEY`. |
| Routes | `POST /v1/chat/completions` (OpenAI-compatible, all standard params: `temperature`, `max_tokens`, `tools`, `top_p`, `stop`); `POST /v1/responses` (OpenAI Responses standard pass-through); `POST /v1/messages` (Anthropic Messages-compatible, "all standard Anthropic parameters accepted"). |
| Discovery | `GET /v1/models` — **public, no auth**. Richest metadata of any Prism provider: `context_window`, `max_output_tokens`, `capabilities.vision`, `reasoning.effort_levels[]` + `default_effort_level` (values like `none`/`low`/`medium`/`high`/`xhigh`/`max`), `pricing {input, output, cache_create, cache_hit}` per Mtok. |
| Balance | `GET /v1/credits` (auth) → `{ "balance": <hypercredits> }`. |
| Usage | Standard OpenAI usage **plus** `usage.cost.usd`, `usage.cost.hypercredits`, `usage.remaining.hypercredits`; on streams these appear in the final chunk with `stream_options: {include_usage}`. |
| Errors | OpenAI envelope on OpenAI routes, Anthropic envelope on `/v1/messages`. `400 invalid_request_error`, `401 authentication_error`, **`402 billing_error` (insufficient Hypercredits)**, `403 permission_error`, `404` model not found, `429 rate_limit_error`, `5xx server_error` (upstream failure). |
| Live catalog (31 models) | `deepseek-v4-flash(-0731)`, `deepseek-v4-pro(-0813)`, `gemma-4-26b-a4b-it`, `glm-5`, `glm-5.1`, `glm-5.2`, `glm-5.3(-flash)`, `gpt-oss-120b`, `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k3`, `llama-3.3-70b-instruct`, `llama-4-maverick-…-fp8`, `minimax-m2.7`, `minimax-m3`, `qwen3.6-{flash,max,plus}`, `qwen3.7-{flash,max,plus}`, `qwen3.8-{2.4t-a95b,27b,flash,max}`, `qwen3-coder-480b…`, `qwen3-next-80b…`. Vision: glm-5.3-flash, kimi-k2.6/k2.7-code/k3, minimax-m3, qwen3.6-flash/plus, qwen3.7-flash/plus, qwen3.8-27b/flash/max. |
| Caching (from `/v1/models` pricing shape) | **Two families.** (A) *Implicit prefix cache*: `cache_create: 0`, `cache_hit > 0` → deepseek-v4-*, glm-5.2/5.3(-flash), kimi-k2.6/k2.7-code/k3, minimax-m3, qwen3.7-*, qwen3.8-*. Free cache writes, discounted hits (~2–20% of input price). No request knob documented → `kind: "implicit"`. (B) *Billed cache writes*: `cache_create > 0` (0.5–1.25× input), `cache_hit: 0` → gemma-4-26b, glm-5, glm-5.1, gpt-oss-120b, kimi-k2.5, llama-3.3-70b, llama-4-maverick, minimax-m2.7, qwen3.6-*, qwen3-coder-480b, qwen3-next-80b. Matches upstream explicit/explicit-write semantics; `cache_control` is a standard Anthropic parameter on `/v1/messages`, and Hyper's Claude Code/Crush integrations exercise that route. |
| Unknowns (live probe) | Exact cached-token usage field(s) on each route (`prompt_tokens_details.cached_tokens` vs `prompt_cache_hit_tokens` on chat; `cache_read_input_tokens`/`cache_creation_input_tokens` on messages); whether `reasoning_effort` is accepted on chat (metadata strongly implies it) and its per-model value set; whether `reasoning_content` deltas stream (DeepSeek-style); TTL support for `cache_control` (no `ttl` documented → emit none until verified). |

### Command Code Provider API — https://commandcode.ai

| Aspect | Finding |
| --- | --- |
| Product | Aggregator: "Every top model, one API" — Claude, GPT, Gemini, Grok, plus open-source models, at underlying API rates with no markup; deals auto-applied. Same API key as the CLI (Studio-issued). Plans: Go $1 (**no API access**), GOAT $10, Pro $20, Max 10× $100, Max 20× $200, Team; **Provider plan $15/mo pay-as-you-go with no usage windows/limits**. Subscription credits metered with rolling 5-hour/weekly windows (PAYG credits exempt). |
| Base URL | `https://api.commandcode.ai/provider/v1` |
| Auth | `Authorization: Bearer <key>` on any route; `x-api-key` on `/messages` (Anthropic SDK compat). Env convention: `COMMAND_CODE_API_KEY` (documented for CLI/CI; same key works for the Provider API). |
| Routes | `POST /provider/v1/chat/completions` (OpenAI Chat Completions — OpenAI + open-source models); `POST /provider/v1/messages` (Anthropic Messages — **Claude models only**); `GET /provider/v1/models` (public). Endpoint/model split is enforced server-side: wrong endpoint or non-catalog model → `400`. |
| Discovery | `GET /provider/v1/models` — public, OpenAI list shape + `context_length` + `name`. No pricing on the endpoint; per-model rates (incl. cache read/write) live on the docs Pricing & Limits page. |
| Streaming | Both routes; usage emitted at end of every stream with no opt-in (OpenAI clients get a final usage chunk; Anthropic clients get `message_delta` usage). |
| ZDR | `x-cmd-zdr: 1` header enforces zero-data-retention routing; fails `422 cmd_zdr_no_providers` when no ZDR-capable upstream exists. Anthropic models are account-level ZDR already. |
| Errors | Route-native envelopes (OpenAI on chat, Anthropic on messages). `400 unsupported_model` / `invalid_request_error` (wrong endpoint/body), `401 authentication_error`, **`403 upgrade_required` (Go plan)**, `422 cmd_zdr_no_providers`, `429 rate_limit_error` (upstream; retry with backoff), `5xx` carries the **upstream provider's** error message. |
| Live catalog (60 models) | `claude-{sonnet-5, sonnet-4-6, fable-5-1, fable-5, opus-5, opus-4-8, opus-4-7, haiku-4-5-20251001}` → messages route. `gpt-{5.6-sol, 5.6-terra, 5.6-luna, 5.5, 5.4, 5.4-mini, 5.3-codex}`, `deepseek/deepseek-v4-{pro,flash,flash-vision-exp,flash-fast}`, `moonshotai/{Kimi-K3, Kimi-K2.7-Code(±HighSpeed), Kimi-K2.6, Kimi-K2.5}`, `zai-org/{GLM-5.3, GLM-5.2(±Fast), GLM-5.1, GLM-5}` + `z-ai/glm-5.3-flash`, `MiniMaxAI/{MiniMax-M3, M2.7, M2.5}`, `xiaomi/{mimo-v2.5-pro, mimo-v2.5}`, `Qwen/{3.8-Max, 3.8-27B, 3.8-Flash, 3.7-Max, 3.7-Plus, 3.7-Flash, 3.6-Max-Preview, 3.6-Plus}`, `stepfun/{Step-3.7-Flash, 3.5-Flash}`, `tencent/{hy3-paid, hy4-preview}`, `google/gemini-{3.7, 3.6, 3.5(±lite), 3.1-lite}-flash*`, `sakana/fugu-ultra`, `nvidia/nemotron-3-ultra…`, `thinkingmachines/{inkling, inkling-small}`, `poolside/laguna-s-2.1-free`, `meta/muse-spark-{1.1, 1.2, 1.2-contributor}`, `xai/{grok-4.5, grok-4.6}`. |
| Caching (from docs pricing table) | Per-model cache read **and** where relevant cache write prices: Claude — read 0.1×/write 1.25× input (Anthropic `cache_control` semantics on `/messages`); GPT-5.6 Sol/Terra/Luna — read **and** write listed (OpenAI GPT-5.6 explicit-caching semantics; passthrough of `prompt_cache_key`/breakpoints unverified); GPT-5.5/5.4/5.3-codex, Grok 4.5/4.6 — read-only → implicit; Gemini 3.7 Flash — read 0.15/write 0.08334; OSS models — cache-read discounts → upstream implicit prefix caching. DeepSeek models have **off-peak/peak pricing windows** (17h/7h UTC). OSS models are "routed across multiple upstreams" — prices are the mean; actual cost varies per upstream (cache affinity may vary with routing). |
| Unknowns (live probe) | Whether chat route passes through `prompt_tokens_details.cached_tokens` (and for GPT-5.6, `prompt_cache_key`/`prompt_cache_options`); messages route `cache_read_input_tokens`/`cache_creation_input_tokens` reporting; reasoning parameter passthrough (`reasoning_effort` for OSS models, `thinking` for Claude); whether `reasoning_content` streams on OSS reasoning models. |

### Cache-hit optimization strategy (first-class)

Cross-cutting, applies to both adapters:

1. **Byte-stable prefix** (already the runtime default): `inputLayout: "cache_aware"` keeps
   system → context → skills → attachments → summaries → history → tool results → current input
   ordered so only the trailing turn changes; first-party tool serializers already run
   `canonicalizeJsonSchema` so tool schema property order cannot break the prefix. The adapters
   must not reorder or rewrite prior messages.
2. **Route-correct cache kind metadata**: implicit models → no cache wire fields at all
   (`assertNoForeignCacheFields` proves it — implicit caching works by prefix reuse, not payloads);
   explicit-write models (Hyper family B on `/v1/messages`, Command Code Claude) →
   `kind: "cache_control"` with `applyCacheControl()` markers only on caller-selected breakpoints
   (≤4), never stamping every block, and no `ttl` unless a live probe documents TTL support.
3. **Reasoning replay**: reasoning models must replay `reasoning_content`/thinking on tool turns
   (DeepSeek/xAI/Z.AI pattern) — dropping it changes the prefix and silently kills multi-turn hits.
4. **Usage + diagnostics**: map cached-token fields to `Usage.cacheReadTokens`/`cacheWriteTokens`
   (never fabricate absent values), so core `cacheHitRate()`/`cacheSavings()`/`cacheUsageReport()`
   work for free.
5. **No invented knobs**: neither provider documents a session/sticky-routing header or chat-route
   `prompt_cache_key`; do not send undocumented cache fields. If the live probe confirms GPT-5.6
   explicit-caching passthrough on Command Code, upgrade that model's metadata to the OpenAI
   package's `explicitBreakpoints` mapping (follow-up).
6. **Cost realism**: Hyper credits and Command Code mean-pricing/off-peak pricing go into
   `ModelConfig.cost` as documented, with `compat.pricing_source` caveats; cache-hit discounts are
   real revenue (DeepSeek V4 Pro on Hyper: $2.40 input vs $0.20 cache hit — a 92% read saving;
   Claude on Command Code: 90% read saving at 1.25× write).

---

## Objectives

- Add `@arnilo/prism-providers/hyper` and `@arnilo/prism-providers/commandcode` as first-party
  provider packages with route-native adapters (OpenAI Chat Completions + Anthropic Messages; Hyper
  additionally exposes the OpenAI Responses pass-through route),
  static docs-verified model catalogs, caller-gated model discovery, cache-kind metadata with
  route-correct wire behavior, reasoning/thinking mapping, quota/telemetry helpers where the
  provider documents them, and full offline conformance + gated live smoke tests.
- Raise the first-party provider adapter count from 17 to 19 across registries, docs matrices,
  README counts, and the package-truth manifest.
- Prove cache-hit behavior offline (no foreign cache fields on implicit routes; selected
  breakpoints only on `cache_control` routes) and verify the remaining wire unknowns with
  operator-gated live probes.

## Expected Outcome

- `import { createHyperProviderPackage } from "@arnilo/prism-providers/hyper"` and
  `import { createCommandCodeProviderPackage } from "@arnilo/prism-providers/commandcode"` work
  side-effect-free; both register providers, featured models, and `api_key` auth methods; setup
  performs no network calls and resolves no credentials.
- `npm test` stays network-free and covers both packages via the provider-conformance harness;
  `PRISM_LIVE_PROVIDER_TESTS=1` plus `HYPER_API_KEY` / `COMMAND_CODE_API_KEY` gates real smoke
  tests that additionally resolve the documented unknowns (cached-token fields, reasoning
  streaming shape, cache_control acceptance).
- `docs/providers/hyper.md`, `docs/providers/commandcode.md`, and the provider
  packages/caching/conformance matrices describe both adapters accurately, including cache
  semantics and billing caveats (Hypercredits, mean/off-peak pricing).

---

## Tasks

- [x] Task 1 — Primitive review: reuse shared serializers, extract one shared Anthropic-Messages helper
  - Acceptance Criteria:
    - Functional: inventory confirms `buildOpenAIChatBody`/`openAIChatEvents` from `@arnilo/prism/providers/openai-compatible` and `applyOpenAIChatStructuredOutput` from `@arnilo/prism/providers/openai` cover both chat routes; a single shared Anthropic Messages body/events module (media, documents, `cache_control`, thinking) is available to both new packages without copying a third/fourth package-local variant.
    - Performance: no new runtime dependency; shared module adds no per-request allocation beyond the current package-local copies.
    - Code Quality: no provider-name branching in shared code; exports stay inert data/functions.
    - Security: shared module keeps secret redaction and bounded-read behavior identical to the opencode-go copy.
  - Approach:
    - Documentation Reviewed:
      - `src/providers/openai-compatible.ts` (core subpath `@arnilo/prism/providers/openai-compatible`), `packages/prism-providers/src/opencode-go/{provider,anthropic-messages,openai-chat,cache}.ts`, `packages/prism-providers/src/kimi/{provider,cache,moonshot}.ts`.
      - `docs/provider-primitives.md`, `docs/provider-packages.md` (provider-owned headers rule), `docs/_evidence/phase21-primitive-review.md` (prior primitive-review precedent).
    - Options Considered:
      - Copy the opencode-go `anthropic-messages.ts` into each new package (zero refactor risk, but the 3rd+4th duplicate of ~an identical serializer).
      - Extract a shared `packages/prism-providers/src/anthropic-messages-shared/`-style internal module used by the new packages only; leave existing packages untouched (no churn).
    - Chosen Approach:
      - Extract once, reuse in both new packages; do not refactor kimi/opencode-go (independent publication ranges — avoid churn). The primitive review writes its conclusion to `docs/_evidence/` following the phase precedent.
    - API Notes and Examples:
      ```ts
      // shared module surface (mirrors opencode-go usage)
      import { anthropicMessagesBody, anthropicMessagesEvents } from "../shared/anthropic-messages.js";
      const body = route === "anthropic" ? await anthropicMessagesBody(request) : openAIChatBody(request);
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/shared/anthropic-messages.ts`: extracted from `opencode-go/anthropic-messages.ts` (package-internal, not a public subpath).
      - `docs/_evidence/phase55-primitive-review.md`: inventory + decision record.
    - References: `plans/037-First-Party-Provider-Parity-And-Caching.md` (prior provider parity work), opencode-go dual-route precedent.
  - Test Cases to Write:
    - Shared module unit fixture reuse: opencode-go's existing anthropic-route tests keep passing unchanged (existing package untouched); new package tests exercise the shared module.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal module; provider subpaths come later in Tasks 2–5).
    - Docs pages to create/edit: `docs/_evidence/phase55-primitive-review.md` only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence pages follow repo precedent).

- [x] Task 2 — `@arnilo/prism-providers/hyper` adapter package (offline, docs-faithful)
  - Acceptance Criteria:
    - Functional: `createHyperProvider()` streams Chat Completions for default-route models and Anthropic Messages for `compat.route: "anthropic"` models (family B); maps `usage.cost`/`usage.remaining` fields; `listHyperModels()` maps the public `/v1/models` (limits, vision, effort levels, pricing incl. `cache_hit`→`cacheRead`/`cache_create`→`cacheWrite`, implicit vs explicit cache kind from pricing shape); `getHyperCredits()` wraps `GET /v1/credits`; reasoning models map effort levels and replay `reasoning_content`.
    - Performance: construction and package `setup()` perform zero network calls (`assertNoFetches`); no provider-local retry loop (runtime `AgentConfig.retry` owns retries).
    - Code Quality: provider id `hyper`; base URL `https://hyper.charm.land/v1` overridable; owned headers (`authorization`, `x-api-key`+`anthropic-version` on messages route) applied after caller headers; `402 billing_error` classified non-retryable; `429` retryable.
    - Security: `sk-hyper-…` keys only via caller-supplied `CredentialValueSource`; secrets redacted from error text/events (`assertNoSecretLeak`); no env scan.
  - Approach:
    - Documentation Reviewed:
      - Hyper API docs: `https://hyper.charm.land/docs/api/{authentication,list-models,openai-chat-completions,openai-responses,anthropic-messages,credits}.html`, `https://hyper.charm.land/docs/models.html`, `https://hyper.charm.land/faq`.
      - Live `GET https://hyper.charm.land/v1/models` response (31 models, 2026-07 snapshot — pricing/limits captured in the static catalog).
      - Prism precedents: `packages/prism-providers/src/opencode-go/provider.ts` (dual route + owned headers), `neuralwatt/{models,quota,telemetry}.ts` (discovery mapping, balance helper, usage-cost telemetry), `kimi` (implicit default + optional `cache_control`), `deepseek`/`zai` (implicit cache + thinking replay).
    - Options Considered:
      - Single chat-completions route only (smallest, but family B models expose explicit-write cache pricing best served by the documented Anthropic route, and Prism already has the dual-route pattern).
      - Three routes incl. `/v1/responses` pass-through (Responses adds a second serializer surface for zero coding-agent benefit today; Codex users point Codex at Hyper directly).
    - Chosen Approach:
      - Dual route mirroring opencode-go: default OpenAI chat route; only `qwen3.6-*` models
        default `compat.route: "anthropic"` — the live `/v1/models` snapshot (2026-07) showed
        Anthropic-shaped explicit-write pricing (cache_create = 1.25× input, cache_hit = 0.1×)
        exclusively on qwen3.6; the rest of what the plan called "family B" (gemma-4, glm-5,
        glm-5.1, gpt-oss-120b, kimi-k2.5, llama-*, minimax-m2.7, qwen3-coder, qwen3-next)
        prices cache writes at 0.5× input with zero read price, so they stay on the chat route
        with `kind: "implicit"` and the write fee recorded in `cost.cacheWrite`. Skip
        `/v1/responses` (Task 8 covers it).
    - API Notes and Examples:
      ```bash
      curl https://hyper.charm.land/v1/chat/completions \
        -H "Authorization: Bearer sk-hyper-…" -H "Content-Type: application/json" \
        -d '{"model":"deepseek-v4-pro","messages":[…],"stream":true,
             "stream_options":{"include_usage":true}}'
      # final chunk usage: {prompt_tokens, completion_tokens, cost:{usd,hypercredits}, remaining:{hypercredits}}
      ```
      ```ts
      // models.ts: cache kind derived from documented pricing shape
      const implicit = { kind: "implicit" } as const;                      // cache_create: 0, cache_hit > 0
      const explicitWrite = { kind: "cache_control", maxBreakpoints: 4 } as const; // cache_create > 0 (messages route)
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/hyper/index.ts`: `createHyperProviderPackage()` — registers provider, featured models, `api_key` auth method; `models:` override; no network.
      - `packages/prism-providers/src/hyper/provider.ts`: dual-route `AIProvider` (chat default; `compat.route === "anthropic"` → `/v1/messages` with `x-api-key` + `anthropic-version`).
      - `packages/prism-providers/src/hyper/models.ts`: static featured catalog (docs-verified limits/cost/cache/compat incl. `route` + `effort_levels`) + `listHyperModels()` public discovery + `mapHyperModel()`.
      - `packages/prism-providers/src/hyper/cache.ts`: no cache payload on implicit route; `applyCacheControl()` selected breakpoints on anthropic route; owned-headers helper; no `ttl` (undocumented).
      - `packages/prism-providers/src/hyper/thinking.ts`: effort-level mapping (clamp `model.parameters` reasoning effort to the model's documented set; `reasoning_content` replay on tool turns).
      - `packages/prism-providers/src/hyper/quota.ts`: `getHyperCredits()` → `{ balance }`.
      - `packages/prism-providers/src/hyper/telemetry.ts`: `mapHyperUsage()` extracting `cost.usd`/`cost.hypercredits`/`remaining.hypercredits` (NeuralWatt-telemetry pattern).
      - `packages/prism-providers/src/hyper/errors.ts` (or fold into provider): `classifyHyperError()` — `402` non-retryable billing, `429` retryable, upstream `5xx` message passthrough.
  - Test Cases to Write (offline, fake transports):
    - Stream ordering + `done`/`error` terminal (`assertProviderStreamConforms`) on both routes.
    - Tool-call delta reconstruction incl. `reasoning_content` deltas on chat route.
    - Usage accounting: `prompt_tokens_details.cached_tokens`-style read mapping on chat; `cache_read_input_tokens`/`cache_creation_input_tokens` on messages; cost/remaining extraction.
    - `assertNoForeignCacheFields` on implicit-route bodies; cache_control only at selected breakpoints (≤4) on anthropic route.
    - `assertSerializedRequestCoversContent` (text/image per model vision capability), `assertProviderOwnedHeadersWin` (caller cannot override `authorization`/`x-api-key`), `assertNoSecretLeak`, `assertAbortIsObserved`, `assertNoFetches` at construction/setup.
    - 402 → non-retryable classification fixture; models-list fixture mapping (public endpoint, no auth header emitted when no key).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public subpath + provider/model registry entries.
    - Docs pages to create/edit: `docs/providers/hyper.md` created here (content), wired into nav in Task 7.
    - `docs/index.md` update: yes (Task 7).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Hyper conformance + operator-gated live probe (resolve documented unknowns)
  - Acceptance Criteria:
    - Functional: offline suite from Task 2 green in default `npm test` (network-free); `live.test.ts` runs text/stream/tool/abort/no-leak smoke plus cache/reasoning probes under `PRISM_LIVE_PROVIDER_TESTS=1` + `HYPER_API_KEY`, skipping by default.
    - Performance: no live test in the release verification path (release-and-install offline budget rule).
    - Code Quality: probe results recorded (actual cached-token field names per route; whether `reasoning_effort` accepted and which values; whether `cache_control` on messages reports `cache_creation_input_tokens`; TTL support); mapping updated to wire truth.
    - Security: live secrets never logged; keys read only from the documented env gate.
  - Approach:
    - Documentation Reviewed: Hyper docs pages above; `docs/provider-conformance.md` (offline mandatory / live restricted split, env gate list); `docs/release-and-install.md` (protected canary matrix).
    - Options Considered: build mapping purely from docs and ship blind (leaves cache accounting unverified on a caching-centric provider); gated probe (chosen).
    - Chosen Approach: offline-first per Task 2; probe adjusts only the mapping details flagged as unknowns.
    - API Notes and Examples:
      ```ts
      // probe sketch (gated): confirm cached-token field, then assert in live test
      expect(usage.cacheReadTokens).toBeGreaterThan(0); // after a warm two-turn prefix replay
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/hyper/__tests__/live.test.ts` (created).
      - `docs/providers/hyper.md` (created here: full page incl. cache notes + live-verified mapping findings ledger).
      - Adjust `models.ts`/`provider.ts`/`cache.ts` mapping per probe findings; record findings in `docs/providers/hyper.md`.
    - Status: code + docs done; the 4 probe findings (cached-token field per route, cache_control
      creation/read reporting, TTL ≥ 1 request, reasoning_effort acceptance) are recorded as a
      pending-operator-run ledger in `docs/providers/hyper.md` (no key in CI); mapping adjustments
      happen only after an operator run reports. Default suite stays network-free: 16 offline pass,
      7 live skipped.
  - Test Cases to Write: warm-prefix two-turn probe (hit rate > 0 on an implicit model, e.g. `deepseek-v4-pro`); messages-route `cache_control` probe on a family B model; reasoning-effort probe on one effort-capable model; abort + error-path smoke (402 with drained key optional/skip).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (tests only; mapping fixes fold into Task 2 files).
    - Docs pages to create/edit: `docs/providers/hyper.md` cache notes updated with verified fields; `docs/provider-packages.md` live-key list adds `HYPER_API_KEY` (Task 7).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — `@arnilo/prism-providers/commandcode` adapter package (offline, docs-faithful)
  - Status: complete. Facts re-fetched from live docs during implementation (provider page,
    pricing-limits incl. deals/off-peak windows, launch blog) + live `GET /provider/v1/models`
    snapshot (67 ids, 2026-09): catalog = curated 38 featured entries (Claude tiers, GPT-5.6
    sol/terra/luna, DeepSeek v4 ×4, Kimi ×5, GLM-5.3(-flash), MiniMax M3 family, Qwen 3.8
    family, MiMo with deal pricing, Gemini flash ×5, Grok ×2) with ids/context windows from
    the live endpoint and USD-per-M pricing from the docs table (`compat.pricing_source`
    records mean-per-provider / off-peak / deal caveats). GPT-5.6 stays `implicit` with docs
    cache-write price recorded in `cost.cacheWrite` (probe-gated upgrade = Task 9). 18 offline
    tests green; full package suite 445 pass.
  - Acceptance Criteria:
    - Functional: `createCommandCodeProvider()` routes `claude-*` models to `/provider/v1/messages` and everything else to `/provider/v1/chat/completions` (server-enforced split); optional `zdr: true` package/provider option adds the provider-owned `x-cmd-zdr: 1` header; `listCommandCodeModels()` maps the public models endpoint (route from id, `context_length`); static catalog carries docs-verified cost (mean/off-peak caveats via `compat.pricing_source`) and cache kinds (Claude → `cache_control`; GPT-5.6/others → implicit until probe); usage always present at stream end on both routes.
    - Performance: zero network at construction/setup (`assertNoFetches`); no provider-local retry loop.
    - Code Quality: provider id `commandcode`; base `https://api.commandcode.ai/provider/v1` overridable; owned headers after caller headers; `403 upgrade_required` and `422 cmd_zdr_no_providers` non-retryable; `429` retryable with backoff.
    - Security: key via caller-supplied `CredentialValueSource` only; upstream error bodies (which carry upstream provider messages) redacted for secrets; no env scan.
  - Approach:
    - Documentation Reviewed:
      - Command Code docs: `https://commandcode.ai/docs/provider` (endpoints, ZDR header, error table), `https://commandcode.ai/docs/resources/pricing-limits` (per-model rates incl. cache read/write, off-peak windows, rolling limits, deals), `https://commandcode.ai/docs/studio` (`COMMAND_CODE_API_KEY`), `https://commandcode.ai/blog/command-code-provider-api`, live `GET https://api.commandcode.ai/provider/v1/models` (60 models, 2026-07 snapshot).
      - Prism precedents: opencode-go (dual route), openrouter (aggregator catalog + reasoning passthrough), anthropic package (cache_control + thinking), clinepass (static catalog, stream-only gateway).
    - Options Considered:
      - Chat-completions-only adapter (server rejects Claude on chat route → impossible).
      - Two separate providers `commandcode-openai`/`commandcode-anthropic` (splits one account/key surface for no user benefit).
      - Single dual-route provider (chosen — matches opencode-go precedent and the server's own model/route split).
    - Chosen Approach: one provider, per-model route from catalog/discovery; cost metadata from the docs pricing table with `compat.pricing_source: "docs:pricing-limits"` caveat (endpoint carries no pricing; OSS mean-pricing and DeepSeek off-peak documented as caveats).
    - API Notes and Examples:
      ```bash
      # Claude models → Anthropic Messages; everything else → Chat Completions
      curl https://api.commandcode.ai/provider/v1/messages -H "x-api-key: $COMMAND_CODE_API_KEY" \
        -H "anthropic-version: 2023-06-01" -d '{"model":"claude-sonnet-5","max_tokens":1024,…}'
      curl https://api.commandcode.ai/provider/v1/chat/completions -H "Authorization: Bearer $COMMAND_CODE_API_KEY" \
        -d '{"model":"deepseek/deepseek-v4-pro",…,"stream":true}'   # final usage chunk, no opt-in
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/commandcode/index.ts`: `createCommandCodeProviderPackage()`.
      - `packages/prism-providers/src/commandcode/provider.ts`: dual route + `zdr` option + error classification.
      - `packages/prism-providers/src/commandcode/models.ts`: static featured catalog (curated from docs: Claude tiers, GPT-5.6, DeepSeek v4, Kimi K3/K2.7-Code, GLM-5.3(-flash), MiniMax M3, Qwen 3.8, MiMo, Gemini flash, Grok) + `listCommandCodeModels()` + route mapper.
      - `packages/prism-providers/src/commandcode/cache.ts`: implicit routes send no cache fields; Claude messages route applies selected `cache_control` breakpoints (no `ttl` — upstream TTL undocumented here).
      - `packages/prism-providers/src/commandcode/thinking.ts`: Claude `thinking` mapping on messages route; OSS reasoning passthrough/replay on chat route.
  - Test Cases to Write (offline, fake transports):
    - Route selection: `claude-*` → messages body; `deepseek/…`/`gpt-…`/`google/…` → chat body; wrong-route fixture (server 400) mapped to typed error.
    - Stream ordering both routes; usage-at-stream-end without opt-in (final chunk / `message_delta`).
    - Tool deltas both routes; Claude thinking blocks on messages route; `reasoning_content` replay on chat route.
    - ZDR header fixture: `x-cmd-zdr: 1` present after caller headers; `422 cmd_zdr_no_providers` classified non-retryable; `403 upgrade_required` non-retryable.
    - `assertNoForeignCacheFields` on chat-route bodies; selected breakpoints on Claude messages route; `assertProviderOwnedHeadersWin`, `assertNoSecretLeak`, `assertAbortIsObserved`, `assertNoFetches`, `assertSerializedRequestCoversContent`, models-list fixture (public endpoint; route derived from id).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public subpath.
    - Docs pages to create/edit: `docs/providers/commandcode.md` created here (content), nav in Task 7.
    - `docs/index.md` update: yes (Task 7).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Command Code conformance + operator-gated live probe
  - Status: complete. `packages/prism-providers/src/commandcode/__tests__/live.test.ts`
    (9 probes, skip-gated on `PRISM_LIVE_PROVIDER_TESTS=1` + `COMMAND_CODE_API_KEY`, zero network
    in default `npm test` — full suite 445 pass / 0 fail, 61 skipped): text smoke on BOTH routes
    (Qwen/Qwen3.8-Flash $0.16/$0.47 chat; claude-haiku-4-5-20251001 $1/$5 messages), tool-call
    loop, abort, error, no-secret-leak; probes: chat-route warm-prefix cached tokens, messages-route
    `cache_control` create/read token fields, GPT-5.6 `prompt_cache_key` injection probe (decides
    Task 9: 400 → keep implicit; accepted+warm hit → explicit upgrade; accepted+miss → recorded
    negative), `reasoning_effort=low` acceptance probe (docs document no reasoning param), and an
    explicitly-labeled opt-in ZDR probe (done or 422 `cmd_zdr_no_providers` both valid findings).
    Cost budget: total burn < $0.01 per run. Findings ledger table (6 rows, all pending) added to
    `docs/providers/commandcode.md` (page created; Task 7 wires it into nav/matrices). Docs
    re-verified during this task: the provider page documents pricing/endpoints/streaming/ZDR/
    errors only — `prompt_cache_key`, cached-token fields, and reasoning params are undocumented,
    hence the probe targets.
  - Acceptance Criteria:
    - Functional: offline suite green network-free; gated live smoke (`PRISM_LIVE_PROVIDER_TESTS=1` + `COMMAND_CODE_API_KEY`) covers text/stream/tools/abort/no-leak on both routes; probes resolve cached-token fields, GPT-5.6 `prompt_cache_key` passthrough, Claude `cache_read_input_tokens` reporting, reasoning param acceptance.
    - Performance/Cost: live probe models chosen to minimize credit burn (e.g. `google/gemini-3.5-flash-lite` or `Qwen/Qwen3.7-Flash` on chat; `claude-haiku-4-5-20251001` on messages); probes bounded to a few requests.
    - Code Quality: probe findings recorded; mapping (esp. GPT-5.6 explicit caching → potential `openai_key`/`explicitBreakpoints` upgrade) updated to wire truth or explicitly left implicit with a recorded reason.
    - Security: no secrets in logs; ZDR probe optional and clearly labeled (may route to costlier upstreams).
  - Approach:
    - Documentation Reviewed: Command Code docs pages above; `docs/provider-conformance.md`, `docs/provider-caching.md` (GPT-5.6 explicitBreakpoints precedent in the OpenAI package).
    - Options Considered: ship doc-faithful implicit mapping blind (aggregator's passthrough behavior is the whole product claim — worth 5 gated requests to verify) — gated probe chosen.
    - Chosen Approach: as Task 3; probe-first on cheap models.
    - API Notes and Examples:
      ```ts
      // probe: GPT-5.6 explicit caching passthrough — if accepted, upgrade model metadata
      body.prompt_cache_key = "prism-probe"; // 400/ignored → keep implicit; accepted+cached_tokens → explicitBreakpoints upgrade (Task 9)
      ```
    - Files to Create/Edit: `packages/prism-providers/src/commandcode/__tests__/live.test.ts`; mapping adjustments in Task 4 files; findings into `docs/providers/commandcode.md`.
  - Test Cases to Write: warm-prefix probe on a chat-route implicit model (cached tokens reported); Claude messages probe with one `cache_control` breakpoint (read/write tokens reported); GPT-5.6 cache-key probe; abort/error smoke.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (tests + mapping fixes only).
    - Docs pages to create/edit: `docs/providers/commandcode.md` cache notes; `docs/provider-packages.md` live-key list adds `COMMAND_CODE_API_KEY` (Task 7).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — Package registration and package-truth
  - Status: complete. `./hyper` + `./commandcode` exports added to
    `packages/prism-providers/package.json` (alphabetical, kebab/lowercase subpaths, no
    root-package exports); family version 0.4.0 → 0.4.1 (Decision B changed-package cut,
    peer `^0.4.0` unchanged); description + family README "all 17" → "all 19" with the two
    new names. `node scripts/package-truth.mjs` regenerated: **19 provider adapters**, 19
    umbrella subpaths, phase24-truth test literals updated (active hasOfficePackage branch
    17→19; umbrella closure 17→19); all 12 truth-gate tests pass against the committed
    artifact. tsconfig.packages.json has no per-dir entries (checked; family builds under its
    own tsconfig) — no change needed. Build 0 TS errors; `npm pack --dry-run` includes both
    subpaths (types + js); subpath imports resolve from `@arnilo/prism-providers/{hyper,
    commandcode}`; full family suite 445 pass / 0 fail / 61 skipped. Root `README.md`
    (seventeen→nineteen, install comment, adapters table row), root + family `CHANGELOG.md`
    entries added ([0.4.1] plan 055; historical 0.4.0 entries left untouched).
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-providers/hyper` and `@arnilo/prism-providers/commandcode` subpaths exported from `packages/prism-providers/package.json`; both build under `tsconfig.packages.json`; `node scripts/package-truth.mjs` regenerates counts as **19 provider adapters** and the umbrella/profile closures include both.
    - Performance: build times within existing package family norms; no new dependencies.
    - Code Quality: subpath naming consistent with existing kebab/lowercase conventions; no root-package exports added (providers live in the family package).
    - Security: `package-truth.json` membership reflects only real manifests; no publish in CI.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` (package-truth as single source; changed-package cut rules), `packages/prism-providers/package.json`, `scripts/package-truth.mjs`.
    - Options Considered: separate `@arnilo/prism-provider-hyper` packages (plan 054 consolidation explicitly folded all provider packages into the family as subpaths — rejected).
    - Chosen Approach: family subpaths; bump changed-package versions per the Decision B changed-package cut convention.
    - API Notes and Examples:
      ```jsonc
      // packages/prism-providers/package.json exports additions
      "./hyper": { "types": "./dist/hyper/index.d.ts", "default": "./dist/hyper/index.js" },
      "./commandcode": { "types": "./dist/commandcode/index.d.ts", "default": "./dist/commandcode/index.js" }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/package.json` (exports), `scripts/package-truth.json` (regenerated), `tsconfig.packages.json` if per-dir entries exist, root `CHANGELOG.md`, root `README.md` ("seventeen" → "nineteen"; install comment 17 → 19).
  - Test Cases to Write: package-truth regeneration assertion (offline script run + spot-check counts); `npm pack` dry-run for the family package includes both subpaths.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new subpaths, counts).
    - Docs pages to create/edit: `docs/release-and-install.md` counts/canary rows (Task 7 completes wording), `README.md`, `CHANGELOG.md`.
    - `docs/index.md` update: yes (Task 7).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Documentation: provider pages, matrices, navigation
  - Status: complete. Both provider pages already written in Tasks 3/5 in the required
    structure (What it does / When to use it / Inputs / Outputs / example / Implementation
    example / Featured models / Extension notes incl. cache & session / Security & performance /
    Official evidence / Related APIs). This task wired them everywhere:
    - `docs/provider-packages.md`: subscription-OAuth matrix +2 rows (`api_key` only, no
      subscription OAuth for either); Phase 10 compatibility matrix +2 rows (dual-route,
      route-specific implicit/`cache_control`, protected API-key smokes); live-test env-key
      list + `HYPER_API_KEY`/`COMMAND_CODE_API_KEY`; first-party cache-behavior notes +2
      (Hypercredits billing, qwen3.6-* route rule, no-ttl, 402; Command Code claude-* route
      rule, mean/off-peak/deal pricing caveats, GPT-5.6 implicit-until-probe, ZDR).
    - `docs/provider-caching.md`: per-provider table +2 rows and detailed notes +2, stating
      implicit/explicit per route, cached-token field mappings per route, and the
      no-guarantee/best-effort caveat + billing caveats.
    - `docs/provider-conformance.md`: conformance matrix +2 rows (offline evidence lists,
      protected live keys).
    - `docs/index.md`: "all 17" → "all 19" in the provider-packages bullet; both pages linked
      under Provider and model connection (Phase 12 workspaces bullet, adjacent to the other
      adapter pages).
    - `docs/release-and-install.md`: current-line counts 0.4.0→0.4.x + 17→19 (line 5), install
      row + tarball row (all 19 adapters, `arnilo-prism-providers-0.4.1.tgz`), protected
      live-canary matrix +2 rows (Hyper probes, Command Code probes; family `npm test` gate),
      supported-and-measured Providers row 17→19.
    - `README.md` current-state: no remaining "17 provider" (Task 6 covered; verified).
    - Historical records (plan 054 "folded all 17 manifests", 0.1.0-readiness, _evidence)
      untouched — accurate for their snapshots.
    - Link-integrity gate `scripts/phase15-freeze.test.mjs` (every relative markdown link in
      docs/ resolves) passes 21/21; `phase24-truth` 12/12; matrix-consistency sweep clean.
  - Acceptance Criteria:
    - Functional: `docs/providers/hyper.md` and `docs/providers/commandcode.md` follow the required API page structure (What it does / When to use it / Inputs / Outputs / example / Implementation example / Extension notes / Security & performance notes / Related APIs); `docs/provider-packages.md` gains both rows in the subscription-OAuth matrix (both "API key only; no subscription OAuth"), Phase 10 compatibility matrix, conformance matrix, and the live-test env-key list; `docs/provider-caching.md` gains per-provider cache-behavior table rows + detailed notes; `docs/provider-conformance.md` gains conformance-matrix rows; `docs/index.md` links both pages under Provider and model connection.
    - Performance: n/a.
    - Code Quality: cache table rows state implicit/explicit per route, cached-token field mappings, and the no-guarantee caveat; billing caveats (Hypercredits, mean pricing, off-peak) documented; no invented features.
    - Security: docs state keys are caller-supplied, env vars are host-owned, and neither provider package scans env or files.
  - Approach:
    - Documentation Reviewed: `docs/providers/{neuralwatt,opencode-go,kimi,openrouter}.md` (page precedents), `docs/provider-caching.md` per-provider table, `docs/provider-packages.md` matrices, `docs/index.md`.
    - Options Considered: minimal stub pages (first-class means full pages — rejected).
    - Chosen Approach: full pages + matrix rows, written from Tasks 2–5 verified facts.
    - API Notes and Examples:
      ```md
      | `@arnilo/prism-providers/hyper` | `implicit` (chat route) / `cache_control` (messages route) | … | … | Best-effort only; `402 billing_error` when Hypercredits run out. |
      ```
    - Files to Create/Edit: `docs/providers/hyper.md`, `docs/providers/commandcode.md`, `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/provider-conformance.md`, `docs/index.md`, `docs/release-and-install.md` (protected canary rows), `README.md`.
  - Test Cases to Write: docs link check (if repo has one — verify via existing scripts); manual matrix-consistency pass (counts 17→19 everywhere "17 provider" appears).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — two new entries under Provider and model connection.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — Hyper `/v1/responses` pass-through route (third route, Codex-style Responses clients)
  - Status: complete.
    - `packages/prism-providers/src/openai/responses.ts`: added optional `label` option
      (default `"OpenAI"`) used in the five generate-loop error messages — the shared
      machinery now reports `Hyper request failed: …` when driven by the hyper adapter;
      zero behavior change for existing OpenAI/Codex callers (backwards-compatible option).
    - `packages/prism-providers/src/hyper/provider.ts`: third route. `createHyperProvider`
      now creates an inner `createOpenAIResponsesProvider` (same `id`, Hyper base URL,
      `label: "Hyper"`) at factory time — construction stays network-free (upload manager
      is lazy per-generate). `routeFor()` gained `"responses"`; `compat.route === "responses"`
      delegates the whole generate via `yield*` before the dual-route code. Bearer auth,
      owned-header precedence, secret redaction, continuation cursors, media, and
      `resolveOpenAIReasoning` all come from the shared machinery — zero copies.
    - `packages/prism-providers/src/hyper/models.ts`: `HyperRoute` += `"responses"`; docs
      updated; `routeForHyperModel` never auto-derives responses (explicit opt-in only),
      `defineHyperModel` keeps it with `kind: "implicit"` cache.
    - Offline tests (6 new, all green): stream ordering + text/thinking/tool/usage
      mapping on `/v1/responses` (shared machinery fixture); OpenAI-standard
      `reasoning` summary + sanitized `prompt_cache_key` from session hints; zero foreign
      cache fields with no hints; owned-header win + `Hyper request failed` label + secret
      redaction on 401; abort observed pre-fetch; `defineHyperModel` route preservation.
    - Gated live tests (+1, skipped without `PRISM_LIVE_PROVIDER_TESTS=1`+`HYPER_API_KEY`):
      text+tool smoke on `/v1/responses` and warm-prefix cached-token probe with the
      finding recorded in `docs/providers/hyper.md` on failure.
    - Docs: `docs/providers/hyper.md` (route table + responses body example + cache/session
      and completion/usage notes; cost/remaining fields documented as chat-route only —
      responses usage is standard pass-through fields); `docs/provider-packages.md` Phase 10
      row + cache-summary bullet; `docs/provider-caching.md` table row; `docs/index.md`
      hyper bullet now mentions the pass-through.
    - Verified: `tsc` clean; prism-providers suite 445 pass / 0 fail / 61 skipped (7 live);
      doc link gate `scripts/phase15-freeze.test.mjs` 21/21.
  - Acceptance Criteria:
    - Functional: `compat.route: "responses"` selects `POST /v1/responses`; the route reuses the OpenAI package's Responses machinery (`packages/prism-providers/src/openai/responses.ts`, incl. `resolveOpenAIReasoning`) with Hyper's base URL and provider-owned auth header; streaming plus final usage (cost/remaining fields) mapped; featured models may register the route.
    - Performance: no new dependency; construction/setup still perform zero network calls.
    - Code Quality: no copied Responses serializer when an import path exists (thin options-based reuse of `responses.ts` machinery); chat-route models keep their existing body untouched; owned headers still win.
    - Security: same `assertNoSecretLeak`/redaction coverage on the new route.
  - Approach:
    - Documentation Reviewed:
      - `https://hyper.charm.land/docs/api/openai-responses.html` — "OpenAI Responses standard pass-through" (all standard Responses params + streaming + usage).
      - `packages/prism-providers/src/openai/{responses,codex}.ts` (Responses provider factory, reasoning resolution, Codex-style usage precedent).
    - Options Considered:
      - Copy a Responses serializer into the hyper package (duplicates existing machinery).
      - Leave Responses unsupported (blocks Prism usage from Codex-style Responses clients against Hyper).
    - Chosen Approach: third route via reuse of the openai package's Responses machinery — a thin wrapper passing Hyper base URL, owned headers, and usage mapping; default routes unchanged.
    - API Notes and Examples:
      ```bash
      curl https://hyper.charm.land/v1/responses \
        -H "Authorization: Bearer sk-hyper-…" -H "Content-Type: application/json" \
        -d '{"model":"glm-5.3","input":…,"stream":true}'
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/hyper/provider.ts` (third route), `packages/prism-providers/src/hyper/models.ts` (route compat metadata), `packages/prism-providers/src/hyper/__tests__/` (offline + gated live), `docs/providers/hyper.md`, `docs/provider-packages.md` compat matrix.
  - Test Cases to Write:
    - Offline: responses-route stream ordering + terminal `done`/`error`; usage-at-end incl. cost/remaining mapping; reasoning-summary mapping via `resolveOpenAIReasoning`; `assertNoForeignCacheFields` on implicit models; `assertProviderOwnedHeadersWin`; `assertAbortIsObserved`; `assertNoSecretLeak`.
    - Gated live (`PRISM_LIVE_PROVIDER_TESTS=1` + `HYPER_API_KEY`): text + tool-call smoke on `/v1/responses`; cached-token field check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new route on the hyper adapter.
    - Docs pages to create/edit: `docs/providers/hyper.md` (route section), `docs/provider-packages.md` matrix.
    - `docs/index.md` update: no (page already linked via Task 7).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — Command Code GPT-5.6 explicit-caching upgrade (gated on Task 5 probe)
  - Status: complete — **closed gated, no code change** (gate = Task 5 probe row 4: no
    operator live run has reported yet; `getUserConfirmation` not available, key never
    present in this repo, ledger in `docs/providers/commandcode.md` still `pending`).
    - Plan rule honored: code only after the probe confirms `prompt_cache_key`/cached-token
      passthrough; verified-negative (400/ignored/no cached tokens) closes with the finding
      recorded. Neither outcome is available, so the task closes with the decision rule
      recorded and zero speculative wire fields.
    - Verified readiness (offline): the OpenAI explicit-caching helpers are exported from
      the family subpath `@arnilo/prism-providers/openai` (`promptCacheKey`,
      `promptCacheOptions`, `applyPromptCacheBreakpoints`, incl. `OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH`
      64-char clamp) — checked `packages/prism-providers/src/openai/index.ts` — so the
      upgrade diff is a small conditional in `commandcode/{cache.ts,openai-chat.ts}`:
      emit `prompt_cache_key` (from `PromptCacheHints` `cache.key`)
      + `prompt_cache_options: { mode: "explicit" }` (model `cache.explicitBreakpoints = true`)
      only on `gpt-5.6-*` bodies; zero fields on other models.
    - Forward action (operator): run
      `PRISM_LIVE_PROVIDER_TESTS=1 COMMAND_CODE_API_KEY=… npm test -w @arnilo/prism-providers`,
      inspect `live_gpt56_prompt_cache_key_passthrough_probe` (warm-prefix replay must report
      cached tokens), then either apply the conditional upgrade above or record the
      verified-negative in `docs/providers/commandcode.md` ledger row 4 and close. Trace: see
      `docs/providers/commandcode.md` "Live-verified mapping (findings ledger)" row 4 (now
      carries the decision rule) and Task 9 note in "Official evidence".
    - No code, docs, or test changes beyond the ledger decision-rule note; suite and doc
      gates unaffected.
  - Acceptance Criteria:
    - Functional: **only if the Task 5 probe confirms `prompt_cache_key`/cached-token passthrough** — `gpt-5.6-sol/terra/luna` cache metadata upgrades from implicit to the OpenAI explicit-caching mapping: `promptCacheKey()` (≤64 chars, from `PromptCacheHints` `cache.key`), `promptCacheOptions()` (`{ mode: "explicit" }`) when supported, and `applyPromptCacheBreakpoints()` markers mirroring the OpenAI package's GPT-5.6 support. If the probe rejects (400/ignored/no cached tokens), record the verified-negative finding in `docs/providers/commandcode.md` + the evidence page and close with no code change.
    - Performance: zero extra request fields on non-GPT-5.6 models (asserted offline).
    - Code Quality: reuse `packages/prism-providers/src/openai/cache.ts` helpers — no duplicated key-length/retention/breakpoint logic; imports stay inside the `@arnilo/prism-providers` family package.
    - Security: cache key derives only from the caller-provided `cache.key` hint — never the API key or credential source (asserted).
  - Approach:
    - Documentation Reviewed:
      - Command Code pricing page — GPT-5.6 Sol/Terra/Luna cache read **and** write rates (0.1×/1.25× input semantics).
      - `packages/prism-providers/src/openai/cache.ts` — `promptCacheKey`, `promptCacheRetention`, `promptCacheOptions`, `applyPromptCacheBreakpoints`, `OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH`.
      - `docs/provider-caching.md` — GPT-5.6 explicitBreakpoints notes (prior OpenAI-package work).
    - Options Considered: keep implicit-only (leaves the documented 1.25× write / 0.1× read economics unusable through Prism if passthrough works); custom key mapping (duplicates existing helpers).
    - Chosen Approach: conditional upgrade reusing the openai cache helpers; closes as verified-negative if the probe rejects.
    - API Notes and Examples:
      ```ts
      // commandcode chat body for gpt-5.6-* after upgrade
      body.prompt_cache_key = promptCacheKey(options);                          // from PromptCacheHints cache.key
      if (explicitSupported) body.prompt_cache_options = promptCacheOptions(options, model); // { mode: "explicit" }
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/commandcode/{cache.ts,models.ts}`, `packages/prism-providers/src/commandcode/__tests__/`.
      - `docs/providers/commandcode.md`, `docs/provider-caching.md` (table row + notes), evidence page (either outcome).
  - Test Cases to Write:
    - Offline: key/options/breakpoints emitted only for `gpt-5.6-*` bodies; >64-char key truncated; zero foreign cache fields on other models; key never contains the credential; wire bodies stay stable across turns (prefix safety).
    - Gated live: warm-prefix probe with an explicit key reports cached tokens (or the recorded negative).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (conditional).
    - Docs pages to create/edit: `docs/providers/commandcode.md`, `docs/provider-caching.md` — either outcome documented.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 10 — Hyper intelligent-routing metadata (external gate: Charm shipping documented routing controls)
  - Status: complete — **closed gated, zero code** (external gate not cleared).
    - Precondition re-checked against live docs (2026-09): FAQ and landing page still describe
      Intelligent Routing as roadmap only ("the Hyper roadmap includes intelligent model
      selection…"); the docs API index lists the same standard endpoints
      (authentication, list-models, openai-chat-completions, openai-responses,
      anthropic-messages, credits) with **no routing parameter, per-step model selection,
      or delegation knob** anywhere.
    - Recorded "not actionable — feature not shipped" in
      `docs/_evidence/phase55-hyper-intelligent-routing.md` (re-check date, exact quote,
      endpoint inventory table, decision + re-open condition) and linked it from the
      hyper provider page's Official evidence section.
    - No speculative wire parameters invented (same no-invented-fields rule as cache);
      no code, no tests, no wire-surface change. Re-open when Charm documents routing
      controls, then map passthrough + featured-model metadata + offline conformance per
      the plan's conditional scope.
    - Verified: doc link gate `scripts/phase15-freeze.test.mjs` 21/21 (new evidence page
      resolves from `docs/providers/hyper.md`).
  - Acceptance Criteria:
    - Functional: precondition — Charm publicly documents routing controls (per-step model selection / routing parameters; roadmap mention on the Hyper landing/FAQ). At execution, re-check `https://hyper.charm.land/docs` + FAQ: if documented, map the routing parameters into the hyper adapter (request passthrough + featured-model metadata + compat notes) with offline conformance coverage; if still undocumented, record "not actionable — feature not shipped" in the evidence page and close with zero code.
    - Performance: no speculative code before the gate clears.
    - Code Quality: mapping follows documented wire parameters only — no invented knobs (same rule as cache fields).
    - Security: no new credential surfaces.
  - Approach:
    - Documentation Reviewed: Hyper landing page + FAQ (intelligent-routing roadmap mention), Hyper API docs index (`https://hyper.charm.land/docs/api/`).
    - Options Considered: speculative routing params now (undocumented → violates the no-invented-fields rule); gated docs re-check + conditional implementation (chosen).
    - Chosen Approach: gate on public documentation; the task is a docs re-check plus conditional implementation, so the plan carries it as tracked work rather than an unactionable wish.
    - API Notes and Examples: none yet — actual parameter names come from Charm's documentation when shipped.
    - Files to Create/Edit (conditional): `packages/prism-providers/src/hyper/{provider.ts,models.ts}`, `packages/prism-providers/src/hyper/__tests__/`, `docs/providers/hyper.md`, evidence page (re-check outcome either way).
  - Test Cases to Write: only if implemented — passthrough conformance, no foreign fields, docs-verified values; otherwise an evidence record of the re-check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: conditional.
    - Docs pages to create/edit: `docs/providers/hyper.md` + evidence page (either outcome).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 11 — Release verification and evidence
  - Status: complete.
    - Full offline `npm test` green: **exit 0 across every suite** (core 1579/1579;
      scripts batch 390; all workspaces; provider family 451 pass / 62 skipped live probes);
      `tsc --noEmit` clean; biome clean (this task fixed 11 lint findings stranded in the
      055 code: 1 unsafe-optional-chaining error + unused imports/params/const in
      hyper/commandcode sources and tests).
    - Gate fixes required by the 055 addition (all landed): package-lock sync to the
      0.4.1 family manifest; `packaging.test.ts` adapter list 17→19 + lockstep gate records
      the plan-055 changed-package cut (providers 0.4.1, other 10 manifests 0.4.0) +
      adapter-isolation gate now records the two deliberate family-internal imports
      (`shared/` for all adapters; `openai/` for hyper only — plan-approved reuse over
      copying); `install-smoke.test.ts` family tarball version read from its manifest
      (`arnilo-prism-providers-0.4.1.tgz`); `docs.test.ts` "all 17" literals → 19 and the
      generated-provider release-page check satisfied (`release-and-install.md` now lists
      the full `@arnilo/prism-providers/{hyper,commandcode}` specifiers); plans index links
      plan 055; release page carries both "19 provider adapters" and "19 provider adapter
      subpaths" canonical phrases (plan-024 count gate).
    - Scripts-batch gates: `phase29-freeze` + `phase30-freeze` provider counts 17→19;
      `phase34-freeze` 0.4.0-lockstep now records the 055 cut (providers 0.4.1);
      `phase37-provider-matrix` 17→19 with `docs/_evidence/phase37-provider-matrix.md`
      extended (frozen-packages rows for hyper/commandcode + 4 cache-claim rows,
      header 17→19, 055 note); `package-truth.mjs` regenerated + `phase54-package-map.mjs`
      regenerated (stale evidence caught by the gate); `budgets.json` root diet
      rebaselined with recorded reason (plan-055 addition: 970580→1027233 packed,
      3290347→3464723 unpacked, 386→409 files).
    - Evidence page created: `docs/_evidence/phase55-provider-addition-evidence.md`
      (addition summary, verification matrix, both security spot-check tests,
      live-probe ledger with operator command + all 10 enumerated unknowns, and
      explicit "probe pending — no operator key at execution time" status).
    - Security: redaction spot-checked offline on both packages' error paths
      (`hyper_402_..._redacted`, responses-route 401 redaction,
      `commandcode_403_and_422_are_non_retryable_and_redacted`) and confirmed in evidence.
    - Performance: offline budget within release norms (suite ~10 s; no live test in the
      release path — default gate stays network-free).
  - Acceptance Criteria:
    - Functional: full offline `npm test` green (network-free, no gates set); `tsc`/biome clean; `node scripts/package-truth.mjs` counts consistent with docs; both packages' offline conformance suites included in the release verification path, live tests excluded.
    - Performance: offline test budget within release-and-install limits.
    - Code Quality: `docs/_evidence/phase55-*` records the primitive review, live-probe findings (or explicit "probe pending — no operator key at execution time" with the unknowns enumerated), and the provider addition evidence.
    - Security: secret-redaction spot check on both packages' error paths; no-secret-leak assertions confirmed in evidence.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` (offline test budget, protected canary matrix), `docs/0.1.0-readiness.md` gate format.
    - Options Considered: run gated live probes inside release verification (forbidden by the release doc — rejected).
    - Chosen Approach: offline verification + evidence page; live probes remain operator-gated outside release.
    - Files to Create/Edit: `docs/_evidence/phase55-provider-addition-evidence.md`; checkboxes/updates in this plan.
  - Test Cases to Write: n/a (this task runs the suites written in Tasks 2–5 and 8–10 (as applicable) and records results).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification + evidence only).
    - Docs pages to create/edit: `docs/_evidence/phase55-provider-addition-evidence.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Live probes (Tasks 3, 5) were not executed: no operator `HYPER_API_KEY` /
  `COMMAND_CODE_API_KEY` at execution time. Default suite stays network-free (mandatory
  release gate); the prod-faithful mapping ships with all enumerated unknowns recorded as
  an operator-run ledger in both provider docs pages + `docs/_evidence/phase55-provider-addition-evidence.md`;
  probe tests stay in place and only adjust mapping after an operator run reports.
- Task 9 (Command Code GPT-5.6 explicit caching) closed gated, no code change: its probe
  is part of the same operator run; the decision rule (upgrade vs verified-negative) is
  recorded in the commandcode ledger row 4.
- Task 10 (Hyper intelligent-routing) closed gated, zero code: Charm still documents
  routing as roadmap-only; re-check evidence in
  `docs/_evidence/phase55-hyper-intelligent-routing.md`.
- Family version 0.4.0 → 0.4.1 (Decision B changed-package cut) is the one deviation
  from the 0.4 lockstep; recorded in the release gates (phase34/plan-054 lockstep tests)
  and `docs/release-and-install.md`.
- `docs/providers/hyper.md` + `docs/providers/commandcode.md` ship the docs-faithful
  mapping; official evidence sections pin each live-verified claim as pending-probe.

## Further Actions

- All candidates identified at planning time were promoted into the task list: Hyper
  `/v1/responses` pass-through route → Task 8; Command Code GPT-5.6 explicit-caching
  upgrade → Task 9 (probe-gated); Hyper intelligent-routing metadata → Task 10 (gated on
  Charm shipping documented routing controls).
- Operator action (one command):
  `PRISM_LIVE_PROVIDER_TESTS=1 HYPER_API_KEY=… COMMAND_CODE_API_KEY=… npm test -w @arnilo/prism-providers`,
  then record each ledger row in `docs/providers/{hyper,commandcode}.md` and adjust
  mapping to wire truth; Task 9 decision rule is in commandcode ledger row 4.
