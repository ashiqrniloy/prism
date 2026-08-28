# AI Runtime Concurrency and Performance

## Objectives
- Audit Prism core plus all 58 first-party workspaces (59 manifests including root) and classify each package's effect on model-call latency, concurrency, memory, I/O, and artifact size.
- Fix confirmed multi-agent, workflow, event, persistence-chain, and package-size regressions at shared roots.
- Add reproducible multi-agent capacity evidence so later changes cannot silently reduce throughput or lose events/state.

## Expected Outcome
- Concurrent agents, supervisor children, workflow agent nodes, and independent tool calls remain bounded, abortable, and free of post-return background work.
- Rejected serialized operations do not poison later JSONL, workflow-state, or checkpoint operations.
- Root package again passes artifact budgets; new multi-agent throughput/latency/resource gates cover current blind spots.
- One evidence matrix records all 59 manifests as hot-path, optional in-run, persistence/coordination, or setup-only.

## Tasks

- [x] Establish exhaustive package coverage and reproducible baselines
  - Acceptance Criteria:
    - Functional: Inventory all 59 manifests and map every package to model-call, prompt assembly, tool execution, coordination, storage, telemetry, or setup-only paths; no workspace is omitted.
    - Performance: Record p50/p95, throughput, heap delta, queued events, dropped events, active provider calls, and abort completion for 1/4/16/32 concurrent independent sessions, supervisor fan-out, workflow agent nodes, and tool concurrency.
    - Code Quality: Reuse `scripts/benchmark.mjs`/existing benchmark result schema; add no benchmark framework or production dependency.
    - Security: Use mock providers/in-process stores by default; no credentials, live endpoints, prompt bodies, or secrets in evidence.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`: existing capacity envelopes and benchmark methodology.
      - `docs/agent-session-runtime.md`, `docs/supervisors.md`, `docs/workflows.md`, `docs/model-routing.md`: concurrency ownership and limits.
      - `package.json` and `packages/*/package.json`: 59-manifest workspace inventory.
    - Options Considered:
      - Extend existing benchmark runner: smallest path and preserves result/gate conventions.
      - Add a load-test dependency: rejected; synthetic worker pools and `node:perf_hooks` suffice.
    - Chosen Approach:
      - Add one network-free concurrency scenario family and one checked evidence matrix before changing runtime behavior.
    - API Notes and Examples:
      ```bash
      npm run build
      node scripts/benchmark.mjs --scenario multi-agent-runtime --out /tmp/prism-multi-agent.json
      ```
    - Files to Create/Edit:
      - `scripts/benchmark.mjs`: register multi-agent scenario.
      - `scripts/benchmark-scenarios/multi-agent-runtime.mjs`: concurrent session/supervisor/workflow/tool fixtures.
      - `scripts/benchmark-multi-agent.test.mjs`: schema, safety, and regression assertions.
      - `scripts/budgets.json`: reviewed budgets after baseline capture.
      - `docs/_evidence/phase35-ai-runtime-package-matrix.md`: all-manifest coverage and baseline.
      - `docs/performance.md`: methodology and current results.
    - References:
      - `src/agent-session/session.ts:287-1103`.
      - `packages/supervisor/src/supervisor.ts:57-245`.
      - `packages/workflows/src/run/main.ts:82-135`.
      - `scripts/benchmark-0.1.0.mjs` and `scripts/benchmark-0.1.0.test.mjs`.
  - Test Cases to Write:
    - 32 independent sessions: provider-call cap, completion count, no shared-state rejection.
    - Supervisor saturation: bounded active children and deterministic limit behavior.
    - Parallel workflow agent nodes: output/event completeness under configured concurrency.
    - Abort storm: all provider/tool work settles within deadline and active counts return to zero.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; this task measures existing behavior.
    - Docs pages to create/edit:
      - `docs/performance.md`: multi-agent benchmark contract.
      - `docs/_evidence/phase35-ai-runtime-package-matrix.md`: exhaustive audit evidence.
    - `docs/index.md` update: no; `docs/performance.md` already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Repair current root artifact budget regression
  - Acceptance Criteria:
    - Functional: `npm pack --dry-run --json`, composite benchmark, budget gate, and publish surface remain correct.
    - Performance: Root packed bytes and file count return within reviewed ceilings without hiding required public API docs; current measured failure (945,422 bytes/377 files versus limits near 749,100 bytes/307 files) is eliminated.
    - Code Quality: Prefer package `files` exclusions or moving release-only evidence over raising budgets; any baseline increase must identify unavoidable shipped value by file group.
    - Security: Required security, migration, provider, and public API guidance remains available from repository docs; no generated artifacts or secrets enter package.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`: +5% artifact budget and historical docs diet.
      - `package.json#files`: current shipped roots and `_evidence` exclusion.
      - `scripts/budget-gate.test.mjs`: release gate.
    - Options Considered:
      - Raise baseline to current size: rejected unless file-by-file review proves all growth is consumer-required.
      - Exclude release/history/operator-only pages while retaining public API docs: preferred.
    - Chosen Approach:
      - Classify 126 shipped docs and 226 `dist` files, exclude repository-only history/evidence, then refresh baseline only for intentional public growth.
    - API Notes and Examples:
      ```bash
      npm pack --dry-run --json | node -e '/* group files by path/size */'
      node --test scripts/budget-gate.test.mjs
      ```
    - Files to Create/Edit:
      - `package.json`: narrow package file set.
      - `scripts/budgets.json`: only intentional post-diet baseline changes.
      - `scripts/budget-gate.test.mjs`: assert excluded categories stay excluded.
      - `docs/performance.md`: corrected artifact evidence.
      - Candidate docs moved/excluded (tentative): `docs/release-*-evidence.md`, release-history-only sections/pages identified by Task 1.
    - References:
      - Reproduction: `node scripts/benchmark-0.1.0.mjs --out /tmp/prism-benchmark-current.json` currently fails `rootPackedBytes` and `rootFileCount`.
      - `/tmp/prism-pack.json`: docs are ~1.96 MiB unpacked; `dist` ~1.10 MiB.
  - Test Cases to Write:
    - Dry pack contains every page linked by shipped `docs/index.md`.
    - Dry pack excludes `_evidence`, release-only evidence, maps, tests, and generated files.
    - Artifact-size sensitivity fixture still fails on deliberate inflation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; npm artifact documentation contents change, not runtime API.
    - Docs pages to create/edit:
      - `docs/performance.md`: artifact diet and measurements.
      - `docs/release-and-install.md`: shipped-vs-repository docs boundary if changed.
    - `docs/index.md` update: yes if any currently indexed page becomes repository-only; remove or redirect its navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Make serialized persistence chains recover after rejected operations
  - Acceptance Criteria:
    - Functional: A failed JSONL append, workflow state update, or workflow checkpoint save rejects its caller but does not prevent a later valid operation from running.
    - Performance: Recovery adds O(1) promise handling and preserves single-writer ordering; no busy retry or hidden I/O replay.
    - Code Quality: Use one local `chain.catch(() => undefined).then(operation)` pattern per queue; do not add a queue class.
    - Security: Failed validation/CAS writes remain failed closed; recovery never silently commits the rejected operation.
  - Approach:
    - Documentation Reviewed:
      - `docs/database-persistence.md`: adapter durability and conflict contracts.
      - `docs/workflows.md`: checkpoint/state behavior.
      - JavaScript `Promise.prototype.then/catch` semantics (ECMAScript built-ins).
    - Options Considered:
      - Reset chain only in outer catches: error-prone at each caller.
      - Recover before appending each queued operation: chosen shared root fix.
    - Chosen Approach:
      - Preserve each operation's rejection while storing a recovered tail for subsequent work. Checkpoint version rolls back only when save throws, so a later CAS write can succeed; the rejected value is not committed.
    - API Notes and Examples:
      ```ts
      const operation = chain.catch(() => undefined).then(save);
      chain = operation.catch(() => undefined);
      await operation;
      ```
    - Files to Create/Edit:
      - `src/node/session-store-jsonl.ts`: recover `appendChain`.
      - `packages/workflows/src/run/checkpoint.ts`: recover `checkpointChain`.
      - `packages/workflows/src/run/validation.ts`: recover `stateChain`.
      - Existing adjacent test files for JSONL/workflows.
    - References:
      - `src/node/session-store-jsonl.ts:35-66`.
      - `packages/workflows/src/run/checkpoint.ts:67-87`.
      - `packages/workflows/src/run/validation.ts:48-64`.
  - Test Cases to Write:
    - Corrupt/failed JSONL append followed by repaired valid append.
    - One injected checkpoint save rejection followed by successful checkpoint.
    - One invalid state update followed by valid state update with correct version/history.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; documented adapters recover for later calls after one rejected operation.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: serialized-chain failure recovery.
      - `docs/workflows.md`: state/checkpoint recovery semantics.
    - `docs/index.md` update: no; pages already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Preserve queued terminal events and deterministic close semantics
  - Acceptance Criteria:
    - Functional: Graceful `close()` stops new publications/sources but drains already queued events before iterator completion; overflow=`close` still emits its single notice and terminates.
    - Performance: Drain remains O(events) within existing queue cap and does not retain sources/listeners after close.
    - Code Quality: Keep generic `createEventMultiplexer`; do not fork workflow/supervisor buses.
    - Security: Bounds and overflow policy remain unchanged; close cannot turn queue retention into unbounded memory.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`: bounded subscriber queues.
      - `docs/workflows.md` and `docs/supervisors.md`: event streams.
    - Options Considered:
      - Keep destructive close: loses terminal events for lagging readers.
      - Separate graceful close and abort close: chosen if abort must discard immediately; otherwise one drain-on-close state is enough.
    - Chosen Approach:
      - Mark closed, stop sources, wake waiter, and let `subscribe()` drain queue before `done`.
    - API Notes and Examples:
      ```ts
      mux.publish(finalEvent);
      mux.close();
      // subscriber still receives finalEvent, then completes
      ```
    - Files to Create/Edit:
      - `src/event-multiplexer.ts`: graceful close state.
      - Root event-multiplexer tests (create if absent).
      - `packages/workflows/src/__tests__/events.test.ts`: close-with-backlog case.
      - `packages/supervisor/src/__tests__/supervisor.test.ts` (tentative): terminal delegation event drain.
      - `docs/performance.md`, `docs/workflows.md`, `docs/supervisors.md`.
    - References:
      - `src/event-multiplexer.ts:147-161` currently clears `queue`.
      - `packages/workflows/src/run/scheduler.ts:223` closes owned bus.
  - Test Cases to Write:
    - Close with queued events drains in comparator order.
    - Close with parked reader completes immediately after backlog.
    - Abort/overflow listener and observed-source cleanup occurs once.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; close delivery guarantee changes.
    - Docs pages to create/edit:
      - `docs/performance.md`: queue close/drain contract.
      - `docs/workflows.md`: terminal event delivery.
      - `docs/supervisors.md`: terminal delegation delivery.
    - `docs/index.md` update: no; pages already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded fan-out parallelism and supervisor saturation evidence
  - Acceptance Criteria:
    - Functional: `fan_out` maps independent items concurrently, returns output in input order, aborts promptly, and never exceeds an existing resolved workflow concurrency/fan-out cap; supervisor over-cap behavior remains explicit and tested.
    - Performance: N synthetic 20 ms fan-out items achieve at least 1.75x speedup at concurrency 2; 32 concurrent supervisor delegates stay within `maxActiveChildren` with zero leaked active count/timers.
    - Code Quality: Reuse the repository worker-pool pattern; add no scheduler/queue dependency and no speculative global admission service.
    - Security: Parallelism does not bypass node limits, ownership, permissions, checkpoints, output bounds, or abort signals.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md`: DAG concurrency and fan-out limits.
      - `docs/supervisors.md`: `maxActiveChildren`, timeout, nested limits.
      - `packages/evals/src/util.ts:94-113`: existing bounded ordered worker pool.
    - Options Considered:
      - Sequential fan-out: current safe behavior but O(N) wall time.
      - Unbounded `Promise.all`: rejected.
      - Small local worker pool capped by existing workflow concurrency: chosen.
    - Chosen Approach:
      - Extract/reuse a minimal internal `mapPool` only if package boundaries permit; otherwise copy the 15-line worker loop locally rather than add a cross-package dependency.
    - API Notes and Examples:
      ```ts
      const results = await mapPool(items, resolvedConcurrency, (item, index) => node.map(item, index, ctx), ctx.signal);
      ```
    - Files to Create/Edit:
      - `packages/workflows/src/run/node-execution.ts`: bounded fan-out map.
      - `packages/workflows/src/run/validation.ts` or existing limit resolver: expose resolved existing cap internally.
      - `packages/workflows/src/__tests__/workflows.test.ts`: ordering/cap/abort.
      - `packages/supervisor/src/__tests__/supervisor.test.ts`: saturation/timer cleanup.
      - `scripts/benchmark-scenarios/multi-agent-runtime.mjs`: fan-out/delegation rows.
      - `docs/workflows.md`, `docs/supervisors.md`, `docs/performance.md`.
    - References:
      - `packages/workflows/src/run/node-execution.ts:213-225` currently awaits each item serially.
      - `packages/supervisor/src/supervisor.ts:57-245` active-child counter and timeout lifecycle.
  - Test Cases to Write:
    - Ordered output despite out-of-order completion.
    - Worker count never exceeds cap.
    - First failure/abort settles workers and persists terminal workflow state.
    - Supervisor hook rejection/timeout decrements active count exactly once.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; fan-out timing/concurrency semantics change while output order stays stable.
    - Docs pages to create/edit:
      - `docs/workflows.md`: fan-out concurrency rule.
      - `docs/supervisors.md`: saturation behavior and benchmark.
      - `docs/performance.md`: measured rows.
    - `docs/index.md` update: no; pages already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify contention, regressions, and release readiness end to end
  - Acceptance Criteria:
    - Functional: Focused tests, all workspace tests, typecheck, lint, format, pack dry-run, security suites, and release gates pass.
    - Performance: New concurrency rows stay within frozen ceilings; enterprise PostgreSQL model-router contention is measured at 16/32 workers and either passes existing ceilings or receives a minimal bounded retry/backoff fix.
    - Code Quality: Update baselines only from reviewed reproducible evidence; no ignored failures or unexplained skips.
    - Security: Run concurrency/state conformance and threat suites; no cross-tenant data/event mixing under load.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`: protected PostgreSQL and release methodology.
      - `src/testing/state-concurrency-conformance.ts:154-184`.
      - `packages/enterprise-postgres/src/model-router.ts:486-514`.
    - Options Considered:
      - Raise router retries immediately: rejected until protected contention proves exhaustion.
      - Measure first, then tune bounded jitter/retries only if needed: chosen.
    - Chosen Approach:
      - Run network-free gates everywhere; run PostgreSQL protected rows when `PRISM_TEST_POSTGRES_URL` exists and record explicit skip otherwise.
    - API Notes and Examples:
      ```bash
      npm run typecheck && npm run lint && npm run format:check
      npm test && npm run test:coverage && npm run pack:dry-run
      npm run security:threat-suites
      PRISM_TEST_POSTGRES_URL='postgresql://…' npm run test:postgres
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/src/model-router.ts`: tentative, only on measured retry exhaustion.
      - `packages/enterprise-postgres/src/__tests__/model-router.integration.test.ts`: contention case.
      - `scripts/budgets.json`, benchmark evidence, and docs from prior tasks.
    - References:
      - `scripts/benchmark-0.1.0.test.mjs`.
      - `scripts/phase22-conformance.test.mjs`.
      - `package.json#scripts.sdk:ready`.
  - Test Cases to Write:
    - Full release command matrix.
    - Router reservation/commit contention with no oversubscription and bounded retry latency.
    - Repeat benchmark three times; compare medians and reject unexplained >10% regression.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional behavior beyond prior tasks.
    - Docs pages to create/edit:
      - `docs/performance.md`: final measurements and protected-gate status.
      - `docs/_evidence/phase35-ai-runtime-package-matrix.md`: final pass/skip matrix.
    - `docs/index.md` update: no; evidence stays non-navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Protected PostgreSQL 16/32 model-router contention and `npm run test:postgres` skipped: `PRISM_TEST_POSTGRES_URL` unset. `release:gate` blocked (cannot cut a release) for the same reason. No retry/backoff change in `packages/enterprise-postgres/src/model-router.ts` (measure-first).
- 16/32 reservation oversubscription proven on the memory model-router store (admit 3 of 26-token/100-cap slots). Same admission math as the existing postgres 16-client integration test, which remains URL-gated.
- Three-run median p95 vs Task 1 single-run recorded exceeds 10% on some 8 ms-fixture rows (1–2 ms scheduler noise). All rows stay far under frozen ceilings; ceilings not raised.
- Fan-out 3-run median 84.5 ms p95, 1.87× speedup, peak workers 2. Copied a 15-line `mapPool` into workflows instead of importing evals.

## Further Actions
- Before a release cut: set `PRISM_TEST_POSTGRES_URL` and run `npm run test:postgres` plus `node scripts/benchmark-0.1.0.mjs` protected legs (16/32 router contention). High if shipping; otherwise skip.
- If durable serialization retries exhaust at 32 workers, then tune `MAX_TRANSACTION_ATTEMPTS` / `retryDelay` (currently 3 attempts, `2^attempt + 0–2 ms`). Low until measured.
- Optional: gate sub-20 ms mock-delay rows on ceilings only, not 10% vs a single-run recorded p95. Low.
