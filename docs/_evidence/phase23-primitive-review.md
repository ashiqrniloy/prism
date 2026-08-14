# Phase 23 Primitive Review — Build, Coverage, and Release Evidence Integrity

Plan: `plans/023-Release-0-2-3-Build-Coverage-And-Release-Evidence-Integrity.md` Task 0.
Roadmap: `roadmap.md` §0.2.3 + mandatory 0.2.x regression matrix items 4 and 12.
Baseline: `@arnilo/prism` 0.2.2 (HEAD at plan creation). Evidence gathered 2026-08-14 against the working tree.
Tarball-excluded evidence document (lives under `docs/_evidence/`, already excluded from every publish tarball). No source or script was edited to produce this document.

## 1. Primitive inventory

### 1.1 Build pipeline (`package.json` scripts + `tsconfig.json`)

- `build:core` = `tsc` (emits root `dist/` from `src/`, `tsconfig.json` `outDir: dist`, `rootDir: ./src`, `include: ["src"]`; no `incremental`/`tsBuildInfoFile` set — `tsc` runs non-incremental by default here).
- `build` = `npm run build:core && npm run build --workspaces --if-present` (root emit then each workspace `tsc` emits `packages/<name>/dist/`).
- `clean` = `rm -rf dist packages/*/dist` (standalone, not part of `build` — the 0.1.1 fix removed destructive `clean` from `build`).
- `test` = `npm run build && node --test dist/__tests__/*.test.js && node --test <15 phase/script gate files> && npm run test --workspaces --if-present`. The `node --test dist/__tests__/*.test.js` segment is the core dist CONSUMER that races a concurrent `build:core`.
- `test:coverage` = `node --test --experimental-test-coverage <core gate flags> dist/__tests__/*.test.js && node scripts/coverage-summary.mjs` (note: `test:coverage` does NOT run `npm run build` first — it assumes `dist/` is already built; `sdk:ready` runs `typecheck`→…→`test:coverage` after a build).
- `typecheck` = `npm run build && npm run typecheck --workspaces --if-present && tsc -p examples --noEmit`.
- `sdk:ready` = `typecheck && lint && format:check && npm test && test:coverage && pack:dry-run && release:gate`.
- `tsconfig.packages.json` is the shared base workspaces extend (`rootDir: src`, `outDir: dist`, `include: ["src"]`).
- **No build lock exists.** `tsc` emits many files non-atomically into `dist/`; a concurrent `node --test dist/__tests__/*.test.js` (or any workspace test importing `@arnilo/prism`) can import a half-emitted module. The 2026-08-12 review reproduced this (roadmap §0.2.3 bullet 1; 0.2.2 Further Actions).

### 1.2 Coverage tooling (`scripts/coverage-summary.mjs`)

- Zero-dependency; runs `node --test --experimental-test-coverage` per package and parses the `all files | line% | branch% | funcs%` aggregate row via the `ALL_FILES` regex.
- Core run: `CORE_GATE = [--test-coverage-lines=60, --test-coverage-functions=70, --test-coverage-branches=75]` + `CORE_EXCLUDES = [...SHARED_EXCLUDES, "**/packages/**"]` where `SHARED_EXCLUDES = ["**/__tests__/**", "**/node_modules/**", "**/scripts/**", "**/examples/**"]`. The core gate (60/70/75) is the ONLY hard threshold.
- **Workspace loop (the defect)** at the `for (const name of workspaceNames)` block (~lines 72–86): each workspace `runCoverage` call passes only `[...SHARED_EXCLUDES.map(e => --test-coverage-exclude=e), "dist/__tests__/*.test.js"]` with cwd `join(packagesDir, name)` — **no `--test-coverage-include`**. So every module the workspace tests load counts in the denominator.
- **Denominator pollution mechanism (verified)**: `node_modules/@arnilo/prism -> ../..` (root self-symlink). Workspace tests `import { ... } from "@arnilo/prism"` (confirmed: `packages/session-store-postgres/src/__tests__/postgres-persistence.test.ts` + 2 others). Node ESM resolves symlinks by default (`--preserve-symlinks` is false), so the imported core module is reported by coverage under its REAL path `<root>/dist/**`, which is NOT under `**/node_modules/**` (the symlink path would be, the real path is not) and NOT under `**/packages/**` from the workspace cwd. Root `dist/**` is therefore counted in each workspace's denominator, diluting the package's true coverage percentage. The roadmap §0.2.3 bullet 2 and 0.2.2 evidence both name this.
- **Fix primitive exists**: Node supports `--test-coverage-include=<glob>` (cwd-relative). Adding `--test-coverage-include=dist/**` to the workspace run restricts the denominator to `packages/<name>/dist/**`; the real-path root `dist/**` does not match and is excluded. The existing `**/node_modules/**` exclude stays as defense-in-depth.

### 1.3 Release-evidence shape (`scripts/phase22-baseline.json` + `scripts/release.mjs`)

- `phase22-baseline.json` top-level keys: `captured`, `release`, `node`, `platform`, `gitHead`, `npmTest`, `coverage`, `threatSuites`, `packDryRun`, `releaseGate`, `node20`, `protectedEvidence`, `phase22Security`, `typecheck`, `lint`, `format`, `testPostgres`, `audit`, `secrets`, `compatDeltas`, `sdkReady`, `exitGate`.
- `exitGate` keys: `green`, `command`, `version`, `platform`, `counts`, `protected`, `compat`, `freeze`, `blocked`, `note`. `protected` = `{ oidcOpa, natsRestartDurable, durableConformance }` (per-surface protected-evidence presence). `blocked` = boolean. This is the per-phase precedent for the release-wide skip manifest.
- `scripts/release.mjs`: `loadRelease`/`validateRelease`/`topologicalOrder`/`bumpRelease` + a `gate` command (invoked via `npm run release:gate` → `node scripts/release.mjs gate`). `validateRelease` enforces version/peer/lockfile consistency across all manifests.
- `.github/workflows/release.yml`: jobs `verify` (runs `sdk:ready` phased with `tee sdk-ready.log` + failure-summary grep), `node20-compat`, `postgres-integration` (injects `PRISM_TEST_POSTGRES_URL`, runs `test:postgres`), `codeql-release` (tag-gated), `supply-chain` (audit/SPDX/secrets), `publish` (tag-gated, OIDC, attests provenance/SBOM, publishes in dep order, retains `release-artifacts`). **No release-wide skip manifest is emitted or retained today** — protected evidence lives only in the per-phase baseline JSONs and the `sdk-ready.log` grep.
- `.github/workflows/security.yml`: `dependency-review`, `codeql`, `supply-chain` (audit/SPDX/secret scan of tracked + packed). No skip manifest.

### 1.4 Quality gates (`biome.json` + `scripts/sweep-unused.mjs`)

- `biome.json` schema `2.5.5`. `npx biome --version` = 2.5.5.
- **Deprecated key (verified by the tool itself)**: `npx biome lint biome.json` emits `DEPRECATED: The use of the recommended field has been deprecated, and will removed in the next major version of Biome. Use preset instead.` at `linter.rules.recommended: true`. Biome 2.5+ replaces `linter.rules.recommended: true|false` with `linter.rules.preset: "recommended"|"all"|"none"`. `npx biome migrate` auto-rewrites this. No other `biome.json` key is flagged deprecated by the tool (the `files.includes` negation syntax and `files.ignoreUnknown` placement are valid in 2.5.5).
- Current diagnostics (`npx biome lint . --max-diagnostics=300`): **75 warnings + 22 infos** (default-capped summary). Breakdown by rule:
  - `lint/correctness/noUnusedVariables`: 29
  - `lint/style/useTemplate`: 20
  - `lint/correctness/noUnusedImports`: 16
  - `lint/correctness/noUnusedFunctionParameters`: 9
  - `lint/complexity/useOptionalChain`: 7
  - `lint/suspicious/noTemplateCurlyInString`: 4
  - `lint/suspicious/noConfusingVoidType`: 3
  - `lint/suspicious/noUselessEscapeInString`: 2
  - `lint/style/useExportType`: 2
  - `lint/style/useConst`: 2
  - `lint/complexity/useLiteralKeys`: 1
  - `lint/complexity/noAdjacentSpacesInRegex`: 1
  - (Sum ≈ 96; the 75+22 summary is the default `--max-diagnostics` cap. The 0.2.2 Further Action's "75 FIXABLE `useTemplate`" was approximate — `useTemplate` is 20 of them; the bulk is unused-code 54 = 29+16+9, all `--write`-fixable.)
- **Reporter support (verified)**: `npx biome lint --help` lists `[--reporter=<default|json|json-pretty|github|junit|summary|gitlab|checkstyle|rdjson|sarif|concise>]` + `--reporter-file=PATH`. `--reporter=json` is documented as **experimental** (schema may change in patch releases). `--reporter=sarif` is the **stable** machine-readable choice for CI retention (industry-standard static-analysis format).
- `scripts/sweep-unused.mjs` (plan 015 Task 3): zero-dep; runs `tsc --noEmit --noUnusedLocals --noUnusedParameters` over core + every workspace tsconfig, writes `scripts/unused-sweep-report.txt`, always exits 0 (report-only). Also runs `scripts/dead-exports.mjs` for naive dead-export candidates. **Currently text-only; no `--json` output.** Overlaps with Biome's `noUnusedVariables`/`noUnusedImports` for locals/params but uniquely covers unused EXPORTS.
- `package.json` lint scripts: `lint` = `biome lint .`, `format` = `biome format --write .`, `format:check` = `biome format .`, `sweep:unused` = `node scripts/sweep-unused.mjs`.

### 1.5 Timing-assertion surface (grep evidence)

- `grep -rln "setTimeout("` in `**/*.test.{ts,mjs}` under `src/`, `scripts/`, `packages/`: 30 files (e.g. `src/__tests__/{rpc,pinned-fetch,checkpoint-event-primitives,guardrails,agents,run-ledger,agent-loops,install-smoke}.test.ts`, `scripts/phase{7,9,12,22}-*.test.mjs`, and many `packages/coding-agent`, `packages/mcp`, `packages/coding-security`, `packages/session-store-*`, `packages/credentials-node` tests). Not all are load-sensitive timing ASSERTS — many legitimately simulate delays or wait for async. Task 4 triages which assert a duration/delta.
- `grep -rln "performance.now()|Date.now()"` in tests: 20 files (e.g. `src/__tests__/{identity,node-config,agent-run-state}.test.ts`, `scripts/{phase7,phase11,phase12,e2e-*}.test.mjs`, `packages/coding-agent`, `packages/session-store-*`, `packages/credentials-node`). These are the more likely load-sensitive timing-assertion sites. Task 4 replaces each with a deterministic barrier or quarantines it behind a documented ceiling.

### 1.6 Phase gate + security scripts

- `scripts/phase{11..22}-freeze.test.mjs` (12 freeze legs) + `scripts/phase20-security.test.mjs`, `phase21-security.test.mjs`, `phase22-security.test.mjs`, `scripts/phase22-conformance.test.mjs`. The `npm test` script wires all freeze legs; `security:threat-suites` wires `phase{8..11}-conformance` + `phase{20,21,22}-security`. Task 5 adds `phase23-security.test.mjs` to `security:threat-suites`.
- `scripts/budgets.json`: root/aggregate/startup/benchmark sections with the dated-`$comment` rebaseline convention (plan 022 Task 4 rebaselined root to 800042/2782640/326).

### 1.7 Docs surfaces

- `docs/release-and-install.md` (106 KB, canonical release/publish/protected-evidence page), `docs/index.md` (47 KB, navigation), `docs/migration.md` (136 KB, runtime migration — 0.2.3 adds NO runtime section), `CHANGELOG.md`. `docs/_evidence/` is the tarball-excluded evidence folder (this file's home).

## 2. Gap decisions (minimum reusable, reuse-first)

| # | Gap | Approved primitive | Reused from | Rejected alternative |
|---|-----|--------------------|-------------|----------------------|
| a | Build race (partial `dist`) | One dependency-free `scripts/with-build-lock.mjs` (`O_EXCL` lockfile + stale-PID + bounded retry + fail-closed timeout), leaf-level acquisition | `node:fs` `openSync(path,'wx')`/`O_EXCL`, `process.kill(pid,0)` liveness, `AbortSignal.timeout` | external lock lib (`proper-lockfile`); in-process single-flight (no cross-process coverage); second build runtime |
| b | Wrong coverage denominator | `--test-coverage-include=dist/**` on the workspace run + `scripts/coverage-thresholds.json` (per-package evidence-based thresholds + protected exceptions) + `scripts/coverage-summary.json` artifact | existing `coverage-summary.mjs` loop + Node `--experimental-test-coverage` | coverage vendor (`c8`/`istanbul`/`nyc`); removing the workspace summary |
| c | Silent protected skips | `scripts/release-skip-manifest.mjs` → `scripts/release-evidence.json` (release-wide aggregate; `pass`/`skip`/`blocked`/`protected` per surface); `release.mjs gate` consumes it | `phase22-baseline.exitGate.protected`/`blocked` shape | per-phase-only (no release view); a CI dashboard / second runtime |
| d | Biome deprecation + diagnostics + machine-readable reports | `biome migrate` (rewrites `recommended`→`preset`), `biome lint --write`/`format --write` for safe fixes, reviewed `biome-ignore` for residual, `--reporter=sarif` (stable) → `scripts/lint-report.sarif`, `sweep-unused.mjs --json` → `scripts/unused-report.json` | existing `biome.json` + `sweep-unused.mjs` | disabling noisy rules globally; pinning an older Biome; experimental `--reporter=json` (schema-unstable) |

**Rejected, on record**: a generic CI/CD framework, a coverage vendor, an external lock library, a second build orchestration runtime, a new published package, a new runtime dependency, a hosted dashboard. All four gaps are closed with stdlib + existing `scripts/` tooling + the existing baseline JSON shape.

## 3. Decision freeze

### 3.1 Build serialization (Task 1)

- **Chosen: Option A — portable `O_EXCL` lockfile** (`scripts/with-build-lock.mjs`).
- **Acquisition points (leaf-level only, never the orchestrator)**: each emit-producing LEAF and each dist-consuming test LEAF acquires the lock:
  - `build:core` (emits root `dist/`) — wrapped.
  - `build --workspaces --if-present` → each workspace `tsc` (emits `packages/<name>/dist/`) — wrapped at the workspace build leaf.
  - `node --test dist/__tests__/*.test.js` (core consumer in `test` and `test:coverage`) — wrapped.
  - each workspace `node --test dist/__tests__/*.test.js` (workspace `npm test` leaves) — wrapped, **because workspace tests import root `dist/` via the `@arnilo/prism` self-symlink (verified §1.2)**, so a concurrent `build:core` re-emitting root `dist/` races them.
  - `typecheck`'s `tsc -p examples --noEmit` is emit-free → not wrapped.
- **Non-nesting rule**: the lock is acquired ONLY by leaf processes, never by the orchestrator scripts (`npm test`, `sdk:ready`, `test:coverage` as a whole). `npm test` runs `build` → `node --test` → … → `npm run test --workspaces` as sequential children; each leaf acquires+releases its own lock, so there is no nested acquisition and no deadlock. A concurrent `npm run build` (process A) and `npm test` (process B) serialize at each leaf.
- **Lockfile**: `node_modules/.prism-build.lock` (contents: `pid` + `startedAt`; no secrets). Stale-PID reclaim: if `process.kill(holderPid, 0)` throws (PID not alive), reclaim. Bounded retry: 100ms backoff up to `PRISM_BUILD_LOCK_TIMEOUT_MS` (default 120000, env-overridable). Fail-closed: acquisition error or timeout exits non-zero and NEVER proceeds to emit/consume.
- **Fallback (recorded, not chosen)**: Option B — atomic publish of root `dist/` via symlink swap (`dist` → symlink to `dist.vN`; build to `dist.vN+1`; atomic `rename(2)` of the symlink). Chosen NOT primary because it changes `dist` from a real dir to a symlink (touches every consumer path + `package.json` `files` includes + the install-smoke pack layout) — more invasive than a leaf lock. Reconsider if lock contention measurably hurts CI wall time (CI runs `npm test` once, so contention is low).
- **`clean` stays standalone**, unchanged, not lock-blocked.

### 3.2 Coverage denominators + thresholds (Task 2)

- **Include filter**: add `--test-coverage-include=dist/**` to the workspace `runCoverage` call (cwd `packages/<name>` → matches `packages/<name>/dist/**` only; root real-path `dist/**` excluded).
- **Core gate unchanged**: 60/70/75 stays the only hard core threshold; `CORE_EXCLUDES` unchanged.
- **Thresholds**: per-package (mirrors the per-workspace rows), recorded in `scripts/coverage-thresholds.json` at freeze. Threshold = recomputed package percentage − **3 percentage-point margin** (chosen: tight enough to catch a real regression, loose enough to absorb machine/fixture noise; Biome's own `noUnusedVariables` churn shows ±2–3 points is normal). Applied to `lines` (primary); `branches`/`functions` recorded but the gate fails on `lines` below threshold (branches/functions are reported, not hard-gated, matching the existing "core gate only" posture extended per-package).
- **Protected exceptions**: packages whose suites require `PRISM_TEST_POSTGRES_URL` or a real NATS server (e.g. `@arnilo/prism-session-store-postgres`, `@arnilo/prism-enterprise-postgres`, `@arnilo/prism-session-store-nats` real-NATS legs) are excluded from the threshold computation and shown separately in `coverage-summary.json` as `protectedException` with the required env. A protected package's missing durable legs are a protected exception, never a threshold failure.
- **Artifact**: `scripts/coverage-summary.json` records per-package `lines`/`branches`/`functions`, `denominatorFiles`, `threshold`, `pass`/`fail`, `protectedException`. Retained by CI (Task 6 wires retention).
- **Fail-closed**: a non-protected package whose recomputed `lines` < threshold → `coverage-summary.mjs` exits 1.

### 3.3 Release skip manifest (Task 3)

- **States**: `pass` | `skip` | `blocked` | `protected`.
  - `pass`: ran and succeeded (records count + skip count of protected skips within).
  - `skip`: a default-local skip of unavailable infrastructure (permitted with a reason + required env; e.g. NATS fake-seam leg when no real NATS).
  - `blocked`: a REQUIRED release environment is absent (e.g. `PRISM_TEST_POSTGRES_URL` missing at release time) → release cannot ship green.
  - `protected`: a protected surface inherited from a phase baseline (e.g. OIDC/OPA live canary) — present-or-blocked, never unexplained-green.
- **Required-env rule**: a surface with a `requiredEnv` that is absent at release time records `blocked`, never `pass`/`skip`. `release.mjs gate` fails closed on any `blocked` required surface or any `skip` without a reason/requiredEnv.
- **Shape**: `scripts/release-evidence.json` = `{ release, surfaces: [{ name, state, count?, skip?, reason?, requiredEnv?, protected? }], blocked }`. Cross-references `phase*-baseline.json.exitGate.protected` for inherited protected surfaces (the manifest is the release-level aggregate; per-phase baselines stay the per-phase record).
- **Emitter/consumer split**: standalone `scripts/release-skip-manifest.mjs` emits the JSON (mirrors the `coverage-summary.mjs` + gate split); `release.mjs gate` consumes it. New `release:evidence` script; wired into `sdk:ready`/`release:gate`. CI (`release.yml`) retains `release-evidence.json` as a release artifact.
- **Live canaries (OIDC/OPA/S3/MCP-AS/NATS JetStream)**: recorded `protected`/`blocked` (absent) — full live matrix stays 0.3.0; never `pass`.
- **No-secret rule**: env var NAMES only, never values (the manifest is retained/uploaded; grep for known secret patterns → zero).

### 3.4 Quality gates (Task 4)

- **Biome config migration**: run `npx biome migrate --write` to auto-rewrite `linter.rules.recommended: true` → `linter.rules.preset: "recommended"`. Verify with `npx biome lint biome.json` (deprecation warning gone). No other deprecated key is flagged by the tool.
- **Warning/info resolution**: `biome lint --write .` + `biome format --write .` apply safe fixes (the 54 unused-var/import/param + 20 `useTemplate` + 7 `useOptionalChain` + the `useExportType`/`useConst`/`useLiteralKeys` are `--write`-safe). Residual (the `noTemplateCurlyInString` 4, `noConfusingVoidType` 3, `noUselessEscapeInString` 2, `noAdjacentSpacesInRegex` 1, and any `--write`-unsafe): review each, fix or add a justified `// biome-ignore lint/<rule>: <reason>` (intentional `ponytail:` ceilings stay). Target: `biome lint .` exits 0 (only documented-and-ignored diagnostics).
- **Reconcile with `sweep-unused.mjs`**: Biome `noUnusedVariables`/`noUnusedImports`/`noUnusedFunctionParameters` catch locals/params; `sweep-unused.mjs` + `dead-exports.mjs` catch unused EXPORTS (public surface). Both stay; the Biome fixes do NOT remove public exports (that is the 0.1.5/0.2.5 breaking-cut path). A `biome-ignore` on an unused EXPORT is not permitted — those route to `sweep-unused` triage.
- **Timing-assertion quarantine**: triage the 30 `setTimeout(` + 20 `performance.now()`/`Date.now()` test files. Replace each load-sensitive duration/delta ASSERT with a deterministic barrier (await the conflicting op, then assert state — the pattern proven in `src/testing/state-concurrency-conformance.ts` from plan 022). Genuinely load-sensitive asserts (e.g. a p95 latency ceiling) move to a quarantine suite with a `ponytail:` comment naming the ceiling and the machine-dependence. **No new `setTimeout`-based race asserts** in default suites (grep → zero in the replaced set).
- **Machine-readable reports**: `biome lint --reporter=sarif --reporter-file=scripts/lint-report.sarif` (stable, CI-retained) + `biome format --reporter=sarif` (or `--reporter=github` for inline annotations); `sweep-unused.mjs` gains `--json` → `scripts/unused-report.json`. New `lint:report`/`unused:report` scripts; `release.yml` retains the artifacts. `--reporter=json` rejected as primary (experimental, schema-unstable); available as a fallback.

## 4. Threat model

| Threat | Asset | Entry point | Trust boundary | Mitigation | Test (Task) |
|--------|-------|-------------|----------------|------------|-------------|
| Concurrent-build partial `dist` import | root `dist/`, `packages/*/dist/` | `npm run build` + `npm test` concurrent; two `npm run build`; `typecheck`+`test`; `coverage`+`test` | build/CI environment | leaf-level `O_EXCL` lock serializes emit + dist-consuming test leaves (incl. workspace tests importing root dist) | T1 stress (build+test, two builds, typecheck+test, coverage+test) |
| Build-lock deadlock/stale lock | all builds | a holder crashes holding the lock | build environment | stale-PID reclaim (`process.kill(pid,0)`), bounded retry, fail-closed timeout; leaf-only acquisition (no nesting) | T1 stale-lock + fail-closed |
| Build-lock fail-open | all builds | lock-acquisition error swallowed | build environment | acquisition error/timeout exits non-zero, NEVER proceeds | T1 fail-closed |
| Coverage denominator inflation/deflation | per-package coverage % | workspace `runCoverage` with no include filter | CI coverage gate | `--test-coverage-include=dist/**` excludes root real-path `dist/**` | T2 denominator-excludes-core |
| Coverage threshold false-green | per-package coverage % | threshold set above true coverage or missing protected exception | CI coverage gate | evidence-based threshold = recompute − 3pp; protected packages excluded and shown separately; fail-closed on `lines` < threshold | T2 threshold-fail-closed + protected-exception |
| Silent protected skip | release evidence | missing `PRISM_TEST_POSTGRES_URL` recorded as pass | release gate | skip manifest `blocked` state; `release.mjs gate` fails closed on required-blocked; every skip needs reason+requiredEnv | T3 blocked-not-skip + unexplained-skip-rejected |
| Unexplained lint diagnostic | code quality | a real defect masked by `biome-ignore` | quality gate | every `biome-ignore` reviewed + recorded with a reason; no `biome-ignore` on unused exports (route to `sweep-unused`); target `biome lint .` exit 0 | T4 lint-clean + safe-fix-review |
| Load-sensitive timing false-green/flaky | test reliability | a `setTimeout`/`performance.now`-delta assert on a loaded runner | test suite | replace with deterministic barriers; quarantine genuinely load-sensitive asserts with a documented ceiling; no new timing-only sleeps | T4 timing-assert-quarantine |

**Actors**: a concurrent CI process or a developer running two `npm` scripts in parallel (build race); a maintainer setting a loose coverage threshold or marking a real defect `biome-ignore` (false-green); a loaded CI runner (timing flake). **Assets**: build outputs, coverage reports, release evidence, quality-gate signal. **Trust boundaries**: build environment, CI coverage gate, release gate, quality gate. Every mitigation is fail-closed at its boundary.

## 5. Owner / migration / budget / protected-environment matrix

| Item | Owner | Migration | Rollback | Package budget | Protected env |
|------|-------|-----------|----------|----------------|---------------|
| Build lock (T1) | `scripts/` + root `package.json` maintainer | contributor/CI: wrapped scripts; direct-`tsc` caveat documented | restore 0.2.2 → restores the race (not a prod mitigation) | no new pkg/deptype; `scripts/with-build-lock.mjs` tarball-excluded | none |
| Coverage include + thresholds (T2) | `scripts/coverage-summary.mjs` maintainer | contributor/CI: denominators drop to true values; thresholds JSON captured at freeze | restore 0.2.2 → wrong denominator + silent-regression risk | no new pkg; `scripts/coverage-{thresholds,summary}.json` tarball-excluded | `PRISM_TEST_POSTGRES_URL`, real NATS (protected exceptions) |
| Skip manifest (T3) | `scripts/release.mjs` / release-workflow maintainer | contributor/CI: new `release:evidence` script + CI retention | restore 0.2.2 → removes manifest + blocked-vs-skip | no new pkg; `scripts/release-evidence.json` tarball-excluded | `PRISM_TEST_POSTGRES_URL`, real NATS, live canaries (blocked-or-present) |
| Biome migration + reports (T4) | `biome.json` + `sweep-unused.mjs` maintainer | contributor: `biome migrate`; `--write` fixes; `biome-ignore` residual; quarantine suite | restore 0.2.2 `biome.json` → deprecated keys + 75/22 diagnostics | no new pkg/deptype; `scripts/{lint-report.sarif,unused-report.json}` tarball-excluded | none |

**Package and performance budget**: 50 packages unchanged; zero new runtime dependencies; zero new packages; all new artifacts under `scripts/` (tarball-excluded). Biome `format --write` may reformat files (whitespace + safe fixes) — root packed/unpacked/file-count delta expected within the existing 5% `budgets.json` tolerance; re-baseline only if measured outside, with a dated `$comment`. Build lock: O(1) acquire, sub-100ms typical non-contended; serializes under contention (intended). Coverage include: O(1) flag, no extra run. Skip manifest: O(suites) aggregation, no extra run. Biome reports: one extra flag, no extra run. Stress regression + packed conformance: test-only.

## 6. Test mapping (Tasks 1–4)

- **Task 1** (build race): `scripts/phase23-build-race.test.mjs` — concurrent build+test, two builds, typecheck+test, coverage+test never observe partial `dist`; stale-lock reclaim; fail-closed; clean unchanged. (Matrix item 4 named in Task 5.)
- **Task 2** (coverage denominator): `scripts/phase23-coverage.test.mjs` (or extend the coverage gate) — denominator excludes core; threshold fail-closed; protected exception; artifact well-formed; core gate unchanged; reproduction. (Matrix item 12 named in Task 5.)
- **Task 3** (skip manifest): `scripts/phase23-skip-manifest.test.mjs` — blocked-not-skip; protected-named; live-canary-not-pass; unexplained-skip-rejected; cross-reference; no-secret.
- **Task 4** (quality gates): inline assertions — `biome lint .` exit 0; config migrated (no deprecated keys); timing-assert quarantine (grep → zero replaced `setTimeout` race asserts; quarantined carry `ponytail:`); machine-readable reports well-formed; every `biome-ignore` has a reason.
- **Task 5** (security regression + packed JS): `scripts/phase23-security.test.mjs` (wired into `security:threat-suites`) + `src/__tests__/install-smoke.test.ts` packed consumer — matrix items 4 and 12 by name, built + packed plain-JS.
- **Task 6** (exit gate): `scripts/phase23-baseline.json` + `scripts/phase23-freeze-manifest.json` — release accounting, skip manifest blocked-not-skip, package truth (50 manifests), compatibility deltas (version literal + `scripts/`-only).

## 7. Documentation/Wiki impact (Task 0)

- **Public API or behavior impacted**: no. Task 0 produces this tarball-excluded evidence document only; no public API change, no `docs/index.md` navigation change.
- **Docs pages to create/edit**: `docs/_evidence/phase23-primitive-review.md` (this file).
- **`docs/index.md` update**: no.
- **Documentation structure reference**: not applicable; evidence-only task.

## 8. Decisions ratified

All §3 decisions are frozen. Tasks 1–4 implement exactly these; deviations require a recorded plan amendment before implementation. The chosen approaches stay within the dependency-light, host-owned, deny-by-default posture: no new runtime dependency, no new package, no second runtime, no generic framework, no coverage vendor, no external lock library — only stdlib + existing `scripts/` tooling + the existing `phase*-baseline.json` shape.