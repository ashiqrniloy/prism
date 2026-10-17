# Phase 11 Part J — supported providers: Hyper, OpenCode Go, Jev, Laya

## Objectives

- Rebuild `@arnilo/prism-provider-hyper` and `@arnilo/prism-provider-opencode-go` on the plan 182 kit, so each package is a routes table, codec options, a catalog, and vendor extras.
- Make `@arnilo/prism-provider-typesafe` (Jev) and `@arnilo/prism-provider-laya` the same shape: same files, same export names, one key policy setting, one plaintext-endpoint check, and one shared test suite.
- Test all four packages against recorded streams offline and against the real service live. Laya's live tests run against a `laya-serve` on the dev machine.
- Make "a shipped provider has recordings, a live suite, and a live-matrix row" a gate, so an untested provider package cannot be added later.

## Expected Outcome

- `packages/providers/{hyper,opencode-go}/src/` each hold `index.ts` (package), `provider.ts` (one `createRoutedProvider` call), `models.ts` (catalog and discovery), and the vendor extras (Hyper: `quota.ts`, `telemetry.ts`). Their `openai-chat.ts`, `thinking.ts`, and `cache.ts` copies are gone.
- `packages/providers/{typesafe,laya}` have the same file list, the same export pattern (`<VENDOR>_DEFAULT_BASE_URL`, `<VENDOR>_DEFAULT_API_KEY_REF`, `<vendor>Models`, `define<Vendor>Model`, `create<Vendor>Provider`), and differ only in data: base URL, key policy, catalog, limits, cost.
- Every package has `src/__tests__/wire/<route>/*.json` recordings, passes `providerConformance({ recordings })`, and has a `live.test.ts` with the shared scenario list for its format.
- `scripts/live-matrix.json` has active rows `providers/hyper`, `providers/opencode-go`, `providers/typesafe`, `providers/laya`.
- `docs/_evidence/provider-live-0.13.0.md` records one green strict live run of all four rows.

**0.13.0 release path — plan 183 of 181–187.** Start it when plan 182 is complete; when this plan is complete, continue with plan 188 (step 4; see `plans/README.md`). Plans 181–188 run strictly in step order, and nothing runs in parallel.

This plan is a pre-publish part of roadmap **Phase 11** and depends on plan 182 (the kit foundation). It changes no kernel contract. It rebuilds four provider packages on the kit plan 182 shipped, so its first task is an **entry check**, not a phase review. Live runs use keys from `~/.config/prism/live.env` (owner decision 2026-10-15): `HYPER_API_KEY`, `OPENCODE_GO_API_KEY`, `TYPESAFE_API_KEY`. Laya needs no key on loopback; the owner starts `laya-serve` per `laya-amd-setup.md` §5 before a Laya live run. The executor never asks for a key in chat. No version bump or publish. Cost knobs: each live suite states its request count in its manifest row.

## Tasks

- [ ] Task 1: Entry check (read-only)
  - Acceptance Criteria:
    - Functional: The task note records:
      - (a) plan 182 as landed: the kit's exports (`createRoutedProvider`, codec options, `normalizeUsage`, `replayFetch`, `providerConformance({ recordings })`, the `last_message` breakpoint, `affinity`), with any difference from what Tasks 2–5 assume;
      - (b) Hyper: from its docs (dated), whether a prompt-cache key or session-affinity header exists for `/chat/completions` and `/messages`, whether `ttl: "1h"` is accepted, the `/v1/models` fields the catalog maps (`packages/providers/hyper/src/models.ts:150-200`), and the current live catalog (one authenticated `GET /models`, through `listHyperModels`);
      - (c) OpenCode Go: the same questions, the `x-opencode-session` requirement (`packages/providers/opencode-go/src/cache.ts:5-28`), and which catalog models use the Anthropic route today (`models.ts:300-350`) against the live `/models`;
      - (d) Jev and Laya: the System One request/response shape both servers return today (one Jev call, one call to local `laya-serve`), whether `laya-serve` accepts a Bearer key when `LAYA_API_KEY` is set server-side, and the file-by-file differences between the two packages (the 2026-10-16 review found: Laya alone has the plaintext-endpoint warning, `packages/providers/laya/src/models.ts:56-84`; names differ, `DEFAULT_LAYA_BASE_URL` vs `TYPESAFE_DEFAULT_BASE_URL`; both warn on a missing key, `index.ts:83`, which is wrong for a keyless loopback Laya; Laya has no live test);
      - (e) the test model per (provider, route) for Tasks 5–6, using the cheapest catalog model that supports tool calls and reasoning on that route: Hyper chat (plan 186 default `deepseek-v4-pro`), Hyper Anthropic (`qwen3.6-plus`), OpenCode Go chat, OpenCode Go Anthropic, Jev `jev-latest`, Laya `laya`.
      - Verdict: proceed, or re-cut.
    - Performance: n/a — read-only; at most one request per vendor.
    - Code Quality: Findings cite `file:line` or a dated vendor doc URL.
    - Security: The probes use keys from the env file through `env:` refs; nothing in the note contains a key.
  - Approach:
    - Documentation Reviewed:
      - plan 182 notes; the four package READMEs; Hyper docs (`https://hyper.charm.land/docs`), OpenCode Go docs (`https://opencode.ai/docs/go/`), TypeSafe docs, `laya-amd-setup.md`.
    - Options Considered:
      - Skip the vendor probes and trust the catalogs. Rejected: the catalogs encode 2026-07 snapshots, and the cache behaviour is what plan 184 measures.
    - Chosen Approach:
      - One read-only check with at most one call per vendor.
    - API Notes and Examples:
      ```bash
      bun scripts/live-preflight.mjs --suite providers/hyper --probe   # a one-off listHyperModels call (the preflight script arrives in plan 186)
      curl -s http://127.0.0.1:8000/v1/systemone -H 'content-type: application/json' -d fixture.json
      ```
    - Files to Create/Edit:
      - this plan (task note only).
    - References:
      - plan 182; owner decisions 2026-10-16.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Hyper on the routed builder
  - Acceptance Criteria:
    - Functional: `createHyperProvider` is one `createRoutedProvider` call with routes `openai` (`/chat/completions`, bearer, `reasoningReplay: "reasoning_content"`, `maxTokensField: "max_tokens"`) and `anthropic` (`/messages`, `x-api-key+bearer`, `anthropic-version: 2023-06-01`), with `routeFor` from `model.compat.route` / `routeForHyperModel`. `mapUsage` adds Hyper's `usage.cost` and `usage.remaining` (today's `parseHyperUsageCost`) to `Usage.cost`/`currency` and a `metadata.hyper` field, so hosts no longer parse them by hand. Affinity follows Task 1 (b).
    - Functional: `openai-chat.ts`, `thinking.ts`, `cache.ts`, and `retry.ts` are deleted; anything they did that the kit does not do becomes a codec option or `mapHttpError` (402 `billing_error` is non-retryable). Their public exports (`hyperChatBody`, `hyperChatEvents`, `serializeHyperChatMessage`, `hyperPreserveThinking`, `hyperReasoningEffort`, `hyperThinking`, `stripHyperOwnedCompat`, `applyHyperAnthropicCacheControl`, `hyperAnthropicCacheEnabled`, `classifyHyperError`, `hyperHttpError`) are removed, and the baseline is regenerated (`bun scripts/release.mjs gate --update-baseline`, `scripts/compat-baseline/arnilo__prism-provider-hyper.txt`), with the diff in the note.
    - Functional: Recordings from Task 1 (e)'s models: chat text, chat two-turn tool loop with `reasoning_content` replay, chat warm-prefix replay with `cached_tokens`, structured output, an error (invalid model) and a 402-shaped error if one can be produced safely (otherwise a hand-made fixture marked as such). The Anthropic route's recordings come from plan 182 Task 6. `hyper.test.ts` keeps only tests of Hyper-owned behaviour (routing, catalog mapping, cost fields, credits); stream and serialization behaviour is covered by `providerConformance({ recordings })`.
    - Functional: `getHyperCredits`, `listHyperModels`, the catalog, and the package shell (`index.ts`) keep their behaviour; the package README documents two routes.
    - Performance: Same request count per turn as before; `src/` shrinks (record line counts before/after).
    - Code Quality: No helper here repeats a kit helper; no vendor branch in the kit.
    - Security: The package conformance tests (`hyper_key_never_surfaces`, literal-key rejection) stay; recorded fixtures pass `assertNoSecretLeak` against the real key at record time (plan 182 Task 5).
  - Approach:
    - Documentation Reviewed:
      - Task 1 (a), (b); `packages/providers/hyper/src/*`; plan 182 Tasks 6–8.
    - Options Considered:
      - Keep the old public helpers as wrappers over the kit. Rejected: no aliases (roadmap rule), and no host depends on them (plan 182 Task 1 (a)).
    - Chosen Approach:
      - Routes as data, Hyper extras as `mapUsage`/`mapHttpError`.
    - API Notes and Examples:
      ```ts
      export function createHyperProvider(o: HyperProviderOptions = {}): ModelProvider {
        return createRoutedProvider({
          id: o.id ?? "hyper",
          baseUrl: o.baseUrl ?? HYPER_DEFAULT_BASE_URL,
          apiKey: o.apiKey,
          fetch: o.fetch,
          routeFor: (r) => (r.model.compat?.route as HyperRoute | undefined) ?? routeForHyperModel(r.model.model),
          routes: { openai: HYPER_CHAT_ROUTE, anthropic: HYPER_MESSAGES_ROUTE },
          mapUsage: withHyperCost,
          mapHttpError: hyperHttpError,
        });
      }
      ```
    - Files to Create/Edit:
      - `packages/providers/hyper/src/{provider,models,index,telemetry}.ts`, delete `src/{openai-chat,thinking,cache,retry}.ts`, `src/__tests__/{hyper,package}.test.ts`, `src/__tests__/wire/openai/*` (recorded), `README.md`, `CHANGELOG.md`, `scripts/compat-baseline/arnilo__prism-provider-hyper.txt`.
    - References:
      - plan 182.
  - Test Cases to Write:
    - `hyper_passes_recorded_conformance` (both routes), `hyper_routes_qwen36_to_messages_and_others_to_chat`, `hyper_usage_carries_cost_and_remaining_credits`, `hyper_402_is_not_retryable`, `hyper_unknown_route_fails_closed`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed helper exports; usage now carries Hyper cost.
    - Docs pages to create/edit:
      - `packages/providers/hyper/README.md` (package page structure: routes, configuration, cost fields, failure behaviour), `packages/providers/hyper/CHANGELOG.md`, root `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: OpenCode Go on the routed builder
  - Acceptance Criteria:
    - Functional: `createOpenCodeGoProvider` is one `createRoutedProvider` call with `require: { sessionId: true }` (today's `ProviderRequirementError` before any fetch, `opencode-go/src/provider.ts:38-43`), `affinity` producing `x-opencode-session` from the sanitized cache key (max 128), routes `openai` (`reasoningReplay: "reasoning_content"`, `imageInput: "capability-gated"`, `reasoningObject` merge) and `anthropic` (`x-api-key+bearer`, `ttl: "1h"` on long retention if Task 1 (c) confirms it).
    - Functional: `openai-chat.ts`, `thinking.ts`, and `cache.ts` are deleted; their exports are removed and the baseline regenerated (`arnilo__prism-provider-opencode-go.txt`), with the diff in the note.
    - Functional: Recordings for the chat route (text, two-turn tool loop with replay, warm-prefix `cached_tokens`, structured output on a model that supports it and the documented rejection on `deepseek-v4-pro`, error); Anthropic recordings come from plan 182 Task 6. The live test gains the missing probes: Anthropic-route text and tool loop, and a cache probe on each route.
    - Functional: The catalog's route per model matches Task 1 (c); a model the live `/models` no longer lists is removed from the curated catalog.
    - Performance: Same request count per turn as before.
    - Code Quality: Same rules as Task 2.
    - Security: The session header carries the sanitized cache key only (`sanitizeCacheKey`), asserted not to contain the prompt or key.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (a), (c); `packages/providers/opencode-go/src/*`.
    - Options Considered:
      - Derive the session header from `sessionId` only. Rejected: cache intent (`cacheKey`) wins today and keeps prefix affinity across forks; keep it.
    - Chosen Approach:
      - Same shape as Hyper; OpenCode Go differences are options.
    - API Notes and Examples:
      ```ts
      createRoutedProvider({
        id: "opencode-go",
        baseUrl: OPENCODE_GO_DEFAULT_BASE_URL,
        require: { sessionId: true },
        routes: {
          openai: { format: "openai-chat", path: "/chat/completions", auth: "bearer", affinity: opencodeSession, codec: { reasoningReplay: "reasoning_content", imageInput: "capability-gated" } },
          anthropic: { format: "anthropic-messages", path: "/messages", auth: "x-api-key+bearer", affinity: opencodeSession },
        },
      });
      ```
    - Files to Create/Edit:
      - `packages/providers/opencode-go/src/{provider,models,index}.ts`, delete `src/{openai-chat,thinking,cache}.ts`, `src/__tests__/{opencode-go,package,live}.test.ts`, `src/__tests__/wire/openai/*`, `README.md`, `CHANGELOG.md`, `scripts/compat-baseline/arnilo__prism-provider-opencode-go.txt`, `scripts/live-matrix.json` (row `requires`, `model`, `cost` updated).
    - References:
      - plan 182; Task 2.
  - Test Cases to Write:
    - `opencode_go_passes_recorded_conformance` (both routes), `opencode_go_requires_session_before_fetch`, `opencode_go_session_header_is_sanitized_cache_key`, `opencode_go_rejects_image_without_capability`, `opencode_go_catalog_routes_match_live_snapshot`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed helper exports.
    - Docs pages to create/edit:
      - `packages/providers/opencode-go/README.md`, its `CHANGELOG.md`, root `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Jev and Laya with one shape
  - Acceptance Criteria:
    - Functional: The kit's System One part gains:
      - `systemOneProviderPackage({ name, providerId, label, defaultBaseUrl, defaultKeyRef, keyRequired, models })`. It returns the `definePackage` definition and the instance factory. `keyRequired: true` (Jev) notes `warn` when the key ref resolves to nothing. `keyRequired: false` (Laya) sends no `authorization` header without a key, and notes nothing.
      - the plaintext-endpoint check moved from `laya/src/models.ts:56-84` into the System One client. It runs for both vendors at provider construction: an `http:` non-loopback base URL notes `warn` through `prism.status` when built from the package, and calls `console.warn` when built from the factory. The URL is printed as `origin` only.
    - Functional: Both packages become `index.ts` (one `systemOneProviderPackage` call plus re-exports), `models.ts` (constants, `define<Vendor>Model`, `<vendor>Models`), and `provider.ts` (`create<Vendor>Provider` over `createSystemOneDecisionProvider`), with the same export names. The old names (`DEFAULT_LAYA_BASE_URL`, `layaBaseUrl`) are removed with a repo-wide grep, and both baselines are regenerated.
    - Functional: Tests: one suite, `systemOneConformance({ factory, recordings, keyRequired })` in `src/provider-kit/conformance.ts`. It covers the gates before fetch (tools rejected, schema required), schema-valid rendering, `boolean_threshold` validation, the 401/422 mapping, malformed success, credential resolution once per request, and no secret leak. Both packages call it with recordings from Jev and local `laya-serve` (Task 1 (d)). The per-vendor test files keep only catalog and key-policy tests.
    - Functional: Laya gets `src/__tests__/live.test.ts` mirroring Jev's. It skips unless `PRISM_LIVE_PROVIDER_TESTS=1` and `PRISM_LIVE_LAYA=1`, and reads `LAYA_BASE_URL` (default `http://127.0.0.1:8000`). Before the run it does one reachability check and reports a clean skip reason if `laya-serve` is not running. `scripts/live-matrix.json` gains `providers/typesafe` (Jev already has a live test but no row) and `providers/laya`.
    - Performance: No change per request; package setup does no network (asserted by the existing `setup_does_not_fetch` tests).
    - Code Quality: The two packages differ only in data; `diff` of the two `index.ts` and `provider.ts` files with vendor names masked is empty (a test does this).
    - Security: Jev's key is ref-only (`env:TYPESAFE_API_KEY`); Laya's optional key is ref-only (`env:LAYA_API_KEY`). The plaintext warning never prints userinfo.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (d); `packages/providers/{typesafe,laya}/src/*`; `src/provider-kit/{systemone,systemone-provider,systemone-schema,systemone-decisions}.ts`; `laya-amd-setup.md` §5–6.
    - Options Considered:
      - Fold Jev and Laya into one package with two ids. Rejected: they are different vendors with different trust models (hosted vs self-hosted), and a host installs one.
      - Keep the plaintext warning Laya-only. Rejected: a host can point Jev at an `http:` proxy too; the risk is the same.
    - Chosen Approach:
      - One kit helper with a key-policy setting; two packages of data.
    - API Notes and Examples:
      ```ts
      export default systemOneProviderPackage({
        name: "@arnilo/prism-provider-laya",
        providerId: "laya",
        label: "Laya",
        defaultBaseUrl: LAYA_DEFAULT_BASE_URL,      // http://localhost:8000
        defaultKeyRef: LAYA_DEFAULT_API_KEY_REF,    // env:LAYA_API_KEY
        keyRequired: false,
        models: layaModels,
      });
      ```
    - Files to Create/Edit:
      - `src/provider-kit/{systemone,systemone-provider,conformance,index}.ts`, `src/__tests__/systemone*.test.ts`, `packages/providers/{typesafe,laya}/src/{index,models,provider}.ts`, their tests and `src/__tests__/wire/systemone/*`, `packages/providers/laya/src/__tests__/live.test.ts` (new), both READMEs and CHANGELOGs, `scripts/live-matrix.json`, `docs/live-testing.md` (generated table; Laya local-server prerequisite), `scripts/compat-baseline/{arnilo__prism,arnilo__prism-provider-typesafe,arnilo__prism-provider-laya}.txt`, `docs/provider-kit.md` (System One section), `CHANGELOG.md`.
    - References:
      - owner request 2026-10-16 ("Jev and Laya should have the same shape"; Laya tested on the dev machine).
  - Test Cases to Write:
    - `jev_and_laya_sources_match_with_vendor_masked`.
    - `laya_without_key_sends_no_auth_and_notes_nothing`, `jev_without_key_notes_warn`.
    - `plaintext_remote_endpoint_warns_for_both_vendors`, `plaintext_warning_prints_origin_only`.
    - `typesafe_passes_systemone_conformance`, `laya_passes_systemone_conformance`.
    - `laya_live_skips_cleanly_when_server_absent`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Laya export names, key-policy behaviour, the warning for Jev.
    - Docs pages to create/edit:
      - both package READMEs (package page structure; Laya "Run laya-serve locally" with the `laya-amd-setup.md` commands), `docs/provider-kit.md`, `docs/live-testing.md`, `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: One live scenario list per format
  - Acceptance Criteria:
    - Functional: `src/testing/provider-live-scenarios.ts` (in `@arnilo/prism/testing`) exports the shared tier-1 live scenarios. Each package's `live.test.ts` runs them for each of its routes with the Task 1 (e) model:
      - chat and Anthropic formats: text stream; two-turn tool loop with thinking replay (the second request must be accepted, which proves `reasoning_content` or signature replay); structured output (or its documented rejection); abort before the first request; error response leaking no secret; warm-prefix cache probe (second identical-prefix request reports `cacheReadTokens > 0`, with `inputTokens ≥ cacheReadTokens`);
      - System One format: schema-valid decision; tools rejected before fetch; abort; error leaking no secret.
    - Functional: Each scenario runs `assertNoSecretLeak` over events and errors with the real key. Each test records `usage` per request in its output, so the evidence file can quote hit rates.
    - Performance: Each row's manifest `cost` states the request count: chat/Anthropic about 10 requests per route; System One about 4. The whole tier-1 run stays under 40 requests.
    - Code Quality: Package live tests are short: import the scenarios, pass provider, models, and key name.
    - Security: Keys only from the env file; skip-not-fail without them (`docs/live-testing.md` contract).
  - Approach:
    - Documentation Reviewed:
      - `packages/providers/hyper/src/__tests__/live.test.ts` (current probes), `packages/providers/typesafe/src/__tests__/live.test.ts`, `scripts/live-matrix.mjs`, `docs/live-testing.md`.
    - Options Considered:
      - Keep hand-written live tests per package. Rejected: the four would drift; one list also gives host-written packages the same tier-1 suite.
    - Chosen Approach:
      - Shared scenarios in `/testing`, one call per route.
    - API Notes and Examples:
      ```ts
      runProviderLiveScenarios({
        provider: () => hyper({ apiKey: "env:HYPER_API_KEY" }),
        routes: { openai: "deepseek-v4-pro", anthropic: "qwen3.6-plus" },
        secretEnv: "HYPER_API_KEY",
      });
      ```
    - Files to Create/Edit:
      - `src/testing/provider-live-scenarios.ts` (new), `src/testing/index.ts`, `src/__tests__/provider-live-scenarios.test.ts` (hermetic run on the replay harness), `packages/providers/{hyper,opencode-go,typesafe,laya}/src/__tests__/live.test.ts`, `scripts/live-matrix.json` (rows, models, costs), `docs/live-testing.md` (generated), `docs/testing.md`, `scripts/compat-baseline/arnilo__prism.txt` (`/testing` export), `CHANGELOG.md`.
    - References:
      - Tasks 2–4.
  - Test Cases to Write:
    - `live_scenarios_run_hermetically_on_recordings` (the same scenarios over `replayFetch`, in `bun run test`).
    - `live_scenarios_skip_without_credentials` (zero network).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `/testing` export.
    - Docs pages to create/edit:
      - `docs/testing.md`, `docs/live-testing.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Supported-provider gate and first live run
  - Acceptance Criteria:
    - Functional: `src/__tests__/packaging.test.ts` `only_supported_provider_packages_exist` (plan 182 Task 2) is extended: each provider package must have a non-empty `src/__tests__/wire/`, a `live.test.ts` that calls `runProviderLiveScenarios` or `runSystemOneLiveScenarios`, a package test calling `providerConformance({ recordings })` or `systemOneConformance`, and an active `providers/<vendor>` row in `scripts/live-matrix.json`. A package missing any of them fails the test with the missing item named.
    - Functional: With the owner's env file and `laya-serve` running, the executor runs `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live` and writes `docs/_evidence/provider-live-0.13.0.md`: commit, model per route, per-scenario status, request counts, usage per request, and the cache probe hit rates. It contains no secret (`assertNoSecretLeak` over the file). A failure is triaged with plan 186's classes (`transport`, `provider-behavior`, `prism`); a `prism` failure reopens the owning task.
    - Performance: Record the actual request total against Task 5's budget.
    - Code Quality: The gate reads the filesystem and the manifest; no hard-coded package list.
    - Security: If the preflight finds a credential problem, the executor stops and asks the owner to fix the env file, without printing or requesting the key.
  - Approach:
    - Documentation Reviewed:
      - the existing live runner and strict mode (plan 186 later adds the release methodology and preflight on top); `scripts/live-matrix.mjs`.
    - Options Considered:
      - Leave the gate to code review. Rejected: the owner's rule is that no untested provider ships; a test enforces it for later contributors.
    - Chosen Approach:
      - A filesystem gate plus one recorded strict run.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live
      ```
    - Files to Create/Edit:
      - `src/__tests__/packaging.test.ts`, `docs/_evidence/provider-live-0.13.0.md` (new), `docs/_evidence/live-matrix-report.{json,md}` (regenerated), `docs/provider-kit.md` ("Shipping a provider: what the repo requires"), `docs/contributing.md` (provider rule), `CHANGELOG.md`.
    - References:
      - owner decision 2026-10-16 ("I do not want to ship a package that is untested").
  - Test Cases to Write:
    - `provider_package_requires_recordings_live_suite_and_matrix_row` (with a temp fixture package missing each item in turn).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — repository gate and evidence.
    - Docs pages to create/edit:
      - `docs/provider-kit.md`, `docs/contributing.md`, evidence file.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter '@arnilo/prism-provider-*' test`
- `bun test --timeout=0 src/__tests__/{packaging,provider-live-scenarios,systemone,provider-conformance}.test.ts`
- `bun test --timeout=0 scripts/live-matrix.test.mjs scripts/live-doc-check.test.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`
- `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ bun run test:live` (owner env file; `laya-serve` running)
- `bun run test`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
