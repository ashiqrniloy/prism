# Phase 18 Part B — Liquid d1 Provider: Hosted d1 and d1-ultra, Local d1-3B

## Objectives

- Ship `@arnilo/prism-provider-liquid` in 0.13.0, built on Part A's decisions contract. It registers two providers: hosted `liquid` (`d1`, `d1-ultra`) and local `liquid-local` (`d1-3B` served by llama.cpp `llama-server`).
- Live-test both: hosted with `LIQUID_API_KEY`, local with `llama-server` on the dev machine. Plan 186 then makes them part of release acceptance.
- Replace vendor benchmark claims with our own measurement of d1-3B against Laya (and hosted d1-ultra and Jev), recorded as evidence.

## Expected Outcome

- `prism.models.decisions("liquid/d1-ultra")`, `("liquid/d1")`, and `("liquid-local/d1-3B")` return typed answers with probabilities, for text and image states. `generate()` + `structuredOutput` works on all three.
- The package passes `systemOneConformance` and package conformance, and its live rows pass on the owner's machine.
- 0.13.0 therefore ships decision calls for **hosted Jev and d1-ultra** and **local Laya and d1-3B** (owner decision 2026-10-17).
- `docs/_evidence/decision-bench-<date>.md` holds the d1-3B vs Laya numbers on Prism-shaped decisions.

This plan implements roadmap **Phase 18** (Part B). It runs on the 0.13.0 release path as **step 12, after plan 195 (Part A) and before plans 197–201 (added 2026-10-19) and plan 184**, so plan 185's surface freeze and plan 186's live acceptance both see the fifth provider package. It depends on plan 195 (the decisions contract, System One `images` and `path`), plan 183 (`systemOneProviderPackage`, `systemOneConformance`), and plan 182 (codec location). It creates a package, so **Task 1 is the phase review**, scoped to the package and the Liquid and `llama-server` wire. It adds no kernel contract. Live keys come from `~/.config/prism/live.env` (owner decision 2026-10-15), which gains `LIQUID_API_KEY`. The executor never asks for a key in chat. No version bump or publish happens here. Reference host impact: none. Cost knobs: every live row states its request count, and the bench (Task 3) states its per-model request budget and never runs in `release:gate`.

## Tasks

- [x] Task 1: Phase review — Liquid and `llama-server` wire (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Package placement.** It goes in `packages/providers/liquid`, built only on `@arnilo/prism/provider-kit` (`systemOneProviderPackage`, `createSystemOneDecisionProvider` with plan 195's `path`). It imports no sibling provider. The Notes also list the enforcement rows the new package needs (`references/prism.md` §3 probe 11).
      - (b) **Hosted wire, verified live:**
        - the base URL + path: `https://api.liquid.ai/decisions/v1/systemone` (launch post) vs `https://api.liquid.ai` + `/v1/systemone` (Liquid's guide via `TypeSafeClient`);
        - the model ids `d1` and `d1-ultra`, and whether versioned ids exist;
        - the `images` field (one image request per model);
        - error statuses (401/422/429/529) and `Retry-After`;
        - the `usage` shape;
        - context limits, if documented or observable;
        - prices from Liquid's pricing page on the day, with the URL, because the sources conflict ($0.02 vs $0.04 for d1; $0.042 for d1-ultra).
      - (c) **Local wire, verified on the dev machine:**
        - the minimum `llama-server` build that serves `LiquidAI/d1-3B-GGUF` on `/v1/systemone` (after llama.cpp PR #30110, the d1 metadata);
        - the `model` field with `--alias d1-3B` in single-model and router mode;
        - an image request;
        - `--api-key` behaviour (401 without the Bearer key);
        - Q4_K_M vs Q8_0 answer drift on 20 fixed questions.
      - (d) **Same model or not.** Put the same 20 text questions to hosted `d1` and local `d1-3B` (Q8_0 and BF16) and record the agreement rate. This is evidence for the README's "not confirmed to be the same model" note. It does not change the design.
      - (e) **Release-path fit:** confirm that plans 185 and 186, as amended on 2026-10-17, name `liquid`. Plan 185 must migrate it to `SecretSource`, and plan 186 must give it T1 rows and preflight probes.
      - (f) **Verdict:** proceed, or re-cut Task 2. If Liquid's hosted API is not System One-compatible on a point Task 2 relies on, stop.
    - Performance: n/a (read-only).
    - Code Quality: no code changes. Recordings stay in the executor's scratch directory until Task 2 commits them.
    - Security: probes print no key, and recordings are scrubbed of `authorization` headers and account ids before Task 2 commits them.
  - Approach:
    - Documentation Reviewed:
      - Liquid [decision models](https://docs.liquid.ai/lfm/models/decision-models), [decision model guide](https://docs.liquid.ai/guides/decision-model-guide.md), [d1 blog](https://www.liquid.ai/blog/d1-decision-model), [d1-3B card](https://huggingface.co/LiquidAI/d1-3B), [d1-3B GGUF](https://huggingface.co/LiquidAI/d1-3B-GGUF), [llama.cpp decision models](https://huggingface.co/blog/ggml-org/decision-models-in-llamacpp); survey §2–§5; plans 183 and 195.
    - Options Considered:
      - An entry check without live probes: rejected. Liquid's two sources disagree on the path, and the d1-3B GGUF needs a recent `llama-server`.
    - Chosen Approach:
      - A scoped review with live probes.
    - API Notes and Examples:
      ```sh
      curl -s https://api.liquid.ai/decisions/v1/systemone -H "authorization: Bearer $LIQUID_API_KEY" -H 'content-type: application/json' -d @fixture.json
      llama-server -hf LiquidAI/d1-3B-GGUF:Q8_0 --alias d1-3B --port 8080
      curl -s http://127.0.0.1:8080/v1/systemone -H 'content-type: application/json' -d @fixture.json
      ```
    - Files to Create/Edit:
      - this plan's Task 1 Notes only.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2–§3.
  - Test Cases to Write:
    - n/a: read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none (read-only).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Live-probe status (2026-10-23).** `~/.config/prism/live.env` holds only `PRISM_LIVE_PROVIDER_TESTS` and `OPENCODE_GO_API_KEY`: there is no `LIQUID_API_KEY`, no `llama-server`/`llama` binary anywhere on `PATH`, no GGUF cache, and nothing listens on `127.0.0.1:8080` or `:8000`. Unauthenticated probes ran; authenticated hosted probes, the local wire, and the 20-question drift and agreement runs did not. Per the same rule as plan 195 Task 2 (d), those legs move to Task 2's gated live rows and Task 3's bench; no key was printed and none was requested in chat.
    - **(a) Package placement.** `packages/providers/liquid`, on `@arnilo/prism/provider-kit` only. The sibling shape it must match is `packages/providers/laya/src/{index,models,provider}.ts`: the provider file imports `ModelProvider`/`CredentialValueSource` from `@arnilo/prism` and `createSystemOneDecisionProvider` from the kit, and no provider package imports another. `createSystemOneDecisionProvider` already takes `path` (`src/provider-kit/systemone-provider.ts:52-53`, normalized at 66; URL built `${baseUrl}${path}` at `src/provider-kit/systemone.ts:255`) and sends `images` when present, so Part A covers both vendor needs with no kit change.
      - Enforcement rows actually needed (probe 11), checked against the tree:
        - root `package.json` `workspaces` — **no edit**: it already lists the glob `packages/providers/*`.
        - `src/__tests__/packaging.test.ts` — **two edits**: the `packages` list at `:92-95` and the hard-coded `assert.deepEqual(providerDirs, ["hyper", "laya", "opencode-go", "typesafe"])` at `:445`.
        - `scripts/package-truth.json` + generated docs — regenerate with `bun scripts/package-truth.mjs --emit-docs` (`docs/release.md:136` and the count tables come from it); the hand-written counts in `docs/models.md:156` and `docs/provider-kit.md:478` ("4 provider packages") are not generated and need manual edits.
        - `scripts/independent-packages.json` — decision is **stay out** (lockstep until Phase 11, per its `$comment`): `packages` stays `[]`.
        - `scripts/compat-baseline/arnilo__prism-provider-liquid.txt` — new file via `bun scripts/release.mjs gate --update-baseline`.
        - `docs/index.md` — one README link, in the same list as `:35` (`provider-laya`).
        - `scripts/live-matrix.json` — rows `providers/liquid` and `providers/liquid-local`; `scripts/live.env.example` — `LIQUID_API_KEY`, `PRISM_LIVE_LLAMA_SERVER_URL` (neither string exists there today); `docs/live-testing.md` is generated from the matrix.
        - Not in the plan's list but required by plan 195's Part B handoff: `docs/migrate-to-0.13.md:74` (provider list).
    - **(b) Hosted wire.** Confidence is uneven; each line says which.
      - **Path — verified reachable, both forms.** `POST https://api.liquid.ai/decisions/v1/systemone` returns `401 {"error":{"message":"Invalid API key provided.","type":"authentication_error","param":null,"code":"invalid_api_key"}}`. So does `POST https://api.liquid.ai/v1/systemone`, while `POST /v1/bogus` and `GET /v1/models` return the site's 404 page and `POST /decisions/v1/bogus` returns 401 — i.e. `/decisions/*` is auth-gated as a prefix, but `/v1/systemone` is a real route too (an undocumented root alias). The d1 docs use `/decisions/v1/systemone` in every cURL and the TypeSafe SDK pairs `base_url=https://api.liquid.ai` with its own path, so **base `https://api.liquid.ai` + path `/decisions/v1/systemone`** is the reviewed form and what `liquid_hosted_uses_reviewed_path` pins. Trailing slash → `308`.
      - **Model ids — the plan's ids are stale, and this is the re-cut.** Today's d1 page (`https://docs.liquid.ai/lfm/models/d1`, fetched 2026-10-23) says: "`d1-ultra`" and "`d1.1` — default hosted decision model", every example sends `model: "d1.1"`, and it calls `d1` "the earlier model" now on OpenRouter/Vercel. Versioned ids therefore exist and `d1.1` is the current one. Conflict: the still-served decision-model skill (`https://docs.liquid.ai/.well-known/skills/decision-model/skill.md:40`) says `d1` is the default, and the pricing page still has a `d1` row with no `d1.1` row. Neither `d1` nor `d1.1` could be exercised without a key, and the OpenRouter model list today exposes no `liquid/d1` or `liquid/d1-ultra` rows at all. **Task 2 re-cut: ship `d1-ultra` and `d1.1`; add legacy `d1` only if Task 2's live probe returns it.** Vision is documented for `d1.1` and `d1-ultra` only, so shipping `d1` would risk a 4xx on the image row.
      - **`images`.** Top-level `images` array, one entry per image; each entry is a Base64 data URL or `{content_type, base64}`. Max 8 images/request, whole JSON body **under 4.5 MB**, ≤10,000 patches of 32×32 across all images, longer side ≤100× shorter, JPEG/PNG/WebP/GIF. Tokens: `ceil(patches × 1.5)` per image, charged again per question. One image request per model is all Task 2 needs; the 8 MiB kernel cap from Part A is **above** Liquid's 4.5 MB body cap, so a 4.5–8 MB request fails at the vendor with a 4xx instead of pre-fetch. Accepted as a documented vendor limit (README + live row), not new kit code.
      - **Errors.** `401` observed, OpenAI-style envelope above. `429` and 5xx (incl. `529`) are retryable and honor `Retry-After` in the kit (`src/provider-kit/systemone.ts:184-187`, `retry-http.ts:33`), but **Liquid publishes no status table and no rate limit** (the `developers.liquid.com` "Liquid API" pages are the unrelated crypto exchange), and no `Retry-After` was observable on 401. `422` was not observable. The gated live row must record 401/429/5xx shapes if they occur; until then these stay kit-generic, not vendor-verified.
      - **`usage`.** `{"input_tokens": n, "output_tokens": 0}` — documented and shaped exactly as the kit's `mapSystemOneUsage` expects. Billed on input tokens only; cached input is the same rate.
      - **Context limit.** Not documented for hosted `d1.1`/`d1-ultra`, and no `/models` call is reachable without a key (`/decisions/v1/models` is 401, `/v1/models` is 404). `contextWindow` stays **omitted** for both hosted rows, as the plan already allows.
      - **Prices, 2026-10-23, `https://www.liquid.ai/pricing`:** `d1` input **$0.02/MTok**, cached input $0.02/MTok, output $0.00/MTok; `d1-ultra` input **$0.042/MTok**, cached input $0.042/MTok, output $0.00/MTok. No `d1.1` row exists, so `d1.1` is charged at the `d1` row — record that assumption in `metadata.priceSource` as the pricing URL plus the day, and have Task 2's live response confirm the model string. The plan's "$0.04 for d1" no longer appears on the page; it is likely the OpenRouter-era price.
    - **(c) Local wire — documented, not run locally.**
      - **Minimum build: `b11480` (2026-10-08T01:36Z).** `/v1/systemone` landed in llama.cpp PR #29818 (merged 2026-10-02), d1-3B support and the image-interpolation GGUF key in PR **#30110** (merged **2026-10-07T20:04Z**); the last release before that merge is `b11476` (2026-10-07T14:55Z) and the first after it is `b11480`, so that is the floor. The server docs list the architecture as `lfm2-d1`.
      - **`model` field.** Single-model mode: `model` is **ignored**. Router mode: required, matched against the ids `GET /v1/models` reports; `--alias` sets that id, but the router controls/overwrites the alias argument when loading (`tools/server/README.md:1373`, `:1577`, `:2076`). So `--alias d1-3B` makes **single-model** mode answer as `d1-3B`; in router mode the client must send the id the router lists (a preset name or the path-derived id), not the command-line alias. The catalog id `d1-3B` + README `--alias d1-3B` is therefore correct for the default single-model setup; the README must not claim the alias works in router mode.
      - **Images.** `images` (alias of `files`) takes data URLs and needs the multimodal projector; `-hf LiquidAI/d1-3B-GGUF:Q8_0` downloads `mmproj-d1-3B-Q8_0.gguf` automatically (`--no-mmproj` disables). Without a projector or for a non-decision model an image request returns **501**; a malformed request returns **400**.
      - **`--api-key`.** Adds Bearer-style auth with the OAI error envelope `{"error":{"code":401,"message":"Invalid API Key","type":"authentication_error"}}`; `/health` and `/v1/health` stay public.
      - **Quant drift (Q4_K_M vs Q8_0, 20 fixed questions): not measured.** No binary and no weights on this machine. The d1-3B card reports no quant-drift table; the only number in hand is the survey's 0.8% bf16-vs-quant flip rate. Runs in Task 2's live row (one quant each) or Task 3 (bench runs both quants). **Later run (2026-10-24):** measured — see Task 3 Notes and `docs/_evidence/decision-bench-2026-10-23.md`.
    - **(d) Same model or not — unverified.** Nothing in Liquid's docs claims hosted `d1.1` and `d1-3B` are the same weights: `d1-3B` is "built on LFM2.5-VL-3B" (3.12B params, 32,768-token context, `lfm1.0` = LFM Open License 1.0), `d1-ultra` is "a larger open-weight model with Liquid-specific customizations". No 20-question agreement run is possible without a key and a server. **Re-cut: the agreement rate moves to Task 3**, whose set already runs hosted and local models over the same items, and Task 2's README cites Task 3's evidence file rather than a number Task 1 cannot produce. The "not confirmed to be the same model" note stands as written. **Later run (2026-10-24):** the local half is measured (Q8_0 vs Q4_K_M agreement 95.5% over 200 items); the hosted half still needs `LIQUID_API_KEY`.
    - **(e) Release-path fit — confirmed.** `plans/185-...:13,28` name the five provider packages including `liquid` and put it in the `SecretSource` retirement table; `plans/186-...:20,27,28,94,119` give it T1 rows `providers/{liquid,liquid-local}`, a `decide` row, a `llama-server` entry criterion, and a preflight probe (`--probe` hits `PRISM_LIVE_LLAMA_SERVER_URL` for `liquid-local` and the cheapest authenticated call for hosted Liquid). No plan edit needed.
    - **(f) Verdict: proceed**, with these Task 2 amendments applied here: hosted catalog `d1-ultra` + `d1.1` (legacy `d1` only if live-probed); path `/decisions/v1/systemone` on base `https://api.liquid.ai`; no hosted `contextWindow`; prices dated above; local minimum build `b11480` and the alias/router caveat; Liquid's 4.5 MB / 8-image caps documented; drift and agreement numbers deferred to the Task 2 live rows and Task 3. Liquid is System One-compatible on every point Task 2 relies on (`state`, `questions`, `images`, `usage`, `model`), so nothing stops Task 2.

- [x] Task 2: `@arnilo/prism-provider-liquid`
  - Acceptance Criteria:
    - Functional:
      - Built with `systemOneProviderPackage`. It registers two providers:
        - **`liquid` (hosted):**
          - Base URL `https://api.liquid.ai` and path `/decisions/v1/systemone` (Task 1 (b)). `keyRequired: true`; `apiKey` default `env:LIQUID_API_KEY`.
          - Catalog `d1-ultra` and `d1.1` (Task 1 (b): `d1.1` is the documented default; add legacy `d1` only if the live row returns it): `input: ["text","image"]`, `decisions: true`, `structuredOutput: "json_schema"`, tools and streaming false, `maxOutputTokens: 0`.
          - Cost from Task 1 (b) with `metadata.priceSource` = `https://www.liquid.ai/pricing` plus the 2026-10-23 date: `d1.1` at the `d1` row $0.02/MTok input (cached input the same, output $0), `d1-ultra` $0.042/MTok. No hosted `contextWindow` (undocumented).
        - **`liquid-local` (`llama-server`):**
          - Default `localBaseUrl` `http://127.0.0.1:8080`. `keyRequired: false`, with an optional `localApiKey` ref for `llama-server --api-key`. README states the minimum `llama-server` build `b11480` (Task 1 (c)).
          - Catalog `d1-3B`: `contextWindow: 32768`, `input: ["text","image"]`, `decisions: true`, `metadata.recommendedQuant: "Q8_0"`, zero cost.
      - Config is JSON Schema with ref-only secrets. `hosted: false` skips registering `liquid`, and with it the missing-key note, for a local-only dev setup.
      - The README tells hosts to pin ids and log the returned `model` (and documents Liquid's 4.5 MB body / 8-image caps, Task 1 (b)).
      - The local provider sends `model` as the catalog id. The README documents `--alias d1-3B` and says the alias answers in single-model mode only; in router mode the client sends the id `GET /v1/models` lists (Task 1 (c)).
    - Fail closed:
      - A literal key → `secret_literal`.
      - A missing hosted key → `status.note("warn", …)` plus registration; the request then fails with `credential_unavailable` (same as Jev).
      - An unknown config field fails validation.
      - On `generate`, tools or a missing schema are rejected before fetch by the kit gates.
      - Images to a model without image input are rejected by Part A's validator.
    - Performance: no import beyond the kit and no network at setup. `models()` returns the curated catalog. Discovery from `llama-server /v1/models` is a Further Action.
    - Code Quality: does not import a sibling provider. It has the same file layout and export names as `typesafe`/`laya`: `index.ts`, `models.ts`, `provider.ts`; `createLiquidProvider`, `defineLiquidModel`, `liquidModels`, `LIQUID_API_KEY_ENV`.
    - Security:
      - The key joins the redaction set.
      - A plaintext non-loopback `localBaseUrl` warns (kit check).
      - The README states the LFM Open License 1.0 terms for d1-3B (free commercial use under $10M annual revenue). Prism ships no weights, but it recommends them.
  - Approach:
    - Documentation Reviewed:
      - `packages/providers/laya/src/{index,models,provider}.ts` and plan 183's rebuilt shape; plan 195 Tasks 3–4; Task 1 Notes; survey §2–§5.
    - Options Considered:
      - One provider id that routes by model to two base URLs: rejected. Hosted and local need different key policies, and a single id would warn about a missing key on a local-only machine.
      - Put d1-3B under the Laya package: rejected. The catalog, license, and vendor are Liquid's. Laya stays on `laya-serve` by default (owner decision 2026-10-16), and its README notes that `llama-server` also serves it.
      - A generic `llama-server` provider package: rejected. Part A's recipe covers it without a package.
      - Leave out hosted `d1` and ship only `d1-ultra`: rejected. `d1` costs less and the owner asked for d1 support. Both are one catalog row each.
    - Chosen Approach:
      - One vendor package, two providers, on the shared System One kit.
    - API Notes and Examples:
      ```ts
      import liquid from "@arnilo/prism-provider-liquid";
      const agent = await createAgent({ model: "liquid-local/d1-3B", packages: [liquid({ hosted: false })] });
      const routing = await prism.models.decisions("liquid/d1-ultra").decide({ state, images: [screenshot], questions });
      ```
      ```json
      { "packages": { "@arnilo/prism-provider-liquid": { "apiKey": "env:LIQUID_API_KEY", "localBaseUrl": "http://127.0.0.1:8080" } } }
      ```
    - Files to Create/Edit:
      - `packages/providers/liquid/{package.json,README.md,CHANGELOG.md,src/index.ts,src/models.ts,src/provider.ts}`, `src/__tests__/{package,liquid,live}.test.ts`, `src/__tests__/wire/*` (Task 1 recordings).
      - Enforcement rows: root `package.json` `workspaces` (already covered by the `packages/providers/*` glob; verify, do not edit); `scripts/package-truth.mjs` / `scripts/package-truth.json` counts (regenerate with `--emit-docs`); `src/__tests__/packaging.test.ts` package list **and** its `providerDirs` assertion; `scripts/independent-packages.json` (stays out, lockstep); `scripts/compat-baseline/arnilo__prism-provider-liquid.txt` (new); `scripts/live-matrix.json` (rows `providers/liquid` and `providers/liquid-local` with request counts); `scripts/live.env.example` (`LIQUID_API_KEY`, `PRISM_LIVE_LLAMA_SERVER_URL`); `docs/live-testing.md` (generated, plus the `llama-server` prerequisite); `docs/index.md` (README link); `docs/models.md` "Provider packages"; `docs/provider-kit.md:478` and `docs/migrate-to-0.13.md:74` (provider-count/list lines Task 1 (a) found); `CHANGELOG.md`.
    - References:
      - Task 1; owner decisions 2026-10-15 (live keys) and 2026-10-17 (Phase 18 in 0.13.0, hosted and local, d1-ultra).
  - Test Cases to Write:
    - `liquid_passes_systemone_conformance` (hosted and local factories, Task 1 recordings, including `decide` and images).
    - `liquid_package_conformance` (`@arnilo/prism/testing`).
    - `liquid_hosted_missing_key_notes_warn_and_still_lists_catalog`, `liquid_local_sends_no_authorization_without_key`, `liquid_local_sends_bearer_with_local_api_key`, `liquid_hosted_false_registers_only_local`.
    - `liquid_rejects_literal_key`, `liquid_unknown_config_field_fails_validation`.
    - `liquid_hosted_uses_reviewed_path`: fails if the path regresses to the wrong form.
    - `liquid_secret_never_in_events_inspect_or_errors`.
    - Live (gated): `liquid_live_hosted_d1_1_and_d1_ultra_decide_text_and_image` on `LIQUID_API_KEY`; `liquid_live_local_d1_3b_decide_text_and_image` on `PRISM_LIVE_LLAMA_SERVER_URL`. Each runs one `decide` and one `generate` per model, and the counts go in the live-matrix rows. These rows also settle Task 1's probe debt: they record which hosted id answers (`d1.1`, legacy `d1`), a real image response, the returned `model` string, and any 401/429/5xx/`Retry-After` shape encountered; the local row records the single-model `--alias` id and the Q4_K_M/Q8_0 comparison over the fixed questions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new package).
    - Docs pages to create/edit:
      - `packages/providers/liquid/README.md`, using the package page structure:
        - the `llama-server` quickstart (`llama-server -hf LiquidAI/d1-3B-GGUF:Q8_0 --alias d1-3B`) and why Q8_0;
        - the license;
        - the hosted-vs-d1-3B note (not confirmed to be the same model; cites the Task 3 agreement rate, since Task 1 could not run it — Task 1 (d));
        - a manifest entry example.
      - `docs/models.md`: provider package list. `docs/live-testing.md`: prerequisite.
    - `docs/index.md` update: yes (README link).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Shipped.** `packages/providers/liquid/{package.json,README.md,CHANGELOG.md,LICENSE,bunfig.toml,tsconfig.json}` and `src/{index,models,provider}.ts` register both providers from one package, plus `src/__tests__/{liquid,package,live}.test.ts` and `src/__tests__/wire/systemone/{README.md,decision.json,error.json}`. Hosted `liquid` is `d1.1` + `d1-ultra` on `https://api.liquid.ai/decisions/v1/systemone`, `keyRequired` via `env:LIQUID_API_KEY`, priced $0.02 / $0.042 per MTok input with `metadata.priceSource`, no hosted `contextWindow`; `liquid-local` is `d1-3B` on `http://127.0.0.1:8080`, `contextWindow: 32768`, `metadata.recommendedQuant: "Q8_0"`, zero cost. Both catalogs declare `input: ["text","image"]` and `maxOutputTokens: 0`.
    - **One deliberate deviation from the plan's "built with `systemOneProviderPackage`".** That helper registers exactly one provider, and the package must register two (different endpoints, key policies, and `hosted: false` skipping the hosted registration *and* its missing-key note). So the package uses the same kit pieces directly: `defineProviderPackage` with the shared `secretRefProperty`/`baseUrlProperty`/`refSource`/`optionalRefSource` helpers and `createSystemOneDecisionProvider`. Each registration is wrapped to expose `models()`: the raw decision provider has no `models` method, and without the wrapper `agent.models.list()` silently omits the catalog (caught by the first test run, now pinned by `liquid_hosted_missing_key_notes_warn_and_still_lists_catalog`). `hosted: false` keeps the hosted key note out, asserted by `liquid_hosted_false_registers_only_local`.
    - **Local key default.** `localApiKey` defaults to `env:LIQUID_LOCAL_API_KEY` through `optionalRefSource`, so a host that sets that var gets `Bearer` auth without extra config and a host that does not still sends no `Authorization` header. `liquid_local_sends_no_authorization_without_key` and `liquid_local_sends_bearer_with_local_api_key` pin both, the latter end-to-end through `api.models.decisions("liquid-local/d1-3B")` (URL `/v1/systemone`, header present).
    - **Wire recordings are reconstructed, not captured.** Task 1 had no `LIQUID_API_KEY`, so `wire/systemone` mirrors Liquid's documented request/response shape (Task 1 (b)) and its README says so. `liquid_passes_systemone_conformance_hosted` replays it (path `/decisions/v1/systemone` is asserted by the replay and by `liquid_hosted_uses_reviewed_path`); the local conformance leg runs the synthetic scenarios because `llama-server` uses `/v1/systemone` and would fail the hosted replay path. Replace both fixtures with captured, scrubbed exchanges after the first gated live run.
    - **Enforcement rows applied.** `src/__tests__/packaging.test.ts` (`packages` list, `providerDirs`, and its `43 → 44` manifest count), `src/__tests__/install-smoke.test.ts` (both hand lists — found because `packaging-current.test.mjs` failed otherwise), `scripts/coverage-thresholds.json` row `{lines: 97, functions: 95.24}` from the package's measured 100 / 95.24 (3pp margin) and the ignored `scripts/coverage-summary.json` artifact row, `scripts/e2e-coverage.json` annotation, `scripts/budgets.json` kernel `packedBytes` 1118728 / `unpackedBytes` 3646918 (+973 / +2754, CHANGELOG entry only) with a dated reason, `scripts/package-truth.json` + generated docs, `docs/index.md`, `docs/models.md`, `docs/provider-kit.md`, `docs/migrate-to-0.13.md`, `scripts/live-matrix.json` (`providers/liquid`, `providers/liquid-local`), `scripts/live.env.example`, regenerated `docs/live-testing.md`, the root `CHANGELOG.md` entry, and `scripts/compat-baseline/arnilo__prism-provider-liquid.txt` (17 public names) via `bun scripts/release.mjs gate --update-baseline --skip-tarball --package @arnilo/prism-provider-liquid`. `scripts/independent-packages.json` stays empty (lockstep), as planned.
    - **Evidence.** `bun test src` in the package: 15 pass, 2 skip (the two gated live suites), 0 fail; `tsc -p tsconfig.json --noEmit` clean; `biome check` clean. Root: `packaging.test.ts` 244 pass, `docs.test.ts` 307 pass, `packaging-current.test.mjs` 137 pass, `live-matrix.mjs --check` valid, `live-doc-check` 5 pass, compat gate for the package green.
    - **Live rows: local legs ran on 2026-10-24.** `llama-server` b11840 (`0.7.0-dev`, commit `36e36e63a`) served `LiquidAI/d1-3B-GGUF:Q8_0` on `127.0.0.1:8080`; `bun test src/__tests__/live.test.ts` with `PRISM_LIVE_PROVIDER_TESTS=1 PRISM_LIVE_LLAMA_SERVER_URL=http://127.0.0.1:8080` gave 7 pass / 1 skip (hosted image probe) / 0 fail. That proves the local wire, the image request with the auto-fetched mmproj, the echoed `model: d1-3B` for both single-model and alias-free requests, `usage.inputTokens`, and the pre-fetch gates. Q4_K_M vs Q8_0 drift is measured in Task 3 (95.5% agreement over 200 items). **Hosted still unrun**: no `LIQUID_API_KEY`, so the hosted rows skip cleanly and the outstanding questions remain which id answers (`d1.1` vs legacy `d1`), a real hosted image response, error/`Retry-After` shapes, and the hosted-vs-local agreement rate.
    - **Pre-existing red gates, not touched** (they predate this task and reference retired packages/deleted files): `e2e-coverage-gate` fails on the stale `packages/tools/coding/src/agent/__tests__/review.test.ts` annotation (removed by plan 189); `budget-gate.test.mjs` fails on retired `exportCounts` rows (`@arnilo/prism-core`, `-work`, `-coding-tools`, …) and on the biome/budgets non-null allowlist (`packages/web-tools` vs `packages/tools/work`); `dead-export-verify` reports 3 unclassified kernel candidates (`FabricCandidateLoader`, `ModelDiscovery`, `OpenAIChatBodyOptions`); `retired-providers.test.mjs` finds a retired provider name in `src/__tests__/cli-manifest.test.ts`. None names Liquid.

- [x] Task 3: Measure d1-3B against Laya on Prism-shaped decisions
  - Acceptance Criteria:
    - Functional:
      - `scripts/decision-bench.mjs` (live, not in CI) runs a fixed, checked-in decision set through `prism.models.decisions`. The same questions go to:
        - `liquid-local/d1-3B` (Q4_K_M and Q8_0);
        - `laya/laya` (`laya-serve`);
        - with keys present, `liquid/d1-ultra`, `liquid/d1`, and `typesafe/jev-latest`.
      - The set is 150–300 labelled items in Prism-shaped decisions: tool or route choice, approval risk score, "is this tool result an error", and intent. The owner reviews the labels.
      - It reports accuracy, ECE, Brier, p50/p95 latency, the share of answers that flip when options are reversed, and (hosted) cost.
      - Results go to `docs/_evidence/decision-bench-<date>.md` with the hardware, the `llama-server` build, and the GGUF hashes.
      - The report also gives the hosted-vs-local **agreement rate** over the shared items (Task 1 (d)'s 20-question check folded into this set), which is what the Liquid README cites.
    - Performance: the bench prints its request count per model before it runs. It is never run by `release:gate`.
    - Code Quality: public API only (no codec imports), so it also exercises plan 195's contract end to end.
    - Security: keys come only from `~/.config/prism/live.env`. The set is synthetic or public, so the evidence file holds no private state text.
  - Approach:
    - Documentation Reviewed:
      - survey §3 and §5 (community DI 0.3.1: d1-3B 40.08, Laya 4.43; Laya ECE 0.466; Liquid's bf16-vs-quant flip rate 0.8%); `scripts/usage-calibration-live.test.mjs` (live-script precedent).
    - Options Considered:
      - Trust vendor and community boards: rejected. Their versions disagree (d1-3B is 48.57 on vendor 0.2.1 and 40.08 on community 0.3.1), and none uses Prism-shaped questions.
      - Run the public Decision Index as the only measure: rejected. It does not reflect Prism's routing and approval decisions. It is linked as context.
    - Chosen Approach:
      - A small owned set, re-runnable after any model or quant change.
    - API Notes and Examples:
      ```sh
      PRISM_LIVE_LLAMA_SERVER_URL=http://127.0.0.1:8080 bun scripts/decision-bench.mjs --models liquid-local/d1-3B,laya/laya,liquid/d1-ultra,typesafe/jev-latest
      ```
    - Files to Create/Edit:
      - `scripts/decision-bench.mjs` (new), `scripts/fixtures/decision-bench.jsonl` (new), `scripts/__tests__/decision-bench-metrics.test.mjs` (new), `docs/_evidence/decision-bench-<date>.md` (new), `docs/live-testing.md` (how to run).
    - References:
      - Task 2 live rows.
  - Test Cases to Write:
    - `decision_bench_metrics_are_correct`: ECE, Brier, and flip-rate math on a hand-computed fixture. Fails if the metric math changes.
    - The live run is evidence, not a test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/live-testing.md`: bench section.
      - `docs/_evidence/decision-bench-<date>.md`: results (archive, no index link).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes:
    - **Built.** `scripts/decision-bench.mjs` (live, manual), `scripts/fixtures/decision-bench.jsonl` (200 labelled items, 50 per category: tool choice, route choice, tool-result error, approval-risk score), `scripts/__tests__/decision-bench-metrics.test.mjs` (7 tests, registered in `GATE_FILES` so `bun run test` keeps it green), and a `## Decision bench` section in `docs/live-testing.md` (outside the generated matrix markers, so `live-doc-check` stays green). No kernel or provider code changed; the kernel pack ceiling was rebaselined once more (+539 packed / +1581 unpacked, dated reason) because that doc prose ships in the kernel tarball.
    - **How it runs.** One agent per model spec, because quant URLs and provider packages differ; every item goes through the public `prism.models.decisions(ref)` client, so the bench also exercises plan 195's contract (validation, model binding, usage mapping) rather than a bespoke HTTP call. Flags: `--models`, `--limit`, `--no-flip`, `--out`, `--check`; `--check` validates the fixture (150–300 items, unique ids, labels inside their options/levels) and prints the per-model request count without touching the network. Request count per model = items × 2 when option-reversal is on.
    - **Metrics.** accuracy (noul thresholded at 0.5, choice label match, score rounded to its 1-based level), ECE over 10 equal-width bins, Brier over the same pairs, nearest-rank p50/p95 latency, flip rate over choice items re-asked with criteria order reversed, hosted cost from `usage.inputTokens` × the vendor's per-MTok input price, and the hosted-vs-local agreement rate over items both answered. Choice calibration uses `probabilities[label]` when present (`llama-server` and Liquid both return it), otherwise confidence-as-correctness; score calibration uses `confidence` against correctness. These choices are stated in every evidence file's Method section.
    - **Evidence writer.** `docs/_evidence/decision-bench-<date>.md` records host CPU/arch/RAM, Bun/Node, the `llama-server` build (`PRISM_LIVE_LLAMA_SERVER_BUILD` or `llama-server --version`), the d1-3B GGUF hash (`PRISM_LIVE_D1_GGUF_SHA256`, else "not recorded"), the request budget actually spent, per-model metrics, skipped models with reasons, the echoed `model` id per row (the alias/router check from Task 1 (c)), and the agreement table. A run with no reachable model writes nothing.
    - **Smoke-tested without credentials.** Against a throwaway local System One server (not committed) the bench ran hosted and local rows end to end: request shape, option-reversal double request, usage mapping, agreement table, echoed model ids, and the evidence writer. This caught a real bug — the kernel's `Usage` is camelCase (`inputTokens`), not the wire's `input_tokens`, so the first version reported zero tokens and zero cost.
    - **Default model list** is `liquid-local/d1-3B@Q8_0`, `liquid-local/d1-3B@Q4_K_M`, `laya/laya`, `liquid/d1.1`, `liquid/d1-ultra`, `liquid/d1`, `typesafe/jev-latest`. `d1.1` is added to the plan's three hosted rows because Task 2 shipped it as the documented default; `d1` stays selectable until a live response proves or disproves it. Quants are picked by suffix: `@Q8_0`/`@Q4_K_M` use `PRISM_LIVE_LLAMA_SERVER_Q8_URL`/`_Q4_URL` when set, else the shared `PRISM_LIVE_LLAMA_SERVER_URL`, so two `llama-server` processes can be measured in one run.
    - **Live run (2026-10-24), both local quants.** Installed the prebuilt `llama-b11840-bin-ubuntu-x64` release (verified `0.7.0-dev`, commit `36e36e63a`) and served `LiquidAI/d1-3B-GGUF:Q8_0` on `:8080` and `Q4_K_M` on `:8081` with `--alias d1-3B`; GGUF sha256s recorded from the HF cache (Q8_0 `2f0942d5…`, Q4_K_M `16aff27e…`, mmproj-Q8_0 `2505920c…`). Full set, 200 items × 2 requests × 2 models = 800 requests, 0 errors, model echoed as `d1-3B` everywhere. **Q8_0:** 62.5% accuracy, ECE 0.112, Brier 0.189, p50 443 ms / p95 942 ms, flip rate 12.0%. **Q4_K_M:** 63.0% / 0.118 / 0.194, p50 327 ms / p95 745 ms, 12.0%. **Quant agreement 95.5%** (191/200). Category split shows where the low score comes from: tool 84/86%, tool-result-error 84/86%, route 48/44%, approval-risk 34/36% with ECE ~0.6 — the 4-level risk rubric is a poor fit for the model's score head, and those are judgement-heavy labels, so treat the category numbers as a label-quality signal, not only a model signal. Evidence: `docs/_evidence/decision-bench-2026-10-23.md`.
    - **Hosted half still missing.** No `LIQUID_API_KEY` and no `TYPESAFE_API_KEY`, so `liquid/*`, `typesafe/*`, and `laya/laya` (no `laya-serve` here) skipped; the **hosted-vs-local agreement rate the Liquid README wants is still unproduced**, as are hosted cost and error shapes. One credentialed bench run on plan 186's gated path completes it.
    - **Labels need the owner review the acceptance asks for.** I authored the 200 items and labels from Prism's routing/tool/approval shapes; they are checked structurally (every label is one of its options/levels) and the metric math is unit-tested, but "the owner reviews the labels" has not happened. Treat the first live report as a draft until that review lands; revision of wording or labels does not require code changes.


- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-provider-liquid build && bun run --filter @arnilo/prism-provider-liquid test`
- `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/docs.test.ts`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/release.mjs gate`
- Live (owner machine): `bun scripts/live-matrix.mjs --only liquid,liquid-local`, then `bun scripts/decision-bench.mjs`

## Compromises Made

- **Local measured, hosted not.** The d1-3B quants now have a real bench run (`docs/_evidence/decision-bench-2026-10-23.md`), but the hosted-vs-local agreement figure still waits on `LIQUID_API_KEY` / `TYPESAFE_API_KEY` and `laya-serve`, i.e. one run on plan 186's gated path.
- **Reconstructed wire fixtures.** `wire/systemone` mirrors Liquid's documented envelopes instead of a captured exchange (no key at capture time); replace both files after the first gated live run.
- **Bench labels need owner review.** The 200 items are executor-authored and structurally validated, but the owner review the acceptance asks for has not happened; the first report is a draft until it does.
- **Kernel pack budget rebaselined** twice (+973/+2754 for the CHANGELOG entry, then +539/+1581 for the bench doc section), each with a dated reason; no kernel source growth.

## Further Actions

Known constraints recorded while drafting:

- **`liquid-local` discovery from `llama-server /v1/models`**, so router-mode model ids list without a static catalog. Priority P3.
- **d1-omni-600M** (text + image/audio, experimental, Transformers only). Revisit when `llama-server` serves it. Priority P4.
