# Phase 11 Part AD — Ollama Cloud provider (deferred past 0.13.0)

## Objectives

- Ship `@arnilo/prism-provider-ollama-cloud` **in the release after 0.13.0** for Ollama's hosted cloud models (`https://ollama.com`, API key). It is thoroughly live-tested.
- Choose the wire by evidence:
  - the **native `/api/chat`** reports cached prompt tokens (`prompt_eval_cached_count`);
  - the **OpenAI-compatible `/v1/chat/completions`**, which the reference harness `pi-ollama-cloud` 0.13.1 uses, reports none;
  - the **Anthropic-compatible `/v1/messages`** lists `cache_control`.

  Ship the measurable default route plus the pi-compatible route.
- Reach **prompt-cache parity with pi plus `pi-ollama-cloud`**. Send at least every lever it sends (it sends none), keep the prefix byte-stable, and measure provider-level reuse. Add an Ollama Cloud cell to the standing parity suite (plan 184) with an honestly stated metric, because the reference harness cannot observe cache reuse on its route.
- Expose Ollama's plan limits (`/api/balance` session and weekly windows) for preflight checks.

## Expected Outcome

- `createAgent({ model: "ollama-cloud/<model id>", packages: [ollamaCloud] })` streams text, tools, thinking, structured output, and images on the default route. Model ids come from `https://ollama.com/api/tags`, for example `gemma4:31b`. Usage includes `cacheReadTokens` wherever the cloud reports it.
- `compat.route: "openai"` selects `/v1/chat/completions` with the same behaviour as pi-ollama-cloud.
- `provider-probe.mjs` shows cache reads on turns 2–4 on the default route, or records `unmeasurable` with evidence if the cloud never reports them.
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
| Native API | `POST /api/chat` streams **NDJSON**: `message.{content, thinking, tool_calls}`, `done`. The final chunk carries `prompt_eval_count`, **`prompt_eval_cached_count`** ("prompt tokens read from the cache"), `prompt_eval_duration` ("uncached prompt tokens"), `eval_count`, and durations in nanoseconds. `GET /api/tags` lists models; `POST /api/show` gives capabilities and context | Not SSE and not OpenAI-shaped, so a package-local codec |
| OpenAI compat | `https://ollama.com/v1/chat/completions` supports streaming, `stream_options.include_usage`, tools, vision (base64 only), `response_format`, `reasoning_effort`, and `reasoning.effort`, but **not `tool_choice`**. Cloud: no stateful Responses, no custom or freeform tool replay. pi-ollama-cloud README: "The completion API does not report cached-token usage" | The provider-kit `openai-chat` codec fits, but caching is unobservable |
| Anthropic compat | `/v1/messages` lists prompt caching with `cache_control` blocks | A candidate measurable route. Task 1 probes it on cloud |
| Thinking | `reasoning_effort` names are model-defined (from `/api/show`). Boolean-only models map efforts to true, and `none` to false. GPT-OSS maps `minimal` → `low`, `xhigh` → `high`. Native: `think: true\|false\|"low"\|"medium"\|"high"` | A per-model thinking map from discovery |
| Limits | `GET /api/balance` → `included.{session,weekly}.{remaining_percent, resets_at}` on legacy plans, plus `purchased.balance_usd`. The balance and usage endpoints allow 10 requests per minute per user, with `Retry-After` on 429 | An `ollamaCloudBalance()` helper. 429 mapping |
| **Cache levers — pi + pi-ollama-cloud 0.13.1** | `registerProvider("ollama-cloud", {baseUrl: "https://ollama.com/v1", api: "openai-completions"})` (`index.ts:79-86`). pi then sends **no session-affinity headers** (only OpenRouter gets them, `openai-completions.js:544,1305`), **no `prompt_cache_key`** (only `api.openai.com`, `:580-583`), and no `cache_control`. **No levers at all**; caching is whatever Ollama's server-side KV reuse gives | Parity by construction: Prism must send no fewer levers, and keep a byte-stable prefix |
| Prior Prism code | The 0.12 package used the compat route, with `cacheReadTokens` "intentionally left undefined" (`provider.ts` doc comment) | The native route can do better |

## Tasks

- [ ] Task 1: Phase review — route choice by measurement, discovery, thinking, limits, and errors (read-only, live probes)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Placement:**
        - the package is `packages/providers/ollama-cloud`;
        - the native NDJSON codec is package-local (`src/native.ts`), because it is vendor wire with one user. The package implements `ModelProvider.generate` directly on provider-kit primitives (`resolveProviderApiKey`, `httpStatusError`, `readBoundedResponseText`, `providerError`, usage normalization), unless `createRoutedProvider` already accepts a custom format, which the review checks (`routed-provider.ts:24-60`);
        - the compat route uses `openai-chat`, and the Messages route, if chosen, uses `anthropic-messages`;
        - the enforcement-row list.
      - (b) **Cache measurement**, the decisive probe. On two cloud models (one tool-capable instruct model and one thinking model from `/api/tags`), send the same 3-turn transcript with a stable prefix of about 3K tokens on each of the three routes, and record:
        - native `prompt_eval_cached_count` and `prompt_eval_duration` per turn;
        - compat usage (confirm no cached field);
        - Messages `cache_read_input_tokens` with and without `cache_control`.

        Repeat once after 2 minutes to see cache lifetime. At most 24 requests.
      - (c) **Route decision:** the default route is the one with measured reuse, preferring native, then Messages, then compat. If no route reports reuse, the default is native (it still reports `prompt_eval_duration`), and Task 3 records `unmeasurable`.
      - (d) **Native wire probes**, at most 15 requests:
        - text; tools (native `tool_calls` with object `arguments`) and a tool-result turn; `think` on a thinking model (the `message.thinking` stream); `format` with a JSON schema; one image (base64 `images`);
        - the final-chunk field list; `done_reason` values;
        - an over-long prompt on each route (the overflow body for the shared classifier);
        - error bodies (`{"error": "…"}`) for a bad key, an unknown model, and 429 if reached.
      - (e) **Discovery:** `/api/tags` and `/api/show` fields (capabilities `tools`, `thinking`, `vision`, and `completion`; `model_info.*.context_length`; thinking levels), against pi-ollama-cloud's generated tables. Also `GET /api/balance` shape on the owner's plan.
      - (f) **Reference harness:** pi-ollama-cloud version and the lever finding re-verified. `pi -p --mode json --provider ollama-cloud --model <id>` runs headless; record what `usage` it reports (expected: `cacheRead` 0 or absent) and its time to first token. This defines the plan 184 cell's metric (Task 3).
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
      - Copying pi-ollama-cloud's compat-only route. Rejected as the only route: caching would be unobservable, so neither parity nor a regression could be measured. It is kept as `compat.route: "openai"` for like-for-like comparison.
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

- [ ] Task 2: `@arnilo/prism-provider-ollama-cloud`
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`). Config:

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `apiKey` | ref | `env:OLLAMA_API_KEY` | `secretRefProperty` |
        | `baseUrl` | string | `https://ollama.com` | the host root; routes append `/api/chat`, `/v1/chat/completions`, or `/v1/messages` |
        | `models` | ModelConfig[] | — | when absent, `models()` uses `/api/tags` plus `/api/show` |
        | `route` | `"native"\|"openai"\|"anthropic"` | the Task 1 (c) default | the per-model `compat.route` wins |

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
          - `tool_calls` → tool calls with generated stable IDs (`call_<index>_<turn>`), because Ollama sends none;
          - the final chunk → usage (`inputTokens = prompt_eval_count`, `cacheReadTokens = prompt_eval_cached_count`, `outputTokens = eval_count`, durations in `metadata.ollama`), then `done` with `done_reason` mapped.
          - An error line or a stream without `done: true` → a terminal classified error.
        - Abort is observed between lines.
      - **Compat route:** `openai-chat` on `/v1/chat/completions`. The codec omits `tool_choice` (unsupported); `reasoning_effort` is mapped per model. No cache fields and no affinity, matching pi.
      - **Messages route** (only if Task 1 (b) found measurable reuse there): `anthropic-messages` on `/v1/messages`, with cache breakpoints `system_prompt`, `tools`, and `last_message` within the accepted count.
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
        - `wire/anthropic/`, if that route is chosen.

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

- [ ] Task 3: Cache parity with pi-ollama-cloud — equivalence, probe, parity-suite cell
  - Acceptance Criteria:
    - Functional:
      - `cache_levers_match_pi_ollama_cloud` (offline): on plan 203's 3-turn fixture, the compat route sends exactly pi's cache-relevant fields (none), and every route keeps tools, system text, and earlier messages byte-identical across turns. The default route sends no fewer levers than pi.
      - `provider-probe.mjs --provider ollama-cloud --model <exemplar> --turns 4` runs on the default route and on the compat route.
        - **Threshold:** default-route reuse > 0.5 on turns 2–4 if Task 1 (b) measured reuse. Otherwise the probe records `unmeasurable` with Task 1's evidence, and the README states that Ollama Cloud does not report cache reuse on any route.
        - On the compat route, the probe records `prompt_eval_duration` as unavailable and reports time to first token per turn.
      - Plan 184 is amended with one `ollama-cloud` cell, Prism against `pi -p --mode json --provider ollama-cloud`, on the same model and workload. **Metric**, stated in the cell, because pi's route cannot observe cache reuse:
        - (i) Prism's reuse from native counts ≥ the probe threshold;
        - (ii) median time to first token on turns ≥ 2, recorded for both harnesses, with Prism ≤ pi × 1.15. This tolerance is set from Task 1 (f)'s variance, and the owner confirms it in Task 1's verdict.
    - Performance: about 8 requests per probe run, stated in the matrix.
    - Code Quality: plan 203's probe gains time-to-first-token reporting if it lacks it, as an additive flag.
    - Security: the probe prints no key.
  - Approach:
    - Documentation Reviewed:
      - plan 203 Task 5; plan 184; pi-ollama-cloud README:71 (no cached-token usage on its route).
    - Options Considered:
      - Claiming parity because pi sends no levers. Rejected: it proves nothing about reuse. The native counts and time to first token are the observable evidence.
      - Comparing cached tokens against pi. Rejected: pi's route reports none.
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

- [ ] Task 4: Roadmap and release-path rows
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

- [ ] Task 5: Live acceptance on both routes (the owner provides the key)
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

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-provider-ollama-cloud test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts`
- `timeout 600 bun test --timeout=0 scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/retired-providers.test.mjs scripts/cache-parity/provider-probe.test.mjs`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ollama-cloud bun run test:live` (owner key; Task 5)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
