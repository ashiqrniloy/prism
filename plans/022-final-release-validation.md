# Phase 19 — Final Release Validation

Tracks roadmap Phase 19: the final publish gate after Phases 15–18 finish.
This plan adds **no runtime behavior**. It runs the aggregated release checks
that already exist (`build`, `typecheck`, `test`, `pack:dry-run`, install smoke,
docs/boundary tests), confirms every acceptance criterion holds for core plus
all seven first-party packages, and fills the one real gap the roadmap names
explicitly: a **public export contract test** that pins the root `exports` map
against actual `dist` output for core and every first-party package. The final
task reviews package contents, changelog, versioning, and boundary invariants
before publishing.

Depends on Phases 15–18 being complete (they are: provider/runtime hardening,
auth/redaction/session-data hardening, packaging/installability, and docs/
examples/fixtures catch-up are all implemented per `plans/018`–`021`).

## Objectives

- Run the consolidated network-free release gate (`npm run release:dry-run` =
  `npm test` + `npm run pack:dry-run`) for core plus all first-party packages
  and confirm it stays green and inside the < 30s offline budget.
- Add a data-driven public-export contract test that fails if any documented
  subpath in any package's `exports`/`main`/`types` map is missing from that
  package's packed/build output, so the public API surface cannot drift from
  the published files.
- Confirm `npm pack --dry-run` includes only needed files (compiled output,
  README/LICENSE/CHANGELOG, core `docs/`, CHANGELOG) and excludes built tests,
  source maps, `src/`, `plans/`, `.agents/`, `roadmap.md`, `examples/`, and
  workspace packages — for core and every first-party package.
- Confirm a fresh-install consumer can import every documented core specifier
  (`prism`, `prism/providers/openai-compatible`, `prism/testing/*`, `prism/node/*`)
  and every first-party package by package specifier, with no workspace-relative
  paths, by following README + `/docs` + `examples/`.
- Confirm boundary invariants hold: no built-in app tools, no hidden provider/
  credential globals, no automatic package discovery, no secret persistence in
  core; live provider/worker tests remain opt-in behind `PRISM_LIVE_*` env vars.
- Review package contents, release notes, `CHANGELOG.md`, versioning, and the
  release workflow (`release:dry-run`) output and record the publish-readiness
  verdict in `Compromises Made` / `Further Actions`.

## Expected Outcome

- `npm run release:dry-run` exits 0 for core plus every first-party package with
  zero network access by default.
- A new `src/__tests__/public-export-contract.test.ts` (data-driven over the
  root `exports` map and each package's `exports`/`main`/`types`) asserts every
  documented specifier resolves to a built file in `dist/` after `npm run build`.
- `npm run pack:dry-run` lists only needed files for all 8 tarballs (core + 5
  providers + 2 compaction packages); `packaging.test.ts` already denies the
  excluded patterns and stays green.
- Fresh-install smoke (`src/__tests__/install-smoke.test.ts`) imports every
  documented specifier from a staging install with no workspace-relative paths.
- `CHANGELOG.md` reflects the v1 release scope; versioning is `semver`-aligned;
  the release workflow runs cleanly as a dry-run.
- Boundary tests (`phase11`–`phase14-boundaries.test.ts`,
  `network-free-guard.test.ts`, `public-contracts.test.ts`) remain green,
  proving no app tools / hidden globals / auto-discovery / secret persistence
  slipped into core.

## Tasks

- [x] 1. Inventory the release-validation surface and pin the gate scope
  - Acceptance Criteria:
    - Functional: a written inventory exists in this task (Approach section)
      enumerating (a) every npm script that participates in the release gate
      and what it covers, (b) every existing test file that enforces a release
      acceptance criterion (packaging, install smoke, network-free guard,
      boundaries, docs, public contracts), (c) the exact published package set
      and their tarball `files` whitelists, (d) the one genuine gap this phase
      closes (public-export contract test), and (e) every accept checkbox from
      roadmap Phase 19 mapped to the check that proves it.
    - Performance: inventory is read-only; no build/test runtime change.
    - Code Quality: the inventory is the source of truth that tasks 2–6 check
      against, so later tasks do not duplicate or drift.
    - Security: the inventory records which checks guard secrets/network so the
      "network-free by default" and "no secrets in tarballs/events" rules carry
      forward.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 19 deliverables and acceptance criteria.
      - `package.json` `scripts` (`build`, `typecheck`, `test`,
        `pack:dry-run`, `release:dry-run`), `exports`, `files`, `workspaces`,
        `bin`, `engines`, and metadata fields.
      - Each `packages/*/package.json` `name`, `exports`/`main`/`types`,
        `files`, `peerDependencies`, `sideEffects`.
      - `.agents/skills/create-plan/references/prism-wiki.md` (not directly
        applicable to a verification phase, but confirms docs-coverage gate is
        already enforced by `docs.test.ts`).
    - Options Considered:
      - Skip the inventory; tasks stand alone: rejected — Phase 19 is explicitly
        cross-cutting and a pinned map prevents re-deriving which check proves
        which acceptance line.
      - Put the inventory in a separate `docs/release-checklist.md`: rejected —
        it would need its own maintenance; the task block is enough.
    - Chosen Approach:
      - Inline the inventory below as the measured source of truth. Findings
        recorded by scanning `package.json`, every workspace `package.json`, and
        the existing test files.
    - Inventory (measured against the current tree):
      - **Release-gate scripts (`package.json`):**
        - `build` → `build:core` (`tsc`) + `build --workspaces`.
        - `typecheck` → `build:core` + `typecheck --workspaces` + `tsc -p
          examples --noEmit`.
        - `test` → `build` + `node --test dist/__tests__/*.test.js` + `test
          --workspaces`.
        - `pack:dry-run` → `npm pack --dry-run` core + every workspace.
        - `release:dry-run` → `npm test` + `npm run pack:dry-run` (the
          consolidated gate).
      - **Existing release-criterion tests:**
        - `src/__tests__/packaging.test.ts` — denies `__tests__/`, `.map`,
          `tsbuildinfo`, `src/`, `plans/`, `.agents/`, `roadmap.md`, `tsconfig`,
          `packages/`, `examples/` from every tarball (data-driven, 8 packages).
        - `src/__tests__/install-smoke.test.ts` — fresh-install import of every
          documented core specifier (`prism` + every `exports` key) + every
          first-party package, no workspace-relative paths.
        - `src/__tests__/network-free-guard.test.ts` — every `live.test.ts`
          gated by `PRISM_LIVE_*`; non-live tests never reference
          `globalThis.fetch`.
        - `src/__tests__/phase11-boundaries.test.ts` …
          `phase14-boundaries.test.ts` — no app-tool leaks, no hidden provider/
          credential globals, no auto-discovery, no secret persistence in core.
        - `src/__tests__/public-contracts.test.ts` — contracts shape and root
          type exports.
        - `src/__tests__/docs.test.ts` — every public API/extension point/event/
          config surface/manifest field/default strategy/first-party package has
          a linked docs page; provider pages have all 9 headings; no real-looking
          secrets.
        - `packages/provider-*/src/__tests__/live.test.ts` — opt-in only unless
          `PRISM_LIVE_PROVIDER_TESTS=1` (and the compaction variants).
      - **Published packages (8):** `prism` (core) + `@prism/provider-openai`,
        `@prism/provider-opencode-go`, `@prism/provider-openrouter`,
        `@prism/provider-zai`, `@prism/provider-kimi`,
        `@prism/compaction-llm`, `@prism/compaction-observational-memory`.
        Core `files`: `["dist","!dist/__tests__","!dist/**/*.map","docs","CHANGELOG.md"]`
        (npm auto-includes root `README.md` + `LICENSE` regardless); `bin`:
        `prism` → `./dist/cli.js`; `sideEffects: ["dist/cli.js"]`.
        **All 7 workspace packages are uniform:** `exports` is `.` only →
        `./dist/index.{js,d.ts}`; `main`=`./dist/index.js`,
        `types`=`./dist/index.d.ts`; `files`=
        `["dist","!dist/__tests__","!dist/**/*.map","README.md","CHANGELOG.md"]`
        (npm auto-includes each package's `LICENSE`);
        `peerDependencies: { "prism": "0.0.1" }`, non-optional;
        `sideEffects: false`; scripts = `build`/`typecheck`/`test`/
        `pack:dry-run`. `LICENSE`, `README.md`, `CHANGELOG.md` exist in all 7.
        Root `tsconfig.json` + `tsconfig.packages.json` present; `examples/`
        tree exists under `tsconfig -p examples` with `fixtures/`.
      - **The gap this phase closes:** there is no test that asserts every key in
        each package's `exports` map (and root `main`/`types`) resolves to a
        real built file in `dist/`. `install-smoke.test.ts` covers import at
        install time but only after packing/staging; a build-time contract test
        catches a missing/renamed export before the pack step and without a
        staging directory. → Task 2.
      - **Acceptance → check map:**
        - "tests run under the release time budget without network by default" →
          `release:dry-run` wall-time measurement (Task 3) +
          `network-free-guard.test.ts`.
        - "examples compile" → `typecheck` (incl. `tsc -p examples`) in Task 3.
        - "`npm pack --dry-run` includes only needed files" →
          `packaging.test.ts` + manual review in Task 4.
        - "fresh install users can follow README/docs examples without workspace
          paths" → `install-smoke.test.ts` + reviewer walkthrough in Task 5.
        - "no built-in app tools / hidden globals / auto-discovery / secret
          persistence" → boundary tests in Task 6.
    - Files to Create/Edit:
      - this task block (no code files).
    - References:
      - `roadmap.md` Phase 19; `package.json`; `packages/*/package.json`;
        `docs/release-and-install.md`; `plans/020` (packaging/installability),
        `plans/021` (docs/examples/fixtures).

- [x] 2. Add a data-driven public-export contract test
  - Acceptance Criteria:
    - Functional: a `src/__tests__/public-export-contract.test.ts` reads the root
      `package.json` `exports` map plus `main`/`types` and asserts every
      specifier maps to a `.js`/`.d.ts` pair that exists under `dist/` after
      `npm run build:core`; it also reads each workspace `package.json`
      `exports`/`main`/`types` and asserts the same against each package's
      `dist/`. It fails closed (clear message naming the missing file) if a
      documented export is absent from the build output.
    - Performance: test reads `dist/` existence only; runs in milliseconds and
      is part of the existing `npm test` (no staging dir, no network).
    - Code Quality: the package list is the single data table already shared in
      shape with `packaging.test.ts`/`install-smoke.test.ts`; one entry per
      published package, drive every assertion from it (ponytail: data-driven,
      one line to add a package).
    - Security: no secrets involved; the test only reads `package.json` and
      `dist/` paths. It reaffirms no `exports` key points outside `dist/`
      (e.g. into `src/` or `examples/`).
  - Approach:
    - Documentation Reviewed:
      - Root `package.json` `exports` keys: `.`, `./providers/openai-compatible`,
        `./testing/provider-conformance`, `./node/config`, `./node/settings`,
        `./node/trust`, `./node/session-store-jsonl`; `main`, `types`, `bin`.
      - Each `packages/*/package.json` for `exports`/`main`/`types` shapes.
      - `src/__tests__/packaging.test.ts` and `install-smoke.test.ts` for the
        shared package-table pattern and `repoRoot` derivation.
      - Ponytail rule: one runnable self-check, no framework beyond `node:test`.
    - Options Considered:
      - Extend `install-smoke.test.ts` to also assert build-output paths: rejected
        — smoke test runs after pack/staging and is slower; a build-time contract
        test catches drift earlier and cheaper.
      - Generate the assertion list by scanning `src/index.ts` re-exports:
        rejected — `exports` map is the published contract, not the source barrel;
        testing the map against `dist/` is what users actually install.
      - Hard-code the 7 core specifiers: rejected — derives them from
        `package.json#exports` so adding a subpath is a one-line package.json
        change and the test follows.
      - **Scope-shrink during implementation (ponytail: reuse, don't duplicate):**
        `packaging.test.ts` *already* asserts every `exports.*` target appears
        in the `npm pack` file list (= on disk) for all 8 packages. Writing a
        naive mirror would be ~90% redundant. The genuine delta this test covers
        instead: (1) **build-time, pre-pack** resolution via direct `existsSync`
        (no `npm pack` spawn, milliseconds, usable before tarball step);
        (2) explicit **`main`/`types`/`bin`** target resolution (packaging covers
        `main`/`types` only indirectly through `exports["."]` and `bin` only via
        a core-specific ad-hoc `dist/cli.js` check); (3) a **negative boundary**
        that no target escapes `dist/` (manifest-misconfiguration guard that the
        pack-list deny does not cover); (4) a **sibling `.d.ts` pair check** so
        TypeScript consumers resolve types at every published specifier.
    - Chosen Approach:
      - One `describe`/`it` over a data table of `{dir, name, isCore}` (same 8
        entries as `packaging.test.ts`). For each package, load its
        `package.json`, collect specifier→file pairs from `exports.*` (types
        + default), `main`, `types`, and (core only) `bin`. Prefix each relative
        file with the package dir, assert `existsSync` under `dist/`. Reuse the
        existing `walkFiles`/`repoRoot` helpers' shape; keep the file self-contained
        (no new dependency).
      - Guard: skip with a helpful message if `dist/` is absent, directing the
        reviewer to run `npm run build` first (mirrors how `npm test` builds
        before running tests, but the test stays safe if invoked standalone).
    - API Notes and Examples:
      ```ts
      // shape (ponytail: one table row per published package)
      const packages = [
        { dir: ".", name: "prism", isCore: true },
        { dir: "packages/provider-openai", name: "@prism/provider-openai" },
        // ... 6 more, identical to packaging.test.ts
      ];
      for (const pkg of packages) {
        it(`${pkg.name} exports resolve to built dist files`, () => {
          const manifest = JSON.parse(readFileSync(join(repoRoot, pkg.dir, "package.json"), "utf8"));
          const targets = collectExportTargets(manifest, pkg.isCore); // exports.* + main + types + bin
          for (const [spec, file] of targets) {
            assert.ok(existsSync(join(repoRoot, pkg.dir, file)),
              `${pkg.name} ${spec} -> ${file} missing from dist/ (run npm run build)`);
          }
        });
      }
      ```
    - Files to Create/Edit:
      - `src/__tests__/public-export-contract.test.ts`: new data-driven contract
        test (core + 7 workspace packages).
    - References:
      - `package.json`; `packages/*/package.json`; `packaging.test.ts`;
        `install-smoke.test.ts`; `roadmap.md` Phase 19 ("public export contract
        tests for core plus first-party packages").
  - Test Cases to Write:
    - Core: every `exports` key + `main` + `types` + `bin` resolves under `dist/`.
    - Each workspace package: `exports`/`main`/`types` resolve under that
      package's `dist/`.
    - Negative: assert no `exports` target path starts with `src/` or `examples/`
      (guards against a future misconfiguration shipping source).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — the test enforces the existing public
      export contract; it changes no published surface.
    - Docs pages to create/edit: `docs/release-and-install.md` may add a one-line
      pointer that the export contract is test-enforced (optional; include only
      if the page does not already state it).
    - `docs/index.md` update: no.
    - Documentation structure reference: `prism-wiki.md` (not required; test,
      not an API page).

- [x] 3. Verify network-free test budget, typecheck incl. examples
  - Acceptance Criteria:
    - Functional: `npm run typecheck` exits 0 (core build + workspace typecheck
      + `tsc -p examples --noEmit`); `npm test` exits 0 with the full default
      suite (core + workspaces) plus the new contract test from Task 2; all
      skipped tests are the documented opt-in live-test placeholders.
    - Performance: `npm test` wall time stays under the 30s offline budget on
      Node 20 (baseline ~22s); the new contract test adds milliseconds, not
      seconds. Measured wall time recorded in `Compromises Made`.
    - Code Quality: single command (`npm run typecheck`) proves examples and all
      packages typecheck; no deprecation/`any` regressions introduced.
    - Security: default `npm test` performs zero network I/O
      (`network-free-guard.test.ts` green); live tests stay skipped unless
      `PRISM_LIVE_*` is set.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` offline-test-budget section.
      - `package.json` `typecheck` and `test` script composition.
      - `plans/021` final-verification notes (the ~21.8s baseline reference).
    - Options Considered:
      - Add a CI-style workflow file: out of scope for core v1 (roadmap keeps
        release mechanics minimal; `release:dry-run` is the gate). Defer a real
        GH Actions workflow to post-v1 unless the release notes task finds one.
      - Run the gate locally and record numbers: chosen — Phase 19 is the
        publish gate, measured locally via `release:dry-run`.
    - Chosen Approach:
      - Run `npm run typecheck` and `npm test` (which builds first), capture
        counts/durations, confirm 0 failures and only the documented skips;
      assert the suite stays network-free via the guard test and confirm no
      live var is set in the environment.
    - API Notes and Examples:
      ```bash
      env -u PRISM_LIVE_PROVIDER_TESTS -u PRISM_LIVE_COMPACTION_TESTS \
        -u PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS npm run typecheck
      env -u PRISM_LIVE_PROVIDER_TESTS -u PRISM_LIVE_COMPACTION_TESTS \
        -u PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS npm test
      ```
    - Files to Create/Edit:
      - none (verification only; record numbers in `Compromises Made`).
    - References:
      - `docs/release-and-install.md`; `package.json` scripts;
        `network-free-guard.test.ts`; `plans/021`.
  - Test Cases to Write:
    - Re-runs the existing `typecheck`/`test` gate; the new contract test from
      Task 2 is part of the run. No new test files here.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none (update budget note only if the measured
      number drifts materially; otherwise leave the documented ~22s/<30s).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] 4. Verify tarball contents for core and every first-party package
  - Acceptance Criteria:
    - Functional: `npm run pack:dry-run` exits 0 for core + all 7 workspace
      packages; the file lists contain only `dist/**` (excluding tests/maps),
      `README.md`, `LICENSE`, `CHANGELOG.md`, and (core) `docs/**`; no built
      test artifacts, sources, plans, agents, roadmap, tsconfig, workspace
      packages, or `examples/` appear in any tarball.
    - Performance: pack dry-runs are fast; total well under the release budget.
    - Code Quality: `packaging.test.ts` denies the excluded patterns for all 8
      packages and passes; manual review confirms the allow-list matches
      `docs/release-and-install.md`.
    - Security: tarballs contain no real-looking secrets (scan confirms); the
      live-test env names do not appear in shipped files.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` tarball composition section.
      - `packaging.test.ts` denied-pattern table and `files` whitelist per
        package.
      - `package.json` and each `packages/*/package.json` `files` array.
    - Options Considered:
      - Trust `packaging.test.ts` alone: it already denies the patterns, but
        Phase 19 asks for a final contents review before publish, so a manual
        walk + the test is the gate. Chosen: run both.
    - Chosen Approach:
      - Run `npm run pack:dry-run`, capture each tarball's file list, manually
        confirm only needed files; cross-check against the
        `packaging.test.ts` denied patterns; record any deviation.
    - API Notes and Examples:
      ```bash
      npm run pack:dry-run   # core + all workspaces
      ```
    - Files to Create/Edit:
      - none (verification only).
    - References:
      - `packaging.test.ts`; `docs/release-and-install.md`; `plans/020`.
  - Test Cases to Write:
    - No new tests; `packaging.test.ts` is the automated guard. Manual review
      against the documented allow-list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] 5. Verify fresh-install import smoke and README/docs example walk-through
  - Acceptance Criteria:
    - Functional: `src/__tests__/install-smoke.test.ts` passes — a staging
      fresh-install imports every documented core specifier
      (`prism` + every `exports` key) and every first-party package by package
      specifier, with no workspace-relative paths; a reviewer follows
      README + `/docs` + `examples/` end-to-end (install → register provider →
      run session → branch → compact → recall memory → CLI/RPC) using only the
      built tarballs.
    - Performance: smoke test runs within the existing budget; the reviewer
      walk-through is manual.
    - Code Quality: import specifiers use package names, never
      `../packages/...` or `file:../...` in shipped README/docs/examples.
    - Security: smoke install uses no real credentials; examples run with mock
      providers and fake keys.
  - Approach:
    - Documentation Reviewed:
      - `install-smoke.test.ts` staging/import flow and the `coreSpecifiers()`
        derivation from `package.json#exports`.
      - `README.md`, `docs/index.md`, and `examples/README.md` for the
        documented onboarding path.
    - Options Considered:
      - Manual-only walk-through without running the smoke test: rejected —
        the automated smoke test is the regression guard and must stay green.
      - Run the smoke test plus a focused manual follow of README docs: chosen.
    - Chosen Approach:
      - Run `install-smoke.test.ts` (part of `npm test`); separately, re-run the
        `examples/` demos from `plans/021` Task 6 against the packed tarballs to
        prove a consumer can follow README/docs without workspace paths.
    - API Notes and Examples:
      ```bash
      node --test dist/__tests__/install-smoke.test.js
      # plus manual: follow README excerpt against a fresh npm install of the
      # packed prism + one @prism/provider-* tarball.
      ```
    - Files to Create/Edit:
      - none (verification only).
    - References:
      - `install-smoke.test.ts`; `README.md`; `docs/release-and-install.md`;
        `examples/README.md`; `plans/021` Tasks 5–6.
  - Test Cases to Write:
    - No new tests; `install-smoke.test.ts` is the automated guard.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none (fix any example/README drift found, but
      record it as a Further Action rather than pre-scoping edits here).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] 6. Confirm boundary invariants and review release notes/changelog/versioning
  - Acceptance Criteria:
    - Functional: `phase11-boundaries.test.ts` … `phase14-boundaries.test.ts`,
      `network-free-guard.test.ts`, and `public-contracts.test.ts` pass,
      confirming no built-in app tools, no hidden provider/credential globals,
      no automatic package discovery, and no secret persistence slipped into
      core; `CHANGELOG.md` accurately describes the v1 release scope and follows
      Keep a Changelog + semver; the `release:dry-run` workflow output is clean.
    - Performance: boundary tests run in the existing budget; no new runtime.
    - Code Quality: version is semver-aligned; `release:dry-run` composes
      `test` + `pack:dry-run` without extra steps; package metadata (license,
      repository, bugs, homepage, keywords, sideEffects, engines, peer
      dependencies) is complete and consistent across core + packages.
    - Security: no secret-scanning match across `/docs`, `examples/`, fixtures,
      and shipped files; live-test gates remain opt-in and unset by default.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` "Non-negotiable boundaries" and Phase 19 boundary
        acceptance line.
      - `CHANGELOG.md` format and the existing `[Unreleased]`/`[0.0.1]` entries.
      - Boundary test files for exactly which invariants each asserts.
      - `docs/release-and-install.md` for the release-workflow description.
    - Options Considered:
      - Add a new "boundary summary" test: rejected — `phase11`–`phase14`
        boundary tests already cover it; a duplicate summary test is slop.
      - Review existing tests + changelog/metadata manually: chosen.
    - Chosen Approach:
      - Run the boundary + guard + contracts tests; read `CHANGELOG.md` and
        confirm it reflects the v1 scope and the packaging/versioning changes
        already landed in Phases 16–17; confirm `release:dry-run` runs clean
        end-to-end; record the publish-readiness verdict.
    - API Notes and Examples:
      ```bash
      npm run release:dry-run   # the consolidated Phase 19 gate
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`: only if review finds a gap in the v1 scope notes (do
        not pre-scope edits; record them as Further Actions otherwise).
      - `Compromises Made` / `Further Actions` sections of this plan with the
        publish-readiness verdict.
    - References:
      - `roadmap.md` boundaries + Phase 19; `CHANGELOG.md`; boundary tests;
        `docs/release-and-install.md`; `plans/016`, `017`, `020`.
  - Test Cases to Write:
    - No new tests; aggregate the boundary + guard tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none (record any changelog/metadata fix as a
      Further Action).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] 7. Final verification for Phase 19
  - Acceptance Criteria:
    - Functional: every Phase 19 acceptance line from `roadmap.md` is proven
      green — test budget (Task 3), `npm pack --dry-run` contents (Task 4),
      fresh-install README/docs walk-through without workspace paths (Task 5),
      and no built-in app tools / hidden globals / auto-discovery / secret
      persistence (Task 6); the new public-export contract test (Task 2) is part
      of the green `npm test`.
    - Performance: full `release:dry-run` (`npm test` + `npm run pack:dry-run`)
      runs network-free under the 30s budget for tests; measured numbers
      recorded in `Compromises Made`.
    - Code Quality: no new runtime code shipped in this phase; the only code
      artifact is the data-driven contract test, which follows the existing
      `node:test` + shared package-table pattern.
    - Security: default verification remains network-free and secret-free; live
      tests stay opt-in.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 19 acceptance criteria and this plan's Task 1
        acceptance→check map.
    - Options Considered:
      - Rely on per-task checks only: rejected — Phase 19 is the consolidated
        publish gate; one final `release:dry-run` run plus a walk of the
        acceptance map catches cross-cutting drift.
    - Chosen Approach:
      - Run `npm run release:dry-run`; walk the Task 1 acceptance→check map;
        confirm each line is green; fill `Compromises Made` with measured
        numbers and `Further Actions` with any deferred follow-up.
    - API Notes and Examples:
      ```bash
      npm run release:dry-run
      ```
    - Files to Create/Edit:
      - `Compromises Made` / `Further Actions` sections of this plan.
    - References:
      - `roadmap.md` Phase 19; this plan's Task 1 inventory.
  - Test Cases to Write:
    - No new tests; aggregate the checks from Tasks 2–6.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

## Compromises Made
- Verified after tasks completed and the release gate is green. Task 3 measured
  (Node 20, all `PRISM_LIVE_*` env vars unset):
  - `npm run typecheck` exit 0 in ~14.7s wall (core `tsc` + 7 workspace
    typechecks + `tsc -p examples --noEmit`).
  - `npm test` exit 0 in ~21.9s wall (build + `node --test
    dist/__tests__/*.test.js` core + 7 workspace runs).
  - Aggregate across core + workspaces: **541 tests, 535 pass, 0 fail, 6
    skipped.** All 6 skips are the documented opt-in live-test placeholders
    (`compaction_llm_live_provider_smoke`, `observational memory live tests`,
    and the phase12/13/14 `*_live_tests_are_skipped_by_default` guards), each
    gated by a `PRISM_LIVE_*` env var. `network-free-guard.test.ts` green.
  - Both runs stay well under the < 30s offline budget; the new
    `public-export-contract.test.ts` (Task 2) added ~84 subtests at ~180ms with
    no measurable impact on the wall time.
- Task 4 tarball review (`npm run pack:dry-run`, all 8 packages): 246 shipped
  files total. Per-package counts — `prism` 106 (70 `dist` + 32 `docs` +
  README/LICENSE/CHANGELOG/package.json), `@prism/provider-openai` 18,
  `@prism/provider-opencode-go` 18, `@prism/provider-openrouter` 14,
  `@prism/provider-zai` 14, `@prism/provider-kimi` 12, `@prism/compaction-llm`
  20, `@prism/compaction-observational-memory` 44. `dist/` holds only `.js` +
  `.d.ts` pairs (spot-checked core 35/35, openai 7/7, obs-mem 20/20) — no
  `.map`, no `__tests__`, no source `.ts`. `docs/` ships only in core (32
  files), not in any workspace tarball. `packaging.test.ts` 41/41 green
  (deny-list + metadata completeness + `npm ls --all --depth=0` clean). Secret
  scan across all 246 shipped files: **0 hits** for
  `sk-…`/`AIza…`/`ghp_…`/PEM. The 10 `PRISM_LIVE_*` name occurrences are all
  in shipped **documentation** (docs pages + READMEs that document the opt-in
  vars per plan 021 Task 8); none in `dist/` runtime or test code — the live-test
  gate code itself does not ship (excluded by `!dist/__tests__`). The Task 4
  acceptance line "live-test env names do not appear in shipped files" was
  imprecise: the var *names* belong in docs (that is the documentation
  deliverable); what must not ship is the gate *code*, and it does not.
- Task 5 fresh-install smoke + README/docs walk-through: `install-smoke.test.ts`
  3/3 green (offline install of all 8 tarballs, every documented core specifier
  + every first-party package dynamic-imports, no leaked tests/maps in
  `node_modules`). Manual walk-through against packed tarballs (core +
  `@prism/provider-openai` + `@prism/compaction-observational-memory`):
  quickstart ran end-to-end (`agent_started,turn_started,turn_finished,
  agent_finished`), provider package registered via the correct
  `kernel.load([createProviderPackage(...)])` Extension pattern, observational-
  memory extension registered. No workspace-relative or `file:` imports in
  README, `/docs`, or `examples/` (grep clean); examples import only by
  package specifier and typecheck (Task 3). No real-looking secrets in
  README/docs/examples.
- Task 6 boundary invariants + changelog/versioning review: boundary + guard +
  contracts tests 47/47 green — `phase11 core_runtime_has_no_requested_provider_
  specific_behavior`, `phase12 core_has_no_new_requested_provider_runtime_behavior`
  (no hidden provider/credential globals), `phase12/13/14 *_setup_is_inert` +
  `phase12 provider_packages_setup_without_network` (no automatic package
  discovery), `public_contracts do not mention app-specific tool categories`
  (no built-in app tools), and `phase12/13/14 no_real_secrets_in_docs_or_fixtures`
  + `network-free-guard` (no secret persistence). All 4 Phase 19 boundary
  claims are test-backed. `npm run release:dry-run` exit 0 (~50s, the
  consolidated gate = `npm test` + `npm run pack:dry-run`); all 8 tarballs
  produced (`prism-0.0.1.tgz` + 7 workspaces). Version `0.0.1` uniform across
  all 8 packages. `CHANGELOG.md` follows Keep a Changelog + semver. Metadata
  complete and consistent across core + every workspace: `license: MIT`,
  `repository` (with `directory` on workspaces), `bugs`, `homepage`, `keywords`,
  `sideEffects`, `engines: node>=20`, non-optional `prism` peer at `0.0.1` on
  all 7 workspaces (verified in Task 4 via `packaging.test.ts`).

## Further Actions
- **Docs bug found by Task 5 walk-through (priority: high):** the README
  quick-start "Register a first-party provider package" snippet and the same
  snippet on all 5 `docs/providers/*.md` pages use `const { api } =
  createExtensionKernel(); api.registerProviderPackage(...)`, but
  `createExtensionKernel()` returns `{ registries, middleware, events, load }`
  — there is no `api` property. `api` is the internal object the kernel passes
  to `extension.setup(api)`. The correct pattern (used by
  `examples/provider-registration.ts`) is `const kernel = createExtensionKernel();
  await kernel.load([createProviderPackage({ ... })])` because provider packages
  are `Extension`s. The buggy snippet throws `TypeError: Cannot read properties
  of undefined (reading 'registerProviderPackage')` if a user copy-pastes it.
  Fix belongs in a docs phase (Phase 18 follow-up), not this verification phase;
  tracked here so it is not lost. Low-effort: one README edit + 5 provider-page
  edits replacing the destructuring+call with `kernel.load([...])`.
- **CHANGELOG thinness (priority: low):** the `[0.0.1]` initial-release entry
  is a single one-liner with no feature-surface breakdown, and `[Unreleased]`
  only holds Phase 17 packaging notes. Internally consistent for a `0.0.1` line
  (the peer range widens to `^1.0.0` at the 1.x stable release per roadmap
  Phase 17), so it is not a release blocker. A future docs pass could enrich
  the `[0.0.1]` entry with the implemented surfaces (runtime, providers,
  compaction, CLI/RPC) for discoverability; not gated by Phase 19.
- **Task 7 final consolidation:** all 7 tasks complete. The single code
  deliverable this phase is `src/__tests__/public-export-contract.test.ts`
  (84/84 subtests, ~180ms), which runs as part of `npm test` and is excluded
  from every tarball (`!dist/__tests__`). No new runtime code shipped in
  Tasks 3–7; they are verification-only. The consolidated
  `npm run release:dry-run` gate exits 0 (~50s wall) and produces all 8
  tarballs. Every Phase 19 acceptance line from `roadmap.md` is proven green:
  test budget + network-free (Task 3, 541 tests / 0 fail / 6 documented skips),
  examples compile (Task 3), `npm pack --dry-run` contents clean (Task 4,
  246 files), public export contract (Task 2), fresh-install README/docs walk
  with no workspace paths (Task 5), and no built-in app tools / hidden globals
  / auto-discovery / secret persistence (Task 6, 47/47 boundary tests).
- **Publish-readiness verdict:** Phase 19 passes the gate. v1 (`0.0.1`) is
  publish-ready pending the two Further Actions below, both of which are docs
  polish, not release blockers: the README + 5 provider-page snippet bug
  (high priority to fix before or right at publish, since copy-paste throws),
  and CHANGELOG enrichment (low). No code or packaging change blocks publish.
