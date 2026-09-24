# Test layout and isolation

## What it does

Documents how the hermetic suite runs, which stage a new suite belongs to, and the isolation rules that keep tracked fixtures byte-identical between runs. Live and credentialed tiers are separate — see [Live and end-to-end testing](live-testing.md).

## When to use it

- Adding or moving a suite: pick its stage and follow the scratch-root rule below.
- Investigating a report that a test run modified tracked files or scaffolded directories in the repository.

## Running the suite

`npm test` delegates to `scripts/run-all-tests.mjs`, which runs every stage in `STAGES` and reports each one even when an earlier stage fails:

| stage | runner | contents |
| :--- | :--- | :--- |
| build | `npm run build` | TypeScript emit for the root and every workspace |
| performance budget | `node --test` | `scripts/budget-gate.test.mjs`, alone because its ceiling measures host contention |
| root suites | `node --test` | `dist/__tests__/*.test.js` |
| sqlite suites | `bun test --timeout=0` | `packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js` — the one file set the Bun 1.4.2 inventory measured `bun-ok` and faster than Node; prism-core's own Node run excludes this glob |
| gate suites | `node --test` | `scripts/*.test.mjs` — the protection, truth, benchmark, journey, and conformance gates listed in `GATE_FILES` (`scripts/run-all-tests.mjs`), including the three split `scripts/phase54-legacy-registry-{dry-run,apply,fail-closed}.test.mjs` scenario files |
| build race | `node --test` | `scripts/phase23-build-race.test.mjs` |
| workspace suites | `npm run test --workspace <dir> --if-present` × 11 | each package's `node --test` file list, two packages in flight at a time; every leaf takes `scripts/with-build-lock.mjs --shared` |
| examples execution | `node --test` | `scripts/examples-execution.test.mjs` — spawns `examples/*.ts` not already run by docs demos or a dedicated spawn; manifest skips use a fixed vocabulary |
| branch coverage | `node` | `scripts/branch-coverage-audit.mjs` — Node instrument, core `dist/**` only; floor 83.49; Bun's gate still records `branches: null` |

Only the SQLite stage and the coverage instrument run on Bun. The root glob is ~2.3× slower under `bun test` and the prism-core workspace glob ~2.4× slower, so the split follows that measured classification instead of a wholesale switch; `npm run test:coverage` measures with `bun test --coverage` (Bun-measured floors, per-package `bunfig.toml` scoping) and runs the core suite once: the stage captures that run's output and exit code and `coverage-summary.mjs` parses the capture for the core row instead of spawning a second run (no seam set — a standalone summary, or a captured non-zero exit — still measures), while the PostgreSQL TAP leg stays on `node --test`.

The build lock has two modes: `tsc`/emit leaves keep the exclusive default, and dist-consuming test leaves pass `--shared`. Readers overlap each other (the workspace stage depends on it), while a writer still excludes every reader and a reader excludes writers — `scripts/phase23-build-race.test.mjs` proves both directions with concurrent children, plus stale-reader reclaim. The workspace stage's pool is bounded at two in-flight packages because some package suites carry soft real-time ceilings that a busier host starves; the bound and its upgrade path are documented at the stage in `scripts/run-all-tests.mjs`.

Protected-environment legs (Postgres, PTY, NATS, live credentials) are not part of `npm test`; they fail closed with one canonical `BLOCKED GATE <id> requires=<names> evidence=<surface> hint=<how to unblock>` record and a non-zero exit when their infrastructure is absent (registry and audit: `node scripts/blocked-gate.mjs`). A successful `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` first removes stale evidence, then writes gitignored `scripts/postgres-evidence.json` with only current `gitHead`, capture time, and TAP counts; release evidence accepts it only at the same `HEAD`. Retired phase freeze/release gates live in `scripts/` for audit but are deliberately kept out of the chain. 0.7.0 host-completeness packed proof is `scripts/fixtures/e2e-070-host-completeness-journey.mjs` (same packed consumer as the full-surface journey) plus `scripts/host-completeness-evidence.test.mjs`; live legs stay skip-not-fail. R16/R17 stay blocked until plans 077/074 ship.

## Isolation rules

- **Scratch roots come from the OS.** A suite that writes anything creates its root with `mkdtempSync(join(tmpdir(), "prism-…"))` and removes it in `after()`. Never rely on `process.cwd()` for write targets: the same suite runs with different working directories (workspace stage vs. root stage), so a cwd-relative root silently writes into the repository.
- **Pass explicit roots.** Wiki, memory, and store helpers default `workspaceRoot` to `process.cwd()`; suites pass their scratch root (and a `wikiRoot` relative to it) instead of accepting the default.
- **Tracked fixtures stay byte-identical.** `packages/memory/.wiki/` is a tracked wiki fixture and `docs/` is a tracked corpus. `scripts/wiki-scratch-isolation.test.mjs` runs the wiki suites from the package and from the repository root and fails if the tracked fixture hashes change, if a new file appears inside the fixture, if `<repo>/.wiki/` is scaffolded, or if the old cwd-relative scratch directories reappear.
- **Gates never write inside the repository.** A gate asserts against tracked content and spawns suites in temporary directories only. A gate that spawns `node --test` must strip `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` from the child environment (an inherited value makes the nested runner skip every file and still exit 0) and assert the child reported a non-zero pass count. `bun test` sets neither `BUN_*` nor `NODE_TEST_*` (measured on 1.4.2), so no `BUN_TEST_*` strip is added. The wiki gate additionally uses `--test-isolation=none`: all nested files run in its one runner process, avoiding process-worker IPC deserialization without retrying failures. A child that runs a Node-only test flag (such as `--test` or `--test-isolation`) spawns `node` by name instead of `process.execPath`: under a Bun parent `process.execPath` is a Bun child, and `bun --test` is a script run, not a test runner. Runner-agnostic spawns (`-e` snippets, CLI invocations) keep `process.execPath` on purpose — Bun's `-e` exists, which is why the root `bun test` run works. `scripts/tooling-gate.test.mjs` scans the repository for the violation.
- **Wait by polling, not by sleeping.** Async browser state (download quarantine, idle reaping) is not awaitable from the outside — `manager.ts` settles it on a fire-and-forget listener promise — so a fixed sleep is a race that loses under CPU load and fails the assertion for a reason unrelated to the behavior under test. Suites poll observable state through `waitFor(read, ok, label, { timeoutMs, intervalMs })` in `packages/web-tools/src/browser/__tests__/wait-for.ts`, which returns as soon as the state appears and otherwise throws naming the label and the last observed value. Fixed sleeps remain only where real elapsed time is the subject of the test (idle TTLs).

## Related APIs

- [Live and end-to-end testing](live-testing.md): live matrix, credential scoping, skip-not-fail contract.
- [Coverage gates](release-and-install.md): per-package line thresholds and the functional-surface baseline.
- `scripts/run-all-tests.mjs` — the stage table, `STAGES` and `effectiveTestChain()` exports.
