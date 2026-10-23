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

- [x] Task 1: Roadmap Phase 18 entry (owner-approved 2026-10-17)
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
  - Notes:
    - `roadmap.md` updated in five places:
      - Part 4 gains `### Phase 18 — Decision models as first-class model calls` between Phase 17 and Phase 12, with Goal, Why, Scope (kernel contract, System One codec, `typesafe`/`laya`/`liquid` packages, docs and example), Depends on (Phase 5, plans 182/183), and Done taken from plans 195 and 196.
      - Part 3 Version targets gains a Phase 18 row targeted at 0.13.0, and the external-agent row now reads "Phase 11 does not start until Phases 12–18 are done".
      - §2.9 provider row and Phase 5 "Provider packages" become `{hyper, opencode-go, typesafe, laya, liquid}`, attributed to the 2026-10-17 owner decision as adding `liquid` to the 2026-10-16 list.
      - Model-layer text names `decisions?()` beside `embeddings?()` in the §2.1 kernel-responsibilities row and the §2.2 `models/` module line. The roadmap has no `ModelProvider` interface sketch in §2.3, so the host-/package-facing declaration went into the `PackageAPI.models` sketch in §2.6 (`client`, `embeddings`, `decisions`).
      - Order section adds "Phase 18 (decision models) needs Phase 5, and runs after Phase 17 and before Phase 12", and the execution chain reads 13 → 14 → 15 → 16 → 17 → 18 → 12 → 11.
    - Header `Updated:` line moves to 2026-10-17 and records the Phase 18 addition; the previous 2026-10-10 entry is retained as "Previously".
    - No scope was added beyond plans 195 and 196; Liquid stays Part B of the phase.
    - `bun test --timeout=0 src/__tests__/docs.test.ts`: 64 pass, 0 fail.

- [x] Task 2: Phase review (read-only)
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
      - The standard review, plus live wire probes, because image handling on Jev and Laya is undocumented. The probes were attempted on 2026-10-18 and blocked by the environment: no `TYPESAFE_API_KEY` and no local `laya-serve`/`llama-server`. Notes (d) record the substitution and move the recording debt to Task 4's gated live legs.
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
  - Notes:
    - **(a) Contract inventory** (tree after plans 182/183, 2026-10-18). Plan 182 **did not** move the System One codec: there is no `src/provider-kit/codecs/systemone`; the files remain `src/provider-kit/systemone*.ts`. Plan 182's Objective (line 14) claimed the move, its own Task 3 note only records the `routed-provider` refactor, and the tree wins.
      - Kernel: `ModelProvider` `src/contracts-core/provider.ts:92-107` (`embeddings?()` at 106), `ModelCapabilities` `src/contracts-core/content.ts:148-163` (`embeddings?` at 160, no `decisions`), `PackageAPI.models` `src/packages/api.ts:118-128` (`client` 121, `embeddings` 126), loader `models.embeddings` `src/packages/loader.ts:748-761` (`resolveProvider` at 131), `ModelIndex` `src/contracts-core/agent.ts:197-206` with `ResolvedModel` at `188-191` exposing `provider`, `createModelIndex.resolve` at `src/agent/models.ts:51-53`.
      - System One codec: `SystemOneBody` `src/provider-kit/systemone.ts:77-81` (no `images`), URL build `src/provider-kit/systemone.ts:242` (hard-coded `/v1/systemone`), answer types `src/provider-kit/systemone.ts:47-71` (score answer with `probabilities`/`confidence`/`legend`), `compileSystemOneState` `src/provider-kit/systemone-schema.ts:120-131` (sync; non-text parts dropped), `renderSystemOneOutput` `src/provider-kit/systemone-schema.ts:88`, limits `src/provider-kit/systemone-schema.ts:32-36` (`MAX_SYSTEMONE_CHOICE_OPTIONS=255`, `MAX_SYSTEMONE_SCORE_LEVELS=10`, `MAX_SYSTEMONE_QUESTIONS=256`), `askSystemOneDecisions` `src/provider-kit/systemone-decisions.ts:92`, `DEFAULT_MAX_SYSTEMONE_STATE_BYTES` `src/provider-kit/systemone-decisions.ts:59` (262_144), `createSystemOneDecisionProvider` `src/provider-kit/systemone-provider.ts:45`, `systemOneProviderPackage` `src/provider-kit/systemone-provider.ts:158` (config schema has no `path`), `systemOneConformance` `src/provider-kit/conformance.ts:823` (generate-only scenarios).
      - Packages and testing: `typesafe` catalog `packages/providers/typesafe/src/models.ts:12-19` and `laya` `packages/providers/laya/src/models.ts:12-19` both declare `input: ["text"]` and no `decisions`; mock provider `src/testing/mock-provider-package.ts:10-27` has an `embeddings` option and no `decisions`; live helper `runSystemOneLiveScenarios` `src/testing/provider-live-scenarios.ts:911` builds `modelConfig` with only `structuredOutput` at `948-951`.
      - Freeze surfaces that must change together: `src/__tests__/public-export-contract.test.ts:610,639`, `src/__tests__/provider-kit.test.ts:91,120,221`, `scripts/compat-baseline/arnilo__prism.txt:92`.
    - **(b) Scope classification and kernel proof.** `generate()` + `structuredOutput` is *expressible* but lossy; images and `path` are *codec additions*; `capabilities.decisions`, `ModelProvider.decisions?()`, and `PackageAPI.models.decisions` are *kernel additions*.
      - `models.client` returns `ModelClient` (`src/packages/api.ts:68-73`), which has only `generate`; on the System One path `renderSystemOneOutput` returns JSON text, so `probabilities` and `confidence` are gone.
      - `askSystemOneDecisions` takes its credential through `SystemOneClientOptions.apiKey` (`CredentialValueSource`) and calls `postSystemOne` directly; it never reaches `resolveProvider` (`loader.ts:131`), `requireCapability`, or the agent redactor. Only the per-call `secrets` list in `postSystemOne` redacts, and only inside that call.
      - No hook, slot, or typed service exists: `SLOT_NAMES` is `loop|compaction|store|credentials` (`src/packages/capabilities.ts:14-17`), and `services.provide<T>(name, impl)` is a string-keyed bag with no model ref. A package could offer `services.provide("decisions")` only by re-implementing `parseModelRef` + `resolveProvider`, i.e. duplicating the registry.
      - It is generic: `typesafe`, `laya`, and Part B's `liquid` all implement the same adapter.
      - **Host path chosen: `agent.models.resolve(ref).provider.decisions?.()`.** `ResolvedModel` already exposes `provider` (`agent.ts:188-191`) and `resolve` already delegates to `resolveProvider` (`src/agent/models.ts:51-53`), so no `ModelIndex.decisions` member, no second resolution path, and no new kernel export. The capability/`unsupported_model` check stays in the loader accessor for packages; a host calls the adapter and gets the kernel validator inside `decide`.
    - **(b, design gap) `DecisionRequest` must carry `model`.** `provider.decisions()` is provider-wide, exactly like `provider.embeddings()`, whose `EmbeddingsRequest.model` is required (`src/contracts-core/embeddings.ts:7-12`). Add `model: string` to `DecisionRequest`. `PackageAPI.models.decisions(ref)` returns a thin wrapper that binds the resolved model id, so `prism.models.decisions("typesafe/jev-latest").decide({ state, questions })` keeps the Expected Outcome shape. The host path passes `model` explicitly. Without this, the adapter cannot build the `{ model }` wire field.
    - **(b, decision) `askSystemOneDecisions` stays.** It is the kit's raw-wire helper (no registry, no slot), exported from `provider-kit`, documented at `docs/provider-kit.md:348`, and the natural single implementation behind `decisions()`. Consequence: `DEFAULT_MAX_SYSTEMONE_STATE_BYTES` **stays**; Task 3 adds `DEFAULT_MAX_DECISION_STATE_BYTES = 262_144` with the same value. No rename and no repo-wide grep for the old name.
    - **(b, conflicts accepted)** The kit allows 256 questions (`MAX_SYSTEMONE_QUESTIONS`); the kernel contract caps at 64 as planned, because the kernel bound must hold for every vendor and the raw kit call keeps 256. Image budget: 8 MiB total for a decision call, deliberately below the 10 MB/item and 32 MiB/request assembly bounds (`src/content.ts:28-31`); no reuse of `assertMediaBlocksWithinBounds` for the decide path.
    - **(c) API level.** `KERNEL_API_LEVEL = 1` (`src/version.ts:12`); the additions are optional members shipped for the first time in 0.13.0, so level 1 is unchanged per plan 179's rule. Plan 185 Task 4 makes the baselines shape-aware and its freeze list consumes `public-export-contract.test.ts` + the regenerated `scripts/compat-baseline/*.txt`, so these members are frozen there. `compileSystemOneState` changing its return shape is breaking for kit callers, but 0.13.0 is unreleased and level 1 is not yet published; it is recorded in Task 4's baseline diff with no level bump (same pre-release treatment as plans 182/183).
    - **(d) Wire facts — live probes could not run.** `~/.config/prism/live.env` holds only `PRISM_LIVE_PROVIDER_TESTS` and `OPENCODE_GO_API_KEY`; there is no `TYPESAFE_API_KEY` or `LIQUID_API_KEY`, no `laya-serve` or `llama-server` binary, and nothing listens on `127.0.0.1:8000`. An unauthenticated `POST https://api.typesafe.ai/v1/systemone` returns `403` with `{"detail":{"error_type":"authentication_error","message":"Must supply an API key! ..."}}`, so the endpoint is reachable and the path is right. No key was printed and none was requested in chat.
      - Consequence: the unknown-`images`-field question is moot for Jev and Laya. Both catalogs stay `input: ["text"]`, so the codec never sends `images` to them; Task 4's omit-when-empty rule is unconditional and tested offline. Score-answer shapes remain unrecorded; Task 4's gated `typesafe_live_decide` and `laya_live_decide` legs must cover all three question types and collect the recordings (the typed score answer already exists at `systemone.ts:61-69`).
      - The `llama-server` recipe in Task 5 is doc-based (upstream llama.cpp decision-models guide), not locally verified. Liquid's wire is Part B's.
    - **(d, helper gap)** `runSystemOneLiveScenarios` builds `modelConfig` with only `structuredOutput` (`provider-live-scenarios.ts:948-951`), so a decide leg must either pass a full `ModelConfig` with `capabilities.decisions: true` or the helper must add the flag; otherwise the kernel accessor throws `unsupported_model`.
    - **(e) Verdict: proceed**, with these amendments applied below: codec stays under `src/provider-kit/systemone*.ts`; `DecisionRequest.model` + bound `models.decisions`; `askSystemOneDecisions` and its constant stay; live-probe debt moves to Task 4's gated legs.
    - **Part B handoff (plan 196, not this plan):** `docs/models.md:156` ("ships 4 provider packages"), `docs/provider-kit.md:475` ("the 4 provider packages"), and `docs/migrate-to-0.13.md:74` (provider list) all need `liquid` added when Part B lands.

- [x] Task 3: Kernel decisions contract, with image input
  - Acceptance Criteria:
    - Functional:
      - `src/contracts-core/decisions.ts` defines, mirroring `src/contracts-core/embeddings.ts`:
        - provider-neutral `DecisionQuestion` (`noul` | `choice` | `score`, the System One vocabulary) and `DecisionAnswer`;
        - `DecisionRequest` (`model`, `state?`, `images?` as `data:` URLs, `questions`, `signal?`) — `model` mirrors `EmbeddingsRequest.model`, because the provider adapter is provider-wide (Task 2 (b)); `PackageAPI.models.decisions(ref)` binds the resolved id so package callers omit it;
        - `DecisionResult` (`model`, `answers`, `usage?`, `timingMs`);
        - `DecisionsProvider { id; decide(request) }`;
        - `DecisionsError` (`unsupported_model`, `invalid_request`, `state_too_large`);
        - `modelSupportsDecisions` and `assertDecisionsSupported`.
      - `ModelCapabilities.decisions?: boolean`. `ModelProvider.decisions?(): DecisionsProvider`.
      - `PackageAPI.models.decisions(ref?)` needs the `"models"` capability and resolves through the same `resolveProvider` as `embeddings`.
        - It returns a wrapper that binds the resolved `provider/model` id into `DecisionRequest.model`; the raw `provider.decisions()` adapter requires it from the caller.
        - It throws `DecisionsError("unsupported_model")` when the flag or the adapter is missing.
        - It throws a `TypeError` with no ref and no configured model, using the same wording as embeddings (`docs/models.md:152`).
      - The host-side access path chosen in Task 2 (b) ships in this task: none. Hosts use the existing `agent.models.resolve(ref).provider.decisions?.()`; no `ModelIndex.decisions` is added.
      - The kernel validates every request before the adapter runs:
        - 1–64 question names; choice 2–255 options; score 2–10 levels; a known `type`.
        - A state of at most `DEFAULT_MAX_DECISION_STATE_BYTES` (262_144, the same value as the kit's `DEFAULT_MAX_SYSTEMONE_STATE_BYTES`; Task 2 keeps both names because `askSystemOneDecisions` stays).
        - Images are `data:image/*` URLs within `DEFAULT_MAX_DECISION_IMAGE_BYTES` in total (default 8 MiB; Task 2 may change it).
        - A request with images to a model whose `capabilities.input` lacks `"image"` is rejected.
        - Each violation throws `DecisionsError("invalid_request" | "state_too_large")` naming the question or field and the rule.
    - Fail closed: every rule above has a test, and none of them reaches `fetch`.
    - Performance: no new import on the `generate` path. `decisions.ts` is types plus one validator, so load cost is unchanged for agents that never call `decisions`.
    - Code Quality:
      - The kernel names no vendor.
      - The `/testing` mock provider (`src/testing/mock-provider-package.ts`) gains a `decisions` handler that returns scripted answers, so packages test offline.
      - No alias is kept. `askSystemOneDecisions` stays as the kit's raw-wire helper (Task 2 (b)) and backs `decisions()`; `DEFAULT_MAX_SYSTEMONE_STATE_BYTES` stays with it.
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
    - `models_decisions_binds_the_resolved_model_id`: the wrapper fills `request.model` from the ref, and the adapter sees it.
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
  - Notes:
    - **Shipped surface.** `src/contracts-core/decisions.ts` holds the questions/answers (`noul`/`choice`/`score`), `DecisionInput`/`DecisionRequest` (request always carries `model`), `DecisionResult`, `DecisionsProvider` (raw) and `DecisionsClient` (model-bound), `DecisionsError` with the three codes, `modelSupportsDecisions`, `assertDecisionsSupported`, `assertDecisionRequest`, and `MAX_DECISION_QUESTIONS=64` / `MAX_DECISION_CHOICE_OPTIONS=255` / `MAX_DECISION_SCORE_LEVELS=10` / `DEFAULT_MAX_DECISION_STATE_BYTES=262_144` / `DEFAULT_MAX_DECISION_IMAGE_BYTES=8 MiB`. `ModelCapabilities.decisions`, `ModelProvider.decisions?()`, `PackageAPI.models.decisions(ref?)` + loader wrapper, `/testing` mock `decisions` adapter, and root/barrel exports are wired. `contracts-core.ts` re-exports the module; `index.ts` exports the 10 new runtime names (types ride `export type *`, the embeddings precedent).
    - **Two additions to the planned surface, both deliberate.** (1) `assertDecisionRequest(request, model)` is public: the raw `agent.models.resolve(ref).provider.decisions?.()` path has no loader in front of it, so the adapter must be able to enforce the same bounds (Task 4 calls it). (2) `DecisionInput`/`DecisionsClient` separate the package-facing call (model optional, bound by the wrapper) from the raw adapter call (model required), so the documented `decisions("typesafe/jev-latest").decide({ state, questions })` typechecks.
    - **Gating a string ref.** A string `ref` carries no capabilities (`parseModelRef`), so `models.decisions("provider/model")` cannot see the flag. The loader therefore throws `unsupported_model` when the resolved spec has a `capabilities` object without `decisions`, or when no adapter exists, and otherwise trusts the adapter to gate its own model. A configured model or a `ModelSpec` object gives fail-fast behaviour. This is the only way the plan's Expected Outcome example can work; `docs/decisions.md` states it.
    - **Image gate.** The kernel rejects images when `capabilities.input` is declared and lacks `image`. An absent `input` is treated as unknown, matching `assertModelSupportsContentBlocks` (which returns early); the stricter reading ("absent lacks image") would reject every string-ref call. `state_too_large` covers both the state ceiling and the decoded image total; `invalid_request` covers every shape/MIME/URL violation. Images are validated as `data:image/*;base64` only, decoded size computed without `Buffer`, and never fetched.
    - **Tests:** `src/__tests__/decisions.test.ts` (11) covers the flag default, typed unsupported error, question bounds (empty/65/1-option/11-level/unknown type/empty instructions), image bounds (remote, wrong MIME, 9 MiB, text-only model, valid), state ceiling, both missing-flag/missing-adapter cases, the `models` capability gate, model-id binding, the no-model `TypeError`, the scripted mock answers with probabilities, and the redaction witness. `model-ref.test.ts` now expects `decisions` in the `ModelProvider` member set.
    - **Redaction witness scope.** The kernel never owns the adapter error object, so the test asserts the surfaces it does own: a package that catches the adapter's `sk-live-…` error and reports it through `api.log`/`api.status.note` leaks nothing, and `agent.inspect()` shows `[REDACTED]`. Task 4's System One adapter must still build its errors from redacted values.
    - **Docs:** new `docs/decisions.md` (all required sections), `docs/models.md` optional-capability sentence + model-less paragraph, `docs/packages.md` two `models.*` rows and the capability row, `docs/index.md` Kernel link, `docs.test.ts` `kernelPages`, and one `CHANGELOG.md` entry.
    - **Baselines.** `bun scripts/release.mjs gate --update-baseline` regenerated `scripts/compat-baseline/arnilo__prism.txt` (+10 lines, all plan 195: 5 constants, `DecisionsError`, 3 functions, and `assertDecisionRequest`; no removal, `askSystemOneDecisions` and `DEFAULT_MAX_SYSTEMONE_STATE_BYTES` untouched). It also required `scripts/budgets.json` kernel rebaseline: packed 1,110,689 (+6,028), unpacked 3,618,749 (+21,249), fileCount 357 (+2), rootExports 1,476 (+25, counting the 16 new types), sourceLines 37,534 (+307), with the reason recorded in each `$comment`. No new dependency.
    - **Verification run:** `bun x tsc --noEmit` clean; decisions + model-ref + public-export-contract + docs tests 114 pass; release gate (with baselines updated) passed.

- [x] Task 4: System One codec — decisions adapter, images, configurable path; Jev and Laya on the capability
  - Acceptance Criteria:
    - Functional:
      - `createSystemOneDecisionProvider` gains `decisions()`, which returns a `DecisionsProvider` posting through the same client (key resolution, retry, abort, redaction). Answers pass through unrendered.
      - `SystemOneBody` gains `images?: readonly string[]`. The field is omitted when there are no images, so text-only bodies are byte-identical to today's recordings.
      - `compileSystemOneState` returns `{ state, images }`: image parts in user messages become `images`, and text stays in `state`. The `generate()` + `structuredOutput` path forwards images too.
      - The client and `systemOneProviderPackage` take `path?: string` (default `/v1/systemone`). For the package it is config (`SystemOneProviderConfig.path`, `path` in the JSON Schema) so a host can point it at Foundry (`/providers/microsoft/v1/systemone`) or Liquid in Part B without a fork.
      - The `typesafe` and `laya` catalogs declare `decisions: true`. Their `input` stays `["text"]`, since both models are text-only (survey §2–§3; Task 2 (d) found no evidence that either accepts images).
      - `systemOneConformance` (plan 183) gains `decide` cases:
        - raw answers with probabilities intact;
        - images sent only when the model declares `input: ["image"]`;
        - a custom path honored;
        - 401 and 422 mapped to the error classes Task 3 defines;
        - credentials resolved once per decide;
        - no secret in errors.
      - The Jev and Laya live suites from plan 183 each gain one `decide` call with three question types: `typesafe_live_decide`, gated on `TYPESAFE_API_KEY`, and `laya_live_decide`, gated on `PRISM_LIVE_LAYA` with `laya-serve`. Task 2 could not run the live wire probes (no key, no local server), so these legs also collect the first score-answer recordings. `runSystemOneLiveScenarios` must pass a model config with `capabilities.decisions: true` (or set the flag itself); its current config carries only `structuredOutput`. The live-matrix rows state the new request counts.
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
      - `src/provider-kit/{systemone,systemone-schema,systemone-provider,systemone-decisions,conformance,index}.ts` (they stayed at the kit root; plan 182 did not create `codecs/systemone`), `src/__tests__/systemone*.test.ts`, `src/__tests__/wire/systemone/*` (Task 2 recordings).
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
  - Notes:
    - **`decisions()`** lives on the provider returned by `createSystemOneDecisionProvider`, so both vendors inherit it. It posts through `askSystemOneDecisions` (same client: key resolution, retry, abort, bounded parsing) and returns the raw `model`/`answers`/`usage`/`timingMs`; the schema renderer is not on this path. One credential resolution per call. 401/422 map to `DecisionsError("invalid_request")`; every other adapter failure is wrapped the same way with the resolved key redacted, while an aborted call keeps its abort error. `assertDecisionRequest` runs before the wire with the provider's curated catalog entry when the model id is known (so a text-only model rejects images), and with a capability-free synthetic config for a versioned pin or unknown id, where the caller is trusted.
    - **Images** — `SystemOneBody.images?: readonly string[]`, omitted when empty (text-only bodies byte-identical to the recordings). `compileSystemOneState(messages, media?)` now returns `{ state, images }`: text stays in `state`; image parts from **user** messages become `data:` URLs, preferring resolved media (`resolveProviderMediaMessages`, so remote media works) and falling back to an inline `data` field; assistant/tool images are not forwarded. `generate()` resolves media once and forwards the same image list, so the capability gate fires before fetch for text-only models. A local base64 payload is not re-encoded.
    - **Path** — `DEFAULT_SYSTEMONE_PATH = "/v1/systemone"`, `normalizeSystemOnePath` (exported), `SystemOneClientOptions.path`, `createSystemOneDecisionProvider` option, `SystemOneProviderConfig.path` + JSON-Schema property (`pattern: "^/"`), and `TypeSafeProviderOptions`/`LayaProviderOptions.path`. Validated at construction (a path without `/` throws `SystemOneError` with status 0) and again in `postSystemOne`. Trailing slashes are trimmed. The plaintext warning still prints the origin only; the path is not secret.
    - **Catalogs** — `decisions: true` added to `DECISION_CAPABILITIES` in both `typesafe` and `laya`; `input` stays `["text"]` per Task 2. Package tests updated for the flag. The adapters receive their catalogs via a new `models` option, so decide-side image gating uses the real capabilities.
    - **Conformance** — `systemOneConformance`'s factory now accepts `{ path }`, and a new decide block covers: raw answers with probabilities/confidence/legend intact and usage/timing mapped; an empty `images` field omitted; images rejected before fetch for a declared text-only model or forwarded for an image-capable/unknown one; a custom path honored and a relative path rejected at construction; 401 and 422 mapped to `DecisionsError("invalid_request")`, not retried, credential redacted; credential resolved exactly once per decide; transport failure wrapped with the key redacted.
    - **Live legs** — `runSystemOneLiveScenarios` gains a `decideTestName` option (typesafe passes `typesafe_live_decide`, laya `laya_live_decide`) and `systemOneScenarioDecide`, which calls all three question types through `decisions()` and asserts no secret in the result. Its string-model config now carries `capabilities.decisions: true`. `executeSystemOneLiveScenarios` runs the same decide leg. Live probes still could not run here (no `TYPESAFE_API_KEY`, no local `laya-serve`), so the score-answer recordings remain uncollected; the gated legs will collect them when the environment has the key/server. `scripts/live-matrix.json` scope/cost now say ~4 requests, and `docs/live-testing.md` was regenerated.
    - **Docs** — `docs/provider-kit.md` (System One section: `decisions()`, `path`, images, catalog gating; conformance sentence; export row), `docs/decisions.md` (System One adapter extension note), both package READMEs ("Behaviour" now leads with `prism.models.decisions(...)`, path config row), and one `CHANGELOG.md` entry.
    - **Tests** — new `src/__tests__/systemone-decide.test.ts` (5: raw probabilities, omitted images/unknown pin, generate image forwarding, text-only rejection before fetch on both paths, custom/invalid path); `systemone-schema.test.ts` updated for `{ state, images }` plus a user-image test; provider-kit and public-export freeze lists gained `DEFAULT_SYSTEMONE_PATH` and `normalizeSystemOnePath`.
    - **Baselines** — `gate --update-baseline` regenerated `arnilo__prism.txt` (+13/−1: the new constants/functions plus the `compileSystemOneState` signature change, which is breaking for kit callers in unreleased 0.13.0; no API-level bump, same treatment as plans 182/183). `arnilo__prism-provider-{typesafe,laya}.txt` are unchanged because their export signatures did not change. `scripts/budgets.json` kernel ceilings rebaselined again: packed 1,115,516 (+4,827), unpacked 3,637,103 (+18,354), rootExports 1,480 (+4), sourceLines 37,841 (+307), fileCount 357, reason recorded. No new dependency.
    - **Verification** — `bun x tsc --noEmit` clean; 346 tests pass across docs/systemone*/packaging and 30 across the two provider packages; release gate passed after the rebaseline.

- [x] Task 5: Endpoint recipes, operating rules, and an offline example
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
  - Notes:
    - **Docs** — `docs/decisions.md` gains "System One endpoints" and "Operating rules", placed after the implementation example. The endpoint section shows the shared package wrapper once (`definePackage` with `capabilities: ["credentials"]`, `refSource` around `prism.credentials.resolve`, because a bare provider snippet has no `prism` in scope and a top-level `refSource` call would read the environment at setup). Each of the seven recipes is then a `createSystemOneDecisionProvider` option block with `baseUrl`, `path`, `keyRef` (an `env:` ref; omitted for the two local servers), and a model-id comment, plus one caveat and one price source. OpenRouter `https://openrouter.ai/api` + `/v1/systemone`; Fastino `https://api.fastino.ai`; Celeris `https://inference.celeris.ai` + `/celeris-1-decision/v1/systemone`; Foundry `https://<resource>.services.ai.azure.com` + `/providers/microsoft/v1/systemone`; TrueFoundry `https://<gateway-host>`; `llama-server` `http://127.0.0.1:8080`; `laya-serve` `http://127.0.0.1:8000`. Every recipe states that setup fetches nothing and that System One replies have no output tokens; the hosted four name per-token input prices and their source, Fastino names its task price (the one non-token model), and the local two name hardware cost. The operating rules are the five required ones with the survey's numbers (Laya ECE 0.466, few hundred labels, Q8_0 or higher).
    - **Example** — `examples/decision-models.ts` (offline, imports only `@arnilo/prism` and `@arnilo/prism/testing`) registers `@acme/decision-router` with `capabilities: ["models"]`. Its `run.input` hook calls `prism.models.decisions({ provider: "mock", model: "demo", capabilities: { decisions: true } })`, asks one `noul`, one `choice`, and one `score` question, prints `{ model, timingMs, answers }` (the raw probabilities), appends a `Route: billing` system message, and then calls a model with `capabilities: { decisions: false }` and asserts `DecisionsError("unsupported_model")`; the demo fails unless the route is `billing` and the error code was observed. The mock provider's `decisions` adapter returns all three answer shapes, so no network or credential is involved.
    - **Wiring** — the demo is in the `docs.test.ts` execution list (so it compiles with the other demos and must exit 0), in `scripts/e2e-coverage.json` under `@arnilo/prism`, and in `examples/README.md` (manual-run list and prose demo list). One `CHANGELOG.md` entry. No new export, package, or kernel file, so no compat-baseline or budget change.
    - **Verification** — `bun examples/decision-models.ts` prints the answers and completes; `bun x tsc --noEmit` clean; `bun test src/__tests__/docs.test.ts` 64/64 pass. The `llama-server` recipe remains doc-based (Task 2 could not install a local decision GGUF), as recorded there.

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
