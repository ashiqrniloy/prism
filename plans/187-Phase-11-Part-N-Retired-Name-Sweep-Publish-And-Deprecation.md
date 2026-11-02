# Phase 11 Part N — retired-name sweep, publish 0.13.0, and npm deprecation

## Objectives

- Run the final retired-name sweep as a standing test, and update the planning and execution skill references for the post-0.13 world.
- Publish `@arnilo/prism` 0.13.0 with its native packages and host libraries, apply the npm deprecations, switch to independent versioning, and record the Phase 11 Done criteria.

## Expected Outcome

- `scripts/retired-names.json` and `scripts/retired-names.test.mjs` exist, and the live tree has no retired name. The list includes the 16 provider packages plan 182 deleted and left deleted; `openrouter` is excluded because 0.13.0 republishes it (plan 203).
- After owner confirmation, the packages are published from CI and the deprecations are applied, including the 15 deleted provider names published at 0.3.1 and `@arnilo/prism-provider-openrouter`, whose legacy line is deprecated below 0.13.0 because the name is reused (plan 203). `bun scripts/post-publish-smoke.mjs` passes against the registry. `scripts/independent-packages.json` lists every 0.13.0 package as independently versioned.

**0.13.0 release path — plan 187 of 181–187.** Start it when plan 186 is complete; when this plan is complete, continue with nothing: this is the last plan before 0.13.0 ships. Plans 181–201 run strictly in step order (see `plans/README.md`), and nothing runs in parallel.

**Amended 2026-10-25 by plan 204 (OpenAI Codex ships; the retired-name list gains nothing).** The release commit publishes `@arnilo/prism-provider-openai-codex` for the first time. Unlike `openrouter` there is no un-deprecation and no `<0.13.0` entry: the name never shipped, so it is absent from `RETIRED_PROVIDERS` and from `scripts/retired-names.json`, and `scripts/deprecations-0.13.json` stays at 33 entries. The only registry text that names it is the `@arnilo/prism-providers` umbrella successor and the `@arnilo/prism-provider-openai` message, which now reads “For ChatGPT-plan access use @arnilo/prism-provider-openai-codex” while keeping `@arnilo/prism/provider-kit` as its successor (`retired-providers.test.mjs` asserts both). Counts move where a new manifest moves them, not here: the shipped provider set is seven packages, `scripts/package-truth.json` lists the package at 0.13.0, the package map carries 47 current manifests (root plus 46 workspaces), and Task 2's `scripts/independent-packages.json` list gains this package as a member — that list is filled at release time and is empty until then.

**Amended 2026-10-28 by plan 205 (Command Code is in the tree but does not publish at 0.13.0).** Plan 205 Task 2 added `@arnilo/prism-provider-commandcode` and removed `commandcode` from `RETIRED_PROVIDERS`, so the retired-name sweep now treats it as a live in-tree name like `openrouter`; `scripts/retired-names.json` must not list it, and `scripts/deprecations-0.13.json` gains no entry — the name never shipped as a standalone package, so there is nothing to deprecate. The umbrella's `successor` field does name it: `retired-providers.test.mjs` derives that braced list from the provider directories, so the in-tree package must appear even though the 0.13.0 cut does not publish it; the human-readable `message` string keeps the seven-package list. `commandcode` therefore leaves Task 1's 0.12.1 list: fourteen of the sixteen deleted provider packages remain there for 0.13.0, plus `ollama` (plan 206 later). Counts move: `scripts/package-truth.json` records 48 publishable workspaces (root plus 47), 48 `codeWithPeer` and eight provider packages in the tree, while the release commit still publishes the seven 0.13.0 providers. Task 2's publish list and `scripts/independent-packages.json` exclude `commandcode` until the release after 0.13.0 (plan 205 Task 5); the row is active in `scripts/live-matrix.json` and is not a 0.13.0 gate.

**Amended 2026-10-31 by plan 213 (Kilo Gateway ships in 0.13.0).** The release commit publishes `@arnilo/prism-provider-kilo`, so Task 2's publish list and `scripts/independent-packages.json` gain the package and 0.13.0 publishes eight providers. It is a new npm name: `scripts/deprecations-0.13.json` gains no entry and `kilo` must not enter `scripts/retired-names.json`. The umbrella successor and human-readable message list the eight in-tree provider packages (including `kilo`; `commandcode` remains listed as in-tree but unpublished), matching `retired-providers.test.mjs`, which derives the braced successor list from the provider directories. Counts move with the package, not this amendment: `scripts/package-truth.json` records 49 publishable manifests (root plus 48 workspaces) and nine provider packages in the tree, while this cut still publishes eight. The 205 amendment's 48/8 and seven-package lists are superseded.

**Amended 2026-10-31 by plan 214 (LiteLLM Gateway ships in 0.13.0).** The release commit publishes `@arnilo/prism-provider-litellm`, so Task 2's publish list and `scripts/independent-packages.json` gain the package and 0.13.0 publishes nine providers. It is a new npm name: `scripts/deprecations-0.13.json` gains no entry and `litellm` must not enter `scripts/retired-names.json`. The umbrella successor and human-readable message list the nine in-tree provider packages (including `litellm`; `commandcode` remains listed as in-tree but unpublished), matching `retired-providers.test.mjs`, which derives the braced successor list from the provider directories. Counts move with the package, not this amendment: `scripts/package-truth.json` records 50 publishable manifests (root plus 49 workspaces) and ten provider packages in the tree, while this cut still publishes nine. The 213 amendment's 49/9 and eight-package lists are superseded.

**Amended 2026-11-01 by plan 206 (Ollama Cloud is in the tree but does not publish at 0.13.0).** Plan 206 Task 2 added `@arnilo/prism-provider-ollama-cloud`; `ollama-cloud` must not enter `scripts/retired-names.json` and `scripts/deprecations-0.13.json` gains no entry, because the name never shipped. `ollama` **stays** on the 0.13.0 sweep list — its successor package is deferred — and its deprecation message now points at `@arnilo/prism-provider-ollama-cloud` explicitly, which is the only new registry text naming the package. The umbrella `successor` field and the human-readable successor list name it because `retired-providers.test.mjs` derives the braced list from the provider directories; the new name is simply one more member. Counts move: `scripts/package-truth.json` records 51 publishable manifests (root plus 50 workspaces) and eleven provider packages in the tree, while the release commit still publishes the nine 0.13.0 providers and excludes `commandcode` and `ollama-cloud` from Task 2's publish list and `scripts/independent-packages.json` until their post-0.13.0 release. The 214 amendment's 50/10 and nine-package lists are superseded.

This plan is the final part of roadmap **Phase 11**. **Tasks 1–2 moved here unchanged from plan 175 Tasks 9–10 on 2026-10-16**, when the release plans were put in execution order. Plan 175 Tasks 1–8 (docs promotion, README cut, examples, changelog, version cut, deprecation tool) are complete and stay there. Inside Tasks 1–2, "plan 175 Task N" means that plan's completed tasks. Additions from the 2026-10-16 decisions:
- Task 1's curated list includes the 16 provider packages plan 182 Task 2 deleted and that stay deleted (`ai-sdk`, `alibaba`, `anthropic`, `azure`, `bedrock`, `clinepass`, `commandcode`, `deepseek`, `google`, `kimi`, `neuralwatt`, `ollama`, `openai`, `vertex`, `xai`, `zai`). The baseline diff cannot find them, because they did not exist in 0.12.1. `openrouter` left the list on 2026-10-25: plan 203 republishes it at 0.13.0, so it is a live name. `commandcode` left the list on 2026-10-28 (amendment below): plan 205 Task 2 added the package in-tree and removed it from `RETIRED_PROVIDERS`, so the sweep treats it as live; it still does not publish at 0.13.0. `ollama` stays on it for 0.13.0 — its successor package is deferred to the release after 0.13.0 (owner scope change 2026-10-25, plan 206), so this sweep treats it exactly as before.
- Task 2's deprecations include the 15 of those published at `0.3.1`, with the message plan 182 Task 2 wrote into `scripts/deprecations-0.13.json`, plus `@arnilo/prism-provider-openrouter` on the `<0.13.0` reused-name range (amended 2026-10-25 by plan 203).
- Task 2's pre-flight requires plan 181 Task 1's `bun ci` fix to hold on the release commit (the P0 recorded in plan 175 Further Actions).

The plan does not change a kernel contract, so it has no review; the owner gates the tag push and the deprecation dispatch.

## Tasks

- [ ] Task 1: The final retired-name sweep and the post-train references
  - Acceptance Criteria:
    - Functional: `scripts/retired-names.json` lists every name the train retired: the export names and subpaths from the 0.12.1 → 0.13.0 baseline diff, the retired package names, the retired error codes and classes recorded in plans 143–174, and the CLI flags. `scripts/retired-names.test.mjs` greps `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `node_modules/`, `plans/`, `docs/history/`, `docs/_evidence/`, `CHANGELOG.md`, `docs/migrate-to-0.13.md`, `scripts/retired-names.json`, `scripts/deprecations-0.13.json`, and the compat baselines' history) and fails on any hit. It runs in `bun run test`.
    - Functional: The planning and execution skill references describe the post-0.13 world:
      - `.agents/skills/create-plan/references/prism.md` §1 drops the `apps/prism-code` lab row in favor of the reference host (`apps/prism-agent`), and §5 drops assumptions the train retired
      - `prism-wiki.md`'s "Where docs go during the 0.13.0 train" becomes "Where docs go": kernel pages in `/docs` (written with the API), package READMEs, and `CHANGELOG.md`
      - `.agents/skills/prism-execution/references/release.md` "Today" describes independent versioning after 0.13.0

      This resolves plan 174 Task 1 (j).
    - Functional: `roadmap.md` and `PRODUCT.md` are consistent with the published state. The roadmap's "Shipped baseline" line names 0.13.0. `roadmap.md` stays the target document: this task updates facts and adds no phases.
    - Performance: The sweep test runs in under 5 s, using `rg`, or a Bun walk if `rg` is absent in CI.
    - Code Quality: The retired-name list is generated from the baseline diff plus a hand-curated error list, not maintained by hand alone. The generator is in the same script.
    - Security: n/a — a repository scan.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 Release bullet ("a grep over `scripts/`, `examples/`, and every workspace for retired names and error strings"); `.agents/skills/create-plan/SKILL.md` "Task writing rules" (retirement sweep); plan 080 (retired errors left in tests)
    - Options Considered:
      - A one-off grep recorded in the task note. Rejected: a standing test keeps retired names from coming back after 0.13.0.
    - Chosen Approach:
      - Generate the list, run a standing sweep test, and update the references.
    - API Notes and Examples:
      ```bash
      bun scripts/retired-names.mjs --generate --from scripts/compat-baseline@v0.12.1
      bun test scripts/retired-names.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/retired-names.mjs` (new), `scripts/retired-names.json` (new), `scripts/retired-names.test.mjs` (new)
      - `.agents/skills/create-plan/references/{prism.md,prism-wiki.md}`, `.agents/skills/prism-execution/references/release.md`, `.agents/skills/prism-execution/SKILL.md` (if it names the train)
      - `roadmap.md` (header facts only), `PRODUCT.md` (if plan 175 Task 4 left a train reference)
    - References:
      - plan 173 Task 8 (Prism Code sweep)
  - Test Cases to Write:
    - `no_retired_name_in_live_tree`: fails on any hit, naming the file and the name.
    - `retired_names_cover_baseline_removals`: every removal in the 0.12.1 → 0.13.0 baseline diff is in the list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: the skill references; the `roadmap.md` header
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Publish 0.13.0, apply the deprecations, switch to independent versioning, and record Phase 11 Done (owner-gated)
  - Acceptance Criteria:
    - Prerequisite (recorded 2026-10-15, after plan 175 Task 8): plans 176 (Phase 11 Part C — tool-gate integrity, narrow-only ownership, fail-closed dispose) and 177 (Phase 11 Part D — host isolation and security hardening) both **block this task**. They reopen the surface frozen by plan 174 Task 9 and change kernel and host-library contracts, so they must complete and regenerate the compat baselines before the 0.13.0 tag is pushed. The version cut itself (plan 175 Task 7) stands.
    - Functional: Pre-flight, on a clean tree at the release commit:
      - `bun run sdk:ready` exits 0
      - `PRISM_TEST_POSTGRES_URL=… bun run release:gate` exits 0
      - `bun scripts/release.mjs pack --destination release-artifacts` packs every package, and the task note records the package list
      - `bun scripts/registry-deprecate.mjs --generate && --dry-run` prints the planned deprecations
      - plans 176–186 are `complete` or `closed` in `plans/README.md` (176, 179, and 180 are closed with their open tasks moved into plans 181–187)
      - `bun scripts/live-preflight.mjs --suite release/ --probe` passes, then the strict runs of `providers/` (all nine shipped provider packages, ten rows with `liquid-local`; amended 2026-10-17, 2026-10-25 for `openrouter` by plan 203, 2026-10-28 for `openai-codex` by plan 204, 2026-10-31 for `kilo` by plan 213, and 2026-10-31 for `litellm` by plan 214; the in-tree `providers/commandcode` row runs with plan 205 Task 5 and is not a 0.13.0 gate), `release/journey-` (Hyper and OpenCode Go), and `release/cache-parity` pass on the release commit (plan 186's methodology), and `docs/_evidence/live-release-acceptance-0.13.0.md` records them; the owner signs it in this task's note (amended 2026-10-16 by plans 182–186)

      **The executor stops here and asks the owner to confirm** pushing the `v0.13.0` tag.
    - Functional: After confirmation, the tag push runs `.github/workflows/release.yml`: verify, the Postgres, office, CodeQL, and supply-chain gates, pack, attest, then `bun publish` in dependency order. The note records the workflow run URL. `bun scripts/post-publish-smoke.mjs` passes against the registry: it installs `@arnilo/prism@0.13.0` and a native package into a temp project and runs the README quickstart on the mock provider.
    - Functional: **The executor stops again and asks the owner to confirm** the deprecation dispatch. After confirmation, `npm-deprecate.yml` (plan 175 Task 8) is dispatched. The note records each name's resulting `deprecated` field (anonymous `GET`), and `--dry-run` reports nothing left to apply.
    - Functional: `scripts/independent-packages.json` lists every 0.13.0 native package and host library as independently versioned (Part 3: "After that, each is versioned independently"). Its `$comment` records the Phase 11 cut. `release.test.ts` and `release-gate.test.mjs` pin the new shape.
    - Functional: The Phase 11 Done record in this task's Notes lists each Done criterion with its proof:
      - `@arnilo/prism` 0.13.0 and the native packages are published, including `driver-kit` (a kernel subpath), `prism-driver-process`, `prism-workflows`, `serveTools` (in `prism-mcp-server`), `prism-remote`, `prism-headless`, and `prism-tools-research`; registry `GET` versions recorded
      - a new reader builds an agent from `README.md` alone (`readme_quickstart_runs_on_mock_provider` plus the post-publish smoke)
      - `release:gate` is green (run output)
    - Functional: `plans/README.md` marks plans 174 and 175 complete. The roadmap header records 0.13.0 as shipped (Task 1).
    - Performance: Record the publish wall time and each tarball's size against the `kernel` budget.
    - Code Quality: No manual `bun publish` from a laptop. Publishing goes only through the attested CI path.
    - Security: `NPM_TOKEN` stays a CI secret. The attestation (`actions/attest-build-provenance`) is verified for `@arnilo/prism` with `gh attestation verify`, per `docs/release.md`. Published tarball bytes match the SHA256SUMS from the pack step.
  - Approach:
    - Documentation Reviewed:
      - roadmap Phase 11 Done and Part 3; `docs/release.md` (promoted from `docs/next/release.md`: pipeline, resume, verification); `.github/workflows/{release,npm-deprecate}.yml`; `scripts/post-publish-smoke.mjs`; `scripts/release.mjs:413-481` (`runRelease`, `--resume`)
    - Options Considered:
      - Publishing and deprecating in one unattended step. Rejected: both are one-way registry operations, and the owner confirms each one (system rule for outward-facing actions).
      - Deprecating before publishing. Rejected: reused names need 0.13.0 published first, or the range-scoped deprecation would leave the name with no live line. plan 175 Task 8 fails closed on this.
    - Chosen Approach:
      - Pre-flight, then owner confirmation, then the tag, publish, and smoke; then owner confirmation again before the deprecations; then the independent-versioning switch and the Done record.
    - API Notes and Examples:
      ```bash
      git tag v0.13.0 && git push origin v0.13.0        # after owner confirmation only
      gh run watch
      bun scripts/post-publish-smoke.mjs --version 0.13.0
      gh workflow run npm-deprecate.yml -f confirm=deprecate   # after owner confirmation only
      ```
    - Files to Create/Edit:
      - `scripts/independent-packages.json`, `src/__tests__/release.test.ts`, `scripts/release-gate.test.mjs`
      - `plans/README.md` (status), this plan (Done record), `plans/backlog.md` (plan end, per SKILL.md)
    - References:
      - plan 164 Task 8.4 (attested `bun publish`); plan 140 Task 6 (deprecation workflow)
  - Test Cases to Write:
    - `independent_packages_after_0_13`: every publishable workspace except the kernel is listed. It fails when a new package is added without a versioning decision.
    - The post-publish smoke (an existing script, run against the registry).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the release itself.
    - Docs pages to create/edit: `CHANGELOG.md` (the publish date on `## [0.13.0]`)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/docs.test.ts scripts/phase24-truth.test.mjs`
- `bun test --timeout=0 scripts/retired-names.test.mjs scripts/registry-deprecate.test.mjs scripts/release-gate.test.mjs scripts/version-literal-gate.test.mjs scripts/package-truth.test.mjs src/__tests__/release.test.ts src/__tests__/packaging.test.ts src/__tests__/public-export-contract.test.ts`
- `bun run test`
- `bun run sdk:ready`
- `PRISM_TEST_POSTGRES_URL=… bun run release:evidence && PRISM_TEST_POSTGRES_URL=… bun run release:gate`
- `bun scripts/registry-deprecate.mjs --dry-run` (after Task 2: nothing left to apply)
- `bun scripts/post-publish-smoke.mjs --version 0.13.0`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
