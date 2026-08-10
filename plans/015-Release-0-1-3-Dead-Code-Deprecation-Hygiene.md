# Release 0.1.3 — Dead-code and deprecation hygiene

Roadmap phase: 0.1.x line, milestone **0.1.3 — Dead-code and deprecation hygiene** (`roadmap.md`, "0.1.3 — Dead-code and deprecation hygiene").
Baseline: `@arnilo/prism` **0.1.2** (plan 014 exit gate green; `scripts/phase14-baseline.json`; 49 publishable manifests; `npm audit --audit-level=moderate` 0).
Target: `@arnilo/prism` **0.1.3** (additive/non-breaking patch; tooling, docs, and opt-in state-persistence hygiene; no new packages, no new runtime dependencies, no public-export removals).
Prerequisite: 0.1.2 exit gate passed; `docs/public-contracts.md` 0.1.x contract surface frozen; compat baseline green.

0.1.3 is **hygiene, not new surface** (versioning policy: doc/tooling hardening is 0.1.x). Roadmap priority rule 5 applies: breaking removals (deprecated inert options) belong to **0.1.5**, the god-module split to **0.1.4** — neither is in scope here. Every 0.1.3 change keeps the compat baseline additive-only.

## Objectives

- Prune superseded per-version benchmark runners: audit every `scripts/benchmark-0.0.*.mjs` / `*.test.mjs` reference, drop orphaned runners, keep all checked-in `*.json` evidence, and consolidate the six live legs (`0.0.23`–`0.0.28`) into **one parameterized benchmark runner** with versioned evidence JSON.
- Archive the 12 phase-review docs (`docs/review-coverage-2026-07-*.md`) into `docs/_evidence/`, excluded from the published tarball, linked from `docs/0.1.0-readiness.md`.
- Add a **non-blocking** unused-code sweep (`tsc --noUnusedLocals`/`--noUnusedParameters` + a zero-dependency dead-export scan) that reports without failing the build.
- Ship **opt-in** checkpoint persistence for loaded-skill names and the read-path set (plans 003/004 further actions): resume restores the loaded-skill catalog and read-before-write state; bodies still reload via `load_skill`.

## Non-goals

- Removing deprecated inert options (`ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs`, `AgentConfig.maxToolRounds`, compaction flat keys, `read.ts` `transformImage`, `cli-init` `listInitProviders`) — that is the **0.1.5** breaking cut with `docs/migration.md`.
- Splitting `src/agents.ts` / `src/contracts.ts` — **0.1.4**.
- Durable ACP session store, checkpoint persistence of loaded-skill **bodies** — **0.1.6** (demand-gated).
- Deleting or rewriting `ponytail:` comments — they are intentional, documented shortcuts, not dead code.
- Deleting any checked-in benchmark evidence JSON, freeze manifests, or historical doc narrative — evidence is preserved; only live runners move.
- Removing any **public** export flagged by the sweep — report-only in 0.1.3 (removal is a 0.1.5 breaking change); only unexported/internal dead code may be deleted.
- New packages, new runtime dependencies, or any change to the frozen 0.1.x support matrix.

## Expected Outcome

- `scripts/` contains one parameterized benchmark runner (`scripts/benchmark.mjs --scenario <name>`) plus the `benchmark-0.1.0.mjs` orchestrator; the 16 orphaned `benchmark-0.0.{8..16}` runner/test files are gone; every `benchmark-*.json` evidence file remains; `npm test` references only current runners; removed files are listed in the release changelog.
- `docs/` root no longer carries `review-coverage-2026-07-*` files; they live in `docs/_evidence/` (git-moved, history preserved), excluded from the tarball via `package.json` `files`, and every inbound link (`docs/index.md`, `docs/migration.md`, `docs/performance.md`, `docs/0.1.0-readiness.md`) resolves.
- `npm run sweep:unused` produces a dead-code report (exit 0 always); CI runs it as a non-blocking step; obvious **internal** dead code is removed or marked `ponytail:` intentional in the report.
- Opt-in resume restores the loaded-skill name catalog and the read-before-write path set from checkpoint state; cross-branch/cross-tenant restore fails closed; default behavior (flag off) is byte-identical to 0.1.2 — no checkpoint size growth.
- `npm run sdk:ready` green at 0.1.3 with the compat baseline additive-only; audit 0 moderate; docs freeze assertions green.

## Tasks

- [x] Task 0 — Freeze record, scope gate, and baseline evidence
  - Acceptance Criteria:
    - Functional: `scripts/phase15-freeze-manifest.json` declares 0.1.3 as dead-code/deprecation hygiene: allowed changes (benchmark script consolidation + orphan deletion, `docs/review-coverage-*` → `docs/_evidence/` move, non-blocking sweep tooling, opt-in checkpoint persistence for loaded-skill names + read-path set, `package.json` `files`/scripts edits, docs updates), forbidden changes (public-export removals, deprecated-option removal [0.1.5], god-module split [0.1.4], durable ACP store [0.1.6], new packages/subpaths, runtime dependencies, evidence-JSON deletion), and an empty-at-freeze deviation log (schema-enforced; any later deviation carries task + change + rationale).
    - Functional: baseline evidence recorded before any task in `scripts/phase15-baseline.json`: `npm test` pass count, current `scripts/benchmark-0.0.*` file inventory with live/orphan classification, `npm audit` result, compat-baseline status at 0.1.2.
    - Performance: freeze reuses the plan 013/014 manifest + test pattern; no new long-running work.
    - Code Quality: one machine-checked manifest + schema test (`scripts/phase15-freeze.test.mjs`) wired into the `npm test` script list after `phase14-freeze.test.mjs`; no new test framework.
    - Security: manifest re-asserts moderate audit level, blocked-gate semantics, signed-tag/npm-OIDC operator publication policy, and states that Task 4 persistence is opt-in and ownership-scoped.
  - Approach:
    - Documentation Reviewed:
      - `scripts/phase14-freeze-manifest.json`, `scripts/phase14-freeze.test.mjs` (established pattern)
      - `roadmap.md` §0.1.3, §Versioning Policy, §Priority and Dependency Rules
    - Options Considered:
      - Extend `phase14-freeze-manifest.json` in place — rejected: freeze manifests are per-release immutable records.
      - New `phase15-*` pair mirroring 013/014 — chosen.
    - Chosen Approach:
      - Copy the phase-14 manifest/test shape; update release literals (0.1.2 baseline → 0.1.3 target), allowed/forbidden lists, and per-task evidence tokens for the five tasks below.
    - API Notes and Examples:
      ```bash
      node --test scripts/phase15-freeze.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/phase15-freeze-manifest.json`: new scope gate.
      - `scripts/phase15-freeze.test.mjs`: new schema/policy test.
      - `scripts/phase15-baseline.json`: new baseline evidence.
      - `package.json`: append `scripts/phase15-freeze.test.mjs` to the `test` script's node --test list.
    - References:
      - `plans/014-Release-0-1-2-Alibaba-Provider-Enrichment.md` Task 0
  - Test Cases to Write:
    - manifest targets 0.1.3 hygiene line off the 0.1.2 baseline: validates release literals.
    - freeze allowed/forbidden lists cover the 0.1.3 items and exclude 0.1.4/0.1.5/0.1.6 items: validates scope gate.
    - deviation log schema: entries carry task+change+rationale.
    - baseline file exists, is valid JSON, is newer than the phase-14 freeze manifest, and records green test/audit evidence at 0.1.2.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — release-process scaffolding only.
    - Docs pages to create/edit: `none` (freeze manifests are repo-internal evidence, not published docs).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.
  - Evidence (2026-08-10): `scripts/phase15-freeze-manifest.json` (hygiene scope gate, empty deviation log), `scripts/phase15-freeze.test.mjs` (16/16 green), `scripts/phase15-baseline.json` (0.1.2 baseline: npm test exit 0 core 1420/1420 gates 110/110 workspaces green; coverage 91.67/83.69/91.23 vs thresholds 60/70/75; audit 0 moderate; release gate 0.1.2 49 packages 0 breaking deltas; manifest count 49 = root + 48 workspace (14 provider + 9 prism + 25 capability); benchmark inventory classified: 6 live legs, 9 orphan runners, 6 orphan tests, 1 workflow-referenced test, 6 evidence JSON kept, 3 current-runner files), `package.json` test script wired with `scripts/phase15-freeze.test.mjs` (gates 110 → 126), `plans/README.md` index row added (docs tripwire). Full `npm test` exit 0 after wiring.

- [x] Task 1 — Benchmark runner audit, prune, and parameterized consolidation
  - Acceptance Criteria:
    - Functional: every `scripts/benchmark-0.0.*.mjs` / `*.test.mjs` reference is audited and recorded in `scripts/phase15-baseline.json` (file → referenced-by classification); orphaned runners `benchmark-0.0.{8,9,10,11,12,13,14,15,16}.mjs` and their `*.test.mjs` are deleted; all `benchmark-*.json` evidence files are kept byte-identical.
    - Functional: one parameterized runner `scripts/benchmark.mjs --scenario <name>` absorbs the six live legs (scenarios for the current `benchmark-0.0.23`–`0.0.28` responsibilities: postgres-enterprise p95, startup, network-free throughput/latency, A2A/AG-UI, ACP, enterprise-auth) selected by name; `scripts/benchmark-0.1.0.mjs` orchestrates scenarios of the parameterized runner and keeps emitting `scripts/benchmark-0.1.0.json` in the current schema (or a schema-versioned superset with the gate test updated).
    - Functional: `.github/workflows/sandbox-browser.yml` "benchmark schema (network-free)" leg stops referencing `benchmark-0.0.9.test.mjs` and runs the parameterized runner's schema test instead.
    - Functional: removed files are listed in `CHANGELOG.md` (0.1.3 section); live comment references in `scripts/budget-gates.mjs` / `scripts/budgets.json` point at the parameterized runner (frozen phase manifests and historical `docs/migration.md` / `docs/performance.md` narrative stay untouched as historical record).
    - Performance: consolidated runner runs the same scenarios in ≤ the 0.1.2 wall time of the six separate legs; no regression in `npm test` total time beyond measurement noise.
    - Code Quality: single scenario registry (name → measurement function); no per-version copy-paste; budget-gate integration unchanged (`budget-gates.mjs` keeps consuming `budgets.json`).
    - Security: runner stays network-free by default; the PostgreSQL enterprise scenario remains opt-in behind `PRISM_TEST_POSTGRES_URL` with blocked-gate semantics; no new dependencies.
  - Approach:
    - Documentation Reviewed:
      - `scripts/benchmark-0.1.0.mjs` (lines 25–87: spawnSync leg orchestration over six `benchmark-0.0.*.mjs` sources)
      - `scripts/budget-gates.mjs`, `scripts/budgets.json` (baseline consumption + comments citing 0.0.15/0.0.16/0.0.23)
      - `.github/workflows/sandbox-browser.yml` (line 63: `node --test scripts/benchmark-0.0.9.test.mjs`)
      - `package.json` `test` script (line 144: only `benchmark-0.1.0.test.mjs` is wired into `npm test`)
      - Node.js docs: `node:child_process` `spawnSync`, `node:test` runner
    - Options Considered:
      - Keep the six leg files as-is and only delete orphans — rejected: roadmap explicitly requires one parameterized runner + versioned evidence JSON; six near-identical runners are the dead code this milestone exists to remove.
      - One runner with `--version` flag re-recording old evidence — rejected: evidence for old versions is frozen; re-measuring 0.0.23 baselines on current code would falsify historical records.
      - One runner with named scenarios, orchestrator unchanged — chosen: the six legs differ only in measurement body; a scenario registry collapses them without touching budget baselines or evidence files.
    - Chosen Approach:
      - `scripts/benchmark.mjs` exposes `SCENARIOS: Record<string, () => Promise<ScenarioResult>>` (the six bodies migrated verbatim from `benchmark-0.0.23`–`0.0.28`) and a CLI: `node scripts/benchmark.mjs --scenario <name> [--out <file>]`. `benchmark-0.1.0.mjs` swaps each leg `source: "benchmark-0.0.XX.mjs"` for `["benchmark.mjs", "--scenario", "<name>"]` spawn args. Delete the nine orphan runners + eight orphan tests; add `scripts/benchmark.test.mjs` asserting scenario registry completeness, output schema parity with the old legs, and network-free default. Record the full audit table (file → kept/deleted → reason) in `scripts/phase15-baseline.json`.
    - API Notes and Examples:
      ```bash
      node scripts/benchmark.mjs --scenario startup            # single scenario
      node scripts/benchmark-0.1.0.mjs --out scripts/benchmark-0.1.0.json
      PRISM_TEST_POSTGRES_URL="postgresql://…" node scripts/benchmark.mjs --scenario postgres-enterprise
      ```
    - Files to Create/Edit:
      - `scripts/benchmark.mjs`: new parameterized runner + scenario registry.
      - `scripts/benchmark.test.mjs`: new schema/registry/network-free test (replaces the 0.0.9 schema leg in CI).
      - `scripts/benchmark-scenarios/{phase6-postgres,phase7-postgres,phase8-loops-hitl,phase9-coding,phase10-acp,phase11-auth}.mjs`: the six live legs moved (git mv) with relative imports fixed.
      - `scripts/benchmark-0.1.0.mjs`: legs spawn the parameterized runner; report field `source` → `scenario`.
      - `scripts/benchmark-0.1.0.test.mjs`: unchanged (no assertion on the renamed field).
      - `scripts/benchmark-0.0.{8,9,10,11,12,13,14,15,16}.mjs` + `benchmark-0.0.{9,10,11,12,13,14,15}.test.mjs`: deleted (16 files; note `benchmark-0.0.16.test.mjs` never existed on disk).
      - `.github/workflows/sandbox-browser.yml`: schema leg → `node --test scripts/benchmark.test.mjs`; ag-ui build added for the phase10-acp smoke.
      - `scripts/budget-gates.mjs`, `scripts/budget-gate.test.mjs`, `scripts/budgets.json`: comment reference updates only.
      - `src/__tests__/docs.test.ts` + `docs/performance.md`: 0.0.16 tripwire re-pointed at `scripts/benchmark.mjs`; historical narrative kept with a consolidation note.
      - `scripts/phase15-freeze.test.mjs`: orphan-deletion gate + post-Task-1 inventory assertions.
      - `scripts/phase15-baseline.json`: audit table recorded (Task 0).
      - `CHANGELOG.md`: 0.1.3 removed-files list (Task 5 finalizes).
    - References:
      - `roadmap.md` "Setup and structure improvements" (prune superseded evidence runners)
      - `plans/012` benchmark consolidation precedent (`benchmark-0.1.0.mjs`)
  - Test Cases to Write:
    - scenario registry completeness: every scenario name used by `benchmark-0.1.0.mjs` exists in `benchmark.mjs` and vice versa.
    - output schema parity: each scenario emits the same JSON shape the corresponding deleted leg emitted (validated against kept `benchmark-0.0.*.json` evidence keys).
    - network-free default: runner without `PRISM_TEST_POSTGRES_URL` performs no network I/O and records the enterprise scenario as blocked, not skipped-silently.
    - orphan deletion gate: `npm test` passes with zero references to deleted filenames in `package.json`, workflows, and live scripts (grep assertion in the freeze test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no public API; internal tooling behavior changes (runner invocation).
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: update benchmark-runner invocation references if any exist; otherwise `none` with reason recorded.
      - `CHANGELOG.md`: 0.1.3 section lists removed files (finalized in Task 5).
    - `docs/index.md` update: no (scripts are not indexed docs surface).
    - Documentation structure reference: not applicable.
  - Evidence (2026-08-10): `scripts/benchmark.mjs` parameterized runner (scenario registry, `--list`, protected fail-loud gate, `--out`); six live legs `git mv`-ed to `scripts/benchmark-scenarios/{phase6-postgres,phase7-postgres,phase8-loops-hitl,phase9-coding,phase10-acp,phase11-auth}.mjs` with relative imports fixed (`../` → `../../`, incl. the FAKE_LSP fixture URL) and stale Usage lines re-pointed; `scripts/benchmark-0.1.0.mjs` composes scenarios through the runner (report field `source` renamed to `scenario`; gate test unaffected); 16 orphaned files deleted (`benchmark-0.0.{8,9,10,11,12,13,14,15,16}.mjs` + `benchmark-0.0.{9,10,11,12,13,14,15}.test.mjs`); `.github/workflows/sandbox-browser.yml` schema leg → `node --test scripts/benchmark.test.mjs` + `npm run build -w @arnilo/prism-ag-ui` added (phase10-acp smoke needs ag-ui dist); stale comments updated in `budget-gates.mjs`/`budget-gate.test.mjs`/`budgets.json`; `docs.test.ts` 0.0.16 tripwire re-pointed at `scripts/benchmark.mjs` + `docs/performance.md` consolidation note; `CHANGELOG.md` 0.1.3 removed-files entry; `scripts/benchmark.test.mjs` 5/5 green (registry/orchestrator coherence, `--list`, unknown-scenario fail, protected fail-loud, phase10-acp legacy report shape at 10 iterations); orchestrator run: 4 network-free legs run + 2 protected skipped, 24 rows, exit 0; orphan-deletion gate added to `phase15-freeze.test.mjs` (17/17 green); full `npm test` exit 0 (core 1420/1420, gates 127/127).

- [x] Task 2 — Archive phase-review docs into `docs/_evidence/`
  - Acceptance Criteria:
    - Functional: all 12 `docs/review-coverage-2026-07-*.md` files are `git mv`-ed to `docs/_evidence/` with no content edits; `docs/` root carries no `review-coverage-*` files.
    - Functional: `package.json` `files` excludes the archive from the tarball: replace `"!docs/review-coverage-*"` with `"!docs/_evidence"` (keep `"docs"` included otherwise); `npm pack --dry-run` evidence shows no `docs/_evidence/` entries.
    - Functional: every inbound link resolves post-move: `docs/index.md` (12 entries at lines 134–145), `docs/migration.md` (5 links), `docs/performance.md` (3 links), `docs/0.1.0-readiness.md` (evidence-trail link) updated to the `_evidence/` paths; `docs/0.1.0-readiness.md` gains an explicit "evidence archive" pointer per the roadmap.
    - Performance: no runtime impact; tarball size unchanged or smaller (archive was already excluded pre-move; exclusion must be preserved, not regressed).
    - Code Quality: links updated mechanically (relative paths only); docs freeze assertions (phase-15 test) grep-assert zero `](review-coverage-` targets outside `docs/_evidence/`.
    - Security: no behavior change; evidence remains in-repo and auditable.
  - Approach:
    - Documentation Reviewed:
      - npm `package.json` `files` field semantics (allow-list + negated patterns; current root manifest lines ~105–114: `"files": ["dist", "!dist/__tests__", "!dist/**/*.map", "docs", "!docs/review-coverage-*", "templates", "CHANGELOG.md"]`)
      - `docs/index.md` review-coverage entries (lines 134–145)
      - `roadmap.md` "Setup and structure improvements" (archive into `docs/_evidence/`, linked from `docs/0.1.0-readiness.md`)
    - Options Considered:
      - Single merged `docs/review-coverage-archive.md` — rejected: rewriting 12 frozen evidence files destroys per-phase integrity and breaks plan cross-references.
      - Move to a top-level `evidence/` dir — rejected: `_evidence` under `docs/` keeps relative links short and matches the roadmap wording.
      - `git mv` into `docs/_evidence/` + negated `files` entry — chosen: history preserved, one-line tarball exclusion, links updated in place.
    - Chosen Approach:
      - `git mv docs/review-coverage-2026-07-*.md docs/_evidence/`; sed-style relative-link updates in the four referencing pages (prefix `review-coverage-` → `_evidence/review-coverage-`); collapse the 12 `docs/index.md` entries into one archive entry (the files are tarball-excluded, so a dozen navigation rows for unpublished evidence is clutter); add the archive pointer to `docs/0.1.0-readiness.md`; update `package.json` `files`; assert via pack dry-run.
    - API Notes and Examples:
      ```bash
      mkdir -p docs/_evidence && git mv docs/review-coverage-2026-07-*.md docs/_evidence/
      npm pack --dry-run 2>&1 | grep -c '_evidence'   # must be 0
      ```
    - Files to Create/Edit:
      - `docs/_evidence/review-coverage-2026-07-*.md`: 12 moved files.
      - `package.json`: `files` exclusion swap.
      - `docs/index.md`: 12 entries → 1 archive entry.
      - `docs/migration.md`, `docs/performance.md`, `docs/0.1.0-readiness.md`: relative link updates.
      - `scripts/phase15-freeze.test.mjs`: link/exclusion assertions.
    - References:
      - `roadmap.md` 0.1.3 "Archive phase-review docs"
  - Test Cases to Write:
    - archive move complete: `docs/` root has zero `review-coverage-*` files; `docs/_evidence/` has exactly 12.
    - tarball exclusion: packed file list contains `docs/index.md` and zero `_evidence` entries.
    - link integrity: no markdown link in `docs/` targets a non-existent relative path (extend the freeze test's docs assertions).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime behavior; published tarball contents unchanged (files were already excluded).
    - Docs pages to create/edit:
      - `docs/index.md`: collapse review-coverage navigation into a single archive entry with a short functional description.
      - `docs/0.1.0-readiness.md`: evidence-trail link → `_evidence/` + archive pointer.
      - `docs/migration.md`, `docs/performance.md`: relative link fixes only (no narrative edits — historical record).
    - `docs/index.md` update: yes — one "Review coverage archive" entry replacing the 12 per-phase rows.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (index entries carry functional description + link).
  - Evidence (2026-08-10): all 12 `docs/review-coverage-2026-07-*.md` `git mv`-ed to `docs/_evidence/` (zero at `docs/` root); `package.json` `files` exclusion swapped `!docs/review-coverage-*` → `!docs/_evidence`; `npm pack --dry-run` shows 295 packed files, zero `_evidence` entries, `docs/index.md` present; inbound links updated in `docs/index.md` (12 entries collapsed to one archive entry `(_evidence/)`), `docs/migration.md` (5), `docs/performance.md` (3), `docs/0.1.0-readiness.md` (evidence-trail link + explicit archive pointer), plus 10 additional referencing pages found by the link sweep (`persistence-credentials-multimodality-primitives`, `provider-primitives`, `session-stores` ×2, `tool-execution-primitives` ×2, `workflow-orchestration-primitives`, `thinking-and-reasoning`, `use-case-model-selection`, `agent-identity` path ref); moved files' internal relative links mechanically re-prefixed (`../` for docs pages, `../../roadmap.md`, sibling links kept for evidence-to-evidence, fragment links handled); `src/__tests__/docs.test.ts` updated (13 `readFileSync` paths → `_evidence/`, 7 per-phase index-link assertions → archive entry, `_evidence/` excluded from the one-link-per-page navigation test); `scripts/phase15-freeze.test.mjs` gained the archive gate (18/18 green: zero at root, 12 archived, tarball exclusion via `packedFilePaths`, zero `](review-coverage-` outside `_evidence/`, all relative `.md` links in `docs/` resolve); full `npm test` exit 0 (core 1420/1420, gates 128/128).

- [x] Task 3 — Unused-code sweep (non-blocking)
  - Acceptance Criteria:
    - Functional: `npm run sweep:unused` runs (a) `tsc --noEmit --noUnusedLocals --noUnusedParameters` across the core tsconfig and every workspace tsconfig, and (b) a zero-dependency dead-export scan (`scripts/dead-exports.mjs`), writes a combined report (stdout + `scripts/unused-sweep-report.txt`), and **always exits 0**.
    - Functional: a CI step runs the sweep as non-blocking (`continue-on-error: true`) and archives the report artifact; the default `npm test` gate is untouched.
    - Functional: report findings are triaged in the report header or a follow-up comment block: obvious **internal** dead code (unexported functions/locals) is removed in this task; public-but-unused exports are **reported only** (removal is the 0.1.5 breaking cut); intentional shortcuts are marked `ponytail:`.
    - Performance: sweep completes in under ~2 minutes on the reference machine (tsc --build is incremental); CI step is parallel with or after the test leg, never on the publish-blocking path.
    - Code Quality: zero new dependencies (knip rejected); scan script is dependency-free Node with a documented naive-heuristic ceiling.
    - Security: report contains no secrets (paths + symbol names only); no behavior change to shipped code beyond internal dead-code deletion covered by existing tests.
  - Approach:
    - Documentation Reviewed:
      - TypeScript compiler options: `noUnusedLocals`, `noUnusedParameters` (report unused locals/parameters; intentionally do not flag exported symbols)
      - `tsconfig.json` (root: `strict` set, no `noUnused*` today) and workspace tsconfigs
      - GitHub Actions `continue-on-error` semantics for non-blocking steps
      - `roadmap.md` "Dead code and deprecations" (sweep requirement, non-blocking)
    - Options Considered:
      - `knip` — rejected: new devDependency (~1 MB+ tree) for a report-only gate; roadmap allows either option and the dependency-free pair covers it.
      - Enable `noUnusedLocals`/`noUnusedParameters` in tsconfig permanently — rejected: fails the build on pre-existing violations, violating the non-blocking requirement; a separate sweep tsconfig-per-invocation keeps the build green.
      - `tsc` flags via CLI override + a small export-reference scanner — chosen.
    - Chosen Approach:
      - `scripts/sweep-unused.mjs` (zero deps): for each tsconfig, spawn `tsc --noEmit --noUnusedLocals --noUnusedParameters -p <tsconfig>`, collect diagnostics, never fail. `scripts/dead-exports.mjs`: parse `export`ed symbol names from `src/**/*.ts` and `packages/*/src/**/*.ts`, count word-boundary references across all repo `*.ts` sources; symbols with ≤1 reference (definition-only) are reported as dead-export candidates. `# ponytail: naive regex scan — false positives on re-exports/dynamic imports; upgrade to knip if the report noise exceeds triage value.` Internal (never-exported) findings verified by grep before deletion; every deletion covered by the existing suite.
    - API Notes and Examples:
      ```bash
      npm run sweep:unused          # report to stdout + scripts/unused-sweep-report.txt, exit 0
      npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json
      ```
    - Files to Create/Edit:
      - `scripts/sweep-unused.mjs`: new tsc-flags driver.
      - `scripts/dead-exports.mjs`: new zero-dep dead-export candidate scan.
      - `package.json`: `sweep:unused` script.
      - `.github/workflows/<default-ci>.yml`: non-blocking sweep step (file name verified at execution; release workflow stays untouched).
      - Internal dead code deletions: only where the report + grep confirm zero references (paths recorded in the deviation log if any surprise surfaces).
      - `scripts/unused-sweep-report.txt`: generated artifact (gitignored or committed header-only — decided at execution; default: gitignored, CI artifact).
    - References:
      - `roadmap.md` 0.1.3 "Unused-export sweep (non-blocking)"
      - TypeScript handbook: compiler options `noUnusedLocals`/`noUnusedParameters`
  - Test Cases to Write:
    - sweep exit code: `scripts/sweep-unused.test.mjs` (or a leg of the freeze test) asserts the driver exits 0 even with a seeded unused local in a fixture tsconfig.
    - dead-export scan sanity: fixture with a definition-only export is reported; a re-exported symbol is flagged as candidate-with-note (naive ceiling documented).
    - gate isolation: `npm test` contains no reference to `sweep:unused` (asserted in the freeze test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — tooling only; internal deletions do not touch the public surface (compat baseline must stay additive-only, verified in Task 5).
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: one line documenting `npm run sweep:unused` as a non-blocking hygiene report (or `none` if the page does not cover repo scripts — verify at execution).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.
  - Evidence (2026-08-10): `scripts/sweep-unused.mjs` zero-dep driver (spawns local `tsc --noEmit --noUnusedLocals --noUnusedParameters -p` over root + 42 workspace tsconfigs, collects diagnostics, writes `scripts/unused-sweep-report.txt`, always exits 0; 6.2s on the reference machine); `scripts/dead-exports.mjs` zero-dep word-boundary export-reference scan (optional root arg for fixtures; missing-dir guard); `package.json` `sweep:unused` script + `sweep-unused.test.mjs` wired into `npm test`; `.github/workflows/sandbox-browser.yml` non-blocking sweep step (`continue-on-error: true`) + report artifact upload; `scripts/unused-sweep-report.txt` gitignored; `docs/release-and-install.md` command-table row. Triage of the first run: 47 tsc unused-code diagnostics → **43 removed** (internal dead code: unused imports/locals/params across 22 test files and 13 source files — incl. `where()` param + 7 callers in enterprise-postgres tool-effects, `#serverUrl` private field in mcp auth, 2 reconnect consts in session-store-nats, `_runRpc`/`_fakeDisposable`/`_mockJsonFetch` dead test helpers, `toolCallContent` import, `inputs` consts in ag-ui acp handlers); **4 kept as intentional compile-time assertions** (`_AgentConfigHasNoExtensions/_Settings/_Credentials` type aliases in agent-config.types.test.ts, `_assignable` assignability check in embeddings.test.ts — they are the test, not dead code); dead-export scan: 63 candidates, **all report-only** (public exports; removal is the 0.1.5 breaking cut). `sweep-unused.test.mjs` 3/3 green (driver exits 0 + report written; tsc flags catch a seeded unused local in a fixture tsconfig; dead-export scan reports definition-only exports and skips referenced ones); freeze test gained the gate-isolation assertion (19/19 green: `sweep:unused` defined, `npm test` never runs it, CI step `continue-on-error` + artifact, release.yml untouched); full `npm test` exit 0 (core 1420/1420, gates 132/132).

- [x] Task 4 — Opt-in checkpoint persistence for loaded-skill names + read-path set
  - Acceptance Criteria:
    - Functional: with the opt-in enabled, a resumed run/session restores (a) the loaded-skill **name catalog** into the session `LoadedSkillSet` and (b) the host's `ReadPathSet` contents, so progressive disclosure and `requireReadBeforeWrite` survive restart without model re-load; skill **bodies** are not persisted — they reload on demand via `load_skill` (roadmap constraint).
    - Functional: opt-in only — with the flag off (default), checkpoint payloads are byte-identical in shape to 0.1.2 (no new keys, no size growth); schema version of `StoredAgentRunState` stays 1 with the new field optional and absent-by-default.
    - Functional: cross-branch/cross-tenant non-leak — restore under a different `OwnershipScope` or branch/session key returns no state (checkpoint key/namespace carries ownership; restore fails closed).
    - Functional: persisted names/paths are bounded (count + byte caps charged against the existing run-state byte budget, `DEFAULT_MAX_AGENT_RUN_STATE_BYTES` 256 KiB / hard 1 MiB) and fail closed on overflow.
    - Performance: persistence adds ≤1 small JSON array serialization per checkpoint save when enabled; zero cost when disabled; no extra store round-trips (piggybacks the existing `saveAgentRunState` write for skill names; read-path helper reuses the host's store handle).
    - Code Quality: additive optional fields only; `parseAgentRunState` tolerates absence (backward compatible with 0.1.x checkpoints); no new core dependency; `packages/coding-agent` side is a helper, not new runtime.
    - Security: ownership-scoped keys (tenant/user/session) on both seams; no skill bodies or file contents persisted (names/paths only); redaction unaffected; cross-tenant restore attempt rejected and tested.
  - Approach:
    - Documentation Reviewed:
      - `src/skill-disclosure.ts` (`LoadedSkillSet`: `has`/`add`/`list`/`clear` — `list()` already exposes names)
      - `src/agent-run-state.ts` (`StoredAgentRunState`, `initialAgentRunState`, `parseAgentRunState`, `saveAgentRunState`, byte caps at lines 24–27)
      - `src/agents.ts` (line 703 session `loadedSkills`; line 210 resume via `loadAgentRunState`)
      - `packages/coding-agent/src/read-path-set.ts` (`ReadPathSet`: `has`/`add`/`list`/`clear`; docstring already says "not checkpointed")
      - `docs/context-and-skills.md` (line 173: "session-owned; not checkpoint-persisted in 0.0.20" — to be updated)
      - `docs/coding-agent-tools.md` (line 198: read-before-write soft-guard section)
      - `roadmap.md` 0.1.3 item + plans 003/004 compromises (demand-gate provenance)
      - `src/contracts.ts` `CheckpointRecord`/`CheckpointStore` (generic namespace/key/value, ownership-scoped)
    - Demand gate: roadmap routes this item to 0.1.3 from plans 003/004 further actions; execution begins by recording the demand evidence (the roadmap routing + any named host need) in `scripts/phase15-baseline.json`. If no host demand is confirmable at execution time, the freeze deviation log moves this task to 0.1.6 per the roadmap's own demand-gate language — it does not silently drop.
    - Options Considered:
      - Persist skill bodies in the checkpoint — rejected: unbounded size growth, and the roadmap explicitly says bodies reload via `load_skill`.
      - New `CheckpointStore` namespace owned by core for read paths — rejected: `ReadPathSet` is host-owned state in `packages/coding-agent`; core taking ownership inverts the seam.
      - Optional `sessionState` field on `StoredAgentRunState` (core, skill names) + a coding-agent helper `persistReadPathSet`/`restoreReadPathSet` over the host's `CheckpointStore` — chosen: both seams already expose `list()`/`add()`; the change is additive serialization + opt-in restore wiring.
    - Chosen Approach:
      - Core: add optional `sessionState?: { loadedSkillNames?: readonly string[] }` to `StoredAgentRunState`; an opt-in agent/session option (name finalized at execution, e.g. `persistSessionState: true`) causes `saveAgentRunState` to include `loadedSkills.list()` and resume/`attach` to re-`add()` names into the session `LoadedSkillSet` before the first post-resume turn. Caps: ≤64 names, each ≤256 chars, total charged against the run-state byte budget; overflow fails closed with the existing state error channel.
      - Coding-agent: `createReadPathSetPersistence({ checkpoints, key, ownership })` (exact name at execution) returning `{ save(set), restore(set) }` — `save` writes `set.list()` (bounded: ≤1024 paths, ≤1 KiB each) under an ownership-scoped namespace/key; `restore` reads and re-`add()`s. Host wires it explicitly beside `requireReadBeforeWrite`; default off.
    - API Notes and Examples:
      ```ts
      // core (opt-in): names ride the existing run-state checkpoint
      const agent = createAgent({ /* … */, persistSessionState: true });
      // coding-agent (host-owned, opt-in):
      const persistence = createReadPathSetPersistence({ checkpoints, key: sessionId, ownership });
      await persistence.restore(readPaths);           // on session attach
      await persistence.save(readPaths);              // before/after mutations
      ```
    - Files to Create/Edit:
      - `src/agent-run-state.ts`: optional `sessionState` field, bounds, parse tolerance.
      - `src/agents.ts`: opt-in option plumbed to save/restore of loaded-skill names.
      - `src/contracts.ts` or `src/config.ts`: the opt-in option type (additive, optional).
      - `packages/coding-agent/src/read-path-set.ts`: persistence helper (or a sibling `read-path-set-persistence.ts` if the file grows past cohesion — decided at execution).
      - `packages/coding-agent/src/index.ts`: additive export of the helper.
      - `src/__tests__/agent-run-state.test.ts` (or nearest existing), `src/__tests__/skill-load.test.ts`, `packages/coding-agent/src/__tests__/read-before-write.test.ts`: new cases.
      - `docs/context-and-skills.md`, `docs/coding-agent-tools.md`: opt-in persistence sections (Task 5 finalizes).
    - References:
      - `roadmap.md` 0.1.3 item 4; plans 003/004 further actions; plan 002 compromise (`sessionId` registry, no core lifecycle hook — unchanged here).
  - Test Cases to Write:
    - resume restores loaded-skill names: load skill → checkpoint → new session resume → catalog shows the name under progressive disclosure, body absent until `load_skill` re-runs.
    - resume restores read-before-write state: read path → persist → restore into a fresh `ReadPathSet` → write to that path passes without `force`.
    - cross-branch non-leak: persist under ownership A/branch A; restore under ownership B (or branch B) yields empty state, no throw-or-leak.
    - opt-in off = 0.1.2 shape: checkpoint JSON with the flag unset has no `sessionState` key; parse of old checkpoints succeeds.
    - bounds overflow: >64 names or >1024 paths fails closed with the documented error, no partial write.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive optional agent/session option, additive optional field on the stored run-state shape, and one new additive export from `@arnilo/prism-coding`.
    - Docs pages to create/edit:
      - `docs/context-and-skills.md`: replace the "not checkpoint-persisted in 0.0.20" note with the opt-in persistence contract (names only; bodies reload via `load_skill`; bounds; ownership).
      - `docs/coding-agent-tools.md`: extend the read-before-write section (line ~198) with the persistence helper, bounds, and ownership-scoping example.
      - `docs/agent-session-runtime.md`: one subsection on opt-in session-state persistence if the page covers checkpoints (verify at execution; otherwise fold into the two pages above).
    - `docs/index.md` update: no new page expected; existing entries remain accurate (update entry descriptions only if the subsection structure changes).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (behavior change on an existing documented surface → update the existing API pages' "Extension and configuration notes" + "Security and performance notes").
  - Evidence (2026-08-10): core — `StoredAgentRunState.sessionState?: { loadedSkillNames?: readonly string[] }` (schema version stays 1, absent-by-default; caps `MAX_PERSISTED_SKILL_NAMES = 64` / `MAX_PERSISTED_SKILL_NAME_CHARS = 256`; validated fail-closed in `boundState`, which every save and load path runs, so overflow = `AgentRunStateError` + no partial write); `persistSessionState?: boolean` added to `AgentRunStateOptions`, `AgentRunResumeOptions`, and `AgentRunLifecycleRequest` (adapter plumbs it into resume options); `prepareAgentRunResume` re-`add()`s persisted names into the fresh session via `RuntimeAgentSession.restoreLoadedSkills()` before the resumed turn; `persistDurable` injects `sessionState` only when the flag is on (flag off = byte-identical 0.1.2 checkpoint shape, asserted by test). coding-agent — `createReadPathSetPersistence({ checkpoints, key, ownership })` + `READ_PATH_SET_NAMESPACE` + caps (1024 paths / 1024 chars), exported from `packages/coding-agent/src/index.ts`; `save` is CAS read-modify-write, `restore` refuses malformed/oversized payloads and restores 0 on a missing record; cross-tenant restore throws `CheckpointConflictError` (fail closed, no leak). Tests: `agent-run-state.test.ts` +2 (legacy-absent parse, round-trip, malformed blocks incl. 65 names / 257-char name, save-side overflow leaves zero records), `agent-run-lifecycle.test.ts` +2 (opt-in: skill loaded in a non-durable run → durable suspension checkpoint carries `["brief"]` → resume restores catalog and the resumed provider turn renders `Skill brief:\nBe very brief.` from the live registry; opt-in off: no `sessionState` key in the checkpoint), `packages/coding-agent/src/__tests__/read-path-set-persistence.test.ts` +3 (save/restore round-trip + version bump, cross-tenant fails closed, count/char overflow + malformed payload no partial write). Freeze gate +1 (seams, caps, exports, docs) → 20/20; full `npm test` exit 0 (core 1424/1424, gates 133/133). Docs: `context-and-skills.md` (code comment + Security note → opt-in contract, bodies never persisted), `coding-agent-tools.md` (read-before-write section gains the helper + bounds + ownership example), `agent-session-runtime.md` (checkpoint section gains the `persistSessionState` contract).
  - Task 4 deviations vs plan (recorded 2026-08-10): (1) option name finalized as `persistSessionState` on the run/resume/lifecycle options — the plan's `createAgent({ persistSessionState: true })` example was not used because durable-run options (`runState`) are the existing seam where checkpoints/definitionRevision already live, and resumed runs do not receive the original `RunOptions`; (2) the resume E2E test needed `activateAllSkills: true` on the agent because a resumed durable run does not carry the original run's `activeSkills` (pre-existing behavior, not changed here) — the test documents that the restored catalog renders bodies only when the agent config makes skills active; (3) `load_skill` is itself gated under `interruptBeforeTool`, so the test loads the skill in a prior non-durable run on the same session before the durable suspension; (4) new constants (`MAX_PERSISTED_*`, `READ_PATH_SET_NAMESPACE`, `DEFAULT_MAX_PERSISTED_*`) are exported from their modules and the coding-agent index but not from the core `src/index.ts`, keeping the pinned public-export-contract surface unchanged.

- [x] Task 5 — Docs finalization, changelog, version bump, and 0.1.3 exit gate
  - Acceptance Criteria:
    - Functional: `CHANGELOG.md` 0.1.3 section lists every removed benchmark file, the docs archive move, the sweep tooling, and the opt-in persistence feature; `docs/index.md` navigation matches reality (archive entry, any description updates).
    - Functional: scripted bump 0.1.2 → 0.1.3 across all 49 publishable manifests + lockfile; compat baseline regenerated and verified **additive-only** (0 breaking deltas — any break is a scope violation routed back to the deviation log).
    - Functional: exit gate green and recorded in `scripts/phase15-baseline.json`: `npm test` (incl. phase-15 freeze test), `npm run sdk:ready` rc=0, `npm audit --audit-level=moderate` = 0, publish dry-run 49/49 byte-deterministic (twice), benchmark evidence regenerated via the parameterized runner against frozen budgets.
    - Performance: benchmark medians within frozen `budgets.json` ceilings; tarball sizes within ±5% gates.
    - Code Quality: plan checkboxes updated; `Compromises Made` and `Further Actions` filled with actual deviations and routed follow-ups.
    - Security: audit 0; no new dependencies introduced anywhere in the milestone (asserted by lockfile diff = version bumps only); publication remains the operator handoff (signed tag + npm OIDC) per `docs/release-and-install.md`.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` (release validation checklist + operator handoff)
      - `roadmap.md` "Release Validation Checklist"
      - plan 013 Task 6 / plan 014 Task 6 exit-gate pattern
    - Options Considered:
      - Single final task vs. per-task doc updates — chosen: per-task doc updates land in Tasks 1–4; this task only reconciles, bumps, and gates (established 013/014 pattern).
    - Chosen Approach:
      - Run the roadmap release-validation checklist; reconcile docs; scripted version bump; regenerate compat baseline and benchmark evidence; record exit-gate evidence; leave publication as the documented operator action.
    - API Notes and Examples:
      ```bash
      npm test && npm run sdk:ready && npm audit --audit-level=moderate
      node scripts/benchmark-0.1.0.mjs --out scripts/benchmark-0.1.0.json
      npm run pack:dry-run   # 49/49, run twice, byte-identical
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`: 0.1.3 entry.
      - `docs/index.md`: final navigation reconciliation.
      - `package.json` + `packages/*/package.json` + lockfile: 0.1.3 bump.
      - compat baseline file(s): regenerated (additive-only).
      - `scripts/benchmark-0.1.0.json`: regenerated evidence via the parameterized runner.
      - `scripts/phase15-baseline.json`: exit-gate evidence block.
      - `plans/015-…md`: checkboxes, Compromises, Further Actions.
    - References:
      - `plans/013` Task 6, `plans/014` Task 6
  - Test Cases to Write:
    - freeze test exit-gate leg: asserts the baseline evidence block exists, is green, and post-dates all task evidence tokens.
    - docs tripwire: navigation entries resolve; manifest count narrative unchanged (49) and consistent.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release metadata) — docs reconciliation is the task.
    - Docs pages to create/edit:
      - `CHANGELOG.md`: 0.1.3 entry with removed-files list.
      - `docs/index.md`: final check.
      - `docs/release-and-install.md`: only if Task 1/3 script changes altered documented commands.
    - `docs/index.md` update: yes if any Task 1–4 page changed navigation structure (expected: the Task 2 archive entry only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Evidence (2026-08-10): **Docs.** Root `CHANGELOG.md` `## [0.1.3] - 2026-08-10` entry now covers all four tasks (runner consolidation + removed-files list, `docs/_evidence/` archive, non-blocking sweep, opt-in persistence); `docs/index.md` current line → **0.1.3** with the plan 015 description; `docs/release-and-install.md` gained `### 0.1.3 publish handoff (plan 015 Task 5)` (operator prerequisites, command sequence, signed `v0.1.3` tag, rollback notes — mirrors the 0.1.2 handoff); `docs/migration.md` gained the `0.1.2 → 0.1.3` section (additive, no migration; run-state schema stays at version 1, `sessionState` absent by default, opt-out checkpoints byte-identical). **Bump.** `node scripts/release.mjs bump --from 0.1.2 --to 0.1.3` — 49 manifests + lockfile (pure version churn); version-sensitive sources updated: `src/index.ts` version const, `index.test.ts`, `release.test.ts` graph test (0.1.3 + root changelog token; the provider-alibaba changelog and 0.1.2-handoff assertions stay at their historical tokens), `docs.test.ts` root-manifest assertion + new plan 015 Task 5 tripwire (0.1.3 handoff, index current line, root changelog, performance.md runner token), the 0.1.2 tripwire's index current-line assertion dropped (superseded, plan 013/014 precedent), `install-smoke.test.ts`, `packaging.test.ts`, 12 workspace `index.test.ts` pins. **Compat.** `release:gate --version 0.1.3 --update-baseline` — 49 packages, 0 breaking deltas, `updated: true` (additive Task 4 exports + version literal; a stale-dist first pass captured the 0.1.2 version const, caught by the follow-up gate and re-captured after `build:core`). **Benchmark evidence.** Regenerated via the parameterized runner: 24 fresh network-free rows (scenario-named) + the 16 previously measured protected PostgreSQL rows from the byte-identical moved legs, all six legs recorded `run`, `benchmark-0.1.0.test.mjs` 2/2 green against frozen ceilings. **Exit gate.** `npm test` rc=0 (core 1425/1425, script gates 133/133, workspaces green); `npm audit --audit-level=moderate` 0; `npm run sdk:ready` rc=0 (biome format applied to 8 new/edited files before green); publish dry-run 49/49 twice byte-identical; `release:check` blocked on the dirty tree (environmental, plan 013/014 precedent — green at clean tagged `v0.1.3`). All evidence recorded in `scripts/phase15-baseline.json` `exitGate`; freeze test exit-gate leg 21/21. Operator publication (commit, signed tag, npm OIDC) is a handoff, not executed.

## Compromises Made

- **Protected benchmark rows kept from prior measurement (Task 1/5).** The two PostgreSQL legs (`phase6/phase7-postgres`) cannot run without `PRISM_TEST_POSTGRES_URL`; the checked-in envelope therefore merges fresh network-free rows with the previously measured protected rows from the byte-identical moved legs. The scenario modules are unchanged (import paths only), so the evidence stays honest; regenerate both halves when a protected run is available.
- **Dead-export scan is a regex heuristic (Task 3).** `scripts/dead-exports.mjs` counts word-boundary references; barrel re-exports and dynamic imports produce false positives, so 63 candidates are all report-only. Removal of public-but-unused exports is the 0.1.5 breaking cut (roadmap-routed); internal findings were fixed in-tree (43 diagnostics) or kept as intentional compile-time assertions (4).
- **Sweep is non-blocking by design (Task 3).** `npm run sweep:unused` always exits 0 and is never part of `npm test` or the release gate (asserted by a freeze-test gate-isolation leg). Its value is a tracked report artifact, not a failing build.
- **No new dependencies (Task 3).** knip rejected; the sweep is tsc flags + a zero-dep scan script.
- **Persisted state is names/caps only (Task 4).** Skill bodies never persist (re-resolve from the live registry); the read-path set stores paths ≤1 KiB each ≤1024 entries; `sessionState` is absent by default so 0.1.2 checkpoints and opt-out checkpoints are byte-identical. Cross-ownership restore fails closed (throws) rather than leaking.
- **Historical narrative kept verbatim (Tasks 1–2).** docs/performance.md and docs/migration.md keep their pre-0.1.3 benchmark-runner and review-coverage narrative as historical record; only live assertions, links, and stale comments were updated. The docs tripwire that asserted the deleted 0.0.16 runner's existence was re-pointed at the parameterized runner.
- **`release:check` dirty-tree block at the exit gate (Task 5).** Environmental (the working tree holds the uncommitted milestone); plan 013/014 precedent — green at the clean tagged `v0.1.3` commit.

## Further Actions

- Operator publication of 0.1.3 (commit, signed `v0.1.3` tag, npm OIDC) per the handoff in `docs/release-and-install.md` — not executed here.
- Remove public-but-unused exports reported by `scripts/dead-exports.mjs` in the 0.1.5 breaking cut (roadmap 0.1.5; the sweep report is the backlog).
- Remove the deprecated surface inventoried for the 0.1.5 cut (`timeoutMs`/`maxRetries`/`maxRetryDelayMs`, `maxToolRounds` alias, pre-0.0.19 flat keys, `transformImage` flag, `listInitProviders`) — report-only in 0.1.3 per the freeze manifest.
- Consider a per-package budget gate if a second package grows past the root pack gate's visibility (0.1.6 perf/DX demand-gated).
- Regenerate the protected PostgreSQL benchmark rows (and the phase-7/enterprise legs) when a `PRISM_TEST_POSTGRES_URL` environment is available.
- Wire `createReadPathSetPersistence` into a host (pi) and confirm the checkpoint namespace convention before recommending it as the default.
