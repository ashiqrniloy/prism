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

- [ ] Task 1: Phase review — placement, seams, discovery, cache policy, telemetry, spend logs, free tiers, pin (read-only)
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

- [ ] Task 1b: Local proxy probes — wire, headers, call id, errors, spend logs, trace nesting, pool behaviour (the owner provides keys and approves the containers)
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

- [ ] Task 2: `@arnilo/prism-provider-litellm` — Chat route, discovery, header telemetry, call id, general cache policy, errors
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

- [ ] Task 3: `/spend/logs` reconciliation — `litellmSpendLogs` and `scripts/litellm/reconcile.mjs`
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

- [ ] Task 4: Observability — opt-in trace-context propagation and allow-listed usage metadata on chat spans
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

- [ ] Task 5: Free test pool — repo LiteLLM config, launch and stop scripts, budget-capped key
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

- [ ] Task 5b: Memory bench on the pool — `litellm` provider entry, served-deployment record, and guards
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

- [ ] Task 6: Roadmap and release-path rows
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

- [ ] Task 7: Live acceptance on the free pool — strict row, kernel smoke, budget fail-closed, reconciliation, trace nesting, bench smoke (the owner provides keys and approves the containers)
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

- To be filled after tasks are completed and tests pass.

## Further Actions

- Known at drafting (owner decision 2026-10-31), to be confirmed with priorities at plan end:
  - Per-backend prompt-cache parity for `litellm`, post-0.13.0: per-backend lever equivalence, which backends get client markers, the Gemini/Vertex context-cache cost, and plan 184-style cells. This is where the `/v1/messages` and `/v1/responses` routes come back.
- To be filled after task completion with improvements, rationale, and priority.
