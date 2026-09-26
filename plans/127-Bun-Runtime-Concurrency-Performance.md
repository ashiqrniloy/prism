# Bun Runtime Concurrency and Performance

Plan 4 of 6 for the Bun-only migration (with [124](124-Bun-Only-Toolchain-And-Test-Runner.md),
[125](125-Bun-Only-Runtime-Contract.md), [126](126-Bun-Native-Sqlite.md),
[128](128-Test-Import-Migration.md), [129](129-Release-0-12-0.md)). Depends on plan 124 (Bun runtime everywhere first: baselines and
benchmarks must measure the runtime that ships). Owner scope 2026-09-25: leverage Bun's worker
parallelism and native APIs **wherever a measurement says it pays**.

Surveyed starting facts: the runtime has zero `worker_threads` usage today — every child is a
`node:child_process` spawn (coding-tools shell/git/language hosts, obscura, work connectors,
qmd-client), all of which run under Bun already. `node:worker_threads` works on Bun 1.4.2 (probed
live this session: spawn, message, terminate, exit 0). The agent runtime itself is I/O-bound
(provider streams, persistence, MCP), so worker wins are localized to measured CPU-bound surfaces
— this plan finds them by benchmark, not by enthusiasm.

Known CPU-bound candidates from the existing budget gates: tool-search `index+score` (frozen 50 ms
ceiling), redaction benchmarks, memory wiki source-scan (5 ms), prism-work document extract
(2000 ms), attention compilation, RAG chunk/fusion, JSONL parse cache, SQLite session ops
(now `bun:sqlite` after plan 126).

## Objectives

- One evidence file classifies every hot surface as I/O-bound (workers useless) or CPU-bound
  (worker/native candidate), with the benchmark that decided each row.
- A single internal worker-pool primitive exists **only if** the inventory names a surface where
  offloading wins on measurement; it is bounded, fail-closed, credential-free, and byte-capped.
- Native Bun APIs replace `node:` equivalents only where a benchmark shows a win and the path is
  non-security (content hashes/keys yes; `node:crypto` on security paths stays).
- Every landed change carries a before/after benchmark in the evidence file; every declined
  candidate carries the measurement that declined it. No speculative parallelism.

## Expected Outcome

- `docs/_evidence/phase127-bun-concurrency.md` holds the classification table, the probe
  transcripts, and the before/after numbers for whatever lands.
- If the pool lands: the winning surfaces use it, their budget-gate ceilings are re-frozen from
  the new measurements (plan 023 method), and the event-loop freedom (or throughput) gain is
  demonstrated by a benchmark, not asserted.
- Published API surface unchanged — the pool is internal; no new public export unless a task here
  explicitly plans one (none do). Compat baseline untouched.
- No blanket `node:`→`Bun.*` rewrite: the diff is surgical per measured row, and every untouched
  `node:` import stays (Bun runs them; portability costs nothing).

## Tasks

- [x] Task 1: CPU-bound inventory — classify every hot surface by measurement
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase127-bun-concurrency.md` exists and records, per surface —
      tool-search index+score, redaction scan, wiki source-scan, document extract, sheet parse,
      attention compilation, RAG chunk/fusion, JSONL session parse, sqlite session ops — a
      benchmark transcript on the Bun runtime (post-124): wall time, allocation profile where
      cheap (`Bun.gc(true)` bracketed), and a verdict row: `io-bound`, `cpu-inline` (fast enough
      in-process), or `cpu-offload-candidate`.
    - Functional: for each `cpu-offload-candidate`, a probe measures the worker round-trip cost
      (spawn-warm pool, message serialize/deserialize at realistic payload sizes) so the table
      states the break-even payload — offload pays only when compute > round-trip.
    - Functional: `scripts/plan-review-gate.test.mjs` gains a `PLAN_127_TASK_1` block.
    - Performance: benchmarks use the repo's existing suites where they exist
      (`scripts/benchmark-*.mjs`, budget gates); new micro-probes live in the evidence file as
      transcripts, not as committed one-off scripts.
    - Functional: two plan-124 carry-overs are probed in the same inventory. (a) A fixed-compute
      CPU-speed denominator for the startup-import ratio: `scripts/budget-gates.mjs`'s ceiling is a
      ratio whose denominator is an empty process start (2.9 ms under Bun against Node's 17-19 ms),
      so the ratio is a weak load-normalizer — record the probe and adopt it only if the ratio flakes
      again, per plan 124 Task 4's recorded upgrade path. (b) Whether Bun 1.4.x can emit branch
      coverage at all: that gap is the only reason `scripts/branch-coverage-audit.mjs` still spawns
      `node` (the tooling gate's sole sanctioned Node exception). Both verdicts land in the evidence
      file; neither changes a ceiling here.
    - Code Quality: one table, one verdict per row, every row citing a command.
    - Security: probes use synthetic payloads; no credentials, no real session data.
  - Approach:
    - Documentation Reviewed: `scripts/benchmark-tool-search.test.mjs` (50 ms ceiling),
      `scripts/benchmark-redaction.test.mjs`, `scripts/attention-measurements.test.mjs`,
      `scripts/budget-gate.test.mjs`; `packages/memory/src/wiki/manifest.ts` (`scanRawFiles`),
      `packages/memory/src/rag/{chunk,fusion}.ts`, `packages/prism-work/src/{document-reader,
      sheets,documents}`, `packages/prism-core/src/sessions/` (parse cache, sqlite after plan 126);
      https://bun.com/reference/node/worker_threads (Bun's implementation notes: core works,
      several options unimplemented) and the live probe from this session.
    - Options Considered: assume document extract and tool-search are the winners and build for
      them — rejected: the plan's own rule is measurement first; skipping it is how the 2.3×-slower
      wholesale-flip mistake from plan 113 §10 happens in reverse.
    - Chosen Approach: classify everything hot, then build only for rows that pay.
    - API Notes and Examples:
      ```js
      // break-even probe shape (transcript, not committed code)
      const pool = new Worker(new URL("./probe-worker.ts", import.meta.url));
      t0 = performance.now(); await roundTrip(payload); // vs inline compute of the same payload
      ```
    - Files to Create/Edit: `docs/_evidence/phase127-bun-concurrency.md` (new);
      `scripts/plan-review-gate.test.mjs` (`PLAN_127_TASK_1` block).
    - References:
      - Required tokens: `io-bound`, `cpu-offload-candidate`, `round-trip`, `50 ms`, `worker_threads`.
      - Rejected tokens: `parallelize everything`, `rewrite node: imports`, `pays for itself`.
  - Test Cases to Write:
    - Review gate block.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact).
    - Docs pages to create/edit: evidence file only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 1 execution note (2026-09-26): `docs/_evidence/phase127-bun-concurrency.md` landed with
    the 11-row classification table (7 `cpu-inline`, 1 `io-bound`, 3 rows spanning 4
    `cpu-offload-candidate` surfaces: PDF extract, docx parse, xlsx parse, csv parse), the warm
    `node:worker_threads` round-trip probe (0.016 ms at 0 B → 7.198 ms at 16 MiB; cold spawn+first
    echo 10.5-13.1 ms), per-candidate break-even rows, and both plan-124 carry-over probes
    (fixed-compute startup denominator: recorded, not adopted — narrower spread at moderate load,
    worse under saturation; Bun 1.4.2 branch coverage: confirmed absent — 0 `BRDA:` records, so the
    branch audit keeps its Node spawn). Probe scripts stayed in `/tmp/phase127` (not committed).
    Gate: `PLAN_127_TASK_1` block added to `scripts/plan-review-gate.test.mjs`; `bun test
    scripts/plan-review-gate.test.mjs` 14 pass / 0 fail, `bun test --timeout=0
    src/__tests__/docs.test.ts` 157 pass / 0 fail, the three cited benchmark gates 6 pass / 0 fail.
    The Approach and Files to Create/Edit did not deviate.

- [x] Task 2: Worker pool primitive — internal, bounded, fail-closed (only if Task 1 names a payer)
  - Acceptance Criteria:
    - Functional: if Task 1 names zero `cpu-offload-candidate` rows where compute beats
      round-trip at realistic sizes, this task closes as a recorded no-op citing the table — no
      primitive is built. Otherwise one internal pool lands: fixed max workers (a `ponytail:`
      comment names the ceiling and the measured upgrade path), work queue, structured error
      propagation (a worker crash fails the operation, never hangs), and explicit termination on
      parent teardown.
    - Functional: the pool uses `node:worker_threads` (Bun-supported, probed) with
      `new Worker(new URL(...))` module workers; no message exceeds the byte caps the operation
      already enforces at its trust boundary (`maxRequestBytes`-adjacent checks stay at the
      boundary, not in the pool).
    - Functional: workers receive no credentials: no env inheritance beyond an explicit allowlist
      (probe records what a Bun child inherits), no provider keys, no session secrets in payload
      logs; pool telemetry logs sizes, not contents.
    - Functional: one runnable check proves the failure path — kill a worker mid-task, assert the
      caller rejects and the pool recovers or shuts down.
    - Performance: Task 1's break-even table is cited in the pool's doc comment; the max-workers
      constant is the measured winner, not `os.availableParallelism()` verbatim (real-time budget
      co-tenancy, per plan 123 Task 1's flake history).
    - Code Quality: one file, no scheduler abstraction, no priority queues; YAGNI until a second
      caller needs them.
    - Security: fail closed on worker error; no `eval`-shaped messaging (message = typed task
      object); sandbox policies unaffected (workers are in-process-adjacent, not OS sandbox
      escapes).
  - Approach:
    - Documentation Reviewed: Task 1 table; https://bun.com/reference/node/worker_threads
      (unimplemented options list — the pool avoids them); plan 123 Task 1 (worker-count/
      real-time-budget co-tenancy).
    - Options Considered: `Bun.spawn` process pool — rejected for in-repo CPU work (heavier
      round-trip than threads; the coding-tools process hosts stay as they are); unbounded pool
      sized to CPU count — rejected (the plan 115/123 flake record).
    - Chosen Approach: bounded thread pool behind one internal helper, callers from Task 3.
    - API Notes and Examples:
      ```ts
      // packages/prism-core/src/runtime/worker-pool.ts (internal, not exported from index)
      export async function runInPool<TIn, TOut>(task: TIn, compute: (w: TIn) => TOut): Promise<TOut>
      ```
    - Files to Create/Edit: `packages/prism-core/src/runtime/worker-pool.ts` + its worker entry +
      one self-check test (tentative — location follows the winning caller's package).
    - References: live 1.4.2 probe transcript (this plan's header); plan 020 sandbox invariants
      (unchanged).
  - Test Cases to Write:
    - Kill-mid-task rejection test; bounded-concurrency test (never more than N workers); teardown
      termination test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal).
    - Docs pages to create/edit: none (internal primitive; the owning surface's docs note lands
      with its Task 3 edit if it changes observable performance guidance).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 2 execution note (2026-09-26): Task 1 named four paying `cpu-offload-candidate` surfaces,
    so the pool landed (no no-op). Files: `packages/prism-work/src/runtime/worker-pool.ts`,
    `worker-pool-entry.ts`, `__tests__/worker-pool.test.ts`, plus the `dist/runtime/__tests__/*.test.js`
    glob in the package test script. One deliberate deviation from the Approach's API sketch:
    `runInPool(task)` takes a typed `{ kind, payload }` object against a static handler map in the
    worker entry, because a compute function cannot cross the thread boundary and sending module
    paths/source in a message would be `eval`-shaped. `WORKER_POOL_MAX_WORKERS = 2` is the measured
    winner (8 x ~500 ms PDF extracts over N = 1/2/4/8: wall 5032/1905/1122/920 ms, per-extract p50
    542/471/548/852 ms, parent 5 ms tick gap 5.1 ms p50 at every N; table in evidence §8), with the
    `ponytail:` upgrade path on the constant. Bun 1.4.2 probes recorded: default workers inherit all
    69 parent env keys (planted secret visible) while `env: {…}` left 1 key; uncaught worker throw ->
    `error` + `exit` code 1 with the parent surviving; `ref`/`unref` both work. Tests: 6 pass / 0 fail
    (round-trip, bounded concurrency with queueing, credential-free env, kill-mid-task reject +
    recovery, unknown kind, teardown termination); full package suite 252 pass / 2 skip / 0 fail while
    the pool ran alongside the document-extract budget test. No public export changed. Incidental Task
    3 finding: the PDF `detect` path needs a real `Buffer` (structured-cloned `Uint8Array` fails until
    wrapped in `Buffer.from(...)`).

- [x] Task 3: Apply the pool to the measured winners
  - Acceptance Criteria:
    - Functional: each `cpu-offload-candidate` row Task 1 named as a payer is moved onto the pool
      (expected shape, to be confirmed by Task 1: prism-work document/sheet extraction off the
      agent's event loop for large payloads; tool-search batch scoring if the break-even holds).
      Each move keeps observable output identical — existing suites are the net.
    - Functional: per moved surface, the before/after benchmark lands in the evidence file: the
      surface's own latency AND the co-resident event-loop freedom (e.g. concurrent provider
      stream ticks during extraction) — the second number is the actual point of offloading.
    - Functional: budget-gate ceilings touching a moved surface are re-frozen from the new
      measurements (plan 124 Task 4's method), with the old number and reason in the task note.
    - Performance: no moved surface regresses its own wall clock beyond variance while gaining the
      loop-freedom metric; otherwise it is reverted and the revert recorded.
    - Code Quality: callers pass typed task objects; no pool-awareness leaks into public options
      (no unrequested knobs).
    - Security: payload crossing the worker boundary is the same data the operation already
      handles; redaction/secrets boundaries unchanged.
  - Approach:
    - Documentation Reviewed: Task 1 break-even rows; the winning surfaces' current code paths and
      their budget gates; plan 120 Task 1 (memory `readBranchPath` — the 3N→1N precedent for
      measured, surgical perf fixes).
    - Options Considered: make pool usage a public opt-in — rejected: no host asked; internal
      default with measured wins only.
    - Chosen Approach: surgical moves, benchmarked, revertable.
    - API Notes and Examples:
      ```ts
      const extracted = await runInPool({ bytes: doc }, extractDocWorker);
      ```
    - Files to Create/Edit: the winning surfaces' modules (tentative until Task 1); their tests
      unchanged (the net); `docs/_evidence/phase127-bun-concurrency.md` Task 3 tables.
    - References: `scripts/benchmark-*.test.mjs` (the instruments for before/after).
  - Test Cases to Write:
    - Existing suites of each moved surface pass unmodified; one loop-freedom benchmark transcript
      per surface.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no export change; performance behavior of internal paths.
    - Docs pages to create/edit: the owning surface's "Security and performance notes" section,
      one sentence, only if the observable latency profile changed.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 3 execution note (2026-09-26): all four payer rows were moved and A/B measured in the same
    process (evidence §9). Only the document reader's extract was kept: pool p50 365 ms vs inline
    350 ms (1.04x, final load/cpu 0.42), output identical, 0 -> ~60 co-resident 5 ms ticks. The three
    model-returning parses regressed beyond variance and were reverted per the task's own guard
    (csv 57 -> 149 ms, docx 76 -> 108 ms, xlsx 654 -> 859 ms): Task 1's break-even measured the input
    round-trip, but the result structured-clone is larger than the input (2.0-2.6 MB model JSON) and
    costs more than the parse. Reverts: `git checkout` on `sheets/csv.ts`, `sheets/xlsx.ts`,
    `documents/parse.ts`; those surfaces stay inline and unchanged. Landed for the kept row:
    `document-reader/index.ts` offload branch (>= 64 KiB, default parsers only), non-public
    `document-reader/parsers.ts` split reused by the worker entry, `document.extract` handler,
    `shouldOffloadToPool`/`WORKER_POOL_OFFLOAD_MIN_BYTES = 64 KiB` + `WorkerTaskError`/
    `reviveWorkerTaskError` in `worker-pool.ts`, and a non-terminal `closeWorkerPool()` (test files
    share a process). Real bug caught by the suite: statically imported worker handlers made every
    concurrent test process load the whole stack, blowing the 2000 ms envelope bound (7525/5260 ms);
    lazy per-handler imports fixed it (first spawn 264 ms, in-suite envelope 955-1283 ms). Ceiling
    disposition: `budgets.json` `docReader.extractMsCeiling` stays 2000 ms with the Task 3 provenance
    appended to its `$comment`; no other ceiling was touched. Checks: `offload.test.ts` pins pool
    text === inline parser text; prism-work 253 pass / 2 skip / 0 fail; root install-smoke +
    packaging 88 pass / 0 fail. Two shared-artifact updates came with the move: `budgets.json`
    `exportCounts["@arnilo/prism-work"]` rebaselined 406 -> 419 (+13 internal worker-pool/entry/
    parsers names, recorded in its `reason`; no package subpath added) and the package-truth docs
    regenerated (`bun scripts/package-truth.mjs --emit-docs`), which the truth gates require.

- [x] Task 4: Native Bun API wins — surgical, benchmark-backed, non-security only
  - Acceptance Criteria:
    - Functional: candidates are evaluated only where Task 1 marked a row hot and the operation is
      non-security: `Bun.hash`/`Bun.CryptoHasher` for non-crypto content keys and cache keys
      (session artifact digests used for identity, not secrecy), `Bun.file`/`Bun.write` streaming
      for hot file I/O if measured, `Bun.Glob` only if a scan row shows a win. Each adopted site
      carries its before/after in the evidence file; each declined site carries the number.
    - Functional: security paths keep `node:crypto` — the sha256 sites feeding approval-subject
      ids, run-state hashing, and redaction stay untouched (grep-verified in the task note);
      `Bun.hash` (non-crypto wyhash-style) must never back a security decision.
    - Functional: `@types/bun` (added by plan 126 Task 3) types any adopted `Bun.*` call; tsc emit
      stays clean; published `.d.ts` references resolve for Bun-typed consumers.
    - Performance: adopted sites show the measured win; no site is adopted for style.
    - Code Quality: no mixed voice within one module (a file uses either `node:` or `Bun.` for a
      given concern, not both).
    - Security: explicit list in the task note of every `Bun.hash` adoption with the one-line "why
      this is not a security path" justification.
  - Approach:
    - Documentation Reviewed: Task 1 table; https://bun.com/reference/global/Bun.hash and
      `CryptoHasher`; the `createHash` census from this plan's survey (`src/agent-approval.ts:293`,
      `src/agent-run-state.ts:208`, `src/artifacts.ts:273`, `src/attention-compiler.ts:728` —
      security-adjacent, expected to stay `node:crypto`).
    - Options Considered: blanket `node:`→`Bun.*` rewrite — rejected (zero measured upside, large
      diff, loses the portable subset); adopting `Bun.hash` everywhere a hash appears — rejected
      (security-adjacent sites stay on `node:crypto`).
    - Chosen Approach: per-site adoption, evidence-file ledger.
    - API Notes and Examples:
      ```ts
      const key = Bun.hash(content);          // cache-key row: non-security, measured win only
      const sub = createHash("sha256")...     // security row: stays node:crypto
      ```
    - Files to Create/Edit (as executed): `docs/_evidence/phase127-bun-concurrency.md` §10
      ledger + `scripts/tooling-gate.test.mjs` ledger assertion; no product site was adopted.
    - References: the hash census above; plan 021 (outbound trust boundaries — why crypto sites
      are frozen).
  - Test Cases to Write:
    - Adopted sites' existing tests pass; one ledger assertion that no `Bun.hash` call site is on
      the security-path list.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 4 execution note (2026-09-26): measured **no-op** — every candidate was declined with its
    number, so no product file changed and no `Bun.*` type surface was added. Probes
    `/tmp/phase127/probe-native-bun{,2}.mjs` (Bun 1.4.2, load 6.8/16 CPUs): per-file
    `Bun.CryptoHasher` 5.94 ms p50 vs `createHash` 5.27 ms (113%, slower) and 96.2% across the whole
    wiki scan (inside spread); `Bun.hash` 12.3x faster in micro (0.43 vs 5.27 ms per 2000x4KiB) and
    77.1% of the wiki scan (36.70 vs 47.59 ms) — declined because that digest is persisted identity
    (`manifest.sourceFileHashes`, `entity.sourceHash`, ingest ids built with `.slice(0, 8)`), so the
    ~11 ms win would rewrite a durable `.wiki/` manifest and force a host-wide re-index; `Bun.file`
    103.5% of `readFile` on the scan and equal on the 1.64 MB jsonl read; `Bun.Glob` equal inside the
    spread while requiring `DEFAULT_IGNORE_PATTERNS` to be re-derived as glob ignores; security sites
    measured at 0.48 vs 0.48 ms per 1000 (18 B) and inside noise at 2 KB, and `src/redaction.ts` has
    no digest at all. Typing: `types: ["bun"]` still fails `tsc` (plan 126 §11), so a future adoption
    follows the `src/bun-sqlite.d.ts` ambient-declaration pattern rather than adding a type package.
    Runnable half: `scripts/tooling-gate.test.mjs` "Bun-native hashing ledger: no Bun.hash on a
    security path" scans `src` + `packages/*/src`, keeps every native-hash hit inside its
    `ADOPTED_SITES` mirror (empty), and pins the 17 security-path files to `node:crypto` with
    positive/negative controls. Checks: tooling-gate 11 pass / 0 fail; plan-review-gate 14/0;
    docs 157/0; evidence `§10`; product source has zero `Bun.` globals, so the single-voice rule holds.

- [x] Task 5: SQLite/event-loop offload probe — expected recorded no-op
  - Acceptance Criteria:
    - Functional: one probe measures whether synchronous `bun:sqlite` session-store operations
      measurably block concurrent provider-stream ticks at realistic agent QPS (the classic
      sync-driver offload question). Expected verdict: no measurable interference at agent
      workloads → recorded no-op in the evidence file, pool not applied to persistence.
    - Functional: the probe names the QPS level where interference would begin, so a future
      high-volume host inherits a threshold, not a vibe.
    - Performance: probe only; no product change on the no-op path.
    - Code Quality / Security: unchanged surfaces; the no-op transcript is the deliverable.
  - Approach:
    - Documentation Reviewed: plan 126 Task 4 baselines; `bun:sqlite` sync semantics.
    - Options Considered: offload sqlite to a dedicated worker thread now — rejected without the
      measurement (adds a serialization boundary to every session write for a win the probe is
      expected to decline).
    - Chosen Approach: probe, record, close.
    - API Notes and Examples: `// evidence: interference begins > N writes/s (probe transcript)`.
    - Files to Create/Edit: `docs/_evidence/phase127-bun-concurrency.md` Task 5 section.
    - References: plan 115's lock/co-tenancy history.
  - Test Cases to Write:
    - None (probe artifact).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence file only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 5 execution note (2026-09-26): recorded **no-op** — probe artifact only, no product file
    changed. `/tmp/phase127/probe-sqlite-interference.mjs` (Bun 1.4.2, load 6.9/16 CPUs) drives the
    real store (`createSqlitePersistence`, file+WAL, ~300 B message rows) against a 5 ms provider-stream
    tick (200 chunks/s, 1.5 s), worst-of-3 runs. Appends: one yield per write 794/s → tick p95 5.07 ms;
    yield/10 5,609/s → 5.39 ms; yield/100 15,153/s → 7.89 ms; yield/1000 18,172/s (the sync ceiling) →
    62.26 ms with 300/300 ticks late; single append is 0.05/0.07/0.14 ms, so writes never stall a tick
    until aggregate duty owns the loop. Reads: ~1.4 µs per message row, so one `list()` reaches the
    5 ms cadence at ~3,000-4,000 rows (list(3000) 4.23 ms → 20/s gives tick p95 9.47 ms, 9 late ticks;
    list(20000) 37.74 ms → p95 44.56 ms, 110 late), while `list(200)`/`list(1000)` per turn keep every
    tick. Realistic workload: 20 sessions x 40 turns (append + list per turn, 2 turns/s) = 80 ops/s →
    tick p95 5.09 ms, max 15.24 ms, 1 late tick of ~4,000. Threshold inherited by a future high-volume
    host: per-op reads of ~3,500+ rows, or ~15k append/s sustained (~18k/s = every tick late), versus
    the ~750-1000x headroom an agent workload leaves. Host rule recorded: an unpaced loop over the sync
    driver starves the runtime (5,000 unpaced appends in 277.68 ms produced 0 ticks of ~56 expected),
    so the async wrapper does not make `bun:sqlite` non-blocking. Evidence `§11`.

## Compromises Made

- **Task 2 location and API shape.** The pool landed in `packages/prism-work/src/runtime/` rather than
  `packages/prism-core/src/runtime/`: all four Task 1 payers live in prism-work, and core's `runtime/`
  is the unrelated realtime area. `runInPool` takes a typed `{ kind, payload }` object instead of a
  task function (a function cannot cross the thread boundary, and shipping source strings would be
  eval-shaped), and `closeWorkerPool()` is deliberately non-terminal so one test process can recover
  the pool after teardown.
- **Task 3 reverted three of the four payers.** csv/docx/xlsx were offloaded, measured, and reverted:
  the result structured-clone (2.0-2.6 MB model JSON) exceeded the parse cost, so wall time regressed
  beyond variance (csv 57 -> 149 ms, docx 76 -> 108 ms, xlsx 654 -> 859 ms). Task 1's break-even table
  priced only the input round-trip; only the document reader's extract (text result, 64 KiB threshold)
  kept the move. This is a deliberate scope reduction, not a bug left in place.
- **Task 3 shared artifacts.** `budgets.json` `docReader.extractMsCeiling` stays 2000 ms with the
  Task 3 provenance appended to its `$comment`; `exportCounts["@arnilo/prism-work"]` was rebaselined
  406 -> 419 for 13 internal worker-pool/entry/parsers names (reason recorded, no public subpath
  added), and the package-truth docs were regenerated with `bun scripts/package-truth.mjs --emit-docs`
  as the truth gates require.
- **Tasks 4 and 5 are measured no-ops.** Task 4 adopted no `Bun.*` call (every candidate declined with
  its number; §10), so the acceptance line "`@types/bun` types any adopted call" is vacuous — and
  `types: ["bun"]` still fails `tsc` (plan 126 §11), so the recorded pattern for a future adoption is a
  narrow ambient declaration like `packages/prism-core/src/bun-sqlite.d.ts`. Task 5 changed no product
  file; its threshold numbers are the deliverable.
- **Collateral documentation damage (repaired).** Two `git checkout --` calls during Task 3 reverted
  uncommitted plan-125/126 edits to `README.md`, `docs/index.md`, `docs/release-and-install.md`, and
  `docs/_evidence/phase54-package-map.md`. The three hand-edited pages were reconstructed from the
  authoring operations recorded in the session transcripts (the evidence file and
  `scripts/package-truth.json` were regenerated), then re-verified: `docs.test` 157 pass / 0 fail and
  the truth gates 68 pass / 0 fail. The retired-driver gate caught one leftover example
  (`better-sqlite3` in the major-upgrade paragraph), now rewritten. A byte-exact confirmation still
  requires diffing those three pages against a pre-damage copy if one exists.


## Further Actions

- **Done (2026-09-26) — price max(input, result) clone cost in any future offload decision (high).**
  `shouldOffloadToPool({ inputBytes, resultValues, computeMs })` now charges both directions: input
  bytes at the measured flat clone rate (1.25 MB/ms) plus result values (containers and leaf
  strings/numbers) at 2,000 values/ms plus 0.1 ms scheduling, and offloads only when the measured
  compute is at least 10x that. The rule reproduces the Task 3 outcome on every measured row — pdf
  extract offloads, csv/xlsx/docx model results stay inline — and the document reader now passes
  `1 + maxPages * 4` result values with its measured ~1 ms per KiB inline cost. The predicate it
  replaced priced only the input round-trip, the exact gap that forced the revert. Clone tables and
  per-value prices: evidence `§12`; assertions:
  `packages/prism-work/src/runtime/__tests__/worker-pool.test.ts`. No new exports, so `exportCounts`
  and the generated package map are unchanged.
- **Done (2026-09-26) — byte-based format detection in the document reader (medium).** The PDF gate
  now compares the five magic bytes instead of decoding a string, and the zip gates search the docx /
  OOXML part names through a zero-copy `Buffer` view (a `Uint8Array` `includes("word/document.xml")`
  coerced the string to `NaN` and never matched). `DocumentParser`/`DocumentReader.extract` accept
  `Uint8Array` (a `Buffer` still is one), the OCR parser's `latin1`/`ascii`/base64 sites use the same
  view, and the worker entry's `Buffer.from(bytes)` wrap is gone. Tests: `index.test.ts` extracts
  `sample.pdf` / `sample.docx` / `thousand-page.pdf` as both a `Buffer` and a plain `Uint8Array` and
  asserts identical text and page counts (the 281 KiB case runs through the pool),
  `office-parsers.test.ts` feeds its generated `.xlsx` as a `Uint8Array`. Evidence `§13`;
  suites: prism-work 255 pass / 0 fail, the six gate files 211 pass / 0 fail, packed-consumer
  install-smoke + packaging 88 pass / 0 fail. No new exports and no budget change.
- **Done (2026-09-26) — re-check Bun branch coverage; exception stays until `BRDA` exists (medium).**
  Re-probed Bun 1.4.2: still zero `BRDA`/`BRF` records (evidence `§14`, same verdict as `§6`), so the
  Node spawn in `scripts/branch-coverage-audit.mjs` stays. The re-check is no longer a manual note:
  `probeBunBranchRecords()` runs before the Node instrument and fails the stage the day Bun emits
  `BRDA`, which is the delete signal for the spawn and its `NODE_SPAWN_EXCEPTIONS` entry. Live
  assertion: `scripts/branch-coverage.test.mjs` (6 pass / 0 fail).
- **Session JSONL parse sits at the 5 ms soft budget (low).** ~4-6 ms per 5,000 entries, and the
  append path re-parses the whole file; index or incremental parse is the upgrade path if session
  files grow much larger (evidence `§2` row 8).
- **Persistence stays on synchronous `bun:sqlite` until the `§11.4` threshold (low).** Per-op reads of
  ~3,500+ message rows or ~15k appends/s sustained are where it starts shaving provider-stream ticks;
  beyond that a pool/serialization boundary would have to be designed (the probe declined it now).
- **Tool-search index is pinned at the 1024-tool hard cap and stays cpu-inline (low).** Revisit only if
  the cap is raised; scoring is sub-millisecond even at the cap (evidence `§2` row 1).
- **Confirm the Task 3 document reconstruction (low).** If a pre-damage copy of `README.md`,
  `docs/index.md`, or `docs/release-and-install.md` exists, diff it against the current files; the
  current state satisfies every gate, but only a diff proves byte equality with the lost draft.
