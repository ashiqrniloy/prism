# Phase 2 Part B — Retire the extension surface and ship `hooks-json`

## Objectives

- Ship `@arnilo/prism/testing` with the package conformance suite and a loop conformance harness promoted from `src/__tests__/helpers/hook-harness.ts`.
- Move every in-repo 0.12 `Extension` and `ProviderPackage` onto `definePackage`, in the same task that migrates its callers.
- Ship the first native package, `@arnilo/prism-hooks-json`, at `packages/integrations/hooks-json`. It is moved from the 0.12 `hooks` package, publishes TypeScript source, and passes conformance.
- Remove these without aliases: `Extension`, `ExtensionAPI`, `ExtensionKernel`, `activateKernel`, `forwardAgentEvents`, `ContributionRegistries`, `PrismManifest` (the old contribution manifest), `ProviderPackage`, and the discovered-contribution descriptors.

## Expected Outcome

- `@arnilo/prism/testing` exports:
  - `packageConformance(definition, options)`, which checks:
    - setup/dispose idempotence
    - no contribution leaks after dispose
    - a valid config schema
    - declared capabilities cover the APIs used
    - no secret in `inspect()`
  - `loopConformance(strategy)`
- `@arnilo/prism-hooks-json` lives at `packages/integrations/hooks-json`:
  - `"exports": { ".": "./src/index.ts" }`, with the default export from `definePackage`
  - its `hooks.json` config is validated by the kernel schema validator
  - it passes `packageConformance`
  - its README follows the package page structure
- These family modules load as packages:
  - LLM compaction, observational memory, and wiki (`packages/memory`)
  - impeccable (`packages/prism-coding-tools`)
  - every vendor factory in `packages/prism-providers`
- Prism Code's wiki wiring, the agent-sdk hooks and skills planes, `src/cli-runner.ts`, and every example pass packages to `createAgent`.
- The repo-wide sweep finds no retired name outside `plans/`, `docs/history/`, `docs/_evidence/`, `dist/`, released `/docs` prose, and historical `CHANGELOG` sections.
- The repo tooling handles the grouped layout (`packages/<group>/<name>`) and TypeScript-source exports:
  - root `workspaces`
  - `scripts/package-truth.mjs`
  - `src/__tests__/packaging.test.ts`
  - `src/__tests__/public-export-contract.test.ts`
  - `scripts/independent-packages.json`
  - `scripts/compat-baseline/`
- `src/__tests__/package-api-freeze.test.ts` pins the `PackageAPI` member names, the capability list, and the `PackageLoadError` codes for Phase 3.
- The phase is done when all four roadmap Done criteria hold:
  - `hooks-json` passes conformance (Task 5).
  - A loop-slot package runs end to end (plan 146 Task 5, re-run under `loopConformance` in Task 2).
  - Session state survives fork and resume (plan 146 Task 7).
  - Two slot claimants fail closed until assigned (plan 146 Task 5).

This plan is Part B of roadmap **Phase 2 — Package system**. It depends on [plan 146](146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md) being complete. The phase review is plan 146 Task 1. Task 1 here is a read-only entry check that re-verifies the caller map after Part A has changed the code.

Retirement is ordered so that each task leaves the tree green:
1. Conformance lands first, so conversions can prove themselves.
2. Family extensions and provider factories convert next, while the old surface still exists.
3. `hooks-json` moves.
4. Task 6 deletes the old surface once it has no callers.

Released `/docs` pages (`docs/hooks.md`, `docs/extensions.md`, the provider pages, and the rest) stay on the 0.12.1 contract until roadmap Phase 11. Each task drops only the `docs.test.ts` pin rows that tie a released page to a removed export. The old npm name `@arnilo/prism-hooks` is deprecated in Phase 11 and is not touched on npm here.

This plan does not ship a version bump, a publish, a `/docs` change, or the manifest (Phase 4). It also does not port vendors to `@arnilo/prism-provider-<vendor>` (Phase 5): Task 4 changes only how the existing family factories register.

## Tasks

- [x] Task 1: Part B entry check — the caller map after Part A (read-only)
  - Acceptance Criteria:
    - Functional: Plan 146 is `complete` in `plans/README.md`, and its Task 1 verdict and amendments are applied here.
    - Functional: The Notes list every caller of each retired symbol, grouped by workspace, with `file:line`. Use `graft callers <symbol> --depth all` and `graft grep`:
      - Symbols: `Extension`, `ExtensionAPI`, `ExtensionEvent`, `ExtensionLifecycleEventName`, `ExtensionKernel`, `createExtensionKernel`, `createExtensionEventBus`, `activateKernel`, `ActivatedKernelConfig`, `forwardAgentEvents`, `ContributionRegistries`, `ContributionRegistry`, `createContributionRegistries`, `createContributionRegistry`, `registerDiscoveredContributions`, `PrismManifest`, `definePrismManifest`, `parsePrismManifest`, `ManifestContributionDeclaration`, `ManifestContributionKind`, `ManifestResourceDeclaration`, `ProviderPackage`, `ProviderPackageAPI`, `ProviderPackageDocs`, `defineProviderPackage`, `authMethodKey`, `systemPromptContributionKey`, and the `extension-conformance` testing module.
      - Each caller is marked *migrate* (with its `PackageAPI` target) or *delete* (with the reason deleting is safe now).
    - Functional: Confirm or refute each of these:
      - (a) `DiscoveredContribution` and `discoverContributions` (`src/node/contribution-discovery.ts:34`) are still needed for skill-directory discovery (`skills.addDir`, the agent-sdk skills plane). Only the descriptor helpers (`registerDiscoveredContributions`, `descriptorTool`, `descriptorInstructions` at `src/contributions.ts:85-158`) and the non-skill kinds retire.
      - (b) `AgentDefinitionResolutionContext.registries` (`src/agent-definitions.ts:63`) can resolve string model ids without `ContributionRegistries`, for example through a plain `models` list. Otherwise, resolving a model by id is dropped with its callers (`examples/handoff-swarm.ts`, `crew-hierarchy.ts`, `cyclic-reflection.ts`, `memory-fabric.ts`, and `src/node/agent-definitions.ts`).
      - (c) No production code reads the registered models or auth methods of a provider package. Only examples and tests do (`examples/provider-{xai,deepseek,clinepass}.ts`, `neuralwatt-agent-run.ts`, `openrouter-model-cache-override.ts`). Prism Code builds providers directly (`packages/prism-code/src/providers.ts:71-206`). If so, Task 4 registers only the provider, and model lists and auth descriptors stay as plain module exports until Phase 5.
      - (d) `loadManifestResource` and `src/resources.ts` use `PrismManifest` only to parse the old contribution manifest, so they retire with it.
      - (e) `ExtensionLoadPolicy` (allow-list, signature) has no non-test caller. Its replacement is Phase 4's integrity check and trust callback, so it is deleted without a Phase 2 substitute. Record this as a Compromise if a caller exists.
      - (f) Every family `Extension` uses only registrars that `PackageAPI` covers (`registerTool`, `registerSkill`, `registerCommand`, `hooks.on`, `registerProvider`). List every other registrar call and its disposition.
    - Performance: n/a — read-only.
    - Code Quality: Every caller row cites `file:line`.
    - Security: List every trust path these symbols carry: `ExtensionLoadPolicy`, the `PermissionPolicy` `extension:setup` check (`src/extensions.ts:204`), and the hooks.json command allow-list and hash pinning. For each, name what replaces it or record that it is intentionally dropped, so that no gate is lost silently.
  - Approach:
    - Documentation Reviewed:
      - plan 146 Task 1 Notes
      - `roadmap.md` §2.9 Retired, and Phase 2 "Remove"
    - Options Considered:
      - Rely on plan 146 Task 1 alone. Rejected: Part A rewrote `createAgent` and the hook bus, so its citations are stale.
    - Chosen Approach:
      - Re-run graft per symbol and write the migrate/delete table into the Notes.
    - API Notes and Examples:
      ```bash
      graft callers createExtensionKernel --depth all
      graft grep "defineProviderPackage"
      ```
    - Files to Create/Edit:
      - `plans/147-Phase-2-Part-B-Retire-Extensions-And-Hooks-Json.md`: Notes only.
    - References:
      - `src/extensions.ts`, `src/contributions.ts`, `src/manifests.ts`, `src/provider-packages.ts`, `src/contracts-core/extensions.ts`
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Verdict: the plan stands; no task needs a re-cut.** Plan 146 is `complete` in `plans/README.md:154` (2026-10-02), and its Task 1 verdict is applied here: the Part A amendments Part B relies on all landed — `PackageCommand` exists (`src/packages/api.ts:96`), function-valued options are bound through factory closures (plan 146 finding (c)/A5), the loader already implements `skills.addDir` with the node reader (`src/packages/loader.ts:455,534-538`, `src/agent-session/create-agent.ts:16-23`), and the hook bus owner seam is in (`src/hooks/bus.ts`). One stale baseline row: `registerDiscoveredInstructionInjectors` appears in `scripts/compat-baseline/arnilo__prism.txt:1055` but has no source caller and is not on the retirement list; Task 5/6 regeneration will drop the row.
    - **Method deviation.** The graft MCP server timed out on every call and the installed graft 0.18.0 CLI has no `callers`/`grep` commands, so the caller map was rebuilt with `rg` (word-bounded per symbol) over `src packages scripts examples docs` with the Task 6 exclusions (`**/dist/**`, `docs/history/**`, `docs/_evidence/**`). Every row below cites exact `file:line`, matching the Code Quality criterion.
    - **Caller map.** *migrate* = move onto the named `PackageAPI` target; *delete* = safe to remove now, reason given. Definition sites (the four retired modules and their barrel rows) are listed once, not per symbol.

      | Workspace | Caller | Symbols | Disposition |
      | --- | --- | --- | --- |
      | kernel `src` (prod) | `src/extensions.ts:111,267,325` | `createExtensionKernel`, `forwardAgentEvents`, `activateKernel` | delete: definitions retire in Task 6 |
      | kernel `src` (prod) | `src/contributions.ts:33,78,102`, `src/manifests.ts:47,51`, `src/provider-packages.ts:3,8,12`, `src/testing/extension-conformance.ts:36` | all registry/manifest/provider-package helpers | delete: definitions retire in Tasks 5/6 |
      | kernel `src` (prod) | `src/index.ts:322-327,405-410,573-574,638,662` | barrel rows | delete with their modules |
      | kernel `src` (prod) | `src/cli-runner.ts:19,22,24,33,388-394,512,525,575-640` | `createContributionRegistries`, `registerDiscoveredContributions`, `createExtensionKernel`, `activateKernel`, `Extension` | migrate (Task 6): `--discover` feeds `loadSkillDirectory` directly instead of registries; `--extension` modules load as package instances through `createAgent({ packages })`; the `PRISM_EXTENSION_ALLOWLIST` + cwd-containment gates are CLI-owned and stay |
      | kernel `src` (prod) | `src/agent-definitions.ts:63-66` (`resolveModel`), `:73-76` (`resolveProviderOptions`) | `ContributionRegistries` via `context.registries` | migrate: keep the plain `{ provider, model }` string split (already the fallback) and the `providerSource` field; drop the `registries` field (`src/contracts-core/agent.ts:44`) |
      | kernel `src` (prod) | `src/node/agent-definitions.ts:15,32,227,273,380` | `ManifestContributionDeclaration`, `registries` option | delete: the repoTools scope registers descriptor-only stubs whose `execute` throws (`:386-391`), so dropping it loses no behavior; Phase 4's manifest replaces it. The skills scopes stay on `loadSkillDirectory` |
      | kernel `src` (prod) | `src/resources.ts:4,27-28` | `PrismManifest`, `parsePrismManifest` (via `loadManifestResource`) | delete: retires with the old manifest (finding d) |
      | kernel `src` (tests) | `src/__tests__/{extensions,agent-event-bridge,contributions,contributions-discovered,config-manifests,public-contracts,public-export-contract,agent-definitions,node-agent-definitions,tools,skills,settings-security,run-end-continuations,package-setup-boundaries,input-pipeline,persistence-lifecycle,conformance-helpers,resources,docs,agent-config.types}.test.ts` | all | rewrite onto `definePackage`/`@arnilo/prism/testing`, or delete when they only pin the retired mechanism (Task 6) |
      | `packages/agent-sdk` | `src/planes/hooks.ts:2,57-59` | `createExtensionKernel`, `activateKernel` | migrate (Task 5): pass `hooksJson(...)` in `packages` |
      | `packages/agent-sdk` | `src/planes/skills.ts:2-4,88,95-96` | `createContributionRegistries`, `registerDiscoveredContributions` | migrate: keep `discoverContributions`; register the realized skills directly (no registries) |
      | `packages/agent-sdk` | `src/define-agent.ts:13,301` | `createContributionRegistry<CommandDefinition>` | migrate: plain command list / `PackageCommand` |
      | `packages/prism-code` | `src/wiki.ts:2-3,117,123-125` | `createExtensionKernel`, `activateKernel`, `createWikiExtension` | migrate (Task 3): pass `wiki(...)` in `createAgent({ packages })`; `providers.ts` builds vendors directly and touches no retired symbol |
      | `packages/memory` | `compaction/llm/extension.ts:11`, `compaction/observational-memory/extension.ts:11`, `wiki/extension.ts:25` + their `index.ts` exports + `__tests__` (`runtime`, `extension`, `attach`, `primitive-seams`, `e2e-pkm`, `e2e-codebase`, `commands`) | `Extension`, factories | migrate (Task 3): `definePackage` conversions |
      | `packages/prism-coding-tools` | `impeccable/extension.ts:8`, `impeccable/index.ts:2`, `impeccable/__tests__/impeccable.test.ts:8,75-110`, `__tests__/coding-tools-conformance.test.ts:10,40` | `Extension`, `createExtensionKernel` (via the testing subpath re-export) | migrate (Task 3) |
      | `packages/hooks` | `src/compile.ts:17,61-62,175,301`, `src/index.ts`, `README.md`, `__tests__/compile.test.ts` | `Extension`, `ExtensionAPI`, `ExtensionEvent`, `createExtensionKernel`, `activateKernel` | migrate (Task 5): `git mv` + `definePackage` rewrite |
      | `packages/prism-providers` | every `src/<vendor>/index.ts` and `azure|bedrock|vertex/provider.ts` (20 vendors) | `ProviderPackage`, `defineProviderPackage` | migrate (Task 4): `<vendor>Package` on `definePackage` + `providers.register` |
      | `examples` | `extensions.ts`, `extension-package.ts`, `manifests.ts`, `caveman-ponytail.ts`, `observational-memory-recall-status-view.ts`, `impeccable.ts`, `hooks-json.ts`, `provider-{registration,resolver,xai,deepseek,clinepass}.ts`, `neuralwatt-agent-run.ts`, `openrouter-model-cache-override.ts`, `memory-fabric.ts`, `discover-skills.ts` | all | migrate in their owning tasks (3, 4, 5, 6); `instruction-injection.ts:12,49` keeps `discoverContributions` (not retired) |
      | `scripts` | `post-publish-smoke.mjs:104-121` | `createExtensionKernel`, `activateKernel`, `forwardAgentEvents`, `parseHooksConfig` | migrate (Task 5): keep the `@arnilo/prism-hooks-json` export checks, drop the kernel checks |
      | `scripts` | `phase54-package-map.mjs:35,46`, `e2e-coverage.json:211,290`, `fixtures/e2e-full-surface-journey.mjs:161,183,624` | `./testing/extension-conformance`, `./node/agent-definitions` subpaths, `createImpeccableExtension` | migrate (Task 6): re-point to `@arnilo/prism/testing` and the new factories |
      | `scripts` | `phase25-split-contracts-core.mjs:49,51`, `phase25-dead-exports-raw.txt`, `phase24-freeze-manifest.json`, `budgets.json` (reason text) | names in historical audit records | delete/residue: historical evidence text only; no runtime caller |
      | released `docs/` | `docs/extensions.md`, `hooks.md`, `contribution-registries.md`, `contribution-discovery.md`, `configuration-and-manifests.md`, `public-contracts.md`, `provider-packages.md`, `docs/providers/*.md`, `migration.md`, `cli-rpc.md`, `extension-authoring.md`, `extension-conformance.md`, `resource-loading.md`, `model-registry.md`, `system-prompts.md` | all | intentional residue: 0.12.1 contract, stays until Phase 11; `docs.test.ts` pin rows drop per Task 6 |
    - **Assumption checks.**
      - **(a) Confirmed.** `discoverContributions` (`src/node/contribution-discovery.ts:34`) has live callers for skill discovery: `src/cli-runner.ts:388`, `packages/agent-sdk/src/planes/skills.ts:88`, `examples/instruction-injection.ts:49`, `examples/discover-skills.ts:30`, and the loader's `loadSkillDirectory` read path (`src/packages/loader.ts:538`, `src/agent-session/create-agent.ts:22`). Only the descriptor helpers (`registerDiscoveredContributions` at `src/contributions.ts:102`, `descriptorTool`/`descriptorInstructions` at `:135-158`) and the non-skill registry kinds retire. The `declaration` field on `DiscoveredContribution` (`src/contracts-core/extensions.ts:33`) is only consumed by the retiring repoTools scope (`src/node/agent-definitions.ts:273`), so the kept envelope can shrink to the skill shape when it moves to its owning module.
      - **(b) Confirmed, and the plan's example list was stale.** `resolveModel` already resolves a string id without registries: it splits on `/` and returns `{ provider, model: modelId }` when `context.registries?.models` is absent (`src/agent-definitions.ts:60-66`). The only callers that pass `registries` are `examples/memory-fabric.ts:94` (registers a tool, not a model) and `src/node/agent-definitions.ts:227` (forwards an option no production caller sets; `src/cli-runner.ts` and the handoff examples pass `tools`/`providerSource` instead — `examples/handoff-swarm.ts:191,213,228`, `crew-hierarchy.ts:207`, `cyclic-reflection.ts:277,323` never touch `registries`). So the `registries` field and both registry branches are dropped; no example loses model resolution, and `memory-fabric.ts` migrates its tool onto a plain `tools` list.
      - **(c) Confirmed.** No production code reads registered models, auth methods, or provider packages. The reads are: `src/extensions.ts:143-194` (the registration side itself, retiring), `src/agent-definitions.ts:64` (the registry branch dropped per (b)), and the examples `provider-xai.ts:8,12`, `provider-deepseek.ts:8`, `provider-clinepass.ts:8`, `neuralwatt-agent-run.ts:98`, `openrouter-model-cache-override.ts`. Prism Code builds providers directly from vendor subpaths (`packages/prism-code/src/providers.ts` `create:` blocks) and never consults a registry. Task 4 registers only the provider; model lists and auth descriptors stay plain module exports until Phase 5.
      - **(d) Confirmed.** `loadManifestResource`'s only callers are its barrel row (`src/index.ts:662`), tests (`src/__tests__/resources.test.ts:6,52`), and released docs. `src/resources.ts` touches `PrismManifest`/`parsePrismManifest` only inside that function (`:4,27-28`); the sibling loaders (`loadJsonResource` etc.) are untouched. It retires with the manifest.
      - **(e) Confirmed.** `ExtensionLoadPolicy` has no non-test caller: `src/extensions.ts:30,46,338` (definition and use), the barrel row, `src/contracts-core/extensions.ts:55` (a doc comment), `src/__tests__` and the baseline. Nothing under `packages/`, `examples/`, or `scripts/` sets `loadPolicy`. It is deleted with no Phase 2 substitute; Phase 4's integrity check and trust callback replace it. No Compromise needed (no caller to lose).
      - **(f) Confirmed.** Every family `Extension` uses only registrars `PackageAPI` covers. LLM compaction calls nothing (`packages/memory/src/compaction/llm/extension.ts:14` — `setup() {}`; the compactor is a slot assignment). OM uses `api.registerTool` and `api.registerCommand` (`extension.ts:15-16`). Wiki uses `api.registerTool` ×4, `api.registerCommand` ×4, `api.registerSkill` ×2, and one `api.hooks.on("context.build", ...)` (`extension.ts:46-79`). Impeccable uses `api.registerSkill` and `api.registerCommand` (`extension.ts:15-16`). The hooks extension uses only `extensionApi.hooks.on` (`packages/hooks/src/compile.ts:318-360`). No other `ExtensionAPI` member (middleware, `emit`, `registerStopHook`, `registerModel`, `registerAuthMethod`, `registerProviderPackage`) has a family caller — the last three appear only in `src/extensions.ts` itself, retiring tests, and Prism-provider examples. Coverage: `tools`, `skills`, `commands`, `hooks.on` all exist on `PackageAPI` (`src/packages/api.ts:82-96`).
    - **Decision recorded for Task 3: `src/rpc.ts` keeps `CommandDefinition`.** The 0.12 JSON-RPC dispatch (`src/rpc.ts:233`) is pinned by released `docs/cli-rpc.md`, and `CommandDefinition` is not on the retired-symbol list, so this plan leaves both alone; family modules still move their command registrations onto `PackageCommand` (exists at `src/packages/api.ts:96`) in Task 3. The `CommandDefinition` retirement belongs to the RPC-plane phase that replaces the 0.12 dispatch.
    - **Contracts-core trim for Task 6 (finding from this walk).** Of the types the plan told Task 1 to check: `SystemPromptContribution` has live production callers (`src/system-prompts.ts:48,54`, `src/cli-runner.ts:88`, `packages/agent-sdk/src/planes/instructions.ts:20,31`) and moves to its owning module; the OAuth types `src/oauth-device-code.ts` and Prism Code `oauth.ts` use (`OAuthCredentials`, `OAuthLoginCallbacks`, `OAuthCredentialStore`) already live in `src/contracts-core/resources.ts:42-51`, not in `contracts-core/extensions.ts`; and the `AuthMethod` trio (`contracts-core/extensions.ts:77-122`) has no caller outside the retiring `authMethods` registry, so it retires too. Task 6's edit list shrinks accordingly.
    - **Security — trust paths carried by the retired symbols.**

      | Gate | Where | Disposition |
      | --- | --- | --- |
      | `ExtensionLoadPolicy` allow-list + signature | `src/extensions.ts:338-346` | no non-test caller (finding e); deleted with no Phase 2 substitute — replaced by Phase 4's integrity check and trust callback. Recorded here and in Task 6 so the loss is not silent. |
      | `PermissionPolicy` `extension:setup` check | `src/extensions.ts:204,217` | only a test ever passes `permission` (`src/__tests__/settings-security.test.ts:143`); the new loader has no permission seam, so the gate is intentionally dropped and Phase 4's trust callback replaces it. Not recorded as a Compromise: no production caller loses a gate. |
      | hooks.json command allow-list + hash pinning | `packages/hooks/src/compile.ts:71,208-214` (mismatch currently warns + skips), `trusted: "all"` warning at `:305` | kept in Task 5 and tightened: validation moves into the package config schema so an unlisted command fails closed at load with `PackageLoadError` `config_invalid`; hash pinning and the `trusted` escape stay |
      | hooks.json path trust | `packages/agent-sdk/src/planes/hooks.ts:9,22,27-31` (`createPathTrustPolicy`, fail-closed on untrusted path) | stays as-is in Task 5; not a retired symbol |
      | CLI `--extension` trust gate | `src/cli-runner.ts:577-618` (`PRISM_EXTENSION_ALLOWLIST`, cwd containment, NUL rejection) | CLI-owned, not a retired symbol; Task 6 re-points it at package modules, so no gate is lost |
    - **Evidence not run:** read-only task; no tests, typecheck, or gate ran. The `rg` scans live in the session scratchpad (`/tmp/scan1.txt`, `/tmp/scan2.txt`), not committed.

- [x] Task 2: `@arnilo/prism/testing` — package and loop conformance
  - Acceptance Criteria:
    - Functional: The new subpath `@arnilo/prism/testing` exports `packageConformance(definition, { config?, mockProvider? })`. It returns named check results and fails each check as follows:
      - `setup_dispose_idempotent`: load, dispose, load again, and dispose twice, with no throw and the same `inspect()` both times.
      - `no_leaks_after_dispose`: after `dispose`, `inspect()` lists no tool, skill, command, hook, or slot of the package. Services have no `inspect()` field; the loader deletes them in teardown, so a service leak is not observable here.
      - `config_schema_valid`: the schema uses only the supported subset, and its defaults validate against it.
      - `capabilities_cover_usage`: a recording `PackageAPI` proxy runs `setup` and one mock session, and every gated member called is declared.
      - `no_secret_in_inspect`: `x-prism-secret` fields are set to `env:` refs whose env values are set, and none of the values appear in `JSON.stringify(inspect())`.
    - Functional: `loopConformance(strategy)` is `hook-harness` promoted under the public subpath. It drives a `LoopStrategy` through a scripted mock scenario and reports `{ result, events, fired }`. The test helper is deleted. In-repo tests import `../testing/index.js` (the module the subpath exports), not the `@arnilo/prism/testing` specifier: the package self-symlink resolves to `dist`, so a src-tree `bun test` would hit a stale build.
    - Functional: The subpath also re-exports `createMockProvider` and the existing mock helpers, so a package test needs only `@arnilo/prism` and `@arnilo/prism/testing`.
    - Performance: Each conformance run completes in under 1 second on the mock provider for a package with no I/O.
    - Code Quality: The suite lives in `src/testing/package-conformance.ts` and `src/testing/loop-conformance.ts`, with `src/testing/index.ts` as the subpath entry. The suite imports no package.
    - Security: The capability check runs on a recording proxy, and does not trust what the package declares.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 "Package conformance suite", §2.2 (`testing/` subpath), and §1.4 ("a conformance suite in `@arnilo/prism/testing`")
      - `src/__tests__/helpers/hook-harness.ts`
      - backlog "Promote the hook harness into `@arnilo/prism/testing`" (P1)
    - Options Considered:
      - Keep per-suite subpaths (`./testing/provider-conformance`, …) and add `./testing/package-conformance`. Rejected: the roadmap names a single `@arnilo/prism/testing` entry. The existing per-suite subpaths stay until their owning phases (5, 6) consolidate them, and this is recorded in Further Actions.
    - Chosen Approach:
      - Add one subpath now holding the package and loop suites and the mock provider.
    - API Notes and Examples:
      ```ts
      import { packageConformance } from "@arnilo/prism/testing";
      import hooksJson from "../index.ts";
      test("conformance", async () => expect((await packageConformance(hooksJson, { config: { hooks: {} } })).ok).toBe(true));
      ```
    - Files to Create/Edit:
      - `src/testing/index.ts`, `src/testing/package-conformance.ts`, `src/testing/loop-conformance.ts`: new.
      - `src/__tests__/helpers/hook-harness.ts`: delete. Its importers (`hook-catalog-coverage.test.ts`, `hook-invariants.test.ts`) move to a relative import of `src/testing/index.ts`.
      - `package.json`: `exports["./testing"]`.
      - `src/__tests__/packaging.test.ts`: no hardcoded subpath list; targets come from `package.json` exports. `src/__tests__/public-export-contract.test.ts`: one shape pin for `"./testing"` next to the existing provider-conformance pin.
      - `scripts/e2e-coverage.json` and `scripts/e2e-coverage.test.mjs`: new `"./testing"` surface (total 114). `scripts/fixtures/e2e-full-surface-journey.mjs` imports the subpath. `scripts/phase54-package-map.mjs` lists it; regenerate `docs/_evidence/phase54-package-map.md`.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate.
      - `docs/next/testing.md`: new, using the API page structure.
      - `docs/release-and-install.md`: one specifier row. The export-subpath test requires every `package.json` export in that table. No target-API prose.
      - `CHANGELOG.md`
    - References:
      - plan 144 Further Actions, "Promote the loop conformance harness"
  - Test Cases to Write:
    - `conformance_passes_for_a_well_behaved_package`
    - `conformance_catches_leak`: a package that keeps its registrar and registers a hook after `setup` returns fails `no_leaks_after_dispose`.
    - `conformance_catches_undeclared_capability`: `slots.loop.provide` without `slot:loop` fails.
    - `conformance_catches_secret_in_inspect`: a deliberately broken package that copies a resolved credential into a `status.note` fails.
    - `loop_conformance_reports_catalog_hooks`: the existing `hook-catalog-coverage` assertions, run through `src/testing/index.ts` (relative import; same module the subpath exports).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new subpath.
    - Docs pages to create/edit:
      - `docs/next/testing.md`: new.
      - `docs/release-and-install.md`: specifier row only.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Shipped.** `@arnilo/prism/testing` exports `packageConformance`, `loopConformance`, `echoTool`, `textProvider`, `twoTurnProvider`, `createMockProvider`, and the provider event helpers (`src/testing/index.ts`). Checks live in `src/testing/package-conformance.ts`; the harness in `src/testing/loop-conformance.ts`. `src/__tests__/helpers/hook-harness.ts` is deleted. `docs/next/testing.md`, one `@arnilo/prism/testing` row in `docs/release-and-install.md` (the export-subpath test requires it; no target-API prose), and the Unreleased changelog entry landed. `docs/index.md` is unchanged.
    - **Check semantics that later tasks must meet.** `config_schema_valid` requires declared defaults to validate against the full schema, including `required`. A required field with no default fails — Task 3 and Task 5 packages need a default on every required field (an `env:` ref is a valid secret default). `capabilities_cover_usage` records `models.client`, `credentials.resolve`, `state.session`, `host.ui`, and `slots.<slot>.provide` through a proxy over the real API, then also fails if load or the mock session throws `PackageLoadError` `capability_missing`. `no_secret_in_inspect` sets a sentinel only for unset `env:` refs; `keyring:` refs are skipped; a value already in the agent's redactor (via `credentials.resolve`) is masked and is not the leak this check catches — the failing fixture copies `process.env` into `status.note`. `no_leaks_after_dispose` waits one macrotask so a post-teardown `setTimeout` registration is visible. Services are not on `AgentInspection`; the loader deletes them in teardown (`src/packages/loader.ts`).
    - **Import deviation.** `hook-catalog-coverage.test.ts` and `hook-invariants.test.ts` import `../testing/index.js`, not `@arnilo/prism/testing`. `node_modules/@arnilo/prism` is a symlink to the repo root and `exports["."]` points at `dist`, so a specifier import from a src-tree `bun test` would load a stale build. The subpath itself resolves (`bun -e` import of `@arnilo/prism/testing` lists the twelve exports). `scripts/fixtures/e2e-full-surface-journey.mjs` imports the specifier.
    - **Baseline.** `node scripts/release.mjs gate --update-baseline` exited 0 (`updated: true`, 14 packages). Task 2 additions in `scripts/compat-baseline/arnilo__prism.txt`: `packageConformance`, `loopConformance`, `echoTool`, `textProvider`, `twoTurnProvider`, and types `ConformanceCheck`, `PackageConformanceCheckName`, `PackageConformanceOptions`, `PackageConformanceResult`, `LoopConformanceOptions`, `LoopConformanceResult`. No Task 2 removal. The rest of that diff, and the sibling baseline files, is the uncommitted Phase 1–2 train versus HEAD (`0.12.1`), regenerated in the same gate run — not a retirement from this task.
    - **Verification.** `bun run build:core` and `bun x tsc --noEmit -p tsconfig.json` clean. `package-conformance` 6/0 (includes the 1s budget). `hook-catalog-coverage` + `hook-invariants` 38/0 from `src` and the same three suites 44/0 from `dist`. `e2e-coverage` and `phase54-package-map` re-run after the total bump and evidence regen (see the command log in the session). `packaging` + `public-export-contract` 319/1: the one fail is the inherited `@arnilo/prism-agent-sdk` peer-dependency guard (plan 144 Notes: the in-flight manifest moved `@arnilo/prism` into `dependencies`). Confirmed pre-existing by stashing this task's tracked changes; the stashed tree failed a different packaging assert only because `dist` was built from the unstashed sources.
    - **Later tasks.** Task 5's `hooks_json_passes_package_conformance` can call `packageConformance` directly. Task 6 still deletes `src/testing/extension-conformance.ts` and the `./testing/extension-conformance` subpath; this task did not touch it. Adding another root export surface must bump `scripts/e2e-coverage.test.mjs` `summary.total` (now 114).

- [x] Task 3: Family extensions become packages — memory, impeccable, and Prism Code wiki
  - Acceptance Criteria:
    - Functional: Each `create*Extension` becomes a `definePackage` definition exported under a package-shaped name, and each passes `packageConformance`:
      - `createLlmCompactionExtension` → `llmCompaction`. Task 1 found no registrar side calls, so it declares no `slot:compaction` and provides no slot. The compactor stays `createLlmCompactor` on `slots.compaction`.
      - `createObservationalMemoryExtension` → `observationalMemory`
      - `createWikiExtension` → `wiki`
      - `createImpeccableExtension` → `impeccable`
    - Functional: Each conversion follows the same rules:
      - Config moves from factory options to a JSON Schema with defaults.
      - Function-valued options (fetchers, hooks) stay as factory arguments: `wiki({ fetch })` returns an instance with the code-only options bound, and the schema covers the JSON part.
    - Functional: `packages/prism-code/src/wiki.ts` passes `wiki(...)` in `createAgent({ packages })` and no longer builds an extension kernel. Prism Code's wiki tests stay green.
    - Functional: Package registration uses `PackageCommand` (`asPackageCommand` strips unsupported schema keywords such as `format`). The command factories still return `CommandDefinition` for the TUI slash path and the CLI, which need `CommandExecutionContext.drivers`. `src/rpc.ts` keeps `CommandDefinition` (Task 1). Package names are dotted (`@arnilo/prism-memory.wiki`) because `definePackage` rejects slash names.
    - Performance: No change in per-run work. Each package does in `setup` what its extension did.
    - Code Quality:
      - The old factory names are deleted, with no alias, along with their exports in each family package's `index.ts` and subpaths.
      - Every caller migrates in this task, including tests and examples (`examples/observational-memory-recall-status-view.ts`, `examples/caveman-ponytail.ts`, `examples/impeccable.ts`).
    - Security: The wiki package's URL ingest keeps the SSRF guard (`assertSsrfAllowedUrl`), and a test proves it still rejects a private address through the package path.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/compaction/llm/extension.ts:11`, `packages/memory/src/compaction/observational-memory/extension.ts:11`, `packages/memory/src/wiki/extension.ts:25`, `packages/prism-coding-tools/src/impeccable/extension.ts:8`
      - `packages/prism-code/src/wiki.ts:92-130`
      - `roadmap.md` §2.11 (OM package sketch) and §4 "Moving 0.12 code into a package"
      - Task 1(f)
    - Options Considered:
      - Delete the family extensions and leave the capability gap until Phase 8. Rejected: Prism Code's wiki would regress for several phases.
      - Move them into native packages now (`packages/memory/{wiki,observational}`). Rejected: that is Phase 8's scope, with its own design (models client, compaction slot ownership).
    - Chosen Approach:
      - Convert in place inside the family packages, so the behavior is unchanged and the mechanism is the new one. Phase 8 moves them into native packages.
    - API Notes and Examples:
      ```ts
      import { wiki } from "@arnilo/prism-memory/wiki";
      const agent = await createAgent({ model, packages: [wiki({ fetch: guardedFetch })], packageConfig: { "@arnilo/prism-memory/wiki": { root: ".wiki" } } });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/llm/extension.ts`, `packages/memory/src/compaction/observational-memory/extension.ts`, `packages/memory/src/wiki/extension.ts`: rewrite. Rename to `package.ts` if Task 1 finds no external path import.
      - `packages/memory/src/**/index.ts`: exports.
      - `packages/prism-coding-tools/src/impeccable/extension.ts`, `packages/prism-coding-tools/src/impeccable/index.ts`
      - `packages/prism-code/src/wiki.ts` and its tests.
      - The tests in `packages/memory/src/**/__tests__` and `packages/prism-coding-tools/src/impeccable/__tests__` listed by Task 1.
      - `examples/observational-memory-recall-status-view.ts`, `examples/caveman-ponytail.ts`, `examples/impeccable.ts`
      - `scripts/compat-baseline/arnilo__prism-memory.txt`, `arnilo__prism-wiki.txt`, `arnilo__prism-compaction-llm.txt`, `arnilo__prism-compaction-observational-memory.txt`, `arnilo__prism-coding-tools.txt`, `arnilo__prism-impeccable.txt`: regenerate with `node scripts/release.mjs gate --update-baseline`. The diff goes in the Notes.
      - `packages/memory/README.md`, `packages/prism-coding-tools/README.md`: usage snippets.
      - `CHANGELOG.md`
    - References:
      - plan 145 Task 4 (instruction-injection migration in the same family modules)
  - Test Cases to Write:
    - `<module>_passes_package_conformance`: one per converted module.
    - `wiki_package_rejects_private_url`
    - `om_package_registers_recall_only_when_enabled`: OM's existing recall gating, now through `when`.
    - Prism Code's `wiki` tests, re-pointed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the family package exports change.
    - Docs pages to create/edit:
      - `packages/memory/README.md`, `packages/prism-coding-tools/README.md`: update their factory snippets to the package form. The released `/docs` pages stay on 0.12.1.
      - `CHANGELOG.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Shipped.** `llmCompaction`, `observationalMemory`, `wiki`, and `impeccable` replace the four `create*Extension` factories. No aliases. JSON fields are package config; `fetchUrl`, `extractDocument`, `recallTool`, and `commands` stay factory arguments. `packages/prism-code/src/wiki.ts` returns `wiki(...)` and no longer builds an extension kernel. `defineAgent` forwards `packages`. Headless and ACP list the instance and do not also add wiki tools or skills (that would `tool_conflict` / `skill_conflict`). Slash commands still come from the `CommandDefinition` factories so `/wiki-ingest` can pass host drivers. The package registers the same commands without drivers.
    - **Names.** The plan example `@arnilo/prism-memory/wiki` is not a valid npm name (`src/packages/define.ts` `NPM_NAME` allows one scope slash). Shipped names: `@arnilo/prism-memory.llm-compaction`, `@arnilo/prism-memory.observational-memory`, `@arnilo/prism-memory.wiki`, `@arnilo/prism-coding-tools.impeccable`.
    - **Recall gating.** `observationalMemory` registers `recall` only when `recallTool` is passed, with `when: () => config.recall !== false`. Default `recall` is true, so existing factory callers stay visible. `recall: false` hides the tool from the provider request.
    - **LLM package.** Empty `setup`. No `slot:compaction` capability. Hosts still assign `createLlmCompactor`.
    - **SSRF.** `wiki_package_rejects_private_url` runs `wiki-ingest` through `agent.commands` with a `fetchUrl` hook. `http://127.0.0.1` throws before the hook. The guard is still `assertSsrfAllowedUrl` in `packages/memory/src/wiki/ingest.ts`.
    - **Baseline.** `node scripts/release.mjs gate --update-baseline` then `gate` (`updated: false`). Task 3 removals in `scripts/compat-baseline/arnilo__prism-memory.txt`: `createLlmCompactionExtension`, `createObservationalMemoryExtension`, `createWikiExtension`, `LlmCompactionExtensionOptions`. Additions: `llmCompaction`, `observationalMemory`, `wiki`. `arnilo__prism-coding-tools.txt`: `createImpeccableExtension` → `impeccable`. Subpath snapshots `arnilo__prism-wiki.txt`, `arnilo__prism-impeccable.txt`, `arnilo__prism-compaction-llm.txt`, and `arnilo__prism-compaction-observational-memory.txt` are not produced by the gate; the retired factory rows were edited by hand. The rest of those files, and the other baseline churn versus HEAD, is the uncommitted Phase 1–2 train.
    - **Verification.** Memory wiki/OM/llm package tests, impeccable tests, Prism Code `web-wiki` and `integration`, and `dist/__tests__/package-setup-boundaries.test.js` pass. `examples/impeccable.ts` and `examples/observational-memory-recall-status-view.ts` run. Released `/docs` still name the old factories (0.12.1). `docs.test.ts` still pins `createImpeccableExtension` there.
    - **Later tasks.** Task 6 still deletes the extension kernel. Do not reintroduce the old factory names. A package name with a subpath slash will not load.

- [x] Task 4: Provider factories become packages
  - Acceptance Criteria:
    - Functional: Every `create<Vendor>ProviderPackage` in `packages/prism-providers/src/*` returns a `PackageInstance` built with `definePackage`. This covers alibaba, anthropic, azure, bedrock, clinepass, commandcode, deepseek, google, hyper, kimi, neuralwatt, ollama, openai, opencode-go, openrouter, vertex, xai, zai, typesafe, and laya.
      - The package name is the dotted subpath id (`@arnilo/prism-providers.anthropic`). `definePackage` rejects `@arnilo/prism-providers/anthropic` (one scope slash only).
      - It registers its provider with `providers.register`.
      - Model lists and auth descriptors stay as the module exports that Task 1(c) confirmed (`anthropicModels`, …), with no registry.
    - Functional: Each factory is renamed to `<vendor>Package`, for example `anthropicPackage({ apiKey })`. The old `create*ProviderPackage` names are deleted, with no alias.
    - Functional: A provider package loaded into `createAgent` lets `model: { provider: "<id>", … }` resolve without `AgentConfig.provider`. A test covers one vendor on a mocked fetch.
    - Functional: Credential values stay function or ref options, never literal config. Where the JSON config holds a key, it is an `x-prism-secret` ref.
    - Functional: Every caller migrates in this task: the vendor tests, `examples/provider-*.ts`, `examples/neuralwatt-agent-run.ts`, `examples/openrouter-model-cache-override.ts`, and any `src/__tests__` that load a provider package.
    - Performance: Loading one vendor package evaluates no other vendor module. A test imports one subpath and asserts that the module graph excludes its siblings.
    - Code Quality: No vendor imports a sibling vendor. Shared wire code stays where it is until Phase 5's `provider-kit`.
    - Security: A test loads `anthropicPackage` with a real-looking key through a function option and asserts that the key is absent from `inspect()` and events.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-providers/src/anthropic/index.ts:15-35` (the shape repeated per vendor)
      - `roadmap.md` §2.9 (provider packages; vendors port in Phase 5) and §4 "Provider package"
      - Task 1(c)
    - Options Considered:
      - Move `ProviderPackage` and `defineProviderPackage` into `@arnilo/prism-providers` as a local type. Rejected: `ProviderPackageAPI extends ExtensionAPI`, which Task 6 deletes, so the local copy would re-create the extension API in a family package.
      - Port vendors to `packages/providers/<vendor>` now. Rejected: that is Phase 5, together with the `ModelProvider` contract, discovery, and auth descriptors.
    - Chosen Approach:
      - A mechanical per-vendor rewrite onto `definePackage` + `providers.register`. Phase 5 later moves each one out with its catalog and auth.
    - API Notes and Examples:
      ```ts
      import { anthropicPackage, anthropicModels } from "@arnilo/prism-providers/anthropic";
      const agent = await createAgent({ model: anthropicModels[0], packages: [anthropicPackage({ apiKey: () => process.env.ANTHROPIC_API_KEY })] });
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/*/index.ts` (and `provider.ts` for azure, bedrock, and vertex), plus each vendor's `__tests__`.
      - `examples/provider-registration.ts`, `provider-resolver.ts`, `provider-clinepass.ts`, `provider-deepseek.ts`, `provider-xai.ts`, `neuralwatt-agent-run.ts`, `openrouter-model-cache-override.ts`
      - `scripts/compat-baseline/arnilo__prism-providers.txt` and every `arnilo__prism-provider-*.txt`: regenerate. The diff goes in the Notes.
      - `packages/prism-providers/README.md`: registration snippet.
      - `CHANGELOG.md`
    - References:
      - `src/provider-packages.ts` (retired in Task 6)
  - Test Cases to Write:
    - `<vendor>_package_registers_provider`: one parametrized test over every vendor.
    - `provider_package_resolves_model_without_host_provider`
    - `loading_one_vendor_never_evaluates_another`
    - `provider_key_never_surfaces`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — vendor factory names.
    - Docs pages to create/edit:
      - `packages/prism-providers/README.md`
      - `CHANGELOG.md`
      - Released `/docs/providers*.md` stays on 0.12.1.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Shipped.** Every `create<Vendor>ProviderPackage` is `<vendor>Package` and returns a `PackageInstance`. Setup calls `providers.register` only. Model lists and auth descriptors stay module exports. No model or auth registry. `azurePackage` replaces `createAzureOpenAIProviderPackage`. `opencodeGoPackage` replaces `createOpenCodeGoProviderPackage`. Credentials stay factory arguments. `options.models` remains on the option types so callers compile, and is not registered.
    - **Names.** Same npm-name rule as Task 3. Shipped `@arnilo/prism-providers.<vendor>`, not `@arnilo/prism-providers/<vendor>`.
    - **Callers.** Vendor tests load through `createAgent`. Catalog asserts read the exports. Examples, root README, the provider scaffold, `package-setup-boundaries`, and `scripts/packaging-current.test.mjs` use the new factories. Released `/docs/providers*.md` still name the old factories. `docs.test.ts` still pins those pages.
    - **Baseline.** `node scripts/release.mjs gate --update-baseline` then `gate` (`updated: false`). `scripts/compat-baseline/arnilo__prism-providers.txt` removes all 20 `create*ProviderPackage` rows and adds the `<vendor>Package` rows (`PackageInstance`). Subpath snapshots `arnilo__prism-provider-*.txt` are not produced by the gate; the retired factory rows were renamed by hand. Other baseline churn versus HEAD is the uncommitted Phase 1–2 train.
    - **Verification.** `bun x tsc --noEmit` clean. Vendor unit tests for the edited suites pass. `packages/prism-providers/src/__tests__/vendor-packages.test.ts` covers registration for every vendor, model resolution without `AgentConfig.provider`, the secret-absence check, and the anthropic bundle excluding sibling vendors. Examples `provider-xai`, `provider-deepseek`, `provider-clinepass`, `provider-registration`, `provider-resolver`, `openrouter-model-cache-override`, and `neuralwatt-agent-run` run.
    - **Later tasks.** Task 6 still deletes `defineProviderPackage`. Do not reintroduce the old factory names. Phase 5 owns auth descriptors and `packages/providers/<vendor>`.

- [x] Task 5: `@arnilo/prism-hooks-json`, the first native package
  - Acceptance Criteria:
    - Functional: `packages/hooks` moves with `git mv` to `packages/integrations/hooks-json` and is renamed `@arnilo/prism-hooks-json`.
      - The default export is `definePackage({ name: "@arnilo/prism-hooks-json", requires: { prism: "^0.12.1 || ^0.13.0-0" }, capabilities: [...], config, setup })`.
      - `config` is the `hooks.json` shape as a JSON Schema (`hooks`, `allowCommands`, hash pins, timeouts), replacing `parseHooksConfig` as the validation path.
      - `parseHooksConfig` stays exported only if Task 1 finds a non-loader caller.
    - Functional: Every Claude/Codex event mapping still compiles onto the same hooks (`context.build`, `run.input`, `tool.call`, `tool.result`, `run.end`), and the existing `compile.test.ts` and `schema.test.ts` assertions pass through the package path.
    - Functional: `SessionStart` maps to `session.opened` (plan 146 Task 7), replacing the first-`context.build` piggyback recorded in plan 145. The backlog item "Add session-lifecycle hooks if Phase 2 needs them" is closed in the task note.
    - Functional: Callers migrate in this task:
      - `packages/agent-sdk/src/planes/hooks.ts` passes `hooksJson(...)` in `packages`.
      - `packages/agent-sdk/package.json` and `packages/prism-code/package.json` depend on `@arnilo/prism-hooks-json`.
      - `examples/hooks-json.ts` and `examples/tsconfig.json` are updated.
    - Functional: The package passes `packageConformance`, which is a roadmap Done criterion.
    - Functional: These tooling assumptions change in this task, because this is the first grouped, source-exported package (create-plan `references/prism.md` §5):
      - Root `package.json` `workspaces` replaces `packages/hooks` with `packages/integrations/hooks-json`. The `build` script loop drops `@arnilo/prism-hooks`. The package has no `build` script, so `bun run --filter … build` is skipped for it.
      - `scripts/package-truth.mjs` `workspaceShape` / `workspacePackageCounts` resolve grouped directories, and `scripts/package-truth.json` counts are updated.
      - `src/__tests__/packaging.test.ts` package list: replace `packages/hooks`. A TypeScript-source export target (`./src/index.ts`) passes without a sibling `.d.ts`.
      - `src/__tests__/public-export-contract.test.ts`: the same source-export allowance.
      - `scripts/independent-packages.json`: record the decision. `hooks-json` is lockstep until Phase 11, or independent, with the reason written in the Notes.
      - `scripts/compat-baseline/arnilo__prism-hooks-json.txt`: new. `arnilo__prism-hooks.txt`: removed, attributed to this plan.
      - `scripts/e2e-coverage.json`, `scripts/coverage-thresholds.json`, `scripts/budgets.json`, `scripts/release-evidence.json`, and the phase/packaging `scripts/*.test.mjs` that name `@arnilo/prism-hooks`, using the list from Task 1.
    - Performance: Command handlers keep their async queue and timeouts. Loading the package spawns nothing until a hook fires.
    - Code Quality:
      - The layout is `package.json`, `src/index.ts`, `src/__tests__/`, `README.md`, `CHANGELOG.md`, and `LICENSE`. There is no `tsconfig` build and no `dist`.
      - `"exports": { ".": "./src/index.ts" }`, `"files": ["src", "!src/**/__tests__", "README.md", "CHANGELOG.md", "LICENSE"]`, and `"peerDependencies": { "@arnilo/prism": … }`.
    - Security:
      - Command hooks keep the allow-list and hash pinning (`hookCommandHash`). A command not on the allow-list fails closed at load with `PackageLoadError` `config_invalid`, not at fire time.
      - Env values are passed only as refs.
      - A test proves that a hook command's stdout containing a configured secret is redacted in events.
  - Approach:
    - Documentation Reviewed:
      - `packages/hooks/src/compile.ts:170-434`, `packages/hooks/src/schema.ts`
      - `packages/agent-sdk/src/planes/hooks.ts:1-60`
      - `roadmap.md` §2.9 (`hooks-json` row), §2.10 (repository structure), Phase 2 "First native package", and §1.4 (Bun-native)
      - create-plan `references/prism.md` §4 "New native package" and §5
    - Options Considered:
      - Create a new package and leave `packages/hooks` in the tree until Phase 11. Rejected: that is two copies of the compiler, and §4 "Moving 0.12 code" says to move the code and delete the old export. The published 0.12.1 `@arnilo/prism-hooks` tarball is unaffected.
      - Keep the `dist` build for the new package. Rejected: §1.4 says native packages publish TypeScript source.
    - Chosen Approach:
      - `git mv` keeps history, followed by an in-place rewrite of `compile.ts`'s `setup` onto `PackageAPI`. Then update the tooling assumptions once, here, so later native packages need only list rows.
    - API Notes and Examples:
      ```ts
      import hooksJson from "@arnilo/prism-hooks-json";
      const agent = await createAgent({ model, packages: [hooksJson], packageConfig: { "@arnilo/prism-hooks-json": JSON.parse(await Bun.file(".claude/hooks.json").text()) } });
      ```
    - Files to Create/Edit:
      - `packages/hooks/**` → `packages/integrations/hooks-json/**` (move), with `package.json`, `src/index.ts`, `src/compile.ts`, and `src/__tests__/*` rewritten.
      - `packages/integrations/hooks-json/README.md`: rewritten in the package page structure, including a manifest entry example.
      - `packages/agent-sdk/src/planes/hooks.ts`, `packages/agent-sdk/package.json`, `packages/prism-code/package.json`
      - `examples/hooks-json.ts`, `examples/tsconfig.json`, `examples/README.md`
      - Root `package.json`, `scripts/package-truth.mjs`, `scripts/package-truth.json`, `scripts/independent-packages.json`, `src/__tests__/packaging.test.ts`, `src/__tests__/public-export-contract.test.ts`, `src/__tests__/install-smoke.test.ts`
      - The `scripts/*.json` and `scripts/*.test.mjs` files above.
      - `scripts/compat-baseline/arnilo__prism-hooks-json.txt` (new) and `arnilo__prism-hooks.txt` (removed).
      - `CHANGELOG.md`
      - `docs/release-and-install.md`: package list row only if the release checklist enumerates workspaces. The released prose about `@arnilo/prism-hooks` stays.
    - References:
      - plan 145 Task 5 Notes (SessionStart piggyback)
      - plan 140 (independent versioning decision record)
  - Test Cases to Write:
    - `hooks_json_passes_package_conformance`: a roadmap Done criterion.
    - The existing compile and schema suites, re-run through `createAgent({ packages: [hooksJson] })`.
    - `session_start_maps_to_session_opened`
    - `unlisted_command_fails_closed_at_load`
    - `hook_command_output_is_redacted`
    - `packaging_accepts_source_export_package`: it fails if the packaging test still demands `dist/*.d.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package, and `@arnilo/prism-hooks` leaves the tree.
    - Docs pages to create/edit:
      - `packages/integrations/hooks-json/README.md`: package page structure.
      - `examples/README.md`
      - `CHANGELOG.md`
      - Released `docs/hooks.md` stays on 0.12.1.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Shipped.** `git mv packages/hooks packages/integrations/hooks-json`. Package name `@arnilo/prism-hooks-json`. Default export is `definePackage`. No `dist`, no `tsconfig`. `"exports": { ".": "./src/index.ts" }`. `parseHooksConfig` and `createHooksExtension` are gone from the entry. `hookCommandHash` stays. Config is the hooks.json JSON Schema (`hooks` or flat events, `allowCommands`, `env` refs, timeouts). `SessionStart` registers `session.opened`. The other events stay on `run.input`, `tool.call`, `tool.result`, `run.end`, and `context.build` drains queued context. Backlog item "Add session-lifecycle hooks if Phase 2 needs them" is closed: `session.opened` is the mapping.
    - **Trust.** A command not on `allowCommands` throws `PackageLoadError` `config_invalid` at load. `allowCommands: "all"` still warns. Env values are `env:` / `keyring:` refs, resolved through `credentials.resolve`, so a hook command's stdout that echoes the secret is redacted in events (`hook_command_output_is_redacted`).
    - **Lockstep.** `hooks-json` stays lockstep until Phase 11. Recorded in `scripts/independent-packages.json` and not added to the independent list. It ships on the kernel line.
    - **Tooling.** Root workspaces and the build loop updated. `workspaceShape`, `loadRelease`, and `measureExportCounts` walk `packages/<group>/<name>`. Packaging and the public-export contract allow a TypeScript-source export without a sibling `.d.ts`. The compat gate emits declarations for a source package into `.types` (gitignored) because it still diffs `.d.ts`. `arnilo__prism-hooks.txt` removed. `arnilo__prism-hooks-json.txt` added (35 lines). `bun` writes a wrong relative symlink for this nested `file:../../..` devDependency; `postinstall` relinks it to the repo root.
    - **Baseline.** `node scripts/release.mjs gate --update-baseline` then `gate` (`updated: false`, 14 packages). Other baseline churn versus HEAD is the uncommitted Phase 1–2 train.
    - **Verification.** Package suites 29/0. `examples/hooks-json.ts` runs. Agent SDK hooks plane returns a package instance. `phase54` and `e2e-coverage` pass.
    - **Inherited red, not this task.** `budget-gate` still fails on `@arnilo/prism` export growth (+55) and `@arnilo/prism-providers` (+2), and `phase24` expects 12 core peers while `@arnilo/prism-agent-sdk` peers none (moved to dependencies in the in-flight train). Root tarball diet is the same inherited miss.
    - **Later tasks.** Task 6 still deletes the extension kernel. `session.opened` is observe-only, so the kernel does not await `SessionStart` before the first `context.build`. Context that finishes in time is injected; a slow command lands on a later turn. Do not put the piggyback back.

- [x] Task 6: Delete the 0.12 extension surface
  - Acceptance Criteria:
    - Functional: These are deleted:
      - `src/extensions.ts`, `src/contributions.ts`, `src/manifests.ts`, and `src/provider-packages.ts`
      - `src/contracts-core/extensions.ts`, except the types Task 1 kept: the `AuthMethod`/OAuth types used by `src/oauth-device-code.ts` and Prism Code `oauth.ts`, `SystemPromptContribution` if it still has a caller, and `DiscoveredContribution` for skill discovery. Those move to their owning module.
      - `src/testing/extension-conformance.ts`
    - Functional: The remaining callers migrate in this task:
      - `src/cli-runner.ts`
      - `src/agent-definitions.ts` and `src/node/agent-definitions.ts`, per Task 1(b)
      - `src/resources.ts`, per Task 1(d)
      - `packages/agent-sdk/src/planes/skills.ts`, which uses `skills.addDir` and `discoverContributions`
      - `examples/extensions.ts` and `examples/extension-package.ts`, which become a pointer to `examples/define-package.ts` or are deleted, with `examples/README.md` and `scripts/e2e-coverage.json` updated
      - `examples/manifests.ts`, deleted because the old contribution manifest is gone and Phase 4 adds the new one
      - `examples/discover-skills.ts` and `examples/memory-fabric.ts`
      - every `src/__tests__` file from Task 1, rewritten onto `definePackage` or deleted when it only tested the retired mechanism
    - Functional: The repo-wide sweep returns nothing outside the exclusions:
      ```bash
      rg -n "createExtensionKernel|activateKernel|forwardAgentEvents|ExtensionKernel|ExtensionAPI|\bExtension\b|ContributionRegistr|registerDiscoveredContributions|PrismManifest|definePrismManifest|parsePrismManifest|ProviderPackage|defineProviderPackage|extension-conformance|create[A-Za-z]*Extension\(|create[A-Za-z]*ProviderPackage\(" src packages apps scripts examples docs --glob '!**/dist/**' --glob '!docs/history/**' --glob '!docs/_evidence/**'
      ```
      Released `/docs` pages and historical CHANGELOG sections are listed in the Notes as intentional residue.
    - Functional: `src/__tests__/docs.test.ts` drops only the pin rows that tie released pages to removed exports, and each dropped row is named in the Notes.
    - Functional: `src/__tests__/package-api-freeze.test.ts` (new) pins the `PackageAPI` member names, the `Capability` union, the `PackageLoadError` codes, and the `AgentConfig` package fields for Phase 3. Each failure message names `docs/next/packages.md`.
    - Performance: n/a — deletion. The root barrel shrinks, and the packed-bytes budget in `scripts/budgets.json` is re-measured and lowered if the gate requires it.
    - Code Quality: No alias, no deprecated re-export, and no `@deprecated` stub.
    - Security: Every trust path from Task 1's security list is either replaced (and named) or recorded as intentionally dropped, in the task note and under Compromises Made.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 2 "Remove", §1.4 "No compatibility aliases", and §2.9 Retired
      - Task 1 caller map
    - Options Considered:
      - Delete in Task 3/4 alongside the conversions. Rejected: `cli-runner`, agent-definitions, and the examples still compile against the registries until every conversion has landed, so an earlier delete would leave the tree red.
    - Chosen Approach:
      - Delete once there are no remaining callers, then sweep, regenerate the baseline, and freeze.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline
      git diff --stat scripts/compat-baseline/
      ```
    - Files to Create/Edit:
      - Delete: the files listed in Functional.
      - Edit: `src/index.ts`, `src/contracts-core.ts` / `src/contracts.ts` barrels, `src/cli-runner.ts`, `src/agent-definitions.ts`, `src/node/agent-definitions.ts`, `src/resources.ts`, `src/contracts-core/agent.ts`, `packages/agent-sdk/src/planes/skills.ts`, and the examples and tests from Task 1.
      - `src/__tests__/package-api-freeze.test.ts`: new.
      - `src/__tests__/public-export-contract.test.ts`: deliberate root-export freeze update.
      - `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`, `arnilo__prism-code.txt`: regenerate. The removals go in the Notes, attributed to this plan.
      - `docs/next/packages.md`: a "Frozen for Phase 3" section.
      - `CHANGELOG.md`: a removal entry listing every retired name.
      - `plans/README.md`: status for plans 146 and 147.
    - References:
      - plan 145 Task 6 (catalog freeze pattern)
  - Test Cases to Write:
    - `package_api_is_frozen_for_phase_3`: it fails on any member rename, addition, or removal.
    - `package_load_error_codes_are_frozen`
    - `root_barrel_exports_no_extension_names`: an explicit negative list, so a re-added export fails.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removals.
    - Docs pages to create/edit:
      - `docs/next/packages.md`: freeze section.
      - `CHANGELOG.md`
      - Released `/docs/extensions.md`, `/docs/hooks.md`, and the provider pages stay on 0.12.1.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):
    - **Shipped.** Deleted `src/extensions.ts`, `src/contributions.ts`, `src/manifests.ts`, `src/provider-packages.ts`, `src/testing/extension-conformance.ts`, and `src/contracts-core/extensions.ts`. No alias. `SystemPromptContribution` moved to `src/contracts-core/system-prompt.ts`. `DiscoveredContribution` moved to `src/contracts-core/discovery.ts`. `OAuthCredentials`, `OAuthLoginCallbacks`, and `OAuthProvider` moved to `src/contracts-core/resources.ts`. `AuthMethod` is retired. `./testing/extension-conformance` is gone from `package.json` exports.
    - **Callers.** CLI `--extension` loads a `definePackage` definition or instance (`default` or `createPackage()`). The allow-list and cwd-containment gates stay. `--discover` takes realized skills off `discoverContributions` and does not build a registry. `resolveAgentDefinition` no longer takes `registries`. The repoTools descriptor stubs are gone. `loadManifestResource` is gone. The agent SDK skills plane registers discovered skills directly. `defineAgent` keeps a plain command list. `examples/extensions.ts`, `examples/extension-package.ts`, and `examples/manifests.ts` are deleted. `examples/discover-skills.ts`, `examples/memory-fabric.ts`, and `examples/caveman-ponytail.ts` use packages or direct lists.
    - **Kept declaration.** `DiscoveredContribution.declaration` stays. `loadInstructionSources` reads `module`, `exportName`, and `resource`. Task 1 thought only the repoTools scope read it. The old `ManifestContributionDeclaration` name is gone.
    - **Dropped pin rows** in `src/__tests__/docs.test.ts` (released pages still name the exports): `definePrismManifest`, `parsePrismManifest`, `loadManifestResource`, `createContributionRegistry`, `createContributionRegistries`, `createExtensionKernel`, `createExtensionEventBus`, and the `docs/extension-conformance.md` subpath row.
    - **Trust.** `ExtensionLoadPolicy` and the `extension:setup` permission check are deleted. Neither had a production caller. Phase 4's trust callback replaces both. CLI path trust stays. hooks.json allow-list and hash pinning stay in `@arnilo/prism-hooks-json`.
    - **Baseline.** After `bun run build:core` and deleting stale `dist` outputs (`tsc` does not remove deleted files), `node scripts/release.mjs gate --update-baseline` then `gate` (`updated: false`, 14 packages). Removals from `arnilo__prism.txt`, this plan: `activateKernel`, `createExtensionKernel`, `createExtensionEventBus`, `forwardAgentEvents`, `createContributionRegistries`, `registerDiscoveredContributions`, `definePrismManifest`, `parsePrismManifest`, `defineProviderPackage`, `loadManifestResource`, `assertExtensionConforms`, and the `ExtensionKernel` / `ContributionRegistries` / `PrismManifest` type rows. Other baseline churn versus HEAD is the uncommitted Phase 1–2 train.
    - **Sweep.** Released `/docs` pages and historical CHANGELOG sections still name the old surface. That is the 0.12.1 contract. The negative list in `src/__tests__/package-api-freeze.test.ts` names the retired exports on purpose. `*ProviderPackageOptions` and `loadProviderPackage` match the sweep's `ProviderPackage` substring and are not the retired type. `scripts/phase24-freeze-manifest.json` matches the word "extension" in historical evidence text.
    - **Verification.** `bun x tsc --noEmit` clean, including `examples/tsconfig.json`. Freeze test 3/0. CLI extension suite 8/0. `examples/define-package.ts` runs. Public export freeze matches `src/index.ts`. Release gate `updated: false`.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`
- `bun test packages/integrations/hooks-json`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 src/__tests__/package-api-freeze.test.ts src/__tests__/hook-catalog-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun examples/hooks-json.ts && bun examples/define-package.ts`
- The Task 6 `rg` sweep, which returns only the listed residue.
- `node scripts/release.mjs gate`

## Compromises Made

- `ExtensionLoadPolicy` and the `PermissionPolicy` `extension:setup` check are gone. Neither had a production caller. Phase 4's integrity check and trust callback replace them. Recorded so the drop is not silent.
- `session.opened` is observe-only. A slow `SessionStart` command can miss the first `context.build`. The kernel does not await observe hooks. Do not put the piggyback back.

## Further Actions

- Per-suite testing subpaths (`./testing/provider-conformance` and the other conformance helpers) stay until Phases 5 and 6 consolidate them into `@arnilo/prism/testing`. Priority: those phases. (Task 2)
- Whole-plan `bun run build && bun run --workspaces --if-present test` was not run in this task. Run it before a release cut. Priority: before Phase 11.
