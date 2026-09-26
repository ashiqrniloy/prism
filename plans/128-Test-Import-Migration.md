# Test Import Migration node:test to bun:test

Plan 5 of 6 for the Bun-only migration (with [124](124-Bun-Only-Toolchain-And-Test-Runner.md),
[125](125-Bun-Only-Runtime-Contract.md), [126](126-Bun-Native-Sqlite.md),
[127](127-Bun-Runtime-Concurrency-Performance.md), [129](129-Release-0-12-0.md)). Lands after
plan 124 (the runner is already `bun test`) and after plan 126 (`@types/bun` is already a devDep),
and before the 0.12.0 cut. Owner decision 2026-09-25: the no-Node-surface consistency rule extends
to test source.

Honest framing: this rewrite is **not required for the migration to function** — Bun's runner
executes `node:test` imports through its polyfill, proven by execution (sqlite suites 24 pass,
`--parallel` full-glob runs 2083 tests green, plans 113/123 transcripts). It is required by the
consistency contract: after this plan, no live source file names a `node:` test API, and the suite
depends on Bun's native test API instead of a compatibility layer whose surface is defined by
Node. Plan 113's rejection of this rewrite was cost-only ("635 imports, no benefit while Node
ships"); with Node gone and the runner already Bun, the cost is a mechanical sed plus one
context-API probe, and the polyfill dependency is the last Node-shaped surface in the tree.

Measured census (2026-09-25, this plan's survey): **1059 files** import from `node:test`
(all static `import`, zero `require`). The entire imported surface is six names —
`describe` (822), `it` (817), `test` (181), `after` (83), `before` (44), `afterEach` (27) —
plus two TestContext methods in live use: `t.diagnostic` (14 sites), `t.skip` (10 sites).
Zero `mock` usage, zero `beforeEach` imports, zero programmatic `run()`, zero `suite`.
`node:assert` is the separate assertion layer and is deliberately out of scope (Task 2 records
the boundary).

## Objectives

- Every live `from "node:test"` import becomes `from "bun:test"` — 1059 files, mechanically where
  the census holds, by hand where the context-API probe dictates.
- `t.skip` / `t.diagnostic` semantics verified identical under `bun:test` before the sweep, or
  hand-migrated at their ≤24 sites.
- A gate makes the retirement permanent: no new `node:test` import can land (zero-allowlist grep
  gate; immutable evidence/frozen files excluded).
- `node:assert` stays, with the boundary decision recorded once, in the plan and the evidence
  file — not silently.
- Suite behavior, timings, and the budget pin are unchanged (verified, not assumed).

## Expected Outcome

- `grep -r 'from "node:test"' src packages scripts examples` returns zero live hits; the only
  `node:` test-adjacent specifier left in test source is `node:assert`.
- The full chain (`bun run test`, `bun run sdk:ready`) is green with byte-identical test logic;
  the evidence file holds the before/after per-suite timing spot-checks proving no runner-API
  overhead change.
- No public export changes; compat baseline untouched; `docs/_evidence/phase128-test-import-
  migration.md` holds the census, the context-API probe transcript, and the rewrite log
  (file count, sed command, hand-edit list).

## Tasks

- [x] Task 1: Context-API probe and census freeze
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase128-test-import-migration.md` exists with: the census
      table above re-run and confirmed on the current tree (the 1059/six-name/two-context-method
      shape, or the delta if the tree moved); a `bun:test` probe transcript covering
      `describe/it/test/before/after/afterEach` at both describe-scope and file-scope, and
      `t.skip`/`t.diagnostic` on Bun 1.4.2 — each either confirmed identical or flagged for
      hand-migration with the exact replacement.
    - Functional: the probe runs the same micro-file twice — once importing `node:test`, once
      `bun:test` — under `bun test`, diffing output shape (pass/fail/skip counts, diagnostic
      placement), so the polyfill-vs-native delta is measured, not assumed.
    - Functional: `scripts/plan-review-gate.test.mjs` gains a `PLAN_128_TASK_1` block.
    - Performance: n/a (probe).
    - Code Quality: probe files live in the evidence transcript only (or `mkdtemp`), not committed.
    - Security: no credentials in probes.
  - Approach:
    - Documentation Reviewed: https://bun.com/docs/test/writing (lifecycle API, `test`/`it`/
      `describe`, skip/todo flags), https://bun.com/docs/test/lifecycle as needed; the census
      greps in this plan's header; plan 113 Task 2's rejection note (superseded rationale).
    - Options Considered: skip the probe, sed blind — rejected: `t.skip`/`t.diagnostic` are the
      two sites where Bun's context shape is allowed to differ; 24 sites × a silent behavior
      change is exactly the failure a one-file probe prevents.
    - Chosen Approach: freeze census, probe the two context methods plus file-scope hooks, then
      sweep.
    - API Notes and Examples:
      ```js
      import { describe, it, after } from "bun:test";
      it("skips", (t) => { t.skip("why"); });   // probe row: skip count + reason placement
      ```
    - Files to Create/Edit: `docs/_evidence/phase128-test-import-migration.md` (new);
      `scripts/plan-review-gate.test.mjs` (`PLAN_128_TASK_1` block).
    - References:
      - Required tokens: `bun:test`, `t.skip`, `t.diagnostic`, `1059`, `polyfill`.
      - Rejected tokens: `assert rewrite`, `jest`, `rewrite by hand`.
  - Test Cases to Write:
    - Review gate block.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact).
    - Docs pages to create/edit: evidence file only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: The sweep — mechanical rewrite, hand edits, retirement gate
  - Acceptance Criteria:
    - Functional: one mechanical pass replaces `from "node:test"` with `from "bun:test"` across
      all live files (sed over the census list; the exact command is logged in the evidence
      file); the ≤24 context-method sites identified by Task 1's probe get their hand-migration
      in the same change if the probe flagged divergence (e.g. `t.skip(...)` → an `it.skip`
      declaration or Bun's context equivalent, `t.diagnostic` → the Bun-native form).
    - Functional: `node:assert` boundary decision recorded in the evidence file: assertions stay
      on `node:assert` (universal polyfill, thousands of call sites, zero behavior delta
      available from rewriting to `expect(...)`; a later plan may revisit if Bun ever ships a
      divergent assert). `node:test` is different in kind: its polyfill defines the runner API
      surface, which this repo now owns via `bun:test`.
    - Functional: retirement gate: `scripts/tooling-gate.test.mjs` (or the existing grep-gate
      home) fails on any new live `node:test` import in `src/`, `packages/`, `scripts/`,
      `examples/`, with the frozen-evidence exclusion list (e.g. `docs/_evidence/**`,
      `plans/**`, `docs/history/**`, `phase*-freeze*` files) applied the same way the retired-
      coverage-flag allowlist works (plan 119 Task 3 precedent).
    - Functional: `src/__tests__/docs.test.ts` phrase pins referencing `node:test` (the only docs
      pin found by census) are updated to the new wording; `docs/testing.md` gets one line naming
      the native import if it currently names `node:test` (verify by grep; expected edit: none —
      census found no live page naming it).
    - Functional: tsc emit clean (`@types/bun` types `bun:test`; devDep landed in plan 126
      Task 3); `bun run typecheck` green.
    - Functional: a third retirement rides the sweep: `src/__tests__/install-smoke.test.ts`'s
      `ERESOLVE` peer-window describe is the last npm *resolver* test in the repo, kept because Bun
      only warns on a peer mismatch (plan 125 Task 2's recorded probe). Replace it with a
      manifest-metadata assertion for the same declared window, so no npm invocation remains in the
      test tree; record the substitution in the evidence file.
    - Performance: none at sweep time (Task 3 measures).
    - Code Quality: no mixed imports in one file (a file that imported both `node:test` and
      `node:assert` keeps only the `node:assert` side unchanged).
    - Security: no test-logic changes — the sweep is specifier-only except the flagged context
      sites; any file needing logic edits is listed individually in the evidence log.
  - Approach:
    - Documentation Reviewed: Task 1's frozen census + probe rows; the tooling-gate allowlist
      mechanism (plan 124 Task 2's node-flag scan is the adjacent pattern).
    - Options Considered: incremental per-package migration — rejected: 1059 files, one
      specifier, no interdependencies between files' import sources; a mixed tree buys a
      months-long window where the grep gate can't be zero-allowlist. Rewrite asserts to
      `expect` in the same pass — rejected (out of scope, see the boundary decision).
    - Chosen Approach: one sweep, one gate, one release.
    - API Notes and Examples:
      ```bash
      grep -rl 'from "node:test"' src packages scripts examples | \
        xargs sed -i 's/from "node:test"/from "bun:test"/'
      ```
    - Files to Create/Edit: 1059 test files (specifier-only), the flagged context sites,
      `scripts/tooling-gate.test.mjs`, `src/__tests__/docs.test.ts`,
      `docs/_evidence/phase128-test-import-migration.md` (rewrite log).
    - References: repo rule — retirement gets a gate (the retired-flag allowlist precedent,
      plan 119 Task 3).
  - Test Cases to Write:
    - The zero-allowlist grep gate; the full existing suite (unchanged logic must pass).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test-source internals; contributor-facing only).
    - Docs pages to create/edit: `docs/testing.md` one line if the grep finds it naming
      `node:test` (expected: no edit).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Full-chain verification and timing non-regression
  - Acceptance Criteria:
    - Functional: `bun run test` end-to-end green: identical pass/skip counts per stage versus
      the pre-sweep run (recorded side by side in the evidence file — a count delta is a bug in
      the sweep, most plausibly a `t.skip` semantics drift); `bun run sdk:ready` green including
      typecheck and the coverage instrument.
    - Functional: suite budget respected — the plan 124 Task 6 pin holds without re-pinning
      (the sweep must not move wall clock; if it does, that is investigated as a finding, not
      absorbed); per-suite timing spot-checks for three representative suites (one root, one
      prism-core, one workspace leaf) recorded before/after.
    - Functional: compat-baseline disposition: no public export changed; the plan-129 Task 3
      no-regen expectation is unaffected by this plan.
    - Performance: the plan 124 Task 6 suite-budget pin is re-measured, not assumed. The sweep
      changes how 1059 test files load, so if the chain's wall clock moved materially the marker in
      `docs/_evidence/phase115-suite-budget.md` is re-pinned with plan 115 Task 2's method and the
      new baseline recorded — a silent drift would leave the pin describing a tree that no longer
      exists.
    - Performance: the timing spot-check table is the deliverable.
    - Code Quality: evidence file closes with the final zero-hit grep output.
    - Security: no changes to redaction/approval test fixtures beyond the specifier.
  - Approach:
    - Documentation Reviewed: plan 124's stage definitions (what "identical counts" means per
      stage); the budget pin's current value.
    - Options Considered: skip count-diffing and trust pass/fail — rejected: skip-count drift is
      exactly the silent failure mode `t.skip` divergence would produce.
    - Chosen Approach: counts + timings recorded, budget untouched.
    - API Notes and Examples: `bun run test 2>&1 | tail -n 20` (both runs, in the evidence file).
    - Files to Create/Edit: `docs/_evidence/phase128-test-import-migration.md` (Task 3 section).
    - References: plan 023's freeze method; plan 132 Task 7 (release readiness; transferred from plan 129 Task 3).
  - Test Cases to Write:
    - None new — the chain and the count diff are the acceptance.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence file only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **Branch coverage audit requires a Node shim loader**: The audit spawns `node --test` for
  BRDA coverage (Bun doesn't emit branch records). After the migration, those `dist/` files
  import `from "bun:test"` which Node can't resolve. A temporary shim loader using
  `module.registerHooks()` redirects `bun:test` → `node:test` at load time. This shim will be
  deleted when Bun adds native BRDA support (the `probeBunBranchRecords()` sentinel already
  detects this and will fail-fast when it happens).
- **Timing-sensitive tests use retries instead of isolation**: Three tests (run-bundle 5ms
  snapshot, document-reader envelope ceiling, fan-out speedup ≥1.4×) are sensitive to CPU
  contention from parallel suite execution. Rather than serializing these suites (which would
  slow CI), they retry measurements under contention. The `--parallel=4` gate in
  `run-all-tests.test.mjs:164` prevents reducing workspace concurrency.
- **`node:assert` not migrated**: Deliberately out of scope per the plan. Bun polyfills
  `node:assert` fully, and rewriting thousands of assert calls to `expect(...)` has zero
  semantic gain. A future plan may revisit if Bun diverges.

## Further Actions

- **Delete the Node shim loader when Bun ships BRDA**: `probeBunBranchRecords()` in
  `scripts/branch-coverage-audit.mjs` will fail-fast when Bun starts emitting branch records
  in lcov output. At that point, remove the entire shim/loader mechanism and the
  `NODE_SPAWN_EXCEPTIONS` allowlist entry in `scripts/tooling-gate.test.mjs`. Priority: low
  (blocked on Bun upstream).
- **Consider `node:assert` → `expect()` migration**: Out of scope for this plan. If Bun ever
  diverges from Node's `assert` behavior, or if the team wants Jest-style assertions for
  readability, a separate plan should handle the thousands of call sites. Priority: deferred.
- **Monitor timing test flakiness**: The retry approach for the three timing-sensitive tests
  should be revisited if flakiness increases. A dedicated "timing isolation" stage that runs
  these tests without parallel contention could replace the retry pattern. Priority: low.
