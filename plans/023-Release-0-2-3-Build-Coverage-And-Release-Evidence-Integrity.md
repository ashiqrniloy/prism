# Release 0.2.3 — Build, Coverage, and Release Evidence Integrity

Roadmap phase: `roadmap.md` § **0.2.3 — Build, coverage, and release evidence integrity**.
Baseline: `@arnilo/prism` **0.2.2** (plan 022 complete; 50-package publish graph; zero audited vulnerabilities; `npm test` exit 0 — totals 3,480 tests / 3,447 pass / 33 protected or live skips / 0 failures across 44 suites, 255/255 script gates; `security:threat-suites` 47/47; `test:postgres` 91/91; core coverage 90.49% lines / 84.19% branches / 90.55% functions; `exitGate.green: true` in `scripts/phase22-baseline.json`; Biome reports 75 warnings + 22 infos on schema `2.5.5`; Node 20 v20.20.2 packed imports 24/24).
Target: `@arnilo/prism` **0.2.3**. Behavior changes are build, coverage, release-evidence, and quality-gate tooling. No public runtime contract change is planned; the migration is contributor/CI-facing only (build serialization, coverage thresholds, skip manifest, Biome config migration). No removal of a public runtime API; any package-export change is additive and tarball-excluded (scripts/test-only).

Scope items (mapped one-to-one to the four roadmap 0.2.3 bullets, and to mandatory 0.2.x regression matrix items 4 and 12):

1. Prevent partial live `dist/` imports: serialize emit-producing commands with a portable lock or compile core/workspaces into staging directories and atomically publish outputs; keep explicit `clean` for branch/deletion hygiene; do not assume concurrent `tsc` writes are transactional. (Matrix item 4: concurrent emit builds plus an importer never observe partial `dist`.)
2. Correct workspace coverage denominators: add a package-local `--test-coverage-include=dist/**` (resolved package path), preserve the core gate, introduce evidence-based package thresholds with protected-integration exceptions shown separately. (Matrix item 12: workspace coverage excludes imported core files and records protected skips.)
3. Make skipped protection visible: default local tests may skip unavailable infrastructure, but release summaries must name every skipped live/protected suite and mark required environments blocked; keep full live-service expansion scheduled for 0.3.0.
4. Stabilize quality gates: resolve current Biome warnings/infos, migrate deprecated Biome configuration, quarantine or replace load-sensitive timing assertions, and make lint/format/unused reports machine-readable.

## Objectives

- Close the four confirmed build/coverage/release-evidence/quality-gate defects without adding a runtime dependency, a published package, a background service, a second runtime, or a generic CI framework beyond the existing `scripts/` release tooling and the `phase*-baseline.json` evidence shape.
- Make TypeScript declarations and JavaScript runtime behavior agree at the build/coverage boundary: a packed plain-JavaScript consumer and a concurrent build+test stress run must not be able to observe partial `dist` or inflated/deflated coverage denominators via untyped or racy access.
- Preserve all normal single-process behavior: `npm run build`, `npm run clean`, `npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run sdk:ready`, `npm run lint`/`format`, `npm run release:gate`, `test:postgres`, and `security:threat-suites` keep their current happy paths and exit codes; only the named race, wrong-denominator, silent-skip, and quality-gate paths change.
- Keep every coverage threshold, skip record, and quality-gate report bounded, machine-readable, and fail closed before the release green: a package whose recomputed coverage regresses below its evidence-based threshold fails the gate; a required protected environment that is absent is recorded as blocked, never as a passing skip; an unexplained lint diagnostic blocks the gate.
- Publish explicit migration guidance for contributors and CI: the build-serialization boundary, the coverage include filter and per-package thresholds, the release skip manifest format and blocked semantics, and the Biome config migration.
- Record machine-checkable baseline, threat model, compatibility, package-budget, protected-matrix, and release evidence; satisfy mandatory 0.2.x regression matrix items 4 (concurrent emit + importer never observe partial `dist`) and 12 (workspace coverage excludes imported core files and records protected skips) for this release.

## Non-goals

- No security-blocker work from 0.2.0, no provider/network trust work from 0.2.1, no state-concurrency work from 0.2.2, no package/docs truth work from 0.2.4, no refactoring from 0.2.5, no coding-agent readiness from 0.2.6, no ERP readiness from 0.2.7.
- No new model provider, delegated agent, enterprise adapter, forge, object store, policy engine, or live-canary work; all catalog breadth and the full live-service matrix stay deferred to 0.3.x. 0.2.3 only makes existing skips *visible* as blocked release evidence; it does not stand up real OIDC/OPA/S3/MCP-AS/NATS canaries (that is 0.3.0).
- No generic CI/CD framework, no new test runner, no external lock library, no coverage-vendor dependency (Istanbul/c8/nyc). The build lock is a dependency-free `scripts/` helper; coverage reuses Node's built-in `--experimental-test-coverage`; the skip manifest reuses the `phase*-baseline.json` JSON shape.
- No change to `ProviderEvent`, `AgentEvent`, `RunRecord`, `SessionRecord`, `CheckpointRecord`, or any runtime contract. The build lock, coverage include filter, skip manifest, and Biome migration are tooling-only; no published package gains a runtime export.
- No removal of `npm run clean`, `npm run build`, `npm run test:coverage`, the core coverage gate thresholds (60/70/75), the `phase*-freeze.test.mjs` legs, or any existing script. `clean` stays standalone for branch/deletion hygiene; the core gate stays the only hard core threshold; freeze legs stay green.
- No assumption that the build lock makes `tsc` transactional; `tsc` incremental emits remain non-atomic, the lock (or staging) is what closes the race. No assumption that a missing protected environment ever converts to green.
- No timing-only sleeps introduced anywhere; load-sensitive timing assertions are replaced with deterministic barriers or quarantined behind a documented ceiling, never papered over with `setTimeout`.
- No new code-wiki task: `.agents/skills/project-wiki/` does not exist (same as 0.2.0–0.2.2).

## Expected Outcome

- A dependency-free build serialization helper (`scripts/with-build-lock.mjs` or equivalent) wraps every emit-producing command (`build`, `build:core`, `build --workspaces`) and the dist-consuming `node --test dist/__tests__/*.test.js` run inside `test`/`test:coverage` so that a concurrent `npm run build` + `npm test`, two `npm run build`, `typecheck` + `test`, and `coverage` + `test` stress runs never produce missing exports or partial modules. The lock is portable (POSIX `fs.openSync(path, 'wx')` + `O_EXCL` + stale-PID detection + bounded retry; Windows is not a CI target — `release.yml` runs on ubuntu), re-entrancy-safe at the top-level emit/consume boundary (not inside nested npm child processes), and times out fail-closed with a stable error rather than deadlocking. Alternatively — chosen or rejected in Task 0 — core/workspaces compile into `dist.stage/` and atomically rename to `dist/` (POSIX dir rename is atomic), with `tsc` incremental cache (`tsbuildinfo`) handling decided in Task 0. `npm run clean` stays standalone and unchanged. A direct stress regression (`scripts/phase23-build-race.test.mjs`) reproduces the pre-fix partial-import failure and passes post-fix.
- `scripts/coverage-summary.mjs` (workspace loop at the `for (const name of workspaceNames)` block, ~lines 72–86) gains a package-local `--test-coverage-include=dist/**` (resolved against the workspace cwd `packages/<name>`) so only the package's own `packages/<name>/dist/**` counts in its denominator; the symlinked core `dist` under `packages/<name>/node_modules/@arnilo/prism/dist/**` stays excluded by the existing `**/node_modules/**` exclude. The core gate (lines>=60, functions>=70, branches>=75) is unchanged and remains the only hard core threshold. Each workspace row gains an evidence-based threshold recorded in a new `scripts/coverage-thresholds.json` (recomputed package percentages captured at freeze, threshold = recompute − small margin, fail-closed on regression below threshold) with protected-integration exceptions (packages requiring `PRISM_TEST_POSTGRES_URL` or a real NATS server) shown separately and excluded from the package threshold computation. The summary emits a machine-readable `scripts/coverage-summary.json` artifact recording per-package lines/branches/functions, denominator file count, threshold, pass/fail, and protected-exception status. Known recomputed package percentages are reproduced; security/persistence branch gaps cannot silently regress.
- A release skip manifest (`scripts/release-skip-manifest.mjs` emitting `scripts/release-evidence.json`, or an extension of `release.mjs gate`) aggregates every test surface — core `npm test`, each workspace suite, `test:postgres`, `test:nats` (fake-jetstream seam vs real), `security:threat-suites`, and the live canaries (OIDC/OPA, S3, MCP-AS, NATS JetStream) — and for each records `pass`/`skip`/`blocked`, the reason, the required environment variable or service, and whether the skip is protected/live vs unexplained. A clean release report accounts for all tests including the current 33 protected/live skips; a required release profile cannot convert missing credentials/services into green (absent `PRISM_TEST_POSTGRES_URL` records the durable legs `blocked`, not `skip`). The manifest generalizes the `exitGate.protected`/`exitGate.blocked` shape already in `scripts/phase22-baseline.json` to a release-wide machine-auditable artifact retained by CI. Full live-service expansion stays 0.3.0.
- Biome: the 75 warnings + 22 infos are resolved — safe fixes applied via `biome lint --write`/`format --write`, the residual reviewed and either fixed or marked with a justified `biome-ignore` comment (intentional `ponytail:` ceilings stay); zero unexplained lint diagnostics remain. The deprecated `biome.json` configuration keys are migrated to the 2.x canonical form (exact deprecated keys audited and listed in Task 0/4 — candidates: `files.includes` negation syntax, `linter.rules.recommended` boolean vs object form, `files.ignoreUnknown` placement, per-rule severity form). Load-sensitive timing assertions (grep `setTimeout(` + `performance.now()` + `Date.now()`-delta asserts in `**/__tests__/**` and `scripts/*.test.mjs`) are replaced with deterministic barriers or quarantined behind a documented ceiling suite. Lint, format, and unused-export reports become machine-readable: `biome lint --reporter=json` (or `--max-diagnostics=N` + parse), `scripts/sweep-unused.mjs` emits a JSON report, and the artifacts are retained by CI.
- Direct source tests, built public-import tests, and a fresh packed plain-JavaScript consumer prove the build-race and coverage-denominator fixes without relying on TypeScript.
- 0.2.3 exits with 50 packages, zero new runtime dependencies, zero unexplained lint diagnostics, standard budgets green, every protected skip named as blocked-or-present release evidence (never an unexplained green skip), and an operator-ready signed-tag/OIDC handoff.

## Operational Ownership

- **Release and build/coverage-integrity owner:** Prism maintainer/operator `arn`; owns scope amendments, threat acceptance, compatibility review, protected evidence, signed `v0.2.3` tag, and npm OIDC publication.
- **Build-serialization owner:** `scripts/` + root `package.json` maintainer; owns the build lock (or staging) helper, the acquisition-point mapping across `build`/`build:core`/`build --workspaces`/`test`/`test:coverage`/`typecheck`/`sdk:ready`, and the stress regression.
- **Coverage owner:** `scripts/coverage-summary.mjs` maintainer; owns the package-local include filter, the `scripts/coverage-thresholds.json` evidence/threshold file, the `scripts/coverage-summary.json` artifact, and the protected-exception separation; coordinates workspace package maintainers whose thresholds are recorded.
- **Release-evidence owner:** `scripts/release.mjs` / release-workflow maintainer; owns the release skip manifest, the `blocked` vs `skip` vs `pass` semantics, and CI retention of the manifest; coordinates with the live-canary owners (OIDC/OPA, S3, MCP-AS, NATS) whose protected evidence the manifest aggregates.
- **Quality-gate owner:** `biome.json` + `scripts/sweep-unused.mjs` maintainer; owns the Biome config migration, the warning/info resolution, the timing-assertion quarantine, and the machine-readable report outputs; coordinates with test-suite owners whose timing asserts are quarantined.
- **CI evidence owner:** release workflow maintainer; missing protected evidence blocks the 0.2.3 gate rather than becoming a passing skip; the skip manifest is retained as a release artifact.

## Migration Impact

- **Build serialization (contributor/CI-facing, no runtime consumer migration):** contributors and CI acquire a build lock transparently via the wrapped `build`/`test` scripts; no source change in published packages. A host that invokes `tsc` directly (bypassing `npm run build`) is not serialized and must opt in by using the wrapper or accepting the race — documented as a contributor caveat, not a consumer migration. No persisted state change; no checkpoint/session/router shape change. Rollback: restoring 0.2.2 restores the build race and must not be used as a production mitigation (the race is a CI/build defect, not a runtime defect).
- **Coverage include filter + thresholds (contributor/CI-facing):** workspace coverage denominators drop (core `dist` no longer counted), so reported package percentages rise to their true values; the new `scripts/coverage-thresholds.json` records the recomputed baseline at freeze. A package whose true coverage later regresses below its threshold fails `test:coverage`. No runtime consumer impact. Rollback: restoring 0.2.2 restores the wrong denominator and the silent-regression risk.
- **Release skip manifest (contributor/CI-facing):** the manifest is a new JSON artifact; the release workflow gains a step that emits and retains it. The `exitGate.protected`/`blocked` shape in `phase*-baseline.json` is preserved and cross-referenced. No runtime consumer impact. Rollback: restoring 0.2.2 removes the manifest and the blocked-vs-skip distinction.
- **Biome config migration (contributor-facing):** `biome.json` keys migrate to the 2.x canonical form; contributors running `biome lint`/`format` see the same rules applied via the new keys. No runtime consumer impact; no published package change. Rollback: restoring the 0.2.2 `biome.json` restores the deprecated keys and the 75 warnings + 22 infos.
- **No runtime consumer migration:** 0.2.3 ships no `docs/migration.md` runtime section; a short `docs/release-and-install.md` contributor note documents the build lock, coverage thresholds, skip manifest, and Biome migration. `docs/migration.md` gains no 0.2.2 → 0.2.3 runtime section (there is no runtime contract delta); the contributor note lives in `docs/release-and-install.md` and `CHANGELOG.md`.

## Package and Performance Budget

- Publish graph remains **50 packages**; no package or export subpath is added. All new artifacts (`scripts/with-build-lock.mjs`, `scripts/release-skip-manifest.mjs`, `scripts/coverage-thresholds.json`, `scripts/coverage-summary.json`, `scripts/release-evidence.json`, `scripts/phase23-*.test.mjs`) live under `scripts/` and are excluded from every tarball (existing `scripts/**` exclude in `files`/coverage and the release pack allow-list).
- Runtime dependencies remain unchanged: core stays dependency-free; the build lock uses only `node:fs`/`node:child_process`; coverage reuses Node's built-in `--experimental-test-coverage`; the skip manifest and machine-readable reports use only stdlib JSON. No `proper-lockfile`, no `c8`/`istanbul`/`nyc`, no external lock library, no Biome plugin package.
- Root and affected package packed/unpacked/file-count growth must remain within `scripts/budgets.json` tolerance unless measured evidence justifies a reviewed baseline change. Biome `format --write` may reformat files (whitespace-only); the expected delta is within the existing 5% tolerance and is re-baselined only if measured outside it, with a dated `$comment` per the recorded release convention.
- Build lock: O(1) file create + bounded retry (≤ a few hundred ms typical); no measurable regression to `npm run build` wall time on a non-contended run; under contention it serializes (the intended behavior). Staging alternative: one extra `rename` per emit (O(1) dir rename); `tsc` incremental cache impact decided in Task 0.
- Coverage include filter: O(1) extra CLI flag per workspace; no extra test run (same `node --test` invocation). Per-package threshold check: O(1) compare against the JSON baseline.
- Skip manifest: one aggregation pass over existing test surfaces; no extra test run; O(suites) JSON emit.
- Biome: `lint --write`/`format --write` are existing-tool runs; machine-readable JSON report is one extra `--reporter=json` flag; no runtime cost.
- Stress regression (`phase23-build-race.test.mjs`) and packed plain-JS conformance are test-only; no runtime cost.

## Tasks

- [x] Task 0 — Primitive review, threat model, ownership, migration, and budget decisions
  - Acceptance Criteria:
    - Functional: create `docs/_evidence/phase23-primitive-review.md` before any source/script edit, inventorying existing primitives: the build pipeline in `package.json` (`build:core` = `tsc`, `build` = `build:core && build --workspaces --if-present`, `clean` = `rm -rf dist packages/*/dist` standalone, `test` = `npm run build && node --test dist/__tests__/*.test.js && … && npm run test --workspaces`, `test:coverage`, `typecheck`, `sdk:ready`); `tsconfig.json` (`outDir`, `incremental`, `tsBuildInfoFile`); `scripts/coverage-summary.mjs` (the core run with `CORE_GATE`/`CORE_EXCLUDES` and the workspace loop at the `for (const name of workspaceNames)` block ~lines 72–86 that passes only `SHARED_EXCLUDES` + `dist/__tests__/*.test.js` with no package-local include filter); Node's `--experimental-test-coverage` `--test-coverage-include`/`--test-coverage-exclude` semantics and the `all files` aggregate parser in `coverage-summary.mjs`; the `phase*-baseline.json` shape and the `exitGate.protected`/`exitGate.blocked`/`exitGate.note` fields in `scripts/phase22-baseline.json`; `scripts/release.mjs` (`check`/`gate`/`bump`/`publish`) and the `release:gate` script; `.github/workflows/release.yml` and `security.yml` (skip/protected handling, `PRISM_TEST_POSTGRES_URL` injection, `if:` gates); `biome.json` (schema `2.5.5`, `files.includes` negation, `linter.rules.recommended` boolean, per-rule `off` overrides); `scripts/sweep-unused.mjs`; the `scripts/phase*-freeze.test.mjs` legs and `scripts/phase22-conformance.test.mjs`; `scripts/budgets.json` (root/aggregate/startup/benchmark sections and the dated-`$comment` rebaseline convention); and `docs/release-and-install.md` / `docs/index.md` / `CHANGELOG.md` contributor-facing surfaces.
    - Functional: document what can be fixed with those primitives and approve only the minimum reusable gaps: (a) one build-serialization helper (approved because `tsc` emit is non-atomic and `test`'s `node --test dist/...` races concurrent `build` — the 2026-08-12 review reproduced partial `dist` imports, and Node has no built-in cross-process lock, so a dependency-free `O_EXCL` lock or a stage+atomic-rename is the minimum); (b) one package-local coverage include flag + one thresholds JSON (approved because `coverage-summary.mjs` already runs every workspace and parses the aggregate — adding `--test-coverage-include=dist/**` and a thresholds file is the minimum, no coverage vendor); (c) one release skip manifest reusing the `phase22-baseline.exitGate.protected`/`blocked` shape (approved because the shape already names protected evidence per phase — generalizing it to a release-wide artifact is the minimum, no new framework); (d) Biome config migration + warning/info resolution + machine-readable reports (approved because `biome.json` already drives lint/format and `sweep-unused.mjs` already reports — migrating keys, applying `--write`, and adding `--reporter=json` is the minimum). Reject a generic CI framework, a coverage vendor, an external lock library, a second build orchestration runtime, or a new published package.
    - Functional: decide the build-serialization approach: (Option A) portable `O_EXCL` lockfile with stale-PID detection, bounded retry, fail-closed timeout, and acquisition at the top-level emit/consume boundary (not nested npm children) — chosen or rejected in Task 0; (Option B) stage+atomic-rename (`dist.stage` → `dist`, POSIX dir rename atomic) with `tsc` incremental-cache handling — chosen or rejected in Task 0. Record the chosen approach, the exact acquisition points (or staging points), the re-entrancy/non-nesting rule, and the fail-closed timeout. Record the fallback if the chosen approach proves insufficient under real CI concurrency.
    - Functional: decide the coverage threshold policy: evidence-based thresholds recorded at freeze in `scripts/coverage-thresholds.json` (threshold = recomputed package percentage − margin; margin chosen in Task 0, e.g. 2–5 percentage points or the recompute floor), protected-integration packages (those requiring `PRISM_TEST_POSTGRES_URL` or real NATS) excluded from the threshold and shown separately as protected exceptions, and a fail-closed regression rule (a package below its threshold fails `test:coverage`). Record whether thresholds are per-package or banded (chosen: per-package, mirroring the existing per-workspace rows).
    - Functional: decide the skip manifest semantics: `pass`/`skip`/`blocked`/`protected` states, the required-environment field per surface, the rule that a required protected environment absent at release time records `blocked` (never `pass`/`skip`), and the CI retention path. Record how the manifest cross-references `phase*-baseline.json.exitGate.protected`/`blocked` (chosen: the manifest is the release-level aggregate; per-phase baselines stay the per-phase record and are referenced by the manifest).
    - Functional: decide the Biome migration scope: audit `biome.json` against the 2.x deprecation list, list the exact deprecated keys, migrate to canonical form, apply `biome lint --write`/`format --write` for safe fixes, review the residual 75 warnings + 22 infos, fix or `biome-ignore` each with a recorded justification (intentional `ponytail:` ceilings stay), and choose the machine-readable report form (`biome lint --reporter=json` vs `--max-diagnostics` + parse; `sweep-unused.mjs` JSON output). Record the load-sensitive timing-assertion quarantine strategy (deterministic-barrier replacement vs a documented ceiling suite).
    - Functional: record threat actors, assets, entry points, trust boundaries, and mitigations for at least: concurrent-build partial `dist` import (importer reads half-emitted module → runtime `undefined` export or missing file), build-lock deadlock/stale-lock (a crashed holder blocks all builds forever), build-lock fail-open (lock acquisition error silently proceeds → race returns), coverage denominator inflation/deflation (core `dist` pollutes workspace denominator → false high or false low), coverage threshold false-green (threshold set above true coverage or missing protected exception → silent regression), silent protected skip (missing `PRISM_TEST_POSTGRES_URL` recorded as pass → release ships without durable evidence), unexplained lint diagnostic (a real defect masked by `biome-ignore` → quality gate false-green), and load-sensitive timing false-green/flaky (a `setTimeout`-based assert passes on a fast machine, fails on a loaded CI runner, or masks a race).
    - Functional: map every threat to a concrete test in Tasks 1–4 and record the operational owner, migration decision, rollback posture, package budget, and protected environment for each item.
    - Performance: record baseline build/coverage/lint wall times and proposed changes; stay within the Package and Performance Budget above.
    - Code Quality: reject a generic CI framework, a coverage vendor, an external lock library, a second build runtime, or new interfaces with a single consumer; retain existing script boundaries, the deny-by-default skip posture, and the dependency-free core.
    - Security: explicitly decide that the build lock is fail-closed (acquisition error blocks the build, never proceeds), coverage thresholds fail-closed on regression, skip manifest is fail-closed on missing required env (blocked, not pass), and no fix weakens an existing ownership/redaction/secret-scan control. Record all decisions in the evidence document.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.2.3, mandatory 0.2.x regression matrix items 4 and 12, release validation checklist, release order (security → provider/network → state concurrency → build/test integrity → …).
      - `.agents/skills/create-plan/SKILL.md` primitive-review requirement and `references/prism-wiki.md` documentation requirements.
      - `package.json` (all scripts); `tsconfig.json`; `scripts/coverage-summary.mjs`; `scripts/release.mjs`; `scripts/sweep-unused.mjs`; `scripts/budgets.json`; `scripts/phase22-baseline.json` (exitGate shape); `.github/workflows/release.yml` and `security.yml`; `biome.json`.
      - `docs/release-and-install.md`; `docs/index.md`; `CHANGELOG.md`; `plans/022` Further Actions (the two 0.2.3 routings: machine-auditable skip summary; Biome 75 `useTemplate` warnings + deprecated config migration).
      - Node.js v20.20.2 docs: `--experimental-test-coverage` `--test-coverage-include`/`--test-coverage-exclude` semantics, `fs.openSync(path, 'wx')`/`O_EXCL`, `fs.renameSync` dir-rename atomicity on POSIX, `child_process` exit codes, `AbortSignal` timeout.
      - Biome 2.x docs: deprecated config keys in `2.5.5`, `--reporter=json`, `--write` safety, `biome-ignore` comment form.
      - `plans/020`/`021`/`022` primitive-review/threat-model/exit-gate precedent.
    - Options Considered:
      - Build: portable `O_EXCL` lock (Option A) vs stage+atomic-rename (Option B) vs single-flight in-process only (rejected — does not cover two `npm run build` processes); record tradeoffs in Task 0.
      - Coverage: package-local `--test-coverage-include=dist/**` (chosen direction) vs a separate per-package `c8`/`nyc` config (rejected — adds a coverage vendor) vs removing the workspace summary (rejected — loses the additive report).
      - Skip manifest: generalize `phase22-baseline.exitGate.protected`/`blocked` to a release artifact (chosen) vs per-phase-only (rejected — release-level aggregate missing) vs a new CI dashboard (rejected — no second runtime).
      - Biome: migrate + `--write` + `biome-ignore` residual (chosen) vs disable noisy rules globally (rejected — masks defects) vs pin Biome to an older version (rejected — deprecated config stays).
      - Reuse-first review with one threat table and explicit decisions: chosen.
    - Chosen Approach:
      - Write one tarball-excluded evidence document before freeze or script edits; freeze exact decisions and test names in Task 1–4.
      - Build lock reuses `fs.openSync(path, 'wx')` + `O_EXCL` (or stage+rename if Task 0 chooses B); coverage reuses the existing `coverage-summary.mjs` workspace loop + a thresholds JSON; skip manifest reuses the `phase22-baseline.exitGate` shape; Biome migration reuses the existing `biome.json` + `sweep-unused.mjs`.
    - API Notes and Examples:
      ```bash
      # Build lock wrapper (Option A, chosen-or-rejected in Task 0)
      node scripts/with-build-lock.mjs -- npm run build:core
      # Coverage include filter (workspace loop)
      node --test --experimental-test-coverage \
        --test-coverage-include=dist/** \
        --test-coverage-exclude='**/__tests__/**' --test-coverage-exclude='**/node_modules/**' \
        dist/__tests__/*.test.js
      # Skip manifest
      node scripts/release-skip-manifest.mjs --out scripts/release-evidence.json
      # Machine-readable lint
      biome lint --reporter=json . > scripts/lint-report.json
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase23-primitive-review.md`: primitive inventory, gap decisions, threat model, owner/migration/budget matrix, and test mapping.
      - `plans/023-Release-0-2-3-Build-Coverage-And-Release-Evidence-Integrity.md`: update only if review changes planned approach/files/tests.
    - References:
      - `package.json` scripts; `tsconfig.json`; `scripts/coverage-summary.mjs`; `scripts/release.mjs`; `scripts/sweep-unused.mjs`; `scripts/phase22-baseline.json`; `biome.json`; `.github/workflows/{release,security}.yml`; `plans/022` Further Actions; `roadmap.md` §0.2.3 + matrix items 4/12.
  - Test Cases to Write:
    - primitive inventory: the evidence doc names every primitive in the Acceptance Criteria and rejects a generic CI framework, coverage vendor, external lock library, second build runtime, or new published package.
    - decision freeze: build approach (A or B) with acquisition/staging points; coverage include filter + per-package thresholds + protected exceptions; skip manifest `pass`/`skip`/`blocked`/`protected` semantics; Biome migration scope + machine-readable report form.
    - threat mapping: every named threat maps to a concrete test in Tasks 1–4.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no - Task 0 only produces the tarball-excluded evidence document and freezes decisions; no public API change.
    - Docs pages to create/edit:
      - `docs/_evidence/phase23-primitive-review.md`: primitive inventory, decisions, threat model, owner/migration/budget matrix, test mapping (tarball-excluded).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; evidence-only task.
  - Status: complete (2026-08-14) at HEAD `3126fc2`. Evidence: `docs/_evidence/phase23-primitive-review.md` (tarball-excluded). All §1 primitives were verified against the working tree, not training data — key confirmations: (1) the coverage-denominator pollution mechanism is real (`node_modules/@arnilo/prism -> ../..` self-symlink; workspace tests `import { ... } from "@arnilo/prism"` and Node ESM resolves the symlink to the real `<root>/dist/**` path, which is not under any current exclude); (2) the Biome deprecation is exactly `linter.rules.recommended: true` → `linter.rules.preset: "recommended"` (`npx biome lint biome.json` emits the DEPRECATED notice; `npx biome migrate` auto-rewrites); (3) `--reporter=sarif` is stable for CI retention, `--reporter=json` is experimental (schema-unstable) — sarif chosen; (4) the 75 warnings + 22 infos are dominated by unused-var/import/param (54) + `useTemplate` (20) + `useOptionalChain` (7), mostly `--write`-safe; (5) `tsc` here is non-incremental (no `incremental`/`tsBuildInfoFile` in `tsconfig.json`).
  - Review corrections applied to Tasks 1–4 (do not re-litigate in implementation): Task 1 — the lock must wrap workspace `node --test` leaves too, because workspace tests import root `dist/` via the self-symlink (not just the core `node --test` consumer); acquisition is leaf-level only (never wrap `npm test`/`sdk:ready`/`test:coverage` as a whole) to avoid nested-acquisition deadlock; Option B (symlink-swap atomic publish) is the documented fallback, not primary, because turning `dist` into a symlink touches consumer paths + `package.json` `files` + the install-smoke layout. Task 2 — threshold = recompute − 3 percentage points on `lines` (branches/functions reported, not hard-gated); protected packages (`session-store-postgres`, `enterprise-postgres`, `session-store-nats` real-NATS legs) excluded from the threshold and shown as `protectedException`. Task 3 — `--reporter=sarif` (not `json`) for the lint report; manifest states are `pass`/`skip`/`blocked`/`protected`; `release.mjs gate` fails closed on required-blocked. Task 4 — `biome migrate --write` rewrites the deprecated key; Biome `noUnusedVariables`/`noUnusedImports` fixes do NOT remove public exports (those route to `sweep-unused`); no `biome-ignore` on an unused export.

- [x] Task 1 — Prevent partial live `dist/` imports via build serialization (portable lock or stage+atomic publish)
  - Acceptance Criteria:
    - Functional: add a dependency-free build-serialization helper (`scripts/with-build-lock.mjs` for Option A, or a `scripts/build-stage.mjs` for Option B — chosen in Task 0) that prevents a concurrent `node --test dist/__tests__/*.test.js` from observing a partially-emitted `dist/`. For Option A: acquire an `O_EXCL` lockfile (e.g. `node_modules/.prism-build.lock`) with stale-PID detection (write `pid` + `startedAt` to the lock; if the holder PID is not alive, reclaim), bounded retry (e.g. 100ms backoff up to a fail-closed timeout, default 120s, env-overridable), and a fail-closed exit code on acquisition error or timeout (never proceed without the lock). Wrap `build`, `build:core`, and the `node --test dist/__tests__/*.test.js` run inside `test`/`test:coverage` so concurrent `npm run build` + `npm test`, two `npm run build`, `typecheck` + `test`, and `coverage` + `test` serialize at the top-level emit/consume boundary; do not acquire the lock inside nested npm child processes (re-entrancy/non-nesting rule recorded in Task 0). For Option B: compile core/workspaces into `dist.stage/` and atomically rename to `dist/` (POSIX dir rename); decide `tsBuildInfoFile`/incremental handling in Task 0. `npm run clean` stays standalone and unchanged.
    - Functional: a direct stress regression `scripts/phase23-build-race.test.mjs` reproduces the pre-fix partial-import failure (a concurrent emit + importer observes a missing export or partial module) and passes post-fix (the importer never observes partial `dist`). The stress run covers: concurrent `npm run build` + `npm test`; two concurrent `npm run build`; `typecheck` + `npm test`; `npm run test:coverage` + `npm test`. Stale outputs are detected (a leftover `dist` from a killed build is not silently trusted; `clean` or the lock's reclaim handles it).
    - Performance: non-contended `npm run build` wall time does not regress measurably (lock acquire is O(1), sub-100ms typical); under contention it serializes (intended); no extra round trip on the happy path. No benchmark regression on the 0.1.0 budget.
    - Code Quality: no new runtime dependency; the helper is `scripts/`-only and tarball-excluded; `npm run clean`/`build`/`test`/`test:coverage`/`typecheck`/`sdk:ready` keep their current exit codes on the happy path; the lock is portable (POSIX; Windows not a CI target).
    - Security: the lock is fail-closed (acquisition error or timeout blocks the build, never proceeds — no fail-open); stale-lock reclamation verifies the holder PID is not alive before reclaiming (no cross-process steal of a live lock); no secret written to the lockfile (PID + startedAt only).
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts; `tsconfig.json` (`outDir`/`incremental`/`tsBuildInfoFile`); Task 0 decisions in `docs/_evidence/phase23-primitive-review.md`; Node `fs.openSync(path,'wx')`/`O_EXCL`, `fs.renameSync` dir-rename atomicity, `process.kill(pid,0)` liveness, `AbortSignal.timeout`.
      - 2026-08-12 review evidence (concurrent build/coverage reproduced partial `dist` imports); `plans/022` Further Actions; `roadmap.md` §0.2.3 bullet 1 + matrix item 4.
    - Options Considered:
      - Option A (portable `O_EXCL` lock): simplest, covers all emit/consume commands uniformly, no `tsc` incremental-cache disruption; risk = nesting/deadlock if acquisition points are wrong (mitigated by top-level-only acquisition + fail-closed timeout).
      - Option B (stage+atomic-rename): most robust (importer sees old-or-new complete `dist`, never partial); risk = `tsc` incremental cache points at `dist/`, staging breaks incremental builds unless `outDir` is parameterized (more invasive).
      - In-process single-flight only: rejected — does not cover two separate `npm run build` processes.
      - Chosen: Task 0 records A or B; this task implements the chosen one and documents the other as the fallback.
    - Chosen Approach:
      - Implement the chosen helper; wrap the named scripts; add the stress regression; keep `clean` standalone; record the fail-closed timeout and stale-PID rule.
    - API Notes and Examples:
      ```js
      // scripts/with-build-lock.mjs (Option A sketch)
      import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
      import { kill } from "node:process";
      const LOCK = "node_modules/.prism-build.lock";
      const deadline = AbortSignal.timeout(Number(process.env.PRISM_BUILD_LOCK_TIMEOUT_MS ?? 120_000));
      // O_EXCL acquire + stale-PID reclaim + bounded retry; throw on timeout/abandon
      // then: spawnSync(process.execPath, childArgs, { stdio: "inherit" }); unlinkSync(LOCK) in finally
      ```
    - Files to Create/Edit:
      - `scripts/with-build-lock.mjs` (Option A) or `scripts/build-stage.mjs` (Option B): the serialization helper.
      - `package.json`: wrap `build`/`build:core` (and the `node --test dist/__tests__/*.test.js` segment of `test`/`test:coverage`) with the helper per the Task 0 acquisition-point map; keep `clean` standalone.
      - `scripts/phase23-build-race.test.mjs`: the stress regression (reproduce pre-fix, pass post-fix).
      - `docs/release-and-install.md`: contributor note on the build lock, the env override, and the direct-`tsc` caveat.
    - References:
      - Task 0 evidence; `package.json` scripts; `tsconfig.json`; `roadmap.md` §0.2.3 bullet 1 + matrix item 4; 2026-08-12 review partial-`dist` reproduction.
  - Test Cases to Write:
    - concurrent build+test: an importer run concurrent with `npm run build` never observes a missing export or partial module (assert every expected `dist/__tests__/*.test.js` and a known core export resolves); pre-fix the stress reproduces a failure.
    - two builds: two concurrent `npm run build` complete without corrupting `dist` (no half-written `.js`/`.d.ts` pair).
    - typecheck+test: `typecheck` and `npm test` concurrent do not observe partial `dist`.
    - coverage+test: `test:coverage` and `npm test` concurrent do not observe partial `dist`.
    - stale lock: a lock whose holder PID is dead is reclaimed; a lock whose holder PID is alive is not stolen (the second build waits or times out fail-closed).
    - fail-closed: an acquisition error or timeout exits non-zero and never proceeds to emit/consume.
    - clean unchanged: `npm run clean` still removes `dist`/`packages/*/dist` standalone and is not lock-blocked.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — build-serialization is contributor/CI tooling; no published package export changes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: contributor note on the build lock (or staging), the `PRISM_BUILD_LOCK_TIMEOUT_MS` env override, and the direct-`tsc`-bypass caveat.
    - `docs/index.md` update: no (tooling note lives on the release/install page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-14) at HEAD `3126fc2` (working tree). Evidence: `scripts/with-build-lock.mjs` (Option A `O_EXCL` lock, ~150 lines, stdlib-only), `scripts/phase23-build-race.test.mjs` (8 tests, ~17s), root `package.json` + 43 workspace `package.json` files wrapped, docs note in `docs/release-and-install.md` "## Build serialization". Validation: `npm test` exit 0 with zero failures across the full chain (wrapped build, wrapped core `node --test`, wrapped gate segment, unwrapped `phase23-build-race`, 42 wrapped workspace test leaves), `npm run test:coverage` exit 0 (wrapped core coverage leaf + wrapped `coverage-summary.mjs`), `npm run typecheck` exit 0 (scenario 3), stress 8/8, `build:core` 0.4s non-contended (no regression vs 0.5s baseline), `biome lint` + `format` clean on both new files, docs test 128/128 inside `npm test`.
  - Implementation notes (deviations/extensions are within the frozen decisions, recorded for review):
    1. **Global lock, not cwd-relative**: the lockfile path is derived from the helper's own location (`<root>/node_modules/.prism-build.lock`), so root and workspace leaves contend the SAME lock. A cwd-relative lock would let workspace test leaves (cwd `packages/<name>`) run concurrently with `build:core` — exactly the race the freeze requires serializing (workspace tests import root `dist/` via the `@arnilo/prism` self-symlink).
    2. **Gate segment wrapped**: the `node --test scripts/phase*-conformance|security.test.mjs` run in `test` is wrapped because those gates import `@arnilo/prism` from `dist` (verified: phase10/11/20/21/22) — same dist-consuming-test-leaf class as the frozen map. `scripts/phase23-build-race.test.mjs` runs in its OWN unwrapped `node --test` invocation (it contains the lock's own tests, so it must not run inside a held critical section; its children then acquire the real lock).
    3. **`coverage-summary.mjs` leaves wrapped** (`coverage:summary` + the `test:coverage` tail): it consumes `dist` per package; closes the plan's scenario-4 (coverage + test) race.
    4. **Non-nesting guard**: the helper exports `PRISM_BUILD_LOCK_HELD=1` to its child; a wrapped leaf spawning another wrapped leaf skips acquisition (already inside the critical section) — no nested deadlock possible.
    5. **Residuals (recorded, not fixed — per freeze)**: `tsc -p examples --noEmit` and workspace `typecheck` read `dist` `.d.ts` unwrapped (within any single script, builds complete before reads; only a concurrent EXTERNAL emitter can cause a spurious typecheck error); `pack:dry-run` reads `dist` unwrapped (not a test leaf per freeze); a killed build leaving partial `dist` is healed by the next `npm run build` (`npm test` always builds first) and `clean` remains the manual reset; `clean` string unchanged.
    6. **Stress test scope**: scenarios run the actual wrapped LEAF commands concurrently (the four named orchestrator combos reduce to the same leaves); spawning full `npm test` inside `npm test` would recurse (phase23 lives in the gate chain). The deterministic pre-fix repro is the sensitivity test (a synthetic partial `dist` fails the same consistency check the importer uses) plus the lock-behavior tests.
    7. **CORRECTION (found while implementing Task 2, fixed in Task 1's files)**: `node --test` spawned from within a test-worker process inherits `NODE_TEST_CONTEXT=child-v8`/`NODE_TEST_WORKER_ID`, which makes the nested run skip everything ("recursively within a test file") and exit 0 — so the four scenario importers were initially VACUOUS when the stress test ran under the runner, and `coverage-summary.mjs`'s per-package children were silently empty. Fix: `with-build-lock.mjs`, `coverage-summary.mjs`, and `phase23-build-race.test.mjs` now strip `NODE_TEST_*` from every child env, and each scenario asserts the importer output actually contains a passing test (`importerRan`). The stress scenarios now genuinely exercise the lock; the coverage gate now genuinely runs every package suite.

- [x] Task 2 — Correct workspace coverage denominators with package-local include filters and evidence-based thresholds
  - Acceptance Criteria:
    - Functional: update `scripts/coverage-summary.mjs` (workspace loop at the `for (const name of workspaceNames)` block, ~lines 72–86) to add `--test-coverage-include=dist/**` to each workspace `runCoverage` call so only `packages/<name>/dist/**` counts in the package denominator; the symlinked core `dist` under `packages/<name>/node_modules/@arnilo/prism/dist/**` stays excluded by the existing `**/node_modules/**` exclude. The core run (`CORE_GATE` + `CORE_EXCLUDES`) and the core gate thresholds (60/70/75) are unchanged and remain the only hard core threshold.
    - Functional: introduce `scripts/coverage-thresholds.json` recording one evidence-based threshold per workspace package (lines/branches/functions), captured at freeze from the recomputed package percentages (threshold = recompute − margin; margin decided in Task 0). Protected-integration packages (those requiring `PRISM_TEST_POSTGRES_URL` or a real NATS server) are excluded from the threshold computation and shown separately as protected exceptions in the artifact. `coverage-summary.mjs` fails closed (exit 1) if a non-protected package's recomputed coverage regresses below its threshold; a protected package's missing durable legs are recorded as a protected exception, never a threshold failure.
    - Functional: `coverage-summary.mjs` emits a machine-readable `scripts/coverage-summary.json` artifact recording per-package `lines`/`branches`/`functions`, denominator file count, `threshold`, `pass`/`fail`, and `protectedException` status; the artifact is retained by CI. Known recomputed package percentages (captured at freeze) are reproduced on re-run.
    - Performance: O(1) extra CLI flag per workspace; no extra test run; no measurable regression to `test:coverage` wall time beyond the existing ~70s.
    - Code Quality: no coverage vendor dependency; reuses Node's built-in `--experimental-test-coverage` and the existing `runCoverage`/`format` helpers; the thresholds JSON is tarball-excluded (`scripts/`).
    - Security: a package whose security/persistence branch coverage regresses below threshold fails the gate (cannot silently regress); the denominator excludes core files (no false-high from imported core); redaction/ownership of test fixtures unchanged.
  - Approach:
    - Documentation Reviewed:
      - `scripts/coverage-summary.mjs` (full file); Node `--experimental-test-coverage` `--test-coverage-include`/`--test-coverage-exclude` precedence semantics; `scripts/budgets.json` dated-`$comment` convention; Task 0 decisions; `plans/013` Task 3 (the original additive coverage summary).
    - Options Considered:
      - Package-local `--test-coverage-include=dist/**` (chosen): minimum change, reuses the existing loop, excludes core via the existing node_modules exclude.
      - Per-package `c8`/`nyc` config: rejected — adds a coverage vendor.
      - Remove the workspace summary: rejected — loses the additive report and the regression signal.
      - Thresholds: per-package (chosen, mirrors the per-workspace rows) vs a single band (rejected — hides per-package regression).
    - Chosen Approach:
      - Add the include flag to the workspace run; add the thresholds JSON; add the JSON artifact; fail-closed on non-protected regression; protected exceptions shown separately.
    - API Notes and Examples:
      ```js
      // workspace run with the include filter
      const run = runCoverage(
        ["--test-coverage-include=dist/**",
         ...SHARED_EXCLUDES.map((e) => `--test-coverage-exclude=${e}`),
         "dist/__tests__/*.test.js"],
        join(packagesDir, name),
      );
      // scripts/coverage-thresholds.json
      { "@arnilo/prism-session-store-postgres": { "lines": 88, "branches": 80, "functions": 85, "protectedException": "requires PRISM_TEST_POSTGRES_URL" }, ... }
      ```
    - Files to Create/Edit:
      - `scripts/coverage-summary.mjs`: add the include flag to the workspace run; load `scripts/coverage-thresholds.json`; emit `scripts/coverage-summary.json`; fail-closed on non-protected regression.
      - `scripts/coverage-thresholds.json`: per-package evidence-based thresholds + protected exceptions (captured at freeze).
      - `scripts/coverage-summary.json`: the machine-readable artifact (gitignored or retained; decided in Task 0 — retained by CI).
      - `docs/release-and-install.md`: contributor note on the coverage include filter, thresholds, and protected exceptions.
      - `scripts/phase23-coverage.test.mjs` (or extend an existing gate): assert the workspace run uses the include flag (grep the spawned args), the thresholds JSON is well-formed, and a deliberate regression below threshold fails closed.
    - References:
      - Task 0 evidence; `scripts/coverage-summary.mjs`; `plans/013` Task 3; `roadmap.md` §0.2.3 bullet 2 + matrix item 12.
  - Test Cases to Write:
    - denominator excludes core: a workspace whose tests import core `dist` reports a denominator that does NOT include core files (assert the recomputed percentage matches a package-only recompute, not the 0.2.2 inflated/deflated value).
    - threshold fail-closed: a non-protected package whose recomputed coverage is below its threshold fails `coverage-summary.mjs` (exit 1).
    - protected exception: a protected package missing `PRISM_TEST_POSTGRES_URL` is recorded as a protected exception, not a threshold failure.
    - artifact well-formed: `scripts/coverage-summary.json` contains every workspace row with `lines`/`branches`/`functions`/`threshold`/`pass`/`protectedException`.
    - core gate unchanged: the core gate (60/70/75) is still the only hard core threshold and is unchanged.
    - reproduction: known recomputed package percentages are reproduced on re-run.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — coverage tooling is contributor/CI; no published package export changes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: contributor note on the package-local coverage filter, the thresholds JSON, and the protected-exception separation.
    - `docs/index.md` update: no (tooling note lives on the release/install page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-14) at HEAD `3126fc2` (working tree). Evidence: `scripts/coverage-summary.mjs` (workspace run now passes `--test-coverage-include=dist/**`; core run + 60/70/75 gate untouched), `scripts/coverage-thresholds.json` (42 packages: freeze 2026-08-14, threshold = min(two back-to-back runs, byte-identical max delta 0.000pp) − 3pp on `lines`; branches/functions recorded not gated), `scripts/coverage-summary.json` (machine-readable artifact, gitignored + CI-retained), `scripts/phase23-coverage.test.mjs` (4 tests, wired into `test:coverage` after the real run), docs section in `docs/release-and-install.md` ("Coverage denominators and per-package thresholds"). Validation: `npm run test:coverage` exit 0 (core gate green, 42 workspace rows, 4/4 gate tests), artifact well-formed, real-vs-sabotaged reproduction within 0.1pp.
  - Note (CI remediation 2026-08-14): `@arnilo/prism-coding-security` moved from threshold-gated to `protectedException`. Its native-sandbox legs probe `unshare --net` (NETNS) at module load and skip on GitHub Actions runners (containers cannot create network namespaces), so the host-captured freeze threshold (observed 80.18, threshold 77.18) can never be met in CI — first 0.2.3 CI run failed the gate with 72.80 < 77.18. Reproduced locally by removing `unshare` from PATH (7 tests skip, lines 72.80, byte-identical to CI). The reason names the OS-gated legs; the suite still runs on hosts and in `npm test` where NETNS works. Same class as the `PRISM_TEST_POSTGRES_URL`-protected packages. Second remediation: the fail-closed test's back-to-back reproduction tolerance widened 0.1pp → 0.5pp after CI measured `prism-browser` 83.78 → 83.91 (0.13pp runner noise on the 2-vCPU runner; not reproducible locally or under `--cpus=2` — four consecutive container runs byte-identical at 83.78).
  - Denominator effect (evidence, 0.2.2 polluted → recomputed): `@arnilo/prism-mcp` 45.47 → 90.25, `@arnilo/prism-rag` 19.70 → 94.82, `@arnilo/prism-session-store-nats` 16.04 → 93.69, `@arnilo/prism-memory` 20.37 → 72.00, `@arnilo/prism-enterprise-postgres` 21.93 → 43.26, `@arnilo/prism-session-store-postgres` 17.60 → 22.89. The old percentages were dominated by the symlinked root core dist; the include filter restores package-only denominators.
  - Protected exceptions (4, one beyond the frozen three — recorded): `session-store-postgres`, `enterprise-postgres`, `memory` (added: `postgres-memory.integration.test.js` sits in the workspace coverage glob, same durable-leg class as the frozen list — a missing `PRISM_TEST_POSTGRES_URL` run can never represent its postgres coverage), `session-store-nats` (per freeze; real-jetstream legs are Task 3 surfaces). Providers with `PRISM_LIVE_PROVIDER_TESTS`-gated legs stay gated: their offline conformance tests cover the same mapping code, so the measured offline baseline is a valid regression signal.
  - Fail-open closed during implementation: a coverage run that exited 0 WITHOUT producing the aggregate row (e.g. the `NODE_TEST_*` env leak, see Task 1 Status note 7) previously passed silently with null rows; it now fails the gate. A workspace with no threshold entry is a config error (fail-closed).
  - The threshold file and artifact honor `PRISM_COVERAGE_THRESHOLDS`/`PRISM_COVERAGE_ARTIFACT` overrides so the gate regression can sabotage thresholds without touching the frozen files (documented in docs). New workspace packages must add an evidence-based threshold or protected reason before `test:coverage` passes.

- [x] Task 3 — Make skipped protection visible via a machine-auditable release skip manifest
  - Acceptance Criteria:
    - Functional: add `scripts/release-skip-manifest.mjs` (or extend `scripts/release.mjs gate`) that aggregates every test surface — core `npm test`, each workspace suite, `test:postgres`, `test:nats` (fake-jetstream seam vs real), `security:threat-suites`, and the live canaries (OIDC/OPA, S3, MCP-AS, NATS JetStream) — and emits `scripts/release-evidence.json` recording per-surface `state` (`pass`/`skip`/`blocked`/`protected`), `reason`, `requiredEnv` (e.g. `PRISM_TEST_POSTGRES_URL`, `PRISM_TEST_NATS_URL`), and `protected`/`live` classification. A clean release report accounts for all tests including the current 33 protected/live skips; a required release profile cannot convert missing credentials/services into green (absent `PRISM_TEST_POSTGRES_URL` records the durable legs `blocked`, not `pass`/`skip`).
    - Functional: the manifest cross-references the existing `phase*-baseline.json.exitGate.protected`/`blocked` shape (the manifest is the release-level aggregate; per-phase baselines stay the per-phase record). The manifest is retained by CI as a release artifact (path decided in Task 0, e.g. uploaded from the release workflow). Full live-service expansion stays 0.3.0 — the manifest names the live canaries as `protected`/`blocked` (absent), never as `pass`.
    - Functional: `release.mjs gate` (or a new `release:evidence` script) consumes the manifest and fails closed if a required protected surface is `blocked` at release time (a release cannot ship with a required env absent and unexplained); a documented protected skip (with reason + required env) is permitted and visible, an unexplained skip is not.
    - Performance: one aggregation pass over existing test surfaces; no extra test run; O(suites) JSON emit; no measurable regression to `sdk:ready`/`release:gate` wall time.
    - Code Quality: no new framework; reuses the `phase22-baseline.exitGate` JSON shape; the manifest is `scripts/`-only and tarball-excluded; stdlib JSON only.
    - Security: a missing required protected environment is `blocked` release evidence, never a green skip; the manifest names every skipped live/protected suite so an operator cannot ship without seeing the gap; no secret in the manifest (env var names only, never values).
  - Approach:
    - Documentation Reviewed:
      - `scripts/phase22-baseline.json` (`exitGate.protected`/`blocked`/`note`); `scripts/release.mjs` (`gate`); `.github/workflows/release.yml` (skip/protected handling, `PRISM_TEST_POSTGRES_URL` injection, `if:` gates); Task 0 decisions; `plans/022` Further Actions (the machine-auditable skip-summary routing).
    - Options Considered:
      - Generalize `phase22-baseline.exitGate.protected`/`blocked` to a release artifact (chosen): reuses the existing shape, release-level aggregate.
      - Per-phase-only (no release aggregate): rejected — a release spans phases; the release-level view is missing.
      - A new CI dashboard/second runtime: rejected — no second runtime, no hosted product.
      - Extend `release.mjs gate` vs a standalone `release-skip-manifest.mjs`: Task 0 decides (chosen direction: standalone emitter + `release.mjs gate` consumer, mirroring the `coverage-summary.mjs` + gate split).
    - Chosen Approach:
      - Add the manifest emitter; have `release.mjs gate` consume it; fail-closed on unexplained or required-blocked; retain the artifact in CI.
    - API Notes and Examples:
      ```json
      // scripts/release-evidence.json (sketch)
      { "release": "0.2.3", "surfaces": [
        { "name": "core npm test", "state": "pass", "count": 3480, "skip": 33 },
        { "name": "test:postgres durable conformance", "state": "blocked", "reason": "PRISM_TEST_POSTGRES_URL not set", "requiredEnv": "PRISM_TEST_POSTGRES_URL", "protected": true },
        { "name": "live OIDC/OPA canary", "state": "protected", "reason": "inherited from phase21; CI re-runs", "protected": true }
      ], "blocked": true }
      ```
    - Files to Create/Edit:
      - `scripts/release-skip-manifest.mjs`: the emitter (aggregates surfaces, classifies states, writes `scripts/release-evidence.json`).
      - `scripts/release.mjs`: `gate` consumes the manifest and fails closed on required-blocked/unexplained-skip.
      - `package.json`: add `release:evidence` script (if standalone) and wire the manifest emit into `sdk:ready`/`release:gate`.
      - `.github/workflows/release.yml`: emit and retain `scripts/release-evidence.json` as a release artifact.
      - `docs/release-and-install.md`: the protected-evidence procedure and the blocked-vs-skip semantics.
      - `scripts/phase23-skip-manifest.test.mjs`: assert the manifest classifies a missing required env as `blocked` (not `pass`/`skip`), names every protected surface, and `release.mjs gate` fails closed on a required-blocked surface.
    - References:
      - Task 0 evidence; `scripts/phase22-baseline.json`; `scripts/release.mjs`; `.github/workflows/release.yml`; `plans/022` Further Actions; `roadmap.md` §0.2.3 bullet 3 + matrix item 12.
  - Test Cases to Write:
    - blocked-not-skip: with `PRISM_TEST_POSTGRES_URL` absent, the manifest records the durable legs `blocked` (never `pass`/`skip`); `release.mjs gate` fails closed.
    - protected-named: every current protected/live skip (the 33) appears in the manifest with a reason and required env.
    - live-canary-not-pass: the live OIDC/OPA/S3/MCP-AS/NATS canaries are `protected`/`blocked` (absent), never `pass` (full live matrix is 0.3.0).
    - unexplained-skip-rejected: a surface with `state: skip` and no reason/required env fails the gate.
    - cross-reference: the manifest references the `phase*-baseline.json.exitGate.protected` evidence for inherited protected surfaces.
    - no-secret: the manifest contains env var names only, never values (grep the artifact for known secret patterns → zero).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release-evidence tooling is contributor/CI; no published package export changes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: the protected-evidence procedure, the skip manifest format, and the blocked-vs-skip-vs-pass semantics.
    - `docs/index.md` update: no (tooling note lives on the release/install page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-14) at HEAD `3126fc2` (working tree). Evidence: `scripts/release-skip-manifest.mjs` (emitter, stdlib-only, 58 surfaces: core npm test + threat suites + 42 workspace suites from the same-run coverage artifact + postgres durable (required) + nats real legs + 8 provider live-leg classes (source-scanned) + 4 live canaries; cross-references the latest `phase*-baseline.json` `exitGate.counts`/`exitGate.protected`/`protectedEvidence`), `checkReleaseEvidence` exported from `scripts/release.mjs` and called before `runGates` (fails closed on any `blocked` row or unexplained `skip`; unreadable/missing manifest is a gate error), `package.json` (`release:evidence` script; `release:gate` chains the emitter), `.github/workflows/release.yml` (verify job declares `PRISM_TEST_POSTGRES_URL` profile + retains `scripts/release-evidence.json` as the `release-evidence` artifact, `if: always()`), `.gitignore`, docs section ("Release evidence and protected skips"), `scripts/phase23-skip-manifest.test.mjs` (6 tests, wired into the `test:coverage` chain after the real artifact is produced). Validation: 6/6 tests; no-env `npm run release:gate` fails closed in 0.16s naming the postgres surface; with the env declared the gate proceeds into `runGates` and exits 0; manifest `blocked=false` only with the env; no-secret proven by grepping a manifest emitted with a real-looking URL (name-only).
  - Deviation (canary names): the plan text named the live canaries OIDC/OPA, S3, MCP-AS, NATS JetStream (roadmap wording); the implemented `scripts/live-canary.mjs` runs provider / MCP / A2A / web (Brave) — the manifest names the four implemented canaries from the workflow, each with `source` citing `live-canaries.yml` + the baseline it inherits evidence from.
  - Deviation (canary state): canaries are recorded `protected` always (documented scheduled-CI gap with reason + inherited-evidence source), never `blocked`, never `pass` — `blocked` is reserved for required release surfaces so the gate stays runnable while the 0.3.0 live matrix expands. The plan's "protected/blocked (absent)" reading resolves to protected-with-reason.
  - Deviation (skip attribution): `node --test` does not emit per-test skip names machine-readably, so the manifest names every skip CLASS (8 provider live-leg rows + nats real legs + postgres durable) with reason + requiredEnv, and the core row carries the aggregate skip count from the latest baseline — the frozen floor of 33 is asserted by the regression (`core.skip >= 33`) so skips can never silently vanish.
  - Deviation (test:nats): no suite references `PRISM_TEST_NATS_URL` yet (grep-verified while implementing); the surface is named as a protected gap with the intended env documented in the reason, matching the Task 2 session-store-nats protectedException.
  - Note (required profile): the only env-required surface is `test:postgres durable conformance`; the verify job's `PRISM_TEST_POSTGRES_URL` is a declared-profile marker (the emitter checks presence only, never the value — no-secret), and the `postgres-integration` job remains the actual enforcement. The marker is scoped to the `release:gate` phase only (CI remediation after the first 0.2.3 run: job-level env leaked into `npm test`, where the credential-gated docs demo `workflow-postgres-resume.ts` and the durable integration suites treat env presence as opt-in and failed with ECONNREFUSED against the serverless verify job; env-free test phases restore the 0.2.2 behavior). Consequence: local `sdk:ready`/`release:gate` now fail closed without the env (intended; matches the phase-22 release profile command `PRISM_TEST_POSTGRES_URL=... npm run sdk:ready`).
  - Note (test placement): `phase23-skip-manifest.test.mjs` runs in the `test:coverage` chain (after the real coverage artifact exists), not the `npm test` gate list — its workspace rows read `scripts/coverage-summary.json`.
  - Note (no-suite packages): the 7 packages without test suites (prism-all, prism-base, prism-code, prism-compaction, prism-providers, prism-sdk, session-store-codecs) are not test surfaces and get no manifest row.

- [x] Task 4 — Stabilize quality gates (Biome migration, warning/info resolution, timing-assertion quarantine, machine-readable reports)
  - Acceptance Criteria:
    - Functional: migrate `biome.json` deprecated configuration keys to the 2.x canonical form (exact deprecated keys audited and listed in Task 0 — candidates: `files.includes` negation syntax, `linter.rules.recommended` boolean vs object form, `files.ignoreUnknown` placement, per-rule severity form). The migrated config applies the same rules; `biome lint`/`format` behavior is unchanged on the happy path.
    - Functional: resolve the 75 warnings + 22 infos — apply safe fixes via `biome lint --write`/`format --write`, review the residual, and fix or mark each with a justified `biome-ignore` comment (intentional `ponytail:` ceilings stay). Zero unexplained lint diagnostics remain; `biome lint .` exits 0 (or exits with only documented-and-ignored diagnostics).
    - Functional: quarantine or replace load-sensitive timing assertions: grep `setTimeout(` + `performance.now()` + `Date.now()`-delta asserts in `**/__tests__/**` and `scripts/*.test.mjs`; replace each with a deterministic barrier (await the conflicting op, then assert) or move it to a documented quarantine suite with a named ceiling and a `ponytail:` comment. No new timing-only sleeps introduced anywhere.
    - Functional: make lint, format, and unused-export reports machine-readable: `biome lint --reporter=json` (or `--max-diagnostics=N` + parse) emits `scripts/lint-report.json`; `scripts/sweep-unused.mjs` emits a JSON report (`scripts/unused-report.json`); the artifacts are retained by CI. `npm run lint`/`format:check`/`sweep:unused` exit codes are unchanged on the happy path.
    - Performance: `biome lint`/`format` wall time unchanged; the JSON reports are one extra flag (no extra run); no benchmark regression.
    - Code Quality: no Biome plugin package; no rule disabled globally to mask a defect (each `biome-ignore` is justified and reviewed); the quarantine suite is documented with a ceiling; the reports are `scripts/`-only and tarball-excluded.
    - Security: no real defect masked by `biome-ignore` (each ignore is reviewed and recorded in Task 0/4); no timing-assertion false-green masks a race; the machine-readable reports are retained for audit.
  - Approach:
    - Documentation Reviewed:
      - `biome.json` (schema `2.5.5`, current keys); Biome 2.x deprecation list and `--reporter=json`/`--write`/`biome-ignore` docs; `scripts/sweep-unused.mjs`; the 75 warnings + 22 infos (re-run `biome lint . --max-diagnostics=200` to enumerate); Task 0 decisions; `plans/022` Further Actions (the 75 FIXABLE `useTemplate` warnings + deprecated config migration routing).
    - Options Considered:
      - Migrate + `--write` + `biome-ignore` residual (chosen): fixes safe diagnostics, reviews the rest, preserves intentional ceilings.
      - Disable noisy rules globally: rejected — masks defects.
      - Pin Biome to an older version: rejected — deprecated config stays, upstream fixes lost.
      - Timing asserts: deterministic-barrier replacement (chosen for racy asserts) vs quarantine suite (chosen for genuinely load-sensitive asserts with a documented ceiling).
      - Machine-readable: `biome lint --reporter=json` (chosen) vs `--max-diagnostics` + custom parse (fallback if `--reporter=json` is unstable); `sweep-unused.mjs` JSON output (chosen, additive).
    - Chosen Approach:
      - Audit and migrate `biome.json`; apply `--write`; review and fix/ignore the residual; replace or quarantine timing asserts; add JSON report outputs; retain artifacts in CI.
    - API Notes and Examples:
      ```bash
      biome lint --write .          # safe fixes
      biome lint --reporter=json . > scripts/lint-report.json
      node scripts/sweep-unused.mjs --json > scripts/unused-report.json
      # biome-ignore comment form (justified)
      // biome-ignore lint/style/useTemplate: ponytail: intentional concatenation, ceiling < N sites
      ```
    - Files to Create/Edit:
      - `biome.json`: migrate deprecated keys to 2.x canonical form.
      - Source files touched by `biome lint --write`/`format --write` (whitespace + safe fixes; recorded in the task status).
      - Source files with residual warnings/infos: fix or add a justified `biome-ignore` comment.
      - `**/__tests__/**` and `scripts/*.test.mjs` timing asserts: replace with deterministic barriers or move to a quarantine suite.
      - `scripts/sweep-unused.mjs`: add `--json` output.
      - `scripts/lint-report.json`, `scripts/unused-report.json`: machine-readable artifacts (retained by CI).
      - `package.json`: wire `lint:report`/`unused:report` scripts (if added) and artifact retention in CI.
      - `.github/workflows/release.yml` or `security.yml`: retain the JSON reports.
      - `docs/release-and-install.md`: contributor note on the Biome migration, the quarantine suite, and the machine-readable reports.
    - References:
      - Task 0 evidence; `biome.json`; `scripts/sweep-unused.mjs`; `plans/022` Further Actions; `roadmap.md` §0.2.3 bullet 4.
  - Test Cases to Write:
    - lint clean: `biome lint .` exits 0 (or only documented-and-ignored diagnostics); zero unexplained warnings/infos.
    - config migrated: `biome.json` has no deprecated keys (assert against the 2.x deprecation list); `biome lint`/`format` behavior unchanged on a fixture.
    - timing-assert quarantine: no `setTimeout(`-based race assert remains in the default suites (grep → zero in the replaced set; quarantined asserts carry a `ponytail:` ceiling comment).
    - machine-readable reports: `scripts/lint-report.json` and `scripts/unused-report.json` are well-formed JSON and retained by CI.
    - safe-fix review: every `biome-ignore` has a recorded justification (grep `biome-ignore` → each has a `: reason` suffix).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — quality-gate tooling is contributor/CI; no published package export changes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: contributor note on the Biome config migration, the timing-assertion quarantine suite and its ceiling, and the machine-readable lint/format/unused reports.
    - `docs/index.md` update: no (tooling note lives on the release/install page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-14) at HEAD `3126fc2` (working tree). Evidence: `npx biome migrate --write` rewrote `linter.rules.recommended` into `linter.rules.preset: "recommended"` (DEPRECATED diagnostic gone, per-rule overrides untouched); 97 diagnostics (75 warnings + 22 infos + 1 config deserialize) reduced to zero — `biome lint --write --unsafe .` fixed 90 across 108 files (396+/226−, diff-reviewed: useOptionalChain `!a || !a.b` → `!a?.b` and noConfusingVoidType `| void` → `| undefined` are semantically equivalent, unused imports/types removed, useExportType applied); the ~10 remaining unused declarations were side-effecting so Biome's unsafe fix only `_`-renamed them — each reviewed and the dead line removed by hand (side-effecting calls kept, e.g. the e2e-enterprise `dispatchToolCall` binding dropped, call preserved); 5 justified `biome-ignore` comments (shell-interpolated string in docker-sandbox, verbatim upstream fixture in ponytail-runtime.js, three literal grep targets in phase17-freeze and docs.test). Timing quarantine: 1 replaced (bridge.test.ts 150ms elapsed bound → deterministic error-proof + test-level `{ timeout: 5_000 }`), 3 kept with named `ponytail:` ceilings (repository 5s anti-block guard, native-sandbox widened 2s→5s promptness guard, credentials-node 1s anti-hang), 1 kept as the sanctioned `scripts/budgets.json` mechanism (document-reader budget test). Machine-readable reports: `npm run lint` now writes `scripts/lint-report.sarif` via stable `--reporter=sarif --reporter-file` in the same run; `sweep-unused.mjs` gained `--json` → `scripts/unused-report.json` (asserted by `sweep-unused.test.mjs`); both gitignored and CI-retained (`quality-gate-reports` artifact in release.yml verify job). Regression `scripts/phase23-quality-gates.test.mjs` (5 tests) wired into the npm test gate segment. Docs: "Quality-gate reports and the Biome baseline" section. Validation: `biome lint .` exit 0, `biome format .` exit 0, npm test 3493/3460 pass/33 skip/0 fail (includes quality-gates 5/5 + build-race 8/8), `npm run test:coverage` exit 0 (phase23-coverage 4/4 + skip-manifest 6/6), typecheck exit 0, docs 128/128.
  - Deviation (unsafe fixes): the plan text says `biome lint --write` safe fixes; in Biome 2.5.5 only 6 of 90 were safe-fixable — unused-code, useTemplate, and useOptionalChain require `--unsafe`. The full unsafe diff was reviewed (semantics-equivalent transformations only) before acceptance.
  - Deviation (rename-not-remove): Biome's noUnusedVariables unsafe fix renames side-effecting unused declarations to an underscore prefix instead of removing them; Task 4 manually removed all 10 such declarations (they were dead code) — no `_`-prefixed dead code remains.
  - Deviation (reports): the plan text names `--reporter=json`; Task 0's freeze (sarif, schema-stable) stands. `format:check` stays exit-code-only — a formatter has no diagnostics, so no format report artifact; the machine-readable pair is lint SARIF + unused JSON.
  - Deviation (quarantine suite): no non-essential load-sensitive assert was found, so the planned quarantine suite file was not created — the only racy assert was replaced (barrier), and the three genuinely load-sensitive guards are anti-hang/proof-of-promptness ceilings kept in the default suites with named `ponytail:` comments; the document-reader budget assert is the pre-existing sanctioned `budgets.json` mechanism.
  - Note (self-check): `scripts/phase23-quality-gates.test.mjs` asserts lint exit 0 + empty SARIF results, migrated config shape, no DEPRECATED on the config, the replaced/quarantined timing-assert state, `biome-ignore` justification suffix on every comment, and CI retention of both reports.

- [x] Task 5 — Security regression, built public-import, and packed-JavaScript conformance (matrix items 4 and 12)
  - Acceptance Criteria:
    - Functional: add direct adversarial tests for the two 0.2.3 blockers (partial-`dist` race, coverage denominator) and a packed plain-JavaScript consumer test so TypeScript types cannot hide runtime validation gaps; wire a `scripts/phase23-security.test.mjs` leg into `security:threat-suites`.
    - Functional: the suite asserts mandatory 0.2.x regression matrix items 4 (concurrent emit builds plus an importer never observe partial `dist`) and 12 (workspace coverage excludes imported core files and records protected skips) explicitly by name.
    - Functional: the built package entrypoints behave identically to source for the build-race and coverage-denominator assertions; packed plain-JS imports after a local tarball install pass the same assertions with no TS compiler (the build-race assertion runs against the installed `dist`; the coverage-denominator assertion re-runs `coverage-summary.mjs` against the installed workspace layout).
    - Performance: the security/conformance leg adds no measurable benchmark regression; budget gates green.
    - Code Quality: typecheck, Biome lint/format (post-Task-4), unused sweep, docs semantic tests, public export tests pass; the leg cannot be skipped (missing protected env records blocked, not green).
    - Security: the adversarial tests prove the fixes are runtime-enforced, not type-only; the coverage denominator cannot inflate a package's security/persistence branch coverage; a partial-`dist` import cannot ship a missing security export.
  - Approach:
    - Documentation Reviewed:
      - `plans/020`/`021`/`022` security-regression precedent; `src/__tests__/install-smoke.test.ts`; `.github/workflows/{release,security}.yml`; Task 0–4.
    - Options Considered:
      - Type-only fixtures: rejected; the original gaps are runtime/tooling-only.
      - A new standalone pack harness: rejected; reuse the existing install-smoke lifecycle.
      - Extend the existing packed consumer + one focused built conformance suite: chosen.
    - Chosen Approach:
      - Test source-level details in Tasks 1–2, public built entrypoints here, and all packed exports in the existing install-smoke lifecycle; wire `phase23-security.test.mjs` into `security:threat-suites`.
    - API Notes and Examples:
      ```bash
      npm run build
      node --test scripts/phase23-security.test.mjs
      npm run security:threat-suites
      node --test dist/__tests__/install-smoke.test.js
      ```
    - Files to Create/Edit:
      - `scripts/phase23-security.test.mjs`: focused public-entry build-race + coverage-denominator conformance + matrix items 4 and 12 by name.
      - `src/__tests__/install-smoke.test.ts`: packed plain-JavaScript regression for the two blockers inside the existing consumer.
      - `package.json`: append `scripts/phase23-security.test.mjs` to `security:threat-suites`.
      - `scripts/phase23-baseline.json`: reserve final evidence fields; values recorded only in Task 6.
    - References:
      - Mandatory regression matrix items 4 and 12 in `roadmap.md`; `src/__tests__/install-smoke.test.ts`; `plans/022` Task 5.
  - Test Cases to Write:
    - built build-race (matrix item 4 by name): a concurrent emit + importer against the built `dist` never observes a missing export or partial module.
    - built coverage denominator (matrix item 12 by name): a workspace run with the include filter excludes imported core `dist` and records protected skips.
    - packed plain JS: same two assertions after a local tarball install with no TS compiler.
    - gate accounting: phase-23 tests cannot be skipped and name matrix items 4 and 12.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior — executable verification of Tasks 1–2.
    - Docs pages to create/edit:
      - `none`: public behavior docs belong to Tasks 1–2; release evidence is recorded in Task 6.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; verification-only task.
  - Status: complete (2026-08-14) at HEAD `3126fc2` (working tree). Evidence: `scripts/phase23-security.test.mjs` (3 tests, wired as the phase23 leg of `security:threat-suites`): T1 [matrix item 4, by name] spawns a wrapped `npm run build:core` emit concurrent with the wrapped public-entry importer (`scripts/fixtures/phase23-public-entry.test.mjs` — imports every exports-map specifier through the `@arnilo/prism` self-link, asserts the frozen export surface + manifest version) for two rounds; T2 [matrix item 12, by name] asserts the coverage denominator from the same-run artifact (`mcp lines >= 80` vs the polluted 45.47, `session-store-postgres` recorded `protectedException` with lines < 40, `belowThreshold == []`, >= 3 protected classes named), spawning a full permissive-threshold coverage run only when the artifact is absent (self-contained standalone); gate accounting asserts both blocker IDs ran. `src/__tests__/install-smoke.test.ts` gained the packed plain-JS `security23.mjs` journey (no TS compiler): matrix item 4 against the INSTALLED tarballs (exports-map surface + frozen exports + version) and matrix item 12 as single-shared-core + no-`dist/__tests__`-artifacts walk of the installed `@arnilo` tree, asserted by a new `it()`; the canary-leak check covers `security23Out`. `scripts/phase23-baseline.json` reserved with the 0.2.2 counts carried forward (`green: false`, `blocked: true`, note 'values recorded in Task 6') so the Task 3 skip manifest keeps resolving its latest baseline. Validation: `npm run security:threat-suites` exit 0 (50/50 incl. phase23 3/3), install-smoke 10/10 standalone and after rebuild, typecheck 0, biome lint/format 0, Task 3 suite 6/6 against the reserved baseline.
  - Deviation (packed matrix item 12): `coverage-summary.mjs` cannot run inside the packed consumer — tarballs exclude tests and `scripts/`, so the installed layout has no coverage surface (which is itself the point: no `dist/__tests__` can enter a denominator). The packed item-12 assertions are therefore the single-shared-core copy + no-test-artifact walk, and the source-level T2 carries the runtime denominator proof.
  - Deviation (reserved baseline): the plan says 'reserve final evidence fields; values recorded only in Task 6' — the reservation carries the 0.2.2 `exitGate.counts` forward (marked `release: 0.2.3-reserved`, `green: false`, `blocked: true`) because the release skip manifest reads the LATEST `phase*-baseline.json` and an empty reservation would record the core row `blocked`.
  - Note (T1 emit leaf): the concurrent emit uses `npm run build:core` (not a bare `tsc` spawn) so `node_modules/.bin` resolves on PATH — the same precedent as `phase23-build-race.test.mjs`.
  - Note (NODE_TEST strip): all phase23-security spawns strip `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` (Task 2 discovery) so nested `node --test` runs are never vacuous.

- [x] Task 6 — Docs finalization, 0.2.3 bump, and fail-loud exit gate
  - Acceptance Criteria:
    - Functional: add a `docs/release-and-install.md` contributor section for 0.2.2 → 0.2.3 covering the build serialization (lock or staging, env override, direct-`tsc` caveat), the coverage include filter + per-package thresholds + protected exceptions, the release skip manifest (blocked-vs-skip-vs-pass semantics), and the Biome config migration + timing-assertion quarantine + machine-readable reports — with before/after behavior, plain-JavaScript examples, and rollback-risk warning. No `docs/migration.md` runtime section (no runtime contract delta).
    - Functional: update root and affected package changelogs/READMEs, `docs/index.md`, `docs/release-and-install.md`, and roadmap 0.2.3 checkboxes only after Tasks 0–5 pass. Documentation must not claim a live-service matrix, a coverage vendor, an external lock library, a generic CI framework, or any 0.3.x capability.
    - Functional: run `node scripts/release.mjs bump --from 0.2.2 --to 0.2.3` across all 50 manifests/lockfile and update version-sensitive tests, exact internal peer pins, tarball names, and release docs.
    - Functional: run a plain pre-refresh compatibility gate and review every delta. The only expected deltas are the version literal and any additive `scripts/`-only artifacts (no published export change is planned). Any unexpected breaking declaration halts release and requires a recorded plan/manifest amendment before `--allow-break`. Refresh affected baselines only after review, then require the normal gate green.
    - Functional: run focused tests, `npm run security:threat-suites`, protected Postgres matrix (where `PRISM_TEST_POSTGRES_URL` is present; else blocked per Task 3 manifest), `npm run sdk:ready`, full audit, tracked/unpacked secret scans, pack dry-run twice byte-identical, budget/benchmark gates, Node 20 packed imports, and the release gate. No build/coverage/release-evidence item may be skipped silently; missing protected environment records 0.2.3 as blocked in the skip manifest.
    - Functional: record command, version, platform, counts, hashes, skips/blocks, compatibility deltas, package/dependency graph, protected evidence, and `green` in `scripts/phase23-baseline.json.exitGate`; the phase-23 freeze done-state passes.
    - Performance: root and affected package sizes remain in budget; build/coverage/quality-gate changes add no measurable benchmark regression.
    - Code Quality: typecheck, Biome lint/format (post-Task-4), unused sweep review, docs semantic tests, public export tests, and diff checks pass; plan checkboxes, files, tests, compromises, and further actions reflect actual implementation.
    - Security: audit reports zero policy violations; secret scans report zero findings; packed JS and threat suites pass; protected evidence is present or blocked-visible (never an unexplained green skip); signed tag/provenance remain operator-gated after clean protected CI.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`; `docs/index.md`; root/package changelogs; `roadmap.md` release validation checklist and 0.2.3 regressions (matrix items 4 and 12); `plans/022` Task 6 compatibility review and exit-gate pattern; `.github/workflows/{release,security}.yml`.
    - Options Considered:
      - Release after unit tests with protected evidence optional: rejected; build/coverage/release-evidence items are release blockers and cannot close on an unexplained skip.
      - Skip the additive `scripts/`-only baseline refresh: rejected; even `scripts/`-only artifacts need a reviewed compat-baseline refresh if they touch the frozen root surface.
      - Scripted bump, reviewed normal compatibility gate, complete protected evidence, operator publication: chosen.
    - Chosen Approach:
      - Finalize contributor docs first, bump once, review declarations, run all gates, record immutable evidence, then hand off signed tag/publication.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.2.2 --to 0.2.3
      npm run security:threat-suites
      npm run sdk:ready
      npm audit --audit-level=moderate
      git ls-files -z | xargs -0 node scripts/scan-secrets.mjs
      node scripts/release-skip-manifest.mjs --out scripts/release-evidence.json
      node scripts/release.mjs gate --version 0.2.3
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`: 0.2.3 contributor section (build/coverage/skip-manifest/Biome).
      - `docs/index.md`: current release and final navigation verification.
      - `CHANGELOG.md`: 0.2.3 build/coverage/release-evidence/quality-gate release.
      - Affected package READMEs/CHANGELOGs (only if a workspace's coverage threshold or test surface changed): shipped behavior.
      - `package.json`, all workspace manifests, `package-lock.json`: scripted 0.2.3 bump.
      - `src/index.ts` version const, release/install/packaging/docs/public-export tests, package pin tests: version-sensitive updates (if any).
      - `scripts/compat-baseline/*`: reviewed additive/version baseline refresh only.
      - `scripts/phase23-baseline.json`: complete exit evidence.
      - `scripts/phase23-freeze-manifest.json`: final task/evidence tokens; deviations only if actually required.
      - `roadmap.md`: mark the four 0.2.3 items complete after all gates pass.
      - `plans/023-...md`: close tasks and fill actual compromises/further actions.
      - `plans/README.md`: status complete only after exit gate.
    - References:
      - `plans/022-Release-0-2-2-Concurrent-State-and-Durability-Integrity.md` Task 6; `plans/021` Task 8; `plans/020` Task 6.
  - Test Cases to Write:
    - contributor-doc semantic tripwire: `docs/release-and-install.md` contains build-serialization, coverage-threshold, skip-manifest, and Biome-migration sections.
    - compatibility sequence: plain pre-refresh delta reviewed; plain post-refresh gate green; unexpected removal blocks.
    - release accounting: all tests/skips/protected environments named in the skip manifest; any missing phase-23 item evidence makes `green: false`.
    - package truth: 50 manifests, versions/peers/lockfile consistent, zero new dependency names, deterministic tarballs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — publishes contributor/release truth for build/coverage/release-evidence/quality-gate tooling; no runtime contract change.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: 0.2.3 contributor section.
      - `CHANGELOG.md` and affected package changelogs: shipped behavior.
      - Task 1–4 docs: final semantic verification and corrections only.
    - `docs/index.md` update: yes — current release line 0.2.3 plus final Release and install navigation verification.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-14) at HEAD `3126fc2` (0.2.2 release state) with the 0.2.3 working tree (all Task 1-6 changes uncommitted, as recorded in `scripts/phase23-freeze-manifest.json` and `scripts/phase23-baseline.json`). Evidence:
    - Docs: `docs/release-and-install.md` gains `### 0.2.3 publish handoff (plan 023 Task 6)` (before/after, plain-JS command block, rollback notes, protected-evidence paragraph) above the 0.2.2 handoff, plus the already-landed tooling sections (`## Build serialization`, `### Coverage denominators and per-package thresholds`, `### Release evidence and protected skips`, `### Quality-gate reports and the Biome baseline`); `docs/migration.md` gains the `0.2.2 → 0.2.3` no-migration stub (required by the compat gate's version-note rule; documents zero runtime contract delta and store-safe rollback); `docs/index.md` current-line entry advanced to `current **0.2.3**` with the 0.2.3 narrative; `CHANGELOG.md` gains the `[0.2.3] - 2026-08-14` entry; `roadmap.md` all four 0.2.3 items `[x]`; `src/__tests__/docs.test.ts` gains the plan-023 Task 6 freeze tripwire (0.2.3 handoff + rollback + four tooling sections + index current line + changelog + roadmap 0.2.3 section fully checked) and its current-line/version asserts advance to 0.2.3.
    - Bump: `node scripts/release.mjs bump --from 0.2.2 --to 0.2.3` across all 50 manifests + `npm install --package-lock-only` (lockfile 51 × 0.2.3, 0 × 0.2.2); version-sensitive updates: `src/index.ts` version const, `src/__tests__/{index,release,cli-provider-add,packaging,install-smoke,docs}.test.ts` literal pins (incl. the `arnilo-prism-0.2.3.tgz` tarball name), and the workspace provider/compaction/ponytail/caveman suite pins (`packages/provider-neuralwatt` meta-bundle asserts).
    - Compat: plain pre-refresh gate at 0.2.3 reviewed — the ONLY delta was `changed: version` on `@arnilo/prism`. The Task 4 `useExportType` fix had changed the ag-ui `acp/index.ts` type re-export statements to `export type` form, which the compat-surface parser keys as `type Name` and read as 6 removals; those statements were restored to the frozen value-style shape with `biome-ignore` + justification (deviation recorded), keeping the 0.2.3 delta to the version literal alone. `docs/migration.md` stub satisfies the gate's version note; `--update-baseline` applied; plain gate green after refresh; **no `--allow-break`**.
    - Gates (all fresh, 0.2.3 working tree): `npm test` exit 0 — **3495 tests / 3462 pass / 33 protected-live skips / 0 fail** (core 1508, script gates 260, workspaces 1727; the 33-skip floor frozen by the Task 3 regression); `npm run test:coverage` exit 0 (core 90.49/84.16/90.54 vs the 60/70/75 gate, 42 workspace suites + core, `belowThreshold: []`); `npm run security:threat-suites` 50/50 (incl. phase23-security 3/3); `PRISM_TEST_POSTGRES_URL=... npm run test:postgres` **91/91** (dockerized postgres:16-alpine on 127.0.0.1:54329, `prism_phase22_*` + `prism_phase23_*` schemas); `npm run sdk:ready` composite **exit 0** with the protected env (typecheck + lint + format:check + npm test + test:coverage + pack:dry-run + release:gate; release evidence 58 surfaces `blocked=false`); `npm audit --audit-level=moderate` 0 vulnerabilities; `git ls-files -z | xargs -0 node scripts/scan-secrets.mjs` 1,539 files / 0 findings; `npm run pack:dry-run` twice **byte-identical** (log sha256 `18fa05e18192c0d006a21d4e3556c4a30cadb183`); node v20.20.2 packed exports imports **24/24**; plain `release.mjs gate --version 0.2.3` exit 0, 50 packages, 0 errors, 0 breaking deltas.
    - Evidence: `scripts/phase23-baseline.json` exitGate `green: true`/`blocked: false` with command, version, platform, counts (npmTest 3495/3462/33/0, scriptGates 260/260, threatSuites 50/50, testPostgres 91/91, coreCoverage, packDryRun sha256, releaseGate, node20 24/24), protected evidence, compat deltas, and the manifest note; `scripts/phase23-freeze-manifest.json` with per-task tokens (tasks 0-6 done), 13 recorded deviations, the version-literal-only compat promise, and the protected-gate policy; `scripts/release-evidence.json` regenerated against the final baseline (core row pass 3495 with 33 skips named; Task 3 suite 6/6); `plans/README.md` 023 row `complete`.
    - Debugging notes (all fixed): (1) the Task 3 `blocked-not-skip` test broke under `sdk:ready` because `runEmitter` re-spread `process.env` over the caller's env copy, resurrecting the ambient `PRISM_TEST_POSTGRES_URL` the test had deleted — `runEmitter` now treats the env parameter as the authoritative full child env (works with and without the ambient env); (2) two gate trips during Task 6: the ag-ui `useExportType` compat-surface removal (fixed by restoring the value-style statements, above) and the `biome-ignore` rule path (`lint/correctness/` → `lint/style/`).

## Compromises Made

- **Build serialization chose the single global O_EXCL lockfile over staging-directory atomic publish** (Task 1): converting `dist` to a symlink-swap layout would touch every consumer path and the `package.json` `files` include; the lock is dependency-free, fail-closed, and stale-PID-reclaiming. The documented ceiling is that a `tsc` invoked OUTSIDE the wrapper (or any external writer) can still race an importer — the wrapped leaves are the release-supported path.
- **The root `npm test` gate segment wraps all 22 script-gate `.test.mjs` files** and the stress suite (`phase23-build-race`) runs unwrapped in its own separate invocation, so the lock tests acquire the real lock; the wrapped-gate run had made phase23 inherit `PRISM_BUILD_LOCK_HELD=1` and a dead-pid lockfile leftover caused EEXIST in the live-lock test.
- **Coverage thresholds are freeze-run evidence minus 3 pp on lines only** (branches/functions reported, not gated): the first post-fix capture has no 0.2.2 per-workspace rows to compare against; the 3 pp margin absorbs runner noise while the `mcp` 87.25 threshold still fails if the include filter breaks. `memory` joined the `protectedException` set because its glob includes the env-gated `postgres-memory.integration.test.js`; provider packages gated by `PRISM_LIVE_PROVIDER_TESTS` stay threshold-gated (offline conformance covers their mapping code — protecting all 10 would gut the gate).
- **Skip attribution is by class, not per test name**: `node --test` does not emit per-test skip reasons machine-readably, so the 33 skips aggregate on the core row and each skip CLASS (provider live, NATS real legs, postgres durable, canaries) gets its own named surface with reason and required env.
- **Live canaries always record `protected`, never `pass` and never `blocked`**: canary envs are always absent in release CI, so blocking would make every release impossible; the implemented canaries (provider OIDC/OPA, MCP, A2A, web/Brave) differ from the plan's names (OIDC/OPA, S3, MCP-AS, NATS JetStream), and a `test:nats` surface is kept as a protected gap even though no suite references `PRISM_TEST_NATS_URL` yet (real-leg expansion is 0.3.0).
- **The `useExportType` biome fix was partially reverted in `ag-ui/acp/index.ts`**: the compat-surface parser keys per-name type modifiers literally (`type AcpConfigOption`), so converting those two statements to `export type` form read as 6 removed exports. The value-style shape is restored with `biome-ignore` + justification; the 0.2.3 compat delta is the version literal alone.
- **`docs/migration.md` gains a 0.2.2 → 0.2.3 no-migration stub** despite the plan's 'no runtime section': the compat gate requires a migration.md mention of the release version for any changed delta (here the version literal), and the stub documents zero runtime contract delta + store-safe rollback — the plan's intent, not a runtime migration.
- **`blocked-not-skip` env-deletion bug fixed in `runEmitter`** (Task 3 suite): `{...process.env, ...env}` resurrected keys the caller deleted from `env`, so the test recorded `pass` whenever the ambient env had `PRISM_TEST_POSTGRES_URL` (the sdk:ready protected profile); the env parameter is now the authoritative full child env.
- **Packed matrix item 12 cannot run `coverage-summary.mjs` inside the consumer** (tarballs exclude tests and `scripts/` — no coverage surface by construction), so the packed journey asserts single-shared-core + no-`dist/__tests__` artifacts and the source-level T2 carries the runtime denominator proof.

## Further Actions

- (0.3.0) Full live-service matrix: NATS JetStream real-leg suite (`PRISM_TEST_NATS_URL` — the manifest names it as a protected gap today), S3 + MCP-AS + the full live canary set, and the multi-replica Postgres failover legs.
- (0.3.0) Per-test-name skip attribution in the release manifest once `node --test` emits machine-readable skip reasons (the 33-skip aggregate on the core row is the documented interim).
- (demand-gated) Lock-free staging-directory atomic publish if the single-lock serialization ever becomes a throughput ceiling (the direct-`tsc` caveat stays either way).
- (demand-gated) Clean up the compat-surface parser's `type Name` key quirk so future statement-form changes never read as removals (the value-style freeze in ag-ui is the workaround).
- (demand-gated) Gate branches/functions per package once thresholds stabilize on lines for several releases.
