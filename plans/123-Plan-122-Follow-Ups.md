# Plan 122 Follow-Ups: Deterministic Gates, Compat Probes, and Release Hygiene

## Objectives

- Make the full local `npm test` chain deterministic on a loaded host by bounding Node test-worker concurrency for the stages that carry soft real-time assertions, without changing any budget.
- Pin the §2 F2–F4 legacy System One adapter fixes in the packed-install consumer contract so a regression cannot ship unnoticed.
- Make the packed-install replay procedure usable against any host-selected runtime (including Synapta's next pin) and document where its deltas are recorded.
- Remove the release-state dependency from the review's remediation wording so no cut-time re-check is owed.
- Verify and record the release-evidence regeneration flow (CI marker + real Postgres leg) rather than assuming it.

## Expected Outcome

- `npm test` is green end-to-end on this host (9/9 stages) with the measurement comments explaining each bound; `docs/testing.md` states which stages are worker-bounded and why.
- `examples/host-composition-compat.ts` carries a sixth check, `legacy-adapter-safety`, that fails as a named delta on older pins and passes from the first fixed release.
- `docs/testing.md` documents one replay command for any pin, and `docs/synapta-integration-review.md` §6 states where future deltas are appended.
- `docs/synapta-integration-review.md` no longer says the fixes "sit in an unreleased section"; no task is deferred to the next version cut.
- The plan's execution notes cite the GitHub Actions run ids and local commands proving who regenerates `scripts/postgres-evidence.json` and `scripts/release-evidence.json`, with any doc gap closed.

## Tasks

- [x] Task 1 — Bound test-worker concurrency for the timing-sensitive stages
  - Acceptance Criteria:
    - Functional: `npm test` completes green (9/9 stages) twice in a row on this host while the external qemu/laya-serve load is present; the three previously flaky assertions pass inside the chain — `snapshots 100 tools inside the 5 ms budget`, `checks each distinct source once per query, inside the 5ms budget for 50 sources`, and `runs through the parameterized runner within the frozen caps`.
    - Performance: no budget or assertion text changes; root suites wall time ≤ 60 s at the bound (measured 41.9 s vs 47.4 s unbounded at 15 workers); workspace stage stays ≤ 90 s; full chain stays far inside the release workflow's 30-minute phase timeout.
    - Code Quality: bounds are fixed literals with a dated measurement comment (no per-host adaptive logic, no new config surface); the runner test asserts each bound and keeps a positive control proving a copy without the flag fails; the workspace pool bound stays 2.
    - Security: not applicable — test-infrastructure only, no runtime, network, credential, or artifact change.
  - Approach:
    - Documentation Reviewed:
      - Node 24 `--test-concurrency` CLI flag (live probe: `NODE_OPTIONS=--test-concurrency=4` is rejected, so the flag must be a CLI argument).
      - `scripts/run-all-tests.mjs` stage contract and its comments (plan 115 Task 2 workspace pool; "bound each package's own `node --test` worker count first").
      - `scripts/run-all-tests.test.mjs` stage-shape assertions (the performance-budget stage pins `args.slice(-2)`; root suites is unconstrained).
      - `docs/testing.md` stage table (examples-execution row) and `docs/performance.md` for the absolute-time assertions.
    - Options Considered:
      - Document-only, rely on CI: leaves the local chain red and re-creates the plan 122 Task 9 hand-wave. Rejected.
      - Add an `isKnownFlake` tolerance to root/workspace stages (mirror `scripts/branch-coverage-audit.mjs`): hides non-timing failures and weakens evidence. Rejected.
      - Bound worker counts (chosen): the smallest change that removes oversubscription while keeping every assertion and its threshold.
    - Chosen Approach:
      - Root suites stage gains `--test-concurrency=4` between `--test` and the glob in `scripts/run-all-tests.mjs`.
      - `packages/memory/package.json` `scripts.test` gains the same flag *before* its glob list: npm `--` passthrough appends args after the globs (verified with `--fake-flag`), and Node silently ignores options after the first positional — so the package script itself must carry the flag.
      - Keep the workspace pool at 2 and bound only the memory leaf: measured under current load, memory bounded to 4 workers next to the full unbounded `prism-core` leaf passed 491 tests / 0 fail including the 5 ms check; `prism-work`'s only soft assertion is a 2000 ms document-extract budget and did not flake in the plan 122 runs, so it stays unchanged unless a later run fails it.
      - Gate suites gain the same bound after the first full chain run: the tool-search benchmark's `index+score` flaked at 50.826 ms against its frozen 50 ms ceiling while the stage ran at the default worker count (the redaction benchmark carries the same exposure). Bounded at 4, the stage passed twice; the runner test asserts the bound so it cannot regress.
    - API Notes and Examples:
      ```bash
      # measured 2026-09-25 under external load (load avg ~11 / 16 cores):
      # root suites, bounded -> 2120 tests, 0 fail, 41.9 s (run-bundle 5 ms budget passes)
      node --test --test-concurrency=4 dist/__tests__/*.test.js
      # memory leaf bounded-4 next to the full prism-core leaf -> 491 tests, 0 fail
      node ../../scripts/with-build-lock.mjs --shared node --test --test-concurrency=4 dist/__tests__/*.test.js dist/rag/__tests__/*.test.js
      ```
    - Files to Create/Edit:
      - `scripts/run-all-tests.mjs`: root and gate suites stages gain `--test-concurrency=4` plus dated comments pointing at the measured flakes and the plan 122 notes.
      - `scripts/run-all-tests.test.mjs`: assert the root-suite bound and the memory package script bound, each with a positive control.
      - `packages/memory/package.json`: `scripts.test` gains `--test-concurrency=4` before the first glob.
      - `docs/testing.md`: one sentence in the stage table (root suites / gate suites / workspace suites rows) naming the bound and its reason.
    - References:
      - `plans/122-Synapta-Integration-Review-Remediations.md` Compromises Made ("bound the root/workspace worker concurrency … rather than touching the benchmarks") and Task 9 execution notes (flake ids and serial reruns).
      - `scripts/run-all-tests.mjs` workspace-pool comment (plan 115 Task 2 measurement).
      - `docs/synapta-integration-review.md` §5 (7.61 ms vs 5 ms serial-only pass precedent).
  - Test Cases to Write:
    - `scripts/run-all-tests.test.mjs`: root suites args include `--test-concurrency=4` before the glob; gate suites carry the bound right after `--test`; `packages/memory` test script places the flag before the first positional; a positive control fails when any flag is removed; the existing partition/stage assertions still pass.
    - Full chain: two consecutive `npm test` runs, each 9/9 stages green, asserting the three named tests pass inside their stages.
    - Negative control: run the root suite once without the bound under the same host load and confirm the run-bundle 5 ms assertion can fail (documents the load sensitivity so the bound's reason stays verifiable).
  - Execution notes (2026-09-25, verified on the `949323af` tree with qemu + `laya-serve` resident; load average 3–18 on 16 cores):
    - **Deliverables.** `scripts/run-all-tests.mjs` root and gate suites now pass `--test-concurrency=4` (fixed literal, no adaptive logic) with dated comments; `packages/memory` `scripts.test` passes the same flag before its first positional (`node --test --test-concurrency=4 …`) because npm `--` passthrough appends args after the globs; `scripts/run-all-tests.test.mjs` asserts both bounds and the workspace pool `=== 2`, each with a positive control; `docs/testing.md` names the three worker-bounded stages (root, gate, memory leaf) and why.
    - **Gate-suite bound added during execution.** The first full chain run (root bounded, gate unbounded) failed only `scripts/benchmark-tool-search.test.mjs` — `index+score 50.826ms above frozen ceiling 50ms` — so the chosen approach's "gate suites stay unbounded for now" line could not satisfy the 9/9 acceptance. Bounding the gate stage at 4 removed it without touching the benchmark or its budget.
    - **Full local chain.** Run 1 (root bounded, gate unbounded): 8/9, only the tool-search cap failed. Runs 2 and 3 (root and gate bounded): 9/9 both; root suites 30.5 s / 35.2 s, gate suites 57.4 s / 67.9 s, workspace suites 31.2 s / 35.8 s, full chain well inside the release workflow's 30-minute phase timeout. Both green runs passed `snapshots 100 tools inside the 5 ms budget`, `checks each distinct source once per query, inside the 5ms budget for 50 sources`, and both `runs through the parameterized runner within the frozen caps` assertions.
    - **Negative control.** The unbounded root suite under the same host load (load average 17.76) failed `snapshots 100 tools inside the 5 ms budget` at 93.38 ms; the bounded runs pass it at 31.05 ms / 32.62 ms. No budget, ceiling, or assertion text changed.
    - **Post-verification interference (not a task result).** Later re-runs while other local agent sessions created plans 124–129 and rebuilt dist/ flaked on assertions this task did not bound: `docs.test.js` `plans index links every active numbered plan` (new plan files before their README rows), the branch-coverage classification-overhead cap (201.8% vs 10% under that added load), and prism-core's `waitFor` `atomically claims a queued run across two coordinators` 2 s poll timeout. The bounded stages' named assertions stayed green in those runs; runs 2 and 3 remain the two consecutive green chains the acceptance criterion asks for.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — the bounds change only how many test workers a stage spawns.
    - Docs pages to create/edit:
      - `docs/testing.md`: name the bounded stages and the reason (soft real-time assertions under host load).
    - `docs/index.md` update: no — no behavior delta for users.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Pin the F2–F4 legacy System One adapter fixes in the packed compat check
  - Acceptance Criteria:
    - Functional: `examples/host-composition-compat.ts` exposes a sixth check `legacy-adapter-safety` that passes from the current packed tarballs and fails closed as a named delta on pins that predate the F2–F4 fixes; one probe each for (a) exactly one credential resolution under the configured provider id, (b) malformed answers rejected instead of rendered to success text, (c) a `__proto__` choice label surviving into the rendered structured output.
    - Performance: the check adds one injected-fetch generate round trip; the consumer script stays far inside the examples-execution 60 s spawn ceiling (current five-check run ≈ 1.4 s).
    - Code Quality: no live network; the check uses only public package exports (`@arnilo/prism-providers/typesafe` root subpath) and its own local fetch stub; every failure path returns `{name, ok: false, delta}` instead of throwing; no Prism core code changes.
    - Security: the probe resolves a dummy credential through a resolver function, never a literal secret; response bodies are local fixtures; the `__proto__` label is handled with `Object.fromEntries`-style parsing and asserted via `Object.hasOwn`, never by prototype-carrying access.
  - Approach:
    - Documentation Reviewed:
      - `docs/synapta-integration-review.md` §2 F2–F4 (verbsatim: one credential resolve; shape/range validation before success; `__proto__` labels preserved) and §5 row "legacy-adapter compat probes".
      - `packages/prism-providers/src/typesafe/__tests__/typesafe.test.ts:1-45` (request shape: `{ model, messages: [{role:'user', content:[{type:'text', text}]}], options: { structuredOutput: { name, schema } } }`, schema enum choice, `createTypeSafeProvider`).
      - `packages/prism-providers/src/shared/systemone-provider.ts` (gates, single `resolveCredentialValue(options.apiKey, {provider: options.id, name:'apiKey'})`, `providerError(error, [apiKey])`).
      - `examples/host-composition-compat.ts` (dynamic-import-per-check pattern; every check returns a named delta instead of crashing on an old pin).
    - Options Considered:
      - Fold the probes into `typed-decisions-injected-transport`: mixes the new wrapper surface with the legacy adapter and makes the 0.9.0 delta name ambiguous. Rejected.
      - Probe only one of F2–F4: leaves two fixes unpinned. Rejected.
      - A separate compatibility suite: new harness for three assertions. Rejected as duplication of the packed consumer.
    - Chosen Approach:
      - Add one `legacy-adapter-safety` check that dynamically imports `@arnilo/prism-providers/typesafe`, builds a provider with `createTypeSafeProvider({ id: "TypeSafe Jev", apiKey: resolver, fetch: stub })`, and runs one `generate` with the structured-output request from the typesafe test fixture.
      - Resolver records requests; assert exactly one call with `provider: "TypeSafe Jev"` and `name: "apiKey"`.
      - Fetch stub answers a choice question whose criteria list includes `__proto__`; assert the wire request carries `__proto__` as an own criteria option (the F4 regression), the terminal text parses as JSON with `verdict === "__proto__"`, and a second stub answering a malformed `noul` without a probability (the pre-fix renderer coerced it to `false` success text) yields a `providerError` event and no success text (F3).
      - On pins without the fixes the same probes surface as a delta string naming which assertion failed, matching the existing pin-leg reporting.
    - API Notes and Examples:
      ```ts
      const { createTypeSafeProvider } = await import("@arnilo/prism-providers/typesafe");
      const resolves: CredentialRequest[] = [];
      const provider = createTypeSafeProvider({
        id: "TypeSafe Jev",
        apiKey: (request) => { resolves.push(request); return "dummy"; },
        fetch: stubFetch,
      });
      for await (const event of provider.generate(request)) events.push(event);
      ```
    - Files to Create/Edit:
      - `examples/host-composition-compat.ts`: new sixth check plus its local fetch stub and schema fixture.
      - `src/__tests__/host-composition-compat.test.ts`: assert the six check names, that the current leg reports `legacy-adapter-safety` ok, and that the pin leg lists it among the deltas when an old pin is exercised.
      - `docs/testing.md`: extend the examples-execution row to name the legacy-adapter probes.
    - References:
      - `plans/122-Synapta-Integration-Review-Remediations.md` Further Actions (legacy-adapter compat probes) and Task 8 execution notes.
      - `docs/synapta-integration-review.md` §2 F2–F4 rows.
  - Test Cases to Write:
    - Current leg: all six checks `ok: true` from packed tarballs, `legacy-adapter-safety` included.
    - Pin leg (`PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_FETCH=1`): `legacy-adapter-safety` appears as a named delta; after the fixes ship under a newer pin it disappears.
    - Direct probe assertions: resolver call count exactly 1 with the configured provider id; malformed answer never yields a success text; `Object.hasOwn(criteria, "__proto__")` is true for the wire criteria and the rendered `verdict` equals `__proto__`.
  - Execution notes (2026-09-25, verified on the `949323af` tree, Node 26.10.0):
    - **Deliverables.** `examples/host-composition-compat.ts` now exposes six checks; the new `legacy-adapter-safety` builds the legacy adapter with an object credential resolver and an injected fetch, runs F2 (one resolution under `TypeSafe Jev`/`apiKey`), F4 (own `__proto__` wire criteria option plus rendered `verdict === "__proto__"`), and F3 (malformed `{type:"noul"}` answer → `providerError`, no text delta). `src/__tests__/host-composition-compat.test.ts` asserts the six names, the legacy detail (`resolutions: 1`, `wireOptions: ["__proto__","ask"]`, `rendered: {verdict: "__proto__"}`, `malformedEvents: ["error"]`), and the 0.11.1 pin-leg delta; `docs/testing.md` names the probes.
    - **Probe correction.** The planned F3 probe ("a value outside the criteria") would have passed on pins without the fix — the pre-fix renderer already threw for an unmatched choice. The shipped probe answers a `noul` question without a probability, which the pre-fix code coerced to `false` success text and the fixed shape gate rejects.
    - **Checks.** Workspace example: 6/6 `ok: true`. `node --test dist/__tests__/host-composition-compat.test.js`: current leg 3 pass + 1 env-gated skip; `PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_FETCH=1`: 4 pass, with the delta `legacy-adapter-safety: AssertionError: credential resolved 2 time(s), expected exactly 1` (F2 fails first on the old pin, so F3/F4 stay inside the fixed check and the pin delta is named). `tsc -p examples --noEmit`, `scripts/examples-execution.test.mjs` (2/2), and biome format/lint on the touched files are clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — a consumer-side contract check; it pins behavior that already ships.
    - Docs pages to create/edit:
      - `docs/testing.md`: examples-execution row names the probes.
    - `docs/index.md` update: no — no navigation-relevant behavior delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Make the packed replay usable against any host-selected runtime
  - Acceptance Criteria:
    - Functional: `docs/testing.md` documents one replay command that runs the packed consumer contract against a host-selected Prism family runtime (registry version or pre-packed tarball directory), and states that observed deltas are appended to the review's remediation section; a rehearsal against the current release (0.11.1) is executed and recorded with its named deltas.
    - Performance: the rehearsal installs and runs in well under the existing 60 s example ceiling (measured ≈ 4 s workspace run, ≈ 10 s with a registry pack).
    - Code Quality: no new env vars or scripts — the existing `PRISM_TEST_COMPAT_PIN`, `PRISM_TEST_COMPAT_PIN_DIR`, `PRISM_TEST_COMPAT_PIN_FETCH` triple carries the whole procedure; the recipe lives once, in `docs/testing.md`, with the review doc linking to it by name.
    - Security: offline by default; the fetch route stays an explicit opt-in (`PRISM_TEST_COMPAT_PIN_FETCH=1`) and is named as registry access in the docs; no token or credential is read.
  - Approach:
    - Documentation Reviewed:
      - `docs/testing.md` examples-execution row (existing pin env-gate wording).
      - `src/__tests__/host-composition-compat.test.ts` pin-leg branches (`PIN_DIR` installs with `npm install --offline`; `PIN_FETCH=1` uses `npm pack <name>@<pin>`; skip-with-reason otherwise).
      - `docs/synapta-integration-review.md` §5 (verify the exact family release under Synapta's selected runtime before upgrading) and §6 (remediation table).
    - Options Considered:
      - Build a Synapta-specific runner: speculative until its runtime moves. Rejected.
      - Keep only the 0.9.0 wording: the mechanism already accepts any pin, but the procedure is undocumented and the delta destination is unstated. Rejected.
      - Document the existing mechanism and rehearse it once (chosen).
    - Chosen Approach:
      - Add a short "Replaying against a host-selected runtime" subsection to `docs/testing.md` next to the existing pin wording: pre-pack tarballs into a directory for offline use, or opt into a registry fetch, run `node --test dist/__tests__/host-composition-compat.test.js`, and append the delta block to `docs/synapta-integration-review.md` §6.
      - Add one sentence to review §6 pointing at that recipe so a future upgrade has a single documented path.
      - Record the 0.11.1 rehearsal in this plan's execution notes as the procedure's proof (four deltas on the fixed tree: `policy-chain-snapshot`, `om-coverage-admission-retention`, `typed-decisions-injected-transport`, and the Task 2 `legacy-adapter-safety`; `step-boundaries-and-trace-fields` and the Task 5/7 fixtures pass).
    - API Notes and Examples:
      ```bash
      # rehearsal (network opt-in), measured 2026-09-25:
      PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_FETCH=1 \
        node --test dist/__tests__/host-composition-compat.test.js
      # offline replay against host-pre-packed tarballs:
      PRISM_TEST_COMPAT_PIN_DIR=/path/to/family/tarballs \
        node --test dist/__tests__/host-composition-compat.test.js
      ```
    - Files to Create/Edit:
      - `docs/testing.md`: replay subsection + delta destination.
      - `docs/synapta-integration-review.md` §6: one pointer sentence to the recipe.
    - References:
      - `plans/122-Synapta-Integration-Review-Remediations.md` Task 8 execution notes and Further Actions ("Synapta upgrade replay").
      - `scripts/fixtures/packed-consumer.mjs` (pack/install helper).
  - Test Cases to Write:
    - Rehearsal: `PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_FETCH=1` run passes 4/4 and prints the three named deltas.
    - Default path: no env vars → 3 pass / 1 skip with the documented skip reason.
    - Offline path: pre-packed 0.11.1 tarball directory → passes without network (host-local prerequisite; skipped with reason if the directory is absent).
  - Execution notes (2026-09-25, verified on the `949323af` tree, Node 26.10.0):
    - **Docs.** `docs/testing.md` gained the “Replaying the packed contract against a host-selected runtime” subsection with both commands (registry opt-in and host-pre-packed tarballs) and the delta destination (the review's §6 remediation table); `docs/synapta-integration-review.md` §6 now links that recipe by name in its opening paragraph.
    - **Rehearsal (registry).** `PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_FETCH=1 node --test dist/__tests__/host-composition-compat.test.js` → 4/4 pass, 19.0 s whole file (pinned leg 9.3 s). Named deltas: `policy-chain-snapshot` (agent policies missing from the snapshot), `om-coverage-admission-retention` (`m2` dropped), `typed-decisions-injected-transport` (`./decisions` subpath missing), `legacy-adapter-safety` (credential resolved twice). `step-boundaries-and-trace-fields` and both Task 5/7 fixtures pass.
    - **Rehearsal (offline).** Pre-packed the four 0.11.1 tarballs into a host directory, then `PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_DIR=/tmp/prism-compat-pin-0111 node --test dist/__tests__/host-composition-compat.test.js` → 4/4 pass, 11.4 s whole file, same four deltas, no registry access (`npm install --offline` only).
    - **Default path.** No env vars → 3 pass / 1 env-gated skip; `docs.test.js` 156/156 and `live-doc-check.test.mjs` 6/6 green after the edits; biome clean on both docs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — documentation of an existing test opt-in.
    - Docs pages to create/edit:
      - `docs/testing.md`: replay recipe and delta destination.
      - `docs/synapta-integration-review.md`: §6 pointer sentence.
    - `docs/index.md` update: no — the review page is already linked.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Make the remediation wording release-state independent
  - Acceptance Criteria:
    - Functional: `docs/synapta-integration-review.md` §6 no longer describes the fixes as living in an unreleased CHANGELOG section; the sentence states the historical fact and where the entries ship, so no future cut owes a re-check.
    - Performance: not applicable — one prose edit.
    - Code Quality: `grep -n "unreleased section" docs/synapta-integration-review.md` finds nothing; the replacement sentence names `CHANGELOG.md` and the plan without version narrative.
    - Security: not applicable — documentation only.
  - Approach:
    - Documentation Reviewed:
      - `docs/synapta-integration-review.md` §6 opening sentence (current wording "local `0.11.1` tree plus an unreleased section in `CHANGELOG.md`").
      - `CHANGELOG.md` top section (`## [Unreleased]` added by plan 122 Task 9).
      - `plans/122-Synapta-Integration-Review-Remediations.md` Further Actions (changelog re-stamp item).
    - Options Considered:
      - Carry the re-stamp as a cut-time task here: the plan does not own the next version cut, so the task could never pass in-plan. Rejected.
      - Add a gate that fails when a version bump leaves `[Unreleased]` above a dated heading: new test machinery for one sentence. Rejected.
      - Make the wording timeless (chosen): zero follow-up, no moving parts.
    - Chosen Approach:
      - Rewrite the §6 sentence to: the recommendations were executed as plan 122 (Tasks 1–9, 2026-09-24/25, local `0.11.1` tree) and the `CHANGELOG.md` entries drafted there ship in the first release containing this plan.
      - Record in the execution notes that the reviewed decision is "retire, not defer" — the follow-up item closes here rather than being carried forward.
    - API Notes and Examples:
      ```bash
      grep -n "unreleased section" docs/synapta-integration-review.md   # must print nothing
      ```
    - Files to Create/Edit:
      - `docs/synapta-integration-review.md`: §6 opening sentence.
    - References:
      - `plans/122-Synapta-Integration-Review-Remediations.md` Further Actions (changelog re-stamp) and Task 9 CHANGELOG notes.
  - Test Cases to Write:
    - Grep assertion above (no "unreleased section" phrasing remains).
    - `node --test dist/__tests__/docs.test.js` and `node scripts/live-doc-check.test.mjs` stay green after the edit.
  - Execution notes (2026-09-25, verified on the `949323af` tree):
    - **Edit.** §6's opening sentence now states the recommendations were executed as plan 122 (Tasks 1–9, 2026-09-24/25, local `0.11.1` tree) and the `CHANGELOG.md` entries drafted there ship in the first release containing that plan — historical fact plus shipping destination, with no “unreleased section” phrase and no cut-time re-check obligation.
    - **Reviewed decision: retire, not defer.** The changelog re-stamp follow-up closes here instead of being carried forward; `CHANGELOG.md` keeps its own `[Unreleased]` heading, and nothing in the review’s wording depends on where the next cut lands.
    - **Checks.** `grep -n "unreleased section" docs/synapta-integration-review.md` → no output (exit 1). `node --test dist/__tests__/docs.test.js` 156/156 and `node scripts/live-doc-check.test.mjs` 6/6 green after the edit.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — historical remediation wording.
    - Docs pages to create/edit:
      - `docs/synapta-integration-review.md`: §6 opening sentence only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Verify the release-evidence regeneration flow end to end
  - Acceptance Criteria:
    - Functional: the execution notes carry (a) the latest successful `release` workflow run id, its `verify` job conclusion, and the fact that its `release:gate` phase runs with `PRISM_TEST_POSTGRES_URL` + `PRISM_RELEASE_POSTGRES_JOB=1` (so the Postgres surface records `protected`, never a fabricated `pass`); (b) the `postgres-integration` job conclusion for the same run, which runs the root `npm run test:postgres` and therefore writes real `scripts/postgres-evidence.json`; (c) a local CI-shaped `release:gate` run against a disposable `pgvector/pgvector:pg16` container that prints `release evidence: 45 surfaces, blocked=false`.
    - Performance: the local gate run stays within the plan 122 Task 9 measurement (≈ 1 min with a warm container); no new CI job or artifact is added.
    - Code Quality: no source change unless a documentation contradiction is found; if found, the fix is one paragraph in `docs/release-and-install.md` naming where each evidence file is regenerated.
    - Security: the container uses a disposable local password, the DSN appears only in the environment for the command, and the recorded evidence stays gitignored (`scripts/release-evidence.json`, `scripts/postgres-evidence.json`).
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/release.yml` (verify job's `phase release:gate` with the marker; `postgres-integration` job running root `npm run test:postgres` against `pgvector/pgvector:pg16`).
      - `docs/release-and-install.md:360-371` (manifest contents, required `PRISM_TEST_POSTGRES_URL`, CI-retained artifact) and `docs/testing.md:32` (postgres evidence contract).
      - `scripts/release-skip-manifest.mjs` postgres branches and `scripts/postgres-evidence.mjs`.
    - Options Considered:
      - Fabricate or hand-edit `release-evidence.json`: plan 122 forbade it; the CI marker legitimately records `protected`. Rejected.
      - Add a new CI job: the flow already exists and passed on the latest main run (`verify`, `postgres integration` both success). Rejected.
      - Verify and record (chosen): confirm the existing flow from CI plus one local CI-shaped run.
    - Chosen Approach:
      - Inspect the latest `release` workflow run with `gh run view --json jobs` and record the job conclusions and the marker line from the workflow.
      - Recreate a disposable `pgvector/pgvector:pg16` container, run `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` then `PRISM_TEST_POSTGRES_URL=… PRISM_RELEASE_POSTGRES_JOB=1 npm run release:gate`, record both outputs, remove the container.
      - Cross-check the two docs sections; edit only if they misstate who regenerates which file.
    - API Notes and Examples:
      ```bash
      gh run list --workflow=release.yml --limit 1 --json databaseId,conclusion
      gh run view <id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
      docker run -d --name prism-pg-test -e POSTGRES_PASSWORD=prism -e POSTGRES_DB=prism -p 5433:5432 pgvector/pgvector:pg16
      PRISM_TEST_POSTGRES_URL='postgres://postgres:prism@127.0.0.1:5433/prism' npm run test:postgres
      PRISM_TEST_POSTGRES_URL='postgres://postgres:prism@127.0.0.1:5433/prism' PRISM_RELEASE_POSTGRES_JOB=1 npm run release:gate
      ```
    - Files to Create/Edit:
      - None by default. If the docs cross-check fails: `docs/release-and-install.md` (one paragraph). Recorded in the task's execution notes.
    - References:
      - `plans/122-Synapta-Integration-Review-Remediations.md` Task 9 execution notes and Further Actions (release evidence is local-only).
      - `scripts/blocked-gate.mjs` (hint text for the disposable container recipe).
  - Test Cases to Write:
    - Verification script (no new file): the `gh run view` job list must show `verify` and `postgres integration` as `success` for the recorded run id.
    - Local: `npm run test:postgres` must exit 0 and write `scripts/postgres-evidence.json` with `gitHead` equal to `git rev-parse HEAD`; `npm run release:gate` must print `blocked=false` and a `postgres` surface not in `skipped`/`blocked` state.
    - Negative control: leaving `PRISM_TEST_POSTGRES_URL` unset must still produce a `blocked` Postgres row (proving the pass above came from evidence, not from a default), using `PRISM_RELEASE_EVIDENCE` redirected to a temp path so the real artifact is untouched.
  - Execution notes (2026-09-25, verified on the `949323af` tree, Node 26.10.0):
    - **CI evidence (a)/(b).** Run `36011001019` (`v0.11.1` push, `headSha 949323af…` = current HEAD, 2026-09-24T14:11:40Z) concluded `success`: `verify (SDK readiness: typecheck, test, pack dry-run)` success, `postgres integration (session-store, memory, enterprise adapters)` success, `publish (deterministic, resumable, provenance)` success; same-sha `main` run `36010992849` also success for both jobs (`publish`/CodeQL skipped by design). `.github/workflows/release.yml:64` runs `PRISM_TEST_POSTGRES_URL=… PRISM_RELEASE_POSTGRES_JOB=1 phase release:gate npm run release:gate` with the DSN declared on that phase only (lines 36–47 explain why it is not ambient), so a clean CI checkout with no gitignored evidence takes `scripts/release-skip-manifest.mjs:192` and records the Postgres surface `protected` — never a fabricated `pass`. The `postgres-integration` job (lines 129–161) runs `npm run test:postgres` against `pgvector/pgvector:pg16`, writing the real `scripts/postgres-evidence.json`. That last branch was reproduced locally with the marker, the URL, and a missing evidence path (redirected via `PRISM_POSTGRES_EVIDENCE`): state `protected`, `blocked=false`.
    - **Local CI-shaped run (c).** Started `prism-pg-test` (`pgvector/pgvector:pg16`, user/password/db `prism`, port 5433), ready in 2 s. `PRISM_TEST_POSTGRES_URL='postgres://prism:prism@127.0.0.1:5433/prism' npm run test:postgres` → exit 0 in 35.1 s and wrote `{gitHead: 949323af…, counts: {tests: 583, pass: 578, fail: 0}}`; `PRISM_TEST_POSTGRES_URL=… PRISM_RELEASE_POSTGRES_JOB=1 npm run release:gate` → exit 0 in 6.3 s, printing `release evidence: 45 surfaces, blocked=false` with row `test:postgres durable conformance` state `pass`, count 583. Container removed after the run.
    - **Negative control.** No URL, no marker, `PRISM_RELEASE_EVIDENCE=/tmp/neg-release-evidence.json PRISM_POSTGRES_EVIDENCE=/tmp/neg-postgres-evidence.json` → 45 surfaces, `blocked=true`, Postgres row `blocked` with reason `PRISM_TEST_POSTGRES_URL not set at release-evidence time`; the real `scripts/release-evidence.json` / `scripts/postgres-evidence.json` were untouched (both gitignored, `.gitignore:12–13`).
    - **Docs cross-check.** `docs/release-and-install.md` (required env at `release:gate`, evidence at the same HEAD, verify declares env only on the gate phase, `postgres-integration` runs the suite) and `docs/testing.md` (wrapper writes only `gitHead`/`captured`/TAP counts, accepted only at the same `HEAD`) match the workflow and scripts — no contradiction, so no edit was made.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification of an existing release flow.
    - Docs pages to create/edit:
      - `none` expected; `docs/release-and-install.md` one paragraph only if the cross-check finds a contradiction.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Worker concurrency for the timing-sensitive stages is a fixed `4`, not an adaptive or budget-relaxed scheme: the three flaky assertions keep their frozen thresholds and the cost is wall time only — bounded root suites measured 41.9 s against 47.4 s unbounded at 15 workers under the same load. Re-measure the literal if Node's test-runner scheduling or the CI host class changes (Tasks 1, 2, 3 chains were 9/9).
- The Task 2 F3 probe answers a malformed `noul` (missing probability) instead of the planned “choice value outside the criteria”: the latter already failed before the fix, so it could not pin the regression. On old pins the F2 assertion trips first, so the named delta string shows F2 while F3/F4 remain covered inside the fixed check.
- Replay support covers whole-family tarball directories and the registry route; there is no per-package partial replay.
- Release evidence stays a local must-run: the Postgres surface is `pass` only with local evidence at the current HEAD; CI `verify` records `protected` and `publish` depends on the separate `postgres-integration` job. Fabricating or hand-editing the artifact was explicitly rejected in plan 122, so the split is accepted as-is.

## Further Actions
- (Medium) Before Synapta upgrades to a newer family pin, run the Task 3 replay recipe from `docs/testing.md` and append the observed delta block to `docs/synapta-integration-review.md` §6 — the review's §5 already names that as the pre-upgrade check.
- (Low) If Node's test-runner scheduling changes or CI moves host classes, re-measure the `--test-concurrency=4` bounds against the 5 ms/50 ms ceilings and update the dated comments rather than loosening the assertions.
- (Low) When a pin newer than 0.11.1 ships the `@arnilo/prism-providers/decisions` subpath, re-run the pin leg: the `typed-decisions` delta should flip from “subpath missing” to behavioral probes, which is the check doing its job.
