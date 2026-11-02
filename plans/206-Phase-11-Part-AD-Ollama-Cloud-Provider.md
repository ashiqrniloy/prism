# Phase 11 Part AD — Ollama Cloud provider (deferred past 0.13.0)

## Objectives

- Ship `@arnilo/prism-provider-ollama-cloud` **in the release after 0.13.0** for Ollama's hosted cloud models (`https://ollama.com`, API key). It is thoroughly live-tested.
- Choose the wire by evidence:
  - the **native `/api/chat`** reports cached prompt tokens (`prompt_eval_cached_count`);
  - the **OpenAI-compatible `/v1/chat/completions`**, which the reference harness `pi-ollama-cloud` 0.13.1 uses, also reports cached tokens as `prompt_tokens_details.cached_tokens` on cloud (measured in Task 1; the package README's "does not report cached-token usage" claim is wrong for the current wire);
  - the **Anthropic-compatible `/v1/messages`** lists `cache_control`.

  Ship the measurable default route plus the pi-compatible route.
- Reach **prompt-cache parity with pi plus `pi-ollama-cloud`**. Send at least every lever it sends (it sends none), keep the prefix byte-stable, and measure provider-level reuse. Add an Ollama Cloud cell to the standing parity suite (plan 184) comparing measured cache reads, because both harnesses now report them.
- Expose Ollama's plan limits (`/api/balance` session and weekly windows) for preflight checks.

## Expected Outcome

- `createAgent({ model: "ollama-cloud/<model id>", packages: [ollamaCloud] })` streams text, tools, thinking, structured output, and images on the default route. Model ids come from `https://ollama.com/api/tags`, for example `gemma4:31b`. Usage includes `cacheReadTokens` wherever the cloud reports it.
- `compat.route: "openai"` selects `/v1/chat/completions` with the same behaviour as pi-ollama-cloud.
- `provider-probe.mjs` shows cache-read reuse above 0.5 on turns 2–4 on the default route (Task 1 measured ≈0.996 on native and on compat), or records `unmeasurable` with evidence if the cloud stops reporting them.
- `ollamaCloudBalance()` returns the plan's remaining session and weekly percentages and reset times, without the key.
- `providers/ollama-cloud` is an active live row (both routes), passing strict. `docs/_evidence/ollama-cloud-live-<date>.md` records the run and the probe.

This plan implements the **owner decision of 2026-10-25** (Ollama Cloud is thoroughly live-tested and reaches prompt-cache parity), **amended 2026-10-25: Ollama Cloud does not ship in 0.13.0**. The owner deferred this provider and Command Code (plan 205) to the first release after 0.13.0. The 0.13.0 provider set is unchanged, and this plan no longer gates plan 184, plan 185's freeze, plan 186, or plan 187. It changes roadmap **Phase 5** when it runs.

- **Release path:** **not on the 0.13.0 path.** It was the last of four provider plans (203 → 204 → 205 → 206); 203 and 204 still run right after plan 194, and this plan runs after 0.13.0 ships, after plan 205. The plan 194/203 dependencies below stay as written.
- **Plan 194 (Tasks 1–5 landed, 6–7 in progress):** the `context_overflow` failure class and its body patterns (`src/provider-kit/transport.ts:31-47`), the estimate-vs-window fallback (`contextOverflowEvidence`, `src/agent-session/session/provider-round.ts:203-229`), one compaction-and-retry recovery (`src/agent-session/context-overflow.ts`), fold batch clearing, and context accounting are in the tree.
  - This plan feeds its routes' overflow evidence into them directly instead of amending 194.
  - It declares accurate context windows, which the fallback, the accounting, and 194 Task 7's window-relative OM gate read.
  - 194 Tasks 6–7 (the rot curve on Hyper and OpenCode Go models, and reference-host triggers) need nothing from this plan.
- **Dependency:** plan 203 (the provider probe, and `mapUsage(usage, chunk)`).
- **Review:** it creates a package and possibly a package-local codec, so **Task 1 is the phase review**.
- **Keys:** `~/.config/prism/live.env` gains `OLLAMA_API_KEY`. The owner's pi already holds an Ollama Cloud credential; the executor asks the owner to add the key and never copies it.
- **Cost:** live calls consume Ollama plan usage (included session and weekly windows, then purchased credits). Each row states its request count.
- **Reference host impact:** none.
- **Naming:** the 0.12 `@arnilo/prism-provider-ollama` (npm 0.3.x, OpenAI-compatible, cloud and local) stays deprecated with range `*`. Its message gains a successor pointer. Local `ollama serve` is not live-testable on the dev machine (no `ollama` binary), so it is a Further Action, not a claim.

**Scope exclusions (Further Actions candidates):**
- A local `ollama serve` provider.
- Ollama web search and fetch tools (pi-ollama-cloud ships them; Prism has `@arnilo/prism-tools-web`).
- Ollama's System One decision models (`/api/systemone`, "Clef").
- Cloud usage histograms (`/api/usage`).
- The stateless `/v1/responses` route.

## Research summary (2026-10-25)

Sources:
- `docs.ollama.com` (`cloud.md`, `api/openai-compatibility.md`, `api/anthropic-compatibility.md`, `api/chat.md`, `api/usage.md`, `api/balance.md`, `api/cloud-usage.md`, `llms.txt`), fetched 2026-10-25;
- `~/.pi/agent/npm/node_modules/pi-ollama-cloud` 0.13.1 (`index.ts`, `README.md`, `docs/usage.md`);
- pi 1.4.0 `api/openai-completions.js`;
- the deleted 0.12 `ollama` package (`git show 14009176^:packages/providers/ollama/`).

| Topic | Finding | Consequence |
| --- | --- | --- |
| Base and auth | `https://ollama.com`, `Authorization: Bearer $OLLAMA_API_KEY` (keys at `ollama.com/settings/keys`). Prompts are not used for training ("We do not use them to train models") | One provider, bearer auth |
| Native API | `POST /api/chat` streams **NDJSON**: `message.{content, thinking, tool_calls}`, `done`. The final chunk carries `prompt_eval_count`, **`prompt_eval_cached_count`** ("prompt tokens read from the cache"), `eval_count`, and `total_duration`; the documented `prompt_eval_duration`/`eval_duration`/`load_duration` were **absent on cloud** (Task 1). `GET /api/tags` lists models; `POST /api/show` gives capabilities and context | Not SSE and not OpenAI-shaped, so a package-local codec |
| OpenAI compat | `https://ollama.com/v1/chat/completions` supports streaming, `stream_options.include_usage`, tools, vision (base64 only), `response_format`, `reasoning_effort`, and `reasoning.effort`, but **not `tool_choice`**. Cloud: no stateful Responses, no custom or freeform tool replay. pi-ollama-cloud README: "The completion API does not report cached-token usage" — **contradicted by Task 1**: the cloud returns `usage.prompt_tokens_details.cached_tokens` and pi maps it to `cacheRead` | The provider-kit `openai-chat` codec fits, and caching is observable on this route too |
| Anthropic compat | `/v1/messages` lists prompt caching with `cache_control` blocks | A candidate measurable route. Task 1 probes it on cloud |
| Thinking | `reasoning_effort` names are model-defined (from `/api/show`). Boolean-only models map efforts to true, and `none` to false. GPT-OSS maps `minimal` → `low`, `xhigh` → `high`. Native: `think: true\|false\|"low"\|"medium"\|"high"` | A per-model thinking map from discovery |
| Limits | `GET /api/balance` → `included.{session,weekly}.{remaining_percent, resets_at}` on legacy plans, plus `purchased.balance_usd`. The balance and usage endpoints allow 10 requests per minute per user, with `Retry-After` on 429 | An `ollamaCloudBalance()` helper. 429 mapping |
| **Cache levers — pi + pi-ollama-cloud 0.13.1** | `registerProvider("ollama-cloud", {baseUrl: "https://ollama.com/v1", api: "openai-completions"})` (`index.ts:79-86`). pi then sends **no session-affinity headers** (only OpenRouter gets them, `openai-completions.js:544,1305`), **no `prompt_cache_key`** (only `api.openai.com`, `:580-583`), and no `cache_control`. **No levers at all**; caching is whatever Ollama's server-side KV reuse gives. **Task 1 measured pi reporting `cacheRead` 8 800 on a warm turn**, so reuse is visible on pi's own route | Parity by construction: Prism must send no fewer levers, and keep a byte-stable prefix. The plan 184 cell compares measured cache reads |
| Prior Prism code | The 0.12 package used the compat route, with `cacheReadTokens` "intentionally left undefined" (`provider.ts` doc comment) | The native route can do better |

## Tasks

- [x] Task 1: Phase review — route choice by measurement, discovery, thinking, limits, and errors (read-only, live probes)
  - **Status (2026-11-01): complete.** All probes ran against `https://ollama.com`. `live.env` held no `OLLAMA_API_KEY`; the executor used the owner's existing `ollama-cloud` credential from pi's auth store in-process, without printing, copying, or persisting it. The owner added `OLLAMA_API_KEY` to `~/.config/prism/live.env` (mode `0600`) on 2026-11-01, before Task 2. Live request budget: cache probe 26 (budget 24, +2 for a per-model no-cache control and the 3-turn refresh) and native probes 16 (budget 15, +1 to re-run five captures with delta accumulation). Findings below supersede the research summary where they conflict.
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Placement:**
        - the package is `packages/providers/ollama-cloud`;
        - the native NDJSON codec is package-local (`src/native.ts`), because it is vendor wire with one user. The package implements `ModelProvider.generate` directly on provider-kit primitives (`resolveProviderApiKey`, `httpStatusError`, `readBoundedResponseText`, `providerError`, usage normalization), unless `createRoutedProvider` already accepts a custom format, which the review checks (`routed-provider.ts:24-60`);
        - the compat route uses `openai-chat`, and the Messages route, if chosen, uses `anthropic-messages`;
        - the enforcement-row list.
      - (b) **Cache measurement**, the decisive probe. On two cloud models (one tool-capable instruct model and one thinking model from `/api/tags`), send the same 3-turn transcript with a stable prefix of about 3K tokens on each of the three routes, and record:
        - native `prompt_eval_cached_count` and `total_duration` per turn (`prompt_eval_duration` was absent on cloud);
        - compat usage (confirm no cached field);
        - Messages `cache_read_input_tokens` with and without `cache_control`.

        Repeat once after 2 minutes to see cache lifetime. At most 24 requests.
      - (c) **Route decision:** the default route is the one with measured reuse, preferring native, then Messages, then compat. If no route reports reuse, the default is native (it still reports `total_duration`), and Task 3 records `unmeasurable`.
      - (d) **Native wire probes**, at most 15 requests:
        - text; tools (native `tool_calls` with object `arguments`) and a tool-result turn; `think` on a thinking model (the `message.thinking` stream); `format` with a JSON schema; one image (base64 `images`);
        - the final-chunk field list; `done_reason` values;
        - an over-long prompt on each route (the overflow body for the shared classifier);
        - error bodies (`{"error": "…"}`) for a bad key, an unknown model, and 429 if reached.
      - (e) **Discovery:** `/api/tags` and `/api/show` fields (capabilities `tools`, `thinking`, `vision`, and `completion`; `model_info.*.context_length`; thinking levels), against pi-ollama-cloud's generated tables. Also `GET /api/balance` shape on the owner's plan.
      - (f) **Reference harness:** pi-ollama-cloud version and the lever finding re-verified. `pi -p --mode json --provider ollama-cloud --model <id>` runs headless; record what `usage` it reports (Task 1 measured `cacheRead` 0 cold and 8 800 warm) and its duration. This defines the plan 184 cell's metric (Task 3).
      - (g) **Release-path fit:** what plans 184, 185, 186, and 187 need, and whether plan 194's landed overflow classifier matches each route's overflow body.
      - (h) **Verdict.** **Stop condition:** the API key cannot reach cloud models on any route.
    - Performance: n/a (read-only). The probes stay within budget.
    - Code Quality: no code changes.
    - Security: the key stays in `live.env` (mode `0600`). Recordings are scrubbed of `authorization`.
  - Approach:
    - Documentation Reviewed:
      - The Ollama docs pages in the research summary; pi-ollama-cloud `index.ts:1-130`, `README.md:57-84`, `docs/usage.md`; pi `openai-completions.js:534-590,1236-1310`.
      - The deleted 0.12 package; Prism `routed-provider.ts`, `codecs/openai-chat.ts`, `codecs/anthropic-messages.ts`, `transport.ts`, `usage.ts`.
    - Options Considered:
      - Copying pi-ollama-cloud's compat-only route. Rejected as the only route: it would ignore the native wire that reports `prompt_eval_cached_count` directly. Task 1 also measured reuse on compat, so it is kept as `compat.route: "openai"` for like-for-like comparison.
      - Choosing the route from the docs alone. Rejected: cloud behaviour may differ from the local server the docs mostly describe.
    - Chosen Approach:
      - Decide the route by a budgeted live measurement through `scripts/wire-proxy.mjs`. The proxy must pass NDJSON through; the review checks it.
    - API Notes and Examples:
      ```sh
      timeout 30 curl -s https://ollama.com/api/tags -H "authorization: Bearer $OLLAMA_API_KEY" | jq '.models[].name'
      timeout 120 curl -sN https://ollama.com/api/chat -H "authorization: Bearer $OLLAMA_API_KEY" \
        -d '{"model":"gemma4:31b","messages":[{"role":"user","content":"hi"}],"stream":true}'
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes only.
    - References:
      - plan 203 Task 5.
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes:
    - **(a) Placement and enforcement rows.**
      - Package: `packages/providers/ollama-cloud`, on `@arnilo/prism/provider-kit` only, matching the `opencode-go` package shape (`peerDependencies: {"@arnilo/prism": ">=0.13.0 <1.0.0"}`, no `dependencies`, `exports: {".": "./src/index.ts"}`, `sourceExport: true`).
      - Native route: the NDJSON codec is package-local (`src/native.ts`) and the package implements `ModelProvider.generate` directly. `createRoutedProvider` does **not** accept a custom format: `RoutedProviderFormat` is the closed union `"openai-chat" | "anthropic-messages" | "openai-responses"` (`src/provider-kit/routed-provider.ts:13`), and `route.codec` carries only per-format options, not a parser. The native route uses `resolveProviderApiKey`, `httpStatusError`, `readBoundedResponseText`, `providerError`, `providerHttpError`, and `normalizeUsage` from the kit.
      - Compat route: provider-kit `openai-chat` on `/v1/chat/completions`. Messages route: **not shipped.** Task 1 measured reuse there too, but (c) chose native as the default and no reference harness uses `/v1/messages`, so a third route would be untested scope. `anthropic-messages` remains the codec if a later host needs it.
      - Enforcement rows, read against the tree on 2026-11-01 (`commandcode`, `kilo`, and `litellm` are the freshest precedents): `docs/index.md:34-43` (provider link list), `docs/models.md:163` ("ships 9 provider packages" and the `{…}` set) and `:173-181` (per-package table), `docs/release.md` (generated `package-truth:providers` block — regenerate, do not hand-edit), `docs/migrate-to-0.13.md` (umbrella successor list), `docs/live-testing.md` (generated live-matrix table), `packages/providers/README.md` (adapter list), `scripts/package-truth.json` (package map + counts), `scripts/coverage-thresholds.json`, `scripts/e2e-coverage.json`, `scripts/live-matrix.json`, `scripts/live.env.example` (add `OLLAMA_API_KEY`), `scripts/phase24-truth.test.mjs` counts, `scripts/phase54-package-map.test.mjs`, `src/__tests__/install-smoke.test.ts`, `src/__tests__/packaging.test.ts` (hard-coded provider set), `scripts/deprecations-0.13.json` + `scripts/retired-providers.test.mjs` (the `ollama` successor message), and the new `scripts/compat-baseline/arnilo__prism-provider-ollama-cloud.txt`. Root `package.json` `workspaces` needs no edit (`packages/providers/*`).
    - **(b) Cache measurement — decisive probe.** Method: identical 3-turn transcript with a byte-stable prefix (300 repeated archive lines; measured 7 338 prompt tokens on `gemma4:31b` and 5 783 on `gpt-oss:20b`) on all three routes, then a repeat on native after 125 s. Two exemplars: `gemma4:31b` (tools + vision + boolean thinking) and `gpt-oss:20b` (named thinking levels).

      | Route / turn | `gemma4:31b` prompt / cached | `gpt-oss:20b` prompt / cached |
      | --- | --- | --- |
      | native t1 | 7 338 / 0 | 5 783 / 68 |
      | native t2 | 7 357 / 7 328 | 5 802 / 5 784 |
      | native t3 | 7 376 / 7 328 | 5 821 / 5 803 |
      | openai-compat t1 | 7 338 / `prompt_tokens_details.cached_tokens` 7 328 | 5 783 / 5 782 |
      | openai-compat t2 | 7 357 / 7 328 | 5 802 / 5 801 |
      | openai-compat t3 | 7 376 / 7 360 | 5 821 / 5 820 |
      | messages t1 (`cache_control`) | `cache_read_input_tokens` 7 328, `input_tokens` 10 | 5 782, `input_tokens` 1 |
      | messages t2 | 7 328, `input_tokens` 29 | 5 801, `input_tokens` 1 |
      | messages t3 | 7 360, `input_tokens` 16 | 5 820, `input_tokens` 1 |
      | native after 125 s, t1 | 7 338 / 7 328 (already warm) | 5 783 / 5 782 |
      | native after 125 s, t2/t3 | 7 357 / 7 328, 7 376 / 7 328 | 5 802 / 5 801, 5 821 / 5 820 |

      - **Every route reports reuse.** The compat route's `usage.prompt_tokens_details.cached_tokens` contradicts `pi-ollama-cloud` README:71. Messages reports `cache_read_input_tokens` with `input_tokens` exclusive, and a first request **without** `cache_control` still read 7 328 because the prefix was already warm upstream: the cache is server-side and lever-free (the Messages control was one request per model).
      - Native `prompt_eval_duration`, `eval_duration`, and `load_duration` were **absent** on every cloud response; only `total_duration` is present. Reuse is computed from `prompt_eval_cached_count / prompt_eval_count` (≈0.996 warm).
      - Cache lifetime exceeds 125 s. Reuse qty is `min(prefix, prompt)` and the growing turn suffix is not cached.
    - **(c) Route decision.** Default is **native**. It is the preferred order (native → Messages → compat), reports the cached count explicitly, and its NDJSON wire is the one the package can shape without a codec union change. Build the compat route as `compat.route: "openai"` for pi parity; do not ship Messages. Measured native reuse ≈0.996, so Task 3's `> 0.5` threshold is comfortably clear and `unmeasurable` is not the case.
    - **(d) Native wire probes (16 requests).**
      - Text streams `message.content` deltas; final chunk fields are exactly `model`, `created_at`, `message`, `done`, `done_reason`, `total_duration`, `prompt_eval_count`, `prompt_eval_cached_count`, `eval_count`. `done_reason` observed: `stop`, `length`.
      - Tools: native `tool_calls` on cloud carry a **server-generated `id`** (`call_tn83v5zc`) and `function.index`, with object `arguments`; they are not absent as the plan assumed. Assistant `tool_calls` replay with object `arguments` plus `role: "tool"` and `tool_name` works (reply: “The current weather in Paris is 18°C with clear skies.”; 96/102 cached).
      - Thinking: `think: "low"` on `gpt-oss:20b` streams `message.thinking` ("Compute 17*23 = 391.") before `message.content` ("17 × 23 = 391.").
      - Structured output: `format` with a JSON schema returned 200, but `gemma4:31b` wrapped the value in ```` ```json ```` fences. Task 2's structured-output path must strip fences or the test must pin a model that obeys the schema.
      - Image: base64 `images` on a user message returned 200 (“Red”) on `gemma4:31b`.
      - Overflow, all three routes with `gpt-oss:20b` and a ~144k-token prompt: status 400, body `prompt too long; exceeded max context length by 28996 tokens (ref: …)` (native flat `{"error":"…"}`; OpenAI and Anthropic envelopes wrap the same message). **It does not match the landed `CONTEXT_OVERFLOW_BODY`** (`context_length_exceeded|maximum context length|context window exceeds limit|prompt is too long`). Task 2 must add the vendor-neutral phrase (for example `exceeded max context length`) and pin the recorded body in `overflow_classified_per_supported_route`.
      - Errors: bad key → 401 `{"error":"Unauthorized"}`; unknown model → 404 `text/plain` carrying `{"error": "model 'definitely-not-a-model-xyz' not found. Try gemma4:31b-cloud, …"}`; 429 was not reached (generation requests are not the 10/min balance/usage endpoints).
    - **(e) Discovery.** `GET /api/tags` returned 25 models with fields `name`, `model`, `modified_at`, `size`, `digest`, `details`, `capabilities` (for example `gemma4:31b` → `completion, thinking, tools, vision`). `POST /api/show` returned `capabilities`, `details`, `model_info`, `modified_at`, `thinking`. Context lengths: `gemma4:31b` 262 144; `gpt-oss:20b` 131 072; `deepseek-v4.1-flash` 1 048 576; `kimi-k3` 1 048 576. Thinking: `gemma4:31b` `{values:[false,true], default:false}`; `gpt-oss:20b` `{values:["low","medium","high"], default:"medium"}`; `deepseek-v4.1-flash` and `kimi-k3` `{values:[false,"low","high","max"]}`; `mistral-large-4` has no `thinking` field. `GET /api/balance` returned `included.session {remaining_percent:97.62, resets_at:"2026-11-01T08:00:00Z"}`, `included.weekly {remaining_percent:99.12, resets_at:"2026-11-02T00:00:00Z"}`, `purchased {balance_usd:0}` — the documented legacy shape.
    - **(f) Reference harness.** Installed `pi-ollama-cloud` is 0.13.1, registering `baseUrl: https://ollama.com/v1` with `api: "openai-completions"`; no affinity header, no `prompt_cache_key`, no `cache_control` — the lever finding stands. `pi -p --mode json --provider ollama-cloud --model gemma4:31b` runs headless without config changes. **pi does report cache reads on this route:** cold run `usage {input:8819, cacheRead:0, totalTokens:8825}`; warm runs `{input:19, cacheRead:8800, totalTokens:8825}` (input is exclusive, as pi's convention). Recorded total durations: 1 919 / 2 166 / 1 903 ms (median 1 919). `--mode json` exposes no time-to-first-token field, so Task 3's plan 184 cell should compare `cacheRead` directly, with duration as a secondary bound; the 1.15 tolerance is consistent with the ~14% observed spread but still needs the owner's confirmation.
    - **(g) Release-path fit.** Plan 184 can now compare `cacheReadTokens` between Prism and pi on the same model/workload (previously assumed impossible); keep TTFT/duration as secondary. Plan 185 freezes the package and its new compat baseline when it is in-tree. Plan 186 gains a `providers/ollama-cloud` row on both routes, preflight for `OLLAMA_API_KEY`, and `ollamaCloudBalance()` above 10% session remaining. Plan 187 updates counts, adds the live name, and points the deprecated `ollama` package message at the cloud successor. Plan 194's landed overflow classifier does **not** match any of the three measured overflow bodies; Task 2's pattern addition is required before recovery can work.
    - **(h) Verdict: PASS.** The key reaches cloud models on all three routes, and native + compat both expose measurable reuse. Proceed to Task 2. No stop condition hit.

- [x] Task 2: `@arnilo/prism-provider-ollama-cloud`
  - **Status (2026-11-01): complete.** Package `packages/providers/ollama-cloud` ships the native route (default) and the OpenAI-compatible route; no generation spend was used. Live validation used the free metadata endpoints only: `/api/tags` + `/api/show` discovery (25 models, every context window resolved) and `/api/balance` (session 97.08%, weekly 98.92%, purchased $0). Offline wire recordings are synthesized from Task 1’s measured field shapes, because this task’s budget was free endpoints only; `error-429` is documented, not captured. Final package coverage 95.16% lines / 98.53% functions in two identical runs (24 tests each); root `typecheck` passes. Closeout evidence: `docs/_evidence/206-task2-verification.md`. Task-local checks pass; unrelated global coverage/peer-policy failures are explicitly recorded there, not waived.
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`). Config:

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `apiKey` | ref | `env:OLLAMA_API_KEY` | `secretRefProperty` |
        | `baseUrl` | string | `https://ollama.com` | the host root; shipped routes append `/api/chat` or `/v1/chat/completions` |
        | `models` | ModelConfig[] | — | when absent, `models()` uses `/api/tags` plus `/api/show` |
        | `route` | `"native"\|"openai"` | `native` (Task 1 (c)) | the per-model `compat.route` wins |

        Factory-only options: `id` (default `ollama-cloud`), `fetch`. A missing key gives a `warn` note, and the provider still registers.
      - **Native route** (`src/native.ts`), if Task 1 kept it:
        - **Body.** `{model, messages, stream: true, tools?, think?, format?, options?}`:
          - images as base64 `images` on user messages;
          - tool results as `role: "tool"` with `tool_name`;
          - assistant `tool_calls` replayed with object `arguments`;
          - thinking replayed as `message.thinking` when the model needs it, as measured in Task 1 (d);
          - `options.num_predict` from `maxOutputTokens`.
        - **Events.** NDJSON lines are parsed with a bounded line reader:
          - `content` → text deltas, `thinking` → thinking deltas;
          - `tool_calls` → tool calls using the server's `id` when present (cloud sends one), else a generated stable `call_<index>_<turn>`;
          - the final chunk → usage (`inputTokens = prompt_eval_count`, `cacheReadTokens = prompt_eval_cached_count`, `outputTokens = eval_count`, `total_duration` in `metadata.ollama`), then `done` with `done_reason` mapped.
          - An error line or a stream without `done: true` → a terminal classified error.
        - Abort is observed between lines.
      - **Compat route:** `openai-chat` on `/v1/chat/completions`. The codec omits `tool_choice` (unsupported); `reasoning_effort` is mapped per model. No cache fields and no affinity, matching pi.
      - **Messages route:** not shipped. Task 1 (c) chose native as the default and no reference harness uses `/v1/messages`; the codec remains available if a host later needs it.
      - **Thinking map:** levels per model come from `/api/show`. `none` maps to `think: false`. Boolean models: any other level → `true`. Named-level models: Prism levels snapped to the declared names.
      - **Errors:**
        - 401 → `auth`;
        - 404 or an unknown model → permanent, naming `/api/tags`;
        - 429 → `rate_limited`, or `quota` when the body names the session or weekly limit, with `Retry-After`;
        - 5xx → transient;
        - `{"error"}` bodies redacted.
        - **Context overflow (plan 194, landed).** The over-long-prompt body from Task 1 must classify `context_overflow` through the shared classifier (`src/provider-kit/transport.ts:31-47`, patterns as data).
          - If the body already matches `CONTEXT_OVERFLOW_BODY`, a test proves it. Otherwise the pattern list gains the vendor-neutral phrase, and `overflow_classified_per_supported_route` (`src/__tests__/context-overflow-recovery.test.ts`) gains the recorded body.
          - Errors are built with `providerHttpError` (`src/provider-kit/retry-http.ts`), so the class always comes from `classifyProviderFailure`, never hand-set. The native NDJSON route builds its HTTP and error-line failures the same way, so a native overflow line before output recovers once.
      - **Discovery:** `listOllamaCloudModels` reads `/api/tags`, then `/api/show` per model with bounded concurrency (4), mapping capabilities, context length, and thinking levels. Results are cached for the `models()` call only. The static `ollamaCloudModels` holds the Task 1 exemplars.
      - **Context windows.** Every static and discovered model declares `limits.contextWindow`, and `maxOutputTokens` when known. Plan 194's estimate fallback, context accounting, and window-relative OM gate read them. A model whose window is unknown is left undefined and listed in the README; it is never guessed.
      - **`ollamaCloudBalance({apiKey, fetch})`** returns `{session?, weekly?, purchasedUsd?}`. It is an exported helper for host and preflight use, and is never called during a run.
      - **Recordings:**
        - `src/__tests__/wire/native/`: `text`, `tool-loop`, `thinking`, `structured-output`, `image`, `cache` (3 turns), `error-401`, `error-unknown-model`, `error-429` (documented shape if not reproduced, and marked);
        - `src/__tests__/wire/openai/`: `text`, `tool-loop`, `cache`;
        - `wire/anthropic/` is not needed: that route is not shipped.

        Native conformance runs through the shared `assertProviderStreamConforms` and `assertNoSecretLeak` with `replayFetch`. The recordings-driven `providerConformance` is extended to accept a package-supplied stream recording format only if Task 1 (a) shows that is cheaper than calling the shared assertions directly.
      - `live.test.ts` runs `runProviderLiveScenarios` on the default route and on the compat route (`PRISM_LIVE_OLLAMA_CLOUD_MODEL`, `PRISM_LIVE_OLLAMA_CLOUD_THINKING_MODEL`).
    - Performance:
      - The NDJSON reader is bounded per line (1 MiB) and per stream (provider-kit limits).
      - Discovery cost is 1 + N requests, N bounded by the tag count. The README states it and recommends static `models` in production.
      - Importing evaluates no sibling.
    - Code Quality:
      - The opencode-go shape plus `native.ts`.
      - No `as any`.
      - Enforcement rows in this task: packaging lists and provider dirs, `install-smoke`, `package-truth.json`, `phase24-truth` count, `phase54-package-map`, coverage and e2e coverage, the live-matrix row `providers/ollama-cloud` (requires `PRISM_LIVE_PROVIDER_TESTS` and `OLLAMA_API_KEY`; model envs; a cost line), `live.env.example`, provider counts in the docs.
      - New baseline `scripts/compat-baseline/arnilo__prism-provider-ollama-cloud.txt`.
    - Security:
      - The key is ref-only.
      - Owned headers win.
      - The balance helper never returns or logs the key.
      - Recordings are scrubbed.
      - The README states Ollama's no-training statement and links the privacy policy.
  - Approach:
    - Documentation Reviewed:
      - Task 1 Notes; `docs/provider-kit.md` (shipping, conformance); the deleted 0.12 package; `packages/providers/opencode-go/src/*`.
    - Options Considered:
      - A provider-kit NDJSON codec. Rejected: one user. Revisit if a second NDJSON vendor ships.
      - Reusing the `ollama` package name. Rejected: that name implied local support, which the release line cannot live-test (no `ollama` binary on the dev machine), and its 0.3.x line was OpenAI-compat only. A new name keeps the cloud claim exact.
    - Chosen Approach:
      - A measured default route plus the pi-compatible route.
    - API Notes and Examples:
      ```ts
      import ollamaCloud from "@arnilo/prism-provider-ollama-cloud";
      const agent = await createAgent({ model: "ollama-cloud/gemma4:31b", packages: [ollamaCloud] });
      ```
    - Files to Create/Edit:
      - `packages/providers/ollama-cloud/**`; the enforcement-row files.
      - `scripts/deprecations-0.13.json`: the `@arnilo/prism-provider-ollama` message names the successor for cloud.
      - `scripts/retired-providers.test.mjs`: asserts that pointer.
      - `docs/index.md`, `docs/models.md`, `docs/release.md`, `packages/providers/README.md`, `bun.lock`, `CHANGELOG.md`.
    - References:
      - plans 183, 203.
  - Test Cases to Write:
    - `ollama_cloud_native_conformance` (recorded streams through the shared assertions).
    - `ollama_native_usage_maps_cached_count`: `prompt_eval_cached_count` → `cacheReadTokens`, and inclusive-input invariant holds.
    - `ollama_native_tool_calls_get_stable_ids_and_replay`.
    - `ollama_native_missing_done_is_error`.
    - `ollama_native_line_bound_enforced`.
    - `ollama_compat_omits_tool_choice_and_cache_fields`.
    - `ollama_thinking_map` (boolean model, named-level model, `none`).
    - `ollama_error_mapping` (401, unknown model, 429 rate vs quota).
    - `ollama_cloud_overflow_classified_and_recovered`: the recorded overflow body classifies `context_overflow`, and a session on a replaying mock compacts once and retries once.
    - `ollama_cloud_catalog_declares_context_windows`.
    - `list_ollama_cloud_models_bounded_concurrency`.
    - `ollama_cloud_balance_parses_and_hides_key`.
    - `ollama_missing_key_notes_and_registers`.
    - `ollama_deprecation_points_to_cloud_successor`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new provider package).
    - Docs pages to create/edit:
      - `packages/providers/ollama-cloud/README.md` (package page structure). It includes "Routes" (native default and why; the compat route for pi parity), "Prompt caching" (what is reported on which route, no request levers), "Plan limits" (`ollamaCloudBalance`), and "Discovery cost".
    - `docs/index.md` update: yes. "`@arnilo/prism-provider-ollama-cloud`: Ollama Cloud models (native and OpenAI-compatible routes) for Prism."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes:
    - **Files and exports.** `src/index.ts` (package/config/catalog wiring), `src/provider.ts` (route dispatch), `src/native.ts` (NDJSON body + bounded reader), `src/models.ts` (static exemplars, discovery, thinking map, balance). Named exports include `createOllamaCloudProvider`, `ollamaCloudNativeBody/Events`, `ollamaCloudModels`, `defineOllamaCloudModel`, `listOllamaCloudModels`, `mapOllamaCloudModel`, `ollamaCloudBalance`, `ollamaCloudThink`, and both route constants.
    - **Native route.** Body sends text, base64 images, native `thinking`, assistant `tool_calls` with object arguments (server `id` intentionally omitted on replay, as measured), `role: "tool"` + `tool_name`, JSON-schema `format`, and `options.num_predict`. Events map `message.content`, `message.thinking`, full `tool_calls` (server id, fallback `call_<index>_1`), and final usage (`prompt_eval_cached_count` → `cacheReadTokens`, `total_duration` → `usage.metadata.ollama.totalDurationNs`). Missing `done: true` is a terminal error; a 1 MiB NDJSON line cap fails closed.
    - **Structured output.** The measured `gemma4:31b` reply arrived in a whole-response ```` ```json ```` fence, so the native route buffers structured text and strips the fence before emitting it. Non-structured text still streams delta-by-delta.
    - **Compat route.** `openai-chat` on `/v1/chat/completions`; no `tool_choice`, no cache fields, no affinity, `reasoningReplay: "drop"` (the route does not expose thinking), `max_tokens`. A model’s `compat.route` wins over the package `route`.
    - **Discovery/limits.** `listOllamaCloudModels` does one `/api/tags` then `/api/show` per model with concurrency 4; maps capabilities (`vision` → image, `thinking` → reasoning, `tools`), `*.context_length`, and `/api/show` `thinking.values`. Static catalog holds the five Task 1 exemplars; unknown context windows stay undefined. `ollamaCloudBalance()` parses the recorded legacy shape and never returns/logs the key.
    - **Shared fixes required by the measurements.** `CONTEXT_OVERFLOW_BODY` now matches `exceeded max(?:imum)? context length`; quota classification recognizes `session limit` / `weekly limit`; `providerConformance` no longer treats native `/api/chat` as an OpenAI chat path; `runProviderLiveScenarios` accepts a `native` route.
    - **Enforcement rows updated.** `scripts/package-truth.json` (51 publishable / 50 workspace / 11 providers, regenerated docs + phase54 evidence), `scripts/phase24-truth.test.mjs`, `scripts/phase54-package-map.test.mjs`, `src/__tests__/{packaging,install-smoke,release}.test.ts`, `scripts/{live-matrix,live.env.example,e2e-coverage,coverage-thresholds}.json` (+ count tests), `docs/{index,models,release,migrate-to-0.13}.md`, `packages/providers/README.md`, `bun.lock`, and the new 33-symbol compat baseline `scripts/compat-baseline/arnilo__prism-provider-ollama-cloud.txt`.
    - **Closeout.** Regression tests fixed native wire tool-name replay and reader cancellation before lock release; structured-output accumulation now has the provider-kit 512 KiB cap. Added the explicit retired-Ollama deprecation-pointer test and the root changelog entry. Fixed threshold nesting and recorded a measured 92.16% line floor (95.16% minus 3pp) plus the new package's coverage artifact row; older workspace evidence was not relabeled as fresh. Final packaging/install checks passed 294/294 with a 30-second per-test timeout after default-timeout failures under concurrent host load. Full root typecheck and package-local Biome pass. Global `phase23-coverage` remains red on older providers/retired artifact rows; full global coverage regeneration is outside this task. See `docs/_evidence/206-task2-verification.md`.
    - **Validation.** Final package tests 24/24; `context-overflow-recovery` + `provider-transport` 56/56; `packaging` 279/279; `release` + `e2e-coverage`; `live-matrix`, `live-doc-check`, `phase54-package-map`, `retired-providers`, `install-smoke`, `docs`, `provider-kit`, `provider-live-scenarios` all green. Unrelated pre-existing failures observed in the working tree: `phase24-truth` peer-policy (unexpected `@arnilo/prism-evals` peer) and `tooling-gate` node:test imports; neither touches this package.
    - **Deviations.** No Anthropic Messages route (Task 1 (c) chose native; no host uses `/v1/messages`). Recordings are synthetic, not live captures; Task 5 owns the live evidence file. A live 429 was not reproduced; its documented shape is in the recording and the classifier tests.

- [x] Task 3: Cache parity with pi-ollama-cloud — equivalence, probe, parity-suite cell
  - Acceptance Criteria:
    - Functional:
      - `cache_levers_match_pi_ollama_cloud` (offline): on plan 203's 3-turn fixture, the compat route sends exactly pi's cache-relevant fields (none), and every route keeps tools, system text, and earlier messages byte-identical across turns. The default route sends no fewer levers than pi.
      - `provider-probe.mjs --provider ollama-cloud --model <exemplar> --turns 4` runs on the default route and on the compat route.
        - **Threshold:** default-route reuse > 0.5 on turns 2–4; Task 1 measured ≈0.996, and compat reported the same reuse through `prompt_tokens_details.cached_tokens`.
        - On the compat route, the probe reads `prompt_tokens_details.cached_tokens` (available on cloud) and reports time to first token per turn.
      - Plan 184 is amended with one `ollama-cloud` cell, Prism against `pi -p --mode json --provider ollama-cloud`, on the same model and workload. **Metric**, stated in the cell, now that Task 1 proved both harnesses can observe reuse:
        - (i) Prism's `cacheReadTokens` ≥ pi's `cacheRead` on the same 4-turn workload (pi's input is exclusive of cache reads; compare the cache-read totals);
        - (ii) median time to first token on turns ≥ 2, recorded for both harnesses, with Prism ≤ pi × 1.15. Task 1 measured pi's total-duration spread at ~14% and `--mode json` exposes no TTFT field, so the owner confirms whether to use total duration or the probe's TTFT for this secondary bound.
    - Performance: about 8 requests per probe run, stated in the matrix.
    - Code Quality: plan 203's probe gains time-to-first-token reporting if it lacks it, as an additive flag.
    - Security: the probe prints no key.
  - Approach:
    - Documentation Reviewed:
      - plan 203 Task 5; plan 184; Task 1 (f): pi-ollama-cloud 0.13.1 reports `cacheRead` on its compat route, contrary to its README:71.
    - Options Considered:
      - Claiming parity because pi sends no levers. Rejected: it proves nothing about reuse. Measured cache reads on both harnesses and time to first token are the observable evidence.
      - Comparing cached tokens against pi. **Accepted** after Task 1 (f) measured `cacheRead` on pi's compat route, contrary to the package README; use the direct comparison.
    - Chosen Approach:
      - Equivalence, a measured probe, and a stated latency-backed cell.
    - API Notes and Examples:
      ```sh
      timeout 900 bun scripts/cache-parity/provider-probe.mjs --provider ollama-cloud --model gemma4:31b --turns 4 --ttft
      ```
    - Files to Create/Edit:
      - `packages/providers/ollama-cloud/src/__tests__/cache-levers.test.ts`; `scripts/cache-parity/provider-probe.mjs` (the `--ttft` flag, if missing) and its test; `plans/184-…md`.
    - References:
      - plan 203 Task 5.
  - Test Cases to Write:
    - `cache_levers_match_pi_ollama_cloud`.
    - `provider_probe_ttft_flag` (offline, with a fake clock).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: the probe's `--ttft` flag.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  **Notes (2026-11-01).** Done, with one design decision that supersedes the criterion text above:

  - **Condition (ii) needs no owner decision.** Installed pi 1.4.0 in `--mode json` does emit
    `message_update.assistantMessageEvent.text_delta`, so a run-scoped extension measured pi's
    first text directly. No total-duration substitution, and no choice was made on the owner's
    behalf. Pi's TTFT clock starts at `before_provider_request`; Prism's starts before `generate`
    and so includes more preparation.
  - **Offline equivalence:** the reference request set was captured, not hand-written, by driving
    installed pi-ai 1.4.0 / `pi-ollama-cloud` 0.13.1 offline (an `onPayload` hook throws before any
    network call), so the comparison cannot drift from the shipped pi codec. Result: pi sends no
    cache or affinity lever on this route, both Prism routes send none either, and tools, system
    text and earlier messages stay byte-identical across turns even when callers request cache
    hints. Prism's non-lever wire differences (its own `stream`/NDJSON shape, no `stream_options`,
    `think` instead of `reasoning_effort`) were left alone because they are not cache levers.
  - **Measured, exactly 12 generation requests** (`gemma4:31b`, four turns each for pi, native,
    compat): both routes report reuse **1.00227** (threshold > 0.5) and **33,504** cache-read
    tokens over four turns versus pi's **25,088**. Pi ran first, so the warm-only check also passes
    without ordering help: **25,152 ≥ 25,088**. Median warm text TTFT: native 726.62 ms, compat
    716.59 ms, pi 2,206.59 ms, both inside pi × 1.15 (2,537.58 ms).
  - **Probe changes are additive:** `--ttft` (per-turn first-text time, `null` when no text, never
    zero) is opt-in and leaves existing reports and filenames unchanged; `--route native|openai` is
    Ollama-only and keeps route evidence from overwriting itself. `OLLAMA_API_KEY` is read from the
    env; nothing is printed. `provider_probe_ttft_flag` pins the flag with a fake clock.
  - **Plan 184** gained the one amended cell plus a dated amendment paragraph; its other cells and
    its three-run coding-task gate are untouched, and this work does not complete or waive any plan
    184 task.
  - Evidence and caveats: `docs/_evidence/206-task3-cache-parity.md`; route JSON and the pi
    comparison in `docs/_evidence/cache-probe/`. No rate limit or auth failure occurred; session
    balance moved 100% → 98.6%, weekly 98.92% → 98.4%.

- [x] Task 4: Roadmap and release-path rows
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md` Phase 5 and the §2.9 row add `ollama-cloud` (owner decision 2026-10-25).
      - Plans 185 (`SecretSource` migration and shape baseline), 186 (strict `providers/ollama-cloud` row, both routes; preflight key check plus `ollamaCloudBalance` showing more than 10% session remaining), and 187 (counts; the new name needs no deprecation; the `ollama` message is updated) get "Amended 2026-10-25 by plan 206".
      - `plans/README.md` descriptions are updated.
      - The sweep `rg -n "prism-provider-ollama\b" src packages apps scripts examples docs -g '!docs/history' -g '!docs/_evidence'` lists every hit as allowlisted or updated.
    - Performance: n/a.
    - Code Quality: only unchecked tasks are edited.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plans 184–187.
    - Options Considered:
      - n/a: required rows.
    - Chosen Approach:
      - Enumeration amendments.
    - API Notes and Examples:
      ```markdown
      **Amended 2026-10-25 by plan 206 (Ollama Cloud ships).** …
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `plans/{185,186,187}-…md`, `plans/README.md`.
    - References:
      - plan 203 Task 6.
  - Test Cases to Write:
    - `docs.test.ts` plans-index check (existing).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  **Notes (2026-11-01).** Done, with one deliberate deviation from the criterion text:

  - **The roadmap's 0.13.0 ship set is unchanged.** The criterion says to add `ollama-cloud` to Phase 5 and the §2.9
    row, but the 2026-10-25 owner decision defers it past 0.13.0. So `ollama-cloud` joined the §2.9 catalog row's
    braced package list with the same wording `commandcode` uses ("land in the first release after 0.13.0"), and
    Phase 5 now records that plan 206 built the package in-tree on 2026-11-01 while its publication stays
    post-0.13.0. 0.13.0 still publishes nine providers; the deferral paragraph and the release-path exclusion are
    untouched.
  - **Amendments added:** plan 185 (freeze set is the nine plus `commandcode` and `ollama-cloud`; the
    `arnilo__prism-provider-ollama-cloud.txt` baseline is added and regenerated; Task 3's `SecretSource` list gains
    `src/{provider,models}.ts`; the retirement table is eleven packages, ten `SecretSource` consumers), plan 186
    (row `providers/ollama-cloud` with both routes, `OLLAMA_API_KEY`, `ollamaCloudBalance` above 10% session before a
    strict run, `listOllamaCloudModels` under `--probe`; not part of the 0.13.0 gate), plan 187 (`ollama-cloud` absent
    from the retired names and from deprecations, `ollama` stays on the sweep with its successor pointer, counts are
    51 publishable / 50 workspaces / eleven provider packages while the cut publishes nine).
  - **`plans/README.md`** descriptions updated for plans 206 and 205 and the release-path paragraph; plan 206 is now
    `complete (2026-11-01; publication post-0.13.0)`.
  - **Sweep** `rg -n "prism-provider-ollama\b" src packages apps scripts examples docs -g '!docs/history' -g '!docs/_evidence'`:
    every hit is the new `ollama-cloud` name (expected/allowlisted) or the retired `ollama` name in its deprecation
    record, its test, and the package-map retirement entry. Nothing stale.
  - **Chore caught:** `docs/_evidence/phase54-package-map.md` was stale after Task 2 added the package (manifest count
    50 → 51 and the new catalog row). Regenerated with `bun scripts/phase54-package-map.mjs --write`. The generated
    table already lists the package's future baseline path; the file itself is plan 185 Task 4's.
  - **Tests:** `docs.test.ts`, `live-doc-check.test.mjs`, `live-matrix.test.mjs`, `retired-providers.test.mjs`,
    `phase54-package-map.test.mjs`, `release.test.ts` — 135 passed, 0 failed. `phase24-truth.test.mjs` still fails on
    the pre-existing unrelated `@arnilo/prism-evals` peer (recorded in Task 2), not suppressed here.

- [x] Task 5: Live acceptance on both routes (the owner provides the key)
  - Acceptance Criteria:
    - Functional:
      - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ollama-cloud bun run test:live` passes on the default and compat routes: text, tool loop, thinking on the thinking exemplar, structured output, image on a vision model, abort, leak scan.
      - A `createAgent` smoke (a 2-turn session with one tool) passes on the default route.
      - `provider-probe.mjs` results are recorded against the Task 3 thresholds.
      - `ollamaCloudBalance()` runs once before and once after the run.
      - `docs/_evidence/ollama-cloud-live-<date>.md` records models, request counts, balance before and after, reuse and time-to-first-token figures, and the leak scan.
    - Performance: at most 50 requests. Measured counts correct the matrix `cost` line.
    - Code Quality: defects get a fixture, a test in the owning file, and a fix.
    - Security: `scan-secrets` passes. `live.env` is checked for mode `0600` first.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md`; plan 196 Task 2.
    - Options Considered:
      - Default route only. Rejected: the compat route is the pi-parity baseline and must work.
    - Chosen Approach:
      - Strict row on both routes, a kernel smoke, the probe, and the balance check.
    - API Notes and Examples:
      ```sh
      timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ollama-cloud bun run test:live
      ```
    - Files to Create/Edit:
      - `packages/providers/ollama-cloud/src/__tests__/live-agent.test.ts`; `docs/_evidence/ollama-cloud-live-<date>.md`; the `scripts/live-matrix.json` cost line.
    - References:
      - Tasks 2–3.
  - Test Cases to Write:
    - `live-agent.test.ts` (skips without the key).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  **Notes (2026-11-01).** Done: 1 suite ran, 0 skipped, 0 failed — 13 passed, 0 skipped (13 tests, 33.68 s) — via
  `PRISM_LIVE_ENV_FILE=/home/arn/.config/prism/live.env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ollama-cloud bun run test:live`.
  Evidence: `docs/_evidence/ollama-cloud-live-2026-11-01.md`.

  - **Covered per route:** text with leak scan, 2-turn tool loop with thinking replay, abort before the first request,
    3-turn prefix-cache probe (native 284/284 read, compat 224/224), structured output as pure JSON with the route's
    `structuredPrompt`, and the route's `errorModel` returning a named error. Package legs: a 3-turn `createAgent` smoke (tool echo, then the tool result read back, then an
    image turn answering "red" on `gemma4:31b`).
  - **Two real findings.** (1) The compat route honoured `response_format` but still fenced the JSON, so the new code path
    buffers structured text under the provider-kit 512 KiB cap and strips the fence before `usage`/`done`; pinned offline by
    `ollama_openai_route_strips_json_fence_for_structured_output` and live by the shared `live_structured_output` scenario. (2) The
    shared live harness's schema-less structured prompt makes every measured cloud model answer in prose, and the cloud accepts an
    empty `messages` array. Rather than skip, the harness gained the follow-up hooks (see below) and this row now runs the shared
    structured-output and error scenarios on both routes with `structuredPrompt` and `errorModel`. Final strict run: 13 passed,
    **0 skipped**, 0 failed.
  - **Cost:** 19 generation requests from the suite vs the 50 ceiling; four fence/prompt diagnostic probes (~10 requests) ran
    separately and are counted in the balance. Session 100% → 99.66%, weekly 98.40% → 98.27%. Matrix `cost` updated with the
    measured 19. Probe thresholds are Task 3's same-day numbers, recorded rather than re-spent.
  - **Checks:** package coverage 95.35% lines / 98.53% functions, above the 92.16% floor; `bun run typecheck` clean;
    `biome check` clean; `scan-secrets` over the new files 0 findings.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-provider-ollama-cloud test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts`
- `timeout 600 bun test --timeout=0 scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/retired-providers.test.mjs scripts/cache-parity/provider-probe.test.mjs`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ollama-cloud bun run test:live` (owner key; Task 5)

## Compromises Made

- **The shared-harness hooks landed here instead of a separate follow-on plan.** `LiveRouteConfig` gained
  `structuredPrompt` and `errorModel` in `src/testing/provider-live-scenarios.ts` (plan 183 amended), so this row
  runs the shared `structured-output` and `error` scenarios instead of skipping them; the interim
  `live-wire.test.ts` was deleted once the hooks landed.
- **Task 5 records Task 3's probe thresholds instead of re-spending the probe.** Same model, workload, and day;
  re-running would add 8 generation requests for no new evidence.
- **`/v1/messages` is not shipped** (Task 1 measurement showed nothing it adds over the native route). The
  package, README, roadmap, and release docs say two routes.
- **Structured-output capability is a wire claim, not a model-obedience guarantee.** Both routes send the schema
  lever; whether a model emits JSON depends on its prompt handling, so the live checks use a concrete prompt and
  the README should not be read as promising enforcement for arbitrary prompts.
- **The package's compat baseline file is plan 185 Task 4's.** The generated package-map evidence lists its path
  now (the package is in the tree); the file itself is created when the freeze set is regenerated.
- **The pi comparison is a bounded diagnostic**, not plan 184's three-run coding-task gate; plan 184 records it as
  such and none of its tasks are completed or waived.

## Further Actions

- **P1 — shared live harness hooks: done 2026-11-01.** Optional `structuredPrompt` and `errorModel` per route in
  `LiveRouteConfig`, threaded through `runProviderLiveScenarios` and `executeProviderLiveScenarios`; pinned by
  `live_scenarios_use_per_route_structured_prompt_and_error_model`. Plan 183 carries the amendment.
- **P1 — structured-output prompt sensitivity: done 2026-11-01.** `gemma4:31b` and `gpt-oss:20b` obey a
  schema-restating prompt 12/12 (three concrete phrasings, two reps each) but the shared schema-less prompt 0/4 —
  both models answered "no schema provided" even though the schema was on the wire. `kimi-k3`, outside the Free
  plan, was refused 8/8 with 402 "not included in your free usage" (`permanent`), so obedience there is unmeasured
  on a credit-free key. Stated in the package README's new Structured output section; evidence
  `docs/_evidence/ollama-cloud-structured-prompt-2026-11-01.json` from the committed probe. 28 requests total.
- **P2 — matrix env-file fallback: done 2026-11-01.** `scripts/live-matrix.mjs` now defaults to
  `~/.config/prism/live.env` (owner decision: always outside the repo) and never reads `scripts/live.env`;
  `scripts/cache-parity/provider-probe.mjs` and `scripts/decision-bench.mjs` dropped their in-repo candidate
  too. The report's `env file:` line records the path actually used. `scripts/live.env.example` and
  `docs/live-testing.md` describe the out-of-repo install (`install -m 600 … ~/.config/prism/live.env`).
  Pinned by a test with a temp `HOME` plus a source guard that no runner names a checkout path. No
  `scripts/live.env` exists in the tree; `.gitignore` and the secret-scan carve-out stay as defence.
- **P2 — local `ollama serve` provider**, Ollama web search/fetch tools, System One decisions, cloud usage
  histograms, and the stateless `/v1/responses` route (already listed as scope exclusions).
