# Phase 48 — Cache/provider docs, examples, and release validation

## Objectives
- Make cache behavior and NeuralWatt integration usable from docs alone: README/provider table, per-provider cache caveats, two runnable network-free examples, and release checks that fail if the NeuralWatt package or cache docs go missing.
- Add no new core contracts, no new JS package, no new runtime behavior. All work is docs, examples, and tests extending existing release gates.
- Keep every example network-free and secret-free (mocked `fetch`/SSE or the built-in `mock` provider); every docs example is typechecked by `npm run typecheck` and run-to-completion-checked by the default suite.
- Pin release validation: tarball/export checks for `@arnilo/prism-provider-neuralwatt`, aggregator hard-dependency membership, `docs/` links + navigation, and type-declaration presence all enforced by `npm test`.

## Expected Outcome
- `README.md` package table lists OpenAI, OpenCode Go, OpenRouter, Z.AI, Kimi, and NeuralWatt with a per-provider cache support summary; umbrella counts (`prism-providers`, `prism-all`, "first-party workspace packages") reflect six provider adapters.
- `/docs/provider-caching.md`, `/docs/providers/neuralwatt.md`, `/docs/provider-packages.md`, and `/docs/index.md` document cache behavior per provider with explicit caveats distinguishing explicit-cache providers (OpenAI/OpenRouter) from NeuralWatt implicit prefix caching, and never promise cache hits.
- Two new example files in `examples/`: (a) cache-aware prompt assembly + cache hit-rate reporting across at least one explicit-cache provider and NeuralWatt, and (b) a NeuralWatt agent run with tools, reasoning controls, streamed usage, cache tokens, and energy/cost telemetry using mocked responses. Both are listed in `examples/README.md`, typechecked, and run-to-completion-checked.
- `src/__tests__/packaging.test.ts` and `src/__tests__/docs.test.ts` enforce that the NeuralWatt package, its type declarations, the cache docs, and the example files are present and linked; `npm run release:dry-run` fails if any are missing.

## Tasks

- [ ] Primitive review: inventory cache diagnostics, NeuralWatt package exports, example harness patterns, and release test gates before any docs/examples are written
  - Acceptance Criteria:
    - Functional: Record whether `cacheHitRate`/`cacheSavings`/`cacheUsageReport`, `ModelCacheCapabilities` (`kind: "explicit" | "implicit"`), `InputAssemblyLayout: "cache_aware"`, the NeuralWatt package's public exports (`createNeuralWattProviderPackage`, model metadata, telemetry/retry/quota helpers), the existing example harness pattern (mocked `fetch`/SSE or `createMockProvider`), and the existing release gates (`packaging.test.ts` package list, `docs.test.ts` `providerPackagePages`/`examples_files_exist_and_index_links_examples`/`examples_demos_run_to_completion_and_emit_no_secret`) already cover Phase 48; identify the exact edits each later task needs.
    - Performance: Confirm planned changes add no runtime code, no new network calls, no tokenization/hashing; examples reuse existing mocked-`fetch` fixtures and `createMockProvider`.
    - Code Quality: Reject any new core contract field or new runtime branch; examples must call only public package exports and existing test helpers; docs must not duplicate provider source-of-truth beyond a stable summary.
    - Security: Confirm no new trust boundary; examples use fake keys and mocked transport only; no example prints a real-looking secret; `redactSecrets()` coverage is unchanged.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 48 deliverables + acceptance.
      - `plans/043-prompt-cache-primitives-and-provider-capability-metadata.md`, `plans/044-cache-aware-input-ordering-and-diagnostics.md`, `plans/045-first-party-provider-cache-behavior-hardening.md`, `plans/046-NeuralWatt-first-party-provider-package.md`, `plans/047-NeuralWatt-model-discovery-pricing-energy-and-retry-semantics.md`, `plans/048-NeuralWatt-cache-reasoning-and-agentic-workload-validation.md` inventory findings (cache seams, telemetry, retry, reasoning, tool loop).
      - `.agents/skills/create-plan/references/prism-wiki.md` doc structure.
      - `docs/provider-caching.md`, `docs/providers/neuralwatt.md`, `docs/provider-packages.md`, `docs/release-and-install.md`, `docs/index.md`.
      - `src/__tests__/packaging.test.ts`, `src/__tests__/docs.test.ts` (current release/example gates).
      - `examples/README.md` and existing demo examples (`external-app-db-backed.ts`, `compaction.ts`, `provider-registration.ts`) for the harness pattern.
    - Options Considered:
      - Add new runtime helpers to support cache hit-rate reporting in examples: rejected; `cacheHitRate`/`cacheSavings`/`cacheUsageReport` already exist in `src/cache-helpers.ts`.
      - Build a live NeuralWatt demo: rejected; roadmap requires network-free mocked responses.
      - Reuse the existing mocked-`fetch` SSE fixture pattern from `packages/provider-neuralwatt/src/__tests__`: chosen; keeps examples runnable without network and consistent with package tests.
    - Chosen Approach:
      - Inventory first; record the exact doc/test/example edits each task needs. Implement only docs, examples, and test/gate extensions unless inventory reveals a broken public seam (none expected).
    - API Notes and Examples:
      ```ts
      // Cache diagnostics already public (src/cache-helpers.ts, re-exported via src/index.ts):
      // cacheHitRate(usage), cacheSavings(usage, model), cacheUsageReport(usage, model)
      // ModelConfig.cache: ModelCacheCapabilities { kind: "explicit" | "implicit"; ... }
      // InputAssemblyLayout = "legacy" | "cache_aware"  (set via inputLayout)
      ```
    - Files to Create/Edit:
      - `plans/049-Cache-provider-docs-examples-and-release-validation.md`: record inventory findings during execution.
      - Runtime/source files: none in this task unless inventory reveals a broken public seam.
    - References:
      - `src/cache-helpers.ts`, `src/contracts.ts` (`ModelCacheCapabilities`, `Usage`, `InputAssemblyLayout`), `src/input.ts`.
      - `packages/provider-neuralwatt/src/index.ts`, `packages/provider-neuralwatt/src/{provider,models,telemetry,retry,thinking}.ts`, `packages/provider-neuralwatt/src/__tests__/` for the mocked-SSE fixture pattern.
      - `src/__tests__/packaging.test.ts`, `src/__tests__/docs.test.ts`.
  - Test Cases to Write:
    - Inventory assertion: every Phase 48 deliverable maps to an existing public seam or a documented docs/example/test edit; no core contract edit is required.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — inventory only.
    - Docs pages to create/edit:
      - `none`: inventory task; findings recorded in this plan.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Update README provider table and umbrella counts with NeuralWatt and a cache support summary
  - Acceptance Criteria:
    - Functional: `README.md` package table lists `@arnilo/prism-provider-neuralwatt` alongside OpenAI, OpenCode Go, OpenRouter, ZAI, and Kimi, and the First-party packages paragraph lists all six provider names; a cache support summary distinguishes explicit-cache providers (OpenAI, OpenRouter) from NeuralWatt implicit prefix caching and states cache hints are best-effort with no guaranteed hits.
    - Performance: Doc-only; no runtime impact.
    - Code Quality: Table stays data-only and aligned with `packages/prism-providers/package.json` dependencies and `docs/providers/*.md`; no stale "all 5" wording remains.
    - Security: No real-looking secrets in README (enforced by existing `readme_has_no_real_looking_secrets` test).
  - Approach:
    - Documentation Reviewed:
      - `README.md` current Packages table + First-party packages paragraph + Install section.
      - `packages/prism-providers/package.json` (six `@arnilo/prism-provider-*` dependencies).
      - `docs/providers/neuralwatt.md`, `docs/provider-caching.md` for the cache behavior summary wording.
    - Options Considered:
      - Inline a full per-provider cache matrix in README: rejected; too much detail for a top-level README, keep a one-line summary and link `docs/provider-caching.md`.
      - One-line summary + link: chosen; keeps README stable and points readers to the canonical caching page.
    - Chosen Approach:
      - Add the NeuralWatt row to the Packages table; update the First-party packages paragraph to list six providers; update the `@arnilo/prism-providers` row from "all 5 provider adapters" to "all 6 provider adapters"; add a short "Cache support" line in the Providers and models bullet linking `docs/provider-caching.md`.
    - API Notes and Examples:
      ```markdown
      | `@arnilo/prism-provider-neuralwatt` | NeuralWatt provider with implicit vLLM prefix caching |
      ```
    - Files to Create/Edit:
      - `README.md`: add NeuralWatt table row, update First-party packages paragraph and umbrella counts, add cache support summary link.
    - References:
      - `docs/provider-caching.md`, `docs/providers/neuralwatt.md`, `packages/prism-providers/package.json`.
  - Test Cases to Write:
    - Extend `src/__tests__/docs.test.ts` `readme_describes_current_runtime_provider_packages_cli_and_examples` to assert `@arnilo/prism-provider-neuralwatt` is mentioned in README.
    - New assertion: README contains a cache support summary link to `provider-caching.md` and the phrase "best-effort" (or equivalent) with no "guaranteed cache hit" wording.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — README documents the public provider package set and cache behavior summary.
    - Docs pages to create/edit:
      - `README.md`: add NeuralWatt row + cache support summary (this task).
      - `docs/release-and-install.md`: umbrella/first-party counts (covered in the release-validation task to keep counts in one place).
    - `docs/index.md` update: no (README is not in the docs index).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Document per-provider cache behavior with explicit/implicit caveats across caching, NeuralWatt, and provider-packages pages
  - Acceptance Criteria:
    - Functional: `/docs/provider-caching.md` carries a per-provider cache behavior table or section covering OpenAI, OpenRouter, OpenCode Go, Z.AI, Kimi, and NeuralWatt, with explicit caveats: explicit-cache providers accept `cache_control`/breakpoints, NeuralWatt uses implicit vLLM prefix caching with no cache-control payload and requires full prior history for multi-turn reuse, and no provider guarantees cache hits.
    - Performance: Doc-only; no runtime impact.
    - Code Quality: Pages follow the prism-wiki API page structure where applicable; cross-link `provider-caching.md` ↔ `providers/neuralwatt.md` ↔ `provider-packages.md`; no cache-hit guarantees anywhere (enforced by existing `phase47` no-cache-hit-phrase assertion, extended to these edits).
    - Security: Reaffirm cache keys are never credentials and provider-owned auth/session/security headers always win over caller headers (already present; do not regress).
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-caching.md` (existing implicit/explicit coverage, `cacheHitRate`/`cacheSavings`/`cacheUsageReport`, safety wording).
      - `docs/providers/neuralwatt.md` (implicit prefix caching, cache-aware limiter, `cached_tokens`, `cacheRetention: "none"`).
      - `docs/provider-packages.md` (first-party cache behavior summary section).
      - `docs/providers/openrouter.md`, `docs/providers/openai.md` for explicit-cache wording.
    - Options Considered:
      - Duplicate the full matrix on every provider page: rejected; drift risk.
      - Single canonical matrix in `provider-caching.md` with per-provider pages linking to it: chosen; one source of truth.
    - Chosen Approach:
      - Add/refresh a "Per-provider cache behavior" section in `provider-caching.md` with a compact table (provider → cache kind → accepts explicit hints → multi-turn reuse notes → caveats); ensure `providers/neuralwatt.md` links to it and restates the implicit-cache caveats; ensure `provider-packages.md` first-party cache summary matches.
    - API Notes and Examples:
      ```markdown
      | Provider | Cache kind | Explicit hints | Multi-turn reuse | Caveat |
      |---|---|---|---|---|
      | OpenAI / OpenRouter | explicit | yes (`cache_control`) | breakpoint-stable prefix | best-effort, no guaranteed hits |
      | NeuralWatt | implicit vLLM prefix | no payload | full prior history | no cache-control payload; no guaranteed hits |
      ```
    - Files to Create/Edit:
      - `docs/provider-caching.md`: add/refresh per-provider cache behavior section.
      - `docs/providers/neuralwatt.md`: ensure implicit-cache caveats present and link to `provider-caching.md`.
      - `docs/provider-packages.md`: align first-party cache behavior summary with the matrix.
    - References:
      - `docs/provider-caching.md`, `docs/providers/neuralwatt.md`, `docs/providers/openrouter.md`, `docs/providers/openai.md`, `docs/provider-packages.md`.
  - Test Cases to Write:
    - Extend `src/__tests__/docs.test.ts` `phase47` test (or add a `phase48` test) asserting `provider-caching.md` contains a per-provider cache table covering all six provider names plus the words "explicit", "implicit", "no cache-control payload" (for NeuralWatt), and "best-effort"/no guaranteed hits.
    - Assert `provider-packages.md` first-party cache summary mentions all six providers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents public provider cache behavior and caveats.
    - Docs pages to create/edit:
      - `docs/provider-caching.md`: per-provider cache behavior section.
      - `docs/providers/neuralwatt.md`: implicit-cache caveats + cross-link.
      - `docs/provider-packages.md`: first-party cache summary alignment.
    - `docs/index.md` update: yes — ensure the Provider caching and Provider packages index entries mention the per-provider cache matrix and NeuralWatt (refresh descriptions if needed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Add cache-aware prompt assembly + cache hit-rate reporting example across an explicit-cache provider and NeuralWatt
  - Acceptance Criteria:
    - Functional: New `examples/cache-aware-prompt-assembly.ts` demo assembles prompts with `inputLayout: "cache_aware"` and reports cache hit-rate across at least two providers: one explicit-cache provider (OpenRouter or OpenAI) and NeuralWatt implicit prefix caching, using mocked `fetch`/SSE responses; prints a single JSON line with per-provider `cacheReadTokens`/`cacheHitRate`/`cacheSavings` derived via the public `cacheUsageReport`/`cacheHitRate`/`cacheSavings` helpers.
    - Performance: Network-free; runs in <1s with mocked transport; no tokenization.
    - Code Quality: Uses only public exports from `@arnilo/prism` and the first-party provider packages; reuses the package mocked-SSE fixture pattern; typechecks under `examples/tsconfig.json` (strict, noEmit).
    - Security: Fake keys only; no real-looking secrets in source or output (enforced by `examples_demos_run_to_completion_and_emit_no_secret`).
  - Approach:
    - Documentation Reviewed:
      - `examples/external-app-db-backed.ts`, `examples/compaction.ts`, `examples/provider-registration.ts` for the demo harness pattern (`main()` prints one JSON line).
      - `packages/provider-neuralwatt/src/__tests__/` for the mocked-SSE fixture shape (`data:` lines, `usage.prompt_tokens_details.cached_tokens`).
      - `packages/provider-openrouter/src/__tests__/` for explicit-cache `cache_control` request assertion shape.
      - `src/cache-helpers.ts` for `cacheHitRate`/`cacheSavings`/`cacheUsageReport` signatures.
      - `docs/provider-caching.md`, `docs/input-and-prompt-assembly.md` for `inputLayout: "cache_aware"`.
    - Options Considered:
      - Use `createMockProvider` for both providers: rejected; mock provider does not emit `cached_tokens` or exercise cache-aware ordering against a real payload shape, so it would not demonstrate hit-rate reporting meaningfully.
      - Use the provider packages with mocked `fetch`/SSE fixtures: chosen; demonstrates real payload → `Usage.cacheReadTokens` → diagnostics end to end while staying network-free.
    - Chosen Approach:
      - One demo file with a `main()`; register two provider packages with stubbed credential resolvers; install a global `fetch` mock returning canned SSE streams including `usage.prompt_tokens_details.cached_tokens` (NeuralWatt) and explicit-cache usage (OpenRouter); run two turns with `inputLayout: "cache_aware"`; print `{provider, cacheReadTokens, cacheHitRate, cacheSavings}` per provider as one JSON line.
    - API Notes and Examples:
      ```ts
      import { cacheHitRate, cacheSavings, cacheUsageReport } from "@arnilo/prism";
      // after a run, record.usage carries cacheReadTokens/cacheWriteTokens
      const report = cacheUsageReport(record.usage, model); // {cacheReadTokens, cacheHitRate, cacheSavings}
      ```
    - Files to Create/Edit:
      - `examples/cache-aware-prompt-assembly.ts`: new demo.
      - `examples/README.md`: list the new file under Files and the run command.
    - References:
      - `examples/external-app-db-backed.ts`, `examples/compaction.ts`, `src/cache-helpers.ts`, `docs/provider-caching.md`.
  - Test Cases to Write:
    - Extend `src/__tests__/docs.test.ts` `examples_files_exist_and_index_links_examples` to include `examples/cache-aware-prompt-assembly.ts`.
    - Add the file to `examples_demos_run_to_completion_and_emit_no_secret` demos list.
    - New assertion: the example source references `cacheHitRate`/`cacheSavings`/`cacheUsageReport`, `inputLayout: "cache_aware"`, both an explicit-cache provider and NeuralWatt, and prints a JSON line containing `cacheHitRate`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public example exercising public cache diagnostics and provider cache behavior.
    - Docs pages to create/edit:
      - `examples/README.md`: list the new demo + run command.
      - `docs/provider-caching.md`: link the example under the Implementation example / Related APIs section.
    - `docs/index.md` update: yes — ensure the examples entry references cache-aware prompt assembly (refresh the examples mention if needed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Add NeuralWatt agent run example with tools, reasoning controls, streamed usage, cache tokens, and energy/cost telemetry (mocked)
  - Acceptance Criteria:
    - Functional: New `examples/neuralwatt-agent-run.ts` demo runs a NeuralWatt agent turn that includes at least one tool call and tool result, passes reasoning controls (`reasoning_effort`, `thinking_token_budget`, `enable_thinking`, `preserve_thinking`, `clear_thinking`) via `compat`/`extra`, consumes the streamed `AgentEvent` stream, and reports `usage.prompt_tokens_details.cached_tokens` mapped to `Usage.cacheReadTokens` plus energy/cost telemetry from `ModelCost`/NeuralWatt telemetry helpers — all via mocked `fetch`/SSE with no network.
    - Performance: Network-free; runs in <1s; no real provider calls.
    - Code Quality: Uses only public exports from `@arnilo/prism` and `@arnilo/prism-provider-neuralwatt`; reuses the package mocked-SSE fixture pattern; typechecks under `examples/tsconfig.json`.
    - Security: Fake keys only; reasoning preservation does not echo secrets beyond the caller's own input; no real-looking secrets in source or output.
  - Approach:
    - Documentation Reviewed:
      - `examples/external-app-db-backed.ts`, `examples/synapta-style-artifact-loop.ts` for the tool-call + event-stream demo pattern.
      - `packages/provider-neuralwatt/src/__tests__/` for the tool-call SSE fixture, reasoning-control pass-through, and `cached_tokens`/telemetry assertions.
      - `docs/providers/neuralwatt.md` for the documented reasoning controls and telemetry fields.
      - `packages/provider-neuralwatt/src/{thinking,telemetry,models}.ts` for public helper names.
    - Options Considered:
      - Split into two demos (tools vs telemetry): rejected; roadmap asks for one NeuralWatt agent run combining all surfaces.
      - One combined demo: chosen; matches the roadmap deliverable and keeps the example list lean.
    - Chosen Approach:
      - One demo file with a `main()`; register the NeuralWatt provider package with a stubbed credential resolver; install a global `fetch` mock returning a canned SSE stream that emits a reasoning block, a tool-call delta, a tool result turn, and final `usage` with `cached_tokens`; run the agent with the reasoning controls set via `compat`/`extra` and a host-owned tool; print one JSON line with `{cacheReadTokens, toolCalls, reasoningEffort, energyKwh, costUsd}` derived from public telemetry/`ModelCost` helpers.
    - API Notes and Examples:
      ```ts
      import { createNeuralWattProviderPackage } from "@arnilo/prism-provider-neuralwatt";
      // reasoning controls ride through compat/extra; usage.cacheReadTokens is populated by the provider.
      ```
    - Files to Create/Edit:
      - `examples/neuralwatt-agent-run.ts`: new demo.
      - `examples/README.md`: list the new file under Files and the run command.
    - References:
      - `examples/external-app-db-backed.ts`, `packages/provider-neuralwatt/src/__tests__/`, `docs/providers/neuralwatt.md`.
  - Test Cases to Write:
    - Extend `src/__tests__/docs.test.ts` `examples_files_exist_and_index_links_examples` to include `examples/neuralwatt-agent-run.ts`.
    - Add the file to `examples_demos_run_to_completion_and_emit_no_secret` demos list.
    - New assertion: the example source references `createNeuralWattProviderPackage`, at least three reasoning controls, a tool call + tool result, `cacheReadTokens`/`cached_tokens`, and an energy/cost telemetry field.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public example exercising public NeuralWatt provider behavior.
    - Docs pages to create/edit:
      - `examples/README.md`: list the new demo + run command.
      - `docs/providers/neuralwatt.md`: link the example under the Implementation example / Related APIs section.
    - `docs/index.md` update: yes — ensure the NeuralWatt provider index entry / examples entry references the runnable demo.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Extend release validation gates: NeuralWatt package exports/type declarations, aggregator membership, docs links, and example presence
  - Acceptance Criteria:
    - Functional: `npm test` (and therefore `npm run release:dry-run`) fails if `@arnilo/prism-provider-neuralwatt` is missing from `packaging.test.ts` package list, if its `exports` targets (`.d.ts` + `.js`) are missing from the pack, if `@arnilo/prism-providers`/`@arnilo/prism-all` umbrella hard-dependencies drop NeuralWatt, if `docs/providers/neuralwatt.md` or `docs/provider-caching.md` is unlinked from `docs/index.md`, or if the two new example files are missing/unlisted.
    - Performance: Gates run as part of the existing network-free suite; `npm pack --dry-run` caching in `packaging.test.ts` is preserved (no extra packs per assertion).
    - Code Quality: Reuse the data-driven `packaging.test.ts` package list and `docs.test.ts` patterns; no new test framework; assertions are additive.
    - Security: No new trust boundary; gates do not read real keys or network.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/packaging.test.ts` (data-driven package list, exports-target-in-pack check, umbrella hard-dependency check — NeuralWatt already present in the list and umbrella map).
      - `src/__tests__/docs.test.ts` (`providerPackagePages` already includes `providers/neuralwatt.md`; `examples_files_exist_and_index_links_examples`, `examples_demos_run_to_completion_and_emit_no_secret`, `release_checklist_maps_each_gate_to_its_enforcement_test`).
      - `docs/release-and-install.md` (Release checklist section, "seven first-party workspace packages" / "all 5 provider-* packages" wording to update to six providers).
      - `packages/provider-neuralwatt/package.json` (`exports`, `types`, `files`).
    - Options Considered:
      - Add a separate `phase48-release.test.ts`: rejected; scatters release gates; prefer extending the two existing gate files.
      - Extend `packaging.test.ts` + `docs.test.ts` and update the release-checklist doc: chosen; keeps all release gates in the canonical files and the checklist accurate.
    - Chosen Approach:
      - Confirm/keep NeuralWatt in the `packaging.test.ts` package list and umbrella expected map (already present); add an explicit assertion that the NeuralWatt pack includes `dist/index.d.ts` (type declarations) alongside `dist/index.js`; add a `docs.test.ts` assertion that `docs/index.md` links both `providers/neuralwatt.md` and `provider-caching.md` and that the two new example files exist + are listed in `examples/README.md`; update `docs/release-and-install.md` counts ("seven first-party workspace packages" → eight including NeuralWatt, "all 5 provider-*" → all 6) and the Release checklist to name the NeuralWatt + cache-docs gate.
    - API Notes and Examples:
      ```ts
      // packaging.test.ts: NeuralWatt already in `packages` list; add per-package
      // type-declaration check: for non-meta, non-core packages, assert a .d.ts
      // exists in the pack for every exports "types" target (already covered by the
      // "ships every exports target as compiled output" loop — confirm it asserts
      // the .d.ts, then add a dedicated NeuralWatt presence assertion for clarity).
      ```
    - Files to Create/Edit:
      - `src/__tests__/packaging.test.ts`: confirm NeuralWatt present + add a NeuralWatt-specific type-declaration presence assertion (if not already implied by the exports-target loop).
      - `src/__tests__/docs.test.ts`: add Phase 48 assertions (index links neuralwatt + caching, example files exist + listed in `examples/README.md`, README NeuralWatt mention, per-provider cache matrix).
      - `docs/release-and-install.md`: update first-party/umbrella counts and the Release checklist to name the NeuralWatt package + cache docs gate.
    - References:
      - `src/__tests__/packaging.test.ts`, `src/__tests__/docs.test.ts`, `docs/release-and-install.md`, `packages/provider-neuralwatt/package.json`.
  - Test Cases to Write:
    - `packaging.test.ts`: NeuralWatt pack includes `dist/index.d.ts`; umbrella deps include NeuralWatt (already asserted — keep green).
    - `docs.test.ts`: `docs/index.md` links `providers/neuralwatt.md` and `provider-caching.md`; both new example files exist and are listed in `examples/README.md`; `docs/release-and-install.md` Release checklist names the NeuralWatt + cache-docs gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release gates and the release-checklist doc are public release surfaces.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: update counts + Release checklist gate row.
    - `docs/index.md` update: yes — ensure release-and-install entry description still fits; ensure Provider caching + NeuralWatt entries are linked (asserted by the new gate).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Final verification: full network-free suite, release dry-run, typecheck, and docs/index navigation sweep
  - Acceptance Criteria:
    - Functional: `npm run typecheck`, `npm test`, and `npm run release:dry-run` all pass; `docs/index.md` links resolve; both new examples run to completion emitting no secret; README and docs contain no cache-hit guarantees.
    - Performance: Default suite stays network-free; no regression in offline test budget documented in `docs/release-and-install.md`.
    - Code Quality: No new core contract changes introduced across the phase; `npm ls --all --depth=0` exits 0.
    - Security: No real-looking secrets in README, docs, or example output.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` offline test budget + release checklist.
      - `src/__tests__/packaging.test.ts` `npm ls` gate.
    - Options Considered:
      - Manual ad-hoc checks: rejected; non-repeatable.
      - Run the canonical commands and assert green: chosen.
    - Chosen Approach:
      - Run `npm run typecheck`, `npm test`, `npm run release:dry-run`; fix any drift found (doc links, example output, count wording); record results in Compromises/Further Actions.
    - API Notes and Examples:
      ```bash
      npm run typecheck && npm test && npm run release:dry-run
      ```
    - Files to Create/Edit:
      - `plans/049-Cache-provider-docs-examples-and-release-validation.md`: fill Compromises Made + Further Actions.
      - Any drift files surfaced by the verification run.
    - References:
      - `docs/release-and-install.md`, `package.json` scripts.
  - Test Cases to Write:
    - Verification: the three commands above exit 0; `docs/index.md` link-resolution test passes; `examples_demos_run_to_completion_and_emit_no_secret` passes for both new demos.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit:
      - `none`: verification task; drift fixes recorded in Compromises Made.
    - `docs/index.md` update: no (unless a broken link is found, fixed in-place).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
