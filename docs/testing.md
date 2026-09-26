# Test layout and isolation

## What it does

Documents how the hermetic suite runs, which stage a new suite belongs to, and the isolation rules that keep tracked fixtures byte-identical between runs. Live and credentialed tiers are separate — see [Live and end-to-end testing](live-testing.md).

## When to use it

- Adding or moving a suite: pick its stage and follow the scratch-root rule below.
- Investigating a report that a test run modified tracked files or scaffolded directories in the repository.

## Running the suite

`bun run test` delegates to `scripts/run-all-tests.mjs`, which runs every stage in `STAGES` and reports each one even when an earlier stage fails:

| stage | runner | contents |
| :--- | :--- | :--- |
| build | `bun run build` | TypeScript emit for the root and every workspace |
| performance budget | `bun test --timeout=0` | `scripts/budget-gate.test.mjs`, alone and single-process because its ceiling measures host contention |
| root suites | `bun test --parallel=4 --timeout=0` | `dist/__tests__/*.test.js` — bounded at 4 workers (plan 124 Task 2, measured 2026-09-25) so the run-bundle 5 ms snapshot budget stops flaking under host load without changing the threshold; `--path-ignore-patterns=packages/**` keeps the two suffix twins (`content.test.js`, `schema.test.js`) in the workspace stage only |
| sqlite suites | `bun test --timeout=0` | `packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js` — prism-core's own run excludes this glob, so each SQLite file runs exactly once |
| gate suites | `bun test --parallel=4 --timeout=0` | `scripts/*.test.mjs` — the protection, truth, benchmark, journey, and conformance gates listed in `GATE_FILES` (`scripts/run-all-tests.mjs`), including the three split `scripts/phase54-legacy-registry-{dry-run,apply,fail-closed}.test.mjs` scenario files; bounded like the root suites because the tool-search and redaction benchmarks assert frozen absolute-time caps |
| build race | `bun test --timeout=0` | `scripts/phase23-build-race.test.mjs` (unwrapped: its children take the real build lock) |
| workspace suites | `bun run --cwd <dir> test` × 11 | each package's `bun test --parallel=4 --timeout=0` file set, two packages in flight at a time; every leaf takes `scripts/with-build-lock.mjs --shared` |
| examples execution | `bun test --timeout=0` | `scripts/examples-execution.test.mjs` — spawns `examples/*.ts` not already run by docs demos or a dedicated spawn; manifest skips use a fixed vocabulary. `examples/host-composition-compat.ts` is the packed-install contract consumer: its companion root suite (`host-composition-compat.test.ts`) packs the family tarballs into a fresh consumer, installs them on Bun (`bun install --offline`, plan 125 Task 2) and runs the contract plus the Task 5/7 fixtures there; the contract's sixth check `legacy-adapter-safety` probes the legacy System One adapter (one credential resolution under the configured provider id, malformed answers rejected instead of rendered, `__proto__` choice labels kept as own wire options); the pinned-old-family delta leg is env-gated (`PRISM_TEST_COMPAT_PIN_DIR` for pre-packed tarballs, `PRISM_TEST_COMPAT_PIN_FETCH=1` to pack from the registry, `PRISM_TEST_COMPAT_PIN` to change 0.9.0) and offline by default |
| branch coverage | `bun scripts/branch-coverage-audit.mjs` | the audit keeps its internal **Node** branch instrument (Bun 1.4.2 emits no branch data); core `dist/**` only; floor 83.49; Bun's own coverage gate still records `branches: null` |

| total (offline test budget) | `bun run test` | the whole chain, pinned `< 240s` with a measured local baseline of ~200 s (plan 124 Task 6; the pin, its method, and every load row are in `docs/_evidence/phase115-suite-budget.md` §20). The number is wall clock on a quiet host: the same chain measured 156-200 s in the quiet band and 266-588 s while an unrelated 5-VM cluster saturated this 16-CPU host, so a red pin on a loaded machine is a host reading, not a suite regression. |

Every stage runs the Bun binary (plan 124 Task 2). Bun's test runner is at parity or faster than the retired Node runner at equal file counts (root 27.1 s vs 29.7 s; gate 48.0 s vs 50.0 s, same-load A/B in `docs/_evidence/phase124-bun-only-inventory.md` §9.3) and the examples stage is ~2.8× faster because its spawned `.ts` children run natively. `bun run test:coverage` measures with `bun test --coverage` (Bun-measured floors, per-package `bunfig.toml` scoping) and runs the core suite once: the stage captures that run's output and exit code and `coverage-summary.mjs` parses the capture for the core row instead of spawning a second run (no seam set — a standalone summary, or a captured non-zero exit — still measures). The PostgreSQL leg runs `bun test` and `scripts/postgres-evidence.mjs` reads its reporter: one `(pass)`/`(fail)` line per executed test plus the trailing `Ran N tests across M files.` summary, with the exit code as the first gate. A missing or unparseable summary, a zero-test capture, or any `(fail)` line fails closed — no evidence file is written, so a broken leg can never read as a green one.

The build lock has two modes: `tsc`/emit leaves keep the exclusive default, and dist-consuming test leaves pass `--shared`. Readers overlap each other (the workspace stage depends on it), while a writer still excludes every reader and a reader excludes writers — `scripts/phase23-build-race.test.mjs` proves both directions with concurrent children, plus stale-reader reclaim. The workspace stage's pool is bounded at two in-flight packages because some package suites carry soft real-time ceilings that a busier host starves; the bound and its upgrade path are documented at the stage in `scripts/run-all-tests.mjs`.

Protected-environment legs (Postgres, PTY, NATS, live credentials) are not part of `bun run test`; they fail closed with one canonical `BLOCKED GATE <id> requires=<names> evidence=<surface> hint=<how to unblock>` record and a non-zero exit when their infrastructure is absent (registry and audit: `bun scripts/blocked-gate.mjs`). A successful `PRISM_TEST_POSTGRES_URL=… bun run test:postgres` first removes stale evidence, then writes gitignored `scripts/postgres-evidence.json` with only current `gitHead`, capture time, and reporter counts; release evidence accepts it only at the same `HEAD`. Retired phase freeze/release gates live in `scripts/` for audit but are deliberately kept out of the chain. 0.7.0 host-completeness packed proof is `scripts/fixtures/e2e-070-host-completeness-journey.mjs` (same packed consumer as the full-surface journey) plus `scripts/host-completeness-evidence.test.mjs`; live legs stay skip-not-fail. R16/R17 stay blocked until plans 077/074 ship.

### Replaying the packed contract against a host-selected runtime

The packed-install contract can be replayed against any Prism family release with the existing pin triple — no new script or variable, offline by default:

```bash
# Registry route: explicit network opt-in, packs @arnilo/prism*@<pin> from npm.
PRISM_TEST_COMPAT_PIN=0.11.1 PRISM_TEST_COMPAT_PIN_FETCH=1 \
  bun test --timeout=0 dist/__tests__/host-composition-compat.test.js

# Offline route: tarballs the host already packed, installed with `bun install --offline`
# (a cold cache retries with `--prefer-offline`: registry metadata for externals only).
PRISM_TEST_COMPAT_PIN_DIR=/path/to/family/tarballs \
  bun test --timeout=0 dist/__tests__/host-composition-compat.test.js
```

Without either variable the leg skips with its reason; a missing pin or an install that cannot resolve offline also skips with a reason instead of failing. Every failing check prints a named delta (`<check>: <assertion>`, plus any Task 5/7 fixture delta); **append that delta block to the remediation table in the [Synapta integration review](synapta-integration-review.md#6-remediation-status)** — deltas observed by a host-selected runtime belong in that section, not in this file. The 0.11.1 rehearsal on 2026-09-25 measured ≈9 s for the pinned leg on the registry route (≈19 s for the whole file, current leg included) and ≈11 s for the whole file on the offline route; the offline route does no first-party network work: the tarballs the host packed are the installed packages, recorded by path in the consumer lockfile.

## Isolation rules

- **Scratch roots come from the OS.** A suite that writes anything creates its root with `mkdtempSync(join(tmpdir(), "prism-…"))` and removes it in `after()`. Never rely on `process.cwd()` for write targets: the same suite runs with different working directories (workspace stage vs. root stage), so a cwd-relative root silently writes into the repository.
- **Pass explicit roots.** Wiki, memory, and store helpers default `workspaceRoot` to `process.cwd()`; suites pass their scratch root (and a `wikiRoot` relative to it) instead of accepting the default.
- **Tracked fixtures stay byte-identical.** `packages/memory/.wiki/` is a tracked wiki fixture and `docs/` is a tracked corpus. `scripts/wiki-scratch-isolation.test.mjs` runs the wiki suites from the package and from the repository root and fails if the tracked fixture hashes change, if a new file appears inside the fixture, if `<repo>/.wiki/` is scaffolded, or if the old cwd-relative scratch directories reappear.
- **Gates never write inside the repository.** A gate asserts against tracked content and spawns suites in temporary directories only. A gate that spawns a **Node** nested runner must strip `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` from the child environment (an inherited value makes the nested runner skip every file and still exit 0) and assert the child reported a non-zero pass count; `bun test` sets neither `BUN_*` nor `NODE_TEST_*` (measured on 1.4.2), so a Bun child needs no strip. The wiki gate spawns a plain sequential `bun test`: every nested file runs in its one runner process — the guarantee `--test-isolation=none` gave — avoiding process-worker IPC deserialization without retrying failures. No repository spawn names `node` (a Bun-only host may not have the binary) and no Node-only test flag rides `process.execPath` (Bun under the only parent, where `bun --test` is a script run, not a test runner); `scripts/tooling-gate.test.mjs` scans the repository for the violation, with one documented exception: `scripts/branch-coverage-audit.mjs` keeps the Node branch instrument. Runner-agnostic spawns (`-e` snippets, CLI invocations) keep `process.execPath` on purpose — Bun's `-e` exists.
- **Wait by polling, not by sleeping.** Async browser state (download quarantine, idle reaping) is not awaitable from the outside — `manager.ts` settles it on a fire-and-forget listener promise — so a fixed sleep is a race that loses under CPU load and fails the assertion for a reason unrelated to the behavior under test. Suites poll observable state through `waitFor(read, ok, label, { timeoutMs, intervalMs })` in `packages/web-tools/src/browser/__tests__/wait-for.ts`, which returns as soon as the state appears and otherwise throws naming the label and the last observed value. Fixed sleeps remain only where real elapsed time is the subject of the test (idle TTLs).

## Related APIs

- [Live and end-to-end testing](live-testing.md): live matrix, credential scoping, skip-not-fail contract.
- [Coverage gates](release-and-install.md): per-package line thresholds and the functional-surface baseline.
- `scripts/run-all-tests.mjs` — the stage table, `STAGES` and `effectiveTestChain()` exports.
