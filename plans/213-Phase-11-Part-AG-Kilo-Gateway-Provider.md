# Phase 11 Part AG — Kilo Gateway provider

## Objectives

- Ship `@arnilo/prism-provider-kilo` **in 0.13.0** on Kilo's AI Gateway (`https://ai-gateway.kilo.ai/api/v1`), live-tested on **all three wires** the gateway serves:
  - OpenAI Chat Completions (OpenRouter-compatible), for most models;
  - OpenAI Responses, for the models the catalog marks `openai`;
  - Anthropic Messages, for the models the catalog marks `anthropic` (every Claude model).
- Support **both of Kilo's authentication paths**: a Kilo API key (`env:KILO_API_KEY`), and Kilo's **device login**, which is how the Kilo CLI and the editor extensions sign in. The device login is declared as an `oauth` `AuthMethod` and runs over `host.ui`. Organization context and anonymous free-model access are supported too.
- Reach **prompt-cache parity with the Kilo CLI** (`@kilocode/cli`, the vendor's own client) on each wire, and add three Kilo cells to plan 184's parity suite before plan 184 runs.
- Map Kilo's catalog, errors, usage, and cache pricing faithfully. Invent no knobs.

## Expected Outcome

- `createAgent({ model: "kilo/anthropic/claude-haiku-5.5", packages: [kilo()] })` streams text, tool calls, reasoning, structured output, and images where the model supports them. The route comes from the catalog:
  - `opencode.ai_sdk_provider: "anthropic"` → `/messages`;
  - `"openai"` → `/responses`;
  - anything else → `/chat/completions`.
- Sign-in works with either a key or the device login. With a key, `apiKey: "env:KILO_API_KEY"` is enough. Otherwise a host calls the declared `kilo` `AuthMethod`:
  1. Prism opens Kilo's verification page through `host.ui` `open-url` and shows the code.
  2. Prism polls until the user approves.
  3. The token is stored at `keyring:kilo` through `credentials:write`.
  4. If the account belongs to organizations, the user picks one through `host.ui` `input`.

  With no credential at all, only `:free` models are reachable, and a status note says so.
- An offline test shows the cache levers equal the Kilo CLI's on each wire. `provider-probe.mjs` shows cache reads on turns 2–4 on one model per wire. Plan 184 gains three `kilo` cells.
- `providers/kilo` is an active live row with three route legs and passes strict. `docs/_evidence/kilo-live-<date>.md` records the run, the spend, the probe figures, and one real device-login round trip.
- 0.13.0 publishes **eight** providers instead of seven. Plans 184–187 and the roadmap say so.

This plan implements the **owner decision of 2026-10-31: the Kilo Gateway provider ships in 0.13.0**. It changes roadmap **Phase 5** (the shipped provider set) and the §2.9 provider row. The research behind it was done on 2026-10-31 and is summarized below.

- **Release path:** step **17i**, after plan 212 and before plan 184.
  - Before 184, because its three cache cells join the parity suite that 184 runs.
  - Before 185, so the package's surface and baseline are frozen with the other providers.
  - Before 186 and 187, so its live row is part of release acceptance and its name is on the publish list.
- **Review:** the plan creates a package, so **Task 1 is the phase review**. No kernel contract change is expected:
  - `AuthMethod` `oauth`, `credentials:write`, `host.ui` `open-url`/`input`, and the three route formats all exist already.
  - The one candidate kernel-adjacent change is promoting the adaptive-thinking hook into `@arnilo/prism/provider-kit`. Task 1 decides it.
- **Dependencies, all landed:**
  - plan 203: the Chat codec's mid-stream error frames, `reasoning_details` replay, `cache_control` blocks, chunk-aware usage, and `provider-probe.mjs`;
  - plan 204: the `openai-responses` codec, `credentials:write`, and the host-invoked OAuth `AuthMethod` precedent;
  - plan 205: the three-route package shape and the adaptive-thinking finding for Claude 5.x on Messages.
- **Keys and spend:**
  - `~/.config/prism/live.env` gains `KILO_API_KEY`. This is the name Kilo's docs use, and it is also the name `provider-probe.mjs` derives from the id `kilo` (`scripts/cache-parity/provider-probe.mjs:248`).
  - The owner adds the key and approves the spend. Kilo bills prepaid credits, so the account needs a balance.
  - Task 1 states the spend: expected under $0.30 for the probes plus the live run, at the exemplar rates below.
  - The executor never pastes or prints the key.
- **Not shipped here:** version bump, publish (plan 187), and `/docs` pages beyond the package README and the index and table rows.
- **Reference host impact:** none. `apps/prism-agent` runs on the mock provider.
- **Prior art:** none in Prism. The name `kilo` was never a Prism package and appears in no retired list (`scripts/retired-providers.test.mjs:12-25`). Plan 029 mentions Kilo only as a SuperGrok OAuth reference.

**Scope exclusions (Further Actions candidates):**
- FIM `/fim/completions` (Codestral only, autocomplete);
- the embeddings and transcription model endpoints (undocumented);
- the TypeSafe System One passthrough (`…/api/v1/systemone`; `@arnilo/prism-provider-typesafe` already ships `typesafe/jev`);
- the balance, profile-usage, and Kilo Pass endpoints;
- BYOK key management (it is configured in Kilo's dashboard, not over the API);
- Kilo's legacy token-embedded base URL (see the Security criterion in Task 2).

## Research summary (2026-10-31)

Sources:
- Kilo docs: `kilo.ai/docs/gateway`, `/authentication`, `/api-reference`, `/models-and-providers`, `/usage-and-billing`, `/streaming`;
- the Kilo CLI's gateway client `Kilo-Org/kilocode` `packages/kilo-gateway/src/` (`api/constants.ts`, `api/url.ts`, `api/models.ts`, `api/profile.ts`, `auth/device.ts`, `auth/device-auth-tui.ts`, `headers.ts`, `provider.ts`, `responses.ts`, `gateway-metadata.ts`);
- Kilo's own cache measurements in `Kilo-Org/cloud` `packages/harness-sdk/AGENTS.md` ("The kilo gateway", measured 2026-09-04);
- OpenClaw's Kilo provider page;
- the public catalog `GET https://ai-gateway.kilo.ai/api/v1/models` (no key, 2026-10-31: HTTP 200, 388 models).

| Topic | Finding | Consequence |
| --- | --- | --- |
| Base URL | `https://ai-gateway.kilo.ai/api/v1` (Kilo CLI `DEFAULT_KILO_AI_GATEWAY_URL`). The legacy `https://api.kilo.ai/api/gateway/v1` is rewritten to it; OpenClaw still uses the legacy form | One `baseUrl` default. The legacy form is accepted as a configured `baseUrl`, not special-cased |
| Wires | `POST /chat/completions` (OpenRouter-compatible), `POST /responses`, `POST /messages` (the CLI builds OpenRouter, OpenAI, and Anthropic SDK clients on the same base, `provider.ts`), `GET /models` (no key needed) | Three routes on existing provider-kit codecs |
| Route per model | Catalog field `opencode.ai_sdk_provider`. In today's catalog: `anthropic` 19 (every Claude id), `openai` 75 (GPT, Grok, Meta Muse…), absent 293, `openrouter` 1. The `kilo-auto/*` routers have no value, so they use Chat | `routeFor` = `compat.route`, else the catalog field, else Chat |
| Catalog fields | OpenRouter's schema (`context_length`, `max_completion_tokens`, `top_provider`, `architecture.input_modalities`, `supported_parameters`, `pricing.{prompt, completion, input_cache_read, input_cache_write, …}` in $/token) plus `isFree`, `mayTrainOnYourPrompts`, `alias_target` (aliases such as `~anthropic/claude-sonnet-latest`), `autoRouting`, `opencode`, `preferredIndex` | Discovery maps windows, modalities, tools and reasoning, and cost (×1e6) |
| API key | `Authorization: Bearer <key>`. Keys are JWTs from `app.kilo.ai`. Env convention `KILO_API_KEY` (OpenClaw: `KILOCODE_API_KEY`) | `secretRefProperty("env:KILO_API_KEY")` |
| Device login | `POST https://api.kilo.ai/api/device-auth/codes` → `{code, verificationUrl, expiresIn}` (429 = too many pending). The client then polls `GET …/codes/{code}` every 3 s: **202** pending, **403** denied, **410** expired, **200** `{status: "approved", token, userEmail}`. This is Kilo's own protocol, **not** RFC 8628. The CLI treats the token as valid for one year (`TOKEN_EXPIRATION_MS`) and has no refresh | `AuthMethod {kind: "oauth", id: "kilo"}` on `host.ui`. No PKCE, no listener, no refresh |
| Organizations | `GET https://api.kilo.ai/api/profile` (Bearer) → `{user, organizations[{id, name, role}], selectedOrganizationId, hasPersonalAccount}`. The CLI's default is `selectedOrganizationId` when it is valid, otherwise the first organization when there is no personal account (`defaultOrganizationId`). Org traffic sends `X-KILOCODE-ORGANIZATIONID`. The org catalog is `GET {gateway}/organizations/{id}/models`. The docs say "15-minute expiry" for organization tokens | `organizationId` config, plus the login-time default. Task 1b settles the expiry claim |
| Anonymous | Free (`:free`) models only. Limited by IP: 200 requests per hour, also for signed-in users on free models. The CLI sends `apiKey: "anonymous"` when it has no key | Missing key → `warn` note and the provider still registers. Task 1 checks what the routed provider sends with no key |
| Headers | `X-KILOCODE-TASKID` (prompt-cache keying), `X-KILOCODE-PARENT-TASKID`, `X-KILOCODE-PROJECTID` (org only), `X-KILOCODE-EDITORNAME`, `X-KILOCODE-FEATURE` (attribution; the CLI sends it only when `KILOCODE_FEATURE` is set), `X-KILOCODE-MACHINEID`, `x-kilocode-mode` (mode hint for `kilo-auto/frontier`: plan/general/architect/orchestrator/ask/debug → Opus, build/explore/code → Sonnet) | `X-KILOCODE-TASKID` from the session key on every route. Other headers only where Task 1b shows an effect |
| Data collection | The CLI injects `provider.data_collection: "allow" \| "deny"` into the body (`responses.ts`) | `dataCollection` config |
| Responses quirk | With `store !== true`, the CLI strips `item_reference` items and `id` fields from `input[]` before sending (`responses.ts`) | Task 1b checks whether Prism's codec, which uses `store: false`, needs the same `omitFields`/transform |
| Streaming and errors | SSE. `stream_options.include_usage` is injected by the gateway. Errors before the first token use HTTP status plus `{"error": {"message", "code"}}`. Errors **after** streaming starts arrive as HTTP 200 with an SSE `error` object and `finish_reason: "error"`. Status codes: 400 (bad parameters, also context overflow), 401, **402** insufficient balance (`metadata.buyCreditsUrl`), **403** model not allowed by org policy, **413** body over 20 MB, 429, 500, 502 upstream, 503 (upstream 402s too) | The Chat codec already handles `finish_reason: "error"` (`src/provider-kit/codecs/openai-chat.ts:490`). Task 1b records the Responses and Messages mid-stream shapes |
| Usage | The billing page lists `input_tokens`, `output_tokens`, `cache_write_tokens`, `cache_hit_tokens`, `cost_microdollars`, `is_byok`. The API reference shows only OpenAI's `prompt_tokens`/`completion_tokens`. Kilo's own test reports `cache_creation` only on `/messages` | Task 1b records the real fields per wire. A field that is never reported stays undefined |
| **Cache behaviour, Kilo's own measurement** | "This gateway places its own breakpoints and caches the same whether the marker is sent or not": identical cache reads with or without `cache_control` (Messages) and `prompt_cache_key` (Responses). The hit **ratio** is comparable only on `/messages`, because the other wires book the cold prefix as plain input. What holds the hit rate is a **byte-identical prefix** | Parity = prefix stability + the reference's levers. Chat and Responses are held to `cacheReadTokens > 0`, Messages to a ratio |
| Exemplars (catalog prices, $/1M in / out / cache read / cache write) | Messages `anthropic/claude-haiku-5.5` 0.10 / 0.50 / 0.01 / 0.125 (1 000 000 context, image). Responses `openai/gpt-6-luna` 0.10 / 0.50 / 0.01 / 0.125 (1 050 000, image). Chat `google/gemma-4-26b-a4b-it` 0.01 / 0.031 / 0.005 / — (262 144, image, tools, reasoning). Free leg: one `:free` id with `tools` | Task 1 confirms them |
| Reference client | `@kilocode/cli` (npm 7.8.18; bins `kilo`, `kilocode`; an opencode fork). `KILO_AI_GATEWAY_URL` overrides its gateway base (`resolveKiloAiGatewayBase`), so `scripts/wire-proxy.mjs` can record all three wires | The parity reference. Not installed on the owner's machine today |

## Tasks

- [x] Task 1: Phase review — wires, catalog, auth flows, cache levers, reference client (read-only, public probes)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Placement and mechanisms:**
        - the package is `packages/providers/kilo`, on `@arnilo/prism` and `/provider-kit` only;
        - the route formats are `openai-chat`, `openai-responses`, and `anthropic-messages` (`RoutedProviderFormat`, `src/provider-kit/routed-provider.ts:13`), with no new codec;
        - the `X-KILOCODE-TASKID` affinity uses the route `affinity` hook (`routed-provider.ts:20,180-183`), and org and attribution headers use `extraHeaders` (`:47,174-175`); both are provider-owned and applied after caller headers;
        - the device login is an `AuthMethod` `oauth` (`src/contracts-core/provider.ts:80-92`) using `credentials:write`, as `packages/providers/openai-codex/src/index.ts:85-120` does.
      - (b) **Enforcement-row list**, read line by line against the tree. Plan 205 Task 1 (a) is the template: `docs/index.md`, `docs/models.md`, `docs/release.md` (generated block), `docs/migrate-to-0.13.md`, `docs/live-testing.md`, `packages/providers/README.md`, `scripts/package-truth.json`, `scripts/coverage-thresholds.json`, `scripts/e2e-coverage.json`, `scripts/live-matrix.json`, `scripts/live.env.example`, `scripts/phase24-truth.test.mjs`, `scripts/phase54-package-map.test.mjs`, `src/__tests__/install-smoke.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts`. Record the current publishable, workspace, and provider counts and what they become.
      - (c) **Catalog probe** (public): the field list, the `ai_sdk_provider` distribution, how `alias_target` entries look, and whether `ModelRef` parsing accepts a `~` in a model id (`kilo/~anthropic/claude-haiku-latest`). If it does not, discovery skips alias rows and the README says so. Also record the exemplar choice per wire and the free-leg id.
      - (d) **No-key behaviour:** what `createRoutedProvider` sends when `apiKey` resolves to `undefined` (no header, or a refusal before the request). Prism must not send a fake `Bearer anonymous` unless Task 1b shows the gateway needs it.
      - (e) **Shared hooks:** whether the adaptive-thinking upgrade (`commandCodeThinking`, `packages/providers/commandcode/src/provider.ts:35-39`) is needed for Kilo's Messages wire. If Task 1b confirms that `thinking.type.enabled` is rejected on Claude 5.x here as well, the decision is between promoting it to provider-kit (two users: §1 "wire code shared by providers") and keeping a package-local copy. Record which, and the baseline consequence.
      - (f) **Reference client:** how `@kilocode/cli` runs headless and reports cache tokens per message (for example `kilo run --format json`), how it takes a key (env, config, or `kilo auth login`), that `KILO_AI_GATEWAY_URL` routes it through `scripts/wire-proxy.mjs`, and which levers it sends per wire:
        - `cache_control` markers and where (its `packages/llm` README: "up to 3 `cache_control` markers" on Anthropic Messages);
        - `X-KILOCODE-TASKID`;
        - any `prompt_cache_key` on Responses.

        Capture these offline first, from the CLI source at a pinned tag, and live in Task 1b.
      - (g) **Release-path fit:** what plans 184, 185, 186, and 187 need (cells, freeze and `SecretSource` migration set, live row, publish count 7 → 8, npm name check `GET registry.npmjs.org/@arnilo%2Fprism-provider-kilo` → 404). Also whether plan 194's `CONTEXT_OVERFLOW_BODY` (`src/provider-kit/transport.ts:31-47`) matches the overflow bodies Task 1b records.
      - (h) **Verdict and spend** for Task 1b, stated for owner approval. **Stop condition:** Kilo's docs or the catalog contradict the three-wire model (for example, `/messages` refuses Bearer keys). Then stop and re-cut.
    - Performance: n/a (read-only).
    - Code Quality: no code changes.
    - Security: no credential is used. The device-auth initiate call is **not** made in this task: it creates a pending authorization on Kilo's side, so it waits for Task 1b and the owner.
  - Approach:
    - Documentation Reviewed:
      - The research summary sources; plan 205 Tasks 1–2 (three-route precedent and enforcement rows); plan 204's OAuth `AuthMethod` (`packages/providers/openai-codex/src/oauth.ts:1-80`); `docs/provider-kit.md`.
    - Options Considered:
      - One route (Chat only, as OpenClaw does). Rejected: the Kilo CLI sends Claude through `/messages` and GPT through `/responses`. Parity needs the same wire, and only `/messages` reports cache writes.
    - Chosen Approach:
      - A scoped read-only review, then paid, budgeted probes in Task 1b.
    - API Notes and Examples:
      ```sh
      timeout 60 curl -s https://ai-gateway.kilo.ai/api/v1/models | jq '.data[] | select(.id=="anthropic/claude-haiku-5.5") | {id, opencode, pricing, context_length}'
      timeout 120 npm view @kilocode/cli version bin
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes only.
    - References:
      - plans 203, 204, 205.
  - Test Cases to Write:
    - n/a (read-only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Status (2026-10-31): complete for the offline and public-API scope.** (a)–(h) are recorded below. Nothing authenticated was sent and nothing was spent. The stop condition did **not** trigger: the CLI source and the public catalog both confirm the three-wire model, and Messages carries `authorization` alongside `x-api-key`. `~/.config/prism/live.env` is mode `0600` and holds **no** `KILO_API_KEY`, so Task 1b waits for the owner to add the key and approve the spend. The device-auth initiate call was not made.

    - **(a) Placement and mechanisms.**
      - Package: `packages/providers/kilo`, on `@arnilo/prism/provider-kit` only, same manifest shape as `packages/providers/commandcode` (peer `@arnilo/prism >=0.13.0 <1.0.0`, no `dependencies`, `exports: {".": "./src/index.ts"}`, `sourceExport: true`). Root `workspaces` already covers it (`packages/providers/*`).
      - Wires: no new codec. `RoutedProviderFormat = "openai-chat" | "anthropic-messages" | "openai-responses"` (`src/provider-kit/routed-provider.ts:13`), route hooks at `codecs/anthropic-messages.ts:53-71`, `codecs/openai-responses.ts:59-82`, `codecs/openai-chat.ts:80-100`.
      - Header ownership works as the plan assumes: caller headers are copied first, then `options.extraHeaders` (`routed-provider.ts:47,174-175`), then `route.headers`, then `route.affinity` (`:20,180-183`), each through `applyOwned`, so caller values lose case-insensitively. `X-KILOCODE-TASKID` belongs in `route.affinity`; org and mode in `extraHeaders`.
      - Auth: `route.auth` defaults to `"bearer"`; `"x-api-key+bearer"` sends `authorization` + `x-api-key` + `anthropic-version: 2023-06-01` (`routed-provider.ts:200-213`). That matches what the Kilo CLI actually puts on `/messages` (see (f)), so the Messages route should use `x-api-key+bearer`.
      - Device login: `AuthMethod` `oauth` and `AuthContext` are at `src/contracts-core/provider.ts:80-96`. The precedent is `packages/providers/openai-codex/src/index.ts:85-125`: `capabilities: ["credentials", "credentials:write"]`, a `keyring:` ref asserted by `assertWritableCredentialRef` before any request, a slot built from `prism.credentials.{resolve,store,delete}`, and `auth: [auth]` on the registered provider. No kernel contract change is needed for Task 3.
    - **(b) Enforcement rows, read line by line on 2026-10-31.**
      - **Counts now → after kilo:** `scripts/package-truth.json` `publishable` 48 → 49, `workspace` 47 → 48, `provider` 8 → 9 (`:58-60`; the package lists at `:44` and `:67` gain `@arnilo/prism-provider-kilo`). The **0.13.0 publish set** is seven today (`docs/release.md:138`) and becomes **eight** with kilo; `commandcode` stays in-tree and out of the cut, hence tree 9 / cut 8.
      - `docs/index.md:34-41` — provider link list (nine in-tree entries after the add).
      - `docs/models.md:163` — hand-written "ships 7 provider packages" and the braced set → **8 shipped**, adding `kilo`, keeping the `commandcode` deferral sentence; `:173-179` per-package table gains a row; Task 5's count sentence is here, not a second place.
      - `docs/release.md:138` hand sentence (seven → eight publish adapters) and `:141` generated `package-truth:providers` block (8 → 9 tree adapters). Regenerate the block, never hand-edit it.
      - `docs/migrate-to-0.13.md:74` — umbrella successor list gains `kilo`.
      - `docs/live-testing.md:63-64` — generated live-matrix table; it gains the `providers/kilo` row from `scripts/live-matrix.json`.
      - `packages/providers/README.md:3-4` — "The eight shipped adapters are …" → **nine**, adding Kilo. Note the pre-existing drift: this file already calls Command Code shipped, while `docs/models.md:163` and `docs/release.md:138` defer it. Task 2/5 must make the two sentences agree (the plan's line is "ships 8 at the cut", so keep the deferral).
      - `scripts/package-truth.json` (`:44,67,58-60`) — regenerate via `scripts/package-truth.mjs`.
      - `scripts/coverage-thresholds.json` — add the `@arnilo/prism-provider-kilo` row (rows are alphabetical, `:140` area) from two measured runs.
      - `scripts/e2e-coverage.json:719-725` — add the kilo row with `kilo.test.ts`, `package.test.ts`, `live.test.ts`, `live-agent.test.ts`.
      - `scripts/live-matrix.json:179-207` — add `providers/kilo` (active, three model envs `PRISM_LIVE_KILO_{CHAT,RESPONSES,MESSAGES}_MODEL`, `KILO_API_KEY`).
      - `scripts/live.env.example:40-60` — add `KILO_API_KEY=...`; it is currently absent (only `COMMAND_CODE_API_KEY` and friends are there).
      - `scripts/phase24-truth.test.mjs:106-112` (comment at `:97-105`) — 48/47/8 → 49/48/9.
      - `scripts/phase54-package-map.test.mjs:63` — baseline union gains `@arnilo/prism-provider-kilo`.
      - `src/__tests__/install-smoke.test.ts:70,198` — shipped list gains kilo; the `:13` comment's "47 manifests" needs the new number while it is being touched.
      - `src/__tests__/packaging.test.ts:97` (source-export row), `:453` (`assert.deepEqual(shipped, …)`, 8 → 9), `:837` (`names.length, 48` → 49).
      - `src/__tests__/release.test.ts:72-73` (`packages.length, 48` → 49) and `:104` (the "48 publishable manifests" doc assertion).
      - **Rows the plan omits:** `scripts/retired-providers.test.mjs:12-25` (`RETIRED_PROVIDERS`) — `kilo` was never retired, so nothing is added, but the test also derives the umbrella `successor` list from the provider directories, so it starts naming kilo automatically; `scripts/retired-names.json` — `kilo` must **not** enter it, and `scripts/deprecations-0.13.json` stays at 33 entries (new npm name, 404 today). `bun.lock` also changes.
      - New file: `scripts/compat-baseline/arnilo__prism-provider-kilo.txt`.
      - If Task 1 (e)'s promotion is taken, also: `src/__tests__/public-export-contract.test.ts:632` (`FROZEN_PROVIDER_KIT_EXPORTS`), the provider-kit inventory in `src/__tests__/provider-kit.test.ts`, the `scripts/budgets.json` count note, and regenerated `scripts/compat-baseline/arnilo__prism.txt`; the commandcode baseline text is unchanged by a re-export alias.
    - **(c) Catalog probe** (`GET https://ai-gateway.kilo.ai/api/v1/models`, public, no key, 2026-10-31T14:40Z: `200`, 524 120 bytes, 1.03 s). 388 models.
      - Top-level keys across all rows: `alias_target, architecture, autoRouting, canonical_slug, context_length, created, default_parameters, description, enkrypt, expiration_date, hugging_face_id, id, inference_provider_ids, isCustomLlm, isFree, mayTrainOnYourPrompts, name, opencode, per_request_limits, preferredIndex, pricing, supported_parameters, terminalBench, top_provider`. (Not every row carries every key; `opencode` is on all.)
      - `opencode.ai_sdk_provider`: `anthropic` 19, `openai` 75, `openrouter` 1, absent 293. Every Claude id is `anthropic`; `kilo-auto/*` has no value.
      - `alias_target`: 19 rows, each with an id beginning `~` (`~anthropic/claude-haiku-latest` → `alias_target: anthropic/claude-haiku-5.5`, `~unbiased/pareto-latest` → `unbiased/pareto-26.10`). **`ModelRef` accepts them**: `parseModelRef` splits on the first `/` only (`src/models/ref.ts:25-34`), so `kilo/~anthropic/claude-haiku-latest` yields provider `kilo`, model `~anthropic/claude-haiku-latest`. Discovery should keep alias rows and surface `alias_target` in `compat`; no skip is needed.
      - Exemplars confirmed, with one price correction:
        - Messages `anthropic/claude-haiku-5.5` — ctx 1 000 000, `top_provider.max_completion_tokens` 128 000, input text/image/file/pdf, prompt 1e-7 ($0.10/M), completion 5e-7 ($0.50/M), cache read 1e-8 ($0.01/M), cache write 1.25e-7 ($0.125/M).
        - Responses `openai/gpt-6-luna` — ctx 1 050 000, max output 128 000, same four rates as Haiku 5.5.
        - Chat `google/gemma-4-26b-a4b-it` — ctx 262 144, max output **235 929** (the catalog value, not 20 % of ctx), input image/text/video, tools + reasoning + `structured_outputs`, prompt $0.01/M, completion **$0.03/M** (the plan said 0.031), cache read $0.005/M, and **no** `input_cache_write` key.
      - Free leg: 17 rows have `isFree: true`; all but one (`nvidia/nemotron-3.5-content-safety:free`) advertise tools. Use `nvidia/nemotron-3.5-super-vl:free` for the anonymous request (1 000 000 ctx, text/image/video, tools); `kilo-auto/free` is the CLI's default free id (256 000 ctx, text).
      - The catalog is OpenRouter's schema with Kilo additions; `pricing.*` is per token (×1e6 for `ModelCost`). Kwargs such as `discount`, `request`, `image`, `web_search` exist on some rows and map to nothing.
    - **(d) No-key behaviour.** `createRoutedProvider` resolves `apiKey` and only writes `authorization`/`x-api-key` when it is truthy (`routed-provider.ts:200-213`), so Prism sends **no** auth header when neither ref resolves. The Kilo CLI does the opposite: its custom loader sets `options.apiKey = "anonymous"` when it has no key (`packages/opencode/src/kilocode/provider/provider.ts:205-219`), and `ANONYMOUS_API_KEY = "anonymous"` is then sent as `Bearer anonymous`. Prism will not fabricate it. Task 1b decides whether any anonymous shape needs it (test plain vs `Bearer anonymous`), and only then Task 2 adds one.
    - **(e) Shared hooks — decision: promote the adaptive-thinking hook.**
      - `commandCodeThinking` (`packages/providers/commandcode/src/provider.ts:29-39`) is five lines of Anthropic-Messages wire behaviour, not Command Code behaviour: Claude 5.x rejects `thinking.type: "enabled"` and needs `adaptive` + `output_config.effort` (measured live in plan 205 Task 1b). Kilo's Messages route serves exactly the same Claude ids.
      - Rule §1 puts wire code shared by providers in `@arnilo/prism/provider-kit` (`references/prism.md:23`), and this is the second user. **Task 2 promotes it as `anthropicAdaptiveThinking(request)`** in `src/provider-kit/thinking.ts` (or next to `resolveThinkingObject`), imports it in `packages/providers/kilo`, and keeps `commandCodeThinking` as a re-export alias so Command Code's public name and its baseline text do not change.
      - Baseline consequence: one new provider-kit export (not a root-barrel export), so `FROZEN_PROVIDER_KIT_EXPORTS` at `public-export-contract.test.ts:632`, the provider-kit inventory test, the `budgets.json` count note, and `scripts/compat-baseline/arnilo__prism.txt` move; `arnilo__prism-provider-commandcode.txt` and the new kilo baseline do not change because of the move. If Task 1b finds Kilo's gateway rejects adaptive on some model, the hook stays provider-owned and the promotion is dropped before Task 2 writes it.
    - **(f) Reference client.**
      - `@kilocode/cli` **7.8.18** (npm `latest`; `rc` 7.8.25), bins `kilo` and `kilocode`. The npm tarball is a thin wrapper (`bin/kilo` + `postinstall.mjs`) that fetches a platform binary package, so source is read at tag `v7.8.18` (repo tarball, 12318 paths). **Not installed** on this machine (`which kilo` → none).
      - Headless: `kilo run --format json "<task>"` (`packages/opencode/src/cli/cmd/run.ts:15,192,790-800`). It emits raw session events, and the assistant `message.updated` carries `info.tokens.{input,output,reasoning,cache.read,cache.write}` plus cost (`packages/core/src/session/{sql,projector,info}.ts`), so per-turn cache reads are readable without the TUI.
      - Key: `KILO_API_KEY` in the env (`packages/core/src/plugin/provider/kilo.ts:18`; `hasKey` in `kilocode/provider/provider.ts:205-212`), or `kilo auth login` (the device flow in `packages/kilo-gateway/src/auth/device-auth-tui.ts`, message referenced at `kilocode/cli/cmd/auto.ts:256`). No key → `apiKey: "anonymous"`.
      - Proxy: set `KILO_AI_GATEWAY_URL=http://127.0.0.1:8787/api/v1`. `resolveKiloAiGatewayBase` takes it verbatim (`packages/kilo-gateway/src/api/constants.ts:19-35`), and `resolveKiloOpenRouterBaseUrl` returns a base that equals `KILO_AI_GATEWAY_BASE` unchanged rather than rewriting it to `/api/openrouter/` (`api/url.ts:30-48`), so every wire is recorded at `/api/v1/{chat/completions,responses,messages}`. Run the proxy with `--upstream https://ai-gateway.kilo.ai`.
      - Route rule (CLI): `ai_sdk_provider === "anthropic"` → `sdk.anthropic()` (Messages), `"openai"` → `sdk.openai()` (Responses), `"openai-compatible"` → `sdk.openaiCompatible()` (Chat), anything else (absent, `openrouter`) → `sdk.languageModel()` (OpenRouter → Chat) (`kilocode/provider/provider.ts:222-228`). Same rule as the plan; `openrouter` is a Chat id, not a fourth wire.
      - Levers, default shipped path (the `@opencode-ai/llm` path is behind the `experimentalNativeLlm` flag, `session/llm.ts:337`):
        - **Messages:** content-level `providerOptions.anthropic.cacheControl = {type: "ephemeral"}` on the **first two system messages and the last two non-system messages** (up to 4), no `ttl`, **no tools marker** (`provider/transform.ts:410-495`). The "3 markers, last tool + last system + latest user" in `packages/llm/README.md` is the opt-in native path, not what the CLI ships.
        - **Responses:** no `prompt_cache_key` by default — it is set only when `providerOptions.setCacheKey === true` (`transform.ts:1620-1633`). GPT-5.6+ on kilo (`supportsPromptCacheBreakpoint`, `transform.ts:403-408,1626`) gets `providerOptions.openai.promptCacheBreakpoint = {mode: "explicit"}` on the same 2+2 placement, which `@ai-sdk/openai` 3.0.88 lowers to content `prompt_cache_breakpoint`. **Prism's Responses codec has no `prompt_cache_breakpoint` support** (only `store`, `include`, `omitFields`, `prompt_cache_key`, `promptCacheKeyMax`), so this is the one lever gap. Because Kilo's own measurement says the gateway places breakpoints itself, Task 1b tests markers on/off; only a measured difference justifies adding codec support in Task 2.
        - **Chat:** no cache fields at all; headers only.
        - **Headers on every kilo wire** (`session/llm/request.ts:253-268`): `X-KILOCODE-TASKID` = `sessionID` (unclamped), `x-session-affinity`, `X-Session-Id`, `X-KILOCODE-PARENT-TASKID` for subagents, `X-KILOCODE-PROJECTID` only with an org, `X-KILOCODE-MACHINEID`, `X-KILOCODE-FEATURE` only when `KILOCODE_FEATURE` is set, `HTTP-Referer`/`X-Title`/`User-Agent`, and `x-kilocode-mode` = the lowercased agent name on **every** request. The plan's "mode only on `kilo-auto/*`" is therefore a Prism restriction (kept: fewer invented bytes), not CLI parity; the README should say so. Operational lever parity is the task-id header plus the wire's cache markers.
        - **Data collection:** `provider.data_collection` is injected only when Kilo's `hide_prompt_training_models` is on (`kilo-gateway/src/responses.ts:29-50`), same as the plan's `dataCollection` config.
      - Messages auth observed in source: `createAnthropic(sdkOptions)` sends `x-api-key`, and the wrapped fetch adds `Authorization: Bearer` unconditionally when a key exists (`kilo-gateway/src/provider.ts:60-69`), so the gateway accepts both — matching `auth: "x-api-key+bearer"`.
    - **(g) Release-path fit.**
      - npm name free: `GET registry.npmjs.org/@arnilo%2Fprism-provider-kilo` → **404**. `kilo` appears in no `scripts/retired-names.json`, `scripts/deprecations-0.13.json`, or `RETIRED_PROVIDERS` entry.
      - Plan 184: three cells (one per wire) using `kilo run --format json`, gate Prism ≥ CLI; commands, models and the `KILO_AI_GATEWAY_URL` proxy line are in (f).
      - Plan 185: the freeze set becomes the eight 0.13.0 packages plus `commandcode` (nine in tree); Task 3's `SecretSource` migration list gains kilo, making nine provider packages and eight `SecretSource` consumers after migration (`openai-codex` is the exception); new baseline file included.
      - Plan 186: T1 becomes "eight shipped packages, nine rows with `liquid-local`"; add `providers/kilo` with three route legs, three model envs, `KILO_API_KEY` preflight, and the device-login leg as owner-run.
      - Plan 187: publish list eight; the umbrella's braced successor list is derived from the provider directories so kilo joins automatically; the human-readable "seven-package" message strings in plans 186/187 and `docs/release.md` need the sweep; deprecations stay 33; `package-truth` publishable 49.
      - Plan 194 overflow: the classifier's `CONTEXT_OVERFLOW_BODY` is `context_length_exceeded|maximum context length|context window exceeds limit|prompt is too long` and its statuses are `{400, 413, 422}` (`src/provider-kit/transport.ts:31-47`). Kilo documents **413 for a body over 20 MB** (a permanent size error, not overflow) and 400 for context overflow, so Task 2's 413 → `permanent` mapping must run before the shared body check can relabel it. Task 1b records the real 400 body; if it matches none of the phrases, add the vendor-neutral phrase and the `overflow_classified_per_supported_route` row in `src/__tests__/context-overflow-recovery.test.ts`.
    - **(h) Verdict and spend (for owner approval).**
      - **Proceed to Task 1b.** No stop condition: the vendor's own client builds OpenRouter, OpenAI and Anthropic SDK clients on one base, selects them from `ai_sdk_provider`, and sends both auth headers on Messages; the catalog is public and complete for routing.
      - **Budget:** Task 1b ≤ 50 requests. A ~8 K-token prefix with ≤ 300 output tokens costs ≈ $0.001 per request on Haiku 5.5 / GPT-6-Luna and ≈ $0.0001 on Gemma 4, so 1b is expected **under $0.05** against the proposed **$0.10** ceiling; Task 6's ≤ 60-request live run is expected under $0.06; total under $0.15 against the plan's $0.30. The free leg is $0.
      - **Owner actions before 1b:** add `KILO_API_KEY` to `~/.config/prism/live.env` (mode 0600, currently no such line), approve the spend, and be present once for the device-login round trip (not initiated in Task 1).
    - **Research-summary corrections (Tasks 1b–4 read these, not the table above).**
      1. Chat exemplar `google/gemma-4-26b-a4b-it` completion is **$0.03/M**, not 0.031; its max output is the catalog's **235 929**, not a 20 % guess.
      2. The CLI sends **no `prompt_cache_key`** on Responses by default; for GPT-5.6+ it sends explicit `prompt_cache_breakpoint` markers instead. Prism has no such lever yet; only a measured difference warrants building one.
      3. Messages marker placement is **first two system + last two non-system messages** (4 max), no TTL, no tools; "3 markers" is the opt-in native path.
      4. `x-kilocode-mode` is sent on **every** kilo request by the CLI, not only `kilo-auto/*`.
      5. Device-token lifetime: the CLI stores a one-year assumption (`TOKEN_EXPIRATION_MS`) with **no refresh**; whether the token is a JWT with `exp` is settled in Task 1b by decoding locally.
      6. Org catalog path and header confirmed in the CLI: `{gateway}/organizations/{id}/models` with `X-KILOCODE-ORGANIZATIONID` (`kilo-gateway/src/api/models.ts:213-231`). The docs' "15-minute expiry" is still unverified.
      7. The npm `@kilocode/cli` package is a binary wrapper, not runnable source; headless is `kilo run --format json`.
      8. Kilo sends `Authorization: Bearer` **and** `x-api-key` on Messages; use `auth: "x-api-key+bearer"`.

- [ ] Task 1b: Authenticated Kilo probes — three wires, usage, levers, errors, device login (the owner provides the key and approves the spend)
  - Acceptance Criteria:
    - Functional: at most 50 requests through `scripts/wire-proxy.mjs`. The Notes record:
      - **Per wire, on the Task 1 exemplars:** text; a tool loop; reasoning (Chat `reasoning` object or `reasoning_effort`, Responses `reasoning` with `summary`, Messages `thinking`, adaptive versus enabled on Claude 5.5); structured output where accepted; one image (a real 64×64 PNG; plan 205 found that 1×1 images are rejected); the usage chunk with every field name, including cost and cache fields (`cost_microdollars`? `cost`? `prompt_tokens_details.cached_tokens`? `cache_read_input_tokens`/`cache_creation_input_tokens`?).
      - **Cache levers, three identical turns per wire, with a nonce prefix so turn 1 is cold:** `X-KILOCODE-TASKID` on or off; on Messages, `cache_control` on or off (and on tools); on Responses, `prompt_cache_key` on or off. Kilo's 2026-09-04 claim (the gateway places its own breakpoints) is either confirmed or corrected.
      - **Responses with `store: false`:** whether `item_reference` items or input `id` fields are rejected (the CLI strips them, `responses.ts`), and whether encrypted-reasoning replay works.
      - **Errors:** 401 (bad key); 400 unknown model; 400 wrong wire (a Claude id on `/chat/completions`); one over-long prompt per wire, the cheap large-`max_tokens` row first; 413 **not** purchased; 402 and 403 recorded from the docs if the account cannot produce them, and marked as not observed; the mid-stream `finish_reason: "error"` shape on each wire if one occurs; 429 only if reached.
      - **Anonymous:** one `:free` request with no `Authorization`, and one with `Bearer anonymous`. Record which the gateway accepts.
      - **Device login, once, with the owner present:** initiate, the owner approves in the browser, the poll returns `token` and `userEmail`, and `GET /api/profile` returns the organization fields. Also record whether the device token works on all three wires and on `/models`, and the observed lifetime if the token is a JWT with `exp` (decode the payload locally; never print the token).
      - **Organization**, only if the owner's account has one: `X-KILOCODE-ORGANIZATIONID` on a chat request and on `/organizations/{id}/models`. Then settle the docs' "15-minute expiry" claim.
      - **Reference client:** `kilo` headless runs per wire through the proxy, reporting cache reads, plus one recorded request body and header set per wire. Install it only with the owner's approval: `npm i -g @kilocode/cli@<pinned>`.
    - Performance: ≤ 50 requests, under the approved ceiling (proposed $0.10). The measured figure is recorded per row.
    - Code Quality: no code changes. Recorded bodies go to Task 2's fixtures with request headers and credentials removed.
    - Security:
      - `live.env` is checked for mode `0600` first.
      - Recordings are scrubbed of `authorization` and of any `token` field in device-auth responses.
      - The device token is never printed, logged, or committed. It lives only in the owner's keyring or `live.env`.
  - Approach:
    - Documentation Reviewed:
      - Task 1 Notes; plan 205 Task 1b (the same probe shape and recorder).
    - Options Considered:
      - Trusting Kilo's published cache measurement and skipping the lever rows. Rejected: it is three months old, measured on two models, and the parity gate needs our own numbers.
    - Chosen Approach:
      - `scripts/wire-proxy.mjs --upstream https://ai-gateway.kilo.ai --record "$SCRATCH/kilo" --secret-env KILO_API_KEY`, with `curl` and `KILO_AI_GATEWAY_URL=http://127.0.0.1:8787/api/v1 kilo …`.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/wire-proxy.mjs --upstream https://ai-gateway.kilo.ai --listen 127.0.0.1:8787 \
        --record "$SCRATCH/kilo" --secret-env KILO_API_KEY
      ```
    - Files to Create/Edit:
      - this plan's Task 1b Notes only.
    - References:
      - Task 1; plan 205 Task 1b.
  - Test Cases to Write:
    - n/a (read-only probes).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `@arnilo/prism-provider-kilo` — key auth, three routes, catalog, errors
  - Acceptance Criteria:
    - Functional:
      - **Package shell** (`defineProviderPackage`). Config:

        | Field | Type | Default | Notes |
        | --- | --- | --- | --- |
        | `apiKey` | ref | `env:KILO_API_KEY` | `secretRefProperty`; wins over the login credential when it resolves |
        | `credential` | ref | `keyring:kilo` | where Task 3's device login stores its token. Must be a `keyring:` ref (`assertWritableCredentialRef` precedent) |
        | `baseUrl` | string | `https://ai-gateway.kilo.ai/api/v1` | `baseUrlProperty` |
        | `organizationId` | string | — | overrides the login-time organization. Sends `X-KILOCODE-ORGANIZATIONID` and switches discovery to `/organizations/{id}/models` |
        | `dataCollection` | `"allow"` \| `"deny"` | — | body `provider.data_collection`, only when set |
        | `mode` | string | — | `x-kilocode-mode`, sent only on `kilo-auto/*` models |
        | `models` | ModelConfig[] | — | when absent, `models()` asks `GET /models` |

        Factory-only options: `id` (default `kilo`) and `fetch`.

        When neither `apiKey` nor `credential` resolves, the package emits a `warn` note: "kilo: no API key at env:KILO_API_KEY and no login at keyring:kilo; only :free models are reachable". The provider still registers, and requests carry whatever Task 1b found the gateway accepts for anonymous use.
      - **Routes** (`createRoutedProvider`; `routeFor` = `compat.route`, else the route stamped from `opencode.ai_sdk_provider`, else `chat`):
        - `chat`: `openai-chat` on `/chat/completions`, bearer. The codec settings mirror OpenRouter's chat route (`packages/providers/openrouter/src/provider.ts:73-100`): `reasoningReplay: "reasoning_details"`, `reasoningObject: resolveReasoningObject`, `imageInput: "capability-gated"`. They are copied as values, not imported, and adjusted by Task 1b's findings.
        - `responses`: `openai-responses` on `/responses`, bearer. `store: false`, plus `omitFields` and an input transform only if Task 1b recorded rejections.
        - `messages`: `anthropic-messages` on `/messages`, with the auth form Task 1b found accepted. Cache breakpoints match the Kilo CLI's placement from Task 1 (f) and Task 1b. Thinking uses the Task 1 (e) decision.
        - Every route carries the affinity header `X-KILOCODE-TASKID` = `sanitizeCacheKey(cacheKey ?? sessionId, <cap from Task 1b>)`. `X-KILOCODE-ORGANIZATIONID` and `x-kilocode-mode` are provider-owned headers.
      - **Usage:** each route's mapper covers the fields Task 1b recorded. Cost goes into `Usage.cost` in USD (microdollars ÷ 1e6 if that is the field). Cache reads and writes map where reported. A field that is never reported stays undefined, never fabricated. Gateway routing metadata (the served model, as the CLI reads in `gateway-metadata.ts`) goes into `usage.metadata.kilo` if present.
      - **Errors** (`kiloHttpError`, always through `providerHttpError` so the class comes from `classifyProviderFailure`):
        - 401 → `auth`, with a hint naming both refs and "run the kilo login again". Device tokens do not refresh.
        - 402 → not retried, with the hint "add Kilo credits". The `buyCreditsUrl` is shown only if it is an `https://*.kilo.ai` URL.
        - 403 → `auth` by the shared rule, with the hint "model not allowed by the organization's policy".
        - 413 → `permanent`, **not** overflow.
        - 429 → `rate_limited` with `Retry-After`; the hint mentions the free-model limit of 200 requests per hour.
        - 502 and 503 → `transient`.
        - Wrong-wire 400 → `permanent`, naming `compat.route`.
        - The recorded overflow bodies → `context_overflow` (plan 194). If a body does not match `CONTEXT_OVERFLOW_BODY`, add the vendor-neutral phrase and put the body in `overflow_classified_per_supported_route` (`src/__tests__/context-overflow-recovery.test.ts`).
        - Mid-stream error frames on each wire surface as a provider error, never as a silent `end_turn`.
      - **Catalog:** `listKiloModels` reads `GET /models` (or the org path) once and maps:
        - `context_length` → `limits.contextWindow`;
        - `top_provider.max_completion_tokens ?? max_completion_tokens` → `maxOutputTokens`, left undefined otherwise. Kilo's own fallback of 20% of the context is a guess and is not copied;
        - `input_modalities` image → `capabilities.input`;
        - `supported_parameters` → `tools`, `reasoning`, and `structuredOutput` (`structured_outputs` or `response_format`). An empty list claims tools, as Kilo's `supportsTools` does;
        - pricing → `cost` per 1M, including cache read and write;
        - `ai_sdk_provider` → `compat.route`;
        - `isFree` and `mayTrainOnYourPrompts` → `compat`, so a host can filter.

        A static `kiloModels` holds the three exemplars with `compat.pricing_source` (catalog URL and date).
      - **Recordings** under `src/__tests__/wire/{chat,responses,messages}/`: `text`, `tool-loop`, `thinking`, `structured-output`, `image`, `cache` (3 turns), and the error set. Each fixture is built from Task 1b's bodies. `wire/README.md` records the provenance.
      - `providerConformance({ recordings })` passes for all three routes offline. `live.test.ts` runs `runProviderLiveScenarios` with `routes: {openai, responses, anthropic}` on the exemplars (model envs `PRISM_LIVE_KILO_{CHAT,RESPONSES,MESSAGES}_MODEL`), skipping without `KILO_API_KEY`.
    - Performance:
      - Importing the package evaluates no sibling provider.
      - Discovery is one request, with no key needed for the personal catalog.
      - The README states the spend per live run (≈ 30 requests, under $0.05 at the exemplar rates), the free-model limit, and the cost of the opt-in `organizationId` and `mode` knobs: neither adds requests.
    - Code Quality:
      - Follows the shape of `packages/providers/commandcode`. The route rule is one pure function (`routeForKiloModel`) with tests.
      - No import from a sibling provider. Every value copied from OpenRouter or Command Code is named in a comment with its source.
      - Enforcement rows from Task 1 (b) are updated in this task, and counts are regenerated, not hand-edited.
      - New baseline `scripts/compat-baseline/arnilo__prism-provider-kilo.txt` via `timeout 1800 bun scripts/release.mjs gate --update-baseline`, with the diff in the task note. If Task 1 (e) promotes the thinking hook to provider-kit, the root and `commandcode` baselines are regenerated too, `public-export-contract.test.ts` is updated deliberately, and `commandcode` imports the promoted export in the same task (repo-wide grep for `commandCodeThinking`).
    - Security:
      - `apiKey` and `credential` are ref-only. A literal secret in config is refused by `secretRefProperty`.
      - Caller headers cannot override `authorization`, `X-KILOCODE-TASKID`, `X-KILOCODE-ORGANIZATIONID`, or `x-kilocode-mode` (`applyOwned`, `routed-provider.ts:174-183`).
      - The key never appears in events, errors, `inspect()`, or recordings.
      - **Token-embedded base URLs are not honoured.** Kilo's client derives the request host from tokens shaped like `https://host:…` (`auth/token.ts` `getKiloUrlFromToken`), which would let a pasted credential redirect traffic. Prism always uses the configured `baseUrl`.
      - The README states that `:free` models and `kilo-auto/free` may route to upstreams that log prompts, and that `mayTrainOnYourPrompts` is surfaced in `compat`.
  - Approach:
    - Documentation Reviewed:
      - Task 1 and 1b Notes; `packages/providers/commandcode/src/{provider,models,index}.ts`; `packages/providers/openrouter/src/{provider,models,index}.ts`; `docs/provider-kit.md` "Shipping a provider".
    - Options Considered:
      - Chat-only through the OpenRouter-compatible endpoint (OpenClaw's choice). Rejected for the reason in Task 1.
      - Importing OpenRouter's catalog mapper and usage mapper. Rejected: sibling imports are forbidden (`references/prism.md` §4 "Provider package"), and Kilo's catalog adds `ai_sdk_provider`, `isFree`, and aliases.
      - Promoting an OpenRouter-schema catalog mapper to provider-kit. Rejected for now: one existing user plus this one, and they differ in routing fields. Recorded as a Further Actions candidate if a third gateway appears.
    - Chosen Approach:
      - Three routes on existing codecs, a catalog-driven route rule, and levers matched to the Kilo CLI per wire.
    - API Notes and Examples:
      ```ts
      import { kilo } from "@arnilo/prism-provider-kilo";
      const agent = await createAgent({ model: "kilo/anthropic/claude-haiku-5.5", packages: [kilo({ dataCollection: "deny" })] });
      ```
      ```jsonc
      // manifest
      { "name": "@arnilo/prism-provider-kilo", "config": { "apiKey": "env:KILO_API_KEY" } }
      ```
    - Files to Create/Edit:
      - `packages/providers/kilo/{package.json, README.md, CHANGELOG.md, LICENSE, bunfig.toml, tsconfig.json}` (copied from `commandcode`).
      - `packages/providers/kilo/src/{index,provider,models}.ts` and `src/__tests__/{kilo.test.ts, package.test.ts, live.test.ts, overflow-session.ts, wire/**}`.
      - The Task 1 (b) enforcement-row files, `scripts/compat-baseline/arnilo__prism-provider-kilo.txt`, `bun.lock`, `CHANGELOG.md`.
      - Tentative (only if Task 1 (e) promotes the thinking hook): `src/provider-kit/**`, `packages/providers/commandcode/src/provider.ts`, `src/__tests__/public-export-contract.test.ts`, and the root and commandcode baselines.
    - References:
      - plans 203 Task 4, 205 Task 2.
  - Test Cases to Write:
    - `kilo_package_conformance_three_routes`: recorded exchanges pass `providerConformance` per route. Fails if a codec option or a route path is wrong.
    - `kilo_route_rule`: `anthropic` → messages, `openai` → responses, absent or `openrouter` → chat, and an explicit `compat.route` wins. Fails if the rule is inverted or ignores the pin.
    - `kilo_task_id_header_owned`: `X-KILOCODE-TASKID` equals the sanitized session key on all three routes, and a caller's value loses. Fails if affinity moves to caller headers.
    - `kilo_org_and_mode_headers`: the org header appears only when configured; `x-kilocode-mode` appears only on `kilo-auto/*`.
    - `kilo_data_collection_body`: `provider.data_collection` appears only when configured.
    - `kilo_usage_mapping_per_wire`: cost and cache fields from the recorded bodies; absent fields stay undefined.
    - `kilo_error_mapping`: each status in the table, with the class and the hint. 402 is not retried.
    - `kilo_mid_stream_error_surfaces`: a 200 stream ending in `finish_reason: "error"` (and the Responses and Messages equivalents) yields a provider error.
    - `kilo_overflow_classified_and_recovered`: the recorded body classifies `context_overflow`, and a session on a replaying mock compacts once and retries once.
    - `list_kilo_models_maps_catalog`: windows, modalities, tools, reasoning, cost ×1e6, route, `isFree`; alias handling per Task 1 (c); the org path when `organizationId` is set.
    - `kilo_missing_credential_notes_and_registers`: the `warn` note text, and the provider is still registered.
    - `kilo_ignores_token_embedded_base_url`: a credential shaped `https://evil.example:abc` still sends to the configured `baseUrl`.
    - `kilo_secret_never_leaks`: the key is absent from events, errors, and `inspect()`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new provider package).
    - Docs pages to create/edit:
      - `packages/providers/kilo/README.md` (package page structure), with sections "Routes" (three wires and the rule), "Authentication" (key and device login; the login section is filled in by Task 3), "Organizations", "Prompt caching" (the gateway's own breakpoints, the `X-KILOCODE-TASKID` lever, cache pricing, the ratio caveat), "Free models and data collection", and "Cost".
      - `docs/models.md` (provider table and count), `docs/release.md` (regenerated block), `docs/live-testing.md` (regenerated), `packages/providers/README.md` (shipped list), `CHANGELOG.md` under `## [Unreleased]`.
    - `docs/index.md` update: yes. "`@arnilo/prism-provider-kilo`: Kilo AI Gateway (Chat, Responses, Messages) with API-key and device login."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Kilo device login — `AuthMethod`, organization choice, logout
  - Acceptance Criteria:
    - Functional:
      - `kiloAuth()` returns `{kind: "oauth", id: "kilo", login(ctx)}`, and the package declares it in `ModelProvider.auth` next to `{kind: "api-key", ref: "env:KILO_API_KEY"}`.
      - `login(ctx)` performs these steps:
        1. `POST {authBase}/api/device-auth/codes`, where `authBase` defaults to `https://api.kilo.ai`.
        2. Validates that `verificationUrl` is `https:` on the auth host or `app.kilo.ai` (allowlist from Task 1b).
        3. Calls `ctx.host.ui` `open-url` with the URL and an instruction naming the code.
        4. Polls `GET …/codes/{code}` every 3 s until `expiresIn` runs out: 202 → continue, 200 → approved, 403 → `KiloAuthError("ERR_KILO_AUTH_DENIED")`, 410 → `"ERR_KILO_AUTH_EXPIRED"`, a 429 on initiate → `"ERR_KILO_AUTH_BUSY"`.
        5. Reads `GET /api/profile`. When there is more than one choice (personal account and organizations), it asks through `host.ui` `input`, defaulting to the CLI's rule (`selectedOrganizationId` if valid, otherwise the first organization when there is no personal account).
        6. Stores one `bearer` secret at the `credential` ref, with metadata `{v: 1, email, organizationId?, obtainedAt, expires}`. `expires` is the JWT `exp` if present, otherwise one year (the CLI's assumption, labelled as such in the README).
      - The request-time source prefers `apiKey`, then the stored credential, and the stored `organizationId` applies unless config overrides it.
      - `logout` deletes the credential ref. There is no revoke endpoint, and the README says so.
      - Abort: `ctx` or `host.ui` cancellation stops polling at once and stores nothing.
    - Performance:
      - Polling runs only during login, one request per 3 s, bounded by `expiresIn`.
      - No request-time cost: no refresh and no profile call per request.
    - Code Quality:
      - The module is `src/auth.ts`, with no dependency, following `openai-codex/src/oauth.ts` in shape only. There is no shared device-code helper: Kilo's protocol is not RFC 8628, and the old generic helper stays retired (`src/__tests__/provider-kit.test.ts:407`).
      - The package declares `credentials:write`. The compat baseline is regenerated with the diff in the note.
    - Security:
      - The token, the `userEmail`, and the raw poll body never appear in a `host.ui` payload, a status note, an error message, a log, or an event. Only the code and the verification URL are shown.
      - A `verificationUrl` outside the allowlist fails closed with `ERR_KILO_AUTH_ORIGIN`, and nothing is opened.
      - `host.ui` answering `unavailable` → `ERR_KILO_AUTH_UI`, and nothing is stored.
      - A non-`keyring:` credential ref → refused before any request.
      - Non-JSON or oversized poll bodies are read bounded (`readBoundedResponseJson`).
  - Approach:
    - Documentation Reviewed:
      - `Kilo-Org/kilocode` `packages/kilo-gateway/src/auth/{device,device-auth-tui,polling}.ts`, `api/profile.ts`, `types.ts` (`DeviceAuthInitiateResponse`, `DeviceAuthPollResponse`); `packages/providers/openai-codex/src/{oauth,index}.ts`; `src/contracts-core/provider.ts:80-92`; Task 1b's live login notes.
    - Options Considered:
      - Key only, with no login. Rejected: the device login is Kilo's primary sign-in for its own clients, and the owner asked for the integration to cover authentication.
      - Running the login inside `setup`. Rejected: the kernel never runs `login`, a host does (`AuthContext` comment, `provider.ts:79`).
      - Persisting through a host-managed token file. Rejected: `credentials:write` exists for exactly this (plan 204).
    - Chosen Approach:
      - A host-invoked `oauth` method over `host.ui` and the writable credentials slot, mirroring the CLI's protocol and defaults.
    - API Notes and Examples:
      ```ts
      // A host reads the provider's declared auth methods and runs the oauth one; the kernel never does.
      const login = kiloProvider.auth!.find((m) => m.kind === "oauth" && m.id === "kilo");
      await login.login({ host, credentials }); // credentials: the writable slot (store/delete)
      ```
    - Files to Create/Edit:
      - `packages/providers/kilo/src/auth.ts`, `src/index.ts` (declare `auth`, `credentials:write`, the credential resolution order), `src/__tests__/auth.test.ts`, `README.md` (Authentication section), `scripts/compat-baseline/arnilo__prism-provider-kilo.txt`, `CHANGELOG.md`.
    - References:
      - plan 204 Tasks on OAuth and `credentials:write`.
  - Test Cases to Write:
    - `kilo_login_happy_path`: fake fetch 202, 202, 200, then profile → stored secret, metadata, `open-url` payload contains the code and the URL and no token.
    - `kilo_login_denied_expired_busy`: 403, 410, and a 429 on initiate map to their codes, and nothing is stored.
    - `kilo_login_rejects_foreign_verification_url`: `http://` or a foreign host → `ERR_KILO_AUTH_ORIGIN`, and `open-url` is never called.
    - `kilo_login_org_choice`: multiple organizations → `input` is asked; the default follows the CLI rule; a single choice asks nothing.
    - `kilo_login_ui_unavailable`: → `ERR_KILO_AUTH_UI`, and nothing is stored.
    - `kilo_login_abort_stops_polling`: abort mid-poll → no further fetch, nothing stored.
    - `kilo_credential_resolution_order`: `apiKey` wins; otherwise the stored credential; a config `organizationId` overrides the stored one.
    - `kilo_login_never_leaks_token`: the token string is absent from every `host.ui` call, note, error, and event.
    - `kilo_logout_deletes_ref`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (an auth method and a capability on the new package).
    - Docs pages to create/edit:
      - `packages/providers/kilo/README.md` "Authentication": both paths, the host's responsibility to call `login`, the one-year token and re-login, organizations, and logout.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no (the entry was added in Task 2).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Cache parity with the Kilo CLI — lever equivalence, probe, plan 184 cells
  - Acceptance Criteria:
    - Functional:
      - `cache_levers_match_kilo_cli` (offline), per wire, on plan 203's 3-turn fixture. It asserts:
        - Prism's cache-relevant fields and headers equal the Kilo CLI's recorded request (from Task 1b): `X-KILOCODE-TASKID`, the `cache_control` placement on Messages, and any Responses cache key;
        - tools, system or instructions, and earlier messages are byte-identical across turns.
      - `provider-probe.mjs --provider kilo --model <exemplar> --turns 4` runs once per wire, with these thresholds (from Kilo's ratio caveat):
        - Messages: reuse ≥ 0.8 on turns 2–4;
        - Responses and Chat: `cacheReadTokens > 0` on turns 2–4, with the value recorded;
        - a wire that reports no cache counts is recorded as `unmeasurable` and the README says so.
      - **Plan 184 is amended** with three `kilo` cells (Prism against the Kilo CLI headless, one model per wire, using Task 1 (f)'s commands). Gate: Prism ≥ Kilo CLI per cell. Plan 184 has not run yet, so these cells are **part of the 0.13.0 parity gate**, not a later amendment.
    - Performance: about 12 requests per probe run across the wires, stated in the live matrix.
    - Code Quality: plan 203's probe and fixture are unchanged. The probe derives `KILO_API_KEY` from the id, so it needs no alias.
    - Security: the probe prints no key. The reference fixtures contain no credential or request-auth header.
  - Approach:
    - Documentation Reviewed:
      - plan 205 Task 3; plan 184; Kilo's measurement table (`harness-sdk/AGENTS.md`); Task 1b's lever rows.
    - Options Considered:
      - pi with the third-party `pi-kilocode` extension as the reference. Rejected as the primary reference: the Kilo CLI is the vendor's own client and defines the headers. If the owner has `pi-kilocode` installed, record it as a secondary data point.
      - One cell for the whole provider. Rejected: the three wires book cache differently.
    - Chosen Approach:
      - Per-wire equivalence, probe, and cells.
    - API Notes and Examples:
      ```sh
      timeout 900 bun scripts/cache-parity/provider-probe.mjs --provider kilo --model anthropic/claude-haiku-5.5 --turns 4
      ```
    - Files to Create/Edit:
      - `packages/providers/kilo/src/__tests__/cache-levers.test.ts`, `fixtures/kilo-cli-request-{chat,responses,messages}.json`, `fixtures/README.md` (provenance, CLI version, adaptations).
      - `plans/184-Phase-11-Part-K-Prompt-Cache-Parity-With-Pi.md` (three cells and an "Amended 2026-10-31 by plan 213" paragraph).
      - `docs/_evidence/cache-probe/kilo-*.json`.
    - References:
      - plan 203 Task 5; plan 205 Task 3.
  - Test Cases to Write:
    - `cache_levers_match_kilo_cli` (three cases). Fails if a marker moves, the task-id header is dropped, or the prefix changes between turns.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - the README "Prompt caching" section gets the measured figures.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Roadmap and release-path rows
  - Acceptance Criteria:
    - Functional:
      - `roadmap.md`:
        - the Updated line gains a 2026-10-31 entry for the owner decision;
        - §2.9's provider row adds `kilo`;
        - Phase 5's shipped set becomes `{hyper, opencode-go, typesafe, laya, liquid, openrouter, openai-codex, kilo}`, with the decision date.
      - Plans 184, 185, 186, and 187 get "Amended 2026-10-31 by plan 213":
        - 184: the cells from Task 4.
        - 185: the freeze set and the `SecretSource` migration list include `kilo`. The new package uses the same credential shape as `openrouter`.
        - 186: a strict `providers/kilo` row with three legs, a preflight check for `KILO_API_KEY`, and the device-login leg as owner-run.
        - 187: the publish list is eight providers. A new npm name needs no deprecation entry. `kilo` must not enter `scripts/retired-names.json`.
      - The `plans/README.md` 187 step text ("seven providers") and the 213 row are updated.
      - Sweep: `rg -n "seven provider|7 provider" src packages apps scripts examples docs roadmap.md PRODUCT.md` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds no stale count.
    - Performance: n/a.
    - Code Quality: only unchecked tasks in other plans are edited.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plans 184–187; roadmap §2.9 (`roadmap.md:598`) and Phase 5 (`roadmap.md:1794`); plan 205 Task 4.
    - Options Considered:
      - n/a: these rows are required.
    - Chosen Approach:
      - Enumeration amendments, as plan 205 Task 4 made.
    - API Notes and Examples:
      ```markdown
      **Amended 2026-10-31 by plan 213 (Kilo Gateway ships in 0.13.0).** …
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `PRODUCT.md` (only if it names the provider set), `plans/{184,185,186,187}-…md`, `plans/README.md`, `docs/models.md` (0.13.0 count sentence).
    - References:
      - plan 205 Task 4.
  - Test Cases to Write:
    - the existing `docs.test.ts` plans-index check and `truth-current.test.mjs`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/models.md` count sentence only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Live acceptance on all three wires and the device login (the owner provides the key, approves the spend, and approves one login)
  - Acceptance Criteria:
    - Functional:
      - `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/kilo bun run test:live` passes all three route legs: text, tool loop, thinking, structured output where supported, abort, error, and leak scan.
      - `live-agent.test.ts`: per wire, one multi-turn `createAgent` session with a tool and one image turn, through the kernel loop. This proves the route rule end to end.
      - An anonymous `:free` request succeeds with no credential.
      - With `dataCollection: "deny"`, one request succeeds or returns the mapped policy error.
      - The device login runs once with the owner: the stored credential drives one request per wire, and logout deletes it.
      - `provider-probe.mjs` meets Task 4's thresholds.
      - `docs/_evidence/kilo-live-<date>.md` records models, request counts, spend (from usage cost or the listed rates), reuse figures, the login round trip (without the token), and the leak scan.
    - Performance: at most 60 requests and an approved spend ceiling (proposed $0.30). The measured counts correct the matrix `cost` line.
    - Code Quality: each defect gets a fixture, a test in the owning file, and a fix.
    - Security:
      - `live.env` mode `0600` is checked first.
      - `bun scripts/scan-secrets.mjs` passes over the evidence.
      - The login token is never in the evidence.
  - Approach:
    - Documentation Reviewed:
      - `docs/live-testing.md`; plan 205 Task 5.
    - Options Considered:
      - Provider-level scenarios only. Rejected: the route rule and the credential resolution only show up in a kernel run.
    - Chosen Approach:
      - The strict row, a kernel smoke per wire, the anonymous and data-collection checks, one owner-run login, and the probe.
    - API Notes and Examples:
      ```sh
      timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/kilo bun run test:live
      ```
    - Files to Create/Edit:
      - `packages/providers/kilo/src/__tests__/live-agent.test.ts` (gated like `live.test.ts`); `docs/_evidence/kilo-live-<date>.md`; the `scripts/live-matrix.json` cost line; `scripts/e2e-coverage.json`; regenerated `docs/live-testing.md`.
    - References:
      - Tasks 2–4.
  - Test Cases to Write:
    - `live-agent.test.ts`: per wire, a 2-turn agent session with one tool plus an image turn. Skips without the key.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 900 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-provider-kilo test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts src/__tests__/install-smoke.test.ts src/__tests__/release.test.ts`
- `timeout 600 bun test --timeout=0 scripts/live-matrix.test.mjs scripts/phase24-truth.test.mjs scripts/phase54-package-map.test.mjs scripts/retired-providers.test.mjs scripts/truth-current.test.mjs`
- `timeout 600 bun run --filter @arnilo/prism-provider-commandcode test` (only if Task 1 (e) promoted the thinking hook)
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 1200 env PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/kilo bun run test:live` (owner key; Task 6)

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
