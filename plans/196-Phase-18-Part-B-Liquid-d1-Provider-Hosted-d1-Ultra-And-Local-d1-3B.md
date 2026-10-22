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

- [ ] Task 1: Phase review — Liquid and `llama-server` wire (read-only)
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

- [ ] Task 2: `@arnilo/prism-provider-liquid`
  - Acceptance Criteria:
    - Functional:
      - Built with `systemOneProviderPackage`. It registers two providers:
        - **`liquid` (hosted):**
          - Base URL and path from Task 1 (b). `keyRequired: true`; `apiKey` default `env:LIQUID_API_KEY`.
          - Catalog `d1-ultra` and `d1`: `input: ["text","image"]`, `decisions: true`, `structuredOutput: "json_schema"`, tools and streaming false, `maxOutputTokens: 0`.
          - Cost from Task 1 (b), with its source in `metadata.priceSource`. `contextWindow` only if Task 1 confirmed it.
        - **`liquid-local` (`llama-server`):**
          - Default `localBaseUrl` `http://127.0.0.1:8080`. `keyRequired: false`, with an optional `localApiKey` ref for `llama-server --api-key`.
          - Catalog `d1-3B`: `contextWindow: 32768`, `input: ["text","image"]`, `decisions: true`, `metadata.recommendedQuant: "Q8_0"`, zero cost.
      - Config is JSON Schema with ref-only secrets. `hosted: false` skips registering `liquid`, and with it the missing-key note, for a local-only dev setup.
      - The README tells hosts to pin ids and log the returned `model`.
      - The local provider sends `model` as the catalog id. The README documents `--alias d1-3B`, so single-model and router mode both answer.
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
      - Enforcement rows: root `package.json` `workspaces`; `scripts/package-truth.mjs` / `scripts/package-truth.json` counts; `src/__tests__/packaging.test.ts` package list; `scripts/independent-packages.json`; `scripts/compat-baseline/arnilo__prism-provider-liquid.txt` (new); `scripts/live-matrix.json` (rows `providers/liquid` and `providers/liquid-local` with request counts); `scripts/live.env.example` (`LIQUID_API_KEY`, `PRISM_LIVE_LLAMA_SERVER_URL`); `docs/live-testing.md` (generated, plus the `llama-server` prerequisite); `docs/index.md` (README link); `docs/models.md` "Provider packages"; `CHANGELOG.md`.
    - References:
      - Task 1; owner decisions 2026-10-15 (live keys) and 2026-10-17 (Phase 18 in 0.13.0, hosted and local, d1-ultra).
  - Test Cases to Write:
    - `liquid_passes_systemone_conformance` (hosted and local factories, Task 1 recordings, including `decide` and images).
    - `liquid_package_conformance` (`@arnilo/prism/testing`).
    - `liquid_hosted_missing_key_notes_warn_and_still_lists_catalog`, `liquid_local_sends_no_authorization_without_key`, `liquid_local_sends_bearer_with_local_api_key`, `liquid_hosted_false_registers_only_local`.
    - `liquid_rejects_literal_key`, `liquid_unknown_config_field_fails_validation`.
    - `liquid_hosted_uses_reviewed_path`: fails if the path regresses to the wrong form.
    - `liquid_secret_never_in_events_inspect_or_errors`.
    - Live (gated): `liquid_live_hosted_d1_ultra_and_d1_decide_text_and_image` on `LIQUID_API_KEY`; `liquid_live_local_d1_3b_decide_text_and_image` on `PRISM_LIVE_LLAMA_SERVER_URL`. Each runs one `decide` and one `generate` per model, and the counts go in the live-matrix rows.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new package).
    - Docs pages to create/edit:
      - `packages/providers/liquid/README.md`, using the package page structure:
        - the `llama-server` quickstart (`llama-server -hf LiquidAI/d1-3B-GGUF:Q8_0 --alias d1-3B`) and why Q8_0;
        - the license;
        - the hosted-vs-d1-3B note (not confirmed to be the same model; Task 1 (d) agreement rate);
        - a manifest entry example.
      - `docs/models.md`: provider package list. `docs/live-testing.md`: prerequisite.
    - `docs/index.md` update: yes (README link).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes: create the baseline with `bun scripts/release.mjs gate --update-baseline`, with the diff in the task note.

- [ ] Task 3: Measure d1-3B against Laya on Prism-shaped decisions
  - Acceptance Criteria:
    - Functional:
      - `scripts/decision-bench.mjs` (live, not in CI) runs a fixed, checked-in decision set through `prism.models.decisions`. The same questions go to:
        - `liquid-local/d1-3B` (Q4_K_M and Q8_0);
        - `laya/laya` (`laya-serve`);
        - with keys present, `liquid/d1-ultra`, `liquid/d1`, and `typesafe/jev-latest`.
      - The set is 150–300 labelled items in Prism-shaped decisions: tool or route choice, approval risk score, "is this tool result an error", and intent. The owner reviews the labels.
      - It reports accuracy, ECE, Brier, p50/p95 latency, the share of answers that flip when options are reversed, and (hosted) cost.
      - Results go to `docs/_evidence/decision-bench-<date>.md` with the hardware, the `llama-server` build, and the GGUF hashes.
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

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-provider-liquid build && bun run --filter @arnilo/prism-provider-liquid test`
- `bun test --timeout=0 src/__tests__/packaging.test.ts src/__tests__/docs.test.ts`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/release.mjs gate`
- Live (owner machine): `bun scripts/live-matrix.mjs --only liquid,liquid-local`, then `bun scripts/decision-bench.mjs`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

Known constraints recorded while drafting:

- **`liquid-local` discovery from `llama-server /v1/models`**, so router-mode model ids list without a static catalog. Priority P3.
- **d1-omni-600M** (text + image/audio, experimental, Transformers only). Revisit when `llama-server` serves it. Priority P4.
