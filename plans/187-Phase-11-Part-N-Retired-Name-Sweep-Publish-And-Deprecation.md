# Phase 11 Part N — retired-name sweep, publish 0.13.0, and npm deprecation

## Objectives

- Run the final retired-name sweep as a standing test, and update the planning and execution skill references for the post-0.13 world.
- Publish `@arnilo/prism` 0.13.0 with its native packages and host libraries, apply the npm deprecations, switch to independent versioning, and record the Phase 11 Done criteria.

## Expected Outcome

- `scripts/retired-names.json` and `scripts/retired-names.test.mjs` exist, and the live tree has no retired name. The list includes the 17 provider packages deleted by plan 182.
- After owner confirmation, the packages are published from CI and the deprecations are applied, including the 16 deleted provider names published at 0.3.1. `bun scripts/post-publish-smoke.mjs` passes against the registry. `scripts/independent-packages.json` lists every 0.13.0 package as independently versioned.

**0.13.0 release path — plan 187 of 181–187.** Start it when plan 186 is complete; when this plan is complete, continue with nothing: this is the last plan before 0.13.0 ships. Plans 181–194 run strictly in step order (see `plans/README.md`), and nothing runs in parallel.

This plan is the final part of roadmap **Phase 11**. **Tasks 1–2 moved here unchanged from plan 175 Tasks 9–10 on 2026-10-16**, when the release plans were put in execution order. Plan 175 Tasks 1–8 (docs promotion, README cut, examples, changelog, version cut, deprecation tool) are complete and stay there. Inside Tasks 1–2, "plan 175 Task N" means that plan's completed tasks. Additions from the 2026-10-16 decisions:
- Task 1's curated list includes the 17 provider packages deleted by plan 182 Task 2 (`ai-sdk`, `alibaba`, `anthropic`, `azure`, `bedrock`, `clinepass`, `commandcode`, `deepseek`, `google`, `kimi`, `neuralwatt`, `ollama`, `openai`, `openrouter`, `vertex`, `xai`, `zai`). The baseline diff cannot find them, because they did not exist in 0.12.1.
- Task 2's deprecations include the 16 of those published at `0.3.1`, with the message plan 182 Task 2 wrote into `scripts/deprecations-0.13.json`.
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
      - `bun scripts/live-preflight.mjs --suite release/ --probe` passes, then the strict runs of `providers/` (all four shipped providers), `release/journey-` (Hyper and OpenCode Go), and `release/cache-parity` pass on the release commit (plan 186's methodology), and `docs/_evidence/live-release-acceptance-0.13.0.md` records them; the owner signs it in this task's note (amended 2026-10-16 by plans 182–186)

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
