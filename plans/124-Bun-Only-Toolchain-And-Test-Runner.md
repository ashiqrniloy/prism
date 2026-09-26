# Bun-Only Toolchain and Test Runner

Plan 1 of 6 for the Bun-only migration (with [125](125-Bun-Only-Runtime-Contract.md),
[126](126-Bun-Native-Sqlite.md), [127](127-Bun-Runtime-Concurrency-Performance.md),
[128](128-Test-Import-Migration.md), [129](129-Release-0-12-0.md)). Owner decision
(2026-09-25): consistency over two ecosystems — Prism's contributor toolchain, CI, and (plan 125)
consumer runtime all target Bun. Node stops being a required install for contributors.

This plan finishes what plans 113/115/117/119 deliberately left split. Plan 113 §12 already measured
the payload: `bun test --parallel` beats `node --test` on wall clock (root glob 11.9–12.9 s vs
13.7–14.0 s; prism-core leaf 2.15 s vs 3.67 s, 41 %). Two measured blockers kept stages on Node:
(1) Bun's path-suffix file matching pulls twin files (`dist/__tests__/content.test.js` also runs
`packages/mcp/dist/__tests__/content.test.js`), breaking the exactly-once partition; (2) worker
fanout perturbs real-time budget assertions in co-running leaves (memory 5 ms source-scan failed at
host load 5.97). Both are workable: no-path-argument discovery avoids suffix matching entirely, and
worker counts are bounded per stage exactly as `--test-concurrency=4` is bounded today.

## Objectives

- Every default-suite stage, gate, wrapper script, and CI workflow runs the Bun binary. No stage
  spawns `node`; no workflow step needs `actions/setup-node`. The only npm/Node invocations left in
  the repository after this plan are the release-host registry operations owned by plan 125.
- `bun test --parallel` (bounded) is the test runner for every stage except the host-contention
  budget gate, which stays single-process and solo by design.
- The exactly-once file partition survives: every test file in the tree runs exactly once per suite
  run, proven by a partition assertion, not by hope.
- The PostgreSQL evidence parser reads Bun's reporter output (TAP is gone with Node).
- Every absolute-time assertion (budget gate startup ceiling, tool-search 50 ms, redaction,
  wiki 5 ms source-scan, document extract 2000 ms) is recalibrated on the Bun instrument by plan
  023's method — never ported from Node numbers.
- The suite budget is re-pinned once, from measurement, in the marker + both doc statements.

## Expected Outcome

- `scripts/run-all-tests.mjs` `STAGES` names only `bun` (and `tsc`/`git`-style leaf commands);
  `scripts/run-all-tests.test.mjs` asserts that, the partition, and the per-stage worker bounds.
- `package.json` and `packages/*/package.json` scripts contain no `node ` or `npm run` invocations
  (release-host registry scripts stay npm — see plan 125 Task 5 — and live only in `release.yml`).
- All ten `.github/workflows/*.yml` install with `bun ci` and run steps with `bun`; `setup-node` is
  deleted from every workflow including `release.yml`'s publish job (runner images ship Node; the
  publish step documents that dependency instead of pinning it).
- `docs/_evidence/phase124-bun-only-inventory.md` holds the Task 1 transcripts: discovery-set truth,
  `--no-isolate` semantics, reporter output shape, native-module loads, timing tables.
- `docs/testing.md` stage table and `docs/release-and-install.md` budget sentence match the new
  runner reality; `src/__tests__/docs.test.ts` phrase pins follow.
- A contributor with only Bun 1.4.2 installed can install, build, and run the default suite green.
  Node is no longer on the contributor path.

## Tasks

- [x] Task 1: Measured inventory — discovery truth, isolation semantics, reporter shape, native modules (must run first)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase124-bun-only-inventory.md` exists with command transcripts for
      every probe below. `scripts/plan-review-gate.test.mjs` gains a `PLAN_124_TASK_1` block
      (plan path, evidence path, required tokens, rejected tokens) checked by `assertPrimitiveReview`.
    - Functional: file-discovery truth — with cwd at repo root, `bun test` with no path arguments
      discovers a file set recorded against `find . -name '*.test.{js,ts,mjs}'` restricted to the
      suites the runner owns (root dist, workspace dist, `scripts/` gates, examples). Record: the
      exact discovered set, whether `.mjs` gate files are included, whether `node_modules`/
      `dist`-outside-workspaces strays appear, and the twin-file count (expected 0 with no path
      arguments). Also record directory-argument behavior (`bun test dist/__tests__/`) — suffix
      matching may or may not apply to directories; the transcript decides. The chosen Task 2
      partition strategy cites this section.
    - Functional: `--no-isolate` semantics — run `scripts/wiki-scratch-isolation.test.mjs`'s nested
      scenario under `bun test --no-isolate` (one worker keeps one global across files) and under
      plain sequential `bun test` (single process). Record which reproduces `--test-isolation=none`'s
      guarantee (no process-worker IPC deserialization). If neither does, record the failure and the
      sequential fallback as the answer.
    - Functional: reporter shape — capture `bun test` output for a passing file, a failing file, and
      a file with skips: exact `(pass)`/`(fail)`/skip line formats, the summary line
      (`Ran N tests across M files`), and exit codes. This is the parser contract for Task 3.
    - Functional: native modules under Bun runtime — `bun -e` transcripts loading `better-sqlite3`
      (already measured, re-record), `pg`, `@napi-rs/keyring`, and `playwright-core`'s registry
      driver. Any load failure is a blocker recorded here, not discovered in Task 2.
    - Functional: `bun run` parity — run every root and workspace package.json script name through
      `bun run` once and record failures (expected none; `with-build-lock.mjs` under `bun` must
      acquire/drain its `O_EXCL` lock identically — one overlap probe with two concurrent children).
    - Functional: env hygiene — from a `bun test` parent, print the child env of a nested `bun test`
      and of a nested `bun scripts/with-build-lock.mjs` leaf; record whether any `BUN_*`/`NODE_TEST_*`
      variable leaks that a nested runner must strip.
    - Performance: timing table, ≥2 runs per candidate, same-session Node baselines (the runner's
      current stage commands): root+sqlite+workspace stages as one no-args discovery run vs today's
      three stages; gate suites `--parallel=4` vs `node --test --test-concurrency=4`; examples stage
      (Bun has no type stripper — the sequential-spawn rationale may be obsolete); budget gate solo.
    - Code Quality: transcripts and decision tables only; every row names a path or exit code.
    - Security: no credentials, no `PRISM_*` secret values, no absolute home paths in the evidence.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase113-bun-inventory.md` §12 and §12.1 (the `--parallel` measurements,
        suffix-match repro, reverted prism-core flip) and §1.5 (no `BUN_*` child env on 1.4.2).
      - `scripts/run-all-tests.mjs` (`STAGES`, `GATE_FILES`, `WORKSPACE_LEAVES`, pool bound 2);
        `scripts/with-build-lock.mjs` (lock protocol, `--shared` reader mode).
      - `docs/testing.md` stage table and nested-runner rules; `scripts/tooling-gate.test.mjs`
        (the `process.execPath` + Node-only-flag scan this plan retires).
      - https://bun.com/docs/test/parallel (`--parallel`, `--isolate`, `--no-isolate`,
        `--parallel-delay`, `--timings`) and `bun test --help` on 1.4.2 (verified locally).
      - `scripts/postgres-evidence.mjs` TAP regex (the parser Task 3 replaces).
    - Options Considered:
      - Rename the two suffix twins (`content.test.js`, `schema.test.js`) and keep explicit path
        arguments — rejected unless the no-args discovery probe fails: renames touch frozen
        partition controls to work around a matcher quirk discovery avoids for free.
      - Keep the Node/`bun` split — rejected: owner decision, consistency over two ecosystems.
      - Flip stages without re-measuring — rejected: repo rule, measurement before flip.
    - Chosen Approach: one evidence file freezing every decision input; Task 2 implements only rows
      it closed.
    - API Notes and Examples:
      ```bash
      # discovery truth vs find
      bun test 2>&1 | tail -3   # "Ran N tests across M files" — N/M recorded
      find . -name '*.test.js' -not -path '*/node_modules/*' | wc -l
      # isolation semantics for the wiki gate
      bun test --no-isolate scripts/wiki-scratch-isolation.test.mjs
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase124-bun-only-inventory.md`: new.
      - `scripts/plan-review-gate.test.mjs`: `PLAN_124_TASK_1` block + one `assertPrimitiveReview`.
    - References:
      - Required tokens: `--parallel`, `--no-isolate`, `suffix`, `Ran`, `better-sqlite3`,
        `with-build-lock.mjs`, `discovery`, `--test-concurrency=4`.
      - Rejected tokens: `rename the twins first`, `port the Node ceilings`, `node --test`.
  - Test Cases to Write:
    - Review gate: `PLAN_124_TASK_1` fails when the evidence file is missing, drops a required
      token, or gains a rejected token.
    - Discovery-set test: the recorded discovered set equals the `find` truth restricted to owned
      suites; a sabotaged count fails Task 2's partition assertion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact and a test-only gate block).
    - Docs pages to create/edit: `docs/_evidence/phase124-bun-only-inventory.md` only (evidence,
      excluded from the shipped tarball).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Runner flip — every stage on `bun test`, bounded workers, exactly-once partition held
  - Acceptance Criteria:
    - Functional: `scripts/run-all-tests.mjs` `STAGES` runs only `bun`-binary children (plus `tsc`
      through the lock wrapper). Per Task 1's discovery row, either (a) the root/sqlite/workspace
      file sets merge into one no-args discovery stage scoped by cwd, or (b) explicit-list stages
      survive with the suffix-twin workaround Task 1 validated. Every `bun test` invocation carries
      `--timeout=0`. Parallel stages carry a worker bound (`--parallel=4` default, matching today's
      `--test-concurrency=4` rationale) with a `ponytail:` comment naming the real-time-budget
      ceiling and the measured upgrade path.
    - Functional: the performance-budget stage runs `scripts/budget-gate.test.mjs` solo,
      single-process, no `--parallel` — the host-contention ceiling stays a solo measurement.
    - Functional: the wiki-scratch gate uses the Task 1 isolation verdict (`--no-isolate` or
      sequential fallback); the docs sentence that pinned `--test-isolation=none` states the new
      mechanism and why.
    - Functional: `scripts/run-all-tests.test.mjs` asserts: no `node` command in `STAGES`; every
      test file in the tree appears exactly once across stage file sets (partition rule);
      `--timeout=0` on every `bun test`; the budget stage is solo and unbounded-worker-free.
    - Functional: `package.json` and all 11 workspace `test` scripts use `bun test --timeout=0`
      file lists (workspace leaves keep `scripts/with-build-lock.mjs --shared`); root script
      wrappers change `node scripts/X.mjs` → `bun scripts/X.mjs` and `npm run X` chains → `bun run X`
      (except the release-host registry scripts owned by plan 125 Task 5).
    - Functional: `scripts/tooling-gate.test.mjs`'s Node-only-flag scan is replaced by the new rule:
      no repository spawn invokes `node` (by name or `process.execPath`) outside the release-host
      registry exception list; `process.execPath` is Bun under a Bun parent, which is now the only
      parent, so runner-agnostic spawns may keep it. The env-strip rule follows Task 1's transcript
      (strip nothing that no child sets).
    - Functional: `scripts/live-matrix.mjs` command validation accepts `bun ` and `bun run `
      prefixes; `scripts/blocked-gate.mjs` runner strings follow.
    - Performance: the default suite wall clock is recorded (three runs) against the Task 1 Node
      baseline table; a stage that regresses is reverted to its measured winner and the revert is
      recorded in the evidence file — the flip is a measurement, not a preference.
    - Code Quality: no second runner abstraction; the stage table stays declarative; no `bun:test`
      imports enter published `src/` or `packages/*/src` (570 `node:test` imports are executed by
      Bun's runner — unchanged).
    - Security: `with-build-lock.mjs` mutual exclusion is re-proven under the Bun parent (Task 1's
      overlap probe); a reader that runs while a writer holds the lock is a failure, not a warning.
      Real-time budget assertions fail closed: a recalibration (Task 4) may move a ceiling, a
      deleted ceiling may not paper over a regression.
  - Approach:
    - Documentation Reviewed:
      - Task 1 evidence (discovery row, isolation verdict, env transcript, timing table).
      - `scripts/run-all-tests.mjs` current `STAGES`/`GATE_FILES`/pool comments; plan 115 Task 2's
        shared-lock design; plan 123 Task 1's `--test-concurrency=4` bound rationale.
      - `scripts/run-all-tests.test.mjs` existing partition assertions (79 + 3 = 82 shape).
    - Options Considered:
      - One merged discovery stage for everything including gate files — rejected if Task 1 shows
        gate files need different env/concurrency: stages exist to bound blast radius, not to
        minimize stage count.
      - `--parallel` default (CPU count) — rejected for stages carrying absolute-time assertions;
        the bound is a measured constant until Task 4 recalibrates ceilings.
      - Rewriting `node:test` imports — rejected (plan 113 already rejected; Bun runs them).
    - Chosen Approach: flip per stage from Task 1's rows, bounded workers, partition asserted.
    - API Notes and Examples:
      ```js
      // stage shape after the flip
      { name: "root+workspace suites", command: "bun",
        args: ["scripts/with-build-lock.mjs", "--shared", "bun", "test", "--parallel=4", "--timeout=0"] }
      { name: "performance budget", command: "bun",
        args: ["scripts/with-build-lock.mjs", "bun", "test", "--timeout=0", "scripts/budget-gate.test.mjs"] }
      ```
    - Files to Create/Edit:
      - `scripts/run-all-tests.mjs`: stage commands. `scripts/run-all-tests.test.mjs`: assertions.
      - `package.json`, `packages/*/package.json`: script entries (test leaves, wrappers).
      - `scripts/tooling-gate.test.mjs`: scan rule replacement.
      - `scripts/live-matrix.mjs`, `scripts/blocked-gate.mjs`: command validation/prefix strings.
      - `docs/_evidence/phase124-bun-only-inventory.md`: Task 2 note, before/after table, reverts.
    - References:
      - `docs/_evidence/phase113-bun-inventory.md` §12 timings (the wall-clock targets to beat).
      - Plan 115 Task 2 execution note (pool width 2, flake history at 3–4 leaves).
  - Test Cases to Write:
    - Partition: every owned test file appears in exactly one stage's set; a duplicate or a gap
      fails.
    - Runner purity: no `STAGES` entry spawns `node`; the gate scan fails on a planted `node --test`.
    - Budget-stage isolation: the budget stage's argument list has no `--parallel`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no package export; contributor test contract changes.
    - Docs pages to create/edit: `docs/testing.md` (stage table runners, nested-runner rules,
      isolation mechanism) — full rewrite lands with Task 6's re-pin to keep one edit per page.
    - `docs/index.md` update: yes, one sentence if the testing entry names runners (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: PostgreSQL evidence parser on Bun's reporter
  - Acceptance Criteria:
    - Functional: `scripts/postgres-evidence.mjs` parses the Task 1 reporter contract (pass/fail
      lines, summary, exit code) instead of Node TAP; the Postgres suite runs under `bun test` per
      Task 2's stage shape. A missing or unparseable summary is a failure (fail closed), never a
      zero-test green.
    - Functional: the parser asserts a non-zero pass count from the child, preserving the existing
      nested-runner guarantee.
    - Functional: `npm run test:postgres`/`test:postgres:run` chains (now `bun run`) stay wired:
      `require-postgres-url` gate first, workspace legs, then the phase conformance files.
    - Performance: no measurable parser cost (line scan over captured output).
    - Code Quality: one parser, no TAP residue; regexes carry the Task 1 transcript as their
      contract reference in a comment.
    - Security: no credential values in captured output reach the evidence file (URLs redacted as
      today).
  - Approach:
    - Documentation Reviewed: Task 1 reporter transcript; `scripts/postgres-evidence.mjs` current
      TAP regex `^(?:#|ℹ) (tests|pass|fail)`; `docs/testing.md` Postgres leg description.
    - Options Considered: keep the Postgres leg on `node --test` — rejected (this plan removes Node
      from the contributor path); junit reporter + XML parse — rejected (new dependency surface for
      zero benefit over the text contract).
    - Chosen Approach: text-contract parser from the frozen transcript.
    - API Notes and Examples:
      ```js
      // contract: "(pass) name" / "(fail) name" / "Ran N tests across M files." + exit code
      const SUMMARY = /^Ran (\d+) tests? across (\d+) files?\./;
      ```
    - Files to Create/Edit: `scripts/postgres-evidence.mjs`; its test file if one exists
      (`grep scripts/ postgres-evidence` first); `docs/testing.md` Postgres leg sentence (Task 6).
    - References: Task 1 evidence "reporter shape" section.
  - Test Cases to Write:
    - Parser: a fixture transcript with 3 pass/1 fail parses to pass=3 fail=1; an empty or
      summary-less capture throws.
    - Fail-closed: a child that exits 0 with zero recorded tests fails the leg.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: covered by Task 6's `docs/testing.md` edit.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Recalibrate absolute-time ceilings on the Bun instrument
  - Acceptance Criteria:
    - Functional: every absolute-time assertion that a Bun runtime changes is recalibrated by
      plan 023's method (min of ≥2 back-to-back runs, minus the documented margin), never ported:
      `scripts/budget-gate.test.mjs` startup/import ceiling, tool-search `index+score` 50 ms
      ceiling, redaction benchmark budgets, memory wiki source-scan 5 ms, prism-work document
      extract 2000 ms, and any workspace-leaf budget Task 1's timing table flags. Each new ceiling
      cites its measurement in a comment.
    - Functional: ceilings that did not move beyond run-to-run variance keep their values with the
      re-measurement recorded; a ceiling is loosened only when the Bun measurement says so, and the
      old number + reason land in the task note.
    - Performance: the recalibrated suite runs green across three consecutive full-suite runs on a
      quiet host (the plan 119 §18 method).
    - Code Quality: one measurement method, cited once; no per-file bespoke calibration math.
    - Security: loosening a timing ceiling never loosens a correctness gate — a review pass confirms
      each moved number is a performance budget, not a fail-closed timeout on a trust boundary.
  - Approach:
    - Documentation Reviewed: plan 023's calibration method; plan 120 Task 6 (branch-audit freeze
      precedent for re-instrumenting); `scripts/budget-gate.test.mjs`, the benchmark ceiling sites
      named in the stage comments.
    - Options Considered: port Node numbers — rejected (different instrument); delete wobbly
      ceilings — rejected (they caught the load-5.97 flake class).
    - Chosen Approach: measure-on-bun, adjust, cite.
    - API Notes and Examples: `// ceiling: 50ms → 38ms (bun 1.4.2, min-of-5 2026-09-26, plan 124 T4)`.
    - Files to Create/Edit: the ceiling sites named above; `docs/_evidence/phase124-bun-only-inventory.md`
      Task 4 table (old, new, method, runs).
    - References: `docs/_evidence/phase115-suite-budget.md` §15–§18 (the flake history that justifies
      the ceilings).
  - Test Cases to Write:
    - Each recalibrated ceiling's file passes solo and in the full suite three times consecutively.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: budget numbers in `docs/testing.md`/`docs/release-and-install.md`
      fold into Task 6.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: CI on Bun only — `setup-node` deleted, every step `bun`
  - Acceptance Criteria:
    - Functional: all ten `.github/workflows/*.yml` use `oven-sh/setup-bun` (pinned SHA +
      `bun-version: "1.4.2"`) and `bun ci`; every `node`/`npm run`/`npx` step becomes `bun`/
      `bun run`/`bunx` (`coding-journey.yml`'s `npx --no-install playwright-core install chromium`
      → `bunx --no-install playwright-core install chromium`, verified by Task 1's playwright probe).
      `release.yml`'s `node --input-type=module` heredocs become `bun` heredocs/-e.
    - Functional: `release.yml`'s publish job keeps `npm pack`/`npm publish`/`npm sbom` and gains
      one comment line: these run on the runner's preinstalled Node (no `setup-node`); the registry
      contract and provenance flags are plan 125 Task 5's scope.
    - Functional: `mise.toml` drops `node = "24"` (Bun-only contributor setup); the comment about
      CI pinning both files is updated to Bun-only.
    - Functional: workflow lint/liveness tests (`scripts/workflow-liveness.test.mjs`,
      `src/__tests__/docs.test.ts` workflow phrase pins) pass with the new shapes.
    - Performance: CI install stays `bun ci`; no step adds registry traffic.
    - Code Quality: no workflow carries a dead `setup-node` with a comment "in case" — deleted.
    - Security: `bun audit --audit-level=moderate` stays the supply-chain gate; publish-job secrets
      (`NPM_TOKEN`, `id-token: write`) unchanged.
  - Approach:
    - Documentation Reviewed: plan 113 Task 2's workflow inventory (the install list); Task 1
      evidence (playwright/bun run parity rows); `.github/workflows/release.yml` publish job.
    - Options Considered: keep `setup-node` on jobs that "might" need Node — rejected: runner images
      ship Node for the publish exception; everything else is Bun by this plan's contract.
    - Chosen Approach: delete, document the single exception where it lives.
    - Files to Create/Edit: all `.github/workflows/*.yml`; `mise.toml`;
      `docs/_evidence/phase124-bun-only-inventory.md` Task 5 note.
    - References: plan 113 Task 2 execution note (which workflows carried `npm ci`).
  - Test Cases to Write:
    - A grep gate (extend `scripts/tooling-gate.test.mjs` or the workflow liveness test): no
      workflow references `actions/setup-node`; `npx`/`npm run` absent outside the publish-job
      allowlist.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` CI section (Task 6 folds it in).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Re-pin the suite budget and land the doc contract for the Bun-only suite
  - Acceptance Criteria:
    - Functional: three consecutive full-suite runs are recorded; the marker
      `<!-- budget: pin="…" baseline_s="…" -->` in `docs/_evidence/phase115-suite-budget.md`,
      the sentence/row in `docs/release-and-install.md`, and `docs/testing.md`'s stage table all
      name one number; `src/__tests__/docs.test.ts`'s pin-uniqueness test passes.
    - Functional: `docs/testing.md` describes the Bun-only stage table (runners, worker bounds,
      budget-gate solo rule, nested-runner env rule from Task 1, Postgres leg on the new parser);
      `docs/release-and-install.md`'s contributor section says Bun-only (Node retired from the
      contributor path; consumer runtime contract is plan 125, not this plan — the page says so in
      one sentence to avoid claiming the 0.12.0 contract early).
    - Functional: `README.md` scripts table shows `bun run test`/`bun run build` only.
    - Performance: the pin reflects the Task 2 flip's measured suite, not the Node-era 72 s.
    - Code Quality: one number, one source of truth, asserted.
    - Security: unchanged surfaces.
  - Approach:
    - Documentation Reviewed: plan 115 Task 2's marker mechanics; `src/__tests__/docs.test.ts`
      pin-uniqueness assertions.
    - Options Considered: leave the Node-era pin until 125 — rejected: a pin that names a runner
      the suite no longer uses is drift the uniqueness test exists to catch.
    - Chosen Approach: re-pin once, after Task 4's ceilings settle.
    - Files to Create/Edit: `docs/testing.md`, `docs/release-and-install.md`, `README.md`,
      `docs/_evidence/phase115-suite-budget.md` (marker + §20 note), `docs/index.md` (one sentence,
      only if the testing entry names runners), `src/__tests__/docs.test.ts` (phrase pins).
    - References: plan 119 Task 2 execution note (the re-pin procedure).
  - Test Cases to Write:
    - Pin-uniqueness: fails if any page restates a different budget or names `node --test` as a
      current stage runner.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no package export; contributor + CI contract changes.
    - Docs pages to create/edit: as listed above.
    - `docs/index.md` update: yes, one sentence if the testing entry names runners.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Execution Notes

- Task 6 (2026-09-25): the suite budget is re-pinned to `< 240s` / baseline `~200s` (was
  `< 110s` / `~92s`, which named a runner the suite no longer uses). Three consecutive full-chain
  runs were recorded (`docs/_evidence/phase115-suite-budget.md` §20.1: 588 s at load/cpu 1.22-1.63,
  332 s at 1.51-1.22, 266 s at 1.16-0.96) alongside the earlier quiet-band runs (156 s at 0.67,
  200 s at 0.48); every red row in the three runs is the in-flight `packages/prism-core` work
  (non-null budget, compat baseline, phase54 map, lint) or a build race that hit its mid-run
  TypeScript error, and no timing flake appeared. The pin is the conservative quiet-band baseline
  x 1.2 (the same margin the retired pin used). Doc contract: `docs/testing.md` gained the
  budget row and already carried the Bun stage table, worker bounds, budget-gate solo rule, the
  Task 1 nested-runner env rule and the Task 3 Postgres parser; `docs/release-and-install.md`'s
  budget bullet, support matrix, CI paragraphs and every `npm run`/`node --test` contributor
  command were rewritten for Bun, plus the Bun-only contributor sentence naming plan 125 as the
  consumer-runtime owner; `README.md`'s scripts table lost its `npm test` parenthetical;
  `docs/index.md` and `docs/live-testing.md` name `bun run test`. `src/__tests__/docs.test.ts`'s
  pin test now also fails if any of the five stage-runner pages names `node --test` (156 pass /
  0 fail) and the five phrase pins that moved were updated in the same change set.
- Task 5 (2026-09-25): all ten workflows install with `bun ci` from the pinned
  `oven-sh/setup-bun@0c5077e5…` and `bun-version: "1.4.2"`; every `npm run`/`npm test -w`/`node`/
  `npx` step became `bun run`/`bun run --filter <pkg> …`/`bun`/`bunx` (Bun has no `-w <name>`
  selector, and `bun run --filter <pkg> test -- <args>` does forward the extra arguments).
  `setup-node` is deleted from eight workflows and from `verify`/`postgres-integration`/
  `supply-chain`/`office-validation`/`publish`; the publish job keeps npm for pack/publish/sbom with
  the registry-exception comment. **Deviation, recorded below:** the two declared Node support legs
  (`verify` on 24, `node22-compat` on 22) stay, each running the new
  `scripts/public-import-smoke.mjs`, because `engines.node >=22` is still declared and
  `scripts/phase12-freeze.test.mjs:135-139` asserts both legs exist against the immutable
  `support.node` block. `sandbox-browser`'s T9 capability probe was rewritten for Bun's reporter (a
  filtered run prints `(skip) T9: …`, an unfiltered one does not list skips at all).
  `scripts/workflow-liveness.test.mjs` grew the gate the task asked for (only `release.yml` may
  reference `setup-node` and only with those two versions; no `npm run`/`npx`; npm limited to
  pack/publish/sbom/view; exactly two steps execute `node`; every `scripts/*.mjs` a workflow names
  exists) and its scanner now resolves `bun run`/`--filter` so the liveness check survives the flip.
  Pins updated in the same change set: `docs.test.ts` (sdk:ready, test:postgres, the smoke script),
  `phase15-freeze.test.mjs` (sweep:unused). Verification: workflow-liveness 9/0, the affected gate
  batch 247/3 (the three are pre-existing phase27-release rows), root suites 2119 pass / 1 skip /
  0 fail in 100s, format:check clean over 1801 files, build exit 0. The chain run was killed by the
  tool timeout while an unrelated 4-VM Talos cluster creation saturated the host (load 29).
- Task 4 (2026-09-25): two ceilings actually moved and both were the *denominator*, not the
  workload. (1) The startup gate: Bun's cold import is 31.8-59.1ms against an empty process start of
  2.50-7.20ms, so the ratio sits at 6.04-15.2 idle and the Node-calibrated ceiling of 8 was below
  Bun's minimum; it is now 24 (max-of-35 15.2 x 1.58), the loaded ceiling 20 -> 60 (38.3 measured at
  load/cpu 1.27), the ratio baseline 3.3 -> 12.7, the import baseline 38 -> 45, and the load
  threshold 1.5 -> 0.5 because the Bun import inflates 3-4x from load/cpu ~0.7 while the empty start
  barely moves — the ratio no longer load-cancels the way it did on Node. The absolute 250ms ceiling
  stayed, and the planted-import negative control's denominator floor went 20 -> 2ms so it still
  fails every ceiling. (2) The redaction ratio: measured sequentially the two phases saw different
  scheduler attention (Bun min 3.37 idle, 3.18 with three gate files running — inside the floor of
  5), so the scenario now interleaves the phases per iteration (the field-policy A/B method) and the
  distribution is stable at 6.95-9.55; the floor keeps its value 5 = min x 0.72. Every other ceiling
  named by the task was re-measured and *kept* with the number recorded in its comment: tool-search
  index+score 2.58-24.8 vs 50, memory source recheck 0.104-0.118ms vs 5ms, prism-work extract
  349-375ms vs 2000ms, run-bundle snapshot 0.56-0.70ms vs 5ms, field-policy 85-92% vs the 110% cap,
  multi-agent fan-out 1.87x vs 1.4x, the redaction p95s and the two e2e journey hang bounds. Three
  consecutive full-suite runs then passed back to back (`all 9 stages passed`, 5m18.4s / 3m50.3s /
  3m36.4s, plus a fourth 2m35.9s run on the final tree) at load/cpu 0.80 / 1.42 / 1.73 / 0.67 — the
  branch-coverage stage's instrumented timing asserts
  were tolerated as designed (core branches 86.54 >= 83.49) once the pre-existing plans-index doc
  row was fixed: `plans/README.md` had no row for the already-on-disk
  `plans/130-Cyclic-Workflow-Graphs.md`, which is what had been failing every root-suite run this
  session (and had turned the audit's tolerance into a stage failure). Measurements and the full
  table are in `docs/_evidence/phase124-bun-only-inventory.md` §11.
- Task 3 (2026-09-25): the wrapper now parses Bun's reporter instead of Node TAP — one
  `(pass)`/`(fail)` line per executed test plus the trailing `Ran N tests across M files.` summary,
  with the child's exit code as the first gate. The contract was checked against two real captures
  before it was written into the script (root suites 2120 tests / 2118 pass / 2 fail lines; gate
  suites 280 / 277 / 2), which surfaced the one shape difference worth documenting: Bun prints each
  failure twice (at its position and in the end-of-run failure block), so `fail` can over-count —
  harmless, because any `(fail)` line fails the leg closed. `counts.tests` comes from the summary
  and `counts.pass` from the once-printed pass lines, so both are exact. The parser is three
  exported functions (`parseReport`, `evidenceCounts`, `evidenceDocument`) with the CLI behind the
  import-hygiene direct-execution guard; `evidenceDocument` is the only writer and never persists
  the capture, so a DSN in a failure message cannot reach the evidence file. Fail-closed ladder:
  no summary line, `Ran 0 tests`, zero pass lines, any `(fail)` line, or `pass > tests` — each one
  exits non-zero and writes nothing. Verified end-to-end in a temp root: a green child writes
  `{gitHead, captured, counts:{tests:4, pass:3, fail:0}}` (the shape `release-skip-manifest.mjs`
  validates), a child that exits 0 with no summary writes nothing and exits 1, and the repo-level
  `bun run test:postgres` still stops at `require-postgres-url` with no evidence file. The new
  `scripts/postgres-evidence.test.mjs` (5 tests, in `GATE_FILES` — 45 gate files now) also pins the
  chain order: URL gate, three workspace legs, then the three phase conformance files, all `bun`.
  `docs/testing.md`'s Postgres sentence now describes the contract; the "TAP counts" phrase in
  `docs/release-and-install.md` became "reporter counts".
  inventory made visible. (1) The root stage's 166 explicit paths still pulled the two suffix twins
  under Bun; `--path-ignore-patterns=packages/**` restores the exactly-once partition (discovery
  probe: 166 files / 2120 tests, matching Node's 2120). (2) Bun's test runner expands only the last
  path segment, so the two `dist/**/__tests__` scripts pass the `dist` directory, prism-core's
  `$(find …)` becomes `--path-ignore-patterns='dist/sessions/sqlite/**' dist`, and prism-providers
  also passes `dist` (its old middle-segment glob silently dropped 4 files, so the directory form
  both fixed the glob and closed the coverage gap). `scripts/run-all-tests.test.mjs` asserts all four
  shapes plus the runtime-verified partition (567 files, 0 duplicates; the 3 unowned files are the
  `test:postgres`/`test:live` opt-in legs). Same-load A/B shows no stage regression (root 27.1 s vs
  Node 29.7 s; gate 48.0 s vs 50.0 s; examples 3.5 s vs 10.0 s), so no stage was reverted. The
  `pack:dry-run` E2BIG recursion is gone (`bun run --filter '*' pack:dry-run`), the Node-spawn scan
  finds only the branch-coverage instrument exception, and the lock's `O_EXCL` exclusion re-proved
  under the flipped parent (reader waited 1227 ms). Three full-chain runs are recorded in
  `docs/_evidence/phase124-bun-only-inventory.md` §9.4; their red rows are Task 4's recalibration
  items (budget startup ratio, redaction/multi-agent speedups, field-policy/snapshot real-time
  assertions) plus the pre-existing `plans/README.md` index row — no flip defects.

## Compromises Made

- To be filled after tasks are completed and tests pass.

### Task 2 (2026-09-25)

- The workspace pool stays at two in-flight packages: the package suites still carry soft real-time
  ceilings (prism-work document extract, memory source-scan) that flaked at three to four leaves.
  Task 4 recalibrates the ceilings; the bound can move after that.
- The root and gate stages keep a fixed `--parallel=4` instead of Bun's default worker count, for the
  same reason — the same-load A/B shows parity at this bound, and the default pool starves the
  real-time assertions under host load.
- The providers and memory default suites now run four files their pre-flip globs silently dropped
  (`thinking-conformance`, `toolcall-conformance`, `tool-result-empty-wire`, `model-discovery`) and
  one file no script ran at all (`util-merge`). The partition assertion needs every built test file
  owned, so the gap was closed rather than exempted; Task 6's re-pin absorbs the extra tests.
- `pack:dry-run` keeps `npm pack` (release-host registry exception, plan 125 Task 5) but its
  workspace loop became `bun run --filter '*' pack:dry-run`, which removes the `E2BIG` recursion
  Bun's script-name-first `--workspaces` form caused.

### Task 6 (2026-09-25)

- The pin is looser in absolute terms than the Node-era `< 110s`: the Bun chain's quiet-band
  measurements are 156-200 s, and a saturated host (5 QEMU VMs + concurrent `rustc` builds on this
  16-CPU box) measured 266-588 s. The number keeps the quiet-band conservative baseline (200 s)
  rather than absorbing the saturated rows, because a pin that covers a 5-VM host would stop
  detecting a 2x suite regression; the load rows are recorded in the evidence instead. The pin is
  documentation plus the uniqueness assertion — nothing times the chain against it — so a loaded
  host reading above it is a host reading, and the page says so.
- The three full-suite runs this task records are red on two stages each: `performance budget`
  (the in-flight non-null-assertion count gate) and `gate suites` (four in-flight
  `packages/prism-core` rows: compat baseline, two phase54 map rows, lint diagnostics). A fully
  green chain is impossible while that uncommitted work is mid-flight; the Task 4 acceptance runs
  are the last all-green chain and the evidence records both sets side by side.
- The `node --test` ban covers the five stage-runner pages (README, `docs/index.md`,
  `docs/testing.md`, `docs/release-and-install.md`, `docs/live-testing.md`), not every page that
  contains a command example. Pages whose mentions are era transcripts or per-version benchmark
  notes (`docs/synapta-integration-review.md`, `docs/performance.md`'s 0.0.x sections,
  `docs/rag.md`) keep their recorded commands; a full wording sweep is a separate pass.
- `docs/release-and-install.md`'s SDK-readiness phrase pin for
  `PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present` stays in its npm form: that
  phrase only exists in the immutable `docs/history/release-handoffs.md`, and history pages are
  never rewritten to match a new runner.

### Task 5 (2026-09-25)

- **Two `setup-node` legs survive in `release.yml`** (`verify` on Node 24, `node22-compat` on Node
  22) instead of being deleted from every workflow as the task text says. Reason: `engines.node
  >=22` is still declared in all eleven manifests, `scripts/phase12-freeze-manifest.json` is the
  live 0.1.x support-matrix source of truth (`support.node.supported`/`measuredInCi` = 22,24, with a
  `$comment` naming exactly those two release.yml legs) and `scripts/phase12-freeze.test.mjs:135-139`
  asserts the literals are present. Deleting the legs would delete the only measurement of a
  published contract while it is still declared — the task's own Security criterion forbids
  loosening a gate to make a change land. Both legs are *measured* (each runs
  `scripts/public-import-smoke.mjs`), so neither is a dead `setup-node`. Plan 125 Task 1 retires
  them together with the `engines` flip; the smoke script's header names that handoff.
- npm stays in `release.yml`'s publish job (pack/publish/sbom) and in `security.yml`'s artifact
  sweep (pack/sbom) as plan 125 Task 5's registry exception, each with a one-line comment naming the
  runner image's preinstalled Node and the missing `bun publish --provenance`.
- `sandbox-browser.yml`'s native-capability probe lost its "run the full suite and grep" shape: Bun
  lists a skip only when a `--test-name-pattern` filters the run, so the step filters to the T9 test
  and matches `(skip) T9:`. Same three-way evidence (passed/skipped/failed), less suite time.

### Task 4 (2026-09-25)

- The startup ratio ceiling is looser than the Node-era one in absolute terms (24 vs 8) because the
  Bun denominator is ~6x smaller; the protection is the same shape (a 1.9x import regression at the
  idle median still fails), but a host that is busy *without* registering load (e.g. a container
  quota) can still inflate the ratio. The absolute 250ms ceiling remains the evidence-of-record.
- The load threshold moved to 0.5, so on a host that is half-busy the gate runs in its wider mode and
  the absolute ceiling is not asserted. That is the documented trade for Bun's non-cancelling ratio;
  `scripts/benchmark.mjs` keeps the absolute measurement as release evidence.
- The branch-coverage stage depends on the audit's instrumented-timing tolerance
  (`isKnownFlake`) for the field-policy and run-bundle asserts: they cannot be measured under Node's
  instrument. The floor is still enforced, and the uninstrumented root suite owns both budgets.

### Task 3 (2026-09-25)

- The leg still runs the real `test:postgres:run` chain, so the success path cannot be exercised on
  a host without PostgreSQL; the write path was proved in a temp root with a stubbed child instead
  (`docs/_evidence/phase124-bun-only-inventory.md` §10.3). The real green leg remains a
  `postgres-integration` CI job.
- `counts.fail` over-counts when a run has failures (Bun prints the failure detail twice). The
  evidence file is only written when `fail === 0`, so the recorded counts stay exact; a future
  reader should not "fix" the asymmetry by trusting the duplicate lines.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.

### Task 2 (2026-09-25)

- Task 4 owns every red row the flip exposed: the budget-gate startup ratio (Bun process start is
  ~3 ms against Node's ~17 ms, so the Node-calibrated ratio ceiling of 8 is exceeded even on an
  idle host), the redaction `minSpeedup` (measured 5.0–6.1 against a floor of 5), and the
  field-policy/snapshot real-time assertions that flake inside the branch audit's instrumented run.
- Task 5 owns the workflow steps that still say `npm run …`/`actions/setup-node`.
- Task 6 owns the docs re-pin and the remaining `node scripts/…` regeneration hints in contributor
  error messages (`scripts/package-truth.mjs` callers, `scripts/live-doc-check.test.mjs`,
  `scripts/phase27-ha.test.mjs` fixtures) — no spawns, wording only.
- **Homed: plan 126 Task 4 (2026-09-26).** `scripts/coverage-summary.mjs`'s standalone fallback still runs the root suite through a shell
  glob (`dist/__tests__/*.test.js`), which pulls the two suffix twins under Bun; the capture path
  (`test:coverage`) is exact, so only the fallback sees the duplicate. Worth an ignore pattern in
  plan 126/127 when coverage moves.

### Task 6 (2026-09-25)

- **Homed: plan 129 Task 2 (2026-09-26).** Leftover runner strings outside the five stage-runner pages: `docs/performance.md`'s 0.0.x
  benchmark notes, `docs/rag.md`'s live-test command, `docs/synapta-integration-review.md`'s
  recorded transcript, `docs/operations.md`, `docs/openapi-tools.md`, `docs/model-registry.md`,
  `docs/evaluations.md`, `docs/computer-use-linux.md`, `docs/cli-rpc.md` and
  `docs/runs-and-usage.md` each still show a `node --test`/`node scripts/...` command; and the
  generated package-truth blocks (plus their generator template and the `docs.test.ts` canonical
  token) still say `node scripts/package-truth.mjs`. All of them run fine under `bun` — this is
  wording, not behavior, and it is deferred so each page keeps one edit.
- **Homed: plan 128 Task 3 (2026-09-26).** The pin is a wall-clock claim about a shared host: the next plan that lands a material suite
  size change should re-measure rather than assume `< 240s` still describes the chain (the
  re-probe procedure is plan 115 Task 2's marker + §20's method).
- Plan 125 owns the last Node surfaces this page still documents (the two support legs, the
  `engines.node` declaration, the compatibility smoke), so the next re-pin should coincide with
  that plan's `engines` flip to avoid a third budget story.

### Task 5 (2026-09-25)

- Plan 125 Task 1 owns the Node-leg retirement: it flips `engines.node` to `engines.bun`, which
  makes `phase12-freeze-manifest.json`'s `support.node` block era evidence, and with it the two
  `setup-node` legs, `scripts/public-import-smoke.mjs`, the `docs.test.ts` compatibility pins and
  `docs/release-and-install.md`'s Node 22/24 matrix. Nothing else may add a Node leg before then.
  **Done 2026-09-25 (plan 125 Task 1):** both legs, the smoke script and the compatibility pins
  retired with the `engines` flip; the page's Node row is now marked as the 0.1.x era record.
- `docs/release-and-install.md`'s CI section still describes `npm run sdk:ready`/`node22-compat` as
  the workflow shape (the `docs.test.ts` phrase pin still passes because the page is unchanged);
  Task 6 owns that page's edit and must move the pin with it.
- **Standing (deliberate reversal path, no task).** The publish job's `npm pack`/`npm sbom` calls run on whatever Node the runner image ships, which
  is not pinned by design (plan 125 Task 5's stated trade); if a registry incident ever traces to
  that drift, pinning it means re-adding a `setup-node` step — a deliberate, documented reversal.

### Task 4 (2026-09-25)

- **Homed: plan 127 Task 1 (2026-09-26).** The startup gate's ratio is now a weak load-normalizer under Bun (import 3-4x more
  contention-sensitive than the empty start). If a future flake appears, the honest upgrade is a
  CPU-speed denominator (a fixed compute probe) rather than another ceiling raise — plan 127's
  concurrency work is the natural home.
- **Homed: plan 127 Task 1 probe (2026-09-26).** `scripts/coverage-summary.mjs`'s standalone fallback and the branch audit both spawn a Node
  process for the branch instrument; Task 5's workflow flip does not change that, and plan 119 Task 1
  keeps the restore trigger.

### Task 3 (2026-09-25)

- Task 6 owns the remaining stale `node --test`/TAP prose in `docs/release-and-install.md`
  (the offline-budget paragraph and the e2e-journey TAP-diagnostic sentence), which the flip and
  this parser made obsolete.
