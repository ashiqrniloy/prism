# SDK 0.0.2 Release Readiness Fixes

## Objectives
- Make the `0.0.2` release metadata, docs, tests, and CI match the SDK readiness target.
- Remove known release blockers from P0 through P2 without adding new SDK abstractions.
- Keep the release gate executable: typecheck, network-free tests, and pack dry-run.

## Expected Outcome
- All publishable package manifests, dependency pins, public version export, changelog, docs, and release tests consistently reference `0.0.2`.
- Release/install docs show correct external-app SDK usage and every public core export subpath.
- CI verifies the same SDK-readiness gate expected before tagging.
- Non-blocking SDK risks are documented and guarded where cheap.

## Tasks

- [x] P0: Bump all package versions, pins, tests, docs, and changelog to `0.0.2`
  - Acceptance Criteria:
    - Functional: `package.json`, every `packages/*/package.json`, umbrella dependency pins, first-party `@arnilo/prism` peer dependencies, `package-lock.json`, `src/index.ts` version export, release docs, and version-sensitive tests all reference `0.0.2` where release-specific.
    - Performance: No new runtime code paths, dependencies, or test loops are added; existing `npm test` budget remains unchanged.
    - Code Quality: Version constants/assertions are updated consistently; no mixed `0.0.1` release pins remain except historical changelog text under the `0.0.1` release section.
    - Security: No package gains runtime dependencies, relaxed peer requirements, or changed publish access; first-party peers remain required/non-optional.
  - Approach:
    - Documentation Reviewed:
      - `package.json` exports/scripts/workspaces and `engines.node >=20`.
      - `docs/release-and-install.md` package layout, peer dependency, tarball filename, release workflow, and budget sections.
      - `CHANGELOG.md` Keep a Changelog layout.
      - `src/__tests__/packaging.test.ts` peer/umbrella dependency assertions.
      - `src/__tests__/install-smoke.test.ts` tarball filename assertions.
    - Options Considered:
      - Manual targeted edits: smallest diff and easiest review for one release bump.
      - Scripted bulk replacement: faster but risks rewriting historical `0.0.1` changelog text that should stay.
    - Chosen Approach:
      - Use targeted edits plus `npm install --package-lock-only` if lockfile needs regeneration; keep historical `0.0.1` release notes intact.
    - API Notes and Examples:
      ```bash
      npm install --package-lock-only
      rg -n "0\.0\.1|0\.0\.2" package.json package-lock.json packages src docs CHANGELOG.md
      ```
    - Files to Create/Edit:
      - `package.json`: bump root version.
      - `package-lock.json`: update lockfile package versions/dependency pins.
      - `packages/*/package.json`: bump versions, peer pins, and umbrella dependency pins.
      - `src/index.ts`: bump exported `version`.
      - `src/__tests__/packaging.test.ts`: update version assertions.
      - `src/__tests__/install-smoke.test.ts`: update tarball filename assertions.
      - `docs/release-and-install.md`: update current release pins and filenames.
      - `CHANGELOG.md`: move release-ready changes into `## [0.0.2] - 2026-07-05`.
      - `packages/*/CHANGELOG.md`: add shipped `## [0.0.2] - 2026-07-05` sections for code packages.
    - References:
      - Prior readiness finding: all packages remained `0.0.1`; no version bump made.
      - `docs/index.md` already links Release and install.
  - Test Cases to Write:
    - Packaging guard: asserts first-party peer deps and umbrella deps equal `0.0.2`. Passed via `node --test dist/__tests__/packaging.test.js` after `npm run build`.
    - Install smoke: asserts tarball filenames include `0.0.2` names. Passed via `node --test dist/__tests__/install-smoke.test.js` after `npm run build`.
    - Workspace package version tests: passed via `npm run test --workspaces --if-present`.
    - `rg` audit: no stale current-release `0.0.1` pins outside historical changelog. Passed via targeted `rg` audit.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes, package version and install contract change for consumers.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: update current package versions, peer text, tarball names, install examples.
      - `CHANGELOG.md`: add dated `0.0.2` section.
    - `docs/index.md` update: No; existing Release and install entry remains correct.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P1: Fix release/install SDK examples and public import-specifier table
  - Acceptance Criteria:
    - Functional: `docs/release-and-install.md` uses the real `createAgent({ model, provider })` and `createAgentSession({ agent })` API shape, and its import table lists every root `exports` subpath.
    - Performance: Documentation-only change; docs tests do not add network, timers, or expensive examples.
    - Code Quality: Public import table is derived or guarded against `package.json` export drift where practical; examples are minimal and compile-shaped.
    - Security: Examples use placeholders only, do not imply hidden credentials/provider globals, and keep host-owned provider construction explicit.
  - Approach:
    - Documentation Reviewed:
      - `package.json` `exports` map.
      - `docs/release-and-install.md` Implementation example and Public core import specifiers table.
      - `docs/index.md` Testing and examples entries for conformance subpaths.
      - `examples/minimal-host-app.ts` canonical `createAgent`/`createAgentSession` usage.
      - `src/__tests__/install-smoke.test.ts` `coreSpecifiers()` helper deriving export subpaths.
    - Options Considered:
      - Hand-maintain table: simple, but can drift again.
      - Add docs test comparing table rows to `package.json` exports: small guard and prevents repeat.
    - Chosen Approach:
      - Update the table manually now and add one docs test that every exported core subpath appears in `docs/release-and-install.md`.
    - API Notes and Examples:
      ```ts
      import { createAgent, createAgentSession } from "@arnilo/prism";
      import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";

      const model = { provider: "openai", model: "gpt-4.1-mini" };
      const provider = createOpenAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "..." });
      const agent = createAgent({ model, provider });
      const session = createAgentSession({ agent });
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`: fixed API example and completed specifier table.
      - `src/__tests__/docs.test.ts`: added guard that release docs list all `package.json` core export subpaths and use current object-shaped `createAgent` / `createAgentSession` APIs.
    - References:
      - `package.json` current subpaths: root, providers/openai-compatible, testing conformance helpers, node config/settings/trust/session-store-jsonl/contribution-discovery/instruction-injectors/system-prompts/agent-definitions.
  - Test Cases to Write:
    - Docs test: each `@arnilo/prism` export specifier from `package.json` appears in `docs/release-and-install.md`. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
    - Docs test or example scan: release install example contains `createAgent({ model, provider })` and `createAgentSession({ agent })` rather than obsolete positional API. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes, published install docs and public subpath contract documentation.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: correct SDK starter code and import table.
    - `docs/index.md` update: No; Release and install entry already exists.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P1: Make CI verify the SDK readiness gate and fix stale budget comments
  - Acceptance Criteria:
    - Functional: Release workflow verifies `npm run sdk:ready` or an equivalent sequence including `npm run typecheck`, `npm test`, and `npm run pack:dry-run` before publish.
    - Performance: CI timeout remains a hang backstop, not a tight performance budget; comments match the documented `< 60s` default `npm test` budget and acknowledge `sdk:ready` can be longer.
    - Code Quality: `package.json` scripts and `.github/workflows/release.yml` describe the same local/CI gates; no duplicate bespoke CI command sequence unless needed.
    - Security: Live tests remain opt-in and are not enabled by CI; no secrets are required for verify.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/release.yml` verify job.
      - `package.json` scripts: `typecheck`, `test`, `pack:dry-run`, `release:dry-run`, `sdk:ready`.
      - `docs/release-and-install.md` Release workflow, offline test budget, and release checklist.
    - Options Considered:
      - Replace verify steps with `npm run sdk:ready`: simplest and mirrors local release target.
      - Keep separate steps and add `npm run typecheck`: more visible failure phase but duplicates script composition.
    - Chosen Approach:
      - Prefer `npm run sdk:ready` in verify unless CI log granularity proves more useful; update docs/scripts if `release:dry-run` should also include typecheck.
    - API Notes and Examples:
      ```yaml
      - run: npm run sdk:ready
        timeout-minutes: 5
      ```
    - Files to Create/Edit:
      - `.github/workflows/release.yml`: runs SDK readiness gate and has updated comments/timeouts.
      - `docs/release-and-install.md`: aligned release workflow, local mirror, and budget wording.
      - `package.json`: made `release:dry-run` alias `sdk:ready`.
      - `CHANGELOG.md`: updated current release budget note to `< 60s` baseline.
    - References:
      - Prior readiness finding: CI lacked `npm run typecheck`; workflow comment still said `< 30s` while docs said `< 60s`.
  - Test Cases to Write:
    - Static docs/workflow test: release workflow contains `npm run sdk:ready` and does not run `npm test` directly. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
    - Existing `npm run sdk:ready`: final verification deferred to final plan task.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No runtime API change; release process behavior changes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: update release workflow/local mirror wording if workflow changes.
    - `docs/index.md` update: No; existing Release and install entry remains correct.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P2: Add cheap contract guard for exported SDK type surface
  - Acceptance Criteria:
    - Functional: Public export tests catch accidental removal/rename of important root SDK contract types (`AIProvider`, `ToolDefinition`, `Skill`, `AgentConfig`, `AgentSession`, persistence/ledger contracts, extension contracts) exposed through `export type * from "./contracts.js"`.
    - Performance: Test is static/string-based or type-declaration-based and adds negligible time to `npm test`.
    - Code Quality: Guard is data-driven and easy to update intentionally; it does not duplicate every implementation detail.
    - Security: No runtime import executes host code or touches network/files outside repo test fixtures.
  - Approach:
    - Documentation Reviewed:
      - `src/index.ts` root barrel exports.
      - `src/contracts.ts` public SDK type definitions.
      - `src/__tests__/public-export-contract.test.ts` existing root export surface freeze.
      - `docs/public-contracts.md` public contract overview.
    - Options Considered:
      - Snapshot all 157 contract exports: strongest but noisy for 0.x churn.
      - Guard only SDK-critical implementable interfaces/types: smaller, lower maintenance, covers release risk.
    - Chosen Approach:
      - Add a focused required-type list for external-app SDK contracts; expand only when release docs promise a new implementable surface.
    - API Notes and Examples:
      ```ts
      const requiredTypes = ["AIProvider", "ToolDefinition", "Skill", "SessionStore", "RunLedger"];
      for (const name of requiredTypes) assert.match(dts, new RegExp(`\\b${name}\\b`));
      ```
    - Files to Create/Edit:
      - `src/__tests__/public-export-contract.test.ts`: added focused SDK contract type guard for implementer-facing contracts.
      - `docs/release-and-install.md` or `docs/public-contracts.md`: no docs edit needed; guard matched current documented surface.
    - References:
      - Prior readiness finding: contract freeze was partial for the SDK implementer type surface.
  - Test Cases to Write:
    - Public export contract test: built `dist/index.d.ts` re-exports `./contracts.js`, and `dist/contracts.d.ts` includes required SDK contract type declarations. Passed via `node --test dist/__tests__/public-export-contract.test.js` after `npm run build:core`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No intended API change; guard protects documented public API.
    - Docs pages to create/edit:
      - `none`: guard-only unless docs drift is discovered during implementation.
    - `docs/index.md` update: No.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P2: Document current per-run tool scoping behavior instead of adding API
  - Acceptance Criteria:
    - Functional: Docs explicitly state that `session.run()` does not expose `RunOptions.tools` or `RunOptions.toolFilter`; hosts narrow tools by constructing the active `ToolRegistry`, declarative `AgentDefinition.tools`, `PermissionPolicy`, or `ToolValidator`.
    - Performance: Documentation-only change; no runtime overhead.
    - Code Quality: Existing tool primitives are reused in guidance; no speculative new API is planned.
    - Security: Guidance defaults to fail-closed host-owned permission/validation and does not imply skills grant tool access.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md` active registry, filters, dispatch, runtime validators, permission note.
      - `docs/context-and-skills.md` skill `toolNames` dependency behavior.
      - `docs/agent-definitions.md` declarative explicit tool activation.
      - `src/agents.ts` runtime dispatch path using configured tools and validator/permission seams.
    - Options Considered:
      - Add `RunOptions.toolFilter`: convenient but new API and not required for 0.0.2.
      - Document host-owned scoping: smallest accurate fix and matches existing architecture.
    - Chosen Approach:
      - Update docs only; add no runtime option unless a real app requirement appears.
    - API Notes and Examples:
      ```ts
      const activeTools = createToolRegistry([searchTool]);
      const agent = createAgent({ model, provider, tools: activeTools, permission });
      ```
    - Files to Create/Edit:
      - `docs/tools.md`: added per-run scoping note.
      - `docs/customization.md`: not edited; tools page already carries the behavior and related links.
      - `src/__tests__/docs.test.ts`: added docs assertion for tool scoping wording and absence of `RunOptions.tools` / `RunOptions.toolFilter`.
    - References:
      - Prior readiness finding: runtime has no per-run tool filter; all configured active tools are exposed unless permission/validator blocks.
  - Test Cases to Write:
    - Docs test: `docs/tools.md` mentions no `RunOptions.tools`/per-run filter and points to `PermissionPolicy`, `ToolValidator`, declarative `AgentDefinition.tools`, and active registry narrowing. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes, documented runtime tool-scoping behavior for host apps.
    - Docs pages to create/edit:
      - `docs/tools.md`: clarify host-owned tool scoping.
      - `docs/customization.md`: optional cross-reference if concise.
    - `docs/index.md` update: No; Tools and SDK customization entries already exist.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P2: Clarify runtime skill activation semantics across registries, arrays, and declarative definitions
  - Acceptance Criteria:
    - Functional: Docs distinguish `AgentConfig.skills` runtime behavior from declarative `AgentDefinition.skills` behavior without contradiction.
    - Performance: Documentation-only change; no runtime behavior change.
    - Code Quality: Wording matches existing tests and avoids introducing another activation mode.
    - Security: Docs reaffirm skills never grant tool permissions and `toolNames` only require host-active tools.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md` runtime skill selection precedence.
      - `docs/agent-definitions.md` omitted declarative skills stay inactive unless `activateAllCapabilities`.
      - `src/skills.ts` `resolveActiveSkills`.
      - `src/__tests__/agents.test.ts` skill override behavior.
    - Options Considered:
      - Change runtime registry default to none: breaking behavior and not needed before 0.0.2.
      - Clarify docs: preserves tested behavior and removes ambiguity.
    - Chosen Approach:
      - Update docs and add/adjust docs tests only.
    - API Notes and Examples:
      ```ts
      await session.run("hi", { activeSkills: ["writer"] }); // narrows registry-backed skills
      ```
    - Files to Create/Edit:
      - `docs/context-and-skills.md`: added runtime vs declarative activation table.
      - `docs/agent-definitions.md`: not edited; existing declarative behavior remained clear and cross-linked from context/skills wording.
      - `src/__tests__/docs.test.ts`: asserted registry default, declarative omitted-skill default, migration-only all-capability opt-in, and explicit runtime no-skills override.
    - References:
      - Prior readiness finding: registry + no `activeSkills` activates all configured skills; declarative omitted skills activate none.
  - Test Cases to Write:
    - Docs test: context/skills page contains the registry default and declarative omitted-skill distinction. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes, documented skill activation behavior for host apps.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: clarify precedence/semantics.
      - `docs/agent-definitions.md`: ensure declarative behavior remains clear.
    - `docs/index.md` update: No; entries already exist.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P2: Reconcile Node support claims with release verification
  - Acceptance Criteria:
    - Functional: Release docs and CI either prove Node 20 support with a Node 20-compatible gate or explicitly document that full docs-example execution currently requires Node 24 while package engine remains `>=20`.
    - Performance: Any added Node 20 job is limited to build/import/unit checks that do not require native TypeScript stripping if examples cannot run on Node 20.
    - Code Quality: Workflow matrix/comments are clear and do not duplicate expensive full SDK gates unnecessarily.
    - Security: No live tests or secrets are enabled on either Node version.
  - Approach:
    - Documentation Reviewed:
      - `package.json` `engines.node >=20`.
      - `.github/workflows/release.yml` Node 24 setup and comment that docs examples need Node >=22.6 native type stripping.
      - `docs/release-and-install.md` offline test budget says Node 20.
      - `src/__tests__/docs.test.ts` example execution behavior.
    - Options Considered:
      - Full matrix on Node 20 and 24: stronger but may fail docs-example execution.
      - Add a limited Node 20 build/import check and keep full SDK gate on Node 24: proves package basics while avoiding known native TS limitation.
      - Change engines to `>=22.6`: simpler but unnecessary if runtime supports Node 20.
    - Chosen Approach:
      - Prefer limited Node 20 verify plus docs clarification; do not raise engine floor unless tests prove runtime needs it.
    - API Notes and Examples:
      ```yaml
      strategy:
        matrix:
          node-version: [20, 24]
      ```
    - Files to Create/Edit:
      - `.github/workflows/release.yml`: added Node 20-compatible build + public export import smoke job; publish now waits for it.
      - `docs/release-and-install.md`: aligned Node version, docs-example, release workflow, and budget wording.
    - References:
      - Prior readiness finding: package claims Node >=20 but CI only runs Node 24.
  - Test Cases to Write:
    - CI/static test if existing infra supports it: workflow mentions Node 20 and docs explain Node 24-only full gate for docs examples. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
    - Manual/local command for task: validated the public-export import smoke command on the available Node 24 runtime; Node 20 runtime was not available locally in this environment.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes, consumer runtime support claim and release verification contract.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: clarify Node support and CI gate.
    - `docs/index.md` update: No; Release and install entry remains correct.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P2: Update stale provider live-test placeholder docs
  - Acceptance Criteria:
    - Functional: Provider package docs state provider live tests are real opt-in smoke tests, while compaction live tests remain placeholders where true.
    - Performance: Documentation-only change; no tests become live by default.
    - Code Quality: Wording matches `docs/release-and-install.md` and current provider package test behavior.
    - Security: Docs keep credential-gated behavior explicit and warn that secrets are never logged.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md` Phase 12 package wording.
      - `docs/release-and-install.md` live test env gate section.
      - `packages/provider-*/src/__tests__/live.test.ts` gated live smoke tests.
      - `packages/compaction-*/src/__tests__/live.test.ts` placeholder/gated behavior.
    - Options Considered:
      - Remove all placeholder wording: inaccurate for compaction packages.
      - Split provider and compaction wording: precise and minimal.
    - Chosen Approach:
      - Update docs only; keep env-gated behavior unchanged.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_PROVIDER_TESTS=1 OPENAI_API_KEY=... npm run test --workspace @arnilo/prism-provider-openai
      ```
    - Files to Create/Edit:
      - `docs/provider-packages.md`: replaced stale provider placeholder claim with real opt-in live smoke wording.
      - `src/__tests__/docs.test.ts`: added guard for provider live smoke wording and against stale provider placeholder wording.
    - References:
      - Prior readiness finding: `docs/provider-packages.md` still says provider live tests have placeholders, but they are now real gated smoke tests.
  - Test Cases to Write:
    - Docs test: provider package docs mention opt-in live smoke tests and do not call provider live tests placeholders. Passed via `node --test dist/__tests__/docs.test.js` after `npm run build:core`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No API change; release/testing documentation behavior changes.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: update live-test wording.
    - `docs/index.md` update: No; Provider packages entry remains correct.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification: run SDK readiness gate and close plan findings
  - Acceptance Criteria:
    - Functional: `npm run sdk:ready` passes after all tasks; git diff contains only intended release-readiness changes.
    - Performance: Default suite remains network-free and within documented expectations; no new dependency install beyond existing dev dependencies.
    - Code Quality: Plan checkboxes reflect completed work; `Compromises Made` and `Further Actions` are filled with actual deviations only.
    - Security: No real secrets, live-test env vars, or credential material are added to code/docs/tests.
  - Approach:
    - Documentation Reviewed:
      - This plan.
      - `docs/release-and-install.md` release checklist.
    - Options Considered:
      - Run only changed tests: faster but misses packaging/install-smoke release coupling.
      - Run full SDK readiness: required before tag.
    - Chosen Approach:
      - Run full `npm run sdk:ready`; if slow failure occurs, run targeted failing command for diagnosis only.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      git diff --check
      ```
    - Files to Create/Edit:
      - `plans/051-sdk-0-0-2-release-readiness-fixes.md`: mark completed tasks and fill final sections.
    - References:
      - `package.json` `sdk:ready` script.
      - `docs/release-and-install.md` release checklist.
  - Test Cases to Write:
    - Final gate: `npm run sdk:ready`. Passed: core 836/836, workspace provider/compaction packages passed with live tests skipped by default, and pack dry-run succeeded for all 12 packages.
    - Whitespace check: `git diff --check`. Passed with no output.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No new public API; verifies documented release behavior.
    - Docs pages to create/edit:
      - `none`: final verification only unless results expose drift.
    - `docs/index.md` update: No.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Node 20 compatibility command was added to CI and documented, but only the equivalent public-export import smoke was run locally on available Node 24; no local Node 20 runtime was available.
- `docs/customization.md` and `docs/agent-definitions.md` were not edited because the focused behavior docs already live in `docs/tools.md` and `docs/context-and-skills.md`; docs tests now pin those claims.

## Further Actions
- Tag `v0.0.2` only after reviewing the final diff and letting GitHub Actions run both `verify` and `node20-compat`.
- Add provenance publishing later if desired; workflow already has `id-token: write`.
