# Module decomposition — structure-budget evidence (2026-09-03)

Plan 059. One-time evidence (no permanent line-count gate). `graft build` refreshed after the splits.

## 1. Gate results

| Gate | Command | Result |
| --- | --- | --- |
| Dist tests | `npm test` dist stage | 1576 pass, 0 fail (10.8 s) |
| Script-stage benches / budgets | first `npm test` | 177 pass; 2 fail (export-count growth from splits; stale phase54 map in dirty tree) |
| Export + pack budgets | `node --test scripts/budget-gate.test.mjs` after rebaseline | 13/13 pass (root tarball + startup ceiling included) |
| Phase 54 map | regenerate + retest | 7/7 pass |
| Workspaces | `npm run test --workspaces --if-present` | 2564 pass, 0 fail |
| Coverage | `npm run test:coverage` | core 91.69 / 84.79 / 92.09 (gate 60/70/75); all non-protected package line floors met |
| Graft | `graft build` | 12318 nodes, 30915 edges |

Protected Postgres/NATS legs skipped as before (`PRISM_TEST_POSTGRES_URL` unset).

First full `npm test` stopped on the two script-stage fails above. After the export rebaseline and phase54 regen, those two suites and workspaces + coverage were re-run green. Remaining script-stage suites had already passed in the first run (benchmarks, conformance, packaging, lint).

## 2. Line budgets — plan targets (all files <800)

`wc -l` of production `.ts` after the splits. HEAD sizes from `git show HEAD:<file>`.

| Target (HEAD) | After (files) | Largest file |
| --- | --- | --- |
| `src/agent-session/session.ts` 1847 | 573 + `session/{assemble,persist,provider-round,tool-round,types}.ts` 454/197/234/541/139 = **2138** | 573 |
| `packages/prism-coding-tools/src/agent/process/sessions.ts` 1334 | 30 + `sessions-{host,monitor,recovery,spawn,teardown}.ts` 184/138/239/591/269 = **1451** | 591 |
| `packages/prism-core/src/runtime/workflows/saga.ts` 1198 | 271 + `saga-{drive,persist,types}.ts` 463/234/311 = **1279** | 463 |
| `packages/web-tools/src/browser/manager.ts` 1130 | 702 + `actions/*` 537 = **1239** | 702 |

Split overhead is duplicate imports/types, not new behavior.

## 3. Function budgets (graft skeleton spans)

| Function | HEAD | After |
| --- | --- | --- |
| `runInternal` | ~841 (`session.ts:322–1162`) | `executeRun` 165; `assembleRoundContext` 226 |
| `createProcessSessions` | ~1200 | wiring 30; `startSession` **254**; `makeHandle` 246 |
| `performAction` | ~329 | 34 (handler map dispatch) |
| saga drive | nested in 1198-line file | `driveSaga` 37; largest helper `reconcileForward` 79 |
| `createBrowserManager` | factory wrapping the file | still **547** as the closure factory; nested fns all ≤88 (`createSession`) |

`startSession` is 4 lines over the 250-line expected outcome. `createBrowserManager` remains a factory, not a 547-line algorithm.

## 4. Remaining production files >800 (out of scope)

13 files, none of the four plan targets. Persistence dialects left separate per review §2.6.

```
1050  packages/prism-core/src/sessions/postgres/persistence.ts
1039  packages/prism-core/src/runtime/server/artifacts.ts
1037  src/testing/persistence-schema.ts
1035  packages/prism-core/src/sessions/sqlite/persistence.ts
 990  packages/prism-core/src/enterprise/postgres/model-router.ts
 887  packages/ag-ui/src/handler.ts
 855  packages/prism-coding-tools/src/agent/git.ts
 850  packages/prism-core/src/sessions/postgres/event-source.ts
 845  packages/prism-coding-tools/src/agent/workspace-lifecycle.ts
 829  packages/prism-coding-tools/src/agent/coding-checkpoint.ts
 826  packages/prism-coding-tools/src/security/docker-sandbox.ts
 808  packages/prism-core/src/runtime/supervisor/a2a-client.ts
 801  packages/mcp/src/server.ts
```

779 production `.ts` files scanned (`src/` + `packages/`, excluding `__tests__` / `dist` / `node_modules`).

## 5. Export-count interaction (plan 058)

Plan 058 `measureExportCounts` walks every `src/**/*.ts` declaration `export`, not package barrels. Splitting a file requires module-level `export` for same-package imports, so the ceiling moved even though public barrels did not:

| Package | Was | Now | Why |
| --- | --- | --- | --- |
| `@arnilo/prism` | 1147 | 1170 | +23 `session/*` phase names; barrel still `RuntimeAgentSession` |
| `@arnilo/prism-coding-tools` | 923 | 951 | +28 `sessions-*.ts`; `process/index` still `createProcessSessions` |
| `@arnilo/prism-core` | 1208 | 1279 | saga-types/drive/persist + codec asserts |
| `@arnilo/prism-web-tools` | 276 | 300 | `actions/*` handlers; manager public surface unchanged |

Recorded in `scripts/budgets.json` `exportCounts.*.reason`.

## 6. No-new-assertion-edits proof (behavior-preserving)

Existing assertion lines in suites that already covered these modules were not edited.

Additive only:

- `packages/web-tools/src/browser/__tests__/browser.test.ts` — one new test (`rejects unknown action kinds`).
- `packages/prism-coding-tools/src/agent/__tests__/process-session-phases.test.ts` — new (3 failure-injection tests).
- `packages/prism-core/src/sessions/codecs/__tests__/parity.test.ts` — new (5 round-trip tests).

`git diff -U0` of `browser.test.ts` shows only the added `assert.rejects` block. Other dirty-tree test diffs (docs, freeze, packaging) are not this plan.

## 7. Benchmarks

From the first `npm test` script stage (all pass):

- `benchmark-0.1.0` capacity envelope
- multi-agent runtime baselines (10k eviction, 32 sessions, fan-out ≥1.4×, abort storm)
- tool-search scenario
- workflow-loop scenario
- phase26 100k-file index benchmark
- budget-gate root tarball + import startup ceiling (re-confirmed after export rebaseline)

No budget.json throughput/latency scenario failed.

## 8. Coverage note

Core gate green. After the session split, `dist/agent-session/session/tool-round.js` reports 55.39% lines under the dist-only coverage run (nested/durable replay paths). Overall `session.js` 98.50%; assemble/persist/provider-round ≥99% lines. Not a gate failure.

## 9. Chosen non-gates

Permanent `wc -l` gate deferred (plan 059: one-time evidence; plan 058 already owns pack/export/startup ceilings).
