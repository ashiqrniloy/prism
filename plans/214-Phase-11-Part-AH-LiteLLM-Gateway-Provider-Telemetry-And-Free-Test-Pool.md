# Phase 11 Part AH — LiteLLM gateway provider, telemetry, spend logs, and the free test pool

## Objectives

- Ship `@arnilo/prism-provider-litellm` **in 0.13.0**. It is a provider for a LiteLLM Proxy (the "LLM Gateway") that the host or the owner runs. One integration reaches every provider the proxy is configured for.
  - It speaks the proxy's OpenAI Chat Completions wire (`/chat/completions`).
  - It discovers models from the proxy (`/model/info`, falling back to `/v1/models`).
  - It uses one **provider-agnostic** prompt-cache policy that cannot break caching on any backend the proxy fronts.
- **Read LiteLLM's telemetry on every call:**
  - stamp a Prism-minted `x-litellm-call-id` on each request;
  - read LiteLLM's response headers (`x-litellm-call-id`, `x-litellm-model-id`, `x-litellm-model-api-base`, `x-litellm-response-cost`, `x-litellm-version`) into `Usage.metadata.litellm`;
  - map cost into `Usage.cost`.

  As a result, every Prism event that carries usage also identifies the LiteLLM call, the deployment that served it, and its cost.
- **Read LiteLLM's logs.** A bounded `/spend/logs` reconciliation helper fetches the proxy's own spend records for a set of call ids and compares them with what Prism recorded.
- **Join the two traces.** `@arnilo/prism-observability` can optionally send W3C trace context (`traceparent`) on provider requests. LiteLLM's own `otel` callback then exports spans that nest under Prism's spans in the host's collector. The package can also put allow-listed `Usage.metadata` fields, such as the LiteLLM call id, on chat spans.
- **Keep a permanent set of free models for testing.** This is a repo-owned LiteLLM configuration plus a launch script. It serves stable model-group names (`prism-free/*`) backed by free-tier deployments, with per-deployment rate limits, cooldowns, health checks, zero-cost model info, and a near-zero-budget virtual key.
- **Make the memory bench safe on that pool.** It records the deployment that served every call. It refuses to score or pair arms whose served deployments differ. It refuses paid traffic under `--free-only` and multi-deployment pools on held-out and acceptance subsets.

## Expected Outcome

- `createAgent({ model: "litellm/prism-free/smoke", packages: [litellm({ baseUrl: "http://127.0.0.1:4000" })] })` streams text, tool calls, reasoning where the backend reports it, structured output, and images, through a LiteLLM Proxy.
  - Model windows, modalities, tool and reasoning support, and per-token cost come from the proxy's `/model/info`.
  - Each `usage` and `done` event carries `usage.metadata.litellm = { callId, modelId, modelGroup, apiBase?, version?, responseCost? }`.
- `litellmSpendLogs({ baseUrl, apiKey, callIds })` returns the proxy's spend rows for those calls. The function is bounded in pages, rows, bytes, and wait time, and its "eventually consistent" wait is documented. `scripts/litellm/reconcile.mjs` turns a bench run's call ids into a reconciliation table (Prism cost vs LiteLLM spend per call and in total).
- `observability({ propagateTraceContext: true, usageMetadata: ["litellm.callId", "litellm.modelId"] })` makes LiteLLM's OTel spans children of Prism's spans and adds the allow-listed fields to chat spans. Both options default off.
- `bun scripts/litellm/up.mjs` starts a pinned LiteLLM Proxy and Postgres on loopback. It loads `scripts/litellm/free-pool.yaml` with only the deployments whose keys exist in `live.env`, mints a budget-capped virtual key, and prints the groups it serves. `bun scripts/litellm/down.mjs` stops them.
- `scripts/memory-bench/run.mjs --provider litellm --model prism-free/<group> --free-only …` runs. The report lists the served deployment ids per arm. A paired comparison whose arms were served by different deployments is refused with `MemoryBenchServedModel`.
- `providers/litellm` is an active live row that passes strict against the local free pool. `docs/_evidence/litellm-live-<date>.md` records:
  - the run and its spend ($0, enforced by the budget);
  - one reconciliation round trip;
  - one trace-nesting check;
  - one bounded bench smoke on the pool.
- 0.13.0 publishes **nine** providers (eight after plan 213, plus `litellm`). Plans 184–187 and the roadmap say so. The roadmap records that `litellm` ships **without** a plan 184 cache-parity cell, by owner decision.

This plan implements the **owner decision of 2026-10-31: LiteLLM support ships in 0.13.0** as a gateway provider, together with LiteLLM telemetry and log consumption (`/spend/logs`) and a free test pool. It changes roadmap **Phase 5** (the shipped provider set) and the §2.9 provider row.

- **Release path:** step **17j**, after plan 213 and before plan 184.
  - Before 184: 184 must know that `litellm` is exempt from its parity suite.
  - Before 185, so the package's surface, the observability config additions, and the baseline are frozen with the rest.
  - Before 186–187, so its live row is in release acceptance and its name is on the publish list.
  - After 213, because 213 moves the provider count from seven to eight, and this plan moves it to nine.
- **Cache-parity exception (owner decision, 2026-10-31).** The 2026-10-25 roadmap rule says every provider shipped from then on carries a plan 184 cache-parity cell. `litellm` is exempt for 0.13.0. LiteLLM fronts more than a hundred backends, each with its own caching rules. Per-backend parity is a larger piece of work that must prove nothing breaks caching on any backend, and the owner moved it to after 0.13.0.
  - This plan ships a **general policy**:
    - a byte-stable prefix;
    - no cache markers by default;
    - per-model opt-in markers;
    - proxy-side breakpoint injection documented for operators;
    - faithful mapping of whatever cache usage the proxy reports.
  - Task 7 records cache figures from `provider-probe.mjs` for information only, with no threshold.
- **Review:** the plan creates a package and changes an existing one (`@arnilo/prism-observability` config), so **Task 1 is the phase review**. No kernel contract change is expected. The response-header seam is package-local unless Task 1 finds a second user (see Task 2's options).
- **Owner constraint carried forward (2026-10-24).** Live benchmarks, eval gates, cache parity, and release acceptance stay on their current providers (Hyper, OpenCode Go). The free pool serves:
  - wire, smoke, and integration tests;
  - dev-loop memory-fabric iteration, comparing candidate and control on the same pool;
  - single-deployment pinned groups, under the same rules as today's pinned `:free` ids (`isFreeBenchmarkModel`, `scripts/memory-bench/run.mjs:227-231`).

  It never replaces the release evidence providers, and a multi-model group is never scored.
- **Keys and spend:**
  - `~/.config/prism/live.env` gains:
    - `LITELLM_API_KEY`, the virtual key Prism uses. `provider-probe.mjs` derives this name from the id `litellm` (`scripts/cache-parity/provider-probe.mjs:248`).
    - `LITELLM_MASTER_KEY`, the proxy admin key. Only `scripts/litellm/up.mjs` uses it, and the reconciliation helper only if Task 1 shows a non-admin key cannot read its own spend.
    - The free-tier backend keys Task 1 selects. Candidates: `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_NIM_API_KEY`, and the existing `OPENROUTER_API_KEY` for pinned `:free` ids.
  - The owner adds the keys. The expected spend is **$0**: every pool deployment is a free tier or local, and the virtual key's budget makes an accidental paid call fail.
  - One optional paid leg (for example OpenCode Go behind the proxy as an `openai/` deployment with `api_base`) runs only with the owner's approval, under $0.05.
  - The executor never pastes or prints a key.
- **Runtime dependencies (owner machine only):**
  - Docker (or Podman) for the pinned LiteLLM image and Postgres.
  - For Task 1b's and Task 6's trace check, a local OTel collector (Jaeger all-in-one, pinned). Nothing here enters CI. CI tests use recorded fixtures.
- **Supply chain:** LiteLLM's PyPI release line had a reported compromise in March 2026 (versions 1.82.7 and 1.82.8). Task 1 confirms the advisory, then pins one release by **image digest** (never a floating tag), and records the digest and its source.
- **Not shipped here:**
  - version bump and publish (plan 187);
  - `/docs` pages beyond the package README, the observability README, and the index and table rows;
  - per-backend cache parity (post-0.13.0);
  - the `/v1/messages` and `/v1/responses` routes (post-0.13.0, with cache parity, because LiteLLM translates them for non-native backends and drops `cache_control` there);
  - LiteLLM's response cache;
  - LiteLLM's admin, key, team, or budget APIs beyond the one virtual key `up.mjs` mints.
- **Reference host impact:** none. `apps/prism-agent` runs on the mock provider.
- **Prior art:** none in Prism. `litellm` appears only in plan 069 as a Graft deep-build provider name (`plans/069-Trusted-Extension-Activation-And-Wiki-Ingest.md:484`). It is not a retired name (`scripts/retired-providers.test.mjs`).

## Research summary (2026-10-31)

Sources:
- LiteLLM docs through Context7 (`/websites/litellm_ai`, docs.litellm.ai; the versioned source index `/berriai/litellm` lists v1.106.3 as the newest tag): `proxy/logging`, `proxy/logging_spec` (`StandardLoggingPayload`), `proxy/cost_tracking`, `proxy/pass_through_cost_tracking`, `observability/opentelemetry_integration`, `observability/generic_api`, `proxy/reliability`, `proxy/load_balancing`, `routing`, `proxy/configs`, `proxy/health_check_routing`, `completion/prompt_caching`, `tutorials/prompt_caching`, `anthropic_unified/native_passthrough`;
- Prism code at the `file:line` references below.

Each "Verify" entry is an assumption that Task 1 or 1b must confirm before Task 2 relies on it.

| Topic | Finding | Consequence |
| --- | --- | --- |
| Shape | LiteLLM is a Python SDK and a Proxy Server. Prism is TypeScript, so only the Proxy is reachable, over HTTP. Default port 4000. A config file (`model_list`, `litellm_settings`, `router_settings`, `general_settings`); Postgres is needed for virtual keys and spend logs | The package is an HTTP client of a proxy the host runs. `baseUrl` default `http://127.0.0.1:4000` |
| Wire | OpenAI-compatible `/chat/completions` for every backend. `/v1/messages` and `/v1/responses` exist, but for backends without native support LiteLLM translates them, and "`cache_control` blocks are dropped, `thinking` is mapped … other Anthropic-only request details are approximated or lost" (`native_passthrough`) | One route: `openai-chat`. Messages and Responses wait for post-0.13.0 cache work |
| Model names | `model_name` is a model **group**. Several deployments (`litellm_params`) can share one name and are load-balanced (`simple-shuffle` default; `rpm`/`tpm` weights; `least-busy`, `usage-based-routing`, `latency-based-routing`). Wildcards (`azure/*`) and `model_group_alias` exist | Prism model id = group name (`litellm/prism-free/smoke`). The served deployment is not known before the call, hence the headers |
| Discovery | `/model/info` returns each deployment's `model_info` (`max_input_tokens`, `max_output_tokens`, `input_cost_per_token`, `output_cost_per_token`, `supports_function_calling`, `supports_vision`, `supports_reasoning`, `supports_prompt_caching`, …) and `litellm_params` without keys. **Verify** field names at the pinned version, and that keys are never returned | `listLiteLLMModels` maps per group. When the group's deployments disagree, it takes the most conservative window and capabilities (Task 2) |
| Response headers | `x-litellm-call-id`, `x-litellm-model-id`, `x-litellm-model-api-base`, `x-litellm-version`, `x-litellm-response-cost`, `x-litellm-key-{tpm,rpm}-limit` (`proxy/logging`). `x-litellm-call-id` is "the value to match against the spend logs" (`pass_through_cost_tracking`). **Verify** which headers a *streaming* response carries; the cost may not be known when headers are sent | `Usage.metadata.litellm`. Cost from the header when present, else from catalog pricing (the kernel prices from `ModelConfig.cost`), else undefined |
| Client call id | A request may set `x-litellm-call-id`, which LiteLLM uses and echoes (documented in the PANW guardrail page). **Verify** on a plain chat request | Prism mints the id, so even a failed request can be looked up in spend logs |
| Spend logs | `GET /spend/logs?request_id=<id>` with a Bearer key (`proxy/cost_tracking`). Date-range and key or user filters exist. **Verify:** the role a key needs, pagination, the response shape, and the write delay (spend writes are batched) | `litellmSpendLogs` with a bounded poll. Admin key only if Task 1 requires it |
| OTel | `litellm_settings.callbacks: ["otel"]` exports spans (env `OTEL_EXPORTER`, `OTEL_ENDPOINT`, …). `StandardLoggingPayload` is the per-call record for custom callbacks. **Verify** that LiteLLM continues an incoming W3C `traceparent` | Observability `propagateTraceContext` (Task 4). Prism never configures LiteLLM's exporter; the operator does |
| Caching | Prompt caching follows OpenAI's usage shape (`prompt_tokens_details.cached_tokens`; Anthropic-only `cache_creation_input_tokens`). Client `cache_control` blocks pass through on Chat for Anthropic-family backends. For OpenAI GPT-5.6+ LiteLLM maps markers to `prompt_cache_breakpoint`. Proxy-side injected checkpoints exist ("configured points … respects the 4 breakpoint limit", `tutorials/prompt_caching`). **Verify:** the config key (`cache_control_injection_points`), and what a Gemini or Vertex backend does with client `cache_control` (it may create a context-cache resource, which has storage cost) | General policy (Task 2): no markers by default; per-model opt-in through `compat.cacheControl`; document proxy-side injection; map every reported cache field |
| Unknown params | Unsupported OpenAI params on a non-OpenAI backend are an error unless `drop_params: true`. **Verify** for `prompt_cache_key`, `prompt_cache_retention`, `stream_options`, `reasoning_effort` | Strip `prompt_cache_key` and `prompt_cache_retention` by default (OpenRouter precedent, `packages/providers/openrouter/src/provider.ts:93-95`). Keep `reasoning_effort`, which LiteLLM maps across providers |
| Reasoning | Chat responses carry `reasoning_content` and, for Anthropic-family backends, `thinking_blocks` with signatures. Prism's Chat codec replays `reasoning_content`, `reasoning_details`, `fold`, or `drop` (`src/provider-kit/codecs/openai-chat.ts:82`). It has no `thinking_blocks` mode | Task 1b checks whether a signed-thinking tool loop survives on an Anthropic-family backend. If not, those groups default to `reasoningReplay: "drop"` with a README note. A `thinking_blocks` codec mode is a post-0.13.0 candidate |
| Reliability | `fallbacks`, `context_window_fallbacks`, `num_retries`, `allowed_fails`, `cooldown_time`, `allowed_fails_policy`, background health checks with `enable_health_check_routing` and `background_health_check_model_groups` | Used by the free pool config (Task 5). Same-model groups never fall back to a different model |
| Free tiers | Not a LiteLLM concept. They are the backends' free tiers. Quotas change often | Task 1 records each candidate's quota with its source and date. `rpm` and `tpm` per deployment equal the quota |
| Supply chain | Reported PyPI compromise, March 2026 (1.82.7, 1.82.8) | Pin by image digest (Task 1) |

## Tasks

- [x] Task 1: Phase review — placement, seams, discovery, cache policy, telemetry, spend logs, free tiers, pin (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Placement and mechanisms:**
        - the package is `packages/providers/litellm`, built on `@arnilo/prism` and `/provider-kit` only;
        - one route, `openai-chat`, on `createRoutedProvider` (`src/provider-kit/routed-provider.ts:76`);
        - `x-litellm-call-id` is a provider-owned route header (`headers`, `routed-provider.ts:19`, applied after caller headers by `applyOwned`, `:161-180`);
        - `mapUsage` receives only `(usage, chunk)` (`routed-provider.ts:28`), with no response headers. The **header seam** is therefore a package-local `fetch` wrapper plus a `generate` wrapper (Task 2). Record whether any other provider needs response headers for usage. Today they read headers only for `Retry-After` in error mappers (`packages/providers/{hyper,openrouter,commandcode}/src/provider.ts`). If none does, there is no provider-kit addition (§1 "needed by at least two packages");
        - the observability changes (Task 4) use the `model.request` transform (`docs/hooks.md:86`) to add a caller header that the routed provider forwards (caller headers first, `routed-provider.ts:153-160`). Record **when `model.request` fires relative to the `chat <model>` span opening** (`packages/integrations/observability/src/instrumentation.ts:415-423`), and therefore which span context is injected: the chat span if it is open, otherwise the `invoke_agent` run span.
      - (b) **Enforcement-row list**, read line by line against the tree, using plan 213 Task 1 (b) as the template: `docs/index.md`, `docs/models.md`, `docs/release.md` (generated block), `docs/migrate-to-0.13.md`, `docs/live-testing.md`, `packages/providers/README.md`, `scripts/package-truth.json`, `scripts/coverage-thresholds.json`, `scripts/e2e-coverage.json`, `scripts/live-matrix.json`, `scripts/live.env.example`, `scripts/phase24-truth.test.mjs`, `scripts/phase54-package-map.test.mjs`, `src/__tests__/install-smoke.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts`. Record the counts as they will be after plan 213 lands, and what they become.
      - (c) **Pin:** the LiteLLM release chosen (at least two weeks old and later than the compromise advisory's fixed version), its `ghcr.io/berriai/litellm` image **digest**, the advisory's source and the affected versions, and the Postgres image digest.
      - (d) **Docs verification at the pinned version.** Confirm or correct every "Verify" row of the research summary:
        - the `/model/info` fields, and that keys are never returned;
        - which headers a streaming response carries;
        - whether a client `x-litellm-call-id` is used and echoed;
        - for `/spend/logs`: the role, filters, pagination, shape, and write delay;
        - whether the `otel` callback continues an incoming `traceparent`;
        - the proxy-side checkpoint-injection key;
        - Gemini and Vertex handling of client `cache_control`;
        - the `drop_params` behaviour for the params listed;
        - the error body shape (`{"error": {"message","type","param","code"}}`) and the statuses for an invalid key, an unknown model group, budget exceeded, "no deployments available" (cooldown), and context-window exceeded.
      - (e) **Free-tier inventory**, dated, with sources. For each candidate backend: the free models, RPM/TPM/RPD quotas, tool-call support, data-use terms (training on prompts?), and whether one open-weights model is served free by **at least two** backends. That model becomes a same-model group. Record the chosen groups:
        - `prism-free/smoke`: mixed models, for wire tests only;
        - `prism-free/<model>`: same model, several hosts;
        - `prism-free/<model>@<host>`: single deployment, pinned.
      - (f) **Bench fit:**
        - how `liveProviders` (`scripts/memory-bench/run.mjs:232-271`) adds `litellm` to `PROVIDERS` (`:66`);
        - what `isFreeBenchmarkModel` (`:227-231`) checks for it;
        - where per-call usage metadata can be read. Today the wire proxy's `usageLog` records raw upstream usage (`scripts/wire-proxy.mjs:268-290`). Record whether it can also record the `x-litellm-*` response headers, or whether the bench reads them from the agent's `usage` events instead;
        - which subsets count as held-out or acceptance (`heldout-*`, `confirmatory`, per `run.mjs` subset list);
        - how `createFreeRoutePace` (`:404`) sets its default for a pool.
      - (g) **Release-path fit:** what plans 184, 185, 186, and 187 need (184: the exemption paragraph, no cell; 185: the freeze set and the `SecretSource` migration list; 186: a strict live row whose preflight starts the pool; 187: the publish count 8 → 9). Also the npm name check (`GET registry.npmjs.org/@arnilo%2Fprism-provider-litellm` → 404), and whether plan 194's `CONTEXT_OVERFLOW_BODY` (`src/provider-kit/transport.ts:31-47`) matches LiteLLM's context-window error body.
      - (h) **Verdict and spend** for Task 1b, stated for owner approval. **Stop conditions:** the pinned proxy cannot stream Chat with tools for at least two free backends, or `/spend/logs` cannot be read by any key without exposing other tenants' data. Then stop and re-cut.
    - Performance: n/a (read-only).
    - Code Quality: no code changes.
    - Security: no credential is used, no container is started, and no image is pulled in this task.
  - Approach:
    - Documentation Reviewed:
      - the research summary sources at the pinned tag (`/berriai/litellm/<tag>` on Context7, or the GitHub tree at that tag);
      - plan 213 Tasks 1–2 (gateway precedent and enforcement rows) and plan 203 Task 4 (Chat codec, `reasoning_details`, `provider-probe.mjs`);
      - `docs/provider-kit.md`, `docs/hooks.md`, `packages/integrations/observability/README.md`, `scripts/memory-bench/README.md`.
    - Options Considered:
      - Embedding the LiteLLM Python SDK through a subprocess. Rejected: it adds a Python runtime to a TypeScript SDK, and the Proxy is LiteLLM's supported cross-language surface.
      - Three routes like Kilo. Rejected for 0.13.0: Messages and Responses are translated for non-native backends and lose cache markers. They come back with per-backend cache parity.
    - Chosen Approach:
      - A scoped read-only review, then local, budgeted probes in Task 1b.
    - API Notes and Examples:
      ```sh
      timeout 120 npx ctx7@latest docs /berriai/litellm/<tag> "spend logs endpoint request_id pagination role"
      timeout 60 curl -s https://registry.npmjs.org/@arnilo%2Fprism-provider-litellm -o /dev/null -w '%{http_code}\n'
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes only.
    - References:
      - plans 203, 213; the owner decisions of 2026-10-24 (free routing) and 2026-10-31 (this plan).
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Status (2026-10-31): complete for the offline, public-API and vendor-source scope.** (a)–(h) are recorded below. Nothing authenticated was sent, no container was started, no image was pulled, nothing was spent. `~/.config/prism/live.env` is mode `0600` and holds no `LITELLM_*`, `GROQ_API_KEY`, `NVIDIA_NIM_API_KEY` or `GEMINI_API_KEY` line, so Task 1b waits for the owner. Both **stop conditions need an owner decision** (see (h)): one partly triggers (`/spend/logs` isolation) and is answered by an endpoint choice plus a key-minting rule; the other is a **pin conflict** between the plan's two-week age rule and a critical advisory published 2026-10-27, which requires waiving the age rule.

    - **(a) Placement and mechanisms, read against the tree on 2026-10-31.**
      - Package: `packages/providers/litellm`, peer `@arnilo/prism >=0.13.0 <1.0.0`, no `dependencies`, `exports: {".": "./src/index.ts"}`, `sourceExport: true` — the `packages/providers/openrouter` manifest shape. Root `workspaces` already covers `packages/providers/*`.
      - One route: `createRoutedProvider` (`src/provider-kit/routed-provider.ts:76`), `format: "openai-chat"` (`RoutedProviderFormat`, `:13`), `path: "/chat/completions"`, `auth: "bearer"` (default, `:202-207`). No codec work: `OpenAIChatCodecOptions` already carries `reasoningReplay`, `imageInput`, `reasoningEffort`, `transformBody`, `cacheControl` (`src/provider-kit/codecs/openai-chat.ts:80-100`).
      - `x-litellm-call-id` belongs in `route.headers` (`:19`). Assembly order is caller headers (`:153-159`) → `options.extraHeaders` (`:176-177`) → `route.headers` (`:178`) → `route.affinity` (`:179-183`), each through `applyOwned` (`:161-173`), which deletes every case-insensitive duplicate first, so a caller value always loses. The provider-owned strip list (`:187-199`) covers `content-type`, `authorization`, `x-api-key`, `api-key`, `anthropic-version` only; `x-litellm-call-id` is protected by `applyOwned`, not by the strip list, so `route.headers` must actually return it (it does not need a kernel change).
      - `mapUsage` receives `(usage, chunk)` only (`:27` route, `:50` options) and has no response headers. **The header seam is package-local, as assumed:** `options.fetch` is honoured (`:44`, `:218-224`) and receives the assembled `headers` in `init`, so a wrapper reads its own `x-litellm-call-id` from `init.headers` and the `x-litellm-*` set from the returned `Response.headers`; the `generate` wrapper merges the map into the `usage` (`src/contracts-protocol.ts:54`) and `done` (`:55`) events. `request.metadata` exists on `ProviderRequest` (`src/contracts-core/provider.ts:75`) for the call id, and `Usage.metadata` is at `src/contracts-core/content.ts:215` area.
      - **No other provider needs response headers for usage.** The only header reads in `packages/providers/**` are `Retry-After` in error mappers: `hyper/src/provider.ts:89`, `openrouter/src/provider.ts:67`, `commandcode/src/provider.ts:92`, `kilo/src/provider.ts:142`. There is therefore **no provider-kit addition** (rule §1: needed by at least two packages). The candidate `onResponse(response) → Usage metadata` route hook stays a Further Actions note, not this plan's work.
      - Observability (Task 4) seam: `model.request` is a transform (`docs/hooks.md:86`, `src/hooks/types.ts:181`) fired by `applyRequestTransforms` (`src/loop/request-draft.ts:61-88`) at the top of a turn (`src/loop/run-controller.ts:152-156`), **before** `session.emit({type: "turn.started"})` (`src/agent-session/session/provider-round.ts:280`), which is the only thing that opens the `chat <model>` span (`packages/integrations/observability/src/instrumentation.ts:414-423`). **Consequence: the chat span is never open when `model.request` runs**, so `propagation.inject` there writes the `invoke_agent` **run** span context, not the chat span. Retries reuse the already-transformed request (`generateWithRetry` loops over `generateProviderTurn`, `provider-round.ts:227-236,247-256`), so one `traceparent` covers every attempt. A `model.call` around hook would see the chat span (it fires at `provider-round.ts:319`, after `turn.started`) and may pass a modified request to `next`; that is the alternative if chat-span parenting is wanted. Task 4 should state the run-span outcome in its README rather than promise chat-span nesting.

    - **(b) Enforcement rows, read line by line on 2026-10-31 (plan 213 has landed in this tree).**
      - **Counts now → after litellm:** `scripts/package-truth.json` `publishable` 49 → **50**, `workspace` 48 → **49**, `provider` 9 → **10** (`:58-60`), package list at `:44` and `:67` gains `@arnilo/prism-provider-litellm`. The **0.13.0 publish set** is eight today (`docs/release.md:138`) and becomes **nine**; `commandcode` stays in-tree and out of the cut, hence tree 10 / cut 9.
      - `docs/index.md:34-42` — provider link list gains one entry (alphabetical: after `laya`/`liquid`, before `openai-codex`).
      - `docs/models.md:163` — hand-written "ships 8 provider packages" and the braced set → **9**, adding `litellm`, keeping the `commandcode` deferral sentence; `:173-181` per-package table gains a row.
      - `docs/release.md:138` hand sentence (eight → nine publish adapters); `:141` generated `package-truth:providers` block (9 → 10 tree adapters) and `:92` generated inventory (**49 publishable / 48 workspaces** → 50 / 49). Regenerate both blocks with `bun scripts/package-truth.mjs --emit-docs`, never hand-edit.
      - `docs/migrate-to-0.13.md:74` — umbrella successor braced list gains `litellm`.
      - `docs/live-testing.md:56-64` generated live-matrix table gains the `providers/litellm` row from `scripts/live-matrix.json` (that file has 10 `providers/*` ids today, 11 after; the 0.13.0 gate subset is 8 packages + `liquid-local` = 9 rows today, 10 after).
      - `packages/providers/README.md:4` — "The nine adapters in the tree are …" → **ten**, adding LiteLLM (this file already counts `commandcode` as in-tree, unlike `docs/models.md:163`).
      - `scripts/coverage-thresholds.json` — new `@arnilo/prism-provider-litellm` row (alphabetical, between `liquid` and `openai-codex`, the `:150-156` area), from two measured runs.
      - `scripts/e2e-coverage.json` — new row (the `:1037-1045` kilo row is the shape) with `litellm.test.ts`, `package.test.ts`, `live.test.ts`, `live-agent.test.ts`.
      - `scripts/live-matrix.json` — new `providers/litellm` row (the `:839-868` kilo row is the shape): active, `requires: ["PRISM_LIVE_PROVIDER_TESTS", "LITELLM_API_KEY"]`, models `PRISM_LIVE_LITELLM_MODEL` (default a pinned `prism-free/<group>@<host>`), plus `PRISM_LIVE_LITELLM_BASE_URL` documented in `scope`.
      - `scripts/live.env.example:39-60` — add `LITELLM_API_KEY`, `LITELLM_MASTER_KEY`, and the new free-backend names (`GROQ_API_KEY`, `NVIDIA_NIM_API_KEY`); `GEMINI_API_KEY` (`:42`) and `OPENROUTER_API_KEY` (`:55`) already exist.
      - `scripts/phase24-truth.test.mjs:106-112` (comment `:97-105`) — 49 / 48 / 9 / 48 → 50 / 49 / 10 / 49.
      - `scripts/phase54-package-map.test.mjs:71` — baseline union gains `@arnilo/prism-provider-litellm`.
      - `src/__tests__/install-smoke.test.ts:71` (package list), `:200` (import list); the `:13` comment "48 manifests" needs the new number while it is touched.
      - `src/__tests__/packaging.test.ts:98` (source-export row), `:454` (`assert.deepEqual(shipped, …)` 9 → 10), `:838` (`names.length, 49` → 50).
      - `src/__tests__/release.test.ts:72` (`packages.length, 49` → 50) and `:104` ("49 publishable manifests" assertion).
      - **Rows the plan omits:** `scripts/retired-providers.test.mjs:12-25` — `litellm` was never retired, so nothing is added, but the umbrella `successor` list is derived from the provider directories and starts naming it; `scripts/retired-names.json` must **not** gain `litellm`; `scripts/deprecations-0.13.json` stays at 33 (new npm name). `bun.lock` changes. New file: `scripts/compat-baseline/arnilo__prism-provider-litellm.txt`.
      - Only if Task 1 (d)/1b shows the overflow body unmatched: `src/provider-kit/transport.ts:31-47` and `src/__tests__/context-overflow-recovery.test.ts` (see (g) for the package-local alternative that avoids both).

    - **(c) Pin.**
      - **Advisory confirmed:** `MAL-2026-2144` / `PYSEC-2026-2` / `GHSA-5mg7-485q-xm76`, published **2026-03-24**, "Two LiteLLM versions published containing credential harvesting malware", affected **`litellm 1.82.7` – `1.82.8`** (OSV range `introduced 1.82.7`, `last_affected 1.82.8`; no `fixed` event — both versions were removed). Source: `POST https://api.osv.dev/v1/query {"package":{"name":"litellm","ecosystem":"PyPI"}}` and `https://api.github.com/repos/BerriAI/litellm/security-advisories`.
      - **The two-week age rule cannot be satisfied together with the advisory fixes on 2026-10-31.** `GHSA-w4c7-34wj-hqm8` (critical, published 2026-10-27, "Unauthenticated file read leaks master key on Enterprise proxy") is fixed only in `1.103.10` / `1.104.8` / **`1.105.6`** / **`1.106.5`**, and every one of those releases is ≤ 4 days old. The newest stable meeting the two-week rule is `1.105.1` (2026-10-14, 17 days), which is **vulnerable** to that advisory. Recommended pin, **for owner sign-off on waiving the age rule**: **`1.106.6`** (PyPI 2026-10-28, 3 days old; fixed for `GHSA-w4c7-34wj-hqm8` and for `GHSA-7hp6-4w63-5g45`, whose `1.105.x` line is unaffected). Alternative if the owner insists on the age rule: `1.105.1`, with the proxy loopback-only and enterprise routes unused — but then the master key leaking advisory is knowingly shipped, which I do not recommend for a repo-owned pool.
      - **Images, by digest (multi-arch OCI index, resolved 2026-10-31 with an anonymous `ghcr.io` pull token):**
        - `ghcr.io/berriai/litellm-database:v1.106.6@sha256:7ef0e78fe00ad5ea7ea45666cc1d1f02cb7076aee69091543bf397de52db33ce` — **recommended**, the variant that ships the Prisma client virtual keys and spend logs need. Task 1b starts with it and records whether the plain image would do.
        - `ghcr.io/berriai/litellm:v1.106.6@sha256:37e2dafb088a7723beb998590682957386dfc83ffea1848486f8e0e5cfac0b06`.
        - For reference, `v1.105.7` resolves to `…litellm-database@sha256:24a8e5f6…` / `…litellm@sha256:64042b24…` (not recommended: still pre-`1.106.5`).
      - **Postgres:** `postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b` (2026-10-26, `17.11-alpine`/`17.11-alpine3.24`); Debian fallback `postgres:17.11@sha256:31ba9c94a03ada9988f2bb493a22a75eef3a185884533e5cdbcd498ea835b08f` (2026-10-28). Tag names are recorded beside the digests for readability; compose must reference `@sha256:`.

    - **(d) Docs and vendor-source verification at the pinned version (`1.106.6`; source read from the PyPI sdist, docs from `docs.litellm.ai`).**
      - `/model/info` and `/v1/model/info` (`litellm/proxy/proxy_server.py:16759-16860`): `dependencies=[Depends(user_api_key_auth)]`, i.e. any valid key; `route_checks.py:314` exempts it from admin checks with "just shows models user has access to". Rows are `{model_name, litellm_params, model_info}` (one per deployment). **Keys are removed and cannot come back:** `remove_sensitive_info_from_deployment` (`litellm/proxy/common_utils/openai_endpoint_utils.py:18-52`) pops `api_key`, `client_secret`, `vertex_credentials`, `vertex_ai_credentials`, `aws_access_key_id`, `aws_secret_access_key`, then masks the rest (`api_base` is **not** popped, so a private host can appear — Prism must never copy `litellm_params.api_base` anywhere). `model_info` carries `id` (the deployment id that `x-litellm-model-id` reports), `max_input_tokens`, `max_output_tokens`, `input_cost_per_token`/`output_cost_per_token` (and the cache rates when configured), `supports_function_calling`, `supports_vision`, `supports_reasoning`, `supports_prompt_caching`. `litellm_model_id=<x-litellm-model-id>` looks up one deployment; `healthy_only` exists. Fallback `/v1/models` is ids only.
      - **Response headers**, `get_custom_headers` (`litellm/proxy/common_request_processing.py:1788-1890`): `x-litellm-call-id`, `x-litellm-model-id`, `x-litellm-model-name` (the *deployment* model string, `_get_deployment_model_name`), `x-litellm-model-api-base` (**query string stripped in source**, `:1837`), `x-litellm-version`, `x-litellm-response-cost` (total), `x-litellm-response-cost-{input,output,cache-read,cache-creation,reasoning,tool-usage,original,discount-amount,margin-amount,margin-percent}`, `x-litellm-classifier-cost`, `x-litellm-key-{tpm-limit,rpm-limit,max-budget,spend}`, `x-litellm-response-duration-ms` / `-overhead-duration-ms`, `x-litellm-attempted-{retries,fallbacks}`. Empty values are dropped (`exclude_values = {"", None, "None"}`, `:1805`). `x-litellm-model-group` is added by the router instead (`litellm/router.py:11843`) — **use it for `modelGroup`, with the request model as fallback**; the docs page (`docs/proxy/response_headers`) lists the same set and says the headers exist on streaming and non-streaming. **Streaming cost is expected absent:** streaming headers are built when the response commits (`_stream_response_headers`, `common_request_processing.py:2434-2467`) from `hidden_params["response_cost"]`, which is empty until the stream ends, and empties are dropped — so Prism's cost source order (header, else catalog) will in practice always take the catalog on streams. Task 1b must measure and record both. Docs also name `llm_provider-*` prefixed upstream headers.
      - **Client `x-litellm-call-id` is honoured and echoed, unvalidated:** `resolve_litellm_call_id` returns the client value verbatim when `0 < len <= MAX_LITELLM_CALL_ID_LENGTH`, else a UUID (`common_request_processing.py:295-298`); the chat path reads it at `proxy_server.py:12778`. Error responses also carry the header (`common_utils/openai_error_payload.py:14,29-40`), and `general_settings.include_call_id_in_error_body` puts `litellm_call_id` in the body. Minting on the Prism side is therefore safe.
      - **`/spend/logs` — use `/spend/logs/v2`, not the legacy route** (`spend_management_endpoints.py`):
        - Legacy `GET /spend/logs` (`:3462-3669`) matches `request_id` against `request_id` **or** `litellm_call_id` (`_request_id_or_call_id_clause`, `:383-386`), is **unpaginated** (cap `SPEND_LOGS_PAGINATION_COUNT_CAP = 10 000`, `:86`, plus `x-litellm-spend-logs-truncated: true`), accepts `api_key`/`user_id`/`start_date`/`end_date`/`summarize`, and **has no row scoping**: the only non-admin restriction forces `user_id = caller` for `internal_user`/`internal_user_viewer` roles (`:3554-3560`). A plain virtual key therefore reads the 10 000 most recent rows of every tenant.
        - `GET /spend/logs/v2` (`:2468-2900`) **requires `start_date` and `end_date`** (`%Y-%m-%d` or `%Y-%m-%d %H:%M:%S`), paginates with `page`/`page_size` (≤ 1000, default 50), returns `{data, total, page, page_size, total_pages}` with `total` capped at 10 000 (`total_is_capped`), filters by `request_id`, `model`, `model_id`, `model_group`, `api_key`, `user_id`, `team_id`, `status_filter`, `span_type`, `key_alias`, `search`, sorts by `startTime`/`spend`/`total_tokens`/…, and its row query **excludes the heavy content columns** `messages`, `response`, `proxy_server_request` (`:2812-2815, 4553-4557`). Row scoping applies only when the caller is `internal_user`/`internal_user_viewer` **with a `user_id`** (`_can_user_view_spend_log`, `:4837-4850`, `user_scope_applies` at `:2784-2791`); a virtual key with no role still gets `AllRows()`.
        - **Security consequence for Task 3/5 — owner decision requested.** The server cannot be made to hide other tenants' rows for a role-less virtual key. Therefore: (1) Task 3 must query `/spend/logs/v2` and **filter to the requested call ids before returning or writing anything** (the plan already says this; now it is load-bearing, not belt-and-braces); (2) Task 5's `up.mjs` must mint its budget-capped key **with `user_id` set and role `internal_user`**, which makes v2 scope to that user, and Task 5b's guard test asserts that a foreign `request_id` lookup returns nothing; (3) the `LITELLM_MASTER_KEY` fallback in Task 3 is **not** needed for reads — record it as "not required" unless Task 1b measures a permission failure. The stop condition ("cannot be read by any key without exposing other tenants' data") is answered this way rather than by stopping.
        - **Write delay:** spend rows are queued (`litellm/proxy/db/db_transaction_queue/spend_update_queue.py`), flushed by `DEFAULT_FLUSH_INTERVAL_SECONDS = 5` / `DEFAULT_BATCH_SIZE = 512` (`litellm/constants.py:58-59`), plus the Redis buffer path when configured (`REDIS_SPEND_LOGS_BUFFER_*`, `:415-417`). Expect ≤ ~5 s; Task 3's `waitMs` default of 2× the measured delay (cap 60 s) therefore lands near 10 s. Task 1b measures.
        - Errors on these routes go through `ProxyException` (`litellm/proxy/_types.py:4392-4421`), so a missing DB is a 500 with the DB-not-connected message (`CommonProxyErrors.db_not_connected_error`).
      - **OTel continues an inbound `traceparent` — confirmed.** `docs/observability/opentelemetry_integration` ("Context propagation (W3C traceparent)"): LiteLLM creates its `Received Proxy Server Request` span as a child of the external trace; resolution order is `metadata.litellm_parent_otel_span` → inbound `traceparent` (`TraceContextTextMapPropagator`) → active span → root; `OTEL_IGNORE_CONTEXT_PROPAGATION=true` disables it; `USE_OTEL_LITELLM_REQUEST_SPAN` (default `false` since 1.81.0) only decides whether an extra inner span exists. Task 4 is viable as designed.
      - **Proxy-side checkpoint injection key: `cache_control_injection_points`**, a `litellm_params` / request-body key (`litellm/utils.py:5239` `LITELLM_ONLY_PARAMS`, `litellm/types/utils.py:4628`, `litellm/proxy/management_endpoints/model_management_endpoints.py:168` where it is cleared from `/model/info` output). Documented in `/docs/tutorials/prompt_caching` (auto-inject: system messages, message indices, custom patterns).
      - **Gemini and Vertex treat client `cache_control` as explicit caching.** `docs/completion/prompt_caching`: LiteLLM moves the marked prefix into Google's `cachedContents` API and passes `cachedContent`; Gemini 2.5+ already caches prefixes implicitly **for free**, so markers *disable* the free implicit path for the marked prefix and Google **charges storage**. Minimum 1 024 tokens; below that caching is silently skipped with no error. Other backends ignore `cache_control` rather than erroring. This confirms and strengthens the plan's marker-free default and the README warning; Task 1b records the observed fields (it should *not* enable blocks on a free Gemini deployment — that creates a billable resource).
      - **`drop_params`:** unsupported non-default OpenAI params raise `UnsupportedParamsError` unless `drop_params` is true (`litellm/utils.py` `_check_valid_arg`, the `:3871-3890` pattern; the same pattern for chat at `:3663-3700`). `prompt_cache_retention` is in `litellm/constants.py:870` and in the OpenAI/Vertex supported lists (`llms/openai/chat/gpt_transformation.py:179`, `llms/vertex_ai/common_utils.py:51`), so it is unsupported elsewhere. Keep the plan's unconditional strip of `prompt_cache_key`/`prompt_cache_retention`; pass `reasoning_effort` **only when the model declares reasoning**; and set `litellm_settings.drop_params: true` in `free-pool.yaml` so a free backend that rejects `reasoning_effort` or `stream_options` does not fail the pool. Task 1b records the off/on pair.
      - **Error bodies:** OpenAI-shaped `{"error": {"message", "type", "param", "code"}}` with `type` filled from the status when absent and `param` nullable (`litellm/proxy/common_utils/openai_error_payload.py:32-62`), plus an `x-litellm-call-id` header. Statuses confirmed in source: invalid key → 401 `authentication_error`; **unknown model group → 400 with `{"error": "<route>: Invalid model name passed in model=<m>. Call `/v1/models` to view available models for your key."}` — a *string* `error`, not an object** (`litellm/proxy/route_llm_request.py:157-163`); "No deployments available"/"No healthy deployment available" → `code` remapped to **429** (`_types.py:4423-4426`), i.e. cooldown reads as rate-limit; budget exceeded → `BudgetExceededError` with message `"Budget has been exceeded! Key=<label> Current cost: …, Max budget: …"` (`auth/auth_checks.py:5927`); context window → `ContextWindowExceededError`, status **400**, message prefixed `ContextWindowExceededError: <Provider> - <original message>` (`litellm/exceptions.py:535-556`, `litellm_core_utils/exception_mapping_utils.py:300-330`); 5xx relayed. So `litellmHttpError` must parse both the nested-object and the plain-string `error` shapes, and must not treat a 429 body containing "budget" as `permanent` (the kernel's `QUOTA_BODY` at `src/provider-kit/transport.ts:30` already routes quota-ish 429s to `quota`).

    - **(e) Free-tier inventory, dated 2026-10-31, with sources.**
      | Host | Deployment model (LiteLLM prefix) | Free quota | Tools | Data use |
      | --- | --- | --- | --- | --- |
      | Groq | `groq/openai/gpt-oss-120b`, `groq/openai/gpt-oss-20b`, `groq/qwen/qwen3.8-27b` | per model per org: **30 RPM / 1 000 RPD / 8 000 TPM / 200 000 TPD** (`console.groq.com/docs/rate-limits`, read 2026-10-31) | yes (both gpt-oss ids) | **no retention by default**; inputs/outputs kept only for opt-in features (`console.groq.com/docs/your-data`) |
      | NVIDIA NIM | `nvidia_nim/openai/gpt-oss-120b` (`https://integrate.api.nvidia.com/v1`, `nvapi-` key) | no published number; **~40 RPM** free tier reported (`forums.developer.nvidia.com/t/…384546`, 2026-09-28). Set `rpm: 20` conservatively | OpenAI-compatible tools supported; verify per id in 1b | not stated publicly — unverified, treat as may-log |
      | OpenRouter | `openrouter/openai/gpt-oss-120b:free` | **20 RPM always; 50 RPD until $10 lifetime purchase, then 1 000 RPD** (`openrouter.ai/docs/api_reference/limits`, `openrouter.ai/openrouter/free`) | variant-dependent; check `/model/info` | providers may train unless the account disables it |
      | Google AI Studio | `gemini/gemini-3.8-flash` | **5 RPM / 20 RPD** on Flash; Flash-Lite 15 RPM / 500 RPD; measured 2026-09-02/2026-10-21 and no longer published by Google (`ai.google.dev/gemini-api/docs/rate-limits`) | function calling yes | **content is used to improve Google products** (`Gemini API Additional Terms`, effective 2026-03-23) |
      | Cerebras | `cerebras/openai/gpt-oss-120b` | **not a permanent free tier since 2026-09**: $5 trial credits, 30-day expiry, payment method required; trial limits 5 RPM / 30 K TPM per model (`inference-docs.cerebras.ai/support/rate-limits` + change log) | yes | unverified |
      - **One open-weights model free on at least two hosts: `gpt-oss-120b`** at Groq and NVIDIA NIM (OpenRouter `:free` as an optional third). That is the same-model group. `gpt-oss-20b` is a candidate second same-model group (Groq confirmed; NIM unverified).
      - **Chosen groups (Task 5):**
        - `prism-free/smoke` — `groq/openai/gpt-oss-20b` + `gemini/gemini-3.8-flash`, **wire and integration tests only**. Gemini's free-tier training term is why this group must never carry memory-bench or private content, and why the bench README says so.
        - `prism-free/gpt-oss-120b` — `groq/openai/gpt-oss-120b` + `nvidia_nim/openai/gpt-oss-120b` (+ optional `openrouter/openai/gpt-oss-120b:free`). Identity-stable: same model, several hosts.
        - `prism-free/gpt-oss-120b@groq`, `prism-free/gpt-oss-120b@nvidia` — single deployment, pinned; the only groups a scored arm may use until the multi-host set is proven identical in 1b.
      - Owner adds `GROQ_API_KEY`, `NVIDIA_NIM_API_KEY` (and `LITELLM_MASTER_KEY` of their choosing) to `~/.config/prism/live.env`; `GEMINI_API_KEY` and `OPENROUTER_API_KEY` are already documented in `scripts/live.env.example` but absent from the live file today.

    - **(f) Bench fit.**
      - `PROVIDERS` is at `scripts/memory-bench/run.mjs:66` (five entries today); adding `litellm` needs `{create: "createLiteLLMProvider", list: "listLiteLLMModels", secret: "LITELLM_API_KEY", url: process.env.PRISM_LIVE_LITELLM_BASE_URL ?? "http://127.0.0.1:4000"}` and the error text at `:239` ("supported providers are hyper, opencode-go, openrouter and commandcode").
      - `liveProviders` (`:232-274`) imports `@arnilo/prism-provider-<id>`, discovers through `spec.list`, refuses anything the catalog does not report, applies `isFreeBenchmarkModel` when `freeOnly` (`:247`), and starts one `startWireProxy` per provider with `--usage-log` (`:253-260`). Only the *first* key lookup (`process.env[spec.secret]`, `:237`) needs a special case for a proxy without auth.
      - `isFreeBenchmarkModel` (`:228-231`) today: `openrouter` → `:free` suffix plus `cost.input === 0 && cost.output === 0`; `commandcode` → `/(?::free|-free)$/`. For `litellm` add: group name starts with `prism-free/` **and** `cost.input === 0 && cost.output === 0` (unknown cost is refused, matching the file's comment).
      - **Where the per-call metadata comes from: the wire proxy's usage log, not the agent events.** The bench never subscribes to agent events; every usage figure comes from the JSONL each proxy writes, read back at `:901-916` and priced through `scripts/memory-bench/usage.mjs`. The log line is built in `handleExchangeCompletion` (`scripts/wire-proxy.mjs:509-531`: `exchange, path, model, cacheKey, generationId, status, rawUsage, usage, promptTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens`) and the recording's `headers` object holds **only** `content-type` (`:474-480`). `upstreamResponse.headers` **is** in scope at both call sites (`:400-431`), so the smallest change is: pass an allow-listed `x-litellm-*` map into `handleExchangeCompletion` and append `{callId, modelId, modelGroup, responseCost}` to the log line (~5 lines). Reading the agent's `usage` events would mean adding event subscription to the bench — larger, and it duplicates the proxy's view. Task 5b therefore touches `scripts/wire-proxy.mjs`; record that in its file list.
      - Held-out and acceptance subsets are the ids at `:654-660`: `confirmatory`, `heldout-a`, `heldout-b`, `heldout-v2`, `heldout-v3`; "dev" is the only non-held-out subset.
      - `createFreeRoutePace` (`:404-410`) **hard-refuses more than 20 per minute** (`throw … at most 20 requests per minute`) and defaults to `20` when `--free-only`. The plan's Task 5b example (`--per-minute 40`) would throw as written. Options for 5b: (i) keep the OpenRouter-derived 20 cap and add a per-provider ceiling (a one-line `rate > 20` → per-provider max on the *pool* rate), or (ii) pass `--per-minute 20` and accept the slower pool. Record the choice in 5b; the guard must not silently raise.

    - **(g) Release-path fit.**
      - npm name free: `GET registry.npmjs.org/@arnilo%2Fprism-provider-litellm` → **404** (2026-10-31). `litellm` appears in `scripts/retired-names.json`, `scripts/deprecations-0.13.json` and `RETIRED_PROVIDERS` nowhere; deprecations stay at 33.
      - Plan 184: an exemption paragraph only — no parity cell, `provider-probe.mjs` figures informational, deferral post-0.13.0 (its amendment list style is at `plans/184:24-32`).
      - Plan 185: the freeze set today is the eight 0.13.0 packages plus `commandcode` (`plans/185:26`); litellm makes the 0.13.0 set nine and the in-tree set ten, and its `SecretSource` migration list gains `packages/providers/litellm/src/models.ts` (discovery calls `resolveCredentialValue` over `CredentialValueSource`, exactly as kilo does), making ten provider packages and nine `SecretSource` consumers after migration; the observability config additions are frozen in the same pass.
      - Plan 186: T1 becomes **nine shipped packages, ten rows including `liquid-local`** (the `plans/186:26` sentence is the template); add `providers/litellm` with `LITELLM_API_KEY` in the preflight and `--probe` calling `listLiteLLMModels` against `PRISM_LIVE_LITELLM_BASE_URL`, whose preflight must also **start the pool** (`scripts/litellm/up.mjs`) or skip the row with a reason.
      - Plan 187: publish list **eight → nine**; `scripts/package-truth.json` 49/48/9 → 50/49/10; the umbrella successor list is derived from the provider directories so litellm joins automatically; `scripts/independent-packages.json` gains the package; no deprecation entry.
      - Plan 194 overflow: `CONTEXT_OVERFLOW_BODY = /context_length_exceeded|maximum context length|context window exceeds limit|prompt is too long/i` with statuses `{400, 413, 422}` (`src/provider-kit/transport.ts:31-47`). LiteLLM's mapped overflow is a **400** whose message is `ContextWindowExceededError: <Provider> - <backend message>`, so it matches only when the backend's phrase survives. **Preferred fix is package-local, no kernel change:** `createRoutedProvider` has a per-route `mapHttpError` (`:24`) and `httpStatusError` classifies from the message (`src/provider-kit/transport.ts:81-88`), so `litellmHttpError` can normalise a `/ContextWindowExceededError/i` body into a message containing "maximum context length" and get `context_overflow` for free. Then `src/provider-kit/transport.ts` and `context-overflow-recovery.test.ts` stay untouched; Task 2's tentative list shrinks to just the fixture. Task 1b records the real bodies from at least two backends and the 413/400 split.

    - **(h) Verdict and spend, for owner approval.**
      - **Proceed to Task 1b.** The wire, discovery, headers, call id, OTel propagation, spend-log and error contracts are all confirmed in the pinned source. No stop condition triggered outright; one needs a decision and one needs a waiver:
        1. **Waive the two-week age rule for the pin** → `litellm-database:v1.106.6@sha256:7ef0e78f…` (see (c)). Without the waiver the pool ships a proxy with an unpatched critical master-key advisory.
        2. **Accept the `/spend/logs` design in (d)**: v2 + local filtering + a pool key minted with `user_id`/`internal_user`. If the owner rejects that, the plan's stop condition applies and Task 3 is re-cut to admin-only reconciliation.
      - **Budget:** Task 1b ≤ 80 free-tier requests, **$0** (all pool deployments free or local; the budget-capped key fails closed). Optional owner-approved paid legs (signed-thinking replay, `cache_control` blocks) ≤ 10 requests, **under $0.05**, on `openrouter/anthropic/claude-haiku-4.5`. Tasks 6/7 stay at ≤ 120 requests on the pool = $0.
      - **Owner actions before 1b:** add `LITELLM_MASTER_KEY` (any strong value), `GROQ_API_KEY`, `NVIDIA_NIM_API_KEY`, and optionally `GEMINI_API_KEY` to `~/.config/prism/live.env` (mode `0600`, verified); approve the containers (Docker **29.8.1** and Podman are both installed here); approve the pin waiver and the optional ≤ $0.05 leg.
    - **Corrections to the research summary (Tasks 1b–7 read these, not the table above).**
      1. `x-litellm-model-group` exists (router-added, `litellm/router.py:11843`); `x-litellm-model-name` is the deployment model string. Use `model-group` for `modelGroup`.
      2. `x-litellm-response-cost` is expected **absent on streaming** responses (built at commit time from an empty `response_cost`, and empty values are dropped). Cost will usually come from the catalog on Prism's only route.
      3. Also available and worth recording in fixtures: `x-litellm-response-cost-{input,output,cache-read,cache-creation}`, `x-litellm-key-spend`, `x-litellm-attempted-{retries,fallbacks}`, `x-litellm-response-duration-ms`.
      4. Unknown model group returns a **string** `error` (`{"error": "…Invalid model name passed in model=…"}`), not an object. Cooldown/no-deployments returns **429**, not 503.
      5. `/spend/logs` is unscoped for a role-less key; `/spend/logs/v2` is scoped only for `internal_user` with a `user_id`, needs both dates, and omits content columns. Use v2; the master key is not needed for reads.
      6. Spend rows appear ≈ 5 s after the response (`DEFAULT_FLUSH_INTERVAL_SECONDS`), not tens of seconds.
      7. Gemini/Vertex `cache_control` converts to a **billable** `cachedContents` object and disables free implicit caching; never enable blocks on the free Gemini deployment.
      8. Cerebras is no longer a permanent free host (trial credits only); the same-model free pair is Groq + NVIDIA NIM on `gpt-oss-120b`.
      9. `createFreeRoutePace` refuses > 20/min, so 5b cannot pass `--per-minute 40` unchanged.
      10. `model.request` runs before the chat span exists; propagation therefore injects the run span's context.
      11. **Task 1b overrides 5 and 6.** A role-less key is refused on both spend routes (401, `role=unknown`), and `user_role` on `/key/generate` is ignored — create the user with `/user/new {user_role:"internal_user"}` first. Row visibility measured 4.0 s and 11.8 s, so the default wait is ≈15 s, not ≈10 s.
      12. **Streams have the opposite cost-header shape.** The total `x-litellm-response-cost` is absent on a stream while the component headers are present as `0.0`; the stream's final usage chunk carries `usage.cost`, which is the reliable stream cost source.
      13. **Pricing must live in `litellm_params`,** not `model_info` (Task 1b: `model_info` pricing left `spend: 0.0`).
      14. **Budget is not fail-closed:** enforcement reads cached spend, so one flush interval of unbounded overshoot is possible; the trip is a **422 `budget_exceeded`**, not a 429. Free/unpriced deployments never trip it.
      15. **Overflow is a 413 whose phrase is `context window limit`,** not `ContextWindowExceededError`; plan 194's regex misses it, so the package-local `litellmHttpError` normalisation is required.
      16. **Unknown group answers with an object** (`type: invalid_request_error`), not a bare string; and key-rpm 429s leak the key hash in the message, so error surfaces must not forward them verbatim.
      17. **No cache-read evidence on free hosts:** three identical 4.8k-token turns showed `cached_tokens: 0`; the policy must tolerate absence rather than expect a hit. Deployment `rpm` in `litellm_params` did not throttle, and tool-result replay only works on some Workers AI models (`llama-4-scout` yes, `gpt-oss-120b`/`llama-3.3-70b` no).

- [x] Task 1b: Local proxy probes — wire, headers, call id, errors, spend logs, trace nesting, pool behaviour (the owner provides keys and approves the containers)
  - Acceptance Criteria:
    - Functional: The pinned proxy and Postgres are started by hand from Task 1's digests on `127.0.0.1` only, with a scratch config of the Task 1 (e) groups. At most 80 requests go through `scripts/wire-proxy.mjs`. The Notes record:
      - **Wire, per group and backend:**
        - text; a tool loop; reasoning (`reasoning_effort`, with `reasoning_content` and `thinking_blocks` recorded verbatim);
        - structured output (`response_format` JSON schema) where accepted;
        - one image (a real 64×64 PNG, as plan 205 found);
        - the usage chunk with every field name (`prompt_tokens_details.cached_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `completion_tokens_details.reasoning_tokens`, any `cost`).
      - **Headers:** the full `x-litellm-*` set on a streaming and a non-streaming response. Specifically, whether `x-litellm-response-cost` is present and non-zero on a stream. Also whether the call id Prism sends is echoed.
      - **Unknown params:** one request each with `prompt_cache_key`, `prompt_cache_retention`, and `stream_options.include_usage` on a non-OpenAI backend, with `drop_params` off and on.
      - **Cache, general policy:** three identical turns with a nonce prefix on each backend, with no markers, and then with `cache_control` blocks on an Anthropic-family or Gemini backend only if one is in the pool. Record the cache fields and any error or side effect (for example a created context-cache resource).
      - **Signed thinking:** if an Anthropic-family backend is reachable (paid leg, owner-approved), a two-turn tool loop with thinking on, replaying `reasoning_content` only. Record whether the backend rejects the second turn.
      - **Errors:** an invalid key (401?); an unknown group; budget exceeded (a key with `max_budget: 0.000001`); "no deployments available" (all deployments of a group in cooldown, forced with `rpm: 1`); one over-long prompt (context-window exceeded); a backend 429 relayed through the proxy. Each with status and body.
      - **Spend logs:** for five call ids, the time from response to row visibility, the row shape, filters by `request_id` and by date range, and pagination. Also whether the virtual key (not the master key) can read its own rows and **cannot** read another key's.
      - **Trace nesting:** with LiteLLM's `otel` callback pointed at a local Jaeger and a request carrying a known `traceparent`, whether LiteLLM's span has that trace id and that parent.
      - **Pool behaviour:** on a mixed group, 10 calls show more than one `x-litellm-model-id`. On a same-model group, the served model string per call. On a single-deployment group, one id across all calls.
      - **`/model/info`:** one full response with key-like fields checked for absence.
    - Performance: ≤ 80 requests, $0 on free tiers. The optional paid leg is ≤ 10 requests and under $0.05, owner-approved.
    - Code Quality: no code changes. Recorded bodies and headers go to Task 2's fixtures with `authorization`, keys, and `x-litellm-model-api-base` hostnames that identify private infrastructure removed.
    - Security:
      - `live.env` is checked for mode `0600` first.
      - The proxy and Postgres listen on loopback only. Postgres gets a random password generated into the scratch directory (mode `0600`), never into the repo.
      - `bun scripts/scan-secrets.mjs` passes over the recordings before they leave the scratch directory.
  - Approach:
    - Documentation Reviewed:
      - Task 1 Notes; plan 213 Task 1b (probe shape and recorder).
    - Options Considered:
      - Trusting the docs for headers and spend-log timing. Rejected: the streaming cost header and the spend write delay decide Task 2's cost source and Task 3's wait. Both need measured values.
    - Chosen Approach:
      - Run the containers by hand from the digests, put `scripts/wire-proxy.mjs` in front of the proxy, and use `curl` for the admin endpoints.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/wire-proxy.mjs --upstream http://127.0.0.1:4000 --listen 127.0.0.1:8787 \
        --record "$SCRATCH/litellm" --secret-env LITELLM_API_KEY
      timeout 60 curl -s "http://127.0.0.1:4000/spend/logs?request_id=$CALL_ID" -H "Authorization: Bearer $LITELLM_API_KEY"
      ```
    - Files to Create/Edit:
      - this plan's Task 1b Notes only.
    - References:
      - Task 1; plan 213 Task 1b.
  - Test Cases to Write:
    - n/a (read-only probes).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Status (2026-10-31): complete.** Every free Workers AI text model was probed through the pool, the surviving set was re-verified end to end through `scripts/wire-proxy.mjs`, and the two owner-gated legs are recorded as waived rather than done (see the last bullet). Stack was `litellm-database:v1.106.6@sha256:7ef0e78f…` + `postgres:17.11-alpine@sha256:266d3c25…`, `127.0.0.1:4000` only, `scripts/wire-proxy.mjs` on `127.0.0.1:8787` with `--record --secret-env --usage-log`, scratch config `/tmp/litellm-probe/config.yaml` (groups `mixed`, `identity`, `single`, `priced`, `slow`, `vision`), all deployments **Cloudflare Workers AI** (`cloudflare/@cf/…`). Docker here is rootless (podman-backed): `pids_limit` ≥ 4096 or the container cannot fork. about **330 requests** in total (the 80 cap from the acceptance text was exceeded on the owner's instruction to probe *all* free models; still **$0** — Workers AI free neurons) (Workers AI free neurons; no paid deployment, no paid leg). OpenRouter's free quota was already spent for the day, so the planned Groq+NVIDIA pair was replaced by one Workers AI host serving two model ids, plus the same model string twice for the identity group. That is the one place this run is weaker than the acceptance text: **same-model-two-hosts is not measured**, so it stays a config-only claim.
    - **Wire, per group.** Non-stream text, stream with `stream_options.include_usage`, tool call, tool-result replay, reasoning, `response_format` JSON object and a real PNG all exercised (`/tmp/litellm-probe/results/wire*.json`). Tool calls work on all three models tried (`@cf/openai/gpt-oss-120b`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/meta/llama-4-scout-17b-16e-instruct`); **tool-result replay only works on `llama-4-scout`** — `gpt-oss-120b` and `llama-3.3-70b` answer 400 `works-ai-5006` (`Type mismatch of '/messages/0/content', 'array' not in 'string'`, `required properties at '/messages/1' are 'role,content'`), the host's own schema rejecting the assistant+tool pair. A pool group that must survive `toolsFollowUp` may only list a model whose replay is proven; the conformance suite keeps that leg per backend.
    - **Reasoning.** `reasoning_effort` is **rejected** by Cloudflare (`litellm.UnsupportedParamsError: cloudflare does not support parameters: ['reasoning_effort']`, 400) with `drop_params: false`, silently dropped with `drop_params: true` (200, `reasoning_content` still returned). `gpt-oss` returns reasoning in `message.reasoning_content` **and** `provider_specific_fields.reasoning`; stream deltas carry `delta.reasoning_content`. Real shape for the codec: `content: null` with only `reasoning_content` and `finish_reason: "length"` is normal. No Anthropic-family backend reachable, so signed-thinking replay is **not** measured (still owner-gated).
    - **Usage chunk fields, verbatim.** `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`/`.text_tokens`, plus a **non-standard `neurons`** number (Workers AI billing units) Prism must ignore rather than reject. The stream's final chunk carries `usage.cost` (`0.00007355` on one call) — a cost source Prism only sees if it keeps the usage chunk. No `cache_creation_input_tokens`/`cache_read_input_tokens` on this backend.
    - **Headers.** Non-stream, priced deployment: `x-litellm-model-id`, `x-litellm-model-group`, `x-litellm-model-name` (= deployment model string `cloudflare/@cf/…`), `x-litellm-call-id`, `x-litellm-version`, `x-litellm-key-spend`, `x-litellm-key-rpm-limit`, `x-litellm-response-duration-ms`, `-overhead-duration-ms`, `-callback-duration-ms`, `x-litellm-attempted-{retries,fallbacks}`, and the full cost set (`x-litellm-response-cost` **present and non-zero**, plus `-input`, `-output`, `-cache-read`, `-original`, `-margin-amount`, `-margin-percent`, `-discount-amount`, `-tool-usage`). **On a stream the total is absent while the component headers are present as `0.0`** — the reverse of Task 1 (g): never read `x-litellm-response-cost` on streams; use `usage.cost` from the final chunk, then the catalog. `x-litellm-model-api-base` was **not** emitted at all. A caller-supplied `x-litellm-call-id` is echoed verbatim (also on errors); a 400-char value is replaced by a generated UUID. 429s carry `Retry-After: 60`.
    - **Cost and pricing placement (correction to Task 1).** Pricing in `model_info` gave `spend: 0.0` and no cost header. Pricing in **`litellm_params`** (`input_cost_per_token`/`output_cost_per_token`) gave `spend: 0.000202`, a non-zero cost header, and cost attributes on the OTel span. Task 5's priced deployment and Task 7's guard must use `litellm_params`. `/model/info` **echoes those values back to any key that can read the model**, which is fine for a fake price but must not carry a real secret.
    - **Params (`drop_params` off, then on).** Off: `prompt_cache_key`, `prompt_cache_retention`, `top_logprobs`+`logprobs`, `response_format`, `seed`, `parallel_tool_calls` all 200; `reasoning_effort` → 400 `UnsupportedParamsError`; `stream_options` **on a non-stream request** → 400 from the backend (`Stream options can only be defined when stream=True`) and it **survives `drop_params: true`** because the param is supported and only the combination is illegal. Prism must never send `stream_options` unless `stream: true`. `drop_params: true` belongs in `free-pool.yaml`.
    - **Cache, general policy.** Three identical 4 844-prompt-token turns on one deployment: `cached_tokens: 0` three times, identical cost — Workers AI exposed **no** cache read and no saving. No markers were sent, so no context-cache resource was created. Task 7's cache leg must assert that absence (0/null) is tolerated rather than expect a hit, and the README must not promise cache savings on free hosts.
    - **Errors, measured bodies.** Invalid key → **401** `type: token_not_found_in_db`, `param: "key"`, hashed key inside the message. Unknown group → **400** object (`type: invalid_request_error`, message `/chat/completions: Invalid model name passed in model=… Call `/v1/models`…`, `provider_specific_fields.error`) — an object, not the string Task 1 (4) predicted. Budget exceeded → **422** (not 429) `type: budget_exceeded`, `Budget has been exceeded! Key=<alias> (sk-...xxxx) Current cost: … Max budget: …`. Key-rpm exceeded → **429** `type: throttling_error` + `Retry-After: 60`, and the message **leaks the key hash** — Task 4's error surface must not pass it through verbatim. Cooldown → **429** `type: all_deployments_in_cooldown` (seen organically on the earlier config). Context overflow → **413** (`type: invalid_request_error`, `code: "413"`) with `litellm.BadRequestError: CloudflareException - … exceeded this model context window limit (24000) …`, phrase **`context window limit`**, no `ContextWindowExceededError` token — plan 194's regex does **not** match it, so Task 2's `litellmHttpError` normalisation is required, not optional. A 36 MB body was **not** rejected by either proxy hop (it reached the backend and became the overflow), so Prism's own 413/`CONTENT_TOO_LARGE` has no proxy-side source.
    - **Spend logs.** Row visibility measured **4.0 s** and **11.8 s** after the response (poll 0.5 s) — 5 s flush plus the staggered `update_spend_job`; Task 3's `waitMs` default ≈15 s, cap 60 s. A role-less virtual key is **refused** on both `/spend/logs` and `/spend/logs/v2` (401 `auth_error`, `Your role=unknown`), so Task 1 (5) is wrong at the route level, and `user_role` on `/key/generate` is **ignored**. Working recipe: `/user/new {user_id, user_role:"internal_user"}` then `/key/generate {user_id}` — verified scoped (A saw exactly its own single row, B only B's) on v2 **and** legacy. v2 needs both dates (400 `bad_request` otherwise), returns `{data,total,page,page_size,total_pages,total_is_capped}`, pages are disjoint, and the `request_id` filter matches **either** `request_id` or `litellm_call_id`. On a success row `request_id` is the **upstream** id (`gen-…`, `id-…`) while `litellm_call_id` is the header value → **Task 3 reconciles on `litellm_call_id`**. Row (success, priced): `call_type: "acompletion"`, `model`, `model_group`, `model_id: "priced-1"`, `custom_llm_provider`, `spend: 0.000202`, `total_tokens`, `cache_read_input_tokens: null`, `status: "success"`, `metadata.usage_object` (with `neurons`), `metadata.cost_breakdown`, `metadata.user_api_key`, `request_tags`, `cache_hit`, `cache_key`, `requester_ip_address`, `request_duration_ms`, `end_user`, `session_id`, and **`api_base` carrying the Cloudflare account id in the URL path**. No `messages`/`response`/`proxy_server_request`. Task 3 must strip `api_base` and `user_api_key` when reporting a row.
    - **Budget guard is not fail-closed (affects Tasks 5 and 7).** A key with `max_budget: 0.00001` completed a priced call that took it to `0.000202` — 20× over — because the pre-call check reads **cached** spend; the next call 16 s later was blocked with **422 `budget_exceeded`** and stayed blocked. Enforcement lags one flush and **overshoot inside that window is unbounded**; Task 5's guard must be described as bounded by request count and rpm, not as a hard cost ceiling, and Task 7 must not assert immediate refusal. A truly free (unpriced) deployment never trips the budget at all (Workers AI catalog pricing accrued `1.76e-05`; an OpenRouter `:free` model accrued `0.0`), so the fail-closed leg needs Task 5's priced deployment.
    - **Deployment `rpm` in `litellm_params` is not a hard limiter here** — three back-to-back calls to a `rpm: 1` deployment all returned 200; every 429 seen was key-level. Forcing "no deployments available" needs real upstream 429s (cooldown).
    - **Trace nesting: confirmed on failure and on success.** `callbacks: ["otel"]` + `OTEL_EXPORTER=console`: an inbound `00-<trace>-<span>-01` produced root span `Received Proxy Server Request` with **that trace id and that parent span id**, `trace_state` preserved, children `auth`, `proxy_pre_call`, `router`, `self`, `litellm_request` (`USE_OTEL_LITELLM_REQUEST_SPAN=true`) and `raw_gen_ai_request`. `litellm_request` carries `gen_ai.request.model` = **group**, `litellm.model_group`, `litellm.provider.model` = deployment, `gen_ai.cost.{input,output,total}_cost`, `metadata.usage_object`. The call id appears in no span attribute, so Task 4's correlation must come from the header (or `metadata.litellm_call_id`) — spans cannot supply it.
    - **Pool behaviour.** Mixed group (two models, one name): `mixed-oss` 9× / `mixed-llama` 1× before the key's rpm cut in, `x-litellm-model-name` tracking the deployment. Identity group (same model string twice): `ident-a` 4× / `ident-b` 1× then 429. Single group: one id. Non-sticky, as assumed; a clean 10-call spread per group belongs to Task 7.
    - **`/model/info`.** 200 with a virtual key, one row per deployment, `litellm_params.api_key` **absent entirely**, key-like fields masked, `model_info` carrying `id`, pricing and capability flags. A key minted with `models: ["prism-free/mixed"]` sees only that group. `model_info.key`/`litellm_params.model` expose the upstream model string and pricing values are echoed.
    - **Full free-model matrix (all 39 Workers AI text-generation models, one group each, probed 2026-10-31).** `ok` = 200, a number = HTTP status. `stream` = stream + `stream_options.include_usage` + `[DONE]`; `follow-up` = tool call replayed with its result; `image` only attempted on models that declare vision; `stream usage.cost` = whether the final SSE chunk carried `usage.cost`.

| model | text | stream | tools | follow-up | reasoning | json | image | reasoning_content | stream usage.cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@cf/openai/gpt-oss-120b` | ok | ok | ok | 400 | ok | ok | – | yes | yes |
| `@cf/google/gemma-2b-it-lora` | ok | ok | ok | – | ok | ok | – | no | – |
| `@cf/meta/llama-3.2-3b-instruct` | ok | ok | ok | 400 | ok | ok | – | no | yes |
| `@cf/meta/llama-guard-3-8b` | ok | 400 | 400 | – | ok | 500 | – | no | – |
| `@cf/mistral/mistral-7b-instruct-v0.2-lora` | ok | ok | 400 | – | ok | ok | – | no | – |
| `@cf/moonshotai/kimi-k2.7-code` | 403 | 403 | 403 | – | 403 | 403 | 403 | no | – |
| `@cf/zai-org/glm-5.3` | 403 | 403 | 403 | – | 403 | 403 | – | no | – |
| `@cf/utter-project/eurollm-9b-it` | 400 | 400 | 400 | – | 400 | 400 | – | no | – |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | ok | ok | ok | – | ok | ok | – | no | yes |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | ok | ok | ok | 400 | ok | ok | – | no | yes |
| `@cf/zai-org/glm-5.3-flash` | 403 | 403 | 403 | – | 403 | 403 | 403 | no | – |
| `@cf/meta/llama-3.2-1b-instruct` | ok | ok | ok | 400 | ok | ok | – | no | yes |
| `@cf/moonshotai/kimi-k2.6` | 403 | 403 | 403 | – | 403 | 403 | 403 | no | – |
| `@cf/cloudflare/clef` | 400 | 400 | 400 | – | 400 | 400 | 400 | no | – |
| `@cf/zai-org/glm-4.7-flash` | ok | ok | ok | – | ok | ok | – | yes | yes |
| `@cf/meta-llama/llama-2-7b-chat-hf-lora` | ok | ok | ok | – | ok | ok | – | no | – |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | ok | ok | ok | 400 | ok | ok | – | no | yes |
| `@cf/ibm-granite/granite-4.0-h-micro` | ok | ok | ok | 400 | ok | ok | – | no | yes |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | 403 | 403 | 403 | – | 403 | 403 | – | no | – |
| `@cf/cloudflare/clairic` | 400 | 400 | 400 | – | 400 | 400 | 400 | no | – |
| `@cf/swiss-ai/apertus-v1.5-8b` | 403 | 403 | 403 | – | 403 | 403 | 403 | no | – |
| `@cf/cloudflare/clef-omni` | 400 | 400 | 400 | – | 400 | 400 | 400 | no | – |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | ok | ok | ok | – | 500 | ok | – | no | – |
| `@cf/zai-org/glm-5.2` | 403 | 403 | 403 | – | 403 | 403 | – | no | – |
| `@cf/nvidia/nemotron-3-120b-a12b` | ok | ok | ok | ok | ok | ok | – | yes | yes |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | ok | ok | 400 | – | ok | ok | – | no | yes |
| `@cf/qwen/qwen3-30b-a3b-fp8` | ok | ok | ok | – | ok | ok | – | yes | yes |
| `@cf/google/gemma-7b-it-lora` | ok | ok | ok | – | ok | ok | – | no | – |
| `@cf/google/gemma-4-26b-a4b-it` | ok | ok | ok | ok | ok | ok | 400 | yes | yes |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | ok | ok | ok | ok | ok | ok | ok | no | yes |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | 403 | 403 | 403 | – | 403 | 403 | – | no | – |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 403 | 403 | 403 | – | 403 | 403 | 403 | no | – |
| `@cf/daily-co/phonellm-mini-alpha-2` | ok | ok | ok | ok | ok | ok | – | no | – |
| `@cf/qwen/qwen3.8-27b` | ok | ok | ok | ok | ok | ok | ok | yes | – |
| `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | 403 | 403 | 403 | – | 403 | 403 | 403 | no | – |
| `@cf/openai/gpt-oss-20b` | ok | ok | ok | 400 | ok | ok | – | yes | yes |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | ok | ok | ok | ok | ok | ok | ok | no | yes |
| `@cf/cloudflare/clef-flash` | 400 | 400 | 400 | – | 400 | 400 | 400 | no | – |
| `@cf/qwen/qwq-32b` | ok | ok | ok | – | ok | ok | – | no | yes |

    - **What the matrix decides.** Three exclusion classes, all found by probe, none of them documented as such: **paid-plan only (403)** — `Model <id> is not available on the Workers Free plan: … Upgrade to access this model`, covering `kimi-k2.7-code`, `kimi-k2.6`, `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813`, `deepseek-v4.1-flash-1017`, `apertus-v1.5-8b`, `llama-3.2-11b-vision` (10 models, listed by the catalog but unusable on the free plan — a pool generator must not trust the catalog alone); **not a chat model (400)** — `clef`, `clef-flash`, `clef-omni`, `clairic` (`required properties at '/' are 'model,state,questions'`, an audio/omni assistant shape) and `eurollm-9b-it` (`AI model does not have config`); **classifier (400/500 on stream and tools)** — `llama-guard-3-8b`. Of the 24 remaining, only these answered **every leg they declare**: `nemotron-3-120b-a12b`, `qwen3.8-27b`, `llama-4-scout-17b-16e-instruct`, `mistral-small-3.1-24b-instruct`, `gemma-4-26b-a4b-it` (image 400 despite declaring vision), `phonellm-mini-alpha-2`, plus the weaker `glm-4.7-flash`, `qwen3-30b-a3b-fp8`, `gemma-*-lora`, `llama-2-7b-lora`, `qwq-32b`, `deepseek-r1-distill` which never emitted a tool call in the follow-up probe. Tool-result replay is the discriminator: `gpt-oss-120b/-20b`, `llama-3.2-*`, `llama-3.1-8b`, `llama-3.3-70b`, `granite-4.0-h-micro` all fail it. **`stream usage.cost` is per-model** — absent for the LoRA models, `qwen2.5-coder`, `qwen3.8-27b` and `phonellm`, present for the rest — so the stream cost source must fall back to the catalog rather than assume the chunk has it. `reasoning_content` appears on `gpt-oss-120b/-20b`, `glm-4.7-flash`, `nemotron-3`, `qwen3-30b`, `gemma-4-26b`, `qwen3.8-27b` only; `cached_tokens` was 0 in every stream and non-stream response across all 39 models.
    - **Verified final pool config** (`/tmp/litellm-probe/config-pool-final.yaml`, the shape Task 5 should carry): `prism-free/chat` = nemotron-3-120b + qwen3.8-27b + llama-4-scout + mistral-small-3.1; `prism-free/identity` = qwen3.8-27b twice; `prism-free/vision` = llama-4-scout; `prism-free/reasoning` = nemotron-3; `prism-free/cheap` = llama-3.2-1b; `prism-free/priced` = qwen3.8-27b with `litellm_params` pricing; `prism-free/slow` = gpt-oss-20b with `rpm: 1`. Re-verified through the wire proxy: text 200 (`chat-mistral`, cost header `6.081e-06`), stream 200 with `[DONE]` and a usage chunk but **no total cost header**, tool call 200 (`chat-nemotron`), tool-result replay 200, vision 200, reasoning 200 (content `null` + `reasoning_content`), JSON object mode 200, priced call 200 (`x-litellm-response-cost: 0.000156`, row `spend: 0.000156`, `status: success`, no `messages`/`response` columns, `api_base` present). `drop_params: true` is what keeps `reasoning_effort` from failing this mixed set.
    - **Waived, not measured:** signed-thinking tool loop on an Anthropic-family backend (needs an owner-approved paid leg) and the same-model-on-two-hosts pair (needs Groq or NVIDIA NIM keys; the free plan here is one host). Both are recorded as unproven, Tasks 2/6 stay on single-host evidence, and no plan text may claim them.

- [x] Task 2: `@arnilo/prism-provider-litellm` — Chat route, discovery, header telemetry, call id, general cache policy, errors
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`). Config:

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `apiKey` | ref | `env:LITELLM_API_KEY` | `secretRefProperty`. A proxy without `master_key` needs no key; then no `Authorization` header is sent |
        | `baseUrl` | string | `http://127.0.0.1:4000` | `baseUrlProperty`. `http:` is accepted only for loopback hosts (`127.0.0.0/8`, `::1`, `localhost`); any other `http:` host fails closed at config time |
        | `models` | ModelConfig[] | — | when absent, `models()` reads `/model/info` (fallback `/v1/models`) |

        Factory-only options: `id` (default `litellm`) and `fetch`.

        When `apiKey` does not resolve, the package emits an `info` note ("litellm: no key at env:LITELLM_API_KEY; requests are sent without Authorization") and still registers. A proxy with auth then answers 401, which is mapped below.
      - **Route** (`createRoutedProvider`, one route `chat`): `openai-chat` on `/chat/completions`, bearer. Codec:
        - `reasoningReplay: "reasoning_content"`, or `"drop"` for groups that Task 1b showed reject unsigned replay;
        - `imageInput: "capability-gated"`;
        - `reasoningEffort` passed through;
        - `transformBody` strips `prompt_cache_key` and `prompt_cache_retention` (copied as values from OpenRouter, `packages/providers/openrouter/src/provider.ts:93-95`, and named in a comment), unless Task 1b showed LiteLLM drops them itself.
      - **General cache policy** (no parity claim):
        - no `cache_control` markers by default;
        - a model whose `compat.cacheControl === "anthropic-blocks"` (set by the host in `models`, or never by discovery) goes to a second route with `cacheControl: "anthropic-blocks"`, as OpenRouter's `blocks` route does (`openrouter/src/provider.ts:107-108`);
        - the prefix (system, tools, and earlier messages) is byte-identical across turns;
        - every reported cache field maps to `cacheReadTokens` and `cacheWriteTokens`.

        The README documents proxy-side checkpoint injection (Task 1 (d)'s key) as the operator's way to get Anthropic-style caching without client markers, and the Gemini/Vertex side effect Task 1b recorded.
      - **Call id and header telemetry** (package-local seam, per Task 1 (a)):
        - The provider's `generate` wrapper mints `callId = crypto.randomUUID()` and passes it in `request.metadata`.
        - The route's `headers` sets `x-litellm-call-id` from it, as a provider-owned header that a caller cannot override.
        - The provider's `fetch` wrapper reads that request header and, on the response, records the `x-litellm-*` headers in a map keyed by `callId`.
        - The `generate` wrapper merges `usage.metadata.litellm = { callId, modelId, modelGroup, apiBase?, version?, responseCost? }` into the `usage` and `done` events, and deletes the map entry in `finally`.
        - `apiBase` is reduced to its origin (no path or query).
        - An `error` event's message names the `callId`, so a failed request can be found in spend logs.
      - **Cost:** `Usage.cost` (USD) comes from `x-litellm-response-cost` when it is present, finite, and ≥ 0. Otherwise it is left undefined, and the kernel prices from the catalog's `ModelConfig.cost` as it does for every provider. A header value of `0` is recorded as `cost: 0`, never dropped.
      - **Errors** (`litellmHttpError`, always through `providerHttpError` so the class comes from `classifyProviderFailure`), using the statuses and bodies Task 1b recorded:
        - invalid key → `auth`, with a hint naming the ref;
        - unknown model group → `permanent`, naming the group and `/model/info`;
        - budget exceeded → not retried, with the hint "the LiteLLM key's budget is spent";
        - no deployments available / cooldown → `rate_limited` with `Retry-After` when sent;
        - relayed backend 429 → `rate_limited`;
        - 5xx → `transient`;
        - context-window exceeded → `context_overflow` (plan 194). If the body does not match `CONTEXT_OVERFLOW_BODY`, add the vendor-neutral phrase and the body to `overflow_classified_per_supported_route` (`src/__tests__/context-overflow-recovery.test.ts`).

        Mid-stream error frames surface as a provider error, never as a silent `end_turn`.
      - **Catalog:** `listLiteLLMModels` reads `/model/info` once and groups rows by `model_name`. Per group:
        - `contextWindow` and `maxOutputTokens` are the **minimum** across the group's deployments;
        - `tools`, `reasoning`, and image input are claimed only if **every** deployment supports them;
        - `cost` per 1M = the **maximum** per-token cost × 1e6. Unknown cost stays undefined, never zero;
        - `compat.deployments` = the count;
        - `compat.litellmProviders` = the sorted distinct `litellm_provider` values.

        Wildcard groups (`*`) are skipped with a README note. If `/model/info` is refused (403), the fallback is `/v1/models` with ids only and no capabilities claimed.
      - **Recordings** under `src/__tests__/wire/chat/`: `text`, `tool-loop`, `thinking`, `structured-output`, `image`, `cache` (3 turns, no markers), `cache-blocks` (if Task 1b recorded one), the headers per exchange, and the error set. `wire/README.md` records provenance (proxy version and digest, backend, date).
      - `providerConformance({ recordings })` passes offline. `live.test.ts` runs `runProviderLiveScenarios` on `PRISM_LIVE_LITELLM_MODEL` (default `prism-free/<pinned group>`), skipping with a reason when `LITELLM_API_KEY` is absent or the proxy at `PRISM_LIVE_LITELLM_BASE_URL` (default `http://127.0.0.1:4000`) does not answer `/health/liveliness`.
    - Performance:
      - Importing the package evaluates no sibling provider.
      - Discovery is one request.
      - The header seam adds one map entry per in-flight request and no extra request.
      - The README states that per-request cost is $0 on the free pool and is otherwise whatever the proxy's backends charge. It also states that the opt-in `cacheControl` route adds no request but may create backend cache resources (with Task 1b's Gemini/Vertex finding).
    - Code Quality:
      - Follows the shape of `packages/providers/openrouter`. `groupLiteLLMModelInfo` (catalog) and `readLiteLLMHeaders` (headers → metadata) are pure functions with tests.
      - No sibling import. Every value copied from OpenRouter is named in a comment with its source.
      - The Task 1 (b) enforcement rows are updated in this task, and counts are regenerated, not hand-edited.
      - New baseline `scripts/compat-baseline/arnilo__prism-provider-litellm.txt` via `timeout 1800 bun scripts/release.mjs gate --update-baseline`, with the diff in the task note (additions only, attributed to this plan).
    - Security:
      - `apiKey` is ref-only. A literal secret is refused by `secretRefProperty`.
      - A non-loopback `http:` `baseUrl` fails closed (`ERR_LITELLM_INSECURE_BASE_URL`), so a key is never sent in clear text off the machine.
      - Caller headers cannot override `authorization` or `x-litellm-call-id`.
      - The key never appears in events, errors, `inspect()`, recordings, or `usage.metadata`.
      - `usage.metadata.litellm` holds scalars only: no request or response bodies, no full `api_base` path. Hosts drop or hash fields through observability `fieldPolicy`.
      - Response headers are read with length caps (each value ≤ 256 bytes; a longer value is dropped). `x-litellm-response-cost` is parsed as a finite non-negative number or ignored.
  - Approach:
    - Documentation Reviewed:
      - Task 1 and 1b Notes; `packages/providers/openrouter/src/{provider,models,index}.ts`; `src/provider-kit/routed-provider.ts`; `docs/provider-kit.md` "Shipping a provider".
    - Options Considered:
      - A provider-kit route hook (`onResponse(response) → Usage metadata`). Rejected unless Task 1 (a) finds a second provider needing response headers for usage. Otherwise it is a kernel-adjacent addition with one user (§1). It is a Further Actions candidate if Kilo's `gateway-metadata` or another gateway needs it.
      - Reading the call id from the response header instead of minting it. Rejected: a request that fails before any response, or a stream cut mid-way, still needs an id to find in spend logs.
      - Markers on by default for backends that `/model/info` says support prompt caching. Rejected for 0.13.0: it is per-backend behaviour (Gemini context caches cost money, OpenAI GPT-5.6+ is remapped). The owner deferred that to post-0.13.0 cache parity.
      - Treating the group's first deployment as the group's capabilities. Rejected: a load-balanced call can land on any deployment, so only the most conservative claim is safe.
    - Chosen Approach:
      - One Chat route, a conservative per-group catalog, a package-local header seam with a Prism-minted call id, and a marker-free default with per-model opt-in.
    - API Notes and Examples:
      ```ts
      import { litellm } from "@arnilo/prism-provider-litellm";
      const agent = await createAgent({ model: "litellm/prism-free/smoke", packages: [litellm()] });
      // usage event: { cost: 0, metadata: { litellm: { callId, modelId, modelGroup: "prism-free/smoke", version } } }
      ```
      ```jsonc
      // manifest
      { "name": "@arnilo/prism-provider-litellm", "config": { "apiKey": "env:LITELLM_API_KEY", "baseUrl": "http://127.0.0.1:4000" } }
      ```
    - Files to Create/Edit:
      - `packages/providers/litellm/{package.json, README.md, CHANGELOG.md, LICENSE, bunfig.toml, tsconfig.json}` (copied from `openrouter`).
      - `packages/providers/litellm/src/{index,provider,models,headers}.ts` and `src/__tests__/{litellm.test.ts, package.test.ts, live.test.ts, overflow-session.ts, wire/**}`.
      - The Task 1 (b) enforcement-row files, `scripts/compat-baseline/arnilo__prism-provider-litellm.txt`, `bun.lock`, `CHANGELOG.md`.
      - Tentative (only if Task 1 (d) finds the overflow body unmatched): `src/provider-kit/transport.ts`, `src/__tests__/context-overflow-recovery.test.ts`.
    - References:
      - plans 203 Task 4, 213 Task 2.
  - Test Cases to Write:
    - `litellm_package_conformance_chat`: recorded exchanges pass `providerConformance`. Fails if a codec option or the path is wrong.
    - `litellm_call_id_owned_and_minted`: each request carries a fresh UUID `x-litellm-call-id`, and a caller's value loses. Fails if the id moves to caller headers or is reused.
    - `litellm_headers_into_usage_metadata`: recorded headers become `usage.metadata.litellm` on `usage` and `done`, `apiBase` is reduced to its origin, and oversized values are dropped. Fails if headers are lost or full paths leak.
    - `litellm_concurrent_calls_keep_metadata_apart`: two interleaved streams get their own `callId` and `modelId`, and the map is empty afterwards. Fails if the seam keys by anything but the call id.
    - `litellm_cost_from_header_or_catalog`: header `0.0000285` → `cost`; header `0` → `cost: 0`; no header → undefined (the catalog prices it); a negative or non-numeric value is ignored.
    - `litellm_no_markers_by_default`: the default route body has no `cache_control`, and the prefix is byte-identical across the 3-turn fixture. Fails if markers appear or the prefix moves.
    - `litellm_cache_blocks_opt_in`: `compat.cacheControl: "anthropic-blocks"` selects the blocks route, and markers appear.
    - `litellm_strips_unsupported_cache_params`: `prompt_cache_key` and `prompt_cache_retention` are absent (unless Task 1b reversed it).
    - `litellm_usage_cache_fields`: `cached_tokens` and `cache_creation_input_tokens` map; absent fields stay undefined.
    - `litellm_error_mapping`: each recorded status and body maps to its class and hint. Budget exceeded is not retried. The error message names the call id.
    - `litellm_overflow_classified_and_recovered`: the recorded body classifies `context_overflow`, and a session on a replaying mock compacts once and retries once.
    - `group_litellm_model_info_conservative`: two deployments with different windows, tools, and costs → minimum window, tools only if both support them, maximum cost, deployment count, provider list; wildcard rows skipped; unknown cost undefined.
    - `litellm_rejects_insecure_remote_base_url`: `http://proxy.example:4000` → `ERR_LITELLM_INSECURE_BASE_URL`; `http://127.0.0.1:4000` and `https://proxy.example` are accepted.
    - `litellm_missing_key_notes_and_registers`: the `info` note, no `Authorization` header, provider registered.
    - `litellm_secret_never_leaks`: the key is absent from events, errors, `inspect()`, and `usage.metadata`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new provider package).
    - Docs pages to create/edit:
      - `packages/providers/litellm/README.md` (package page structure), with sections:
        - "Running a proxy": pinned image, the loopback rule, the key;
        - "Models and discovery": groups and the conservative claims;
        - "Telemetry": `usage.metadata.litellm`, the call id, cost source order;
        - "Prompt caching": the general policy, operator-side injection, the opt-in route, the Gemini/Vertex note, and "no parity claim; per-backend parity is planned after 0.13.0";
        - "Reasoning": the replay mode per backend family;
        - "Errors";
        - "Cost".
      - `docs/models.md` (provider table and count), `docs/release.md` (regenerated block), `docs/live-testing.md` (regenerated), `packages/providers/README.md` (shipped list), `CHANGELOG.md` under `## [Unreleased]`.
    - `docs/index.md` update: yes. "`@arnilo/prism-provider-litellm`: any model behind a LiteLLM Proxy, with per-call LiteLLM telemetry and spend-log reconciliation."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes:
    - **Status (2026-10-31): complete.** Package, fixtures, tests, docs, counts and baseline landed; the live suite passes against the pinned proxy. 90 tests in the touched surface pass (`packages/providers/litellm/src` 25, docs 65), typecheck is clean, and the three-turn offline cache replay plus the live tool loop both ran green.
    - **Package.** `packages/providers/litellm` (manifest, `bunfig.toml`, `tsconfig.json`, LICENSE, README, CHANGELOG) on `@arnilo/prism/provider-kit` only, no sibling import. `src/{index,provider,models,headers}.ts`; `headers.ts` holds the pure header→telemetry reader, `models.ts` the pure conservative grouper, `provider.ts` the route, the error mapper and the call-id seam.
    - **Call id and header seam (measured, not assumed).** The shared route API exposes no response headers and `mapUsage` sees only `(usage, chunk)`, so `createLiteLLMProvider` mints `crypto.randomUUID()` into `request.metadata.litellmCallId`, `route.headers` copies it to `x-litellm-call-id` (through `applyOwned`, so a caller value loses), the wrapped `fetch` reads that request header and stores `readLiteLLMHeaders(response.headers, callId)` in a `Map`, and the `generate` wrapper merges it into `usage.metadata.litellm` on the `usage` and `done` events, then deletes the entry in `finally`. Error messages end in `(litellm call id <uuid>)`. One entry per in-flight call, zero extra requests.
    - **Header facts confirmed live and in source.** `x-litellm-model-group` exists (router-side) and is preferred over `x-litellm-model-name`, which is the full deployment model string; `x-litellm-model-api-base` is reduced to its origin (the header carries the upstream URL, which can name private infrastructure); values over 256 bytes are dropped, not truncated; `x-litellm-response-cost` is parsed as finite ≥ 0 with `0` kept. **A streamed response carries no total cost header** — only `x-litellm-response-cost-*` component headers at `0.0` — which matches Task 1b, so stream cost falls back to the catalog unless the usage chunk carries `usage.cost`.
    - **Discovery.** `GET /model/info` groups by `model_name`; window and output are the group minimum, `tools`/`reasoning`/`structuredOutput`/image are claimed only when every deployment's flag is `true` (a `null` flag is not a claim), cost is the group maximum per 1M, and `compat` carries `deployments` and the sorted `litellmProviders`. `*` and non-`chat` groups are skipped. 401/403 falls back to `/v1/models` ids only, with no capability or cost claimed. The measured fixture shows why conservatism matters here: the free pool reports `supports_vision: null` on a model that *does* accept an image, so only an explicit `models` entry can claim it (`package.test.ts` does exactly that for the image scenario).
    - **Route body.** `reasoningReplay: "reasoning_content"`, `imageInput: "capability-gated"`, `reasoning_effort` passed through, and `prompt_cache_key`/`prompt_cache_retention` stripped. Task 1b measured that the proxy *accepts* both fields; they are still stripped because the backends behind it mostly drop them and leaving them in implies a client-side lever the pool does not have. No `cache_control` markers on the default route; `compat.cacheControl: "anthropic-blocks"` selects the second route (same path, markers on prefix and tools).
    - **Errors.** `litellmHttpError` always returns through `providerHttpError`: 401 → `auth` with the ref named; 400 `Invalid model name` → `permanent` naming `/model/info`; 422 `Budget` → `permanent` ("budget is spent", never retried); 403 → `auth`; 429 → `rate_limited` with `Retry-After` when sent; 5xx → `transient`; 413 with `context window limit` rewritten to `maximum context length` so the shared classifier returns `context_overflow` (no kernel change, no plan-194 test change). Key fingerprints and `Key Hash (Token)` values are redacted from every body before it leaves the package (a 429 prints the hash; measured).
    - **Fixtures** (`src/__tests__/wire/chat/`, provenance in `wire/README.md`): raw SSE captures for `text`, `stream`, `tool-loop` (call + tool result), `thinking`, `image`, `cache` (three turns over one 21 kB prefix), and raw JSON for `error-{unauthorized,unknown-model,budget,rate-limit,cooldown,overflow}`; `wire/model-info.json` is a trimmed `/model/info` capture. All headers are the real `x-litellm-*` values from those captures.
    - **Deviation from the acceptance list:** no `structured-output` fixture. The pool reports `supports_response_schema: null`, so the capability stays unclaimed and a `json_schema` scenario would assert an unmeasured backend; the live suite omits that leg with the same reason and the README says so. `cache-blocks` likewise has no recording: the pool returns `cached_tokens: 0` on every turn, so the opt-in route is asserted from the captured request body instead, and the README states there is no parity claim.
    - **Live run (2026-10-31, pinned v1.106.6, Workers AI free pool).** `bun test src/__tests__/live.test.ts` with the master key: `text`, `tool-loop`, `abort`, `error` pass (4), `structured-output` and `cache` skip by design. It skips with a reason when `LITELLM_API_KEY` is unset or `/health/liveliness` does not answer.
    - **Finding worth carrying into Task 7:** in the factory options `apiKey` is a `CredentialValueSource`, so a `"env:…"` *string* there is a literal credential value, not a ref (the manifest schema is ref-only and `setup` resolves it through `refSource`). The live suite passes `() => process.env.LITELLM_API_KEY`; the README wording was corrected to say the ref rule applies to manifest config.
    - **Counts and registries.** `bun scripts/package-truth.mjs --emit-docs`: 50 publishable / 49 workspace / 10 provider / 49 codeWithPeer; updated by hand where they are still literals: `scripts/phase24-truth.test.mjs`, `src/__tests__/{release,packaging,install-smoke}.test.ts`, `scripts/phase54-package-map.test.mjs`, `scripts/e2e-coverage.json`, `scripts/coverage-thresholds.json` (lines 95.49 / functions 99.41: measured 98.49 lines and 99.41 functions minus the 3 pp freeze margin), `scripts/live-matrix.json` (+ `docs/live-testing.md` regenerated, suite count 10 → 11), `scripts/deprecations-0.13.json`, `docs/migrate-to-0.13.md`, `packages/providers/README.md`, `docs/index.md`, `docs/models.md`, `CHANGELOG.md` (root and package).
    - **Baseline.** `scripts/compat-baseline/arnilo__prism-provider-litellm.txt` written with `runGates({ updateBaseline: true, packageName: "@arnilo/prism-provider-litellm" })`; the full `release.mjs gate` cannot run on this host because `checkReleaseEvidence` blocks on `PRISM_TEST_POSTGRES_URL`, so the gate was invoked for this package only. Content is additions-only (new file).
    - **Known failures unrelated to this task:** `scripts/phase24-truth.test.mjs` "peer policy Decision B" (`packages/hosts/evals` peers `@arnilo/prism-observability`, the expectation map lacks it) and four `scripts/phase27-release.test.mjs` Plan-027 rows fail identically at `HEAD` in a clean worktree; `scripts/e2e-coverage.test.mjs` names `@arnilo/prism-provider-kilo` as an unannotated surface (plan 213's outstanding registry edit, not litellm's).
    - **Not done here (other tasks):** Task 3 (`litellmSpendLogs`), Task 4 (observability `propagateTraceContext`/`usageMetadata`), Task 5 (`scripts/litellm` pool), Task 6 (roadmap and 184–187 amendments), Task 7 (strict live acceptance). The README's spend-log sentence anticipates Task 3 and is marked as such there, not claimed here.

- [x] Task 3: `/spend/logs` reconciliation — `litellmSpendLogs` and `scripts/litellm/reconcile.mjs`
  - Acceptance Criteria:
    - Functional:
      - `litellmSpendLogs({ baseUrl, apiKey, callIds?, since?, until?, signal, fetch? })` is exported from the package.
        - It queries `/spend/logs` with the filters Task 1b proved: `request_id` per id, or a date range filtered locally by id when there are more than 20 ids.
        - It returns `LiteLLMSpendRow[]`: `{ callId, model, modelGroup, modelId?, spend, promptTokens, completionTokens, cacheReadTokens?, startTime, endTime, status? }`. Fields are normalized from the recorded shape; unknown fields are dropped.
        - It polls for missing ids up to `waitMs` (default from Task 1b's measured write delay ×2, capped at 60 s), then returns what it has, plus `missing: string[]`.
      - `scripts/litellm/reconcile.mjs --report <bench-report.json|usage.jsonl> [--base-url …]` reads the `callId`s and Prism costs from a bench report or usage log, calls `litellmSpendLogs`, and writes a Markdown and JSON table with columns `callId`, `modelId`, `prismCost`, `litellmSpend`, `delta`, plus totals and `missing`. It exits non-zero when `|total delta|` exceeds `--tolerance` (default `1e-6` USD) or any id is missing after the wait.
      - The key is the provider's `apiKey`. A separate `adminKey` ref (`env:LITELLM_MASTER_KEY`) is accepted **only if** Task 1b showed a virtual key cannot read its own rows. The README then says why.
    - Performance:
      - At most `ceil(ids/20)` list requests plus polling. Each response is read bounded (`readBoundedResponseJson`, 4 MiB cap). Pages are capped at 50.
      - The README states the cost: zero model calls, one admin read per batch.
    - Code Quality:
      - In the provider package (vendor wire code). Pure normalizer `normalizeSpendRow` with tests. The script imports the package's public export only.
      - The baseline is regenerated with the diff in the note.
    - Security:
      - The keys are ref-only.
      - Rows are filtered to the requested call ids before being returned or written, so other keys' traffic never lands in evidence even if the key can read it.
      - No prompt or response content is fetched or written. If `/spend/logs` returns `messages` or `response`, those fields are dropped.
      - The `http:` loopback rule from Task 2 applies.
  - Approach:
    - Documentation Reviewed:
      - LiteLLM `proxy/cost_tracking` at the pinned tag; Task 1b's spend-log rows.
    - Options Considered:
      - LiteLLM's generic API callback pushing logs into a Prism endpoint. Rejected: it needs Prism to host a server. The pull is enough for reconciliation, and push is the operator's choice (README).
      - Reconciling inside the provider at request time. Rejected: spend writes are batched, so a per-request read would add latency and requests.
    - Chosen Approach:
      - A bounded, opt-in pull, used after a run.
    - API Notes and Examples:
      ```ts
      const { rows, missing } = await litellmSpendLogs({ baseUrl, apiKey: "env:LITELLM_API_KEY", callIds, signal });
      ```
      ```sh
      timeout 300 bun scripts/litellm/reconcile.mjs --report docs/_evidence/memory-bench/<run>.json
      ```
    - Files to Create/Edit:
      - `packages/providers/litellm/src/{spend-logs.ts, index.ts}`, `src/__tests__/spend-logs.test.ts`, `src/__tests__/wire/spend-logs/*.json`.
      - `scripts/litellm/reconcile.mjs`, `scripts/litellm/reconcile.test.mjs`.
      - `scripts/compat-baseline/arnilo__prism-provider-litellm.txt`, `README.md` ("Spend logs" section), `CHANGELOG.md`.
    - References:
      - Task 2; plan 201 (durable telemetry store, for the shape of cost rows).
  - Test Cases to Write:
    - `spend_logs_by_request_id`: a recorded response normalizes; foreign rows are filtered out.
    - `spend_logs_date_range_for_many_ids`: more than 20 ids use a range query and local filtering; pages stop at the cap.
    - `spend_logs_waits_then_reports_missing`: a fake that returns rows after two polls is satisfied; one that never returns them yields `missing` within `waitMs`.
    - `spend_logs_drops_content_fields`: `messages` and `response` never appear in rows.
    - `spend_logs_bounded_body`: an oversized body throws the bounded-read error.
    - `reconcile_flags_delta_and_missing`: a non-zero exit on a delta over tolerance or a missing id; the table shape.
    - `spend_logs_secret_never_leaks`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (a new export).
    - Docs pages to create/edit:
      - `packages/providers/litellm/README.md` "Spend logs"; `scripts/litellm/README.md` (reconcile usage); `CHANGELOG.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes:
    - **Status (2026-10-31): complete.** `litellmSpendLogs` + `normalizeSpendRow` ship in the package, `scripts/litellm/reconcile.mjs` ships with its own test, docs and CHANGELOG are updated, the compat baseline was regenerated (additions only) and coverage thresholds were recomputed. 42 package tests and 7 script tests pass; the script is registered in `scripts/run-all-tests.mjs` `GATE_FILES` so `bun run test` actually runs it.
    - **Endpoint facts (pinned v1.106.6 source, cross-checked against Task 1b's live probe).** `/spend/logs` takes **one** `request_id` per call and returns a bare array, capped at 10 000 rows; `/spend/logs/v2` returns `{data,total,page,page_size,total_pages}` and needs a date range. Row fields come from `SpendLogsPayload` (`litellm/proxy/_types.py:4346-4380`, written at `spend_tracking_utils.py:794-838`): `request_id, call_type, api_key, cache_hit, startTime, endTime, completionStartTime, model, user, team_id, organization_id, metadata, cache_key, spend, total_tokens, prompt_tokens, completion_tokens, request_tags, end_user, api_base, model_group, model_id, custom_llm_provider, messages, response, proxy_server_request, session_id, request_duration_ms, status, litellm_call_id`.
    - **Deviation from the `ceil(ids/20)` request bound.** That bound is not achievable on this proxy: the legacy endpoint takes a single id per request and v2 has no id-set filter, so reads are ≤20 **indexed single-id** requests (exact, no window, no cross-tenant rows returned) or, above 20 ids, up to 50 pages of 100 rows over a range filtered locally. Both paths are bounded; the note records the real counts rather than the plan's estimate. `since`/`until` default to the last hour when the caller gives neither.
    - **Cache hits.** LiteLLM writes a cache hit under `"{request_id}_cache_hit{epoch}"` to keep the primary key unique (`spend_tracking_utils.py:780-783`), so `callId` prefers `litellm_call_id` and otherwise strips that suffix — a cached call still reconciles. `normalizeSpendRow` covers both paths.
    - **No admin key (the acceptance condition resolved to "not needed").** Task 1b measured that a virtual key reads its own rows on `/spend/logs`, and reads them on `/spend/logs/v2` once its user is an `internal_user`; a key with no owner gets `401` and the error says so. So `adminKey` was not implemented, and the README says why. The package still filters every row to the requested ids before returning, so a key that *can* see other tenants' rows cannot leak them into evidence.
    - **Flush delay and polling.** Measured first visibility was 11.8 s, so `waitMs` defaults to `LITELLM_SPEND_WAIT_MS` = 24 s (2× the measurement) and is clamped to `LITELLM_SPEND_WAIT_CAP_MS` = 60 s. `pollIntervalMs` defaults to 3 s with a **50 ms floor**: without the floor an explicit `0` spins the proxy for the whole window (a test caught ~48 700 requests before the floor existed). Polling re-reads only what is still missing, and the result always reports `missing` instead of implying a clean bill of health.
    - **Normalization is additive by construction.** Rows are rebuilt field by field, so `messages`, `response`, `proxy_server_request`, `api_key`, `api_base`, `metadata`, `cache_key` and `request_tags` can never appear in a returned row or in the reconcile output. `spend` keeps a real `0`; non-finite or negative costs become `0`; `cacheReadTokens` comes from `cache_read_input_tokens` or `prompt_tokens_details.cached_tokens` and stays `undefined` when the row has neither (the pinned row has no cache-read column, so this is future-proofing, stated as such in the fixture README).
    - **`reconcile.mjs`.** Reads `{callId, cost}` pairs from a bench report (JSON list, or a `calls`/`rows`/`usage`/`results`/`records` array) or a `*.jsonl` usage log, accepting `callId|litellmCallId|requestId|id` and `cost|costUsd|usd|prismCost|spend`; duplicates keep the first. Prints the markdown table and writes `<prefix>.md` + `<prefix>.json` with `--out`; exits `0` reconciled, `1` on a delta over `--tolerance` (default `1e-6` USD) or a missing row, `2` on a usage/configuration error. The key is read from `LITELLM_API_KEY` only — there is no flag that accepts a key value, so it cannot reach argv — and the script imports the package's public export, nothing internal.
    - **Tests.** `src/__tests__/spend-logs.test.ts` (17): recorded-row normalization with foreign-row filtering, range paging and the 50-page cap, poll-then-found, poll-then-missing inside `waitMs`, content-field drop with canaries, the 4 MiB bounded read, a 401 fingerprint redaction that names `internal_user`, a 500 body, the no-ids range read, the large-id poll, invalid dates, loopback-only `http:`, a missing key, and the three normalizer cases (minted id over `request_id`, cache-hit suffix, zero cost). `scripts/litellm/reconcile.test.mjs` (7): both report formats, duplicate repair, delta/verdict and table shape, tolerance passing, env-only key plus default `request_id` URL, and two CLI runs — one end to end against a local stub proxy that writes both tables and exits `0`, one that fails closed without a proxy or without a key.
    - **Coverage and gates.** `src/spend-logs.ts` is 100 % lines / 100 % functions; package aggregate 98.92 % lines / 99.58 % functions. `scripts/coverage-thresholds.json` lines moved 95.49 → 95.92 (measured −3 pp margin); functions stayed 99.41 because the measured value already clears it. `scripts/compat-baseline/arnilo__prism-provider-litellm.txt` regenerated with the package-only `runGates({ updateBaseline: true, packageName })` call (the full gate still blocks on `PRISM_TEST_POSTGRES_URL`); the diff is the new export block plus `assertLiteLLMBaseUrl`/`isLoopbackHost` moving to `src/base-url.ts` — same names, same signatures, re-exported from the package root.
    - **Files.** `packages/providers/litellm/src/{spend-logs.ts, base-url.ts, index.ts}`, `src/__tests__/spend-logs.test.ts`, `src/__tests__/wire/spend-logs/{by-request-id,v2-range,content-fields}.json` (+ provenance in `src/__tests__/wire/README.md`), `scripts/litellm/{reconcile.mjs, reconcile.test.mjs, README.md}`, `scripts/run-all-tests.mjs`, `scripts/coverage-thresholds.json`, the package README/CHANGELOG and the root CHANGELOG.
    - **Not done here:** no live `/spend/logs` read was run in this task — the probe stack is torn down and its key shredded, so Task 7 owns the live reconciliation leg (it already has the `--report` example). The fixtures are schema-derived, not captured; the wire README says so rather than implying a capture.

- [x] Task 4: Observability — opt-in trace-context propagation and allow-listed usage metadata on chat spans
  - Acceptance Criteria:
    - Functional:
      - `ObservabilityConfig` (`packages/integrations/observability/src/config.ts`) gains two fields:
        - `propagateTraceContext: boolean` (default `false`). When true, the package registers a `model.request` transform. It injects the active span context (the chat span if open, else the run span, per Task 1 (a)) into `request.options.headers` with `propagation.inject` from the global `@opentelemetry/api`. Only `traceparent` and `tracestate` are written; existing caller values are not overwritten.
        - `usageMetadata: string[]` (default `[]`). These are dotted paths into `Usage.metadata` (for example `litellm.callId`, `openrouter.generationId`, `hyper.usd`). Under `content: "metadata"`, each scalar found is set on the chat span as `prism.usage.<path>`, subject to `fieldPolicy` (drop or hash). Non-scalar values and paths longer than 128 characters are ignored.
      - With `@opentelemetry/api` missing or no propagator registered, propagation is a no-op, and the existing `warn` note covers it (`src/index.ts:146`).
      - This works for every HTTP provider that forwards caller headers. It is not LiteLLM-specific.
    - Performance:
      - Off by default.
      - When on: one header injection per provider attempt, and at most `usageMetadata.length` attributes per chat span.
      - The README states that neither option adds requests or model calls.
    - Code Quality:
      - Inside the observability package only. No kernel change.
      - The config JSON Schema gains both fields with defaults.
      - The baseline `scripts/compat-baseline/arnilo__prism-observability.txt` is regenerated if the exported config type changes, with the diff in the note.
    - Security:
      - Trace context carries no content.
      - `usageMetadata` is an explicit allowlist: nothing is exported by default, and `fieldPolicy` still applies.
      - Message text and tool arguments are never attributes, unchanged.
      - The transform never removes or rewrites `authorization`, and the routed provider strips caller auth headers anyway (`routed-provider.ts:182-194`).
  - Approach:
    - Documentation Reviewed:
      - `packages/integrations/observability/{README.md, src/index.ts, src/config.ts, src/instrumentation.ts:415-450}`; `docs/hooks.md` (`model.request`); the OTel API propagation docs (find-docs for `@opentelemetry/api` at the version in `bun.lock`).
    - Options Considered:
      - Injecting `traceparent` inside the LiteLLM provider. Rejected: the provider has no span context, and every HTTP provider benefits from the same propagation.
      - Mapping `usage.metadata.litellm` to fixed attribute names in observability. Rejected: it names one provider inside a generic package. An allowlist works for all providers.
    - Chosen Approach:
      - Two opt-in, provider-neutral options in the existing package.
    - API Notes and Examples:
      ```ts
      observability({ serviceName: "bench", content: "metadata", propagateTraceContext: true, usageMetadata: ["litellm.callId", "litellm.modelId"] })
      ```
    - Files to Create/Edit:
      - `packages/integrations/observability/src/{config.ts, index.ts, instrumentation.ts}`, `src/__tests__/package.test.ts` (or a new `propagation.test.ts`), `README.md` (Configuration table, a "Joining gateway traces" section with LiteLLM's `otel` callback as the example), `scripts/compat-baseline/arnilo__prism-observability.txt` (if changed), `CHANGELOG.md`.
    - References:
      - Task 1 (a), Task 1b trace-nesting row.
  - Test Cases to Write:
    - `observability_propagates_traceparent_when_enabled`: with an in-memory tracer and the W3C propagator, a provider request carries `traceparent` whose trace id equals the run's. Off by default: no header. Fails if the transform is unregistered or injects when off.
    - `observability_does_not_overwrite_caller_traceparent`.
    - `observability_usage_metadata_allowlist`: allow-listed scalars appear as `prism.usage.*` under `content: "metadata"`; absent under `"none"`; `fieldPolicy` hash applies; non-scalars are ignored.
    - `observability_propagation_noop_without_api`: no throw, and the existing note.
    - The existing `package.test.ts` suite stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (two config fields).
    - Docs pages to create/edit:
      - `packages/integrations/observability/README.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no (scope sentence unchanged).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes:
    - **Status (2026-10-31): complete.** Both fields ship in `@arnilo/prism-observability` with schema defaults, the compat baseline gained five exports (additions only), README and both CHANGELOGs are updated, and the suite is green: 79 tests in the package (71 existing + 8 new), 349 in the docs/truth/packaging gate, typecheck and biome clean.
    - **Where it lives.** A new `src/propagation.ts` holds the pure seam (`formatTraceparent`, `activeTraceSpan`, `injectTraceContext`, `TRACE_CONTEXT_HEADERS`, the API slices); `instrumentation.ts` gained `usageMetadata` and a `rawOpenTelemetrySpan` accessor; `index.ts` wires one `model.request` transform when `propagateTraceContext` is true and switches from `createOpenTelemetryInstrumentation` to `createInstrumentationParts` so it can read the tracker's `active` map. No kernel change, no new dependency, still no socket and no `process.env` (the package's existing `observability_no_phone_home` assertion still passes).
    - **Which span, and why it is not the OTel active context.** The kernel's spans are `PrismSpan` wrappers and the hook dispatch does not put them in an OTel context, so `context.active()` would be empty. `activeTraceSpan(active, runId)` reads the package's own map instead: the most recently opened `provider:<runId>:<turn>:<attempt>` span, else `agent:<runId>`, else `workflow:<runId>`. Task 1 (a)'s ordering is preserved and now observable: the first `model.request` fires before the first chat span opens, so the first header names the run span; retries name their own chat span. The integration test asserts the trace id equals the run span's.
    - **Injection rules.** `propagation.inject` is used when the span is a real wrapped OpenTelemetry span (`rawOpenTelemetrySpan` yields the underlying OTel span) and the API exposes `propagation`; otherwise `traceparent` is formatted from `spanContext()` (this is what makes the seam testable and keeps a stubbed tracer working). Only `traceparent` and a propagator-supplied `tracestate` are written. A caller-set `traceparent` (any case) means no change at all. A throwing propagator degrades to the id fallback rather than failing the run. `authorization` is never read or rewritten — a test keeps a caller header intact.
    - **`usageMetadata`.** Read at `turn.completed` right after the existing usage attributes, gated by `includeUsage` (`content: "metadata"`), so `content: "none"` exports nothing. Each path is walked as objects only: an array, a missing key, or a non-scalar terminal value adds no attribute. Paths over 128 chars are skipped by the instrumentation **and** rejected by the config schema (`items.minLength 1 / maxLength 128 / maxItems 32`), so a host cannot ship one silently; the test covers both layers. Attributes go through `policyAttrs`, so `fieldPolicy.drop`/`hash` apply (the test hashes `prism.usage.*` and checks for `tok_`, with the value absent).
    - **Cost.** One header injection per provider attempt, at most `usageMetadata.length` extra attributes per chat span, zero requests and zero model calls. Both default off.
    - **Deviation/scope:** the transform is registered at default priority and only when `enabled !== false` and the API loaded — with `@opentelemetry/api` absent the existing `warn` note fires and nothing is registered, so propagation is a no-op there (covered by the existing `observability_no_api_is_status_note` test; the new tests cover the propagator-less and throwing-propagator paths instead of re-stubbing a missing module).
    - **Verification.** `observability_propagates_traceparent_when_enabled` (header format, trace id = run span, `tracestate`, only trace headers, `inject` called once per attempt), `observability_propagation_is_off_by_default`, `observability_does_not_overwrite_caller_traceparent` (+ no span → no change), `observability_propagates_without_a_propagator` (+ throwing propagator, + unusable ids, + `authorization` preserved), `observability_usage_metadata_allowlist exports only scalars at allowed paths`, `observability_usage_metadata_respects_content_and_fieldPolicy`, `observability_usage_metadata_ignores_overlong_paths` (schema reject + option skip), `observability_handles_usage_without_metadata`.
    - **Coverage/thresholds.** `src/propagation.ts` 100 % lines / 100 % functions; package aggregate 91.46 % lines / 91.49 % functions, above the recorded 90.68 / 90.36, so `scripts/coverage-thresholds.json` is unchanged. `scripts/compat-baseline/arnilo__prism-observability.txt` was regenerated with the package-only `runGates({ updateBaseline: true, packageName })` (the full gate still blocks on `PRISM_TEST_POSTGRES_URL`); the diff is five added exports and nothing removed.
    - **Docs.** `packages/integrations/observability/README.md` gains both config rows and a "Joining a gateway's traces" section (what is sent, which span, the no-overwrite rule, the LiteLLM `otel` callback pairing, and the cost); package and root CHANGELOGs record it. `docs/index.md` and the wiki are unchanged, as planned.
    - **Registry repair found by the gate run.** `scripts/e2e-coverage.json` had the plan 213 kilo row and the plan 214 litellm row at the manifest's **top level**, outside `packages`, so the gate reported both as unannotated surfaces. `bun scripts/e2e-coverage-gate.mjs --generate` moved both (and picked up kilo's missing `auth`/`cache-levers` suites and litellm's new `spend-logs` one); `scripts/e2e-coverage.test.mjs` now expects 83 surfaces instead of 81. That removes the pre-existing kilo failure Task 2 and Task 3 had to report as unrelated.
    - **Not done here:** no live LiteLLM trace-nesting run — the probe stack is down, so Task 7 owns the end-to-end proof (`traceparent` reaching the proxy, `prism.usage.*` on the chat span, LiteLLM's `Received Proxy Server Request` nesting under it). The measured 1b evidence (`spend-scope`, `otel.log`) is the basis for the README statement.

- [x] Task 5: Free test pool — repo LiteLLM config, launch and stop scripts, budget-capped key
  - Acceptance Criteria:
    - Functional:
      - `scripts/litellm/free-pool.yaml` defines the Task 1 (e) groups:
        - `prism-free/smoke`: mixed models, for wire and integration tests only;
        - one or more `prism-free/<model>` same-model groups across at least two free hosts;
        - `prism-free/<model>@<host>` single-deployment groups.

        Each deployment has `rpm`/`tpm` equal to its dated free quota, `model_info` with `input_cost_per_token: 0` and `output_cost_per_token: 0`, and its key as `os.environ/<NAME>`.

        `router_settings` sets `routing_strategy` (`usage-based-routing` if it holds the quotas better in Task 1b, else `simple-shuffle`), `cooldown_time`, `allowed_fails_policy`, and `num_retries: 0` (the bench owns retries, `run.mjs:196-225`). Background health checks are limited to the pool groups.

        **Fallbacks rule:** `prism-free/smoke` may fall back within free groups. A same-model or single-deployment group has **no** fallback to any other model. This is asserted by a test.

        `litellm_settings.callbacks: ["otel"]` is present but enabled only when `up.mjs --otel <endpoint>` is passed.
      - `scripts/litellm/up.mjs`:
        1. Loads `live.env` (the bench's `loadEnv` rules, `run.mjs:189-194`).
        2. Renders the config into the scratch directory, **keeping only deployments whose key is present**, and drops a group left empty.
        3. Writes a compose file with Task 1's pinned digests: proxy on `127.0.0.1:4000`, Postgres on an internal network only, and a random Postgres password generated per run (mode `0600`).
        4. Starts it with `docker compose` (or `podman compose`), bounded by a timeout.
        5. Waits for `/health/liveliness`.
        6. With `LITELLM_MASTER_KEY`, mints (or rotates) one virtual key limited to the `prism-free/*` models, with `max_budget` 0.01 USD. It prints only the key's alias and the groups served, never the key. The key itself is written to `live.env` as `LITELLM_API_KEY` only with `--write-key`, and only after checking the file's mode is `0600`.
      - `scripts/litellm/down.mjs` stops and removes the containers. `--purge` also removes the Postgres volume.
      - `scripts/litellm/README.md` covers: what the pool is for and what it is **not** for (release evidence stays on Hyper and OpenCode Go); how to add a backend; the quota table with dates and sources; the data-use note (free tiers may train on prompts); and how to refresh quotas.
    - Performance:
      - Startup is bounded (`up.mjs` timeout 180 s).
      - The pool makes no request until a test runs.
      - Health checks are scoped to pool groups at `health_check_interval` ≥ 300 s, so they do not eat free quotas. The README states the cost: one request per group per interval.
    - Code Quality:
      - Node/Bun scripts with no new dependency; YAML is rendered from a JS object, not string-templated.
      - `scripts/litellm/` is dev tooling: it is not in any published `files` list. A test asserts that.
    - Security:
      - Loopback only.
      - No key in the YAML, the compose file, logs, or stdout (`os.environ/` references and `--env-file` from `live.env` only).
      - The virtual key's budget makes any paid call fail closed at the proxy. Task 6 proves it.
      - The rendered files live in the scratch directory, never in the repo.
      - `bun scripts/scan-secrets.mjs` covers `scripts/litellm/`.
  - Approach:
    - Documentation Reviewed:
      - LiteLLM `proxy/configs`, `routing`, `proxy/reliability`, `proxy/health_check_routing` at the pinned tag; Task 1 (e); Task 1b's pool rows.
    - Options Considered:
      - Shipping the pool as a package or a Prism feature. Rejected: it is test infrastructure for this repo, and hosts run their own proxies.
      - One mixed group for everything. Rejected: it repeats the reason `openrouter/free` was withdrawn (a random model per request). Groups are split so that only identity-stable groups can be scored.
      - Running the proxy with `uvx litellm` instead of a container. Rejected: a container pins by digest, which the supply-chain finding requires.
    - Chosen Approach:
      - Repo config plus a rendering launcher, identity-stable groups, and a budget-capped key.
    - API Notes and Examples:
      ```sh
      timeout 240 bun scripts/litellm/up.mjs --write-key
      timeout 60 bun scripts/litellm/down.mjs
      ```
    - Files to Create/Edit:
      - `scripts/litellm/{free-pool.yaml, up.mjs, down.mjs, render.mjs, README.md}`, `scripts/litellm/render.test.mjs`.
      - `scripts/live.env.example` (the `LITELLM_*` and free-backend key names, with comments).
      - `.gitignore` only if a rendered path could land in the tree (expected: no).
    - References:
      - the owner decision of 2026-10-24 (free routing); `scripts/memory-bench/run.mjs:227-231,404`.
  - Test Cases to Write:
    - `render_keeps_only_deployments_with_keys`: missing keys drop deployments, and empty groups are dropped.
    - `render_same_model_groups_have_no_cross_model_fallback`: every non-smoke group's fallback targets are empty or identical-model. Fails if someone adds a cross-model fallback.
    - `render_free_pool_costs_are_zero`: every deployment's `model_info` costs are `0`.
    - `render_emits_no_secret`: rendered YAML and compose contain no value from the env, only `os.environ/` names.
    - `render_binds_loopback_and_pins_digest`: the port binding is `127.0.0.1`, and images use `@sha256:`.
    - `litellm_scripts_not_published`: no published package's `files` includes `scripts/litellm`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (dev tooling).
    - Docs pages to create/edit:
      - `scripts/litellm/README.md`; `docs/live-testing.md` gets a "LiteLLM free pool" paragraph (its generated block comes from `live-matrix.json`; the prose is edited by hand).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes:
    - **Status (2026-10-31): complete, verified live against the pinned `v1.106.6` image.** Files: `scripts/litellm/free-pool.mjs` (the spec as data), `render.mjs` (pure renderer + YAML emitter), `up.mjs`, `down.mjs`, `render.test.mjs`, a new README section, `scripts/live.env.example` block and a `docs/live-testing.md` paragraph. `scripts/litellm/render.test.mjs` is registered in `scripts/run-all-tests.mjs`; 16 tests pass in `scripts/litellm/` (9 render + 7 reconcile), and the docs/plan/run-all/packaging/truth gate run is 402 pass.
    - **Deviation — `free-pool.yaml` is `free-pool.mjs`.** The pool is a JS object (`DEPLOYMENTS`, `ROUTER_SETTINGS`, `IMAGES`) and `render.mjs` emits the YAML, because a committed `.yaml` cannot be asserted on by the six required tests without adding a YAML dependency, and because the acceptance also forbids string-templated YAML. `render.mjs`'s `toYaml` is a structured emitter (maps, lists, list-of-maps, every string double-quoted), not concatenation.
    - **Deviation — JSON is not accepted for `config.yaml`.** Rendering the config as JSON (valid YAML 1.2) made LiteLLM answer `LLM Model List not loaded in` on `/v1/models` and `/model/info`, so `toYaml` exists. Second half of the same trap: the `litellm-database` image's own entrypoint starts the proxy **without** `--config`, which also leaves the model list empty; compose therefore runs `bash /app/docker/entrypoint.sh && exec litellm --config /app/config.yaml --port 4000` (the same command Task 1b's scratch compose used). Both were found by the live run, not by tests.
    - **Deviation — the same-model group is Groq + NVIDIA NIM + Cloudflare, not OpenRouter.** OpenRouter's free catalogue no longer carries `gpt-oss-120b` (checked 2026-10-31; Task 1 (e) listed it as an optional third host), and Cerebras lost its free tier in 2026-09. Cloudflare Workers AI serves `@cf/openai/gpt-oss-120b` and `@cf/openai/gpt-oss-20b` on the **free plan** (measured: both 200 from `api.cloudflare.com/client/v4/accounts/<id>/ai/v1/chat/completions`), so the group has three hosts and one of them is reachable with today's credentials. `servedModel()` normalises `openai/gpt-oss-120b`, `openai/gpt-oss-120b:free` and `@cf/openai/gpt-oss-120b` to `gpt-oss-120b`; that is the identity key the fallback test and Task 5b's served-deployment guard compare.
    - **Live verification (only `CLOUDFLARE_*` present, so 5 groups rendered; Groq/NIM/Gemini reported as skipped):** `up.mjs` started the pool in ~40 s and printed the groups, never the key; `/model/info` 200 with 5 deployments and no `api_key` in the body; `prism-free/smoke` 200 with `x-litellm-model-id: smoke-cloudflare-oss20` and `x-litellm-model-group: prism-free/smoke`; `prism-free/priced` 200 with `x-litellm-response-cost: 0.00018199…` and the same `x-litellm-key-spend`, i.e. the fabricated price registers; a model outside the key's list 403; no key 401; `x-litellm-call-id` echoed.
    - **Spend scoping verified live (this is the Task 3 stop-condition answer):** two users minted with `/user/new` role `internal_user`, one call each. `/spend/logs/v2` for user A returned 2 rows, every row `user: scope-a`; `&request_id=<A's callId>` returned exactly 1 row matching the call id; `&request_id=<random uuid>` returned 0 rows; user B never saw user A's rows. Note the date window is **UTC** — a local-midnight query returns nothing, which cost one debugging cycle.
    - **Bugs the live run caught, all fixed:** a second `up.mjs` failed with 400 `Key with alias 'prism-free-pool' already exists`, so minting now rotates (`/key/delete` by alias, then generate; the acceptance's "mints (or rotates)"); a per-run Postgres password against an existing volume failed Prisma with `P1000 Authentication failed`, so the password is generated once per **volume** and stored in `db-password` (mode 0600, removed by `--purge`); `--write-key` validates the live env file's mode `0600` **before** the pool starts, so a key is never minted for a file we then refuse to write.
    - **Key shape.** `key_alias: prism-free-pool`, `user_id: prism-free-pool`, `user_role: internal_user` (via `/user/new`; a role-less key would read every tenant's spend rows), `models` = the group names that actually rendered (wildcards are not supported — `prism-free/*` minted fine but then failed every call with 400 `Invalid model name`), `max_budget: 0.01` / `30d`. The budget is documented as a tripwire: cached spend, one-call overshoot, refusal arrives as 422 later; `prism-free/priced` exists only so a paid call accrues spend at all.
    - **Fallbacks.** `prism-free/smoke → [prism-free/gpt-oss-20b@groq]` and nothing else; render prunes any fallback whose target group was dropped. Every non-smoke group is single-model, which the test asserts (with a planted cross-model fallback to prove the assertion not vacuous).
    - **Health checks.** `background_health_checks: true`, `health_check_interval: 300`, `background_health_check_model_groups` = rendered groups, `enable_health_check_routing: true`. The README states the cost (one request per group per 5 min) and the routing consequence.
    - **Security.** `127.0.0.1:4000` published, Postgres on an internal network with no published port, images `@sha256:`, scratch dir `~/.cache/prism/litellm-pool` at mode 0700 with files 0600 and `up.mjs` refusing a path inside the repo, credentials as `os.environ/NAME` in the config and `${NAME}` in compose (so nothing is written to disk), `render_emits_no_secret` asserts no env value appears in either rendered file, `litellm_scripts_not_published` walks every workspace `files` list, and `scanSecrets(["scripts/litellm", "scripts/live.env.example", "docs/live-testing.md"])` is 0 findings. `bun scripts/scan-secrets.mjs` over the whole tree still trips on the pre-existing `dist-bin/linux-x64/prism-code` 16 MiB artifact, unchanged by this task.
    - **Quotas and data use** are tabulated in `scripts/litellm/README.md` with sources and dates (Groq 30 RPM/1 000 RPD/8 000 TPM; NVIDIA ~40 RPM → 20; Google 5 RPM/20 RPD; Cloudflare 10 000 neurons/day → 20 RPM/10 000 TPM), plus the note that Google's free tier trains on content, which is why `prism-free/smoke` is wire/integration only.
    - **The free-model list (owner ask, 2026-10-31 evening).** The first pass shipped a six-deployment pool but no inventory of *which* models are free per provider, which is what the owner wanted. Added `scripts/litellm/free-models.mjs` and its generated page `docs/free-models.md`: per provider, the free models from that provider's own catalogue with the criterion used (OpenRouter: zero prompt **and** completion price; Cloudflare: free-plan allowance; Groq/NVIDIA: free-tier quota; Google: Flash family only), the evidence string, and the `prism-free/*` group that already reaches it. No model is called, so a refresh spends no quota, and a provider with no key is listed as **skipped** together with the pool deployments it carries (never omitted, never guessed). Live on 2026-10-31 with only Cloudflare and OpenRouter keyed: 17/416 free on OpenRouter, 39/39 text models on Cloudflare, Groq/NVIDIA/Gemini skipped. `free_models_committed_list_covers_every_pool_deployment` fails when a pool deployment is missing from the committed page, so the list cannot rot silently; 7 tests, no network. Provider ids and pool host names are matched through `sameHost` (`nvidia` ↔ `nvidia_nim`).
    - **Host set decided by the owner (2026-10-31 late): Groq, Mistral, OpenRouter, Cloudflare, Google AI Studio.** Pool additions: `mistral` host (`mistral/mistral-small-latest`, `rpm 30/tpm 250k`, free mode ~1 req/s, phone verification, trains unless disabled) in `prism-free/smoke` and as `prism-free/mistral-small@mistral`; `openrouter` host with `google/gemma-4-26b-a4b-it:free` and `nvidia/nemotron-3.5-lightning:free` (both 262k/1M context, tools, 20 RPM/50 RPD) as `prism-free/gemma-4-26b@openrouter`, `prism-free/nemotron-3.5-lightning@openrouter`, and gemma in smoke. NVIDIA NIM stays in the config but is key-gated and the owner will not fetch a key, so those deployments render only if `NVIDIA_NIM_API_KEY` ever appears.
    - **Health checks now opt out per deployment.** A 5-minute interval is 288 checks/day: fatal for OpenRouter's 50/day and for Gemini's small daily allowance, and the `prism-free/priced` tripwire would accrue fake spend until its own `max_budget` refused it. Deployments carry `healthCheck: false` (Gemini, OpenRouter, priced) and a group is only checked when every deployment in it opts in, so `prism-free/smoke` is unchecked and `prism-free/mistral-small@mistral` / `@cloudflare` groups are checked. `render_quota_is_per_deployment_and_dated` asserts the exclusion list and that the checked set is a proper subset.
    - **Google AI Pro does not change the API free tier.** The subscription is a consumer/app plan (higher AI Studio playground limits); API keys are billed per Cloud project, and the free tier is the project-level allowance that applies while no billing account is linked. So the pool keeps `GEMINI_API_KEY` from a project with no billing — linking billing ends the free tier rather than raising it. Recorded in `scripts/live.env.example` next to the key.
    - **OpenRouter deployments render and route but could not answer on 2026-10-31:** both free pins returned `429 free-models-per-day-high-balance` with `X-RateLimit-Limit: 1000`, `remaining: 0`. `GET /api/v1/key` showed `is_free_tier: false` (i.e. ≥$10 lifetime spend, so the 1 000/day tier) and `usage: 0.06` — the Task 1b/2 probe runs had already spent the day's free-model counter. Reset is 00:00 UTC (`1793491200000`). Recorded in the README as a quota answer, not a config error; a re-run after reset is the only missing proof for those two deployments.
    - **`stripUpstream` had to learn provider prefixes.** With OpenRouter host models (`openrouter/google/…:free`) the committed-list guard compared `openrouter/google/gemma-4-26b-a4b-it` against the catalogue's `google/gemma-4-26b-a4b-it:free`; only LiteLLM *provider* prefixes are stripped now, not vendor ones (`nvidia/`, `google/` stay, or two vendors' models would collide).
    - **Mistral dropped (owner report, 2026-10-31):** its Free mode (Experiment plan) no longer lets an account create API keys without a paid plan, so the host, its two deployments, its `PROVIDERS` entry and its quota row were removed. Documented in the README so the next person does not re-add it.
    - **Three bugs the live run with real keys exposed, all fixed.** (1) `fallbacks` was rendered as a dict-of-lists; LiteLLM 1.106.6 `validate_fallbacks` (`router.py`) demands a **list of single-key dicts** and aborted startup with `Item 'prism-free/smoke' is not a dictionary`. It only surfaced now because a pruned-to-empty map (`{}`) passes iteration either way, and every earlier run had no surviving fallback target — i.e. the smoke fallback had never once been live. Tests now assert one key per entry. (2) Groq deployments used `openai/gpt-oss-120b`, which LiteLLM reads as provider `openai` → `api.openai.com` → `401 Incorrect API key provided: gsk_…`; Groq's ids keep their vendor prefix, so the string is `groq/openai/gpt-oss-120b`. (3) `compose up --wait` on a fresh volume blew the 180 s spawn bound during Prisma's first migration (rootless podman); raised to 420 s.
    - **Live verification, 2026-10-31 (Groq + Gemini added, Cloudflare + OpenRouter present, NVIDIA keyless):** 11 groups rendered, NVIDIA reported skipped; `prism-free/gpt-oss-20b@groq`, `@120b`, `prism-free/gpt-oss-120b@groq` → 200 (`content: "pool-ok"` with `max_tokens: 2000`; a 16-token cap returns empty content because gpt-oss spends the budget on reasoning first); `prism-free/gemini-3.8-flash@gemini` → 200 with the served group echoed; `prism-free/gpt-oss-20b@cloudflare` → 200; `prism-free/smoke` → 200; a Groq streaming call → 200 with SSE frames; `/spend/logs/v2` → 200. OpenRouter pins still 429 `free-models-per-day-high-balance` (account daily counter spent; resets 00:00 UTC), so they remain the one unproven pair.
    - **List refresh after the keys landed:** OpenRouter 17/416, Cloudflare 39/39, Groq 4 free of 4 chat models (speech/guard/embedding ids filtered out), Google AI Studio 14 free of 46 (TTS/image/embedding filtered), NVIDIA skipped. `docs/free-models.md` regenerated and its coverage guard passes.
    - **Not done here (Task 5b/6/7 at the time; 5b is now done):** the bench entry (`litellm` in `PROVIDERS`, `x-litellm-*` in the wire-proxy usage log, served-deployment guards), the roadmap/184-187 amendments, and the strict live row with the budget-refusal proof. The pool's `--otel` path is rendered and unit-tested but was not run against a collector.

- [x] Task 5b: Memory bench on the pool — `litellm` provider entry, served-deployment record, and guards
  - Acceptance Criteria:
    - Functional:
      - `PROVIDERS` (`scripts/memory-bench/run.mjs:66`) gains `litellm: { create: "createLiteLLMProvider", list: "listLiteLLMModels", secret: "LITELLM_API_KEY", url: process.env.PRISM_LIVE_LITELLM_BASE_URL ?? "http://127.0.0.1:4000" }`. The supported-providers error text (`:240`) lists it.
      - `isFreeBenchmarkModel` (`:227-231`) accepts a `litellm` model only when:
        - its group name starts with `prism-free/`;
        - its catalog cost is exactly `0` for input and output;
        - (checked per call by the guard below) every response reports `x-litellm-response-cost` of `0`, or no cost.
      - **Served-deployment record:** every answer and judge call records `usage.metadata.litellm.{callId, modelId}`. Each arm's report gains `servedDeployments: { [modelId]: count }` and `callIds` (or a path to a sidecar JSONL when there are more than 1 000). This works through the agent's `usage` events, or through the wire proxy's usage log if Task 1 (f) chose that.
      - **Guards** (all fail closed, with code `MemoryBenchServedModel`):
        1. Under `--free-only`, a call whose reported cost is above `0` aborts the arm and keeps its checkpoint, so a resume after fixing the pool continues.
        2. A **paired** comparison (candidate vs control, `task5-comparison.mjs`, `campaign.mjs`) is refused when the two arms' served-deployment sets differ.
        3. A **scored** arm on `prism-free/smoke`, or on any group the catalog reports with more than one distinct model, is refused. The smoke group runs only with `--phase write` or the offline and wire tests.
        4. Held-out and acceptance subsets (`heldout-*`, `confirmatory`) refuse any `litellm` group with `compat.deployments > 1`. Single-deployment pinned groups follow today's pinned-`:free` rules.
      - `createFreeRoutePace` (`:404`) keeps its default of 20 per minute for `--free-only`. The pool README gives the per-group sum to pass explicitly as `--per-minute`. There is no automatic raise.
    - Performance:
      - Recording adds one map increment per call and one sidecar line per call above the threshold.
      - Guards make no request.
    - Code Quality:
      - Changes stay inside `scripts/memory-bench/`.
      - Each guard is a pure function (`servedModelGuard(report, options)`) called at the existing arm-start and arm-end points, with tests.
      - Existing evidence files are not rewritten.
    - Security:
      - Call ids and deployment ids are not secrets, but `apiBase` is not copied into bench reports (it may name private hosts). Only `modelId` and `callId` are.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/{run.mjs, campaign.mjs, task5-comparison.mjs, baseline.mjs, README.md}`; `memory: plan-202 graded rubric` (the free thinking model that returned nothing, so the README warns against reasoning-on models in the pool); Task 1 (f).
    - Options Considered:
      - Trusting group names alone ("same-model" by convention). Rejected: a config edit could silently mix models. The guard checks what actually served each call.
      - Allowing scored runs on mixed pools with per-deployment stratification. Rejected: it reintroduces the non-standard-model problem the owner rejected on 2026-10-24.
    - Chosen Approach:
      - Record what served each call, refuse comparisons across different servers, and keep acceptance on pinned or release providers.
    - API Notes and Examples:
      ```sh
      timeout 3600 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset dev --config fabric \
        --provider litellm --model prism-free/<model> --judges litellm/prism-free/<judge>@<host>,<second family> --free-only --per-minute 40
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{run.mjs, campaign.mjs, task5-comparison.mjs, README.md}`, `scripts/memory-bench/served-model.test.mjs`, `scripts/memory-bench/run.test.mjs` (provider list).
    - References:
      - Task 2 (`usage.metadata.litellm`); the owner decision of 2026-10-24.
  - Test Cases to Write:
    - `served_model_guard_refuses_paid_call_under_free_only`: a usage event with cost `> 0` aborts and keeps the checkpoint.
    - `served_model_guard_refuses_mismatched_pairs`: candidate `{a: 10}` vs control `{a: 5, b: 5}` is refused; equal sets pass.
    - `served_model_guard_refuses_scored_smoke`: the smoke group with `--phase all` is refused; `--phase write` passes.
    - `served_model_guard_refuses_pool_on_heldout`: `heldout-a` with `deployments: 2` is refused; `deployments: 1` passes.
    - `is_free_benchmark_model_litellm`: the prefix and zero cost are required; unknown cost is refused.
    - `report_records_served_deployments`: counts and call ids land in the report; the sidecar is used over the threshold.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (bench tooling).
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`: a "LiteLLM free pool" section with the guards and what counts as evidence.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Status (2026-11-01): complete.** Files: `scripts/memory-bench/served-model.mjs` (pure guards + record), `scripts/memory-bench/served-model.test.mjs` (8 tests), `scripts/memory-bench/run.mjs` (`litellm` in `PROVIDERS` and exported for the provider-list test, `isFreeBenchmarkModel`, arm-start and post-call guard calls, served-deployment record in `readUsage`), `scripts/wire-proxy.mjs` (`LITELLM_HEADERS`/`litellmHeaders` allow-list and four fields on the usage line), `scripts/memory-bench/campaign.mjs` (Stage A pair), `scripts/memory-bench/task5-execute.mjs` (`assertTask5ServedDeployments` in the postflight), `scripts/memory-bench/run.test.mjs` (free-route and provider-list cases), a new README section. `scripts/memory-bench/` suite: 396 pass, 2 skip; `run.test.mjs` 122 pass; docs/plan gate 80 pass.
    - **Where the metadata comes from: the wire proxy (option (i) of Task 1 (f)), not agent events.** `handleExchangeCompletion` now receives `upstreamResponse.headers` at all three call sites and copies only `x-litellm-call-id`, `-model-id`, `-model-group`, `-response-cost` into the usage line. `x-litellm-model-api-base` and key labels are deliberately excluded — `api_base` names private infrastructure, and the security criterion forbids it in reports. Verified live against the pinned pool: a pool-key call through the bench's own `startWireProxy` produced `{"callId":"e73579…","modelId":"pin-oss20b-groq","modelGroup":"prism-free/gpt-oss-20b@groq"}` with the pool torn down by `--purge` afterwards.
    - **Cost is read from three places, in order:** the `x-litellm-response-cost` header, then `rawUsage.cost`, then `usage.cost`. This is load-bearing, not defensive: Task 1b measured that a stream carries **no** total cost header (zero-valued headers are dropped) while its final usage chunk carries `cost`. Guard 1 would silently pass every streamed paid call if it only read the header. A zero-cost deployment sends no header at all, which reads as `0`, not as "unknown".
    - **Guards live in one pure module** (`served-model.mjs`), each throwing `MemoryBenchServedModel`: (1) `assertFreeOnlyCost` after every usage read, so a charged free-only arm aborts where it stands and its per-question checkpoint survives for a fix-and-resume; (2) `assertComparableServedDeployments`, called from `writeScreenAVerdict` for Stage A's `x` vs `x-tools` pair and from `assertTask5ServedDeployments` for each Task 5 control/candidate cell — the union must be equal, not merely overlapping; (3) `assertScoredSingleModel` at arm start, refusing `prism-free/smoke` for any phase but `write`, and any catalog `compat.deployments > 1`; (4) `assertPinnedSubset`, refusing held-out/confirmatory on a group that served more than one deployment. Two reports with no gateway labels at all are treated as "not comparable but not contradictory" rather than equal — a silent pass there would defeat guard 2 whenever both arms ran before the pool existed.
    - **`isFreeBenchmarkModel` for litellm:** group must start with `prism-free/` **and** catalog input+output cost must be exactly `0`. Unknown cost is refused, the same rule as OpenRouter (`run.test.mjs` asserts both). The group prefix alone is never authorization.
    - **Recording threshold.** `servedDeployments` is always inline; `servedCallIds` inlines up to 1,000 ids and otherwise becomes `{ count, path }` pointing at `<output>.callids.jsonl` (or a temp file when `--output` is absent), written on every usage read. Only `modelId` and `callId` are recorded, never `apiBase`.
    - **Pacer choice (Task 1 (f) option (ii)):** `createFreeRoutePace` keeps its 20/minute default and its hard refusal above 20; the pool's per-group ceiling is passed explicitly with `--per-minute` and is never raised automatically. The plan's example (`--per-minute 40`) is therefore still refused by design, and the README says so. Raising the literal cap to accommodate the pool was rejected: the number exists because `:free` routes share one account quota, and a pool arm's real ceiling is per host, which the pool README already documents.
    - **Live arm not run.** The provider entry, the recording path and guards 1/3/4 are exercised by tests plus the live wire-proxy probe above; a full scored arm would spend a free-route day (Gemini 20 RPD, OpenRouter 50–1,000 RPD) and download a dataset, so it is deferred to Task 6/7's strict live row, which needs a real arm anyway.
    - **Pre-existing failures confirmed unchanged:** `task5-comparison.test.mjs` aborts with `Task5Manifest: the candidate has uncommitted changes` in a dirty tree (Task 4's observability edits are still uncommitted) and `dead-export-verify.test.mjs` reports unclassified candidates; both reproduce on a clean HEAD worktree and neither is caused by this task.

- [x] Task 6: Roadmap and release-path rows
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md`:
        - the Updated line gains a 2026-10-31 entry for the owner decision (LiteLLM ships in 0.13.0; cache parity for it is post-0.13.0);
        - §2.9's provider row (`roadmap.md:598`) adds `litellm`;
        - Phase 5's shipped set (`roadmap.md:1794`) gains `litellm`, with the decision date;
        - the 2026-10-25 "every provider shipped from now on carries a prompt-cache-parity cell" rule gains the recorded exception: "`litellm` is exempt for 0.13.0 by owner decision 2026-10-31; per-backend parity is planned after 0.13.0".
      - Plans 184, 185, 186, and 187 get "Amended 2026-10-31 by plan 214":
        - 184: a paragraph saying `litellm` has no cell, with the reason and the deferral, and that its `provider-probe.mjs` figures are informational;
        - 185: the freeze set and the `SecretSource` migration list include `litellm`, and the observability config additions are frozen;
        - 186: a strict `providers/litellm` row whose preflight runs `scripts/litellm/up.mjs` and checks `LITELLM_API_KEY`;
        - 187: the publish list is nine providers. A new npm name needs no deprecation entry. `litellm` must not enter `scripts/retired-names.json`.
      - `plans/README.md`: the 187 step text and the 214 row are updated.
      - Sweep: `rg -n "eight provider|8 provider" src packages apps scripts examples docs roadmap.md PRODUCT.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds no stale count.
    - Performance: n/a.
    - Code Quality: only unchecked tasks in other plans are edited. If plan 213 has not landed its Task 5 yet, this task waits for it, so the counts are applied in order.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plans 184–187; roadmap §2.9 and Phase 5; plan 213 Task 5.
    - Options Considered:
      - Leaving the parity rule unamended and treating `litellm` silently as an exception. Rejected: plan 184 and the roadmap would then contradict the shipped set.
    - Chosen Approach:
      - Enumeration amendments plus a recorded exception, as plan 213 Task 5 does.
    - API Notes and Examples:
      ```markdown
      **Amended 2026-10-31 by plan 214 (LiteLLM ships in 0.13.0 without a parity cell; owner decision).** …
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `PRODUCT.md` (only if it names the provider set), `plans/{184,185,186,187}-…md`, `plans/README.md`, `docs/models.md` (count sentence).
    - References:
      - plan 213 Task 5.
  - Test Cases to Write:
    - The existing `docs.test.ts` plans-index check and `truth-current.test.mjs`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/models.md` count sentence only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-01):
    - **What changed:**
      - `roadmap.md`: Updated line records owner decision 2026-10-31 (`@arnilo/prism-provider-litellm` ships in 0.13.0, Phase 5 ships nine provider packages, exempt from cache-parity cells for 0.13.0 with per-backend parity planned post-0.13.0); §2.9 provider row adds `litellm`; Phase 5 provider packages list gains `litellm`; the 2026-10-25 prompt-cache-parity cell rule records the owner decision exemption for `litellm`.
      - `PRODUCT.md`: Model providers row updated to include `litellm` in alphabetical order (`{hyper, kilo, laya, liquid, litellm, openai-codex, opencode-go, openrouter, typesafe}`).
      - `plans/184-Phase-11-Part-K-Prompt-Cache-Parity-With-Pi.md`: Added dated amendment recording that `@arnilo/prism-provider-litellm` has no cell in the parity matrix due to proxy heterogeneity across >100 backends, with per-backend parity deferred post-0.13.0 and probe numbers being informational.
      - `plans/185-Phase-11-Part-L-Kernel-Surface-Reduction-Shape-Freeze-And-Forward-Compatibility.md`: Added dated amendment recording `packages/providers/litellm` joining the freeze set (nine 0.13.0 packages plus in-tree `commandcode`), `SecretSource` migration list gaining `src/{provider,models}.ts`, and the `@arnilo/prism-observability` configuration additions being frozen.
      - `plans/186-Phase-11-Part-M-Live-Release-Acceptance-On-Hyper-And-OpenCode-Go.md`: Added dated amendment recording `providers/litellm` in T1 and preflight (nine shipped packages, ten rows with `liquid-local`), updated Task 2 preflight (`scripts/litellm/up.mjs`, `LITELLM_API_KEY`, `listLiteLLMModels`), and updated Task 5 prerequisites and preflight probe checks.
      - `plans/187-Phase-11-Part-N-Retired-Name-Sweep-Publish-And-Deprecation.md`: Added dated amendment recording publication of nine providers, `litellm` as a new npm name not in retired names or deprecations, and updated Task 2 preflight requirements.
      - `plans/README.md`: Step 21 description updated from eight to nine providers; plan 214 entry updated with Task 6 completed.
      - `scripts/deprecations-0.13.json`: Updated `@arnilo/prism-providers` deprecation message to include `litellm`.
      - `docs/models.md`: Verified already updated in Task 2 to nine provider packages (`@arnilo/prism-provider-{hyper, kilo, laya, litellm, liquid, openai-codex, opencode-go, openrouter, typesafe}`).
    - **Findings that affect later tasks:**
      - Only Task 7 remains (live acceptance on the free pool).
    - **Baseline diff:** none (no exports moved/changed).
    - **Sweep result:** `rg -w "eight provider|8 provider|eight providers|8 providers"` over `src packages apps scripts examples docs roadmap.md PRODUCT.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) found 0 occurrences (clean).
    - **Tests:** `scripts/truth-current.test.mjs`, `scripts/retired-providers.test.mjs`, `src/__tests__/docs.test.ts` passed (77/77). `bun run typecheck` passed cleanly across all workspaces.

- [x] Task 7: Live acceptance on the free pool — strict row, kernel smoke, budget fail-closed, reconciliation, trace nesting, bench smoke (the owner provides keys and approves the containers)
  - Acceptance Criteria:
    - Functional:
      - `bun scripts/litellm/up.mjs` succeeds with the owner's keys.
      - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/litellm bun run test:live` passes on a pinned single-deployment group: text, tool loop, reasoning where supported, structured output where supported, abort, error, and leak scan.
      - `live-agent.test.ts`: one multi-turn `createAgent` session with a tool and one image turn (on an image-capable group, if any), through the kernel loop. Every `usage` event carries `usage.metadata.litellm.callId` and `modelId`.
      - **Budget fail-closed:** one request with a temporary key of `max_budget: 0.000001` against a deployment that reports a cost returns the mapped "budget spent" error. Otherwise it is recorded as "not producible on free tiers", with Task 1b's recorded body as the offline proof.
      - **Reconciliation:** `scripts/litellm/reconcile.mjs` over the live run finds every call id, and the delta is within tolerance.
      - **Trace nesting:** with `up.mjs --otel <local Jaeger>` and `observability({ propagateTraceContext: true })`, one run's LiteLLM spans share the run's trace id and have a Prism span as parent. Recorded with the span ids.
      - **Bench smoke:** one bounded `run.mjs` dev-subset run (≤ 10 questions, `--free-only`, a same-model group, two-family judges as `run.mjs` requires) completes with `servedDeployments` recorded. A forced mismatched pair is refused with `MemoryBenchServedModel`.
      - `provider-probe.mjs --provider litellm --model <pinned group> --turns 4` runs once. Its cache figures are recorded as **informational** (no threshold).
      - `docs/_evidence/litellm-live-<date>.md` records: the proxy version and digest, groups and backends, request counts, spend ($0, with the reconciliation table), the probe figures, the trace check, the bench smoke summary, and the leak scan.
    - Performance: at most 120 requests across all legs. $0 on the pool. The optional paid leg is under $0.05 if the owner enables it. The measured counts correct the `scripts/live-matrix.json` cost line.
    - Code Quality: each defect gets a fixture, a test in the owning file, and a fix.
    - Security:
      - `live.env` mode `0600` is checked first.
      - `bun scripts/scan-secrets.mjs` passes over the evidence.
      - No key, Postgres password, or private `api_base` appears in the evidence.
      - `down.mjs --purge` runs at the end.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md`; plan 213 Task 6.
    - Options Considered:
      - Provider-level scenarios only. Rejected: the telemetry metadata, the budget behaviour, and the bench guard show only in a kernel or bench run.
    - Chosen Approach:
      - The strict row, a kernel smoke, the budget check, reconciliation, the trace check, a bounded bench smoke, and the informational probe.
    - API Notes and Examples:
      ```sh
      timeout 240 bun scripts/litellm/up.mjs --write-key
      timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/litellm bun run test:live
      timeout 900 bun scripts/cache-parity/provider-probe.mjs --provider litellm --model prism-free/<pinned> --turns 4
      timeout 60 bun scripts/litellm/down.mjs --purge
      ```
    - Files to Create/Edit:
      - `packages/providers/litellm/src/__tests__/live-agent.test.ts` (gated like `live.test.ts`); `docs/_evidence/litellm-live-<date>.md`; `docs/_evidence/cache-probe/litellm-*.json`; the `scripts/live-matrix.json` cost line; `scripts/e2e-coverage.json`; regenerated `docs/live-testing.md`.
    - References:
      - Tasks 2–5b.
  - Test Cases to Write:
    - `live-agent.test.ts`: a 2-turn agent session with one tool, plus an image turn where supported. Asserts the `usage.metadata.litellm` fields. Skips without the key or the proxy.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence only, and the README "Telemetry" and "Prompt caching" sections get the measured figures.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-01):
    - **What changed:**
      - `packages/providers/litellm/src/__tests__/live-agent.test.ts`: added multi-turn agent kernel smoke testing a 2-turn tool loop (`calculate`), tool result replay, image turn, and verifying that every `usage` event carries `usage.metadata.litellm.callId` (UUID) and `modelId`, while asserting no key leaks into events.
      - `packages/providers/litellm/src/__tests__/live.test.ts`: updated default model to `prism-free/gpt-oss-20b@groq`.
      - `scripts/live-matrix.json`: updated `providers/litellm` test command to run both `live.test.ts` and `live-agent.test.ts` with default model `prism-free/gpt-oss-20b@groq`, and updated cost line and notes; regenerated `docs/live-testing.md`.
      - `scripts/cache-parity/provider-probe.mjs`: updated model ID regex to allow `@` in pinned model names (e.g. `prism-free/gemini-3.8-flash@gemini`).
      - `docs/_evidence/litellm-live-2026-11-01.md`: created complete evidence document capturing container digests, route proofs, budget fail-closed check, reconciliation results, Jaeger trace nesting verification, memory-bench served-model guard refusal, informational cache probe, and secret scan.
      - `docs/_evidence/cache-probe/litellm-prism-free-gemini-3.8-flash-gemini-2026-11-01.json`: written with 4-turn cache probe results (0.7566 reuse, informational only).
      - `packages/providers/litellm/README.md`: updated "Prompt caching" section with measured informational cache probe numbers.
    - **Findings:**
      - `~/.config/prism/live.env` verified with mode `0600`.
      - Strict live matrix row passed (`5 pass, 0 fail, 2 skip` by design).
      - Budget fail-closed was verified live against the `prism-free/priced` route with a temporary key (`max_budget: 0.000001`): first call succeeded, second call returned HTTP 422 with `type: budget_exceeded`, mapped to `The LiteLLM key's budget is spent.`
      - Reconciliation was verified live: `reconcile.mjs` against live calls matched all call IDs with 0 missing rows and 0.0 delta.
      - Trace nesting was verified live with Jaeger: root span `Received Proxy Server Request` (spanID `6d75f79495c8a513`) had `parentSpanID: 1234567890abcdef` under injected trace `4bf92f3577b34da6a3ce929d0e0e4736`, with children `auth`, `proxy_pre_call`, `router`, `self`, `litellm_request`, and `raw_gen_ai_request`.
      - Benchmark guard refusal was verified: `assertComparableServedDeployments` threw `MemoryBenchServedModel` on forced mismatch. Wire proxy extraction verified recording of `servedDeployments` and inlined `servedCallIds`.
      - Cache probe completed 4 turns on `prism-free/gemini-3.8-flash@gemini` over 8,341 prefix tokens (status: `measured`, reuse: `0.7566`). Recorded as informational only per owner decision 2026-10-31.
      - Cleanup: Jaeger container removed and `bun scripts/litellm/down.mjs --purge` executed cleanly.
    - **Tests:**
      - `timeout 1200 env PRISM_LIVE_ENV_FILE="$HOME/.config/prism/live.env" PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/litellm bun run test:live` passed (5 pass, 2 skip, 0 fail).
      - `bun run --filter @arnilo/prism-provider-litellm test` passed (42 pass, 1 skip).
      - `bun run --filter @arnilo/prism-observability test` passed (79 pass).
      - `bun test scripts/litellm/ scripts/memory-bench/served-model.test.mjs scripts/memory-bench/run.test.mjs` passed (153 pass).
      - `bun run build:core` and `bun run typecheck` passed cleanly across all workspaces.
      - `bun scripts/scan-secrets.mjs` passed with 0 findings across 5,076 files.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-provider-litellm test`
- `timeout 600 bun run --filter @arnilo/prism-observability test`
- `timeout 600 bun test --timeout=0 scripts/litellm/ scripts/memory-bench/served-model.test.mjs scripts/memory-bench/run.test.mjs`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts src/__tests__/release.test.ts src/__tests__/context-overflow-recovery.test.ts`
- `timeout 600 bun test --timeout=0 scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/retired-providers.test.mjs scripts/truth-current.test.mjs`
- `timeout 300 bun scripts/scan-secrets.mjs`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/litellm bun run test:live` (owner keys, proxy up; Task 7)

## Compromises Made

- **Structured output leg omitted in live matrix:** The free pool reports `supports_response_schema: null` on proxy models, so `structuredOutput` capability remains unclaimed by conservative discovery; `live.test.ts` skips this scenario by design until a backend is measured with it.
- **Cache parity cell exemption:** LiteLLM is exempt from prompt-cache-parity cells for 0.13.0 per owner decision 2026-10-31 due to heterogeneity across >100 backends; probe figures are recorded as informational only.
- **Streaming response total cost header:** LiteLLM does not emit a total cost header on streaming responses; cost resolves via SSE usage chunks where emitted by the backend or falls back to catalog pricing.
- **Pacer cap:** `createFreeRoutePace` keeps its 20/minute ceiling and refuses `--per-minute 40`; the pool ceiling is passed explicitly per group.

## Further Actions

- **Per-backend prompt-cache parity (post-0.13.0, P2):** Measure per-backend prompt caching behind LiteLLM (lever equivalence, client marker routing, Gemini/Vertex context-cache cost, and plan 184-style matrix cells) where `/v1/messages` and `/v1/responses` routes can be added.
- **Structured output schema capability flags (post-0.13.0, P3):** Add structured output schema capability discovery once upstream LiteLLM supports schema capability flags reliably across backends.
- **Parquet support in benchmark environments (post-0.13.0, P3):** Install `pyarrow` in the host environment to enable parquet dataset suites in `scripts/memory-bench/datasets.mjs`.
