# Phase 11 Part AC — Command Code provider (deferred past 0.13.0)

## Objectives

- Ship `@arnilo/prism-provider-commandcode` **in the release after 0.13.0** on Command Code's documented Provider API (`https://api.commandcode.ai/provider/v1`). It is thoroughly live-tested on **all three wires** the API serves:
  - OpenAI Chat Completions, for open models;
  - OpenAI Responses, for models that advertise `/responses`;
  - Anthropic Messages, for Claude models.
- Reach **prompt-cache parity with pi plus `pi-commandcode-provider` 0.7.10** (the owner's installed reference harness), per wire. Measure provider-level prefix reuse on each wire, and add Command Code cells to the standing parity suite (plan 184).
- Map Command Code's catalog (`supported_endpoints`), ZDR routing, plan errors, and pricing (cache read and write rates) faithfully.

## Expected Outcome

- `createAgent({ model: "commandcode/<model id>", packages: [commandcode] })` streams text, tools, reasoning, structured output, and images where the model supports them. The route is chosen from the model:
  - `claude-*` → `/messages`;
  - catalog `supported_endpoints` includes `/responses` → `/responses`;
  - otherwise → `/chat/completions`.

  This is pi-commandcode-provider's rule (`src/models.ts:156-161`).
- Cache levers equal the reference harness on each wire, which an offline test proves:
  - **Responses:** `prompt_cache_key` = session key (64-char clamp) and `x-client-request-id`, with no `session_id` header.
  - **Messages:** `cache_control` on the system prompt and the last message, **not on tools**, with no `ttl`.
  - **Chat:** no cache fields (implicit prefix caching).
- `provider-probe.mjs` shows cache reads on turns 2–4 on one model per wire. The parity suite gains Command Code cells.
- `providers/commandcode` is an active live row with three route legs, passing strict. `docs/_evidence/commandcode-live-<date>.md` records the run, the spend, and the probe figures.

This plan implements the **owner decision of 2026-10-25** (Command Code is thoroughly live-tested and reaches prompt-cache parity), **amended 2026-10-25: Command Code does not ship in 0.13.0**. The owner deferred this provider and Ollama Cloud (plan 206) to the first release after 0.13.0. The 0.13.0 provider set is unchanged, and this plan no longer gates plan 184, plan 185's freeze, plan 186, or plan 187. It changes roadmap **Phase 5** when it runs.

- **Release path:** **not on the 0.13.0 path.** It was the third of four provider plans (203 → 204 → 205 → 206); 203 and 204 still run right after plan 194, and this plan runs after 0.13.0 ships. The plan 194/204 dependencies below stay as written.
- **Plan 194 (Tasks 1–5 landed, 6–7 in progress):** the `context_overflow` failure class and its body patterns (`src/provider-kit/transport.ts:31-47`), the estimate-vs-window fallback (`contextOverflowEvidence`, `src/agent-session/session/provider-round.ts:203-229`), one compaction-and-retry recovery (`src/agent-session/context-overflow.ts`), fold batch clearing, and context accounting are in the tree.
  - This plan feeds its routes' overflow evidence into them directly instead of amending 194.
  - It declares accurate context windows, which the fallback, the accounting, and 194 Task 7's window-relative OM gate read.
  - 194 Tasks 6–7 (the rot curve on Hyper and OpenCode Go models, and reference-host triggers) need nothing from this plan.
- **Dependencies:** plan 204 Task 3 (the `openai-responses` route format; this plan is its second user) and plan 203 (the provider probe, the chat-wire `cache_control` support, and `mapUsage(usage, chunk)`).
- **Review:** it creates a package, so **Task 1 is the phase review** (no kernel contract change expected).
- **Keys:** `~/.config/prism/live.env` gains `COMMAND_CODE_API_KEY` (the name `scripts/live.env.example:44` already uses). The owner's pi already holds a Command Code credential; the executor never copies it and asks the owner to add the key.
- **Spend:** live calls bill Command Code credits (the Provider plan is pay-as-you-go). Task 1 states the spend (expected under $0.30 for the review plus the live run), and the owner approves it.
- **Reference host impact:** none.
- **Prior art:** plan 055 researched Command Code (catalog, cache families, ZDR, errors), and its 0.12 package was deleted by plan 182 (`git show 14009176^:packages/providers/commandcode/`). The name was never published to npm, so it needs no deprecation entry.

**Scope exclusions (Further Actions candidates):**
- The CLI's private "generate" transport, which pi-commandcode-provider falls back to on `403 upgrade_required` for Go plans. It is undocumented.
- Browser-assisted Studio key transfer, a local callback that receives the key.
- Command Code's `/systemone` decisions endpoint (`typesafe/jev` is already shipped by `@arnilo/prism-provider-typesafe`).
- The billing and usage endpoints.

## Research summary (2026-10-25)

Sources:
- Command Code docs `commandcode.ai/docs/provider` and `/docs/resources/pricing-limits`;
- plan 055's research section;
- `~/.pi/agent/npm/node_modules/pi-commandcode-provider` 0.7.10 (`index.ts`, `src/models.ts`);
- pi 1.4.0 (`api/openai-responses.js`, `api/anthropic-messages.js`, `api/openai-completions.js`).

| Topic | Finding | Consequence |
| --- | --- | --- |
| Base and auth | `https://api.commandcode.ai/provider/v1`. `Authorization: Bearer <key>` on every route, and `x-api-key` also accepted on `/messages`. Keys come from Studio (`commandcode.ai/settings/keys`) | One provider with three routes |
| Routes | `POST /chat/completions` (OpenAI and open models), `POST /responses` (most OpenAI and open models; advertised per model), `POST /messages` (Claude only; other wires return 400), `GET /models` (public; `supported_endpoints`, `context_length`, `name`), `POST /systemone` (decisions) | `routeFor` follows the pi rule plus the catalog |
| Streaming and usage | Usage on every stream: the final chunk on Chat, `response.completed` on Responses, `message_delta` on Messages | All three codecs already read these |
| ZDR | `x-cmd-zdr: 1` restricts to ZDR upstreams. With none it fails `422 cmd_zdr_no_providers` and never falls back. On `/messages` it is accepted but does not change routing. With ZDR, Responses accepts only `function`, `custom`, and `local_shell` tools | `zdr` config. A provider-owned header |
| Errors | OpenAI envelope on Chat and Responses, Anthropic envelope on Messages.<br>400 `unsupported_model` and `invalid_request_error`; 401 `authentication_error`; **403 `upgrade_required`** (the Go plan has no API); 422 `cmd_zdr_no_providers`; 429 `rate_limit_error` (upstream); 5xx carries the upstream's message | Route-native error mapping |
| Pricing (USD per 1M tokens) | Cache read on all models. Cache write only on explicit-cache families: Claude (for example Sonnet 4.6 $3.75 write against $0.30 read), GPT-5.6 Sol, Terra, and Luna, Qwen 3.8 Max and 3.7 Flash.<br>"Open-source models are routed across multiple upstream providers", so cost and cache affinity vary per upstream.<br>DeepSeek has peak and off-peak rates. Plans have rolling 5-hour and weekly credit windows; Provider pay-as-you-go has none | `ModelConfig.cost` with cache rates. The README states the upstream-routing caveat |
| **Cache levers — pi + pi-commandcode-provider 0.7.10** | **Responses:** compat `sessionAffinityFormat: "openai-nosession"`, `supportsLongCacheRetention: false` (`index.ts:121-128`). pi then sends `prompt_cache_key = clamp(sessionId)` (`openai-responses.js:267`) and `x-client-request-id` only (`:224-232`); `store: false`.<br>**Messages:** `supportsCacheControlOnTools: false`, `supportsLongCacheRetention: false` (`index.ts:130-136`). pi's Anthropic codec marks the system blocks (`anthropic-messages.js:933-950`) and the last user or assistant message (`:1216-1236`), and tools only when supported (`:961,1325`), so **not tools**; no `ttl`.<br>**Chat:** `supportsStore: false`, `supportsDeveloperRole: false`, `maxTokensField: "max_tokens"` (`index.ts:137-142`). No session headers (`openai-completions.js:544`), no `prompt_cache_key` (`:580-583`) | **The parity levers per wire** |
| Prior Prism research | Plan 055: "no invented knobs"; the unknowns were cached-token fields per route and `prompt_cache_key` passthrough | Task 1 measures them |

## Tasks

- [ ] Task 1: Phase review — three wires, catalog, cache levers, and errors (read-only, live probes)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Placement:**
        - the package is `packages/providers/commandcode`;
        - Chat uses provider-kit `openai-chat`, Responses uses plan 204's `openai-responses`, and Messages uses `anthropic-messages`;
        - no new codec;
        - the enforcement-row list (`liquid` precedent).
      - (b) **Catalog probe:** `GET /models` field list (`supported_endpoints`, `context_length`, `name`, any capability or reasoning fields), with one exemplar per wire chosen for the live rows:
        - Chat: an open model with tools, for example `deepseek/deepseek-v4-flash`;
        - Responses: a GPT-5.6 model, for example Luna, the cheapest explicit-cache family;
        - Messages: a Claude model, for example Haiku 5.5.

        Whether `/models` exposes pricing (plan 055: no; rates come from the docs table).
      - (c) **Wire probes**, at most 36 requests, about 12 per wire, within the approved spend. Per wire:
        - text; a tool loop; reasoning (`reasoning_effort` or `reasoning` on Chat, `reasoning` on Responses, `thinking` on Messages); structured output where supported; one image on a vision model;
        - the usage chunk, including the cached-token field names (`prompt_tokens_details.cached_tokens` against `prompt_cache_hit_tokens` on Chat; `input_tokens_details.cached_tokens` on Responses; `cache_read_input_tokens` and `cache_creation_input_tokens` on Messages);
        - a 3-turn transcript with the reference levers against without them: on Responses, `prompt_cache_key` and `x-client-request-id` on or off; on Messages, `cache_control` on or off and on tools or not; on Chat, nothing against a probe `prompt_cache_key` (which must not be sent unless accepted and measurably useful).
      - (d) **Responses with `store: false` and `include: ["reasoning.encrypted_content"]`:** whether Command Code accepts encrypted-reasoning replay across a tool turn (required for prefix stability), and which fields it rejects.
      - (e) **Errors:** 401; 400 on wrong wire (a Claude model on Chat); 400 `unsupported_model`; 422 with `zdr` on a model without ZDR; and 429 if reached. A **403 `upgrade_required`** body is recorded from the docs if the owner's plan cannot produce it, and marked as such.
      - (f) **Reference harness:** pi-commandcode-provider version and the lever lines above re-verified. `pi -p --mode json --provider commandcode --model <id>` runs headless per wire and reports `cacheRead`; these become the parity-suite (plan 184) cells. Whether the extension's base URL can be pointed at `scripts/wire-proxy.mjs` (`COMMANDCODE_BASE_URL` or similar), to record its request bodies.
      - (g) **Release-path fit:** what plans 184, 185, 186, and 187 need, and whether plan 194's landed overflow classifier matches each wire's overflow body. Record one over-long prompt per wire in (c).
      - (h) **Verdict.** **Stop condition:** the Provider API key is refused for API access on every wire (wrong plan). Ask the owner, and do not improvise a CLI transport.
    - Performance: n/a (read-only).
    - Code Quality: no code changes.
    - Security: the key stays in `live.env` (mode `0600`). Recordings are scrubbed of `authorization` and `x-api-key`.
  - Approach:
    - Documentation Reviewed:
      - The Command Code provider and pricing docs; plan 055 lines 36–80; pi-commandcode-provider `index.ts:98-185` and `src/models.ts:150-166`; pi codec lines cited in the research summary.
      - Prism `codecs/{openai-chat,anthropic-messages}.ts`, plan 204 Task 3, plan 203 Task 3, and `packages/providers/opencode-go/src/provider.ts` (the dual-route precedent).
    - Options Considered:
      - Chat and Messages only, as in the 0.12 package. Rejected: pi-commandcode-provider sends OpenAI-family models through `/responses`, where `prompt_cache_key` and encrypted reasoning apply. Parity requires the same wire.
    - Chosen Approach:
      - A scoped review with paid, budgeted probes through `scripts/wire-proxy.mjs`.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/wire-proxy.mjs --upstream https://api.commandcode.ai/provider/v1 --listen 127.0.0.1:8787 \
        --record "$SCRATCH/commandcode" --secret-env COMMAND_CODE_API_KEY
      timeout 300 curl -s https://api.commandcode.ai/provider/v1/models | jq '.data[0]'
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes only.
    - References:
      - plans 055, 203, 204.
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `@arnilo/prism-provider-commandcode`
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`). Config:

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `apiKey` | ref | `env:COMMAND_CODE_API_KEY` | `secretRefProperty` |
        | `baseUrl` | string | `https://api.commandcode.ai/provider/v1` | `baseUrlProperty` |
        | `zdr` | boolean | `false` | adds the provider-owned `x-cmd-zdr: 1` |
        | `models` | ModelConfig[] | — | when absent, `models()` asks `GET /models` |

        Factory-only options: `id`, `fetch`. A missing key gives a `warn` note, and the provider still registers.
      - **Routes** (`createRoutedProvider`, `routeFor` from `compat.route`, else the pi rule):
        - `chat`: `openai-chat` on `/chat/completions`, bearer. Codec: `maxTokensField: "max_tokens"`, `reasoningReplay` per Task 1 (c), `imageInput: "capability-gated"`; no store and no developer role (system stays `system`); **no cache fields and no affinity**.
        - `responses`: `openai-responses` on `/responses`, bearer. Codec: `{store: false, include: ["reasoning.encrypted_content"], omitFields: <Task 1 (d) rejects>}`; `prompt_cache_key` from the codec. Affinity is **`x-client-request-id` only**.
        - `messages`: `anthropic-messages` on `/messages`, `auth: "x-api-key+bearer"`. Cache breakpoints `system_prompt` and `last_message`, **with tools excluded**; no `ttl`.
        - `zdr: true` adds `x-cmd-zdr: 1` on every route, as a provider-owned header.
      - **Usage:** each codec's mapping covers the cached-token fields Task 1 (c) recorded. A field the wire never reports is left undefined, never fabricated.
      - **Errors:** route-native envelopes map to classes:
        - 401 → `auth`;
        - 403 `upgrade_required` → `auth` by the shared 401/403 rule. The message and `code=upgrade_required` say the plan has no Provider API access, and it is not retried;
        - 422 `cmd_zdr_no_providers` → permanent, naming the model and the `zdr` flag;
        - 400 wrong wire → permanent, naming the expected route;
        - 429 → `rate_limited` with `Retry-After`;
        - 5xx → transient, with the upstream message redacted.
        - **Context overflow (plan 194, landed).** The over-long-prompt body from Task 1 must classify `context_overflow` through the shared classifier (`src/provider-kit/transport.ts:31-47`, patterns as data).
          - If the body already matches `CONTEXT_OVERFLOW_BODY`, a test proves it. Otherwise the pattern list gains the vendor-neutral phrase, and `overflow_classified_per_supported_route` (`src/__tests__/context-overflow-recovery.test.ts`) gains the recorded body.
          - Errors are built with `providerHttpError` (`src/provider-kit/retry-http.ts`), so the class always comes from `classifyProviderFailure`, never hand-set. Each wire's recorded body (Chat, Responses, Messages) is covered.
      - **Catalog:** `listCommandCodeModels` maps `GET /models`:
        - `supported_endpoints` → `compat.route`;
        - `context_length` → limits;
        - vision and reasoning flags from Task 1 (b).
      - **Context windows.** Every static and discovered model declares `limits.contextWindow`, and `maxOutputTokens` when known. Plan 194's estimate fallback, context accounting, and window-relative OM gate read them. A model whose window is unknown is left undefined and listed in the README; it is never guessed.

        The static `commandCodeModels` holds the three exemplars, with `cost` (input, output, cache read, cache write) from the pricing page and `compat.pricing_source` set to the URL plus the date. DeepSeek peak and off-peak pricing is noted, not modelled.
      - **Recordings** under `src/__tests__/wire/{chat,responses,messages}/`: `text`, `tool-loop`, `thinking`, `structured-output`, `cache` (3 turns with the levers), and the error set from Task 1 (e).
      - `providerConformance({ recordings })` passes for all three routes offline.
      - `live.test.ts` runs `runProviderLiveScenarios` with `routes: {openai, responses, anthropic}` on the three exemplars (model env `PRISM_LIVE_COMMANDCODE_{CHAT,RESPONSES,MESSAGES}_MODEL`). This extends `runProviderLiveScenarios` to accept a `responses` route if it does not already (`src/testing/provider-live-scenarios.ts:47-74`).
    - Performance:
      - Importing evaluates no sibling.
      - Discovery is one public request.
      - The README states spend per live run (about 30 requests, under $0.15 at the listed rates), the upstream-routing caveat on cache affinity, and the plan windows.
    - Code Quality:
      - The opencode-go shape.
      - The route rule is one pure function with tests.
      - Enforcement rows in this task: packaging lists and provider dirs, `install-smoke`, `package-truth.json`, `phase24-truth` count, `phase54-package-map`, coverage and e2e coverage, the live-matrix row `providers/commandcode` (requires `PRISM_LIVE_PROVIDER_TESTS` and `COMMAND_CODE_API_KEY`; three model envs; a cost line), `live.env.example`, provider counts in the docs.
      - New baseline `scripts/compat-baseline/arnilo__prism-provider-commandcode.txt` via `--update-baseline`. If `runProviderLiveScenarios` gains a `responses` route, the root baseline is regenerated too, with the diff attributed.
    - Security:
      - The key is ref-only.
      - Caller headers cannot override `authorization`, `x-api-key`, or `x-cmd-zdr`.
      - The key never appears in events, errors, or recordings.
      - The README covers ZDR semantics, including that `/messages` ignores the header for routing.
  - Approach:
    - Documentation Reviewed:
      - Task 1 Notes; the deleted 0.12 package (`commandcode/src/{provider,cache,errors,models}.ts`); `packages/providers/opencode-go/src/*`; `docs/provider-kit.md` "Shipping a provider".
    - Options Considered:
      - Sending `prompt_cache_key` on Chat as well. Rejected unless Task 1 (c) shows it is accepted and useful: the reference harness does not send it, and plan 055's "no invented knobs" rule applies.
      - Marking tools on Messages. Rejected: the reference harness disables it (`supportsCacheControlOnTools: false`), presumably because the gateway rejects or ignores it. Task 1 (c) records which.
    - Chosen Approach:
      - Three routes on existing codecs, with levers matched to the reference per wire.
    - API Notes and Examples:
      ```ts
      import commandcode from "@arnilo/prism-provider-commandcode";
      const agent = await createAgent({ model: "commandcode/claude-haiku-5-5", packages: [commandcode({ zdr: false })] });
      ```
    - Files to Create/Edit:
      - `packages/providers/commandcode/**`; the enforcement-row files; `src/testing/provider-live-scenarios.ts` (only if needed).
      - `docs/index.md`, `docs/models.md`, `docs/release.md`, `packages/providers/README.md`, `bun.lock`, `CHANGELOG.md`.
    - References:
      - plans 055, 183, 203, 204.
  - Test Cases to Write:
    - `commandcode_package_conformance_three_routes`.
    - `commandcode_route_rule`: `claude-*` → messages; `/responses` advertised → responses; otherwise chat; an explicit `compat.route` wins.
    - `commandcode_responses_levers`: `prompt_cache_key` clamped, `x-client-request-id` set, no `session_id`.
    - `commandcode_messages_cache_breakpoints_exclude_tools`.
    - `commandcode_chat_sends_no_cache_fields`.
    - `commandcode_zdr_header_owned`: the header is set when configured, and callers cannot override it.
    - `commandcode_error_mapping` (each status in the table).
    - `commandcode_overflow_classified_and_recovered`: the recorded overflow body classifies `context_overflow`, and a session on a replaying mock compacts once and retries once.
    - `commandcode_catalog_declares_context_windows`.
    - `list_commandcode_models_maps_supported_endpoints`.
    - `commandcode_missing_key_notes_and_registers`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new provider package).
    - Docs pages to create/edit:
      - `packages/providers/commandcode/README.md` (package page structure). It includes "Routes" (the three wires and the rule), "Prompt caching" (per-wire levers, cache-write pricing, the upstream-routing caveat), "Zero data retention", and "Plans and limits".
    - `docs/index.md` update: yes. "`@arnilo/prism-provider-commandcode`: Command Code Provider API (Chat, Responses, Messages) for Prism."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Cache parity with pi-commandcode-provider — lever equivalence, probe, parity-suite cells
  - Acceptance Criteria:
    - Functional:
      - `cache_levers_match_pi_commandcode` (offline), per wire, on plan 203's 3-turn fixture. It asserts that Prism's cache-relevant fields equal the reference request (recorded through the wire proxy if Task 1 (f) found a base-URL override; otherwise derived from the cited lines), and that tools, system or instructions, and earlier messages are byte-identical across turns.
      - `provider-probe.mjs --provider commandcode --model <exemplar> --turns 4` runs once per wire.
      - **Thresholds:**
        - Messages (explicit cache) and Responses (GPT-5.6, explicit-cache pricing): reuse ≥ 0.8 on turns 2–4;
        - Chat (open model, implicit, multi-upstream): reuse > 0, with the value recorded.

        If Task 1 (c) found a wire that reports no cache counts, the probe records `unmeasurable` for it, and the README says so.
      - Plan 184 is amended with three `commandcode` cells (Prism against `pi -p --mode json --provider commandcode`, one model per wire), using Task 1 (f)'s commands. **Gate:** Prism ≥ pi per cell. Plan 184 has shipped by the time this runs, so this is an amendment to the standing parity suite, not part of the 0.13.0 gate.
    - Performance: about 12 requests per probe run across wires, stated in the matrix.
    - Code Quality: plan 203's probe and fixture, unchanged.
    - Security: the probe prints no key.
  - Approach:
    - Documentation Reviewed:
      - plan 203 Task 5; plan 184; the reference lever lines.
    - Options Considered:
      - One cell for the whole provider. Rejected: the three wires cache differently, so a single cell hides a regression on one of them.
    - Chosen Approach:
      - Per-wire equivalence, probe, and cells.
    - API Notes and Examples:
      ```sh
      timeout 900 bun scripts/cache-parity/provider-probe.mjs --provider commandcode --model claude-haiku-5-5 --turns 4
      ```
    - Files to Create/Edit:
      - `packages/providers/commandcode/src/__tests__/cache-levers.test.ts` and `fixtures/pi-request-{chat,responses,messages}.json`; `plans/184-…md`.
    - References:
      - plan 203 Task 5.
  - Test Cases to Write:
    - `cache_levers_match_pi_commandcode` (three cases).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none beyond the README "Prompt caching" section.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Roadmap and release-path rows
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md` Phase 5 and the §2.9 row add `commandcode` (owner decision 2026-10-25).
      - Plans 185 (`SecretSource` migration and shape baseline), 186 (strict `providers/commandcode` row with three legs, and a preflight key check), and 187 (counts; a new npm name, so no deprecation) get "Amended 2026-10-25 by plan 205".
      - `plans/README.md` descriptions are updated.
      - `scripts/retired-providers.test.mjs` already omits `commandcode`. A sweep confirms no gate still lists it as retired: `rg -n "commandcode" scripts/*.test.mjs`.
    - Performance: n/a.
    - Code Quality: only unchecked tasks are edited.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plans 184–187; `scripts/*retired*`.
    - Options Considered:
      - n/a: required rows.
    - Chosen Approach:
      - Enumeration amendments.
    - API Notes and Examples:
      ```markdown
      **Amended 2026-10-25 by plan 205 (Command Code ships).** …
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

- [ ] Task 5: Live acceptance on all three wires (the owner provides the key and approves the spend)
  - Acceptance Criteria:
    - Functional:
      - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/commandcode bun run test:live` passes all three route legs: text, tool loop, thinking, structured output where supported, image on the vision exemplar, abort, leak scan.
      - A `createAgent` smoke on each wire (one multi-turn session with a tool, through the kernel loop) completes. This proves the routing rule end to end, not only at provider level.
      - `provider-probe.mjs` meets the Task 3 thresholds.
      - With `zdr: true`, one request to a ZDR-capable model succeeds and one to `typesafe/jev`-like or non-ZDR model returns the mapped 422.
      - `docs/_evidence/commandcode-live-<date>.md` records models, request counts, spend (from usage `cost` or computed from the listed rates), reuse figures, and the leak scan.
    - Performance: at most 60 requests and an approved spend ceiling (proposed $0.30). Measured counts correct the matrix `cost` line.
    - Code Quality: defects get a fixture, a test in the owning file, and a fix.
    - Security: `scan-secrets` passes. `live.env` is checked for mode `0600` first.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md`; plan 196 Task 2.
    - Options Considered:
      - Provider-level scenarios only. Rejected: the route rule and per-wire replay only show up in a multi-turn kernel run.
    - Chosen Approach:
      - Strict row plus a kernel smoke per wire plus the probe plus a ZDR check.
    - API Notes and Examples:
      ```sh
      timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/commandcode bun run test:live
      ```
    - Files to Create/Edit:
      - `packages/providers/commandcode/src/__tests__/live-agent.test.ts` (the kernel smoke, gated like `live.test.ts`); `docs/_evidence/commandcode-live-<date>.md`; the `scripts/live-matrix.json` cost line.
    - References:
      - Tasks 2–3.
  - Test Cases to Write:
    - `live-agent.test.ts`: per wire, a 2-turn agent session with one tool. Skips without the key.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-provider-commandcode test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts`
- `timeout 600 bun test --timeout=0 scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/retired-providers.test.mjs`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/commandcode bun run test:live` (owner key; Task 5)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
