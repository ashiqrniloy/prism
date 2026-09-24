# Bun Dev Toolchain

Post-0.10.0 contributor toolchain. Not a release cut, not a consumer-runtime change. The slow parts of this repo are `npm ci` across ten workflows and `node --test` after a full `tsc` emit (`docs/release-and-install.md` pins `npm test` at < 60s, measured ~45s of which build is ~18s). Bun 1.4.2 is already on the machine and is the current npm `bun` release. It is a faster install and a compatible-enough test runner. It is not a drop-in Node.

## Objectives

- Make Bun the repo's package manager and the default test runner where a measured probe says it is compatible, so install and the network-free suite spend less time before the first assertion.
- Introduce `mise.toml` pinning the contributor toolchain (`node = "24"`, `bun = "1.4.2"`) so local dev matches the CI matrix instead of drifting (local host currently runs Node 26, untested by CI). `mise install` becomes the one-command setup. CI workflows are unchanged by mise.
- Declaration emit is unchanged: `tsc` (TypeScript 7.0.2 native, already the root devDependency — no migration task, it is done) stays the sole emit for `dist/*.js` + `*.d.ts`. No `bun build`, no second emitter.
- Keep Node the published runtime and a retained test runtime. `engines.node` stays `>=22`. `node:` imports stay. `npm publish` / `npm pack --json` stay the registry contract. Consumers still `npm install @arnilo/prism`.
- Coverage moves from `--experimental-test-coverage` to `bun test --coverage` in plan 114 (`plans/114-Bun-Coverage-Gate.md`), which lands after this plan. Until then the coverage stage stays on Node, byte-for-byte unchanged.
- Do not pretend Bun runs the suites it cannot run — decide that from transcripts. Measured on Bun 1.4.2 (this machine): `require("better-sqlite3")` loads and the repo's built SQLite suites pass under `bun test --timeout=0` (23 pass, 0 fail). The plan's earlier hard-block claim was an `import("better-sqlite3")` interop misread — `import()` returns a namespace, so `new m()` throws `Module is not a constructor`; that is not issue 4290 and not a block. What genuinely is not Bun's: Node's coverage flags (moved to `bun test --coverage` by plan 114, which depends on this plan), the TAP-parsed Postgres evidence leg, the budget gate, and the `--test-isolation=none` wiki-scratch leg. Those stay on Node.

## Expected Outcome

- `bun.lock` (text, `lockfileVersion` 2) is the only install lockfile. `package-lock.json` is gone. CI installs with `bun ci` (`bun install --frozen-lockfile`) under a hoisted linker. `bun audit --audit-level=moderate` is the supply-chain audit and exits non-zero on moderate-or-higher.
- `bun run test` is the documented default suite. Suites the Task 1 inventory marks compatible run under `bun test --timeout=0` — including the SQLite suites (measured passing; Task 1 re-records the transcript). The coverage stage stays `node --test --experimental-test-coverage` with the 60/70/75 floors until plan 114 moves it. The TAP-parsed Postgres evidence leg, the budget gate, and the wiki-scratch isolation leg stay on `node` permanently.
- `mise.toml` pins `node = "24"` and `bun = "1.4.2"`; `mise install` is the documented contributor setup. CI does not move to mise.
- A developer with Bun 1.4.2 and Node >=22 can install, build, and run the default suite. A machine with only Bun cannot: Node remains required for emit consumers, the coverage stage (until plan 114), the Postgres TAP leg, the budget gate, and publish. That is the intended end state, not a half-migration.
- No public export is added, removed, or renamed. `engines.node` does not change. The sqlite install hint still says `npm i better-sqlite3`. Compat baseline is not regenerated.

## Tasks

- [x] Task 1: Measured inventory — what Bun 1.4.2 actually runs here (must run first)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase113-bun-inventory.md` exists and records, with command transcripts, every probe below. Later tasks consume this file; they do not re-decide a row it already closed.
    - Functional: the review reproduces these already-measured facts on Bun 1.4.2 (do not replace them with a newer Bun): `bun test` runs a `node:test` file that uses `describe` / `it` / `mock.method` / `t.mock.timers.enable({ apis: ["Date"] })` and both tests pass; `bun --test` and `bun --experimental-test-coverage` throw `Cannot use describe outside of the test runner`; a test that sleeps 6s fails at the default 5000ms timeout and passes under `bun test --timeout=0`; a `{ timeout: 1000 }` option still fails under `--timeout=0`; `process.execPath` is the Bun binary while `process.versions.node` is a compatibility string (`26.3.0` on the plan-writing host), not a Node install; `node:v8` `getHeapStatistics` loads.
    - Functional: the review `require`s `better-sqlite3` under `bun -e`, opens `:memory:`, and executes DDL (already measured on Bun 1.4.2: succeeds). It also records the interop quirk — `import("better-sqlite3")` returns a namespace so `new m()` throws `Module is not a constructor` — and names it interop, not a block. It runs the built `packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js` suites under `bun test --timeout=0` and records pass/fail counts (already measured: 23 pass, 0 fail, ~360ms). It lists every repo file that imports `better-sqlite3` or `createRequire`s it, and classifies each test file as `bun-ok` or `bun-blocked` — SQLite files are expected `bun-ok` unless the fresh transcript says otherwise.
    - Functional: the review generates `bun.lock` with `bun install --lockfile-only` in a scratch copy (or the real tree if Task 2 has not landed) and records: `JSON.parse` fails on trailing commas; root `workspaces[""]` has `name` and no `version`; a child workspace entry has `version`; `packages` values are tuples, not `{ version }`. It states whether the generated file contains `//` or `/*` comments.
    - Functional: the review times, on this tree, `npm ci`, `bun install` (same dependency set), root `tsc` (`npm run build:core`), and one representative `node --test` vs `bun test --timeout=0` on the same built `dist/__tests__/*.test.js` glob. It also runs one root source file via `bun test --timeout=0 src/__tests__/<one>.test.ts` with no `dist/` and records pass or the first resolution error. Numbers go in the evidence file. No pass/fail of the migration is invented without those numbers.
    - Functional: the review lists every `process.execPath` spawn that passes `--test`, `--experimental-test-coverage`, `--test-isolation`, or `-e`, and every `npm ci` / `cache: "npm"` hit under `.github/workflows`. It names the child-env vars a nested `bun test` inherits (print `env` from a child) so Task 3 does not guess a `BUN_*` name.
    - Functional: the review prints `bun install`'s linker choice with no `bunfig.toml` (hoisted top-level `node_modules/<pkg>` vs `node_modules/.bun`) and lists dependency lifecycle scripts Bun skipped. That skipped list is the only input to Task 2's `trustedDependencies`. It confirms `bun audit --audit-level=moderate` exits 1 when advisories at that level exist and 0 otherwise (docs quote plus one local exit code).
    - Performance: the timing table is wall clock, one machine, cold vs warm called out. The evidence states which of install, `tsc`, and the test runner is the majority of a local `npm test` loop. That sentence is what Task 3 is allowed to optimize.
    - Code Quality: the evidence is transcripts and a classification table, not a design essay. Every reuse/gap row names a path. `scripts/plan-review-gate.test.mjs` gains a `PLAN_113_TASK_1` block (plan path, evidence path, required tokens, rejected tokens) checked by the existing `assertPrimitiveReview` helper — no new gate runner.
    - Security: evidence files contain no credentials, no `PRISM_*` secret values, and no absolute home paths. The review states that `bun audit` skipping a scoped registry with no advisory endpoint does not fail the exit code (Bun audit docs), and that this repo's dependencies are public npm packages so that skip is not a current hole. It does not recommend `--ignore`.
  - Approach:
    - Documentation Reviewed:
      - Bun 1.4.2 (`bun --version`; `npm view bun version` = 1.4.2). Context7 `/oven-sh/bun/bun-v1.4.2`.
      - https://bun.com/docs/cli/test and local `bun test --help` (`--timeout` default 5000, `--coverage`, no `--test-coverage-lines`).
      - https://bun.com/docs/test/configuration — `--timeout` milliseconds; `coverageThreshold` as a number or `{ lines, functions }` (`statements` accepted, not enforced). No bunfig timeout key on that page.
      - https://bun.com/docs/pm/cli/install — `bun ci` is `bun install --frozen-lockfile`; text `bun.lock` since 1.2; dependency lifecycle scripts run only for `trustedDependencies`; new workspaces default to the isolated linker, existing/pre-1.3.2 projects stay hoisted.
      - https://bun.com/docs/runtime/bunfig — `install.linker`, `install.frozenLockfile` (default false; CI must pass the flag), `install.saveTextLockfile` (default true), `install.minimumReleaseAge` (default off).
      - https://bun.com/docs/install/audit — `--audit-level=low|moderate|high|critical`; exit 0 if none remain at that level, exit 1 otherwise; `--json` is unfiltered and must not be the CI gate.
      - Live probes on Bun 1.4.2 (this machine, this session; Task 1 re-runs and pastes them): `bun -e 'require("better-sqlite3")'` opens `:memory:` and executes; `bun test --timeout=0` on `dist/sessions/sqlite/__tests__/{lifecycle,sqlite-persistence,state-concurrency-conformance}.test.js` = 23 pass / 0 fail. The plan's earlier `BunProcess.cpp` / issue 4290 citation does not reproduce and is retired.
      - `oven-sh/setup-bun` `action.yml` at `0c5077e51419868618aeaa5fe8019c62421857d6` (tag v2.2.0, same SHA as floating tag v2). Inputs: `bun-version` (no default), `bun-version-file` (default null; `package.json` is an example path, not an implicit read), `no-cache` (default false, caches the Bun executable only). No `cache:` input.
      - Repo: `package.json` `engines.node` `>=22` and the `test` / `test:coverage` / `sdk:ready` scripts; `docs/testing.md` five stages; `docs/release-and-install.md` Node 22/24 matrix and the <60s budget; `scripts/run-all-tests.mjs` `STAGES`; `scripts/postgres-evidence.mjs` TAP parser; `scripts/release.mjs` `JSON.parse` of `package-lock.json`.
    - Options Considered:
      - Skip the inventory and edit CI — rejected: `bun --test` is not `node --test` (probed), the default timeout is 5s (probed), and the runner split must rest on transcripts, not on the retired hard-block claim. An unmeasured switch fails the suite for a reason nobody wrote down.
      - Treat Bun as the consumer runtime and delete `engines.node` — rejected: eleven publishable packages declare `>=22`, `node22-compat` imports every public export on Node 22, and hosts install from npm. Speed for contributors is not a breaking runtime cut.
      - Rewrite `node:test` imports to `bun:test` — rejected: 635 files import `node:test`, and Bun 1.4.2 already executes that module under `bun test`. A rewrite is the large diff that the shim exists to avoid.
    - Chosen Approach: one evidence file that freezes the probes, the timings, the `bun-ok` / `bun-blocked` split, the lockfile shape, and the rejected list. Tasks 2 and 3 implement only what this file allows.
    - API Notes and Examples:
      ```bash
      # already measured on Bun 1.4.2 — Task 1 re-runs and pastes the transcript
      bun test node-test.test.ts          # node:test describe/it/mock.method/t.mock.timers: pass
      bun --test node-test.test.ts        # error: Cannot use describe outside of the test runner
      bun test --timeout=0 slow.test.ts   # 6s test passes; default 5000ms fails
      bun -e 'require("better-sqlite3")'   # measured: loads, opens :memory:, executes

      # lockfile shape (scratch workspace, bun 1.4.2, lockfileVersion 2)
      # workspaces[""] = { name }            # no version
      # workspaces["packages/a"] = { name, version }
      # JSON.parse(bun.lock) throws on trailing commas
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase113-bun-inventory.md`: transcripts, timing table, classification, rejected list.
      - `scripts/plan-review-gate.test.mjs`: `PLAN_113_TASK_1` block and one `assertPrimitiveReview` test.
      - Execution note (2026-09-23): `plans/README.md` plan 113 row corrected (SQLite is measured `bun-ok`, not blocked) and the unindexed plan 114 row added so the pre-existing `src/__tests__/docs.test.ts` plans-index failure clears. No other file changed.
    - References:
      - Required tokens: `bun.lock`, `package-lock.json`, `better-sqlite3`, `--timeout=0`, `bun --test`, `process.execPath`, `--experimental-test-coverage`, `hoisted`, `engines.node`, `node:test`, `oven-sh/setup-bun`, `trustedDependencies`.
      - Rejected tokens: `bun:sqlite`, `drop engines.node`, `bun publish`, `bun run --bun`, `replace tsc`, `dual lockfile`, `rewrite node: imports`, `coverageThreshold as the release gate`.
  - Test Cases to Write:
    - Review gate: `scripts/plan-review-gate.test.mjs` fails when the evidence file is missing, drops a required token, or drops a rejected token.
    - Lockfile probe: transcript shows `JSON.parse` failing and root `workspaces[""].version` absent. Task 2's parser and version gate rest on that transcript.
    - Timeout probe: transcript shows default 5000ms fail, `--timeout=0` pass, per-test `timeout` still enforced. Task 3's flag rests on that.
    - SQLite probe: transcript shows the `require` load plus `:memory:` exec succeeding and the built SQLite suites passing under `bun test --timeout=0`; the file list classification follows that transcript (expected `bun-ok`). Task 3 schedules those files on `bun test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact and a test-only gate block).
    - Docs pages to create/edit: `docs/_evidence/phase113-bun-inventory.md` (evidence, excluded from the shipped tarball; not an API page).
    - `docs/index.md` update: no (no behavior delta, no new page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Install surface — `bun.lock`, hoisted `bun ci`, audit, release lockfile checks
  - Acceptance Criteria:
    - Functional: `package-lock.json` is deleted. `bun.lock` is committed. Root `package.json` has `"packageManager": "bun@1.4.2"`. `bunfig.toml` sets `install.linker = "hoisted"` and `install.saveTextLockfile = true`. `install.frozenLockfile` stays false in the file (local adds must be able to update the lock); CI passes the flag.
    - Functional: `bun ci` in a clean tree installs the same workspace name-set `scripts/package-truth.mjs` already counts (12 publishable manifests). A second `bun ci` changes nothing. `bun install` without `--frozen-lockfile` is what `scripts/release.mjs` `regenerateLockfile` runs after a version bump (`bun install --lockfile-only`), replacing `npm install --package-lock-only`.
    - Functional: version agreement no longer reads npm's `packages[""].version`. A shared reader (one function, three callers) accepts the Task 1 lockfile shape: trailing commas, optional comments only if Task 1 found them. Root version is checked on `package.json` (already). Each non-root `workspaces[<path>].version` must equal that package's manifest. Absent root `workspaces[""].version` is not a failure (Task 1 measured it absent). Present root version, if a future Bun writes one, must match. `packages` tuples are not a version source.
    - Functional: every `.github/workflows/*.yml` hit from Task 1's `npm ci` / `cache: "npm"` list uses `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (`# v2.2.0`) with `bun-version: "1.4.2"` and `bun ci`. `cache: "npm"` is removed (it keys off `package-lock.json`). `setup-node` stays on jobs that still run `node`, `tsc`, coverage, SQLite, or `npm pack` / `npm publish`. Re-grep at execution; the plan-time list is `security.yml`, `integration-postgres.yml`, `integration-office.yml`, `sandbox-browser.yml`, `integration-nats.yml`, `release.yml` (every job), `live-matrix.yml`, `coding-journey.yml`, `canary-providers.yml`. `live-canaries.yml` has `setup-node` and no `npm ci` — leave it unless the grep finds an install.
    - Functional: `npm audit --audit-level=moderate` is replaced by `bun audit --audit-level=moderate` (text, not `--json`) after `bun ci`. Exit non-zero is the gate. `npm pack` / `npm publish` invocations in `scripts/release.mjs` and the publish job stay. `bun publish` is not introduced.
    - Functional: `trustedDependencies` contains only names Task 1 listed as skipped lifecycle scripts that Node tests still need built (expected candidate: `better-sqlite3`; do not trust the world). After install, `node -e "require('better-sqlite3')"` succeeds and `bun -e "require('better-sqlite3')"` succeeds too — the trust list builds the same prebuilt binary both runtimes load. The published hint string `npm i better-sqlite3` in `packages/prism-core/src/sessions/sqlite/persistence.ts` is unchanged.
    - Functional: `DEFAULT_IGNORE_PATTERNS` gains `bun.lock` and `bun.lockb`. `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` stay, so a consumer tree that still has them is still skipped. The declaration type stays `string[]`.
    - Performance: Task 1's `bun install` vs `npm ci` numbers are cited in the evidence file's Task 2 note. CI install must not get slower than Task 1's `npm ci` by more than noise on the same runner class; if it does, stop and record why instead of landing a slower install.
    - Code Quality: one lockfile reader, used by `scripts/release.mjs`, `scripts/version-literal-gate.test.mjs`, and `scripts/truth-current.test.mjs`. No second ad-hoc `JSON.parse`. A `ponytail:` comment on the reader names the ceiling (comments or commas inside strings) and the upgrade (a real JSONC parser) if Task 1 found comments. Retired phase freeze/release files that read `package-lock.json` (`scripts/phase16-freeze.test.mjs`, `scripts/phase27-release.test.mjs`, `scripts/phase30-release.test.mjs`, and baseline JSON hashes) are not edited — they are immutable evidence and are not in the default suite.
    - Security: CI cannot update the lockfile (`bun ci`). Audit floor stays moderate. Hoisted linker is pinned so optional native peers resolve the way npm consumers resolve them; isolated is a behavior change, not a speed feature. `minimumReleaseAge` is not added (supply-chain policy, separate decision). `NPM_TOKEN`, `id-token: write`, and provenance flags stay only on the publish job. No new registry. Compat baseline is not regenerated: this task adds no export and removes none. If `release:gate` reports a declaration diff, stop; that is a bug, not a `--update-baseline` excuse.
  - Approach:
    - Documentation Reviewed:
      - Task 1 evidence file (lockfile shape, linker, skipped scripts, audit exit).
      - https://bun.com/docs/pm/cli/install (`bun ci`, `trustedDependencies`, linker default).
      - https://bun.com/docs/runtime/bunfig (`install.linker`, `install.saveTextLockfile`).
      - https://bun.com/docs/install/audit (exit code, do not gate on `--json`).
      - `oven-sh/setup-bun` action.yml at the pinned SHA (pin `bun-version`; do not assume `packageManager` is read unless `bun-version-file` is set — this plan sets `bun-version` explicitly anyway).
      - `scripts/release.mjs` `regenerateLockfile` / `validateRelease` / `validateReleaseIndependent`; `scripts/version-literal-gate.test.mjs` lock walk; `scripts/truth-current.test.mjs` lockfile test; `src/__tests__/docs.test.ts` phrase list that requires `package-lock.json` inside `scripts/release.mjs` and `npm ci` inside `docs/release-and-install.md`.
    - Options Considered:
      - Keep `package-lock.json` and also commit `bun.lock` — rejected: two lockfiles drift, and `npm ci` vs `bun ci` will not resolve the same tree forever.
      - `bun publish` instead of `npm publish` — rejected: publish is provenance, OIDC, `--access public`, and pack JSON that `src/__tests__/docs.test.ts` and the release workflow already assert. Not a dev-speed change.
      - Isolated linker (Bun's new-workspace default) — rejected: published consumers install with npm's hoist. Dev must match, or optional peers (`better-sqlite3`, `pg`, `@napi-rs/keyring`) resolve differently than production.
      - `JSON.parse` after a trailing-comma regex — rejected: the lockfile holds integrity strings; a regex that also eats a comma inside a string would drop a version check. A small in-string scanner is the same size and does not lie.
      - Rewrite historical `phase16` / `phase27-release` / `phase30-release` tests — rejected: they are era evidence, not the live gate. Editing them to go green falsifies the freeze.
    - Chosen Approach: one lockfile, hoisted, frozen in CI, npm kept only for pack and publish. Release gates learn the bun.lock shape Task 1 measured. Live tests and the two docs pages that assert the old phrases update in the same change.
    - API Notes and Examples:
      ```toml
      # bunfig.toml
      [install]
      linker = "hoisted"
      saveTextLockfile = true
      ```
      ```bash
      bun ci                                  # bun install --frozen-lockfile
      bun install --lockfile-only             # release bump, replaces npm install --package-lock-only
      bun audit --audit-level=moderate        # exit 1 on moderate+; do not pass --json
      ```
      ```yaml
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: "1.4.2"
      - run: bun ci
      ```
    - Files to Create/Edit:
      - `bunfig.toml`: new, linker + text lockfile.
      - `mise.toml`: new. `[tools]` with `node = "24"` and `bun = "1.4.2"`; one comment noting CI pins its own versions in workflows, so bumps touch both. Local-only — no CI change.
      - `bun.lock`: generated, committed. `package-lock.json`: deleted.
      - `.gitignore`: `bun.lockb` (binary lockfile must not land if someone flips the setting).
      - `package.json`: `packageManager`; `build` / workspace script dispatch that currently shells `npm run … --workspaces` becomes `bun run --workspaces --if-present` where Task 1's workflow grep shows the dev loop would otherwise require npm. `pack:dry-run` stays `npm pack`.
      - `scripts/bun-lock.mjs`: the one reader. `scripts/release.mjs`: call it from both version checks; `regenerateLockfile` spawns `bun`.
      - `scripts/version-literal-gate.test.mjs`, `scripts/truth-current.test.mjs`, `scripts/release-gate.test.mjs`, `src/__tests__/release.test.ts`: fixtures write bun.lock shape (trailing commas, `workspaces` map), not npm `packages`.
      - `src/__tests__/docs.test.ts`: phrase list follows the new sentences (`bun ci`, `bun.lock`). Do not leave a dummy `package-lock.json` string in `release.mjs` to satisfy the old assertion.
      - `packages/memory/src/wiki/manifest.ts`: ignore `bun.lock` and `bun.lockb`.
      - `packages/memory/src/wiki/__tests__/manifest.test.ts`: extend `scanRawFiles_scans_workspace_and_skips_ignored` with a `bun.lock` file that must be absent from the map.
      - `.github/workflows/*.yml`: the Task 1 install list.
      - `docs/release-and-install.md`: install lockfile is `bun.lock`; CI install is `bun ci`; Node 22/24 matrix unchanged; audit command; pack/publish still npm. One sentence that `package-lock.json` is retired, so history pages are not the current contract.
      - `docs/wiki.md`: one bullet under Extension and configuration notes — default scan ignore includes `bun.lock` / `bun.lockb` next to the existing lockfile names.
      - `README.md` Scripts table: contributor install/test commands that Task 2 actually changes. Consumer `npm install @arnilo/prism` lines stay.
      - Execution note (2026-09-23): landed as listed. Extra edits the plan did not name: `src/__tests__/docs.test.ts` also had to flip two command-shape assertions (`bun audit --audit-level=moderate` in workflows, `bun run build &&` in `scripts.typecheck`); `scripts/workflow-liveness.test.mjs` needed no change. `node scripts/package-truth.mjs --emit-docs` regenerated the stale phase-54 evidence and generated blocks (pre-existing WIP drift: src exports and `scripts/budgets.json` were already ahead of the committed evidence, so `scripts/truth-current.test.mjs` failed before this task's edits). `trustedDependencies` is not added: Task 1's skipped-lifecycle-script list is empty, and both `node`/`bun` `require('better-sqlite3')` checks exit 0 after `bun ci`.
    - References:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts` install hint (do not edit).
      - `scripts/compat-baseline/arnilo__prism-memory.txt` declares `DEFAULT_IGNORE_PATTERNS` as `string[]` — value change, not a declaration change.
      - `docs/testing.md` stage table is Task 3, not this task, unless Task 2 renames the `test` script (it should not: `scripts/run-all-tests.test.mjs` pins `scripts.test` to `node scripts/run-all-tests.mjs`; leave that string so the runner still starts on Node and can spawn either binary by name).
  - Test Cases to Write:
    - Lock reader: a fixture `bun.lock` with trailing commas and no root version parses; a workspace version mismatch fails `validateRelease`; a missing workspace path fails; root version lives on the manifest.
    - Positive control in `scripts/version-literal-gate.test.mjs`: tampering a workspace `version` in the lockfile is reported. The old `package-lock.json: version` label is replaced, not left dangling.
    - Wiki scan: a fixture `bun.lock` is not in the scan map. `package-lock.json` remains ignored.
    - Install smoke: `node -e "require('better-sqlite3')"` and `bun -e "require('better-sqlite3')"` both exit 0 after `bun ci` with the Task 1 trust list.
    - Docs phrase: `src/__tests__/docs.test.ts` fails if `docs/release-and-install.md` still says the verify job runs `npm ci`, or if `scripts/release.mjs` still depends on `package-lock.json`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `DEFAULT_IGNORE_PATTERNS` default contents change (wiki scan skips two more filenames), and the contributor install/CI contract changes. No package export, subpath, event, or `engines` change. Consumer install commands do not change.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: current install lockfile, CI install, audit command, Node matrix unchanged.
      - `docs/wiki.md`: default ignore list bullet.
      - `README.md`: contributor commands only.
    - `docs/index.md` update: no new navigation entry. Existing release-and-install and wiki blurbs do not name the lockfile; leave them. Do not put a plan number or a "now uses Bun" release sentence in the current-line banner.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Test runner split — `bun test --timeout=0` where Task 1 said yes, Node where it said no
  - Acceptance Criteria:
    - Functional: `scripts/run-all-tests.mjs` runs Task 1's `bun-ok` stages with `bun test --timeout=0` on the same file sets `node --test` runs today — the SQLite suites are `bun-ok` per Task 1's transcript. Any file the inventory marks `bun-blocked` stays on `node --test`. The coverage stage stays `node --test --experimental-test-coverage` with the existing 60/70/75 excludes in `package.json` `test:coverage` and `scripts/coverage-summary.mjs` — untouched here, moved to `bun test --coverage` by plan 114 after this plan lands. `scripts/postgres-evidence.mjs` keeps parsing Node TAP because the Postgres suite stays on `node --test`.
    - Functional: no stage invokes `process.execPath` with Node-only flags. Node-only children spawn `node` by name. Bun stages spawn `bun` by name. `bun run --bun` is not used anywhere (it symlinks `node` to Bun and would make `node --test` the broken `bun --test` path Task 1 recorded).
    - Functional: `--timeout=0` is on every `bun test` invocation the runner owns, including workspace scripts Task 1 classified `bun-ok`. Per-test `{ timeout }` options are left alone (Task 1 showed they still fire). Workspace `package.json` `test` scripts change only for packages whose files are all `bun-ok`. A package that mixes both gets `bun test` plus a `node --test` tail for the blocked glob, still behind `scripts/with-build-lock.mjs` when the files import `dist/`.
    - Functional: nested runners still strip `NODE_TEST_*`. They also strip whatever child-env name Task 1 printed for a nested `bun test`, if any. If Task 1 printed none, do not invent a `BUN_TEST_*` strip.
    - Functional: root source run (`bun test` on `src/__tests__/*.test.ts` without reading `dist/`) lands only if Task 1's single-file source probe passed and a follow-up run of the root glob passes. Otherwise the root stage stays on built `dist/__tests__/*.test.js` and the evidence file says why. Workspace tests that import `@arnilo/prism` keep using built exports. No `exports` condition, no preload alias, no `bun:sqlite` driver.
    - Functional: `incremental: true` is added to root and workspace `tsconfig.json` files only if Task 1's timing table shows `tsc` is the majority of `npm test` and Task 3 did not remove that build from the default loop. Then `*.tsbuildinfo` is gitignored. If `tsc` is not the majority, do not add it.
    - Performance: the default suite stays inside the documented < 60s budget (`docs/release-and-install.md`). Task 3 writes the before/after wall clock next to Task 1's table. A `bun test` stage that is slower than the Node stage it replaced is reverted to `node --test` and the evidence file records the revert. Coverage runtime is unchanged because the command is unchanged.
    - Code Quality: `scripts/run-all-tests.test.mjs` keeps asserting the stage list and the `scripts.test` entry. Update assertions that pin `--test` / `process.execPath` so they pin the new command shape instead of being deleted. No new test framework. No `bun:test` imports in published `src/` or `packages/*/src`.
    - Security: the coverage gate is not moved in this plan — plan 114 owns that migration and its recalibration. The SQLite fail-closed path moves with the suite: a SQLite file that is skipped or errors under `bun test` is a failure of this task, not a skip; the evidence-file transcript showing the database actually opened is the proof. `with-build-lock` still wraps dist readers and `tsc` so a partial emit cannot be tested. Do not drop the lock to save a few milliseconds.
  - Approach:
    - Documentation Reviewed:
      - Task 1 transcripts (`--timeout=0`, `bun --test` error, `bun-blocked` list, child env, timing majority).
      - https://bun.com/docs/cli/test — `bun test` flags; `bun run --help` `--bun` (force Bun by symlinking `node`) and `--workspaces` / `--if-present` / `--filter`.
      - `docs/testing.md` stage table and the `NODE_TEST_CONTEXT` nested-runner rule.
      - `scripts/run-all-tests.mjs` `STAGES`, `scripts/with-build-lock.mjs` env strip, `scripts/coverage-summary.mjs`, `scripts/postgres-evidence.mjs` TAP regex `^(?:#|ℹ) (tests|pass|fail)`.
    - Options Considered:
      - `bun test` for SQLite — chosen, transcript-first: the built SQLite suites pass on Bun 1.4.2 (23 pass, 0 fail). Task 1 re-records the transcript; if a fresh run regresses, the files revert to `node --test` and the evidence says why. A green suite that never opened a database remains a false gate — the transcript is the guard.
      - Replace coverage with `bun test --coverage` and `coverageThreshold` — rejected: the floors are Node instrumentation numbers (60/70/75, excludes in `package.json`). Bun's reporter is a different instrument. Switching without a measured mapping drops the gate. Not this plan.
      - Rewrite `postgres-evidence.mjs` to parse Bun's `(pass)` reporter — rejected: the Postgres suite stays on Node, so the parser is already correct. A second parser is dead code.
      - `bun run --bun` so scripts see Bun as `node` — rejected: Task 1 showed `bun --test` does not run tests. The symlink hides that until CI.
      - Preload that aliases `@arnilo/prism` to TypeScript source so workspace tests skip `tsc` — rejected unless Task 1's numbers say `tsc` dominates and a 20-line probe was recorded as passing. It is not a task in this plan. Subpath exports (`@arnilo/prism/testing/*`, `@arnilo/prism-core/...`) make a one-alias preload a second module resolver.
      - Replace `tsc` with `bun build` for publish emit — rejected: packages ship `.d.ts` next to `dist/*.js`. Bun's transpiler does not emit that contract. TypeScript `^7.0.2` is already the compiler.
    - Chosen Approach: split the runner on the inventory's classification. Same files, explicit binaries, timeout flag the probe required, Node left in place where Bun is not Node.
    - API Notes and Examples:
      ```bash
      # compatible suite (timeout 0 matches Node's no default timeout)
      bun test --timeout=0 dist/__tests__/*.test.js

      # not this — probed failure on 1.4.2
      bun --test dist/__tests__/*.test.js

      # sqlite joins bun (measured 23 pass on 1.4.2):
      bun test --timeout=0 dist/sessions/sqlite/__tests__/*.test.js

      # coverage stays (plan 114 owns its migration to bun):
      node --test --experimental-test-coverage --test-coverage-lines=60 \
        --test-coverage-functions=70 --test-coverage-branches=75 \
        --test-coverage-exclude='**/__tests__/**' dist/__tests__/*.test.js
      ```
      ```js
      // spawn by name, never process.execPath, for these flags
      spawnSync("node", ["--test", "--test-isolation=none", glob], { env });
      spawnSync("bun", ["test", "--timeout=0", ...files], { env });
      ```
    - Files to Create/Edit:
      - `scripts/run-all-tests.mjs`: stage commands. `scripts/run-all-tests.test.mjs`: assertions that pin the command shape.
      - `scripts/with-build-lock.mjs`: comment plus env strip only if Task 1 named a Bun child-env var. Do not otherwise restructure the lock.
      - `package.json` and `packages/*/package.json` `test` scripts: only the packages Task 1 classified. Tentative until that table exists — do not edit a script the inventory did not classify.
      - `docs/testing.md`: stage table names `bun test` vs `node --test` per stage. Nested-runner paragraph keeps the `NODE_TEST_*` rule and adds the Task 1 env name if one exists.
      - `docs/release-and-install.md`: one sentence on the split (default suite including SQLite runs under Bun; coverage stays on Node until plan 114; the Postgres TAP leg stays on Node; budget still the default suite). Node 22/24 support matrix unchanged — Bun is not added as a supported consumer runtime.
      - `README.md` Scripts table: `bun run test` as the contributor command; `npm test` still works because the script entry stays `node scripts/run-all-tests.mjs`.
      - `docs/_evidence/phase113-bun-inventory.md`: before/after timing note and any revert.
      - `tsconfig.json`, `packages/*/tsconfig.json`, `.gitignore`: only if the incremental trigger fires.
      - Execution note (2026-09-23): landed as one `sqlite suites` stage in `scripts/run-all-tests.mjs` (`node scripts/with-build-lock.mjs bun test --timeout=0 packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js`, 24 pass / 0 fail, 356–369 ms vs 388–407 ms on Node) plus `packages/prism-core/package.json` excluding that glob from its Node run. Every other stage spawns `node` by name; `process.execPath` is gone from the runner's code (a Bun parent would make it `bun --test`). Deviation the plan did not specify: Node `--test` has no exclude flag (v26.9.0 ignores `!pattern`, measured), so the Node side uses `find dist -name '*.test.js' ! -path 'dist/sessions/sqlite/__tests__/*'` behind a `test -d dist` guard, and `scripts/run-all-tests.test.mjs` asserts the partition (79 + 3 = 82, each file once) instead of plan 080's quoted-`**` control for prism-core (`hooks` / `prism-coding-tools` keep that control). Reverts, measured: root dist glob 30.1 s + 1 extra Bun-only failure (Task 1 §4) → Node; root *source* glob 30.75 s, 2 fail (the `process.execPath --test` spawn in `src/__tests__/cli-provider-add.test.ts`, outside this task's file list) → does not land; whole prism-core workspace glob 8.89 s vs 3.67 s → Node. Not changed: `incremental: true` (tsc is ~3 s of a ~91 s suite, not the majority), `scripts/with-build-lock.mjs` (Task 1 §1.5 measured no `BUN_*` child variable, so no `BUN_TEST_*` strip is invented), coverage and the Postgres TAP leg (plan 114 / unchanged), `scripts/budget-gate.test.mjs` (host-contention ceiling). Docs: `docs/testing.md` stage table now names the runner per stage and gains the previously missing performance-budget row, `docs/index.md` navigation sentence, `docs/release-and-install.md` split sentence; README's `bun run test` row was already landed in Task 2. Evidence: `docs/_evidence/phase113-bun-inventory.md` §10 (transcripts, revert table, before/after wall clock).
    - References:
      - `scripts/wiki-scratch-isolation.test.mjs` (`--test-isolation=none`) stays a `node` spawn.
      - `scripts/budget-gate.test.mjs` stays a single-process Node run if Task 1 shows Bun's parallel workers perturb the startup ceiling. Default: leave it on `node --test` even if classified `bun-ok`, because the file's comment says the ceiling measures host contention. Do not "speed up" a benchmark by changing its runner.
  - Test Cases to Write:
    - Chain test: `effectiveTestChain()` still names every `GATE_FILES` entry; the performance-budget stage is still outside that list; the workspace stage still runs; the test script entry is unchanged.
    - Classification test: a fixture list from the inventory's `bun-blocked` paths is absent from every `bun test` argument the runner builds, and present on a `node --test` argument; the SQLite glob from Task 1's transcript is present on a `bun test` argument. One sabotaged inclusion fails.
    - `scripts/plan-review-gate.test.mjs`: the `PLAN_113_TASK_1` block's sqlite expectation now requires the pass transcript tokens (`23 pass`, `:memory:`) and rejects the retired `expected throw naming issue 4290` phrasing.
    - Timeout test: the runner's bun arguments include `--timeout=0`. A copy without it fails the assertion.
    - ExecPath test: runner source does not pass `--test` or `--experimental-test-coverage` through `process.execPath`.
    - Budget: the default suite wall clock is recorded and compared to 60s. This is a run, not a new micro-benchmark framework.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer runtime, export, or event change. Contributor test commands and the documented stage table change, which is a development-contract change already covered by `docs/testing.md` and `docs/release-and-install.md`.
    - Docs pages to create/edit:
      - `docs/testing.md`: stage table and nested-runner sentence.
      - `docs/release-and-install.md`: split sentence; support matrix stays Node.
      - `README.md`: contributor script row.
    - `docs/index.md` update: yes, one existing navigation sentence only — the testing entry currently says "the five `npm test` stages". Change that sentence to name the default suite's stages without a plan number or a version narrative. No new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **The default suite is not inside the documented `< 60s` budget.** Measured `node scripts/run-all-tests.mjs` wall clock: 90.6 s before Task 3, 92.9 s and 93.7 s after (evidence §10). Task 3 did not cause it — the moved SQLite files cost 0.38 s on Bun against ~0.40 s on Node, so the split is net-neutral, and Task 1's stage sum was already ~91 s. The `docs/release-and-install.md` budget sentence (and its `~45s` baseline) predates this branch's suite growth. Editing the claim to match would be papering over a real regression; raising it or trimming the gate/workspace stages is a separate, measured decision (Further Action 1).
- **Only the SQLite file set moved to Bun.** Task 1's inventory produced exactly one measured `bun-ok` set that is not slower under Bun; the root glob and the whole prism-core workspace glob are 2.3–2.4× slower because `bun test` runs files in a single process while `node --test` uses workers. The 30 ms win is not the point — the encoded classification, the `--timeout=0` rule, and the fail-closed SQLite transcript are.
- **The Node side of the split uses POSIX `find`.** Node `--test` has no exclusion flag, so the only ways to keep the SQLite files from running twice are a shell `find` list or enumerating 16 dist directories by hand. `find` is recursive (a new test directory cannot be silently skipped) at the cost of leaving plan 080's quoted-`**` control for prism-core. A partition test in `scripts/run-all-tests.test.mjs` replaces that control for this package.
- **The plan's root source-run follow-up does not land.** `bun test --timeout=0 src/__tests__/*.test.ts` is 30.75 s with 2 failures, both from the `process.execPath --test` spawn in `src/__tests__/cli-provider-add.test.ts` — a test file outside this task's file list — and 2.3× slower than the Node stage it would replace, so the revert rule fires twice over.
- **`scripts/with-build-lock.mjs` is untouched.** Task 1 measured that `bun test` sets no `BUN_*` or `NODE_TEST_*` variable, so there is no Bun child-env name to strip; adding one would be inventing state.
- **Pre-existing branch drift left in place.** `release:gate`'s compat stage is red on this WIP branch (memory/coding-tools export moves, unrelated to plans 113's tasks). Task 2 recorded it and did not regenerate the baseline; Task 3 did not either.

## Further Actions

1. **Decide the test budget (high).** The default suite measures 90.6–93.7 s against a documented `< 60s` claim. Either trim the gate-suite/workspace runtime with measurements, or raise the number in `docs/release-and-install.md` with the current stage table as its baseline. Rationale: a pinned budget that every run violates stops being a gate. Priority: high.
2. **Plan 114 — coverage on Bun (medium).** Move `test:coverage` to `bun test --coverage` and recalibrate the 60/70/75 floors against the new instrument. The SQLite stage already runs on Bun, so the split stays one runner per file set. Rationale: a single coverage instrument avoids double-counting and the current floors are Node-instrumentation numbers.
3. **Fix the Node-only spawns (medium).** `src/__tests__/cli-provider-add.test.ts:L282,L288` and the other `process.execPath --test` sites in evidence §5 should spawn `node` by name. Rationale: it removes Bun's only extra root-glob failure and is a prerequisite for any future root-stage flip; today the failure is latent, not hypothetical.
4. **Re-measure when Bun parallelizes `bun test` (low).** Every large glob measured here loses to Node's worker pool; the split's revert table should be re-run when Bun ships parallel test files. Rationale: the classification is a measurement, not a preference.
5. **Regenerate the compat baseline with a migration note (low).** The WIP branch's memory/coding-tools export moves fail `release:gate`; either land the missing exports or pass `--allow-break` with the migration note the gate asks for. Rationale: `release:gate` cannot run at all while it is red. Priority: low, but it blocks any release cut.

Items 1, 3, 4, and 5 are ordered as tasks in [115-Bun-Toolchain-Follow-Ups.md](115-Bun-Toolchain-Follow-Ups.md); item 2 is [114-Bun-Coverage-Gate.md](114-Bun-Coverage-Gate.md).
