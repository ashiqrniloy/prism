# Phase 18 Part A — Decision Calls as a Model Capability, and Image Input

## Objectives

- Make a decision call a model capability in its own right: `capabilities.decisions`, `ModelProvider.decisions?()`, and `prism.models.decisions(ref)`, the way plan 158 made embeddings one. Callers then get the typed answers, with probabilities and confidence, through the registry, the credentials slot, and the redaction set, instead of a JSON string from `generate()`.
- Give decision calls image input, in the kernel request and in the System One codec, on both the decide path and the `generate()` + `structuredOutput` path.
- Make the System One path configurable, so every System One endpoint (OpenRouter, Fastino, Celeris, Microsoft Foundry, TrueFoundry, llama.cpp `llama-server`, `laya-serve`, and Liquid in Part B) is reachable by configuration.
- Ship the two existing decision providers on the new capability for 0.13.0: hosted **Jev** (`typesafe`) and local **Laya** (`laya`), live-tested on the decide path.

## Expected Outcome

- `prism.models.decisions("typesafe/jev-latest").decide({ state, questions })` and `prism.models.decisions("laya/laya").decide(...)` return `{ model, answers, usage, timingMs }`, with every answer's `probabilities`/`confidence` intact.
- A model that does not declare `capabilities.decisions`, or whose provider registers no adapter, throws `DecisionsError("unsupported_model")` before any network call.
- The `generate()` + `structuredOutput` path still works for Jev and Laya, and forwards image parts to models that declare image input.
- `docs/decisions.md` documents the contract, the System One endpoint recipes, and the operating rules. An offline example demonstrates a package that makes decision calls.
- Plan 196 (Part B) builds `@arnilo/prism-provider-liquid` (hosted `d1`/`d1-ultra`, local `d1-3B`) on this contract.

This plan implements roadmap **Phase 18 — Decision models as first-class model calls**. The owner approved Phase 18 on 2026-10-17 and put it **inside 0.13.0 scope**: 0.13.0 ships decision calls for hosted Jev and d1-ultra and local Laya and d1-3B. Task 1 writes the phase into `roadmap.md`. The plan runs on the 0.13.0 release path as **step 11, after plan 194 and before plan 184**. It must land before plan 185, whose surface freeze has to see the new exports. It depends on plan 182, which moves the System One codec to `src/provider-kit/codecs/systemone`, and on plan 183, which adds `systemOneProviderPackage` and `systemOneConformance` and makes Laya keyless. The `file:line` citations are from the tree on 2026-10-17, before those plans ran, and Task 2 re-pins them. The plan adds a kernel contract (a `ModelProvider` member, a `PackageAPI` member, a capability flag), so **Task 2 is the phase review**. Because the additions ship in 0.13.0, they are part of kernel API level 1 from the start, and no package needs `requires.prism`. No version bump or publish happens here. The research behind the plan is in `docs/_evidence/decision-models-survey-2026-10-17.md`. Reference host impact: none planned. Task 2 confirms that `apps/prism-agent` needs no change. Cost knobs: decision calls bill input tokens only, and live rows state their request counts.

## Tasks

- [ ] Task 1: Roadmap Phase 18 entry (owner-approved 2026-10-17)
  - Acceptance Criteria:
    - Functional: `roadmap.md` changes in these places:
      - Part 4 gains `### Phase 18 — Decision models as first-class model calls`. Its Goal, Why, Scope, and Done are taken from plans 195 and 196.
      - Part 3 "Version targets" sets Phase 18 to **0.13.0** and adds 18 to the phases Phase 11 waits for ("Phase 11 does not start until Phases 12–18 are done").
      - The §2.9 provider row and Phase 5 "Provider packages" become `{hyper, opencode-go, typesafe, laya, liquid}` (owner decision 2026-10-17, superseding the four-provider list of 2026-10-16 only by adding `liquid`).
      - The §2.2/§2.3 model-layer text names `decisions?()` next to `embeddings?()`.
    - Performance: n/a (docs only).
    - Code Quality: the roadmap text matches plans 195–196, with no scope added beyond them.
    - Security: n/a (docs only).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9, Phase 5 Scope (`roadmap.md:1789`), Part 3 (`roadmap.md:1592-1603`); `docs/_evidence/decision-models-survey-2026-10-17.md` §6.
    - Options Considered:
      - Fold the work into Phase 5 (models and providers): rejected. Phase 5 is planned and in execution through plans 182–183, and a separate phase keeps the decision contract reviewable on its own.
      - Make it a Phase 11 part: rejected. Phase 11 parts are release work, while this is a new capability with its own Goal and Done.
    - Chosen Approach:
      - Add a new numbered phase with a 0.13.0 target, the same treatment Phases 12–17 got.
    - API Notes and Examples:
      ```md
      ### Phase 18 — Decision models as first-class model calls
      **Goal.** A decision call is a model capability with typed, calibrated answers, beside `generate` and `embeddings`.
      **Done.** Hosted Jev and d1-ultra and local Laya and d1-3B answer `prism.models.decisions(ref).decide(...)` live.
      ```
    - Files to Create/Edit:
      - `roadmap.md`: as above.
    - References:
      - owner decision 2026-10-17 (this plan's header); plan 182 Task 2 (precedent for a roadmap row edit inside a plan).
  - Test Cases to Write:
    - n/a: docs only. `bun test --timeout=0 src/__tests__/docs.test.ts` stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (roadmap text).
    - Docs pages to create/edit:
      - `roadmap.md`: as above.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The Notes record:
      - (a) **Contract inventory** after plans 182/183, each at `file:line`:
        - `ModelProvider` (`src/contracts-core/provider.ts:91-105`), `ModelCapabilities` (`src/contracts-core/content.ts:146-163`), `PackageAPI.models` (`src/packages/api.ts:118-127`), the loader's `models.embeddings` (`src/packages/loader.ts:748-761`), `ModelIndex` (`src/contracts-core/agent.ts:197-206`).
        - The System One codec (`src/provider-kit/systemone*.ts`, or `codecs/systemone` after 182): `SystemOneBody` (`systemone.ts:76-80`), the URL build (`systemone.ts:239`), `compileSystemOneState` (`systemone-schema.ts:120`), `renderSystemOneOutput` (`systemone-schema.ts:88`), `askSystemOneDecisions` (`systemone-decisions.ts:92`), `createSystemOneDecisionProvider` (`systemone-provider.ts:32`), and plan 183's `systemOneProviderPackage` and `systemOneConformance`.
      - (b) **Scope classification and kernel proof.** Each Objective is classified as *expressible* or *kernel addition*. The expected additions are `capabilities.decisions`, `ModelProvider.decisions?()`, and `PackageAPI.models.decisions`. The proof:
        - `models.client` returns a chat `ModelClient`, and `renderSystemOneOutput` discards `probabilities`/`confidence`.
        - `askSystemOneDecisions` takes a raw credential source and bypasses provider resolution, the credentials slot, and the agent redaction set.
        - No hook, slot, or service carries a typed per-model adapter. A `services.provide("decisions")` package could not resolve `provider/model` refs without duplicating the registry.
        - It is generic: three provider packages (typesafe, laya, liquid) implement it.
        - Decide whether hosts need `ModelIndex.decisions(ref)` or whether `agent.models.resolve(ref).provider.decisions?.()` is enough, and pick the smaller one.
      - (c) **API level.** The additions are optional members, shipped in 0.13.0, so they are part of `KERNEL_API_LEVEL = 1` (plan 179). Confirm that plan 185's freeze list will pick them up.
      - (d) **Wire facts, verified live** (keys from `~/.config/prism/live.env`; never asked in chat):
        - Whether Jev and `laya-serve` ignore an unknown `images` field or reject it with 422. This sets whether the codec omits `images` when it is empty (it must) and whether the Jev and Laya catalogs may ever declare image input.
        - Jev's and Laya's answer shapes for all three question types (one recording each).
        - `llama-server`'s `/v1/systemone` answer shape with one decision GGUF, used only for the endpoint recipe in Task 5. Liquid's own wire is Part B's review.
      - (e) **Verdict:** proceed, or re-cut.
    - Performance: n/a (read-only).
    - Code Quality: no code changes and no files outside the plan. Recordings stay in the executor's scratch directory until Task 4 commits them.
    - Security: probes print no key, and recordings are scrubbed of `authorization` headers before Task 4 commits them.
  - Approach:
    - Documentation Reviewed:
      - the code above; plans 121, 158, 179, 182, 183; `docs/models.md:44` ("`embeddings?()` is the only optional capability on `ModelProvider`"); survey §1.
    - Options Considered:
      - Skip the review because the change looks additive: rejected. `references/prism.md` §2 requires a review for any `PackageAPI` or `ModelProvider` addition.
    - Chosen Approach:
      - The standard review, plus live wire probes, because image handling on Jev and Laya is undocumented.
    - API Notes and Examples:
      ```sh
      curl -s https://api.typesafe.ai/v1/systemone -H "authorization: Bearer $TYPESAFE_API_KEY" -H 'content-type: application/json' -d @with-images.json
      curl -s http://127.0.0.1:8000/v1/systemone -H 'content-type: application/json' -d @with-images.json
      ```
    - Files to Create/Edit:
      - this plan's Task 2 Notes only.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2.
  - Test Cases to Write:
    - n/a: read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none (read-only).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Kernel decisions contract, with image input
  - Acceptance Criteria:
    - Functional:
      - `src/contracts-core/decisions.ts` defines, mirroring `src/contracts-core/embeddings.ts`:
        - provider-neutral `DecisionQuestion` (`noul` | `choice` | `score`, the System One vocabulary) and `DecisionAnswer`;
        - `DecisionRequest` (`state?`, `images?` as `data:` URLs, `questions`, `signal?`);
        - `DecisionResult` (`model`, `answers`, `usage?`, `timingMs`);
        - `DecisionsProvider { id; decide(request) }`;
        - `DecisionsError` (`unsupported_model`, `invalid_request`, `state_too_large`);
        - `modelSupportsDecisions` and `assertDecisionsSupported`.
      - `ModelCapabilities.decisions?: boolean`. `ModelProvider.decisions?(): DecisionsProvider`.
      - `PackageAPI.models.decisions(ref?)` needs the `"models"` capability and resolves through the same `resolveProvider` as `embeddings`.
        - It throws `DecisionsError("unsupported_model")` when the flag or the adapter is missing.
        - It throws a `TypeError` with no ref and no configured model, using the same wording as embeddings (`docs/models.md:152`).
      - The host-side access path chosen in Task 2 (b) ships in this task.
      - The kernel validates every request before the adapter runs:
        - 1–64 question names; choice 2–255 options; score 2–10 levels; a known `type`.
        - A state of at most `DEFAULT_MAX_DECISION_STATE_BYTES` (moved from `DEFAULT_MAX_SYSTEMONE_STATE_BYTES`, `systemone-decisions.ts:59`, with a repo-wide grep for the old name).
        - Images are `data:image/*` URLs within `DEFAULT_MAX_DECISION_IMAGE_BYTES` in total (default 8 MiB; Task 2 may change it).
        - A request with images to a model whose `capabilities.input` lacks `"image"` is rejected.
        - Each violation throws `DecisionsError("invalid_request" | "state_too_large")` naming the question or field and the rule.
    - Fail closed: every rule above has a test, and none of them reaches `fetch`.
    - Performance: no new import on the `generate` path. `decisions.ts` is types plus one validator, so load cost is unchanged for agents that never call `decisions`.
    - Code Quality:
      - The kernel names no vendor.
      - The `/testing` mock provider (`src/testing/mock-provider-package.ts`) gains a `decisions` handler that returns scripted answers, so packages test offline.
      - No alias is kept. `askSystemOneDecisions` either stays as the kit's raw-wire helper or is retired in favour of `models.decisions`, per Task 2. If retired, its callers are updated in this task and a repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) finds no leftover reference.
    - Security: `DecisionsError` messages pass through the agent's redactor. A test asserts that a key resolved for the adapter never appears in an error, event, or `inspect()` output.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/embeddings.ts:23-48`, `src/packages/loader.ts:748-761`, `src/packages/api.ts:118-127`, `src/contracts-core/provider.ts:91-105`, `src/content.ts:159-175` (the input-capability gate); plan 158; survey §1 (System One vocabulary covers about 80% of the market; images are `data:` URLs on Liquid, `llama-server`, and Clef).
    - Options Considered:
      - Keep decisions behind `generate()` + `structuredOutput` only: rejected. That path loses probabilities, confidence, and per-question reads ("P(yes) > 0.8").
      - A `decisions` service from a package: rejected (Task 2 (b)).
      - Neutral question names (`predicate`/`boolean`) with translation: rejected. 10+ vendors and `llama-server` send System One names. The OpenAI dialect maps `predicate` onto `noul` when its codec ships (Further Actions).
      - Image URLs other than `data:`: rejected. Every known decision endpoint takes inline data URLs only, and fetching remote URLs would add an SSRF surface.
    - Chosen Approach:
      - Mirror embeddings exactly: capability flag + optional provider method + `PackageAPI.models` accessor + typed error. Validation lives once in the kernel.
    - API Notes and Examples:
      ```ts
      const jev = prism.models.decisions("typesafe/jev-latest");
      const { answers } = await jev.decide({
        state: ticketText,
        questions: {
          urgent: { type: "noul", instructions: "Is the customer blocked right now?" },
          team: { type: "choice", instructions: "Which team owns this?", criteria: { billing: null, shipping: null } },
        },
      });
      if (answers.urgent.type === "noul" && answers.urgent.noul > 0.8) escalate();
      ```
    - Files to Create/Edit:
      - `src/contracts-core/decisions.ts` (new), `src/contracts-core/content.ts` (capability), `src/contracts-core/provider.ts` (method), `src/contracts.ts` and `src/index.ts` (exports), `src/packages/api.ts`, `src/packages/loader.ts`, `src/contracts-core/agent.ts` (only if Task 2 picks `ModelIndex.decisions`), `src/testing/mock-provider-package.ts`, `src/testing/index.ts`.
      - `src/__tests__/decisions.test.ts` (new), `src/__tests__/public-export-contract.test.ts` (freeze list), `scripts/compat-baseline/arnilo__prism.txt` (regenerated).
      - `docs/decisions.md` (new kernel page), `docs/models.md` (line 44 and the agents-with-no-model paragraph), `docs/packages.md` (the `models` capability row), `docs/index.md`, `src/__tests__/docs.test.ts` (`kernelPages`), `CHANGELOG.md`.
    - References:
      - plan 158; `references/prism.md` §4 "Kernel contract".
  - Test Cases to Write:
    - `modelSupportsDecisions_requires_explicit_capability_flag`: `undefined`, `{}`, and `{ decisions: false }` are false. Fails if the flag defaults on.
    - `models_decisions_throws_unsupported_model_without_flag_or_adapter`: two cases, both before any provider call.
    - `models_decisions_needs_models_capability`.
    - `models_decisions_without_ref_or_configured_model_throws_type_error`.
    - `decision_request_validation_rejects_bad_questions`: empty map, 65 names, 1-option choice, 11-level score, unknown type. Fails if any rule is dropped.
    - `decision_request_validation_rejects_bad_images`: non-`data:` URL, non-image MIME type, over the byte cap, images to a text-only model.
    - `decision_request_rejects_oversize_state_with_state_too_large`.
    - `mock_provider_decisions_returns_scripted_answers_with_probabilities`.
    - `decision_error_never_contains_resolved_key`: forced adapter error, then error, events, and `inspect()` all checked.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New kernel contract.
    - Docs pages to create/edit:
      - `docs/decisions.md`: new API page (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension notes / Security and performance notes, with the image byte cap and its sizing / Related APIs).
      - `docs/models.md`, `docs/packages.md`: as above.
    - `docs/index.md` update: yes (one link in the Kernel section).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes: baseline regeneration with `bun scripts/release.mjs gate --update-baseline`. The task note carries the diff of `scripts/compat-baseline/arnilo__prism.txt`, with additions attributed to plan 195 and any removal (`DEFAULT_MAX_SYSTEMONE_STATE_BYTES`, `askSystemOneDecisions` if retired) attributed too.

- [ ] Task 4: System One codec — decisions adapter, images, configurable path; Jev and Laya on the capability
  - Acceptance Criteria:
    - Functional:
      - `createSystemOneDecisionProvider` gains `decisions()`, which returns a `DecisionsProvider` posting through the same client (key resolution, retry, abort, redaction). Answers pass through unrendered.
      - `SystemOneBody` gains `images?: readonly string[]`. The field is omitted when there are no images, so text-only bodies are byte-identical to today's recordings.
      - `compileSystemOneState` returns `{ state, images }`: image parts in user messages become `images`, and text stays in `state`. The `generate()` + `structuredOutput` path forwards images too.
      - The client and `systemOneProviderPackage` take `path?: string` (default `/v1/systemone`). Foundry (`/providers/microsoft/v1/systemone`) and Liquid in Part B need no fork.
      - The `typesafe` and `laya` catalogs declare `decisions: true`. Their `input` stays `["text"]`, since both models are text-only (survey §2–§3; Task 2 (d) confirms the server behaviour).
      - `systemOneConformance` (plan 183) gains `decide` cases:
        - raw answers with probabilities intact;
        - images sent only when the model declares `input: ["image"]`;
        - a custom path honored;
        - 401 and 422 mapped to the error classes Task 3 defines;
        - credentials resolved once per decide;
        - no secret in errors.
      - The Jev and Laya live suites from plan 183 each gain one `decide` call with three question types: `typesafe_live_decide`, gated on `TYPESAFE_API_KEY`, and `laya_live_decide`, gated on `PRISM_LIVE_LAYA` with `laya-serve`. The live-matrix rows state the new request counts.
    - Fail closed: an image part sent to a text-only model is rejected by `assertMessagesSupportModelCapabilities` (`src/content.ts:169`) on the generate path and by Task 3's validator on the decide path. Neither sends a request. A `path` not starting with `/` is a config error at construction.
    - Performance: one HTTP round trip per `decide`, as today. Images are sent as given, with no re-encode.
    - Code Quality: the codec stays vendor-free, with vendor URLs only in packages. One compile function serves both paths.
    - Security: the image cap bounds memory per request. Recordings are scrubbed. The plaintext-endpoint warning (moved into the client by plan 183) covers base URL + `path`.
  - Approach:
    - Documentation Reviewed:
      - `src/provider-kit/systemone.ts:76-80,146-166,230-260`, `systemone-schema.ts:88-130`, `systemone-provider.ts:32-73`; plan 183 (System One package shape, conformance, live suites); llama.cpp decision-models post (`images` as data URLs); TrueFoundry Decisions doc (System One `images`); Microsoft Foundry path (survey §1).
    - Options Considered:
      - Images only on the decide path: rejected. Agents that use `structuredOutput` with an image-capable decision model would silently drop images.
      - Vendor path constants in the codec: rejected, because the codec stays vendor-free.
    - Chosen Approach:
      - Extend the existing builder, so every System One package inherits `decisions()`.
    - API Notes and Examples:
      ```ts
      createSystemOneDecisionProvider({ id: "foundry", label: "Microsoft-Decision-1", baseUrl, path: "/providers/microsoft/v1/systemone", apiKey });
      ```
    - Files to Create/Edit:
      - `src/provider-kit/{systemone,systemone-schema,systemone-provider,systemone-decisions,conformance,index}.ts` (paths as moved by plan 182), `src/__tests__/systemone*.test.ts`, `src/__tests__/wire/systemone/*` (Task 2 recordings).
      - `packages/providers/{typesafe,laya}/src/models.ts`, their unit and live tests, READMEs, and CHANGELOGs.
      - `scripts/live-matrix.json` (decide request counts), `docs/live-testing.md` (generated).
      - `scripts/compat-baseline/{arnilo__prism,arnilo__prism-provider-typesafe,arnilo__prism-provider-laya}.txt` (regenerated).
      - `docs/provider-kit.md` (System One section), `docs/decisions.md`, `CHANGELOG.md`.
    - References:
      - Task 2 (d); survey §1.
  - Test Cases to Write:
    - `systemone_decide_returns_raw_answers_with_probabilities`: fails if the renderer runs on the decide path.
    - `systemone_text_only_body_is_unchanged`: the recorded body has no `images` key.
    - `systemone_compile_state_moves_image_parts_to_images`.
    - `systemone_generate_forwards_images_for_image_models`, `systemone_rejects_image_for_text_only_model_before_fetch`.
    - `systemone_custom_path_is_used_and_must_start_with_slash`.
    - `typesafe_passes_systemone_conformance`, `laya_passes_systemone_conformance` (extended with `decide`).
    - `typesafe_live_decide`, `laya_live_decide` (live, gated).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (kit options, catalog capability flags, a new call path for two shipped packages).
    - Docs pages to create/edit:
      - `docs/provider-kit.md`: `path`, `images`, `decisions()`.
      - `packages/providers/{typesafe,laya}/README.md`: "Behaviour" gains `prism.models.decisions(...)` as the primary call, with `structuredOutput` as the convenience path.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes: regenerate the three baselines above, with the diff in the task note.

- [ ] Task 5: Endpoint recipes, operating rules, and an offline example
  - Acceptance Criteria:
    - Functional:
      - `docs/decisions.md` gains "System One endpoints". Each entry is a `createSystemOneDecisionProvider` snippet registered through `prism.providers.register`, with the base URL, path, key env var, and one caveat:
        - OpenRouter (`https://openrouter.ai/api`, `/v1/systemone`)
        - Fastino GLiDE
        - Celeris-1 Decision
        - Microsoft Foundry (`/providers/microsoft/v1/systemone`)
        - TrueFoundry
        - `llama-server` with any decision GGUF (Task 2 recording)
        - `laya-serve`
      - It gains "Operating rules":
        - pin versioned ids and log the returned `model`;
        - set thresholds per model after calibrating on your own labels (a few hundred);
        - keep the question out of the state;
        - never use a decision model as the only prompt-injection defense;
        - keep local decision heads at Q8_0 or higher.
      - `examples/decision-models.ts` runs offline on the mock provider's `decisions` handler. A package calls `prism.models.decisions()` from a `run.input` hook to route a ticket and prints the probabilities.
    - Fail closed: the example asserts that a model without `decisions` throws `DecisionsError("unsupported_model")`.
    - Performance: each recipe names its price source and notes input-only billing. Nothing is fetched at setup.
    - Code Quality: recipes are documentation, with no new exports or packages.
    - Security: recipes use `env:` refs only. The example emits no secret (`examples_demos_run_to_completion_and_emit_no_secret`).
  - Approach:
    - Documentation Reviewed:
      - survey §1–§2 and §6; TrueFoundry Decisions doc; OpenRouter Jev guide; Fastino System One doc.
    - Options Considered:
      - A provider package per System One vendor: rejected. Roadmap §2.9 fixes the shipped provider list, and these endpoints differ only by URL.
      - No recipes: rejected. First-class means a host can reach the market without reading codec source.
    - Chosen Approach:
      - Docs recipes plus one executable example on the mock.
    - API Notes and Examples:
      ```ts
      prism.providers.register(createSystemOneDecisionProvider({
        id: "openrouter-decisions", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", apiKey: refSource(resolve, "env:OPENROUTER_API_KEY"),
      }));
      ```
    - Files to Create/Edit:
      - `docs/decisions.md`, `examples/decision-models.ts` (new), `examples/README.md`, `scripts/e2e-coverage.json`, `CHANGELOG.md`.
    - References:
      - `docs/_evidence/decision-models-survey-2026-10-17.md`.
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `decision-models.ts` (existing gate, new row).
    - `docs.test.ts` passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; docs and example only.
    - Docs pages to create/edit:
      - `docs/decisions.md`: the two sections above.
    - `docs/index.md` update: no (linked in Task 3).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/decisions.test.ts src/__tests__/systemone*.test.ts src/__tests__/public-export-contract.test.ts`
- `bun run --filter @arnilo/prism-provider-typesafe test && bun run --filter @arnilo/prism-provider-laya test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/release.mjs gate`
- Live (owner machine): `bun scripts/live-matrix.mjs --only typesafe,laya`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

Known constraints recorded while drafting:

- **OpenAI Decisions codec** (`/v1/decisions`: `predicate`/`choice`/`score`, ordered answers, `refusal`). It would reach OpenAI `gpt-6-luna`, Inception Mercury Decide (native), Celeris, and OpenRouter alpha. Deferred because the API is in public beta with one model and an incomplete published schema. Revisit at GA. Priority P2.
- **Decision calls in observability**: a `model.decision` span or event with question names, chosen answers, and usage, and no state text. Priority P3.
- **Consumers**: `@arnilo/prism-model-router` routing turns on a decision model, and `@arnilo/prism-approval` using a `score` question for risk. Each needs its own owner decision. Priority P3.
