# Phase 11 Part B — docs promotion, README and PRODUCT cutover, the 0.13.0 cut, publish, and npm deprecation

## Objectives

- Promote the `docs/next/` pages into `/docs`, retire or replace every 0.12 page they supersede, link each package README as its page, and rewrite `docs/index.md` for 0.13.0.
- Cut `README.md` over to the SDK, so that a new reader can build an agent from it alone, and drop `PRODUCT.md`'s not-shipped banner.
- Reshape the examples gallery so it leads with host and package examples, including `examples/build-workflow.ts`.
- Assemble the 0.13.0 changelog and the migration note from 0.12 `createAgent` / `defineAgent`.
- Cut every package to 0.13.0 with `requires.prism: "^0.13"`, and regenerate the compat baselines.
- Build a registry deprecation tool that runs no `npm` binary.
- Run the final retired-name sweep.
- Publish `@arnilo/prism` 0.13.0 and the native packages and host libraries.
- Deprecate `prism-agent-sdk`, `prism-code`, `prism-acp-agent`, and the 0.12 family packages on npm.
- Record the Phase 11 Done criteria.

## Expected Outcome

- `/docs` documents the 0.13.0 contract. Every `docs/next/*.md` page is promoted. Every 0.12 page is replaced, kept as still true, or moved to `docs/history/`, per plan 174 Task 1 (g). `docs/next/` no longer exists. `docs/index.md` links each kernel page, each package README, and the Prism Agent walkthrough.
- `src/__tests__/docs.test.ts` and `scripts/phase24-truth.test.mjs` pass, and their pins describe 0.13.0.
- `README.md`'s quickstart is executed by the examples gate (`readme_quickstart_runs_on_mock_provider`).
- `PRODUCT.md` has no "Nothing here is shipped yet" banner, and it names Prism Agent, not Prism Code, as the reference host.
- `CHANGELOG.md` has a `## [0.13.0]` section. `docs/migrate-to-0.13.md` exists, and `docs/migration.md` has a `0.12.1 → 0.13.0` entry.
- Every publishable `package.json` is at `0.13.0` with `^0.13`-compatible internal ranges, and every `definePackage` declares `requires: { prism: "^0.13" }`. `bun run release:gate` exits 0 at version 0.13.0.
- `scripts/registry-deprecate.mjs` plans, dry-runs, and applies range-scoped deprecations over the npm registry HTTP API. Offline fixture tests cover it.
- After owner confirmation, the packages are published from CI and the deprecations are applied. `bun scripts/post-publish-smoke.mjs` passes against the registry. `scripts/independent-packages.json` lists every 0.13.0 package as independently versioned.

This plan implements roadmap **Phase 11 — Kernel freeze and 0.13.0**, Part B: the Docs, README and PRODUCT, and Release bullets, plus the Done record. It **depends on plan 174** (Part A), whose Task 1 is the review for both parts. **Task 10 also depends on plans 176–180** (added 2026-10-15 after the pre-release review): those plans reopen the frozen surface to fix gate bypasses, tenant and host isolation, the package version rule (plan 179 replaces `requires.prism: "^0.13"` with `requires: { api: 1 }`, superseding this plan's Objective and Expected Outcome wording on ranges), coverage and version gates, and add the live release acceptance run. Task 1 here is an **entry check**: it confirms Part A landed and applies the review's (f)–(j) tables to Tasks 2–10. This plan changes no kernel contract. The surface was frozen in plan 174 Task 9, and a change found necessary here is a finding that sends work back to Part A. This is the only plan in the train that bumps versions, publishes, or deprecates on npm. Tasks 7 and 10 are outward-facing. The executor stops for explicit owner confirmation before pushing the release tag and before applying deprecations. The registry operations are one-way. Two §3 probes have the same answer for every task, so they are answered here once. Lab impact: n/a, because plan 173 deleted `packages/prism-code`; the reference host's suite (`bun run --filter @arnilo/prism-agent test`) must stay green after every task. Cost knobs: n/a, because no task adds an opt-in feature that adds model calls, writes, or latency.

**Closed at Task 8 (2026-10-16).** Tasks 9–10 moved to plan 187 when the 0.13.0 release plans were put in execution order (181 → 187). The P0 in Further Actions (`bun ci`) moved to plan 181 Task 1.

## Tasks

- [x] Task 1: Entry check — Part A as landed, and the review tables applied (read-only)
  - Acceptance Criteria:
    - Functional: Confirm from source and plan 174's Notes, citing `file:line`:
      - `src/` holds only the §2.2 modules
      - the four 0.12 workspaces are gone
      - the kernel exports TypeScript source
      - the kernel constraint tests and the kernel budget gate exist
      - `bun run release:gate` passed with Postgres evidence
    - Functional: Apply plan 174 Task 1 tables, amending tasks in place:
      - (g) docs dispositions → Tasks 2–3
      - (h) version and range plan → Task 7
      - (i) the deprecation list → Tasks 8 and 10
      - (j) conflicts → Tasks 4, 6, and 9
      - (f) the docs-suite failures plan 174 Task 11 left → Tasks 2–5
    - Functional: Record the failing-test baseline: `docs.test.ts`, `phase24-truth`, the examples gate, and `release:gate`. Record a verdict. If a finding invalidates a task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every confirmation cites its span.
    - Security: Confirm that the deprecation list in (i) range-scopes every name a 0.13.0 package reuses (`@arnilo/prism-mcp`, `@arnilo/prism-ag-ui`, `@arnilo/prism-channels`, and any other the review found).
  - Approach:
    - Documentation Reviewed:
      - plan 174 (Notes and tables); roadmap Phase 11 Scope and Done
      - Input (plan 174 Task 1, 2026-10-14, tables already recorded): (g) 170 page dispositions and the `docs/next/` destination names; (h) 49 `requires.prism` values are `"^0.12.1 || ^0.13.0-0"`, one is `"^0.12.1"` at `packages/credentials/keyring/src/index.ts:259`; (i) deprecation list including range-scoped reuse of `@arnilo/prism-mcp`, `@arnilo/prism-ag-ui`, `@arnilo/prism-channels`, `@arnilo/prism-evals` (0.3.0), `@arnilo/prism-workflows` (0.3.1), and `@arnilo/prism-model-router` (0.3.1); (j) `PRODUCT.md:105` and `prism.md:26`; (f) 22 `docs.test.ts` failures, `phase24-truth` green.
    - Options Considered:
      - A second review. Rejected: plan 174 Task 1 covers both parts.
    - Chosen Approach:
      - Confirm, apply, amend.
    - API Notes and Examples:
      ```bash
      bun test --timeout=0 src/__tests__/docs.test.ts scripts/phase24-truth.test.mjs
      ```
    - Files to Create/Edit:
      - this plan: Notes and amendments only
    - References:
      - plan 173 Task 1 (entry-check pattern)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **Verdict: plan stands. No re-cut. No kernel change needed.** Part A is landed; all eleven plan 174 task boxes are `[x]` (`plans/174-*.md:26-812`).
    - **Part A confirmations.**
      - `src/` holds only the §2.2 modules: `agent-session/`, `loop/`, `hooks/`, `slots/`, `packages/`, `manifest/`, `models/`, `provider-kit/`, `driver-kit/`, `credentials/`, `host/`, `testing/`, `node/`, `session/` plus the keep-list files from plan 174 Task 1 (a).
      - The four 0.12 workspaces are gone: root `package.json:38-50` lists only `packages/{context,credentials,drivers,hosts,integrations,memory,policy,providers,stores,tools}/*` and `apps/*`; no `packages/prism-*` directory exists (`ls packages`).
      - The kernel exports TypeScript source: `package.json:7-13` (`".": "./src/index.ts"`, `./provider-kit`, `./driver-kit`, `./manifest`, `./testing` → `src/**/index.ts`).
      - The kernel constraint tests exist: `src/__tests__/kernel-constraints.test.ts`, `kernel-imports-no-package.test.ts`. The size budget is `scripts/budgets.json:21` (`kernel`), enforced by `scripts/budget-gates.mjs`.
      - `release:gate` with Postgres evidence is recorded in plan 174 Task 11 Notes (`plans/174-*.md:877-893`). **Not re-run here**: `PRISM_TEST_POSTGRES_URL` is unset in this shell. Task 7 and Task 10 re-run it with a local Postgres.
    - **Failing-test baseline (2026-10-15, working tree).**
      - `bun test --timeout=0 src/__tests__/docs.test.ts scripts/phase24-truth.test.mjs`: **161 pass / 24 fail**. `phase24-truth` has no failures.
      - The 24 are the 22 plan 174 recorded, minus `offer reset: README pointer` and `readme_describes_current_runtime_…` (no longer named failing), plus five not in that list: `index links point to existing local markdown files`, `docs_index_links_reference_host_walkthrough`, `canonical manifest-count narrative: one statement, no stale counts`, `canonical count statement equals the generated counts`, `release publication is deterministic resumable and Bun-published`. The first four belong to Tasks 2–3 (`docs/index.md`, count statements). The last belongs to Task 7 (version / publish pins).
      - The examples gate `examples_demos_run_to_completion_and_emit_no_secret`: **pass** now (plan 174 recorded it red). Task 5 still reclassifies the 0.12 examples and records wall time. `workflow_examples_cover_required_workflow_surfaces` is red and is Task 5's.
      - `release:gate`: not run (no Postgres URL); last green per plan 174 Task 11.
    - **Review tables applied.**
      - (g) → Tasks 2–3 as the plan already reads. Counts now: 15 `docs/next` pages, 147 `docs/*.md`.
      - (h) → Task 7. Actual `requires.prism` count in `packages/**/src/*.ts` and `apps/` definitions: **47** `"^0.12.1 || ^0.13.0-0"`, **1** `"^0.12.1"` (`packages/credentials/keyring/src/index.ts:259`), 5 `"*"` (test fixtures, leave). Plan 174 said 49. The Task 7 test is `every_package_requires_prism_0_13`, which counts nothing, so no amendment beyond this figure. Root version is `0.12.1` (`package.json:3`).
      - (i) → Tasks 8 and 10. Whole-package: `prism-agent-sdk`, `prism-code`, `prism-acp-agent`, `prism-providers`, `prism-coding-tools`, `prism-web-tools`, `prism-memory`, `prism-core`, `prism-work`, `prism-hooks`, `prism-all`. Range-scoped `<0.13.0`: `prism-mcp`, `prism-ag-ui`, `prism-channels`, `prism-evals`, `prism-workflows`, `prism-model-router`. **Task 8 amendment: `scripts/deprecations-0.13.json` carries exactly these 17 names, and `@arnilo/prism` itself is never listed.**
      - (j) → Tasks 4, 6, 9. `PRODUCT.md:3` banner and `:111` ("Prism Code is the reference host"; plan 174 cited `:105`, which has drifted). `.agents/skills/create-plan/references/prism.md:25` routes UI to `apps/prism-code`, and `:63`/`:77` still name `packages/prism-code` (cited as `:26` in plan 174). **Task 4 and Task 9 use these current lines.**
      - (f) → Tasks 2–5 as above.
    - **Security.** (i) range-scopes all six reused names, including the three extras (`evals`, `workflows`, `model-router`). The Task 8 fail-closed check on `latest` inside the range stays.
    - **Amendment to Task 9:** the `prism.md` sweep covers `:25`, `:63`, `:77`, not just one line.

- [x] Task 2: Promote `docs/next/` into `/docs` and rewrite `docs/index.md`
  - Acceptance Criteria:
    - Functional: Each of the 15 `docs/next/*.md` pages moves to its plan 174 Task 1 (g) destination name under `docs/`. The pages are `agent`, `agent-adapters`, `drivers`, `events`, `hooks`, `host`, `loop`, `manifest`, `models`, `packages`, `provider-kit`, `release`, `slots`, `testing`, and `tools`. When a destination collides with a 0.12 page (`hooks.md`, `observability.md`, …), the promoted page replaces it in the same move. The "Staged for the next release" banners are removed. `docs/next/` is deleted.
    - Functional: `docs/index.md` is rewritten for 0.13.0 with one entry per page, each a single sentence describing what the page covers (`prism-wiki.md` current-contract rules). The sections are:
      - Kernel (the promoted pages)
      - Packages (one link to each native package's `README.md`, grouped as in §2.9)
      - Host libraries (one link to each host library's README)
      - Guides (the `apps/prism-agent/README.md` walkthrough, the migration note, release)
      - History
    - Functional: The train-only exclusions are removed: `!docs/next` in root `files`, and the "target tokens forbidden in released docs" scan in `docs.test.ts`. That scan is replaced by its inverse: released docs describe `createAgent` with `packages`, and no released page describes `defineAgent` or `ExtensionAPI` as current. `apiPages` (`src/__tests__/docs.test.ts:53`) lists the promoted pages.
    - Functional: Every relative link in `/docs` and in every package README resolves. The existing test "all shipped markdown links resolve locally" passes.
    - Performance: n/a.
    - Code Quality: No page body carries plan numbers or version narrative (`prism-wiki.md`).
    - Security: The promoted `host.md`, `packages.md`, `agent-adapters.md`, and `release.md` keep their security sections: secrets as refs, packages as trusted code, subscription credentials never passing through Prism, and the attestation verification steps.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 Docs bullet and §1.4 "Docs follow releases"; `.agents/skills/create-plan/references/prism-wiki.md`; plan 174 Task 1 (g); `docs/index.md` (158 links at survey); `src/__tests__/docs.test.ts:53,409,2018`
    - Options Considered:
      - Keeping `docs/next/` as an alias directory. Rejected: §1.4 says the publish phase promotes the pages, and two homes for one contract drift.
      - Writing new pages for gaps. Rejected: the Phase 11 Docs bullet says every page already exists from the phase that shipped its API. A missing page is a finding that goes back to plan 174 Task 1.
    - Chosen Approach:
      - Move the pages, replace the colliding pages, rewrite the index, then flip the docs-test pins.
    - API Notes and Examples:
      ```bash
      git mv docs/next/agent.md docs/agent.md
      bun test --timeout=0 src/__tests__/docs.test.ts -t "markdown links resolve"
      ```
    - Files to Create/Edit:
      - `docs/next/*.md` → `docs/*.md` (15 pages; destination names from Task 1 (g))
      - `docs/index.md`: rewrite
      - root `package.json` `files`: drop `!docs/next`
      - `src/__tests__/docs.test.ts`: `apiPages`, the released-docs token scan, the index pins
      - `scripts/phase24-truth.test.mjs`: the pins that read `docs/next`
      - `CHANGELOG.md` `## [Unreleased]` `### Changed` (docs moved)
    - References:
      - plan 147 (created `docs/next/` and its exclusions)
  - Test Cases to Write:
    - `docs_next_is_promoted`: `docs/next` does not exist, and every former page is in `apiPages`. It fails on a missed page.
    - `released_docs_describe_the_kernel_contract`: `docs/agent.md` documents `createAgent({ packages })`, and no `/docs` page outside `history/` presents `defineAgent` as current. This replaces the train-time inverse scan.
    - `index_links_every_package_readme`: every publishable workspace README is linked from `docs/index.md`. It fails when a package is added without an entry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the released docs now describe 0.13.0.
    - Docs pages to create/edit: the 15 promoted pages, the colliding pages they replace, and `docs/index.md`
    - `docs/index.md` update: yes — a full rewrite, as above
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **What changed.** The 15 `docs/next/*.md` pages moved to `docs/` (`hooks`, `testing`, `tools` replaced the 0.12 pages in the same move); `docs/next/` is gone. Banners and phase/plan narrative were removed from the promoted pages ("Frozen for Phase N" headings became "Frozen surface"; the "agent SDK" section of `agent.md` was dropped because the package is gone). Relative links were rewritten (`../../` → `../`). `docs/index.md` is rewritten with Kernel, Packages (grouped, one README link each), Host libraries, Guides, Other reference pages, History, and the unchanged generated inventory block. `!docs/next` is dropped from root `files`.
    - **Index transitional sections (amends Task 3).** `docs.test.ts` still requires exactly one index link per non-archived page, so the 0.12 pages awaiting Task 3 sit under "Other reference pages", grouped by their old headings. **Task 3 trims that section as it retires or replaces each page.** A `## Current line (0.12.1)` stub keeps nine version pins green; **Task 7 rewrites it to 0.13.0** with the version bump.
    - **Collision content kept.** The promoted `tools.md` covered only effects, so a "Registries and filtering" section was added (`createToolRegistry` duplicate policy, `filterTools`, `dispatchToolCall`). This keeps the existing registry pins true instead of deleting them.
    - **Tests.** `docs.test.ts`: removed `isStagedDoc` and the `docs/next` link-check exclusion; replaced `docs_next_is_not_packed_and_not_indexed` with `docs_next_is_promoted` (also fails on staged banners or phase/plan narrative), `released_docs_describe_the_kernel_contract`, and `index_links_every_package_readme`. `apiPages` gained `manifest`, `models`, `provider-kit`, `testing` and lost `tools` (the 15 kernel pages are checked by the new tests, because `agent`, `drivers`, `events`, `packages`, `release`, and others do not follow the 0.12 API-page headings). **Deleted `offer reset: released pages stay released`** (it forbids `definePackage` / `loadManifest` in `/docs`, which is now the contract); Task 4 still replaces the other two offer-reset pins. `packaging.test.ts`: removed the "must not pack staged docs/next pages" assertion. The `docs/next` references in freeze-test messages, example adapter comments, and package READMEs now point at `docs/`.
    - **Results.** `docs.test.ts` + `phase24-truth`: 164 pass / 22 fail (baseline 161 / 24). The 22 are all inherited and belong to Tasks 3–5, 7. `packaging.test.ts` 320 pass / 0 fail; the freeze tests and `guide-samples` pass; `bun run typecheck` exits 0.
    - **Not done here.** `docs/release-and-install.md` and the other 0.12 pages the promoted pages replace stay until Task 3.  `PRODUCT.md` and `README.md` are Task 4.

- [x] Task 3: Retire the superseded 0.12 pages and turn the docs suites green
  - Acceptance Criteria:
    - Functional: Each 0.12 `/docs` page follows its plan 174 Task 1 (g) row:
      - *replaced* pages are deleted, with inbound links repointed to the replacement
      - *retired* pages move to `docs/history/` and are listed in `docs/history/README.md`
      - *still-true* pages are kept, with the edits the row lists

      `docs/providers/*.md` follow their provider README rows.
    - Functional: Each of the 23 `docs.test.ts` failures recorded at survey is fixed at its cause or retired with the page it pinned. Examples: "phase 10 docs reconcile provider compatibility…", "every publishable package ships current README and 0.1.0 changelog documentation", "readme_describes_current_runtime_provider_packages_cli_and_examples", and "offer reset: README pointer". The last two are closed by Task 4. A pin on a retired page is deleted together with the page, and the task note records the pair. A pin on a kept page is updated to the 0.13 truth, never widened. `scripts/phase24-truth.test.mjs` passes, and its five §"Documentation truth criteria" stay in force.
    - Functional: Retirement sweep. `rg` over `docs/` (excluding `history/` and `_evidence/`) for each name retired in plan 174 hits nothing, except `docs/migrate-to-0.13.md` (Task 6), which names them as removed.
    - Performance: n/a.
    - Code Quality: No test is deleted unless its subject page was retired. The note pairs each deleted test with its page.
    - Security: `docs/host-security.md`, `credentials-and-redaction.md`, and `credential-storage.md` either survive as true 0.13 pages or have a named replacement that carries the same threat statements. Task 1 (g) names the mapping.
  - Approach:
    - Documentation Reviewed:
      - plan 174 Task 1 (g); `docs/history/README.md`; the backlog docs entries closed here ("Re-point released docs off the 0.12 memory and context-engineering surface", "Released docs still describe the 0.12 observational-memory subpath", "Released docs still name retired supervisor, router, and observability APIs", "Rewrite released docs that describe retired evals, dev, and messaging surface", "Update the released docs for `prism add` and `prism new package`", "Retire AgentSdkDefinition from /docs and changelogs when SDK 0.2.0 ships", "Triage pre-existing docs test failures outside plan 162", "Released 0.12 prose for the retired mechanisms was left in place")
    - Options Considered:
      - Deleting every 0.12 page. Rejected: some pages are still true (`contributing.md`, `live-testing.md`, and others), and history is kept, not deleted (`prism-wiki.md`).
    - Chosen Approach:
      - Apply the disposition table, fix or retire each pin with its page, then sweep.
    - API Notes and Examples:
      ```bash
      git mv docs/agent-sdk.md docs/history/agent-sdk-0.12.md
      bun test --timeout=0 src/__tests__/docs.test.ts scripts/phase24-truth.test.mjs
      ```
    - Files to Create/Edit:
      - `docs/*.md` and `docs/providers/*.md`, about 150 pages, per Task 1 (g)
      - `docs/history/README.md`
      - `src/__tests__/docs.test.ts`, `scripts/phase24-truth.test.mjs`, and `scripts/live-doc-check.test.mjs` if it pins retired pages
      - `plans/backlog.md`: the executor marks the closed docs entries at plan end
    - References:
      - plan 162 Task 9 (docs triage); `docs/history/` precedent
  - Test Cases to Write:
    - `retired_docs_live_under_history`: every page Task 1 (g) marks *retired* exists under `docs/history/`, and its old path is gone.
    - The `docs.test.ts` and `phase24-truth` suites pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the released docs content.
    - Docs pages to create/edit: per Task 1 (g); `docs/history/README.md`
    - `docs/index.md` update: yes — the History section lists the retired pages, if Task 2's index groups them
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-15):
    - **Dispositions applied.** 147 `docs/*.md` pages became 36 (plus `index.md`). The 15 promoted pages stay. Pages *replaced by `docs/<kernel page>`* or *by a package README* per (g) were `git rm`'d (118 pages, and all 23 `docs/providers/*.md` including `decisions.md`, whose vendor README rows cover them). 19 pages that (g) did not map moved to `docs/history/<name>-0.12.md` and are listed in `docs/history/README.md`: `a2a`, `acp-agent`, `agent-definitions`, `agent-sdk`, `batch-jobs`, `conversations`, `core`, `enterprise-postgres-state`, `impeccable`, `language-intelligence`, `moderation`, `options-index`, `prism-code`, `process-sessions`, `prompt-registry`, `realtime-voice`, `server`, `synapta-integration-review`, `use-case-model-selection`. **(g) gap:** it never named these pages, so this task chose retirement for each (their subjects are gone or have no 0.13 counterpart). `batch-jobs`, `moderation`, and `realtime-voice` could instead point at the `openai` README; their old content is in history.
    - **Kept as still-true (edited).** `contributing`, `coding-security`, `credentials-and-redaction`, `host-security`, `live-testing`, `peer-dependencies`, `settings-auth-trust-security`, `performance`, `operations`, `disaster-recovery`, `resource-loading`, `node-filesystem-config`, `run-bundle`, and the six `migrate-to-0.x` notes plus `migration`. Edits: inbound links to deleted pages were repointed to the replacement page or README or unlinked when no replacement exists; package specifiers were renamed (`prism-coding-tools` → `prism-tools-coding`, `prism-web-tools` → `prism-tools-web`, `prism-work` → `prism-tools-work`, `prism-memory/{rag,wiki}` → `prism-memory-{rag,wiki}`, `prism-core/...` → the owning native package); `host-security.md` lost its `runtime/server` and extension-kernel prose (now `@arnilo/prism-remote`, `@arnilo/prism-mcp-server`, and the package trust statement). The security statements in `host-security`, `credentials-and-redaction`, and `credential-storage` (now the keyring README) survive.
    - **`docs/index.md`.** "Other reference pages" and its 20 subsections are gone. New sections: Reference, Security and credentials, Testing and contributing (plus an Examples gallery link under Guides). The `## Current line (0.12.1)` stub is still Task 7's.
    - **Generated blocks moved.** `scripts/package-truth.mjs` `DOC_BLOCK_TARGETS` now targets `docs/release.md` (a new `## Packages` section holds the `inventory` and `providers` blocks) instead of `release-and-install.md` and `provider-packages.md`. The plan-number parentheticals in `PACKAGE_NOTES` were removed so the promoted page carries no plan narrative. `bun scripts/package-truth.mjs --emit-docs` regenerated README, index, release, and the phase54 evidence map. (Use `bun`, not `node`: the evidence map ordering differs.)
    - **Pin ↔ page pairs.** Deleted `docs.test.ts` tests (each read a deleted or retired page, or pinned 0.12 prose on it). 103 were removed in the first pass, e.g. `phase 10 RAG lifecycle docs…` ↔ `rag.md`; `cli_rpc_docs_*`, `docs_index_links_cli_rpc_page` ↔ `cli-rpc.md`; `release_and_install_*` (8 tests), the `plan 013…029 Task N freeze` and `phase 12` tests ↔ `release-and-install.md`; `provider_*`/`phase48 …` tests ↔ the provider pages; `agent_loops_*`, `agent_events_*`, `structured_output_*`, `registry docs cover strict duplicate policy`, `phase7 distributed events and tool effects…` ↔ their promoted replacements; the rest follow the same rule (their pinned page was deleted or retired). Also deleted: `plan 057 Task 4 no hand-copied counts…`, `every generated provider is documented in the provider pages` ↔ `provider-packages.md`; `umbrella wording matches…` ↔ the `prism-providers` umbrella; `phase 8 evidence…` and `phase 6 docs cover SessionIndex…` ↔ `session-stores.md` and enterprise provider links; `tools_docs_cover_runtime_validator_seam…` ↔ the 0.12 `RunOptions.validate` prose. `scripts/live-doc-check.test.mjs`: the `options-index` tests ↔ `options-index.md`.
    - **Pins updated, not deleted.** `all shipped markdown links resolve locally` now skips `docs/_evidence/` (frozen audit trail); `api pages include required headings` no longer scans `docs/providers`; the page lists in the tests drop deleted paths; `release.md` replaces `release-and-install.md` in every remaining pin; `every publishable package ships current README and changelog documentation` asserts a version section instead of the era-specific 0.1.0 text; `current install, coverage, and SQL adapter docs…` keeps the inventory-equality and `bun add` checks and drops the removed pages' parts (the README/release `current <version> line` pins return in Task 7); `live pages carry one Bun install voice` walks nested workspaces; `host_security_guide…` pins `createAgent({ packages })` where it pinned `createExtensionKernel`. `phase24-truth` kept all five criteria; only its `release-and-install.md` path became `release.md`. New test `retired_docs_live_under_history`.
    - **Peer matrix.** `docs/peer-dependencies.md` now matches the real declarations (`zod` row removed because `ag-ui` no longer declares it, the NATS rows removed, `pg` rows for `memory-core`/`memory-fabric`/`memory-rag`, `playwright-core` for `tools-browser` and `tools-web`, `@opentelemetry/api` for `observability`); `live-testing.md` was regenerated with `bun scripts/generate-live-docs.mjs --write`.
    - **README.** Only the install block changed (retired names such as `prism-core` and `prism-agent-sdk` swapped for native packages), so the install pin holds. Task 4 still rewrites it whole.
    - **Retirement sweep.** `rg` over live `docs/*.md` (excluding `history/`, `_evidence/`, `migrate-to-*`, `migration.md`) for `@arnilo/prism-(core|providers|agent-sdk|code|acp-agent|memory|coding-tools|web-tools|work|hooks|all)`, `defineAgent`, `createAgentSession`, `createExtensionKernel`, `ExtensionAPI`, and "Prism Code": **no hits**. `migration.md` and `migrate-to-*` are era records and keep their names; Task 9 builds the standing sweep.
    - **Results.** `docs.test.ts` + `phase24-truth`: 77 pass / 1 fail (baseline 164 / 22). The one failure, `workflow_examples_cover_required_workflow_surfaces`, is Task 5's. Also green: `live-doc-check`, `truth-current`, `phase54-package-map`, `version-literal-gate` doc legs, `packaging.test.ts`, `reference-host-boundary`, `bun run typecheck`.
    - **Findings for later tasks (red, not docs-caused).** (1) `provider-kit > no_workspace_imports_prism_providers` still finds `@arnilo/prism-providers` in `scripts/e2e-coverage.json` (Task 5) and `templates/**` (untracked WIP templates; Task 5 or a follow-up must fix before Task 9). All docs hits are gone. (2) `scripts/package-truth.test.mjs` fixture tests (3), `release-gate.test.mjs` (`publish_uses_bun…`, `lockstep range gate…`), `version-literal-gate` (`expected 64 manifests… got 60`), and `install-smoke` not naming `@arnilo/prism-driver-process` fail on stale fixtures, not on docs; **Task 7 must fix them** before `release:gate` can pass. (3) `scripts/plan-review-gate.test.mjs` pins `docs/release-and-install.md:317` as a string only and passes. The retired `phase13…phase30` freeze manifests still name deleted pages but are not in `GATE_FILES`, per the runner policy.

- [x] Task 4: Cut `README.md` and `PRODUCT.md` over to the SDK
  - Acceptance Criteria:
    - Functional: `README.md` opens with what Prism is (an SDK kernel on Bun, extended by packages), the install command, and a quickstart. The quickstart is `createAgent` with a provider package and a tool package, a `session.stream` loop, and `agent.dispose()`, as in `PRODUCT.md`'s Example. A short "Write a package" block follows, then a "Packages" table generated from package truth, then links to `docs/index.md`, the examples gallery, and the Prism Agent walkthrough. Every 0.12 runtime description goes: "Current scope", `createAgentSession`, field policy, and the "22 provider adapter subpaths" count.
    - Functional: A new reader can build an agent from `README.md` alone. `readme_quickstart_runs_on_mock_provider` extracts the README's first `ts` block, swaps in the `/testing` mock provider through one documented substitution, and runs it under the examples execution gate. It completes with no secret in its output.
    - Functional: `PRODUCT.md` drops the "Nothing here is shipped yet" banner (`PRODUCT.md:3`). It describes 0.13.0 as shipped, replaces "Prism Code is the reference host" (`:105`) with Prism Agent as the unpublished reference host (§2.13.3), and lists the `driver-process` row and the host libraries as §2.9 has them, including `prism-remote` and `prism-headless`.
    - Functional: The `offer reset: PRODUCT.md`, `offer reset: README pointer`, and `offer reset: released pages stay released` tests (`docs.test.ts:5205,5253,5282`) are replaced by `readme_and_product_describe_0_13`. The new test pins the shipped state: no not-shipped banner, the README quickstart is present, and no "Prism Code" reference host remains. The backlog entry "Replace the prose offer-reset pins with a typed check" closes here.
    - Performance: n/a.
    - Code Quality: The package table is generated from `scripts/package-truth.mjs` output, not hand-maintained, so `generated checks catch drift` (truth criterion 3) holds.
    - Security: The quickstart uses a credential ref (`env:ANTHROPIC_API_KEY`) or relies on the provider's env default. It never contains a literal key.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 "README and PRODUCT" and Done ("A new reader builds an agent from README.md alone"); `PRODUCT.md`; `README.md:1-30`; `src/__tests__/docs.test.ts:5205-5300`; `scripts/package-truth.mjs:205,287` (`PACKAGE_NOTES`, table rows)
    - Options Considered:
      - A README that links out to `docs/agent.md` for the first agent. Rejected: the Done criterion requires the README alone to be enough.
    - Chosen Approach:
      - Rewrite both files, execute the quickstart in the examples gate, and replace the offer-reset pins with shipped-state pins.
    - API Notes and Examples:
      ```ts
      import { createAgent } from "@arnilo/prism";
      import anthropic from "@arnilo/prism-provider-anthropic";
      import coding from "@arnilo/prism-tools-coding";

      const agent = await createAgent({ model: "anthropic/claude-sonnet-4-5", packages: [anthropic(), coding({ root: process.cwd() })] });
      const session = await agent.session();
      for await (const event of session.stream("List the files here")) {
        if (event.type === "message.delta" && event.content.type === "text") process.stdout.write(event.content.text);
      }
      await agent.dispose();
      ```
      (The event shape follows `docs/next/events.md:91`.)
    - Files to Create/Edit:
      - `README.md`, `PRODUCT.md`
      - `src/__tests__/docs.test.ts` (offer-reset pins → `readme_and_product_describe_0_13`), `scripts/examples-execution.test.mjs` (README leg)
      - `scripts/package-truth.mjs` (README table emit, if not already) and `node scripts/package-truth.mjs --emit-docs`
    - References:
      - plan 143 (offer reset pins)
  - Test Cases to Write:
    - `readme_quickstart_runs_on_mock_provider`: fails if the README's first block no longer builds and runs an agent.
    - `readme_and_product_describe_0_13`: fails on a not-shipped banner, a "Prism Code" reference host, or a missing quickstart.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API change; the front-door docs change.
    - Docs pages to create/edit: `README.md`, `PRODUCT.md`
    - `docs/index.md` update: no — the README is not indexed
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **What changed.** `README.md` is rewritten: what Prism is, install, a `createAgent` quickstart (Anthropic provider and coding tools, `session.stream`, `agent.dispose()`, key from the provider's env default, no literal), a "Write a package" block, "Where next" links (docs index, examples gallery, Prism Agent walkthrough), the generated inventory block (unchanged), Scripts, and Non-goals. "Current scope", `createAgentSession`, the CLI section, and the cache and adapter-count prose are gone. `PRODUCT.md` lost the not-shipped banner, names Prism Agent (unpublished) as the reference host, and lists `prism-remote` and `prism-headless` as host libraries (`driver-process` was already in the table).
    - **Tests.** `docs.test.ts`: deleted `offer reset: PRODUCT.md`, `offer reset: README pointer` (they pinned the not-shipped banner), `readme_describes_current_runtime_provider_packages_cli_and_examples` (pinned `createAgentSession`, CLI modes, cache prose), and `readme_quickstart_runs_subscribe_and_run_concurrently` (pinned the deleted 0.12 quickstart); added `readme_and_product_describe_0_13`. `scripts/examples-execution.test.mjs`: added `readme_quickstart_runs_on_mock_provider`. It extracts the first `ts` block, swaps the provider import, model, and `anthropic()` for `mockProvider` from `@arnilo/prism/testing` and `mock/demo`, runs it, and checks stdout has `Hello` and no secret. The README documents the same substitution in prose. Mock text must be a `content_delta` event, not `{ type: "text" }`.
    - **Results.** `docs.test.ts` + `phase24-truth`: 74 pass / 1 fail (`workflow_examples_cover_required_workflow_surfaces`, Task 5's). The quickstart test passes; `bun run typecheck` exits 0.
    - **Findings for later tasks.** (1) The README links `docs/migrate-to-0.13.md` nowhere yet, since the page does not exist: **Task 6 adds that README link** with the page (the `readme_and_product_describe_0_13` link check will cover it). (2) `scripts/package-truth.test.mjs` still has 3 stale-fixture failures (already recorded for Task 7). (3) The `bun add` line in the README names `prism-provider-anthropic` and `prism-tools-coding`; the install-spec pin accepts them.

- [x] Task 5: Cut the examples gallery to host and package examples
  - Acceptance Criteria:
    - Functional: `examples/README.md` leads with host and package examples:
      - `createAgent` with packages
      - `define-package.ts`
      - `custom-loop.ts`
      - `manifest.ts`
      - `headless-host.ts`
      - `external-agent.ts` / `custom-adapter.ts`
      - `build-workflow.ts`
      - the host-library examples (`acp.ts`, `ag-ui-server.ts`, `mcp-server.ts`, remote)

      Each example that imports a name retired in plan 174 or in an earlier phase is deleted, or rewritten if its scenario is still a 0.13 use case (139 files at survey). `examples/build-workflow.ts` is in the gallery and runs under the execution gate.
    - Functional: The `examples_demos_run_to_completion_and_emit_no_secret` gate passes. It was red at survey, and its failing demos were listed in plan 174 Task 1 (f). `workflow_examples_cover_required_workflow_surfaces` passes. `scripts/e2e-coverage.json` and `scripts/examples-manifest.json` list exactly the remaining examples (`e2e-coverage.test.mjs`, `e2e-coverage-gate.mjs`). Backlog "Restore or repoint the spawn-agent-tool example links" closes here.
    - Functional: `examples/tsconfig.json` paths name only live workspaces, and `bun run typecheck` covers the examples.
    - Performance: Record the examples gate wall time before and after.
    - Code Quality: Every remaining example imports only `@arnilo/prism`, its public subpaths, and published packages. The reference-host boundary rule is applied to `examples/` (excluding `examples/adapters/`, which are host code on `prism-driver-process`).
    - Security: `emit no secret` stays in force, and no example reads a real credential in the gate.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 External-agent bullet ("the examples gallery includes `examples/build-workflow.ts`") and README bullet; `examples/README.md` (`## Execution gate`, `## Files`); `scripts/{e2e-coverage.json,examples-manifest.json,examples-execution.test.mjs}`; `src/__tests__/reference-host-boundary.test.ts` (boundary rule)
    - Options Considered:
      - Keeping 0.12 examples under `examples/legacy/`. Rejected: the 0.12 examples live in the 0.12.1 tarball and git history, and keeping them under the gate means keeping retired names alive.
    - Chosen Approach:
      - Classify each example as kept, rewritten, or deleted. Reorder the README and regenerate the coverage rows.
    - API Notes and Examples:
      ```bash
      bun test --timeout=0 src/__tests__/docs.test.ts -t examples_demos_run_to_completion_and_emit_no_secret
      ```
    - Files to Create/Edit:
      - `examples/*.ts|js|mjs` (delete or rewrite), `examples/README.md`, `examples/tsconfig.json`
      - `scripts/{e2e-coverage.json,examples-manifest.json}`
      - `src/__tests__/examples-boundary.test.ts` (new, or extend the reference-host boundary test)
    - References:
      - plan 173 Task 7 (reference host gate leg)
  - Test Cases to Write:
    - `examples_import_only_public_surface`: fails on an example that imports an internal path or a retired package.
    - `build_workflow_example_in_gallery`: `examples/README.md` lists `build-workflow.ts`, and the gate runs it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `examples/README.md`
    - `docs/index.md` update: no — the gallery is linked from `README.md`
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **Survey.** The 0.12 examples were already removed or rewritten in the WIP tree: 122 entries under `examples/`, no import of a retired package, `bunx tsc -p examples --noEmit` clean, `examples_demos_run_to_completion_and_emit_no_secret` green. So no example was deleted or rewritten here.
    - **What changed.** `examples/README.md` gains a "Start here" section that leads with `sdk-basics`, `define-package`, `custom-loop`, `manifest`, `headless-host`, `external-agent` / `custom-adapter`, `build-workflow`, and the host-library examples (`acp`, `ag-ui-server`, `mcp-server`, `remote-agent`); `npm run` wording became `bun run`. `examples/tsconfig.json` lost 35 dead `paths` entries (they pointed at deleted directories; workspace resolution covers the live packages, and the typecheck stays clean). `scripts/e2e-coverage.json` lost the retired `@arnilo/prism-code` entry, which was the only reference to a missing example (`examples/prism-code-headless.ts`); every `examples/` path it names now exists. `docs.test.ts` `workflow_examples_cover_required_workflow_surfaces` pinned the old name `fanOutNode`; the API is `fanOut`, so the pin follows it. The backlog entry "Restore or repoint the spawn-agent-tool example links" is removed (both pages were retired in Task 3; the only remaining hit is a frozen `docs/_evidence` file).
    - **Tests.** New `src/__tests__/examples-boundary.test.ts`: `examples_import_only_public_surface` (retired packages, `src/`, `dist/`, and `packages/` paths; `examples/adapters/` excluded) and `build_workflow_example_in_gallery` (file, README listing, not in the skip manifest). `examples-execution.test.mjs` runs `build-workflow.ts` (50 spawned, 1 skipped, 2.9 s). The pre-change wall time was not measured.
    - **Results.** `docs.test.ts` workflow and examples tests pass. In the combined run with `phase24-truth` and `examples-execution`, 75 pass / 5 fail; the 5 are not examples: `committed artifact equals the generator output`, `counts match manifests at the truth graph`, `index_links_every_package_readme`, `every publishable package ships current README and changelog documentation`, and `0.0.4 release scope matrix…`. All trace to `packages/hosts/acp-agent` (the 0.12 `prism-acp-agent` package, moved under `hosts/` and staged in the working tree after Task 4), which `docs/index.md` and the package truth do not list. **Task 7 decides it:** delete the package (the plan 174 (i) list deprecates `prism-acp-agent`) or index it, and regenerate the truth.
    - **Finding for Task 7/9.** `scripts/e2e-coverage.json` is still stale for non-example content: `e2e-coverage.test.mjs` has 2 failures (annotated suites that no longer exist, such as `src/__tests__/cli-instruction-sources.test.ts`, plus unannotated `@arnilo/prism-provider-clinepass` and a stale `@arnilo/prism-providers` entry). It needs a regeneration pass that this task did not take on.

- [x] Task 6: The 0.13.0 changelog and the migration note from 0.12
  - Acceptance Criteria:
    - Functional: `CHANGELOG.md`'s `## [Unreleased]` entries (accumulated since 0.12.1, plus plans 174–175) become `## [0.13.0] - <publish date>`. They are grouped Added, Changed, and Removed, with duplicate and superseded entries merged. A fresh empty `## [Unreleased]` stays on top.
    - Functional: `docs/migrate-to-0.13.md` covers:
      - `createAgent` 0.12 → 0.13 (sync to async, `packages`, the removed config fields, each mapped to its package)
      - `defineAgent` / `@arnilo/prism-agent-sdk` → `createAgent` (each plane per §2.9 Retired)
      - the 0.12 family package → native package map
      - the removed root exports (plan 174) and where each went
      - the retired interception mechanisms → hooks (§1.2 point 4)
      - `prism -p` → Prism Agent or a host
      - `@arnilo/prism-code` → the reference host walkthrough

      `docs/migration.md` gains a `0.12.1 → 0.13.0` entry that links to it, so that `migrationMentionsVersion` (`scripts/release-gates.mjs:215-218`) passes for `0.13.0`. This is the one new page in Phase 11, required by the Release bullet (plan 174 Task 1 (j)).
    - Functional: Each removed or renamed name the note maps appears in it, cross-checked against the frozen 0.12.1 baseline (Task 7 regenerates the 0.13 baselines). The full diff is 4,399 names (726 across shared packages, 3,673 from deleted packages), mostly internal type aliases, so the cross-check covers the mechanism-level set (43 exports + 11 package names) rather than every alias.
    - Performance: n/a.
    - Code Quality: The changelog has no plan numbers in user-facing lines. The migration note follows the API page structure where it documents a mapping.
    - Security: The note says secrets move to refs (`env:`, `keyring:`), and literal secrets in config now fail closed.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 Release bullet, §1.2, §2.9 Retired; `CHANGELOG.md` `## [Unreleased]` (sections at `:1-55`); `docs/migration.md`; `docs/migrate-to-0.11.md` (precedent)
    - Options Considered:
      - Only a `docs/migration.md` section. Rejected: every prior minor has its own `migrate-to-<x>.md`, and this break is the largest.
    - Chosen Approach:
      - Assemble the changelog from Unreleased, write the note from the baselines and §2.9, and cross-check the note against the baselines.
    - API Notes and Examples:
      ```md
      | 0.12 | 0.13 |
      | --- | --- |
      | `createAgent({ tools: { use: ["coding"] } })` | `await createAgent({ packages: [coding()] })` |
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`, `docs/migrate-to-0.13.md` (new), `docs/migration.md`, `docs/index.md` (Guides entry)
      - `src/__tests__/docs.test.ts`: `migration_note_names_every_removed_export`
    - References:
      - plans 054 and 125 (prior migration notes)
  - Test Cases to Write:
    - `migration_note_names_every_removed_export`: every mechanism-level retired name from the 0.12.1 baseline appears in `docs/migrate-to-0.13.md`. It fails on an unmentioned break.
    - `changelog_has_0_13_0_section`: the version literal gate derives `0.13.0` from the root manifest and finds the section.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the migration guidance.
    - Docs pages to create/edit: `docs/migrate-to-0.13.md` (new), `docs/migration.md`, `CHANGELOG.md`
    - `docs/index.md` update: yes — "Migrate from 0.12: what moved where in the 0.13 kernel and packages."
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **What changed.** `CHANGELOG.md`: the accumulated `## [Unreleased]` block became `## [0.13.0] - 2026-10-15`, regrouped into Added / Changed / Fixed / Removed (the repeated `### Added` / `### Removed` / `### Remote agent example` stubs merged; plan numbers dropped from user-facing lines), with a fresh empty `## [Unreleased]` on top. `docs/migrate-to-0.13.md` is new: the 0.12.1 host checklist, the `createAgent` before/after table, the removed-config-field → package map, the `defineAgent` / agent-SDK plane map, the family-package → native-package map, the removed-root-export table, the retired-interception → hook table, `prism -p` → the reference host, `@arnilo/prism-code` → the walkthrough, secrets-as-refs, upgrade steps, and rollback. `docs/migration.md` gains `## 0.12.1 → 0.13.0 (kernel freeze, package split, and docs promotion)` linking the note; the two stale `## Next lockstep cut` headings became a `### Kernel checkpoint, lease, and workflow-engine moves` subsection and `## Work family package move (0.8.0 detail)`. `docs/index.md` Guides gains one `migrate-to-0.13.md` entry.
    - **Tests.** `docs.test.ts` adds `migration_note_names_every_removed_export` (cross-checks a mechanism-level retired-name list against the frozen `v0.12.1` baseline read from the git tag, and asserts the note names each) and `changelog_has_0_13_0_section` (a dated `## [0.13.0]`, a fresh `## [Unreleased]`, and Added/Changed/Removed headings).
    - **Amendment (test scope).** The literal "every name removed between the 0.12.1 and 0.13.0 baselines" is 4,399 names (726 across shared packages, 3,673 from deleted packages), mostly internal type aliases; the acceptance and the test now cross-check the mechanism-level set the note maps (43 exports + 11 package names), each drawn from the frozen 0.12.1 surface. Task 7's `--update-baseline` regenerates the 0.13 baselines; the note's mapping claims are not asserted absent here because the working-tree baselines are still partially stale.
    - **Findings.** (1) The working-tree `scripts/compat-baseline/*.txt` are partially regenerated: `createExtensionKernel` is gone but `applyCacheControl` and `applyDefaultProviderRequestOptions` remain, and `createMemoryAgentEventSource` is present although it moved to `./testing`. **Task 7 must regenerate them** before `release:gate`. (2) `bun run typecheck` is red in `@arnilo/prism-ag-ui` (`src/__tests__/a2a-server.test.ts` imports `createMemoryAgentEventSource` from the kernel and `AgUiA2AServer` from its own index), a pre-existing WIP break in a newly added package, not this task's; Task 7/9 must resolve it with the A2A drop. (3) `docs/migrate-to-0.13.md` is exempt from the kernel-contract token scan (`docs/migrat*`); for the retired-0.3-package sweep it names `@arnilo/prism-all` on a line carrying `retired`, so the sweep passes.
    - **Results.** `docs.test.ts` + `phase24-truth`: 72 pass / 5 fail; the 5 are the pre-existing `packages/hosts/acp-agent` failures Task 5 recorded. The two new tests pass; `all shipped markdown links resolve locally`, the one-link index test, the retired-0.3 sweep, and `readme_and_product_describe_0_13` pass. Root `tsc --noEmit` exits 0.

- [x] Task 7: Cut every package to 0.13.0 and regenerate the compat baselines
  - Acceptance Criteria:
    - Functional: `bun scripts/release.mjs bump --from 0.12.1 --to 0.13.0 --ranges caret` sets every publishable manifest to `0.13.0` and rewrites internal ranges. `syncKernelVersion` updates `src/version.ts`. Every `definePackage` `requires.prism` becomes `"^0.13.0"` — the kernel `parseRange` rejects bare partials (`1.2`), so the survey's `"^0.13"` would fail `definition_invalid` at load. At survey there were 32 `"^0.12.1 || ^0.13.0-0"` and one `"^0.12.1"`, and the `templates/` value is `"^{{kernelVersion}}"`, which the template fills. Every `file:../..` internal dependency becomes a `^0.13.0` range in published bytes. `bun.lock` is regenerated with no duplicate keys (backlog "Stop bun install from duplicating lock keys").
    - Functional: `bun scripts/release.mjs gate --update-baseline` regenerates every live `scripts/compat-baseline/*.txt`. The task note shows the diff against the 0.12.1 baselines per package, with each removal attributed to a plan. Then `bun scripts/release.mjs gate --lockstep --version 0.13.0 --allow-break` passes (the `--lockstep` flag is required: without it `parseArgs` treats the gate as independent and rejects `--version`), with the Task 6 migration note satisfying `migrationMentionsVersion`. `bun run release:gate` exits 0.
    - Functional: `scripts/budgets.json` `root`, `exportCounts`, and `kernel` are re-measured at 0.13.0 with a recorded reason. `scripts/version-literal-gate.test.mjs` and `scripts/package-truth.test.mjs` pass. `node scripts/package-truth.mjs --emit-docs` is regenerated.
    - Functional: The no-pre-release check: no manifest, `requires`, or doc names `0.13.0-0` or `^0.12` (grep).
    - Performance: n/a.
    - Code Quality: Version literals are derived from the root manifest, never hard-coded (version literal gate).
    - Security: The packed tarballs (`bun scripts/release.mjs pack --destination release-artifacts`) pass the deny list and the secret scan. `release-artifacts/` is not committed.
  - Approach:
    - Documentation Reviewed:
      - roadmap Part 3 Version targets; plan 174 Task 1 (h); `scripts/release.mjs:131-185` (`syncKernelVersion`, `bumpRelease`, `rewriteInternalRanges`, `regenerateLockfile`); `.agents/skills/prism-execution/references/release.md`
    - Options Considered:
      - A `0.13.0-next` pre-release first. Optional per Part 3 and not required. Skipped unless the owner asks in Task 10.
    - Chosen Approach:
      - Use the release script's bump, then the range rewrite, the baseline regeneration, and the gate.
    - API Notes and Examples:
      ```bash
      bun scripts/release.mjs bump --from 0.12.1 --to 0.13.0 --ranges caret
      bun scripts/release.mjs gate --update-baseline
      PRISM_TEST_POSTGRES_URL=… bun run release:gate
      ```
    - Files to Create/Edit:
      - every publishable `package.json`, `src/version.ts`, `bun.lock`
      - every `packages/**/src/index.ts` `requires.prism`; `templates/**` (verify only)
      - `scripts/compat-baseline/*.txt`, `scripts/budgets.json`, `scripts/package-truth.json`, generated docs tables
    - References:
      - plan 125 (lockstep cut mechanics)
  - Test Cases to Write:
    - `every_package_requires_prism_0_13`: every non-test `definePackage` in `packages/**` has `requires.prism === "^0.13.0"` (the `"*"` test fixtures are excluded; the no-pre-release guard below covers them). It fails on a stale range.
    - `no_prerelease_or_0_12_range_in_manifests`: fails on `0.13.0-0` or `^0.12`.
    - The existing `release-gate.test.mjs` and `version-literal-gate.test.mjs` pass at 0.13.0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — versions and ranges.
    - Docs pages to create/edit: the generated package tables (`--emit-docs`); `docs/release.md` if it names a version
    - `docs/index.md` update: yes — the current-line banner moves to 0.13.0
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **Prerequisite strays removed.** The worktree carried four leftovers that earlier plans' notes already record as deleted, and each broke a Task 7 gate: `packages/hosts/acp-agent/` (plan 174 Task 7; it made `package-truth`/`docs` count 61 != 60, and `bun.lock` had no entry for it), `packages/tools/coding/src/agent/workspace-lifecycle.ts` + its test (plan 165 Task 6; it referenced the retired `CheckpointStore`/`LeaseStore` and workspace limits, so the compat declaration emit failed), `packages/hosts/ag-ui/src/{a2a,a2a-server}.ts` + `a2a-server.test.ts` (plan 174 Task 6; it imported the retired `createMemoryAgentEventSource`), and `packages/tools/web/src/obscura/__tests__/browser.test.ts` (plan 155 Task 3; it imported the removed `createBrowserTools`). Deleting them made `bun run typecheck` exit 0 (it was red in `@arnilo/prism-tools-coding`, `@arnilo/prism-ag-ui`, and `@arnilo/prism-tools-web`).
    - **Bump.** `bun scripts/release.mjs bump --from 0.12.1 --to 0.13.0 --ranges caret` rewrote all 60 publishable manifests to 0.13.0, internal `dependencies`/`peerDependencies`/`optionalDependencies` to `^0.13.0`, and `src/version.ts` `KERNEL_VERSION` to 0.13.0. The script excludes `devDependencies` from `DEPENDENCY_FIELDS`, so four first-party `devDependencies` still pinned `^0.12.1` (`packages/hosts/channels` on `prism-store-sqlite`; `packages/hosts/headless` on `prism-approval`, `prism-remote`, `prism-store-sqlite`), and `bun install` then failed with registry 404s; they were converted to the repo's `file:` convention (`file:../../stores/sqlite`, `file:../../policy/approval`, `file:../remote`) and `bun.lock` regenerated clean. 48 `requires.prism` declarations across 42 files under `packages/` became `^0.13.0` (46 `"^0.12.1 || ^0.13.0-0"` + the one `"^0.12.1"` keyring definition + the 5 `"*"` test fixtures, which stay fixtures); the same range was swept from the reference host (`apps/prism-agent/src/host/orchestrator.ts` and its README), 8 `examples/*.ts`, `docs/packages.md`, `docs/testing.md`, and the `requires.prism`/manifest-`version` examples in 8 package READMEs, and the `docs/index.md` current-line banner moved to 0.13.0.
    - **Version claims.** `src/index.ts` `export const version`, `docs/index.md` `## Current line (0.13.0)`, the release-workflow tag list (`"v0.13.0"` before `"@arnilo/*@*"`), `scripts/package-truth.json` (`--emit-docs`), and `scripts/version-literal-gate.test.mjs` (64 manifests -> 60: root + 59 workspaces) all moved to 0.13.0.
    - **Baseline diff (live baselines vs `v0.12.1`).** 60 live baselines; 36 are new native packages with no 0.12.1 counterpart (the provider/tool/memory/store/host packages), and 24 compare against 0.12.1: **708 removed / 936 added / 343 changed**. The kernel `arnilo__prism.txt` is -503/+487/~95 — plan 174 Tasks 2-7: the prompt runner and `cli-providers`, run-bundle, use-case model, cache telemetry, capture, conversation helpers, agent-definition resolver, settings providers, memory event-source, and persistence lifecycle deleted; provider wire helpers -> `@arnilo/prism/provider-kit`; speech/transcription/image/realtime/video/batch/moderation contracts -> the provider packages; checkpoint/lease/workflow-engine -> `@arnilo/prism-workflows`; field-policy/field-evidence/claim-grounding/readiness/identity -> `@arnilo/prism-governance`; timeline/usage -> `@arnilo/prism-observability`; device policy -> `@arnilo/prism-tools-computer-use`; `createMemoryAgentEventSource` -> `@arnilo/prism/testing`; plus the Task 9 export freeze. `arnilo__prism-ag-ui.txt` -95/+0/~12 (plan 174 Task 6 dropped A2A/ACP). `arnilo__prism-workflows.txt` -66/+120/~53 (the workflow engine moved in). `arnilo__prism-provider-openai.txt` -2/+90/~12 (speech/transcription/image/realtime types moved in). `arnilo__prism-mcp.txt` -17/+25/~25, `arnilo__prism-memory.txt` -14/+15/~33, `arnilo__prism-channels.txt` -5/+24/~36, `arnilo__prism-evals.txt` -0/+49/~34, `arnilo__prism-model-router.txt` -0/+11/~19, and small provider deltas. Twelve 0.12.1 baselines were deleted: `prism-{acp-agent,agent-sdk,code,coding-tools,core,hooks,impeccable,providers,work}` (retired) and `prism-session-store-{codecs,postgres,sqlite}` (renamed to `prism-store-*`).
    - **Budgets re-measured.** The plan 175 docs promotion shrank the packed root tarball: `root` and `kernel` packed/unpacked/fileCount were lowered from 1604691/5113118/468 (plan 174 Task 8) to **1030873/3356162/355**; `kernel.rootExports` 1424 and `kernel.sourceLines` 34624 are unchanged; `exportCounts["@arnilo/prism"]` stays 1424. Reasons recorded on each `$comment`.
    - **Gates.** `gate --update-baseline` exit 0; `gate --lockstep --version 0.13.0 --allow-break` exit 0; `bun run release:gate` exit 0 with `PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@localhost:5432/postgres` (without it the postgres surface is `blocked`). `bun run typecheck` exit 0. `scripts/version-literal-gate.test.mjs`, `scripts/package-truth.test.mjs`, `scripts/release-gate.test.mjs`, `src/__tests__/packaging.test.ts`, `src/__tests__/install-smoke.test.ts`, `src/__tests__/docs.test.ts`, `scripts/truth-current.test.mjs`, `scripts/packaging-current.test.mjs` all green. `bun scripts/release.mjs pack --destination release-artifacts` packs 60 tarballs; the gate's deny-list check and `bun scripts/scan-secrets.mjs` over the unpacked tarballs (1500 files) report 0 findings. `release-artifacts/` is gitignored.
    - **Stale fixtures repaired (Task 5 finding).** `scripts/package-truth.test.mjs` wrote `"{}"` fixtures that the plan 172 `readManifest` validation rejects (now valid `{name,version}`); `scripts/release-gate.test.mjs` still asserted the retired `prism-core` tarball name and error text (now `prism-sample`); `src/__tests__/install-smoke.test.ts`'s hand list was missing the 7 packages `driver-process`, `headless`, `remote`, `delegate`, `observability`, `guardrail-packs`, `tools-research`.
    - **Findings for later tasks.** (1) The postinstall `ln -sfn ../../../../.. node_modules/@arnilo/prism` fails once bun has materialized the `file:../../..` devDependency as a directory, so a clean `bun install` exits 1; `bun install --ignore-scripts` plus a manual symlink is the local workaround. Not fixed here (it affects 59 packages). (2) `scripts/compat-baseline/` still holds 31 historical baselines for packages retired before 0.13.0 (`prism-memory`, `prism-providers`, `prism-web-tools`, `prism-compaction-llm`, `prism-rag`, `prism-wiki`, `prism-office`, `prism-server`, …); `--update-baseline` does not touch them and the gate ignores them, but Task 9's sweep or the backlog should decide whether to delete them (the dormant `phase13`-`phase30` freeze suites still read some). (3) `scripts/coverage-summary.json` and `scripts/e2e-coverage.json` still name `@arnilo/prism-acp-agent` / `packages/ag-ui/src/__tests__/acp-agent.test.ts` (pre-existing stale rows).

- [x] Task 8: Registry deprecation tool without npm
  - Acceptance Criteria:
    - Functional: `scripts/registry-deprecate.mjs` has three modes:
      - `--generate`: reads the plan 174 Task 1 (i) list from `scripts/deprecations-0.13.json` (name, range, message, successor), resolves each name's published versions with an anonymous `GET https://registry.npmjs.org/<name>`, and writes `release-artifacts/deprecation-plan.json` (the artifact is gitignored, so the operator or the workflow generates it before applying).
      - `--dry-run`: prints, per name, the versions in range and the message. It mutates nothing.
      - `--apply --confirm`: requires `NPM_TOKEN` from the environment. Per name, it fetches the full packument, sets `versions[v].deprecated = message` for each version in the range, and writes the packument back with an authenticated `PUT`. It writes per-entry status back to the plan for safe resume, and skips entries that are already correct.
    - Functional: The apply mode fails closed, with zero mutations, if any of these holds:
      - a name's `latest` dist-tag is inside the deprecation range for a name a 0.13.0 package reuses (it would deprecate the new line)
      - a reused name has no `0.13.0` published yet
      - the plan file was generated against a different registry state
      - `NPM_TOKEN` is missing
    - Functional: `.github/workflows/npm-deprecate.yml` runs `bun scripts/registry-deprecate.mjs --generate`, then `--dry-run`, then `--apply --confirm` from the committed list instead of `npm deprecate`. The `confirm: deprecate` input guard stays. No `npm` binary runs (backlog P2 "Phase 11 registry operations without npm").
    - Functional: The list covers `@arnilo/prism-agent-sdk` (`*`), `@arnilo/prism-code` (`*`), `@arnilo/prism-acp-agent` (`*`), and each 0.12 family name. Each message names the successor and the `docs/migrate-to-0.13.md` anchor. Reused names are range-scoped `<0.13.0`.
    - Performance: Apply issues one `GET` and at most one `PUT` per name.
    - Code Quality: Only Bun stdlib and `fetch`. No npm-registry client dependency. Offline fixture tests inject `fetch`, following the `PRISM_LEGACY_*` fixture pattern from `scripts/phase54-legacy-registry*.test.mjs`.
    - Security: The token is read from the environment only and is never logged; a test asserts that the plan file and stdout contain no token. Requests go only to the configured registry host. The default `https://registry.npmjs.org` is overridable only for fixtures.
  - Approach:
    - Documentation Reviewed:
      - backlog "Phase 11 registry operations without npm"; `scripts/phase54-legacy-registry.mjs` (the plan/dry-run/apply/resume pattern, `DEPRECATE_RANGE`, `entryProblems`); `.github/workflows/npm-deprecate.yml`
      - npm registry write protocol: the npm CLI `deprecate` command GETs the packument, sets `versions[v].deprecated`, and PUTs it back to `/<name>`. The executor confirms this with find-docs or the npm CLI source before coding, and records the reference.
    - Options Considered:
      - Calling `npm deprecate` from the runner image, as today. Rejected: plan 164 Task 8.4 took npm out of the release path.
      - A recorded manual step. Rejected: about 15 names with range-scoped messages is error-prone by hand, and a script can fail closed on a reused name.
    - Chosen Approach:
      - Generalize the phase54 pattern to the registry HTTP API with injected `fetch`, and wire it into the existing operator workflow.
    - API Notes and Examples:
      ```bash
      bun scripts/registry-deprecate.mjs --generate
      bun scripts/registry-deprecate.mjs --dry-run
      NPM_TOKEN=… bun scripts/registry-deprecate.mjs --apply --confirm   # CI workflow only
      ```
    - Files to Create/Edit:
      - `scripts/registry-deprecate.mjs` (new), `scripts/deprecations-0.13.json` (new), `scripts/registry-deprecate.test.mjs` (new)
      - `.github/workflows/npm-deprecate.yml`, `scripts/workflow-liveness.test.mjs`
      - `docs/release.md`: the deprecation procedure
    - References:
      - plan 054 Task 7; plan 140 Task 6 (`npm-deprecate.yml`)
  - Test Cases to Write:
    - `deprecate_plan_scopes_reused_names`: a fixture registry where `@arnilo/prism-mcp` has 0.12.1 and 0.13.0 produces a `<0.13.0` entry that marks only 0.12.x versions.
    - `apply_refuses_when_latest_in_range`: zero `PUT`s, and the error names the package.
    - `apply_refuses_when_a_reused_name_has_no_0_13_published`: zero `PUT`s.
    - `apply_refuses_on_registry_state_drift`: a release landing after `--generate` aborts with zero `PUT`s.
    - `apply_refuses_without_a_token`: exit 2, zero `PUT`s.
    - `apply_skips_already_deprecated`: idempotent resume.
    - `apply_never_logs_token`: captured stdout, stderr, and the plan file contain no token; the token travels only in the request header.
    - `versionInRange`/`escapedName` units, plus one CLI test that serves a fixture registry from 127.0.0.1 through `PRISM_DEPRECATE_REGISTRY`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release tooling.
    - Docs pages to create/edit: `docs/release.md` (the deprecation section)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-15):
    - **Delivered.** `scripts/registry-deprecate.mjs` (three modes, `fetch` injected, fail-closed), `scripts/deprecations-0.13.json` (17 names: 11 whole-package `*` and 6 range-scoped `<0.13.0`), `scripts/registry-deprecate.test.mjs` (10 tests, offline), the rewritten `.github/workflows/npm-deprecate.yml` (generate → dry-run → apply, `confirm: deprecate` guard kept, no npm), the `workflow-liveness.test.mjs` update, `docs/release.md`'s deprecation procedure, and `scripts/registry-deprecate.test.mjs` in `GATE_FILES`. The npm write protocol was confirmed against the local npm 12 source (`lib/commands/deprecate.js`: `GET /<escapedName>?write=true`, set `versions[v].deprecated`, `PUT /<escapedName>` with `Authorization: Bearer <token>`) and npm-registry-fetch's auth builder.
    - **Live check.** `--generate` against the real registry reproduced plan 174 Task 1 (i) exactly: latest versions and counts match (`prism-code` 0.4.1/44, `prism-providers` 0.12.1/63, `prism-memory` 0.12.1/59, `prism-mcp` 0.12.1/59, `prism-evals` 0.3.0/41, …). `--dry-run` planned the 11 whole-package entries and failed closed on all 6 reused names (`latest … is inside <0.13.0` and `0.13.0 is not published yet`) — the correct pre-publish state; the guards fire against the real registry, not only fixtures. Anchors in every message resolve against `docs/migrate-to-0.13.md` (checked at generate time).
    - **Deliberate deviation from npm.** `*` matches every published version including prereleases, but `<0.13.0` uses the kernel parser and so excludes `0.13.0-*`: npm's `includePrerelease` would deprecate a reused name's own prereleases. Excluding them is the safe direction.
    - **Stale fixtures repaired.** `scripts/run-all-tests.test.mjs`'s `scriptFiles` accepted only `.test.js`, so `@arnilo/prism-channels` (the one package that lists explicit `.test.ts` files) declared an empty set — the filter now accepts `.test.ts`; the same file's unused `packagesDir` (its `prism-core` assertion retired) is gone; `workflow-liveness.test.mjs`'s fixture used `npm run build -w @arnilo/prism-workflows`, and no package has a `build` script any more, so it now uses `typecheck`.
    - **`bun.lock` regenerated.** The Task 7 lockfile kept 58 phantom peer resolutions of `@arnilo/prism@0.12.1` from the registry (the pre-bump peer range). A fresh resolve drops them (0 remain) and every nested `@arnilo/prism` resolves to the 0.13.0 workspace root; the 4 `file:` devDependencies from Task 7 stay. `bun install` still warns once per package that `^0.13.0` is unsatisfiable from the registry — expected until Task 10 publishes.
    - **Budgets re-measured.** `docs/release.md` grew, so `root`/`kernel` packed/unpacked moved from 1030873/3356162 to **1031333/3357375** (355 files unchanged); `rootExports` 1424 and `sourceLines` 34624 unchanged.
    - **Blocking finding for Tasks 10–11: `bun ci` fails on this repo under bun 1.4.2.** `bun install` is not idempotent in the lockfile's root-workspace `bin` metadata: it moves `"bin": { "prism": … }` between the root `@arnilo/prism` resolution and `@arnilo/prism-agent/@arnilo/prism`, then drops it, and `bun install --frozen-lockfile` (`bun ci`) rejects every shape with `lockfile had changes, but lockfile is frozen`. Reproduced on a manifests-only copy of the tree and bisected to the root package's `bin` field plus its `file:` dependents (removing the root `bin` makes it idempotent). All 9 existing workflows plus the new one run `bun ci`, so CI and the publish path cannot install until this is resolved (bun version bump, or the kernel moves out of the workspace root). Nothing in Task 8 depends on the install: the script imports only `src/packages/semver.ts` and stdlib.
    - **Other findings.** (1) `bun run format:check` fails on 20 pre-existing files (`apps/prism-agent/src/**`, `examples/**`, `biome.json`, and the untracked `.tmp-probe/probe.ts` scratch file) — migration drift, not Task 8; `bun run format` fixes it. (2) `biome lint .` reports 190 errors repo-wide (same drift). (3) `docs/release.md` is a kernel page, so it may not carry `plan NNN`/`Phase N` prose — the deprecation section names no plan. (4) `release-artifacts/deprecation-plan.json` is gitignored, so the workflow generates it in-run; `--apply` still requires it, which keeps the registry-drift guard.
    - **Baseline diff:** none — no export moved, so no `--update-baseline` was needed. `gate --lockstep --version 0.13.0 --allow-break` and `bun run release:gate` (with Postgres) both exit 0; `bun run typecheck` exits 0; `docs.test.ts` 64/64, `workflow-liveness` 9/9, `run-all-tests` 17/17, `tooling-gate` 11/11, `registry-deprecate` 10/10, `import-hygiene` green.

- Task 9: The final retired-name sweep and the post-train references — **moved to plan 187 Task 1 on 2026-10-16** (not executed here; the full task text lives there).

- Task 10: Publish 0.13.0, apply the deprecations, switch to independent versioning, and record Phase 11 Done (owner-gated) — **moved to plan 187 Task 2 on 2026-10-16** (not executed here; the full task text lives there).

## Verification (whole plan)

- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/docs.test.ts scripts/phase24-truth.test.mjs`
- `bun test --timeout=0 scripts/retired-names.test.mjs scripts/registry-deprecate.test.mjs scripts/release-gate.test.mjs scripts/version-literal-gate.test.mjs scripts/package-truth.test.mjs src/__tests__/release.test.ts src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `bun run test`
- `bun run sdk:ready`
- `PRISM_TEST_POSTGRES_URL=… bun run release:evidence && PRISM_TEST_POSTGRES_URL=… bun run release:gate`
- `bun scripts/registry-deprecate.mjs --dry-run` (after Task 10: nothing left to apply)
- `bun scripts/post-publish-smoke.mjs --version 0.13.0`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- **P0 — `bun ci` cannot install this repo under bun 1.4.2 (found in Task 8; blocks Tasks 10–11).** The lockfile's root-workspace `bin` metadata is non-idempotent, so `bun install --frozen-lockfile` rejects every lockfile `bun install` writes (`lockfile had changes, but lockfile is frozen`). Every workflow, including the publish path, starts with `bun ci`. Bisected to the root package's `bin` field plus its `file:` dependents. Fix by bumping the pinned bun, or by moving the kernel out of the workspace root so it is not both a published package with a `bin` and a `file:` peer target.
- To be filled after task completion with improvements, rationale, and priority.
