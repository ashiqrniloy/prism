# Phase 11 Part C — green baseline, a coverage gate that sees every package, and version truth

## Objectives

- Turn the six red kernel tests green at their cause, so plans 177–180 start from a green `bun run test`.
- Make the per-package coverage gate discover the grouped `packages/<group>/<name>` layout, and record an evidence-based threshold for every 0.13.0 package.
- Make each package's runtime version (`definePackage({ version })`, `serverVersion` defaults) come from its `package.json`, with a gate that fails on drift.
- Remove retired package names from the shipped `templates/` tree.

## Expected Outcome

- `bun test --timeout=0 --path-ignore-patterns='packages/**' src/__tests__` reports 0 failures (today: 1817 pass / 6 fail on the 2026-10-15 tree).
- `bun run test:coverage` measures all 59 workspaces under `packages/` (today it finds 0, `scripts/coverage-summary.mjs:227`), and `scripts/coverage-thresholds.json` has one row per workspace and no retired rows.
- No source file declares a package version literal: `definePackage` versions resolve from `package.json`; `version_literal_gate` fails on a reintroduced literal.
- `templates/**` and `scripts/e2e-coverage.json` name no retired package.

This plan is a pre-publish part of roadmap **Phase 11**. It runs **first** of plans 176–180 because those plans' verification needs a green suite, and it **blocks plan 175 Task 10**. It changes no kernel hook, slot, primitive, or `PackageAPI` member, so it has no phase review. Task 5 deletes the 0.12 `CommandDefinition` family (a root export removal that a red kernel gate depends on) and regenerates the baseline in that task. No version bump or publish. Lab impact: n/a (plan 173 deleted `packages/prism-code`); `bun run --filter @arnilo/prism-agent test` stays green after every task. Cost knobs: n/a.

**Closed at Task 5 (2026-10-16).** Task 6 moved to plan 181 Task 2 when the 0.13.0 release plans were put in execution order (181 → 187).

## Tasks

- [x] Task 1: Coverage gate discovers grouped workspaces
  - Acceptance Criteria:
    - Functional: `scripts/coverage-summary.mjs` builds its workspace list from the root `package.json` `workspaces` through the existing `expandWorkspaceDirs` used by `scripts/run-all-tests.mjs:117-119`, so every `packages/<group>/<name>` and `apps/*` workspace with tests is measured.
    - Functional: `scripts/coverage-thresholds.json` is re-captured: two back-to-back runs, threshold = min(run1, run2) − 3 pp on lines (the file's documented rule), one row per measured workspace. Rows for retired names (`@arnilo/prism-code`, `-core`, `-agent-sdk`, `-coding-tools`, `-acp-agent`, `-work`, `-web-tools`, `-hooks`, `-providers`, …) are deleted. Protected packages (Postgres/NATS/OS-capability legs) keep `protectedException` with the reason.
    - Functional: A workspace with tests but no threshold row still fails the gate (unchanged fail-closed rule, `coverage-summary.mjs:237-252`); a new test proves the discovery cannot silently return zero workspaces.
    - Performance: Record the coverage stage wall time before and after in the note; the run uses the existing bounded pool.
    - Code Quality: One workspace-expansion helper shared by `run-all-tests.mjs` and `coverage-summary.mjs` (moved to `scripts/lib/workspaces.mjs` if it is not already importable). `expandWorkspaceDirs` in `scripts/package-truth.mjs` is already importable, so no extraction was needed.
    - Security: n/a — test tooling.
  - Approach:
    - Documentation Reviewed:
      - `scripts/coverage-summary.mjs:200-280`, `scripts/run-all-tests.mjs:110-180`, `scripts/coverage-thresholds.json` (`note` field rules), `docs/testing.md`.
    - Options Considered:
      - Globbing `packages/*/*`. Rejected: duplicates the workspace list and misses `apps/*`.
    - Chosen Approach:
      - Reuse the workspace expansion the test runner already trusts.
    - API Notes and Examples:
      ```bash
      bun run test:coverage   # lists every packages/<group>/<name> row with its gate
      ```
    - Files to Create/Edit:
      - `scripts/coverage-summary.mjs`, `scripts/run-all-tests.mjs` (import the shared helper), `scripts/lib/workspaces.mjs` (tentative; only if extraction is needed).
      - `scripts/coverage-thresholds.json`, `scripts/coverage-summary.json`.
      - `packages/*/*/bunfig.toml` (re-scope to `["../**"]`), `packages/hosts/evals/bunfig.toml` and `packages/hosts/devtools/bunfig.toml` (new).
      - `scripts/phase23-coverage.test.mjs` (or a new `scripts/coverage-discovery.test.mjs`).
      - `docs/testing.md`: coverage gate paragraph.
    - References:
      - review finding "The per-package coverage gate covers nothing" (2026-10-15).
  - Test Cases to Write:
    - `coverage_discovers_grouped_workspaces`: the discovered list equals the root `workspaces` expansion filtered to dirs with tests; fails if it returns `packages/<group>` dirs or zero entries.
    - `coverage_rows_match_workspaces`: every discovered workspace has a threshold row and every row names a discovered workspace.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test tooling.
    - Docs pages to create/edit:
      - `docs/testing.md`: describe the per-package gate over grouped workspaces.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **What changed.** `scripts/coverage-summary.mjs` discovers workspaces with `expandWorkspaceDirs(root, readManifest(root/package.json).workspaces)` — the same helper `scripts/run-all-tests.mjs:117` already imports — and exits 1 when discovery returns zero directories. The flat `readdirSync(packages/)` that saw only the group directories is gone; no `scripts/lib/workspaces.mjs` was needed because the helper is already importable from `scripts/package-truth.mjs`. All 59 gated workspace `bunfig.toml` files were re-scoped to `coveragePathIgnorePatterns = ["../**"]` (56 carried a stale `["../../../**"]`, one `["../../**"]`), and `packages/hosts/evals` plus `packages/hosts/devtools` gained the missing file. `scripts/phase23-coverage.test.mjs` mirrors the shared expansion and gains `coverage_discovers_grouped_workspaces` and `coverage_rows_match_workspaces`; its fail-closed test now uses a fake green `bun` (99.00 lines, exit 0) plus a sabotaged `@arnilo/prism-ag-ui` floor, so it stays a gate test (0.6 s) instead of a 4 m 16 s real run that flaked on one null row.
    - **Thresholds.** `scripts/coverage-thresholds.json` re-captured over all 59 workspaces from two back-to-back runs that agreed exactly on lines and functions; threshold = min(run1, run2) − 3 pp. Retired rows deleted. Protected rows: `@arnilo/prism-store-postgres`, `@arnilo/prism-memory-fabric` (PRISM_TEST_POSTGRES_URL durable legs) and `@arnilo/prism-tools-coding` (unshare/NETNS OS-capability legs).
    - **Wall time.** The workspace stage was effectively 0 s before (0 discovered suites). After: 2 m 49 s per 59-suite run; the standalone summary including its own core measurement is 4 m 16 s.
    - **Baseline diff.** None — no export moved. **Sweep.** n/a.
    - **Findings affecting later tasks.** The gate is fail-closed, so `test:coverage` stays red until every discovered suite is green. Four workspace suites are red on this tree, all from the 174/175 docs-and-layout retirement, none from discovery: `@arnilo/prism-provider-zai` (pins the deleted `docs/providers/zai.md`), `@arnilo/prism-memory-observational` (token fixture drift: entry `event` computes 35 vs the pinned 36), `@arnilo/prism-store-sqlite` (spawns node against the retired `src/persistence.js` path), `@arnilo/prism-memory-fabric` (`no_workspace_imports_prism_memory_family` finds `scripts/e2e-coverage.json` — Task 3 — and `scripts/deprecations-0.13.json`; its docs tripwire pins the deleted `docs/working-and-semantic-memory.md`). The kernel core row is red too (6 failures, Task 5). Task 6 below greens the four workspace suites so the plan verification can pass.

- [x] Task 2: Package versions have one source
  - Acceptance Criteria:
    - Functional: Each package's `definePackage` call reads its version from its own `package.json` (`import manifest from "../package.json" with { type: "json" }; … version: manifest.version`) instead of the literal `"0.12.1"` (31 occurrences, not 30: 28 `definePackage` calls plus the ACP `agentInfo`, the MCP server `serverVersion` default, and the `serve-tools` `new McpServer` identity).
    - Functional: `packages/hosts/mcp-server/src/serve.ts:65` defaults `serverVersion` to the package's `package.json` version.
    - Functional: `scripts/version-literal-gate.test.mjs` (create it if absent; plan 175's verification already names it) fails when any `definePackage`, `defineProviderPackage`, or `serverVersion` default under `packages/` or `apps/` uses a string-literal version.
    - Functional: `agent.inspect()` reports `0.13.0` for every first-party package (asserted for a sample of five).
    - Performance: n/a — a JSON import is resolved at module load once.
    - Code Quality: `tsconfig` `resolveJsonModule` is enabled where needed (the review of this task checks `tsconfig.packages.json`); no build step is added.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `packages/tools/coding/src/index.ts:84-90`, `src/packages/define.ts`, `tsconfig.packages.json`, Bun JSON import attributes.
    - Options Considered:
      - Only a gate that compares literals with `package.json`. Rejected: once packages version independently (plan 175 Task 10), every bump would need two edits.
    - Chosen Approach:
      - Import the version, gate against literals.
    - API Notes and Examples:
      ```ts
      import manifest from "../package.json" with { type: "json" };
      definePackage({ name: manifest.name, version: manifest.version, /* … */ });
      ```
    - Files to Create/Edit:
      - the 28 package sources with a literal (`definePackage`), plus `packages/hosts/acp/src/serve.ts`, `packages/hosts/mcp-server/src/serve.ts`, and `packages/hosts/mcp-server/src/serve-tools.ts`.
      - `tsconfig.packages.json` (needed: `resolveJsonModule` was off).
      - `scripts/version-literal-gate.test.mjs` (already existed from plan 071; extended).
      - `packages/memory/compaction/src/__tests__/index.test.ts` (asserted the old literal), `src/__tests__/agent-inspect.test.ts`, `packages/hosts/mcp-server/src/__tests__/serve.test.ts`.
      - `CHANGELOG.md`.
    - References:
      - review finding "30 packages declare version 0.12.1" (2026-10-15).
  - Test Cases to Write:
    - `version_literal_gate`: no literal versions; fails on a reintroduced `"0.12.1"`.
    - `inspect_reports_package_json_versions`.
    - `mcp_server_version_defaults_to_package`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — reported versions change from 0.12.1 to the real ones.
    - Docs pages to create/edit:
      - `CHANGELOG.md`: fix entry.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **What changed.** 31 hardcoded `"0.12.1"` versions became `manifest.version`, read from the package's own `package.json` via `import manifest from "../package.json" with { type: "json" }`: 28 `definePackage` calls, the ACP `agentInfo`, the MCP server `serverVersion` default, and the `serve-tools` `new McpServer` identity. `tsconfig.packages.json` gained `resolveJsonModule: true` (tsc 7.0.2 accepts the import attribute; `packages/tools/coding` and `packages/hosts/mcp-server` typecheck clean, and the 29 edited packages typecheck clean except a pre-existing hooks-json test error).
    - **Gate.** `scripts/version-literal-gate.test.mjs` already existed (plan 071) and was extended, not created. `definitionVersionProblems` scans non-test `src/**/*.ts` of every workspace for a `definePackage`/`defineProviderPackage` call with a literal `version`; a string-literal `name` that is not a workspace package is an in-process test/conformance package (`apps/prism-agent`, `packages/drivers/process/src/testing.ts`) and is allowed. `identityVersionProblems` covers `serverVersion ??`, `new McpServer`, and ACP `agentInfo`. Positive controls prove a reintroduced literal fails and the manifest read passes.
    - **Tests.** `inspect_reports_package_json_versions` (kernel, 5-package sample across stores/memory/context/hooks) and `mcp_server_version_defaults_to_package` (mcp-server, reads the client's `getServerVersion()`) are green, as is the gate (4/4). `packages/memory/compaction`'s `memory_compaction_package_entrypoint_is_a_definePackage_definition` asserted the old literal and now reads the manifest.
    - **Baseline diff.** None — no export moved. **Sweep.** n/a.
    - **Findings affecting later tasks.** Two stale package-identity literals are out of this task's `0.12.1` scope and are now covered by Task 6: the `prism-mcp-bridge` `new Client({ version: "0.0.12" })` identity (`packages/integrations/mcp/src/{bridge,capabilities}.ts`) and the AG-UI `hostInfo.version: "0.0.23"` (`packages/hosts/ag-ui/src/mcp-apps.ts`). `packages/integrations/hooks-json` fails `tsc` on two pre-existing test type errors (`compile.test.ts:35`, `package.test.ts:34`), unrelated to this task. The four workspace suites Task 6 lists stay red.

- [x] Task 3: Templates and coverage ledger name no retired package
  - Acceptance Criteria:
    - Functional: `templates/business-worker/manifest.json`, `templates/personal-assistant/manifest.json`, `templates/init/providers.json`, `templates/README.md`, and `scripts/e2e-coverage.json` reference current 0.13 packages (`@arnilo/prism-provider-*`, etc.) or are deleted if the template no longer applies (decide per file; record in the note).
    - Functional: `provider-kit > no_workspace_imports_prism_providers` passes.
    - Functional: Each kept template loads with `loadManifest` in a test (`templates_load`), so a template can never drift again.
    - Performance: n/a.
    - Code Quality: No allow-list exception is added for the templates or `scripts/e2e-coverage.json` — their content is fixed. The one entry added is `scripts/deprecations-0.13.json`, the live 0.13 registry deprecation ledger, which must name every retired package (Task 6 adds the same entry to the fabric scan).
    - Security: Template manifests carry refs only for secrets (asserted by `templates_load`).
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/provider-kit.test.ts:270-300`, `templates/**`, root `package.json` `files` (templates ship in the kernel tarball).
    - Options Considered:
      - Excluding `templates/` from the kernel tarball. Deferred: the CLI uses them; Further Actions if they turn out unused.
    - Chosen Approach:
      - Fix the content and add a load test.
    - API Notes and Examples:
      ```bash
      bun test --timeout=0 src/__tests__/provider-kit.test.ts src/__tests__/templates.test.ts
      ```
    - Files to Create/Edit:
      - `templates/**` (listed above), plus `templates/deep-research/{manifest.json,README.md.tmpl,src/tools.ts.tmpl,src/workflow.ts.tmpl,src/tests/research.test.ts.tmpl}` and `templates/business-worker/src/**` for the same retired-name fixes; `scripts/e2e-coverage.json`, `scripts/e2e-coverage.test.mjs`.
      - `src/__tests__/templates.test.ts` (new), `src/__tests__/provider-kit.test.ts` (the ledger entry).
      - `CHANGELOG.md`.
    - References:
      - failing test output (2026-10-15).
  - Test Cases to Write:
    - `templates_load`, `no_workspace_imports_prism_providers` (existing, now green).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — shipped templates.
    - Docs pages to create/edit:
      - `templates/README.md`: current package names.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - **Templates.** `templates/init/providers.json` maps each entry to its native package (`@arnilo/prism-provider-<id>`, root import, no `/subpath`); `templates/business-worker/manifest.json` is `["@arnilo/prism", "@arnilo/prism-tools-work"]` and its two scaffold bodies import `@arnilo/prism-tools-work/connectors`; `templates/personal-assistant/manifest.json` is `["@arnilo/prism"]` (the kernel mock provider is the only provider it uses); `templates/deep-research/manifest.json` and its three scaffold bodies use `@arnilo/prism-tools-web` and `@arnilo/prism-memory-rag`; `templates/README.md` lists the live names and describes the live `prism new package` command instead of the retired `prism init`.
    - **Ledger.** `scripts/e2e-coverage.json` was regenerated with `bun scripts/e2e-coverage-gate.mjs --generate` (91 surfaces, existing annotations preserved), then every suite path that no longer exists was pruned (622 → 558 annotations). The retired family keys are gone; the gate is green in baseline mode with 87 covered / 4 pending. `scripts/e2e-coverage.test.mjs`'s `pending` assertion moved from 0 to the measured 4 with the reason recorded. This also fixed a pre-existing red: two of that file's real-repo legs failed on the stale ledger before this task.
    - **Retired-name test.** `no_workspace_imports_prism_providers` is green. Its only remaining offender is `scripts/deprecations-0.13.json` (plan 175 Task 8), added to `allowedFiles` with a reason: a registry deprecation ledger must name the packages it retires, exactly like the frozen `phase29-freeze-manifest.json` the scan already allows. Task 6 adds the same entry to the fabric scan.
    - **New test.** `src/__tests__/templates.test.ts > templates_load` reads every `templates/*/manifest.json`, requires the catalog keys only, requires each `packages` entry to be a live workspace package (root + grouped `packages/*/*` + `apps/*`), rejects the retired names, and rejects a raw secret value or a secret-named field that is not an `env:`/`keyring:` ref. It does not use `loadManifest`: that loads *installed* packages from a `.prism/` store, while a catalog manifest is `{ name, description, version, tags, packages }` and no 0.13 command installs one. Recorded as a deviation from the task text.
    - **Baseline diff.** None — no export moved. **Sweep.** `@arnilo/prism-providers`, `@arnilo/prism-web-tools`, `@arnilo/prism-memory`, and `@arnilo/prism-work` are gone from `templates/` and `scripts/e2e-coverage.json`.
    - **Finding for a follow-up (not this task).** The agent template *bodies* (`init`, `deep-research`, `personal-assistant`, `business-worker`) still call 0.12 APIs (`createSecureAgent`, `runState`, `createMemoryWorkflowCheckpoints`) and no 0.13 command scaffolds them; only `templates/package` is live (`prism new package`). The plan's deferred "exclude `templates/` from the kernel tarball" decision is still open.

- [x] Task 4: Provider factory options and the prefix-stability fixture
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-provider-ai-sdk` splits factory-only options (`fetch`, `id`, and any non-JSON field) out of its validated config through `providerPackageInstance`, as `packages/providers/anthropic/src/index.ts:133-136` does. `optional package setup boundaries > provider packages set up without network` passes.
    - Functional: A new test walks every provider package factory and asserts that passing `fetch` never reaches config validation (`provider_factories_split_fetch`).
    - Functional: The prefix-stability fixture (`src/__tests__/prefix-stability-conformance.test.ts:216-245`) stops registering a second `load_skill` (it collides with the kernel's built-in tool: `Duplicate tool: load_skill`) and drops run options the kernel no longer reads (`activeSkills`; `limits.maxToolRounds` if Task 4 finds it unsupported). The fixture asserts each run's status is `succeeded`, so a failing run can no longer surface as "0 captured requests".
    - Functional: `runPrefixStabilityConformance` in `src/testing/prefix-stability-conformance.ts` gets the same status assertion if it shares the defect (checked in this task).
    - Performance: n/a.
    - Code Quality: No new config options; the fix reuses `providerPackageInstance`. (`aiSdk` declares `fetch` as a factory-only seam for interface uniformity; it is accepted and never called, and it is not a config option.)
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `packages/providers/ai-sdk/src/index.ts`, `src/provider-kit/provider-package.ts:110-140`, `src/__tests__/package-setup-boundaries.test.ts:47-65`, `src/skill-load.ts` (`createLoadSkillTool`, `DEFAULT_LOAD_SKILL_TOOL_NAME`).
    - Options Considered:
      - Allowing `fetch` in JSON config. Rejected: package config is JSON by contract (`src/packages/config.ts:69`).
    - Chosen Approach:
      - Fix the package and the fixture at their causes, and make the fixture fail loudly.
    - API Notes and Examples:
      ```ts
      aiSdk({ fetch: stubFetch }); // fetch is factory-only, never config
      ```
    - Files to Create/Edit:
      - `packages/providers/ai-sdk/src/index.ts` (factory key + `AiSdkFactoryOptions`; no ai-sdk test change was needed).
      - `src/__tests__/package-setup-boundaries.test.ts` (new `provider_factories_split_fetch`).
      - `src/__tests__/prefix-stability-conformance.test.ts` (fixture fix + `prefix_fixture_fails_on_failed_run`), `src/testing/prefix-stability-conformance.ts` (affected: shared the defect).
      - `CHANGELOG.md`.
    - References:
      - failing test output (2026-10-15).
  - Test Cases to Write:
    - `provider packages set up without network` (existing, green).
    - `provider_factories_split_fetch`.
    - `scorePrefixStability > matches the runner…` and `…does not fabricate 1…` (existing, green).
    - `prefix_fixture_fails_on_failed_run`: a deliberately failing fixture run throws with the run's error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — a package bug fix and test fixtures.
    - Docs pages to create/edit:
      - `CHANGELOG.md`: ai-sdk fix.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-16):
    - **Root cause of `provider packages set up without network`.** The generic loop passes `fetch` to every provider factory. `aiSdk`'s factory keys were `["model", "redactor", "readVersion"]`, so `fetch` fell into `AiSdkProviderConfig` and `resolvePackageConfig` threw `Package @arnilo/prism-provider-ai-sdk code config /fetch is not JSON (functions and class instances cannot be config)`. Fix: `fetch` joins the factory keys (and `AiSdkFactoryOptions`), so `providerPackageInstance` routes it to `definitionFor` and it never reaches config validation. `id` stays **validated config** (it is JSON and manifest-settable; the plan's parenthetical `id` came from `anthropic`, whose id is a factory option because it changes the constructed provider) — recorded as a deliberate deviation.
    - **New test.** `provider_factories_split_fetch` reuses the `providerPackages` table and asserts `"fetch" in instance.config` is false for all 20 providers (the observable `PackageInstance.config` is the validated config the split produced).
    - **Root cause of the prefix-stability reds.** `captureFixture` added `createLoadSkillTool({ registry })` on top of `skills: { add: registry.list() }`; `assemble.ts:289-290` already registers the kernel's built-in `load_skill` in progressive mode, so both runs ended `status: "failed"` with `Duplicate tool: load_skill` and captured 0 requests — which surfaced as the misleading `scorePrefixStability needs at least 2 captured requests, got 0`. The eager-disclosure test passed because eager inlines bodies and registers no `load_skill`, which is why only the progressive captures were red.
    - **Fixture fix.** `captureFixture` drops the second `load_skill`, drops `activeSkills` (session state derived by `assemble.ts`, not a `RunOptions` field — confirmed absent from the run-options surface), keeps `limits: { maxToolRounds: 1 }` (`assemble.ts:318` reads it; the legacy top-level `maxToolRounds` throws), and asserts each run's `status === "completed"` naming `result.error.message`.
    - **Runner fix.** `runPrefixStabilityConformance` shares the defect: a failed run resolves (`RunResult.status: "failed"`, it does not throw) and it only checked `requests.length === 4`, so the real error was hidden behind "captured 0". A new local `assertRunSucceeded` asserts both fixture runs and includes the run error. Also removed the runner's now-unused `createLoadSkillTool` import (WIP leftover, biome warning).
    - **New test.** `prefix_fixture_fails_on_failed_run` drives a `context.build` hook that throws and asserts the runner rejects with `/the first fixture run did not succeed \(failed\): prefix fixture boom/`.
    - **Verification.** `package-setup-boundaries.test.ts` 3 pass; `prefix-stability-conformance.test.ts` 17 pass (was 14 pass / 2 fail); `@arnilo/prism-provider-ai-sdk` 24 pass / 3 skip; root `tsc` and the package `tsc` clean; biome clean on all four files. **Baseline diff.** None (a bug fix and test fixtures).
    - **Out-of-scope green fix found while verifying (not in any task).** `scripts/e2e-full-surface.test.mjs` was 3 pass / 2 fail: its hand-maintained install list was missing every package the journey fixtures import dynamically, so the packed consumer failed with `Cannot find module '@arnilo/prism-{model-router,observability,mcp-server}'` and `@arnilo/prism-workflows`. Added those four rows and made the stale test title count-free (`packs and installs every listed package at the workspace version`). Now 5 pass / 0 fail. The list is still a hand-maintained subset — the same drift will recur; deriving it from the root `workspaces` globs is a follow-up.
    - **Still red after Task 4 (Task 6 scope).** `src/__tests__/kernel` vocabulary failures, the four workspace suites (memory-observational, provider-zai, store-sqlite, memory-fabric), and the memory-fabric docs tripwire.

- [x] Task 5: Kernel vocabulary gates: retire the 0.12 command family and fix the pin
  - Acceptance Criteria:
    - Functional: `CommandDefinition`, `CommandExecutionContext`, `CommandDrivers` (holds `startWorkflow`, the `workflow` term the `core contract seams stay domain-agnostic` gate rejects), `CommandWorkflowRun`, and `CommandResult` are deleted from `src/contracts-core/agent.ts`, after `graft callers <name> --depth all` shows each 0.13 consumer; every consumer is moved to `PackageCommand` / `PackageCommandContext` in this task.
    - Functional: `kernel_contains_no_checkpoints_or_leases` excludes `src/__tests__/docs.test.ts` the same way it excludes itself, because that file names the retired identifiers on purpose (its retired-name list, `:381-395`). No other exclusion is added.
    - Functional: Retirement sweep for the five command names over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`).
    - Functional: `src/__tests__/public-export-contract.test.ts` drops the names; `bun scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/arnilo__prism.txt`; the note records the diff (five removals, attributed to this plan).
    - Performance: n/a.
    - Code Quality: No alias; `docs/migrate-to-0.13.md` maps each removed name to its `PackageCommand` replacement.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/agent.ts:240-305`, `src/__tests__/core-boundaries.test.ts:40-127`, `src/__tests__/kernel-no-checkpoints.test.ts:24-42`, `src/__tests__/docs.test.ts:381-395`.
    - Options Considered:
      - Allow-listing `workflow` in the vocabulary gate. Rejected: the term comes from a 0.12 shape that should not be frozen (plan 179 Task 1 (d) would remove it anyway).
    - Chosen Approach:
      - Remove the stale shape now; scope the pin test's self-exclusion to the one file that lists retired names.
    - API Notes and Examples:
      ```ts
      // before: CommandDefinition.execute(args, { drivers: { startWorkflow } })
      // after:  prism.commands.register({ name, description, run(args, { session, host, agent }) })
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/packages/api.ts` (comment), `packages/memory/{wiki,fabric}/**` (the five command factories, `extension.ts`, the two `package-command.ts` adapters deleted, `packages/memory/src/package-command.ts` leftover deleted), `packages/memory/wiki/src/__tests__/commands.test.ts`, `packages/memory/fabric/src/scoped/__tests__/eval.test.ts`.
      - `src/__tests__/kernel-no-checkpoints.test.ts`, `src/__tests__/docs.test.ts`, `src/__tests__/agent-surface-freeze.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/retired-command-names.test.ts` (new).
      - `scripts/compat-baseline/arnilo__prism-memory-wiki.txt` (regenerated; `arnilo__prism.txt` did not change), `scripts/host-surface-allowlist.json`, `scripts/budgets.json` (kernel size ceilings).
      - `docs/migrate-to-0.13.md`, `docs/agent.md`, `docs/packages.md`, `CHANGELOG.md`.
    - References:
      - failing tests (2026-10-15); plan 179 Task 4 (confirms the sweep).
  - Test Cases to Write:
    - `core contract seams stay domain-agnostic` and `kernel_contains_no_checkpoints_or_leases` (existing, green).
    - `retired_command_names_absent` (sweep as a test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — five type exports removed.
    - Docs pages to create/edit:
      - `docs/migrate-to-0.13.md`: replacement table.
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-16):
    - **Deleted, no alias.** `CommandDefinition`, `CommandExecutionContext`, `CommandDrivers` (the `startWorkflow` holder the `core contract seams stay domain-agnostic` gate rejected), `CommandWorkflowRun`, and `CommandResult` left `src/contracts-core/agent.ts`. The same edit dropped the now-unused `RunOptions`/`RunResult`/`ErrorInfo` imports and reworded one `SessionOptions.parent` comment that used the bare `workflow` term — the gate scans the whole contracts union, so the word had to go with the type. `SessionParentLink.workflowRunId` stays (`\bworkflow\b` does not match it).
    - **Consumers moved to `PackageCommand`/`PackageCommandContext`.** `createWikiIngestCommand`, `createWikiInitCommand`, `createWikiLintCommand`, `createWikiRefreshCommand`, and `createScopedMemoryHealthCommand` now return `PackageCommand` (`args` for `parameters`, `run` for `execute`). `format: "uri"` left the ingest schema so the raw schema passes the kernel's `assertJsonSchemaSupported` subset; both `asPackageCommand` adapters are deleted (`packages/memory/wiki/src/package-command.ts`, plus the dead `packages/memory/src/package-command.ts` leftover of the retired `@arnilo/prism-memory` package), and `extension.ts` registers the commands directly. `PackageCommand.run` returns `unknown`, so the two callers that read the result cast it (the file already had that pattern).
    - **Dead behavior dropped.** `wiki-ingest`'s auto-filing called `context.drivers?.startRun`, and nothing in 0.13 constructs `CommandExecutionContext.drivers`, so the branch never fired. It goes with the seam and `runStarted` leaves the command value: the caller receives the filing brief and follows the wiki-maintainer skill. The two wiki tests asserting the driver path are removed/reworded.
    - **Pin fix.** `kernel_contains_no_checkpoints_or_leases` now skips `src/__tests__/docs.test.ts` the same way it skips itself, because that file's retired-export list names `CheckpointStore`/`LeaseStore` on purpose. No other exclusion added.
    - **Sweep test.** `src/__tests__/retired-command-names.test.ts > retired_command_names_absent` walks `src/ packages/ apps/ scripts/ examples/ docs/` (skipping `docs/history`, `docs/_evidence`, `scripts/compat-baseline`, `node_modules`, `dist`, `.types`) for the five names as whole words, allowing only `docs/migrate-to-0.13.md` (it exists to map them), `src/__tests__/docs.test.ts` (its retired list), and itself; a second leg pins the word boundary so live `WorkflowCommandResult`/`E2BCommandResult` are not false positives. It found two further live mentions — `docs/agent.md`'s package-authoring list and `scripts/host-surface-allowlist.json`'s `frozen` group — both retired-name entries, both removed.
    - **Docs.** `docs/migrate-to-0.13.md` gains the replacement row; `docs/agent.md` and `docs/packages.md` drop/reword their mentions; `src/__tests__/docs.test.ts`'s retired list gains the five names (its v0.12.1 cross-check is best-effort and unaffected).
    - **Compat baselines — the plan's assumption was wrong.** `bun scripts/release.mjs gate --update-baseline` rewrote exactly three baselines: `arnilo__prism-memory-wiki.txt` (one removal — `asPackageCommand` — plus four changed signatures, all this task) and `arnilo__prism-provider-alibaba.txt` / `arnilo__prism-provider-openai.txt`, already stale from plan 174 Tasks 4-5's video and speech/transcription/batch/moderation/realtime moves and failing the gate *before* this task. The kernel baseline `arnilo__prism.txt` did **not** change: the extractor walks emitted `.d.ts` files and `contracts-core/agent.ts`'s declarations are not in it, so there are **zero** kernel-baseline removals. The five removals surface in the memory-wiki baseline and the migration note instead.
    - **Budget rebaseline (out of task scope; required by the plan's own `release.mjs gate` leg).** The kernel strict ceilings failed — packedBytes/unpackedBytes had grown past the plan 175 Task 7 measurement. Rebaselined to the measured 1032814 / 3360797 with a plan 176 reason (shipped content: the template and e2e-ledger fixes, the manifest-version imports, the CHANGELOG/docs additions). `fileCount` 355, `rootExports` 1424, and `sourceLines` 34624 stay inside their ceilings — the command-shape deletion put sourceLines back under. This is a deliberate ceiling raise and should be reviewed.
    - **Verification.** `bun run typecheck` exit 0 (root + all workspaces + examples); `bun test --timeout=0 --path-ignore-patterns='packages/**' src/__tests__` 1829 pass / 0 fail; `bun scripts/release.mjs gate` exit 0 (60 packages, `updated: false`); `@arnilo/prism-workflows` 187/0, `@arnilo/prism-memory-wiki` 79/0, `@arnilo/prism-memory-compaction` 43/0; biome clean on every file this task touched. **Baseline diff.** Five kernel type exports removed (documented in `docs/migrate-to-0.13.md`), one package function removed and four package signatures changed (`arnilo__prism-memory-wiki.txt`).
    - **Still red (Task 6 scope).** `@arnilo/prism-memory-fabric` keeps its two failures (the deprecation-ledger allow-list and the docs tripwire); Task 3 added that ledger entry to the provider-kit scan and Task 6 owes the fabric scan the same.

- Task 6: Green the four red workspace suites (finding from Task 1) — **moved to plan 181 Task 2 on 2026-10-16** (not executed here; the full task text lives there).

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 --path-ignore-patterns='packages/**' src/__tests__` (0 failures)
- `bun test --timeout=0 scripts/version-literal-gate.test.mjs scripts/phase23-coverage.test.mjs`
- `bun run --filter @arnilo/prism-provider-ai-sdk test && bun run --filter @arnilo/prism-mcp-server test && bun run --filter @arnilo/prism-agent test`
- `bun run test`
- `bun run test:coverage`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
