# Release 0.1.5 — Deprecated-option removal (breaking, documented)

Roadmap phase: `roadmap.md` § **0.1.5 — Deprecated-option removal (breaking, documented)**.
Baseline: `@arnilo/prism` **0.1.4** (signed tag `v0.1.4`; plan 016 exit gate green; 49 publishable manifests; audit 0 at moderate; compat baselines current).
Target: `@arnilo/prism` **0.1.5**, the documented breaking cut.

Source review corrects three stale roadmap labels before implementation:

- `maxToolRounds` deprecated alias lives on `RunOptions`, not `AgentConfig`; `AgentConfig.limits.maxToolRounds` and `RunOptions.limits.maxToolRounds` remain supported.
- `ReadToolOptions.autoResizeImages` is deprecated; `transformImage` is its supported replacement and remains.
- `INIT_PROVIDERS` is deprecated; `listInitProviders()` is its supported replacement and remains.

The observational-memory removal covers its complete pre-0.0.19 compatibility layer: flat settings keys plus top-level `workerProvider` / `workerModel` aliases on create/runtime options. Shared top-level settings without nested replacements (`agentMaxTurns`, `passive`, `debugLog`) remain.

## Objectives

- Remove every currently documented deprecated option/alias from emitted declarations and implementation paths.
- Preserve supported replacements: abort signals/runtime retry, nested run limits, nested observational-memory settings/workers, `transformImage`, and `listInitProviders()`.
- Reject behavior-affecting legacy JavaScript/config inputs with migration-directed errors instead of silently widening limits or applying defaults.
- Document every break and replacement in `docs/migration.md`, then intentionally regenerate affected compat baselines.
- Ship no new package, dependency, persistence shape, event, protocol, network path, or capability.

## Non-goals

- Removing similarly named active options in workflows, browser, process, policy, credentials, work tools, or provider-specific transports.
- Removing `RunLimits.maxToolRounds`, `LoopContext.maxToolRounds`, CLI `--max-tool-rounds`, `transformImage`, `listInitProviders()`, or observational-memory nested settings.
- General dead-export cleanup beyond the roadmap’s deprecated surface.
- Primitive review: this release removes compatibility aliases; it adds no editor/language mode, package, extension point, or reusable capability.
- Final code-wiki task: `.agents/skills/project-wiki/` does not exist.

## Expected Outcome

- Root declarations omit `ProviderRequestOptions.timeoutMs`, `maxRetries`, `maxRetryDelayMs`, and `RunOptions.maxToolRounds`.
- `@arnilo/prism-compaction-observational-memory` accepts only nested worker/settings configuration; removed flat/top-level aliases fail with replacement-directed errors when received from untyped JavaScript or settings data.
- `@arnilo/prism-coding-agent` omits `ReadToolOptions.autoResizeImages`; untyped use fails before filesystem access, while `transformImage` behavior stays unchanged.
- `src/cli-init.ts` no longer exports `INIT_PROVIDERS`; internal tests and consumers use `listInitProviders()`.
- `docs/migration.md` contains an exact 0.1.4 → 0.1.5 removal/replacement table. A reviewed `--allow-break` gate passes before affected baselines are regenerated; normal `sdk:ready` passes afterward.
- Store/event/protocol compatibility remains unchanged; package graph remains 49 manifests with zero new dependencies.

## Tasks

- [x] Task 0 — Freeze corrected removal contract and 0.1.4 baseline
  - Acceptance Criteria:
    - Functional: create `scripts/phase17-freeze-manifest.json` with target 0.1.5, baseline 0.1.4, type `deprecated-option-removal`, exact removed/preserved lists, allowed files, forbidden scope, empty deviations, and task tokens. Exact removals are:
      - `ProviderRequestOptions.timeoutMs`, `ProviderRequestOptions.maxRetries`, `ProviderRequestOptions.maxRetryDelayMs`.
      - `RunOptions.maxToolRounds` (not `AgentConfig.maxToolRounds`).
      - Observational-memory flat settings: `observeAfterTokens`, `reflectAfterTokens`, `compactAfterTokens`, `keepRecentEntries`, `recentMessageMaxTokens`, `observationsPoolMaxTokens`, `observationsPoolTargetTokens`, `workerModel`, `thinkingLevel`, `requireExplicitModel`.
      - Observational-memory top-level worker aliases: `CreateObservationalMemoryOptions.workerProvider` / `.workerModel` and `ObservationalMemoryRuntimeOptions.workerProvider` / `.workerModel`.
      - `ReadToolOptions.autoResizeImages` (not `transformImage`).
      - `INIT_PROVIDERS` (not `listInitProviders`).
    - Functional: create `scripts/phase17-baseline.json` recording 0.1.4 test/audit/release-gate status, 49-manifest graph, relevant declaration snippets/hashes, and the current `@deprecated` inventory from `src/` plus affected packages.
    - Functional: `scripts/phase17-freeze.test.mjs`, wired after phase 16 in root `npm test`, validates manifest schema, corrected roadmap labels, exact replacement map, baseline recency, and—once task tokens move to done—source/declaration absence plus preserved replacements. It must inspect declaration bodies directly because `scripts/release-gates.mjs` normalizes interface signatures only to the opening brace and cannot alone detect removed interface members.
    - Performance: freeze adds one stdlib-only test under 5 seconds; no benchmark or runtime hot path changes.
    - Code Quality: reuse phase-16 freeze/baseline JSON shape and Node test conventions; no new framework or helper package.
    - Security: freeze requires refusal tests for legacy run limits, observational-memory settings, and image flags so removed inputs cannot silently change bounded behavior.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.1.5, §Versioning Policy, §Priority and Dependency Rules, §Release Validation Checklist.
      - `scripts/phase16-freeze-manifest.json`, `scripts/phase16-freeze.test.mjs`, `scripts/phase16-baseline.json`.
      - `scripts/release-gates.mjs` (`extractDeclaredSurface`, `diffSurface`, `--allow-break` behavior and interface-member blind spot).
      - Current `@deprecated` declarations in `src/contracts-core.ts`, `src/contracts-protocol.ts`, `src/cli-init.ts`, `packages/coding-agent/src/read.ts`, and observational-memory `settings.ts` / `compose.ts` / `runtime.ts`.
    - Options Considered:
      - Follow roadmap names literally: rejected because that would remove supported replacements (`transformImage`, `listInitProviders`) and miss the real `RunOptions` alias.
      - Freeze actual source annotations and documented migrations: chosen; smallest correct breaking contract.
      - Depend only on existing compat gate: rejected because interface body removals are not represented in its normalized signatures.
    - Chosen Approach:
      - Freeze exact removals and replacements before implementation. Add one direct declaration/source tripwire beside existing compat gates rather than changing generic release-gate parsing during a breaking release.
    - API Notes and Examples:
      ```bash
      rg -n '@deprecated' src packages/compaction-observational-memory packages/coding-agent/src/read.ts
      node --test scripts/phase17-freeze.test.mjs
      node scripts/release.mjs gate --version 0.1.4
      ```
    - Files to Create/Edit:
      - `scripts/phase17-freeze-manifest.json`: exact breaking-surface scope gate.
      - `scripts/phase17-freeze.test.mjs`: freeze and direct declaration tripwires.
      - `scripts/phase17-baseline.json`: 0.1.4 pre-removal evidence.
      - `package.json`: append phase-17 freeze test to `npm test`.
    - References:
      - `plans/016-Release-0-1-4-God-Module-Split.md` Task 0 and exit gate.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - corrected roadmap names: freeze keeps `transformImage`, `listInitProviders`, and nested `limits.maxToolRounds` while removing their actual aliases.
    - exact deprecated inventory: every current runtime-source `@deprecated` marker is either listed for removal or explicitly preserved with rationale.
    - declaration-body scanner: fails if a removed property remains in built `.d.ts`, independent of generic compat-gate output.
    - baseline coherence: 0.1.4, 49 manifests, audit 0, release gate green, and phase-16 exit gate green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no—freeze/evidence only; later tasks perform breaks.
    - Docs pages to create/edit: `none` (internal release evidence).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.
  - Task 0 evidence (2026-08-10): `scripts/phase17-freeze-manifest.json` (release 0.1.5, line 0.1.x, type deprecated-option-removal, baseline 0.1.4, removalFreeze with 20 exact removals + 20 preserved symbols + 3 corrected roadmap labels + allowed/forbidden lists + empty deviations, documented-breaking compat flow, task tokens) and `scripts/phase17-baseline.json` (captured at HEAD 9a79a6e: npm test exit 0 core 1426/1426 script gates 153/153 workspaces green; audit 0 moderate; release:gate 0.1.4 green 49 packages 0 breaking deltas; 49 publishable manifests 14 provider + 9 prism + 25 capability; deprecatedInventory 20 entries with verified line numbers; preservedSurface 20 entries; fileHashes sha256 of the 7 affected source files + 3 baselines; exitGate null) landed. `scripts/phase17-freeze.test.mjs` (18 tests) wired after phase16 in `npm test` and green standalone + in the full suite; it carries the per-task removal state machine (pending → symbols present at recorded lines, done → absent from owner scope while preserved surface stays) and the direct owner-scoped declaration scan (release:gate normalizes interface signatures to the opening brace only).

- [x] Task 1 — Remove root provider and run-option aliases
  - Acceptance Criteria:
    - Functional: remove `timeoutMs`, `maxRetries`, and `maxRetryDelayMs` from `ProviderRequestOptions`; supported timeout/retry paths remain `ProviderRequest.signal` / `RunOptions.signal` and `AgentConfig.retry` / `RunOptions.retry`.
    - Functional: remove `RunOptions.maxToolRounds`; runtime resolves only `options.limits`, and untyped legacy `{ maxToolRounds }` run input fails before session mutation/provider/tool execution with a message naming `limits.maxToolRounds`.
    - Functional: migrate all first-party callers, examples, tests, CLI/RPC mapping, and optional packages from run-level `{ maxToolRounds: n }` to `{ limits: { maxToolRounds: n } }`. CLI `--max-tool-rounds` remains and maps to the nested limit. Existing `RunLimits`, loop-context, provider-specific, workflow, browser, process, policy, and retry fields with the same names remain untouched.
    - Functional: built root declarations contain none of the four removed members; compile-time negative assertions fail if any alias returns. Existing runtime limit tests prove nested limits retain narrowing, hard-cap validation, tool-round enforcement, and durable resume behavior.
    - Performance: no provider-side retry/timeout loop is added; run-limit resolution remains one bounded object validation per run; benchmark medians remain within frozen ceilings.
    - Code Quality: delete alias-merging code from `agent-session.ts`; use existing `resolveRunLimits` directly; no replacement abstraction.
    - Security: legacy untyped `RunOptions.maxToolRounds` is rejected rather than ignored, preventing accidental fallback to a wider default. Abort/retry and hard run-limit checks remain fail-closed.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core.ts` `ProviderRequestOptions` and `src/contracts-protocol.ts` `RunOptions`.
      - `src/agent-session.ts` legacy max-tool-round merge; `src/run-limits.ts` supported nested resolver.
      - `src/cli-runner.ts` CLI mapping; `src/rpc.ts`; `packages/supervisor/src/supervisor.ts`.
      - `docs/provider-layer.md`, `provider-packages.md`, `provider-conformance.md`, `provider-primitives.md`, `public-contracts.md`, `agent-loops.md`, `tools.md`, `runs-and-usage.md`.
    - Options Considered:
      - Type-only removal and silently ignore legacy JavaScript: rejected for `RunOptions.maxToolRounds`; it can widen an intended tool limit.
      - Keep a hidden alias normalizer: rejected; milestone requires removal.
      - Local refusal guard plus direct nested resolver: chosen.
    - Chosen Approach:
      - Remove declaration fields. Add one early own-property refusal in run entry, delete alias-to-limit merge, migrate repository callers to nested limits, and leave unrelated active timeout/retry/max-round fields unchanged.
    - API Notes and Examples:
      ```ts
      // 0.1.4
      await session.run(input, { maxToolRounds: 2 });
      // 0.1.5
      await session.run(input, { limits: { maxToolRounds: 2 } });

      const controller = new AbortController();
      await session.run(input, {
        signal: controller.signal,
        retry: { maxAttempts: 3, baseDelayMs: 100 },
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core.ts`: remove three provider fields.
      - `src/contracts-protocol.ts`: remove run alias.
      - `src/agent-session.ts`: reject old key; resolve only nested limits.
      - `src/cli-runner.ts`, `src/rpc.ts`, `packages/supervisor/src/supervisor.ts`: migrate first-party run callers where applicable.
      - `src/__tests__/{agents,agent-loops,run-ledger,skill-load,install-smoke,cli}.test.ts`: migrate fixtures and add refusal/type regressions (exact set tentative after `rg` caller audit).
      - `packages/observability-opentelemetry/src/__tests__/instrumentation.test.ts`, `examples/neuralwatt-agent-run.ts`: migrate run options.
      - `docs/{provider-layer,provider-packages,provider-conformance,provider-primitives,public-contracts,agent-session-runtime,agent-loops,tools,tool-execution-primitives,structured-output}.md`: remove deprecated guidance and show replacements where relevant.
      - `scripts/phase17-freeze.test.mjs`: mark/assert Task 1 evidence.
    - References:
      - `scripts/compat-baseline/arnilo__prism.txt` 0.1.4 baseline.
      - `src/run-limits.ts` supported implementation.
  - Test Cases to Write:
    - TypeScript negative fixture: removed `ProviderRequestOptions` fields and `RunOptions.maxToolRounds` produce expected compile errors.
    - untyped legacy run option refusal: rejects before provider invocation, session append, and tool execution; error names `limits.maxToolRounds`.
    - nested-limit parity: same tool-round cap and agent/run narrowing behavior as 0.1.4 alias path.
    - CLI regression: `--max-tool-rounds 2` produces `limits.maxToolRounds === 2` and still bounds execution.
    - caller sweep: no object passed to `session.run` / `prompt` / `stream` retains top-level `maxToolRounds`.
    - provider conformance: abort observation and runtime retry suites stay green; no first-party provider starts reading removed fields.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes—four root contract members are removed; legacy run input gains explicit refusal.
    - Docs pages to create/edit:
      - `docs/migration.md`: exact removed fields and replacements (finalized Task 4).
      - Provider docs listed above: stop advertising deprecated fields; retain abort/runtime-retry guidance.
      - Agent/tool docs listed above: replace top-level run alias examples with `limits.maxToolRounds`.
    - `docs/index.md` update: no new page; Task 4 updates current release and migration summary.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 1 evidence (2026-08-11): `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` (contracts-core.ts) and `RunOptions.maxToolRounds` (contracts-protocol.ts) removed from declarations. `runInternal` opens with a fail-closed guard on the own-property `maxToolRounds` (untyped-JS cast) throwing `TypeError` naming `RunOptions.limits.maxToolRounds` before any session mutation/provider call/tool execution; the alias-to-limits merge was deleted and limits resolve directly via `resolveRunLimits`. `rpc.ts` maps the `maxToolRounds` RPC param into `limits`; `cli-runner.ts` maps `--max-tool-rounds` into `RunOptions.limits.maxToolRounds` (CLI flag unchanged). All first-party run-option callers migrated to nested limits (agents 15, agent-loops 3 run-option usages — LoopContext `stubCtx` fixtures untouched, run-ledger, install-smoke, skill-load, observability-opentelemetry instrumentation, examples/neuralwatt-agent-run). New refusal regression in agents.test.ts (TypeError message check + zero session entries via `entries()`; `@ts-expect-error` compile-time negative fixture that fails `tsc` if the alias returns). Docs: provider-layer/provider-packages/provider-conformance/provider-primitives/public-contracts/agent-session-runtime/tools/tool-execution-primitives/agent-loops now advertise runtime replacements only (`RunOptions.signal`/`AgentConfig.retry`/`RunOptions.retry`/`limits.maxToolRounds`); docs.test.ts provider-knob tripwire rewritten (knobs absent from the 6-file set, replacements present) and phase39 phrase list swapped `timeoutMs` for `limits.maxToolRounds`. Verification: tsc 0 diagnostics, freeze test 18/18 with task1 absence legs active, full `npm test` exit 0 (agents 87/87).

- [x] Task 2 — Remove observational-memory compatibility settings and worker aliases
  - Acceptance Criteria:
    - Functional: `ObservationalMemorySettingsInput` retains nested `observation`, `reflection`, `dropper`, `context`, `retrieval` plus active top-level `agentMaxTurns`, `passive`, `debugLog`; all listed flat compatibility keys are removed from its declaration and resolution logic.
    - Functional: remove top-level `workerProvider` / `workerModel` from `CreateObservationalMemoryOptions` and `ObservationalMemoryRuntimeOptions`; workers resolve only from `observation` / `reflection` / `dropper` configs plus `sessionModel` fallback.
    - Functional: settings-provider or untyped option objects containing removed keys fail with one bounded migration error naming the first offending key and nested replacement before worker/provider calls, compaction, or session append. Unknown unrelated settings retain existing behavior unless already invalid.
    - Functional: all package tests, live fixtures, examples, and docs use nested settings/workers. Default thresholds, separate worker selection, session-model fallback, `requireExplicitModel`, credential resolution, passive mode, and dropper policy remain behaviorally unchanged.
    - Performance: removed conflict/mapping branches reduce settings resolution work; no extra provider calls, timers, or retained data.
    - Code Quality: delete compatibility branches (`conflict`, flat fallback expressions, `fallbackWorker`, worker compatibility checks) when no longer used; do not add a second settings schema.
    - Security: fail before side effects on removed dynamic keys, preventing stale thresholds/models from silently falling back to defaults or wrong providers; secret redaction and branch ownership checks remain unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/compaction-observational-memory/src/settings.ts`, `compose.ts`, `runtime.ts`, `index.ts`.
      - Package tests: `settings.test.ts`, `attach.test.ts`, `runtime*.test.ts`, `worker-split.test.ts`, `live.test.ts`.
      - `docs/compaction-observational-memory.md`, `docs/use-case-model-selection.md`, and migration 0.0.18 → 0.0.19 history.
    - Options Considered:
      - Remove only settings-interface fields but keep create/runtime worker aliases: rejected; those are part of the same documented pre-0.0.19 compatibility layer and remain annotated deprecated.
      - Silently ignore flat JSON settings: rejected; thresholds/models would change without warning.
      - One local removed-key check in settings resolution and one in each public factory, followed by nested-only logic: chosen.
    - Chosen Approach:
      - Check removed keys at public boundaries, then simplify settings and worker resolution to existing nested structures. Migrate fixtures mechanically; keep independent strategy fields such as `keepRecentEntries` where they belong to `CompactionStrategy`, not settings compatibility.
    - API Notes and Examples:
      ```ts
      // 0.1.4
      createObservationalMemory({
        workerProvider,
        workerModel,
        overrides: { observeAfterTokens: 10_000, keepRecentEntries: 8 },
      });

      // 0.1.5
      createObservationalMemory({
        observation: { provider: workerProvider, model: workerModel, messageTokens: 10_000 },
        reflection: { provider: workerProvider, model: workerModel },
        dropper: { provider: workerProvider, model: workerModel },
        context: { recentMessages: 8 },
      });
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/{settings,compose,runtime}.ts`: remove aliases/mapping; add early migration refusal.
      - `packages/compaction-observational-memory/src/__tests__/{settings,attach,runtime,runtime-coverage,runtime-drop,worker-split,live}.test.ts`: nested fixtures and refusal/parity checks (tentative exact set from caller audit).
      - `examples/observational-memory-lifecycle.ts`: nested options only.
      - `src/__tests__/package-setup-boundaries.test.ts`: nested package setup fixture.
      - `docs/compaction-observational-memory.md`, `docs/use-case-model-selection.md`: nested-only API and examples.
      - `packages/compaction-observational-memory/README.md`, `CHANGELOG.md`: migration pointer and release note.
      - `scripts/phase17-freeze.test.mjs`: Task 2 declaration/refusal assertions.
    - References:
      - `scripts/compat-baseline/arnilo__prism-compaction-observational-memory.txt`.
      - `docs/migration.md` historical 0.0.18 → 0.0.19 mapping.
  - Test Cases to Write:
    - compile-time negative assertions for every removed flat/worker member and positive assertions for nested replacements.
    - settings-provider refusal for each removed flat key; error names key and replacement; zero provider calls/appends.
    - create/runtime worker-alias refusal before worker activity.
    - nested parity: former flat fixture resolves to the same thresholds/models after manual migration.
    - active top-level settings (`agentMaxTurns`, `passive`, `debugLog`) remain accepted.
    - source/declaration sweep: no deprecated observational-memory alias or compatibility fallback remains.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes—package settings/configuration surface removes compatibility aliases and refuses stale dynamic config.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: nested-only inputs, outputs, examples, security note.
      - `docs/use-case-model-selection.md`: per-worker nested model/provider examples.
      - `docs/migration.md`: complete key-by-key replacement table.
      - `packages/compaction-observational-memory/README.md`: concise migration link.
    - `docs/index.md` update: yes in Task 4—remove “legacy map” from observational-memory entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 2 evidence (2026-08-11): `ObservationalMemorySettingsInput` keeps nested `observation`/`reflection`/`dropper`/`context`/`retrieval` plus active `agentMaxTurns`/`passive`/`debugLog`; all 10 pre-0.0.19 flat keys removed from the declaration and from `resolveObservationalMemorySettings` (nested-only now). Top-level `workerProvider`/`workerModel` removed from `CreateObservationalMemoryOptions` and `ObservationalMemoryRuntimeOptions`; `fallbackWorker`, `assertWorkerModelCompatibility`, `conflict()`, and all flat fallback expressions deleted; workers resolve only from `observation`/`reflection`/`dropper` configs plus `sessionModel` fallback. Fail-closed refusal: `assertNoRemovedFlatKeys` (settings.ts) rejects settings-provider JSON and untyped overrides with a `TypeError` naming the first offending key and its nested replacement before any worker/provider call, compaction, or session append; both factories refuse the worker aliases synchronously and re-check overrides. Tests: 10 flat keys × (overrides + settings-provider) rejection naming replacement; compile-time `@ts-expect-error` negatives for all 10 flat members; worker-alias refusals on `createObservationalMemory` and `createObservationalMemoryRuntime`; nested parity test for former flat thresholds; active top-level settings still accepted; all package fixtures (settings/attach/runtime/runtime-coverage/runtime-drop/worker-split/live) and `examples/observational-memory-lifecycle.ts` migrated to nested configs (worker-split conflict test replaced by alias-refusal tests; limits `base` and store-rejection fixtures cleaned). Docs: `compaction-observational-memory.md` (nested-only runtime example, removed-key fail-closed paragraph, alias-removal note, `observation.provider`-only worker requirement), `use-case-model-selection.md` (per-worker model/provider examples, removed-alias note), package README/CHANGELOG 0.1.5 migration pointers. Freeze test gained the Task 2 refusal-surface leg (template + key table present, alias messages in compose/runtime, no `@deprecated` left). Verification: tsc 0 diagnostics, freeze test 19/19 with task2 absence legs active, package suite 80/80, full `npm test` exit 0.

- [x] Task 3 — Remove coding read no-op alias and CLI provider constant
  - Acceptance Criteria:
    - Functional: remove `ReadToolOptions.autoResizeImages` and all internal plumbing/no-op branches; retain `transformImage`, image byte bounds, MIME detection, and resized metadata unchanged.
    - Functional: untyped `{ autoResizeImages: ... }` passed to `createReadTool` fails before path resolution/filesystem access with a message naming `transformImage`.
    - Functional: remove `INIT_PROVIDERS`; `listInitProviders(templatesRoot?)` remains the single provider-list API used by init parsing, usage text, validation, and tests.
    - Functional: affected built declarations omit `autoResizeImages` and `INIT_PROVIDERS`, while retaining `transformImage` / `TransformImage` / `listInitProviders`. Coding and init suites pass with unchanged supported behavior.
    - Performance: removes one image-path branch and one eagerly initialized alias; no new I/O or catalog load.
    - Code Quality: tests call `listInitProviders()` directly; no replacement constant or compatibility wrapper.
    - Security: removed image option is rejected before filesystem access; image size checks and init catalog validation remain fail-closed; no template/secret behavior changes.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/read.ts` and `read.test.ts`.
      - `src/cli-init.ts`, `src/cli-runner.ts`, and `src/__tests__/cli-init.test.ts`.
      - `docs/coding-agent-tools.md`, `docs/tool-execution-primitives.md`.
    - Options Considered:
      - Remove `transformImage` per stale roadmap text: rejected; it is active supported behavior and documented replacement.
      - Remove `listInitProviders` and keep constant: rejected; source annotation says the opposite, and runtime needs template-root-aware listing.
      - Remove actual aliases, retain supported functions, add one read-boundary refusal: chosen.
    - Chosen Approach:
      - Delete alias fields/branches/constants. Replace test loops and assertions with one local `const providers = listInitProviders()` where needed. Keep dynamic template-root behavior intact.
    - API Notes and Examples:
      ```ts
      const read = createReadTool(cwd, {
        transformImage: ({ buffer, mimeType }) => resize(buffer, mimeType),
      });

      const providers = listInitProviders();
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/read.ts`: remove alias/refusal plumbing.
      - `packages/coding-agent/src/__tests__/read.test.ts`: replace no-op compatibility test with refusal and transform regression.
      - `src/cli-init.ts`: remove `INIT_PROVIDERS`; retain list function.
      - `src/__tests__/cli-init.test.ts`: use `listInitProviders()`.
      - `docs/coding-agent-tools.md`, `docs/tool-execution-primitives.md`: remove alias; retain callback guidance.
      - `packages/coding-agent/CHANGELOG.md`: 0.1.5 break and replacement.
      - `scripts/phase17-freeze.test.mjs`: Task 3 declaration/preservation assertions.
    - References:
      - `scripts/compat-baseline/arnilo__prism-coding-agent.txt` and `arnilo__prism.txt`.
      - `docs/_evidence/review-coverage-2026-07-17-provider-validation.md` (historical rationale; do not rewrite archived evidence).
  - Test Cases to Write:
    - compile-time negative assertion for `autoResizeImages`; positive `transformImage` assertion.
    - untyped old read option rejects before `ReadOperations.access/statFile/readFile` calls.
    - transform callback success/failure/post-transform-size tests remain green.
    - root declaration scan omits `INIT_PROVIDERS` and retains `listInitProviders`.
    - init matrix iterates `listInitProviders()` and keeps dynamic custom-template catalogs working.
  - Task 3 evidence (2026-08-11): `ReadToolOptions.autoResizeImages` removed from `read.ts` (declaration, `loadImageBuffer` option shape, inert no-op `else if` branch, call site) and the eagerly-initialized `INIT_PROVIDERS` const removed from `cli-init.ts`; `listInitProviders(templatesRoot?)` remains the single provider-list API used by init parsing, usage text, validation, and tests. Fail-closed refusal: `createReadTool` throws `TypeError` ("autoResizeImages" was removed in 0.1.5; use "transformImage" instead) on an own `autoResizeImages` property before any path resolution or `access/statFile/readFile` call — `false` values rejected too (own-property, not truthiness). Tests: `read.test.ts` replaced the deprecated no-op test with a combined compile-time `@ts-expect-error` negative + runtime refusal; `cli-init.test.ts` imports `listInitProviders` and calls it directly in the ships-alibaba/ollama and provider-matrix tests; transformImage success/failure/post-transform-size tests unchanged. Docs: `coding-agent-tools.md` option table row and deprecated note removed (replaced with removal + fail-closed sentence), `tool-execution-primitives.md` typed shape updated, `packages/coding-agent/CHANGELOG.md` gains 0.1.5 entry. Freeze test gained the Task 3 refusal-surface leg (message present, no `@deprecated` in read.ts/cli-init.ts, no `INIT_PROVIDERS` in cli-init.ts, `listInitProviders` retained) and the compat-baseline leg now defers the INIT_PROVIDERS-absent assertion to Task 4 baseline regeneration (removal done, regen not yet). Verification: tsc 0 diagnostics, freeze test 20/20 with task3 absence legs active, coding-agent suite 296/296, full `npm test` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes—coding option and internal declaration export are removed; supported replacements remain.
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: remove deprecated row/note; keep `transformImage` example.
      - `docs/tool-execution-primitives.md`: remove alias from typed shape/threat table.
      - `docs/migration.md`: `autoResizeImages` → `transformImage`; `INIT_PROVIDERS` → `listInitProviders()`.
    - `docs/index.md` update: no separate navigation entry; Task 4 updates migration/current release.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Migration docs, intentional compat refresh, version bump, and 0.1.5 exit gate
  - Acceptance Criteria:
    - Functional: `docs/migration.md` gains a top 0.1.4 → 0.1.5 section with an exact removal/replacement table, before/after TypeScript examples, dynamic-config refusal behavior, store compatibility (“compatible; no persisted shape change”), and rollback (“restore 0.1.4 code/config; no data migration”). It explicitly records the three corrected roadmap labels.
    - Functional: root and affected package changelogs record only actual removals. `docs/index.md` current line becomes 0.1.5, migration summary names the breaking cut, observational-memory entry becomes nested-only, and `docs/release-and-install.md` gains the operator publish handoff.
    - Functional: bump 0.1.4 → 0.1.5 across all 49 manifests and lockfile with `node scripts/release.mjs bump`; update version literals, exact internal ranges, packed-install names, workspace pins, docs tripwires, and release tests.
    - Functional: before baseline regeneration, build and run `node scripts/release.mjs gate --version 0.1.5 --allow-break`; it passes only because migration docs mention 0.1.5. Record generic compat output plus the phase-17 direct declaration removal report. Regenerate only reviewed affected baselines, then run the normal gate without `--allow-break`.
    - Functional: `scripts/phase17-baseline.json.exitGate` records green `npm test`, `npm run sdk:ready`, audit 0 moderate, Node 20 + current-supported Node build/packed-import checks, 49/49 deterministic pack dry-run twice, normal release gate, unchanged package graph/dependency names, and benchmark/budget results.
    - Performance: frozen runtime/package-size budgets remain green; removed compatibility code does not increase startup, package, or install size beyond existing tolerance.
    - Code Quality: all phase-17 task tokens/checklists are updated only after tests pass; `Compromises Made` and `Further Actions` receive actual execution results; `rg '@deprecated'` over runtime source returns no unplanned markers.
    - Security: audit 0; no new dependencies; threat suites remain green; refusal tests prove stale behavior-affecting options fail before provider/tool/filesystem/session side effects. Publication remains explicit operator action via signed `v0.1.5` tag and npm OIDC.
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` 0.1.3 → 0.1.4 section and prior breaking-cut sections.
      - `docs/release-and-install.md` 0.1.4 handoff and release validation checklist.
      - `CHANGELOG.md`, touched package changelogs, `scripts/release.mjs`, `scripts/release-gates.mjs`.
      - `roadmap.md` release validation checklist and 0.1.5 acceptance.
    - Options Considered:
      - Regenerate baselines immediately: rejected; it would erase review evidence of intentional breaks.
      - Keep `--allow-break` permanently in `sdk:ready`: rejected; reviewed baselines should make normal gates green after the cut.
      - Capture break report first, then update only affected baselines: chosen.
    - Chosen Approach:
      - Finalize migration docs, build, capture deliberate break evidence with `--allow-break`, run direct declaration checks, regenerate reviewed baselines, bump all release metadata, and execute the standard release checklist. Operator performs commit/tag/publish afterward.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.1.4 --to 0.1.5
      npm run build
      node scripts/release.mjs gate --version 0.1.5 --allow-break
      node scripts/release.mjs gate --version 0.1.5 --update-baseline
      node scripts/release.mjs gate --version 0.1.5
      npm run sdk:ready
      npm audit --audit-level=moderate
      ```
    - Files to Create/Edit:
      - `docs/migration.md`: 0.1.4 → 0.1.5 breaking migration.
      - `CHANGELOG.md`, `packages/coding-agent/CHANGELOG.md`, `packages/compaction-observational-memory/CHANGELOG.md`: release entries.
      - `docs/index.md`: current line/migration/observational-memory navigation text.
      - `docs/release-and-install.md`: 0.1.5 operator handoff.
      - `package.json`, `packages/*/package.json`, `package-lock.json`: 0.1.5 graph bump.
      - `src/index.ts` and version-sensitive root/workspace tests: exact 0.1.5 pins.
      - `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-coding-agent.txt`, `arnilo__prism-compaction-observational-memory.txt`: reviewed refresh (plus any other baseline changed only by version/re-export text, recorded explicitly).
      - `scripts/phase17-baseline.json`, `scripts/phase17-freeze-manifest.json`, `plans/017-Release-0-1-5-Deprecated-Option-Removal.md`: final evidence/status.
    - References:
      - `plans/016-Release-0-1-4-God-Module-Split.md` Task 6.
      - `docs/release-and-install.md` compatibility gate documentation.
  - Test Cases to Write:
    - migration tripwire: every removed symbol/key and replacement appears in the 0.1.5 section; stale labels are explicitly corrected.
    - deliberate-break sequence: pre-refresh `--allow-break` succeeds with migration note; plain pre-refresh gate fails; plain post-refresh gate succeeds.
    - declaration report: exact removed members absent and preserved APIs present in packed `.d.ts`.
    - packed consumer migration smoke: nested replacements typecheck/run; old TypeScript snippets fail as expected.
    - release graph: 49 manifests at exact 0.1.5, lockfile name set unchanged, no new dependencies.
    - full release checks: tests, coverage, lint/format, threat suites, audit, budgets, deterministic packs, Node support imports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes—this task publishes all breaking migration and release metadata.
    - Docs pages to create/edit:
      - `docs/migration.md`: required breaking migration section.
      - `docs/index.md`: current release, migration summary, nested-only observational-memory description.
      - `docs/release-and-install.md`: 0.1.5 operator handoff.
      - Existing affected API pages from Tasks 1–3; no new page needed.
    - `docs/index.md` update: yes—current line and affected navigation descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 4 evidence (2026-08-11): `docs/migration.md` top section `0.1.4 → 0.1.5` with the 17-row removal/replacement table, before/after TypeScript examples for all five families, dynamic-config refusal behavior, store compatibility (“Compatible — no persisted shape change”), rollback (“Restore the 0.1.4 manifests/tag”), and the three corrected roadmap labels explicitly recorded. `docs/index.md` current line → **0.1.5** with the breaking-cut migration summary (knob names kept out of index.md to satisfy the knob-absent docs tripwire) and nested-only observational-memory entry; `docs/release-and-install.md` gains the 0.1.5 operator publish handoff (signed `v0.1.5` tag + npm OIDC, rollback notes); root `CHANGELOG.md` 0.1.5 entry plus the two package entries from Tasks 2–3. Release graph bumped 0.1.4 → 0.1.5 across all 49 manifests + lockfile (`release.mjs bump`); version literals (`src/index.ts`), packed-install names (`install-smoke.test.ts` tarball names), workspace pins (`packaging.test.ts` 8×, provider/package `index.test.ts` 12 files), and tripwires (`release.test.ts`, `docs.test.ts` plan-017 freeze + `pkg.version` + index current-line) all updated. Break evidence: plain gate at 0.1.5 fails with exactly the one baseline-visible break (`removed: INIT_PROVIDERS`); `--allow-break` passes only because migration.md mentions 0.1.5; reviewed regeneration changed `arnilo__prism.txt` (−`INIT_PROVIDERS` line) and `arnilo__prism-compaction-observational-memory.txt` (+`assertNoRemovedFlatKeys`, additive internal export), `arnilo__prism-coding-agent.txt` unchanged; the second refresh (after the `src/index.ts` version fix) flips only the root `version` literal line; plain gate then green. Interface-member removals stay invisible to the baseline gate (normalized-to-brace) and are enforced by the phase-17 direct declaration scanner legs. Exit gate recorded in `scripts/phase17-baseline.json` (`exitGate` + `fileHashes` refreshed, Task-0 hashes preserved in `fileHashesTask0`): npm test core 1428/1428 + 173 script gates, `sdk:ready` exit 0 (typecheck/lint/format/test/pack/release:gate), audit 0 moderate, pack dry-run 49/49 twice byte-identical (sha256 `4eb24fc7…`), release gate 0.1.5 clean, lockfile package name-set hash unchanged vs 0.1.4 (zero new dependencies), benchmark evidence untouched. Freeze test now 20/20 with the exit-gate leg asserting the full green record.

## Compromises Made

- The baseline-based compat gate cannot see interface-member removals (its surface extractor normalizes interface signatures to the opening brace), so the four member-only removals (`maxToolRounds`, provider knobs, OM flat keys/aliases, `autoResizeImages`) are enforced by the phase-17 direct declaration scanner in `scripts/phase17-freeze.test.mjs` rather than by baseline text; baselines record only the `INIT_PROVIDERS` line delta plus the additive `assertNoRemovedFlatKeys` export. This matches the plan-017 Task 0 blind-spot analysis; a future gate could extract full declaration bodies to close the gap.
- `INIT_PROVIDERS` removal surfaces to untyped callers as `undefined` (no runtime refusal — there is no reading code path to refuse); the fail-closed guarantees cover the behavior-affecting options (provider knobs, `maxToolRounds`, OM keys/aliases, `autoResizeImages`), while the constant removal is enforced at the type/build level only.
- The 52 pre-existing biome lint warnings (ancient `catch (error)` and optional-chain patterns in ag-ui/mcp/tool-result-fold) are warnings, not errors — `sdk:ready` passes; they were not in scope for this plan and remain a follow-up.

## Further Actions

- Verify the plan-017 evidence on the release commit: re-run `npm run sdk:ready`, `npm audit --audit-level=moderate`, `npm run release:check -- --version 0.1.5`, and the double pack dry-run, then record the operator prerequisites and sign/push `v0.1.5` per `docs/release-and-install.md` `0.1.5 publish handoff` (priority: immediate, operator).
- Consider extending `scripts/release-gates.mjs` `extractDeclaredSurface` to serialize full interface/type-alias declaration bodies so future removals of interface members become baseline-visible (priority: medium; would have made Task 0's blind-spot workaround unnecessary).
- Fold the `assertNoRemovedFlatKeys` export into the public `@arnilo/prism-compaction-observational-memory` documentation or mark it internal if it is not intended for consumers (priority: low; it entered the packed surface as an additive module export in 0.1.5).
