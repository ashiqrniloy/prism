# Test layout and isolation

## What it does

Documents how the hermetic suite runs, which stage a new suite belongs to, and the isolation rules that keep tracked fixtures byte-identical between runs. Live and credentialed tiers are separate — see [Live and end-to-end testing](live-testing.md).

## When to use it

- Adding or moving a suite: pick its stage and follow the scratch-root rule below.
- Investigating a report that a test run modified tracked files or scaffolded directories in the repository.

## Running the suite

`npm test` delegates to `scripts/run-all-tests.mjs`, which runs five stages and reports every stage even when an earlier one fails:

| stage | contents |
| :--- | :--- |
| build | `npm run build` (all workspaces) |
| root suites | `dist/__tests__/*.test.js` |
| gate suites | `scripts/*.test.mjs` — the protection, truth, benchmark, journey, and conformance gates listed in `GATE_FILES` (`scripts/run-all-tests.mjs`) |
| build race | `scripts/phase23-build-race.test.mjs` |
| workspace suites | `npm run test --workspaces --if-present` |

Protected-environment legs (Postgres, PTY, NATS, live credentials) are not part of `npm test`; they fail closed with one canonical `BLOCKED GATE <id> requires=<names> evidence=<surface> hint=<how to unblock>` record and a non-zero exit when their infrastructure is absent (registry and audit: `node scripts/blocked-gate.mjs`). Retired phase freeze/release gates live in `scripts/` for audit but are deliberately kept out of the chain.

## Isolation rules

- **Scratch roots come from the OS.** A suite that writes anything creates its root with `mkdtempSync(join(tmpdir(), "prism-…"))` and removes it in `after()`. Never rely on `process.cwd()` for write targets: the same suite runs with different working directories (workspace stage vs. root stage), so a cwd-relative root silently writes into the repository.
- **Pass explicit roots.** Wiki, memory, and store helpers default `workspaceRoot` to `process.cwd()`; suites pass their scratch root (and a `wikiRoot` relative to it) instead of accepting the default.
- **Tracked fixtures stay byte-identical.** `packages/memory/.wiki/` is a tracked wiki fixture and `docs/` is a tracked corpus. `scripts/wiki-scratch-isolation.test.mjs` runs the wiki suites from the package and from the repository root and fails if the tracked fixture hashes change, if a new file appears inside the fixture, if `<repo>/.wiki/` is scaffolded, or if the old cwd-relative scratch directories reappear.
- **Gates never write inside the repository.** A gate asserts against tracked content and spawns suites in temporary directories only. A gate that spawns `node --test` must strip `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` from the child environment (an inherited value makes the nested runner skip every file and still exit 0) and assert the child reported a non-zero pass count.
- **Wait by polling, not by sleeping.** Async browser state (download quarantine, idle reaping) is not awaitable from the outside — `manager.ts` settles it on a fire-and-forget listener promise — so a fixed sleep is a race that loses under CPU load and fails the assertion for a reason unrelated to the behavior under test. Suites poll observable state through `waitFor(read, ok, label, { timeoutMs, intervalMs })` in `packages/web-tools/src/browser/__tests__/wait-for.ts`, which returns as soon as the state appears and otherwise throws naming the label and the last observed value. Fixed sleeps remain only where real elapsed time is the subject of the test (idle TTLs).

## Related APIs

- [Live and end-to-end testing](live-testing.md): live matrix, credential scoping, skip-not-fail contract.
- [Coverage gates](release-and-install.md): per-package line thresholds and the functional-surface baseline.
- `scripts/run-all-tests.mjs` — the stage table, `STAGES` and `effectiveTestChain()` exports.
