# Phase 127 — CPU-bound inventory (Task 1)

Plan: `plans/127-Bun-Runtime-Concurrency-Performance.md` Task 1. One table classifies every hot
surface as `io-bound`, `cpu-inline` (fast enough in-process), or `cpu-offload-candidate`, with the
benchmark that decided each row. Worker `round-trip` cost is probed per candidate so the break-even
payload is stated, not guessed. Two plan-124 Task 4 carry-overs are probed at the end.

Host: bun 1.4.2 (744846f84), Linux x64, AMD Ryzen 9 PRO 7940HS, 16 CPUs, 61 GiB RAM, 2026-09-26.
`process.version` under Bun reports `v26.3.0`. Benchmarks ran at load/cpu 0.5-0.8 unless a
section says otherwise; the machine was busy with unrelated work all session, so every number is
min-of-N with N stated. All payloads are synthetic; no credentials, no session data.

## 1. Method

- **Existing suites first.** tool-search, redaction and attention-compiler have registered scenarios
  under `scripts/benchmark-scenarios/`; their runner output is the transcript for those rows.
- **Micro-probes for the rest.** The remaining surfaces have no committed benchmark, so a scratch
  probe (`/tmp/phase127/*.mjs`, not committed) imported the source module directly and timed the
  operation the runtime actually calls. Fixtures were scaled to the largest realistic payload the
  owning caps admit; probe source shape is described per row so the transcript is reproducible.
- **Loop impact.** `setInterval(…, 5)` ticks were sampled across the operation. Calibration on this
  host: a 200 ms synchronous spin yields `ticks 0`; a 200 ms `await setTimeout` yields 39 ticks.
  So `ticks 0` means the operation never returned to the event loop — blocking CPU — and a tick
  `maxGap` is the worst synchronous stretch.
- **Allocation.** `Bun.gc(true)` brackets the operation and `process.memoryUsage().heapUsed` before/
  after gives retained heap for the result object. p50 of 3 runs; first-run numbers carry lazy-import
  cost and are not the profile.
- **Verdict rule (declared up front, applied uniformly).**
  - `io-bound`: wall time is dominated by `await`ed I/O; the synchronous stretch per await is under
    one 10 ms tick, so a worker adds no event-loop freedom the async path does not already have.
  - `cpu-inline`: blocking compute p50 ≤ 10 ms on the fixture (the largest the public caps admit, or
    the per-call hot-path size); offload round-trip is smaller but the absolute block is inside one
    tick class and does not justify a worker boundary.
  - `cpu-offload-candidate`: blocking compute p50 > 10 ms at a realistic payload size **and**
    compute ≥ 10x the warm-pool round-trip at that size (the plan's break-even rule). The candidate
    is named as a candidate here; whether the pool is built is Task 2, and whether the surface moves
    is Task 3.

## 2. Classification table

All commands below run from the repo root on the Bun runtime.

| # | surface | fixture (largest realistic) | command | wall time | retained heap | loop impact | verdict |
| :-- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | tool-search `index+score` | 128 tools / 30 KiB schema (frozen gate fixture); hard cap 1,024 tools | `bun scripts/benchmark.mjs --scenario tool-search` x3 | `index_score_ms` 1.883 / 1.469 / 2.458 (ceiling 50 ms); 1,024-tool hard cap: build 4.93 ms p50 + score 0.21 ms p50 | 70 KiB p50 (scenario report, in-process `Bun.gc(true)`) | blocking but ≤ 5 ms per stretch | `cpu-inline` |
| 2 | redaction scan | 1 MiB transcript + 16 secret-shaped needles; 1,000-string entry object | `bun scripts/benchmark.mjs --scenario redaction` x3 | single-scan p50 0.44 / 0.39 / 0.41 ms; p95 1.071 / 1.016 / 1.536 ms; interleaved speedup 7.38 / 9.14 / 6.82 | 3 KiB p50 | sub-ms; security path stays in-process | `cpu-inline` |
| 3 | wiki source-scan (`scanRawFiles`, `packages/memory/src/wiki/manifest.ts:L36`) | 2,000 files x 4 KiB = 7.8 MiB, 20 dirs | `bun /tmp/phase127/probe-wiki-classify.mjs` | wall 55.0 ms; sha256-only CPU for the same buffers 5.7 ms p50 | 373 KiB p50 (hash map) | ticks 10, gap p50 5.0 ms max 6.2 ms — yields between files | `io-bound` |
| 4 | document extract — PDF (`createDocumentReader`, `packages/prism-work/src/document-reader/index.ts:L226`) | `thousand-page.pdf` 288,031 B, 1,000 pages | `bun /tmp/phase127/probe-work.mjs`; `bun /tmp/phase127/probe-pdf.mjs` | 249.1 / 264.3 / 282.9 ms (bench), 364.0 / 279.9 / 315.3 ms (tick runs); 872 B `sample.pdf` 1.8 ms | 3.1 MiB p50 | ticks 0 across 3 runs — blocks the loop for the full parse | `cpu-offload-candidate` |
| 5 | document parse — OOXML docx (`parseDocument`, `packages/prism-work/src/documents/parse.ts:L250`) | 60,094 B docx, 10,000 blocks; 3,000-block docx = 25 KiB | `bun /tmp/phase127/probe-work.mjs`; `bun /tmp/phase127/probe-blocking.mjs` | 52.3 ms (ticks 0) at 10k blocks; 9.8-10.3 ms at 3k blocks | 3.7 MiB p50 | ticks 0 — blocking | `cpu-offload-candidate` |
| 6 | sheet parse — xlsx (`parseWorkbook`, `packages/prism-work/src/sheets/xlsx.ts:L245`) | 2,172 KiB xlsx, 20,001 x 12 cells; 60,514 B xlsx = 1,001 rows | `bun /tmp/phase127/probe-work.mjs`; `bun /tmp/phase127/probe-blocking.mjs`; `bun /tmp/phase127/probe-smallpayload.mjs` | 217.7 / 230.8 / 302.4 ms (bench), 325.8 ms (tick run); 60.5 KiB 20.1 ms; 5.9 KiB 1.2 ms | 7.3 MiB p50 | ticks 0 — blocking | `cpu-offload-candidate` |
| 7 | sheet parse — csv (`parseCsv`, `packages/prism-work/src/sheets/csv.ts:L250`) | 1.3 MiB csv, 20,000 rows; 125,580 B csv = 2,000 rows | `bun /tmp/phase127/probe-work.mjs`; `bun /tmp/phase127/probe-blocking.mjs` | 50.2 / 52.5 / 56.9 ms (bench), 64.5 ms (tick run); 125.6 KiB 14.2 ms | 25.6 MiB p50 | ticks 0 — blocking | `cpu-offload-candidate` |
| 8 | attention compilation (`createAttentionCompiler`, `src/attention-compiler.ts:L269`) | 50 turns / 413 KiB history / 8 KiB tool results; 8-turn registered fixture | `bun scripts/benchmark.mjs --scenario attention-compiler`; `bun /tmp/phase127/probe-attention.mjs` | registered scenario has no wall-time row (token/cache metrics only); micro-probe 8 turns 0.5 ms p50, 50 turns 1.2 ms p50 | 56 KiB p50 at 50 turns | ≤ 2.2 ms blocking | `cpu-inline` |
| 9 | RAG chunk + fusion (`chunkMarkdown`, `packages/memory/src/rag/chunk.ts:L10`; `fuseReciprocalRankLists`, `packages/memory/src/rag/fusion.ts:L16`) | 1 MiB markdown, 1,405 chunks; 2 x 1,000 hits → 1,500 fused | `bun /tmp/phase127/probe-wiki-rag.mjs`; `bun /tmp/phase127/probe-blocking.mjs` | chunk 2.09 / 2.25 / 5.32 ms; fusion 0.57 / 0.61 / 1.34 ms | chunk 383 KiB p50; fusion 50 KiB p50 | ≤ 5.5 ms blocking | `cpu-inline` |
| 10 | JSONL session parse (`readJsonlSessionEntries`, `src/node/session-store-jsonl.ts:L154`) | 1,643,890 B, 5,000 entries; append onto the same file | `bun /tmp/phase127/probe-sessions.mjs` | cold parse 3.9 / 5.4 / 6.3 ms; warm cache-hit list 0.1 ms; append (O(corpus) parse + fs append) 4.2 / 4.3 / 6.5 ms | cold parse 2.4 MiB p50; cache-hit list 40 KiB p50 | short blocking stretch ≤ 6.5 ms | `cpu-inline` |
| 11 | sqlite session ops (`createSqlitePersistence`, `packages/prism-core/src/sessions/sqlite/persistence.ts:L124`) | file + WAL, 2,000 entries; `:memory:` control | `bun /tmp/phase127/probe-sessions.mjs` | file+WAL append 14,204 ops/s, per-op p50 0.1 ms max 1.3 ms; `:memory:` 33,254 ops/s; list 2,000 entries 3.0 ms p50 | list 904 KiB p50 | per-op ≤ 1.3 ms; list ≤ 3 ms | `cpu-inline` |

Raw transcript highlights (key lines, verbatim):

```
# tool-search (bun scripts/benchmark.mjs --scenario tool-search, three separate runs)
{"run":"1","index_score_ms":1.883}
{"run":"2","index_score_ms":1.469}
{"run":"3","index_score_ms":2.458}
# hard-cap scaling (bun /tmp/phase127/probe-toolsearch-split.mjs)
build index (1024 tools): p50 4.926ms min 4.433ms max 5.082ms
score query (1024 tools): p50 0.205ms min 0.176ms max 0.247ms

# redaction (bun scripts/benchmark.mjs --scenario redaction, three separate runs)
{"run":"1","speedup":7.38,"single_p95":1.071,"single_p50":0.441,"small_p95":0.154,"transcriptBytes":1049196}
{"run":"2","speedup":9.14,"single_p95":1.016,"single_p50":0.391,"small_p95":0.16,"transcriptBytes":1049196}
{"run":"3","speedup":6.82,"single_p95":1.536,"single_p50":0.405,"small_p95":0.123,"transcriptBytes":1049196}

# wiki source-scan (bun /tmp/phase127/probe-wiki-classify.mjs)
sha256-only 2000 x 4KiB: min 5.5ms p50 5.7ms max 7.2ms
scanRawFiles 2000 x 4KiB: wall 55.0ms files 2000 ticks 10 gap p50 5.0ms max 6.2ms

# documents / sheets (bun /tmp/phase127/probe-work.mjs)
document extract fixture: thousand-page.pdf 281KiB
document extract pages=1000 wall 403.3ms | tick p50 10.2ms max 10.2ms   # cold run only; warm runs below
document extract (pdf): min 249.1ms p50 264.3ms max 282.9ms | retained heap min -0.0MiB p50 0.0MiB max 0.1MiB
document parse fixture: docx 25KiB, 3000 blocks
documents parseDocument (docx): min 9.8ms p50 10.3ms max 41.8ms | retained heap min 0.0MiB p50 0.1MiB max 2.1MiB
sheet parse fixture: xlsx 2172KiB, 20001 x 12 cells
sheets parseWorkbook (xlsx): min 217.7ms p50 230.8ms max 302.4ms | retained heap min -5.3MiB p50 -1.4MiB max 9.0MiB
sheet parse fixture: csv 1304KiB, 20001 rows
sheets parseCsv: min 50.2ms p50 52.5ms max 56.9ms | retained heap min -1.3MiB p50 -1.2MiB max 23.4MiB

# loop blocking (bun /tmp/phase127/probe-blocking.mjs); calibration: sync spin -> ticks 0, await timer -> ticks 39
pdf extract (281KiB, 1000 pages): wall 258.0ms | ticks 0
documents parseDocument (docx): wall 52.3ms | ticks 0
sheets parseWorkbook (2.1MiB xlsx): wall 325.8ms | ticks 0
sheets parseCsv (1.3MiB csv): wall 64.5ms | ticks 0
rag chunkMarkdown (1MiB md): wall 5.5ms | ticks 0
rag fuseReciprocalRank (2x1000): wall 1.8ms | ticks 0

# warm PDF blocking re-check (bun /tmp/phase127/probe-pdf.mjs)
run 1: pages 1000 wall 364.0ms ticks 0 maxGap 0.0ms
run 2: pages 1000 wall 279.9ms ticks 0 maxGap 0.0ms
run 3: pages 1000 wall 315.3ms ticks 0 maxGap 0.0ms

# sessions (bun /tmp/phase127/probe-sessions.mjs)
jsonl fixture: 1643890 bytes, 5000 entries
jsonl cold parse (readJsonlSessionEntries): min 3.9ms p50 5.4ms max 6.3ms run5
jsonl warm list (cache hit): min 0.1ms p50 0.1ms max 0.2ms run5
jsonl append at 5,000-entry file (parse+append): min 4.2ms p50 4.3ms max 6.5ms run5
sqlite file+WAL append x2000: total 140.8ms | per-op p50 0.1ms max 1.3ms (14204 ops/s)
sqlite :memory: append x2000: total 60.1ms | per-op p50 0.0ms max 0.4ms (33254 ops/s)
sqlite file+WAL list 2,000 entries: p50 3.0ms
sqlite :memory: list 2,000 entries: p50 3.0ms
```

Retained-heap profiles (`Bun.gc(true)` bracketed; `bun /tmp/phase127/probe-alloc2.mjs`):

| surface | retained heap p50 | runs |
| :--- | ---: | :--- |
| wiki `scanRawFiles` (hash map) | 373 KiB | -4403 / 374 / 373 KiB |
| PDF extract | 3,164 KiB | 6077 / 103 / 3164 KiB |
| docx parse (10k blocks) | 3,730 KiB | 3730 / 3958 / 867 KiB |
| xlsx parse (2.1 MiB) | 7,279 KiB | 7819 / 7279 / 6855 KiB |
| csv parse (1.3 MiB) | 25,595 KiB | 25277 / 25595 / 27075 KiB |
| RAG chunk (1 MiB) | 383 KiB | 7 / 383 / 471 KiB |
| RAG fusion (2 x 1000) | 50 KiB | 1482 / 50 / -341 KiB |
| JSONL cold parse (5,000 entries) | 2,431 KiB | 1018 / 4016 / 2431 KiB |
| JSONL cache-hit list | 40 KiB | 70 / 40 / 40 KiB |
| sqlite list (2,000 entries) | 904 KiB | 909 / 904 / 903 KiB |
| attention compile (50 turns) | 56 KiB | 349 / 31 / 56 KiB |

## 3. Worker round-trip and break-even

Probe shape (`/tmp/phase127/probe-roundtrip.mjs` + `roundtrip-worker.mjs`): one warm
`node:worker_threads` worker, `postMessage`/`on("message")` echo with a `Uint8Array` payload, p50 of
100 round trips per size. This is the warm-pool half of the cost; the cold half is the first
spawn+reply, which a pool pays once.

```
cold worker spawn + first echo: 13.1ms / 10.6ms / 10.5ms
warm worker round-trip (structured-clone copy, p50 of 100):
         0 bytes: p50 0.016ms
      1024 bytes: p50 0.015ms
     65536 bytes: p50 0.063ms
    262144 bytes: p50 0.086ms
   1048576 bytes: p50 0.301ms
   4194304 bytes: p50 1.690ms
  16777216 bytes: p50 7.198ms
warm worker round-trip (transfer, p50 of 100):
   1048576 bytes: p50 0.071ms
   4194304 bytes: p50 0.293ms
spin 1ms / 10ms / 50ms task: p50 1.06ms / 10.13ms / 50.16ms   # scheduling overhead ≈ +0.1-0.2ms
```

Break-even per candidate: offload pays when inline compute > round-trip for the same payload
(measured, not extrapolated where a fixture exists). All four candidates clear it by orders of
magnitude at realistic sizes:

| candidate | compute at fixture | round-trip at fixture size | break-even payload | pays? |
| :--- | :--- | :--- | :--- | :--- |
| PDF extract | 262-378 ms @ 288,031 B (1.8 ms @ 872 B) | 0.086 ms @ 256 KiB | < 1 KiB: even the 872 B fixture is 1.8 ms vs 0.015 ms | yes |
| docx parse | 52.3 ms @ 60,094 B (10k blocks) | 0.063 ms @ 64 KiB | < 5 KiB: 25 KiB fixture is 10 ms vs 0.02 ms | yes |
| xlsx parse | 218-326 ms @ 2,172 KiB (20 ms @ 60.5 KiB, 1.2 ms @ 5.9 KiB) | 0.301-1.69 ms @ 1-4 MiB | ≈ 3-5 KiB (the ~1 ms fixed parse floor is the compute side of the cross) | yes above ~10 KiB |
| csv parse | 50-65 ms @ 1.3 MiB (14.2 ms @ 125.6 KiB) | 0.301 ms @ 1 MiB | < 2 KiB | yes above ~10 KiB |

So Task 1 names **four `cpu-offload-candidate` rows**: PDF extract, docx parse, xlsx parse, csv
parse. The other seven rows are `cpu-inline`/`io-bound` and must not be moved: their blocking
stretch is tens of microseconds to single-digit milliseconds and the pool boundary would add a
serialization hop to a hot path for no loop-freedom gain. Task 2's pool therefore does not close as
(a Task 3 re-measurement later reverted all but the PDF row — see §9.)
a no-op; Task 3 applies it to these four surfaces (large payloads) only.

## 4. Rejected and declined candidates

- **Declined: tool-search moved to a worker.** 1.47-2.46 ms at the 128-tool frozen fixture, 4.93 ms
  index build + 0.21 ms score at the 1,024-tool `HARD_MAX_TOOLS_INDEX` cap
  (`src/tool-search.ts:L20`). The per-turn hot path is the score, which is 0.2 ms. Round-trip would
  exceed the work. `cpu-inline`, not a candidate.
- **Declined: redaction moved to a worker.** Sub-millisecond single scan over 1 MiB; it is also a
  security boundary (secret handling) that stays in-process by policy. `cpu-inline`.
- **Declined: JSONL parse offload.** Cold parse 5.4 ms p50, append 4.3 ms p50; the O(corpus) parse
  is real CPU but is inside the 5 ms soft budget the suite already asserts, and the store's
  `appendChain` already serializes writers. `cpu-inline`.
- **Declined: sqlite offload now.** 14k-33k ops/s, per-op ≤ 1.3 ms, list 3 ms. Plan 127 Task 5
  owns the interference threshold probe; no product change here. `cpu-inline`.
- **Declined: attention compilation / RAG chunk+fusion / wiki scan.** 1.2 ms, ≤ 5.5 ms, and
  I/O-bound respectively. `cpu-inline` / `io-bound`.
- **Rejected: "parallelize everything".** The table is the filter: seven of eleven surfaces are
  declined with numbers, and no surface is moved before Task 3 re-measures the co-resident
  event-loop metric.
- **Rejected: "rewrite node: imports".** Task 1 touches no import; the inventory found no case
  where a `node:` import is the bottleneck, and Task 4 owns the measured, per-site native adoption.
- **Rejected: "pays for itself"** as an argument. Nothing is adopted on assertion; every candidate
  above carries its compute, round-trip, and break-even, and Task 3 must show both the surface's own
  latency and the loop-freedom metric before a move stays.

## 5. Plan-124 carry-over (a): fixed-compute CPU-speed denominator

The startup gate's ratio is `importMs / processStartMs` where the denominator is an empty
`bun -e ""` process start (`scripts/budget-gates.mjs:L81`), which plan 124 Task 4 recorded as a weak
load-normalizer under Bun (import inflates 3-4x with load, the empty start barely moves; the
recorded upgrade path is a fixed-compute denominator). Probe
(`/tmp/phase127/probe-startup-denominator.mjs`): per round, measure empty start, cold
`import('./dist/index.js')`, and a fixed sha256 over 64 MiB in-process; 5 rounds per load class.
The empty-start and control-burner rounds use the shipped function unchanged.

| load class (loadavg / 16) | empty start (max/min) | import (max/min) | sha256-64MiB (max/min) | import/empty ratio | import/compute ratio |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 9.22 (0.58) | 3.06-4.20 ms (1.37x) | 28.69-40.21 ms (1.40x) | 34.68-37.22 ms (1.07x) | 7.69-10.89 (1.42x) | 0.77-1.16 (1.50x) |
| 11.80 (0.74), 6 burners | 4.51-6.08 ms (1.35x) | 40.84-56.50 ms (1.38x) | 36.19-38.34 ms (1.06x) | 6.95-12.41 (1.79x) | 1.07-1.52 (1.41x) |
| 12.47 (0.78), 16 burners | 4.03-13.60 ms (3.37x) | 56.14-201.92 ms (3.60x) | 39.16-107.32 ms (2.74x) | 4.13-19.18 (4.65x) | 0.94-5.16 (5.51x) |

Verdict: **recorded, not adopted.** The fixed-compute denominator narrows the ratio spread at
moderate load (1.41x vs 1.79x) because sha256 is the stable side, but it does not beat the empty
start under CPU saturation (5.51x vs 4.65x) — both denominators are noisy there and the import
sample is the dominant term either way. The gate as shipped passes today, and plan 124 Task 4's
condition was "adopt only if the ratio flakes again". No ceiling changes here; the probe above and
the ratio numbers are the recorded upgrade path if a future flake arrives.

## 6. Plan-124 carry-over (b): can Bun 1.4.x emit branch coverage?

`scripts/branch-coverage-audit.mjs:L136` spawns `node --test --experimental-test-coverage` because
Bun 1.4.2 was recorded as emitting no branch data. Probe: a two-branch fixture under
`/tmp/phase127/branch/` (`sample.ts` with `n > 0 / n < 0 / else`, all three covered by one test):

```
$ bun test --coverage
-----------|---------|---------|-------------------
File       | % Funcs | % Lines | Uncovered Line #s
-----------|---------|---------|-------------------
All files  |  100.00 |  100.00 |
 sample.ts |  100.00 |  100.00 |
-----------|---------|---------|-------------------
$ bun test --coverage --coverage-reporter=lcov && grep -c '^BRDA:' coverage/lcov.info
0
```

The text reporter exposes `% Funcs` and `% Lines` only; the lcov report emits `DA` (line) and `FN`
(function) records and **zero `BRDA:` branch records**. Verdict: **Bun 1.4.2 cannot emit branch
coverage**, so `scripts/branch-coverage-audit.mjs` keeps its single sanctioned Node spawn and the
`branches: null` Bun gate stays. No ceiling or workflow changes here; the probe is the recorded
confirmation of the exception plan 120 Task 6 documented.

## 7. Security posture

Every fixture is synthetic: repeated filler text, number-formatted cells, generated OOXML, and
secret-shaped needles (`sk-live-…`) that the redaction scenario itself asserts never survive.
No provider keys, no session data, no credentials cross a worker boundary in this task (no worker
product code is added). The worker `round-trip` probes carry zero-length or pattern-filled buffers.
All future `Bun.hash`/native-adoption decisions remain Task 4's ledger; the four concluded
`cpu-offload-candidate` rows are all `node:`-free content parsing with no crypto or secret handling
at the parse boundary (redaction, the one security-adjacent surface, is `cpu-inline`).

## 8. Task 2 — bounded worker pool primitive (landed)

Task 1 named four paying `cpu-offload-candidate` surfaces, so this task does not close as a no-op.

Landed files:

| file | role |
| :--- | :--- |
| `packages/prism-work/src/runtime/worker-pool.ts` | the pool: fixed 2 workers, FIFO queue, `runInPool(task)`, `workerPoolStats()`, `closeWorkerPool()`, env allowlist, fail-closed crash path |
| `packages/prism-work/src/runtime/worker-pool-entry.ts` | module worker: static handler map (`probe.echo`, `probe.spin`, `probe.crash`, `probe.env`); product handlers land with Task 3 |
| `packages/prism-work/src/runtime/__tests__/worker-pool.test.ts` | round-trip, bounded concurrency, credential-free env, crash-and-recover, unknown-kind, teardown |
| `packages/prism-work/package.json` | test script gains `dist/runtime/__tests__/*.test.js` |

The plan's API sketch (`runInPool<TIn, TOut>(task, compute)`) is not implementable as written — a
function cannot cross the thread boundary, and sending source or module paths in a message is
`eval`-shaped. The landed API is a typed task object (`{ kind, payload }`) against a static handler
map in the worker entry; the payload is the same data the caller already holds at its own byte-cap
boundary. The rest of the sketch (one file, no scheduler abstraction, no priority queue) is as
planned.

Bun 1.4.2 `worker_threads` probes the pool depends on (transcript, `/tmp/phase127/poolprobe/`):

```
default Worker options:    child env KEYS 69, planted secret visible -> full env inheritance
new Worker(url, { env }):  child env KEYS 1, planted secret absent   -> allowlist honored
worker.ref()/unref():      both functions; an unref()'d live worker lets the process exit (exit 0)
uncaught throw in worker:  'error' ("planned crash") then 'exit' code 1; parent survives
worker.terminate():        resolves with exit code 1
2 MiB Uint8Array echo:     structured clone intact (2097152 bytes)
```

Pool sizing probe (8 x ~500 ms PDF extracts through N workers, parent 5 ms ticker, 16 CPUs at
load/cpu ~1.1-1.5; `/tmp/phase127/probe-pool-size.mjs`):

| workers | total wall | per-extract p50 | parent tick gap p50 | tick gap max |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 5032 ms | 542 ms | 5.1 ms | 15.1 ms |
| 2 | 1905 ms | 471 ms | 5.1 ms | 6.6 ms |
| 4 | 1122 ms | 548 ms | 5.1 ms | 9.7 ms |
| 8 | 920 ms | 852 ms | 5.1 ms | 7.3 ms |

Winner: `WORKER_POOL_MAX_WORKERS = 2`. Every size keeps the parent tick gap at its 5.1 ms target
(that is the point of the offload); 2 is the smallest size that clears the serial bottleneck, has
the best per-task latency (471 ms, 13 % under serial), and carries the smallest co-tenant CPU claim
— 4 doubles the claim for only +0.4x throughput per worker and 8 degrades per-task latency 1.8x on
this loaded host (pdf.js also spawns its own parse thread per extract, so pool N doubles the thread
count in flight). The constant lives with a `ponytail:` upgrade path in
`packages/prism-work/src/runtime/worker-pool.ts:L18`.

Failure-path and bounds checks (`bun test --timeout=0 packages/prism-work/dist/runtime/__tests__/worker-pool.test.js`):

```
(pass) runInPool round-trips a structured-cloneable payload
(pass) pool never runs more than the bounded worker count and queues the rest
(pass) workers do not inherit parent credentials
(pass) a worker crash rejects its task and the pool recovers on the next one
(pass) an unknown task kind rejects without killing the pool
(pass) closeWorkerPool rejects in-flight tasks, terminates every worker, and the pool recovers

6 pass, 0 fail  (864 ms)
```

The full package suite stays green with the pool present (workers running while the document
extract budget suite executes): `bun run --cwd packages/prism-work test` -> 252 pass, 2 skip,
0 fail, 37 files, 1.75 s.

Incidental finding handed to Task 3: the PDF parser's `detect` uses
`buffer.toString("latin1", 0, 5)`, which is Buffer-specific — a structured-cloned `Uint8Array`
payload fails detection until wrapped in `Buffer.from(...)`. The sizing probe hit this first; the
Task 3 callers must wrap (or `detect` becomes byte-based, which the existing document-reader suite
would then pin).

Security notes: workers get `env` = allowlist only (`PATH`, `TMPDIR`, `TMP`, `TEMP`, `LANG`,
`LC_ALL`); `probe.env` plus the planted-secret test assert no credential inheritance; the pool logs
no payload contents and `workerPoolStats()` reports counts only; messages are typed task objects,
never source or module paths; sandbox policies are untouched (in-process threads, no OS sandbox
escape); failures reject their caller and drop the slot, so the pool fails closed rather than
hanging. No public export changed: `runtime/` is not in `packages/prism-work/package.json` exports.

## 9. Task 3 — apply the pool to the measured winners (PDF kept, three rows reverted)

Task 3 moved all four Task-1 payer rows, then applied the task's own guard — "no moved surface
regresses its own wall clock beyond variance while gaining the loop-freedom metric; otherwise it is
reverted and the revert recorded". The A/B (same process, alternating, p50 of 3-5, 5 ms ticker,
load/cpu ~1.2-1.4) put the result-clone cost on the table:

| surface (fixture) | inline wall p50 | pool wall p50 | ticks inline / pool | output identical | verdict |
| :--- | ---: | ---: | :--- | :--- | :--- |
| PDF extract, reader (288,031 B, 1000 pages) | 632 ms | 678 ms | 0 / 109-181 | yes (28,895 B text) | **kept** (1.07x, within variance) |
| docx `parseDocument` (68,042 B, 10k blocks) | 76 ms | 108 ms | 0 / 13-26 | yes (2,628,949 B model) | reverted (1.42x) |
| xlsx `parseWorkbook` (2,826,871 B, 20k x 12) | 654 ms | 859 ms | 0 / 136-258 | yes (2,322,514 B model) | reverted (1.31x) |
| csv `parseCsv` (1,335,580 B, 20k rows) | 57 ms | 149 ms | 0 / 21-25 | yes (1,996,006 B model) | reverted (2.61x) |

Final-state re-run for the kept row (load/cpu 0.42, 5 pairs, `bun /tmp/phase127/probe-pdf-final.mjs`):

```
pool   0: 455ms ticks=89 gap p50=5.1ms max=5.1ms      inline 0: 352ms ticks=1
pool   1: 273ms ticks=52 gap p50=5.1ms max=11.7ms     inline 1: 304ms ticks=0
pool   2: 310ms ticks=58 gap p50=5.1ms max=12.9ms     inline 2: 299ms ticks=0
pool   3: 365ms ticks=70 gap p50=5.1ms max=10.2ms     inline 3: 350ms ticks=0
pool   4: 369ms ticks=69 gap p50=5.1ms max=12.8ms     inline 4: 377ms ticks=0
pool p50 365ms | inline p50 350ms | pool/inline 1.04x | output identical: true (26893 bytes)
```

**Why three rows lost.** Task 1's break-even used the *input* round-trip only. The moved parses
return a typed model, and the structured-clone of the result is the missing term: the model JSON is
larger than the input (2.0-2.6 MB vs 68 KB-2.8 MB) and cloning it costs more than the parse itself
for csv (57 ms compute vs 92 ms clone+hop overhead). The PDF row survives because its result is
literal text (28,895 B), its compute is the longest (250-600 ms), and the input clone is 0.086 ms at
288 KiB — so the pool keeps 1.04x wall clock with 0 -> ~60 co-resident ticks. The revert was applied
with `git checkout` on `sheets/csv.ts`, `sheets/xlsx.ts`, `documents/parse.ts`; those surfaces stay
inline and their measured output is unchanged.

**What landed for the kept row.** `document-reader/index.ts` offloads `parser.extract` for buffers
>= 64 KiB when the default parsers are in use (`shouldOffloadToPool`, `WORKER_POOL_OFFLOAD_MIN_BYTES`
in `runtime/worker-pool.ts:L37`); host-supplied parsers are functions and stay in-process. The default
parser factories moved to the non-public `document-reader/parsers.ts`, which the worker entry uses
to build the same pdf/docx/xlsx/pptx parsers on the pool thread (documents stack imported lazily
inside the OOXML parser). Redaction, caps, telemetry and the result shape stay in the parent;
`signal` is checked before dispatch and after the result, matching the parsers' existing
start-only abort checks. Remote `DocumentReaderError`s are revived by class name in the parent
(`reviveWorkerTaskError`) so `instanceof` behavior is unchanged. Pool `closeWorkerPool()` is
idempotent and non-terminal: after teardown the next task lazily spawns a fresh worker.

**One real bug found by the suite.** With every handler module statically imported by the worker
entry, the doc-reader envelope test blew its 2000 ms hang bound under `--parallel=4`
(7525 ms then 5260 ms, vs 503 ms inline before Task 3): each of the four concurrent test processes
loaded the whole sheets+documents+reader stack in its pool worker. Lazy per-handler imports
(and the lazy documents import in `parsers.ts`) brought the first worker spawn to 264 ms standalone
(`probe-spawn-cost.mjs`) and the in-suite envelope to 955-1283 ms. After the revert the full
prism-work suite is 253 pass / 2 skip / 0 fail in 3.9 s.

**Ceiling disposition.** `scripts/budgets.json` `docReader.extractMsCeiling` stays 2000 ms: the
post-move worst observed under `--parallel=4` is 1283 ms and the standalone/offload-equality runs
sit at 365-955 ms, so the bound still holds; the `$comment` now records the Task 3 provenance and
the reason it was kept. The other surface ceilings (tool-search 50 ms, redaction, memory 5 ms) were
never touched by this task. The offloaded path is pinned by
`runtime/__tests__/offload.test.ts` (pool text === inline parser text) plus the existing
`document-reader` envelope test, which now exercises the pool path for its 288 KB fixture.

## 10. Task 4 — native Bun API ledger (measured no-op)

Candidates were evaluated only on rows Task 1 marked hot, and only where the digest backs no
security decision. Three families were probed on Bun 1.4.2; **none was adopted**, so this section is
the ledger plus the number that declined each candidate. Probes:
`/tmp/phase127/probe-native-bun.mjs` (hash micro, jsonl read, scan variants) and
`/tmp/phase127/probe-native-bun2.mjs` (7 alternating rounds isolating reader x hasher on one tree).

### 10.1 Hash family — 2000 x 4 KiB (7.8 MiB), min/p50/max of 5 gc-bracketed runs, load 6.77/16 CPUs

| Candidate | Wall | Verdict |
| --- | --- | --- |
| `createHash("sha256")` per buffer (current) | 5.07 / 5.27 / 6.21 ms | baseline |
| `new Bun.CryptoHasher("sha256")` per buffer | 5.65 / 5.94 / 6.44 ms | declined: 113% of baseline, slower |
| `Bun.CryptoHasher` over the wiki scan (7 alternating rounds) | p50 45.78 vs 47.59 ms (96.2%), min 39.79 vs 40.77 | declined: win is inside the run-to-run spread (max 69.07 vs 62.44), so no site is adopted for style |
| `Bun.hash` per buffer | 0.37 / 0.43 / 0.60 ms (12.3x faster) | declined at every site; the one real win is priced in §10.2 |

API facts measured, not assumed: `Bun.CryptoHasher("sha256")` is byte-identical to
`createHash("sha256")` (asserted in-probe: `a2e659dacb4691e8…`), `Bun.hash` returns a 64-bit
number (`17118638217978884846` for the 4 KiB buffer), and `reset()` **does not exist** in Bun 1.4.2
(`TypeError: reused.reset is not a function`), so a reused hasher is not available either.

### 10.2 Wiki source-scan row (hot, io-bound) — the only `Bun.hash` win, declined

Same 2000-file / 20-dir tree, 7 alternating rounds: `readFile`+`createHash`
40.77 / 47.59 / 62.44 ms vs `readFile`+`Bun.hash` 34.83 / 36.70 / 43.40 ms = **77.1% of current**
(~11 ms off a 47.6 ms scan). Declined because the digest is persisted identity, not an ephemeral
key: `hashContent` (`packages/memory/src/wiki/manifest.ts:22`) feeds
`WikiManifest.sourceFileHashes` (compared against the previous manifest), `entity.sourceHash`
(`wiki/engine/compiler.ts:172`), and ingest ids
`${base}-${hashContent(bytes).slice(0, 8)}` (`packages/memory/src/wiki/ingest.ts:218` — a number has
no `.slice`). Switching the algorithm rewrites a durable `.wiki/` manifest and forces one full
re-index per host, for 23% of a scan Task 1 already measured as async-walk-dominated
(`ticks 10, gap p50 5.0 ms`, hashing ~11% of wall). Cost exceeds benefit; `Bun.file` and `Bun.Glob`
on the same row measured no win either (§10.3).

### 10.3 File I/O and glob family

| Candidate | Wall (min/p50/max) | Verdict |
| --- | --- | --- |
| `readFile` + `createHash` (current scan) | 40.77 / 47.59 / 62.44 ms | baseline |
| `Bun.file().arrayBuffer()` + `createHash` | 45.34 / 49.26 / 54.02 ms (103.5%) | declined: no win, extra Buffer copy |
| `readdir` walk + `Bun.file` + `CryptoHasher` | 67.69 / 71.31 / 75.07 ms | declined |
| `Bun.Glob` + `Bun.file` + `CryptoHasher` | 61.36 / 63.55 / 68.48 ms vs readdir walk 61.34 / 65.23 / 69.34 ms | declined: equal inside the spread, and would require re-deriving `DEFAULT_IGNORE_PATTERNS` (name-based today) as glob ignores — semantic risk for zero measured win |
| jsonl 1.64 MB: `readFile(utf8)` vs `Bun.file().text()` | 0.97 / 1.10 / 1.79 vs 0.95 / 1.24 / 1.34 ms (identical strings) | declined: equal, JSONL append has no `Bun.write` equivalent |

Every variant returned the identical `Map` as the current scan (key set and digest values asserted
in-probe), so the declines are cost decisions, not correctness retirement.

### 10.4 Security census — grep-verified, unchanged

`grep -rn "createHash(" --include="*.ts" src packages` (excluding `dist/`, `__tests__`) lists 60+
sites; the digests that back a decision or a secret comparison stay `node:crypto` and are pinned by
the ledger test:

| File | Why it must stay `node:crypto` |
| --- | --- |
| `src/agent-approval.ts:293` | approval-subject id (`sub_…`) |
| `src/agent-run-state.ts:208` | run-state hash |
| `src/artifacts.ts:273` | citation/evidence binding digest |
| `src/attention-compiler.ts:728` | model-visible stub digest of already-redacted text, persisted in the sticky frontier |
| `src/run-bundle.ts:215,219` | run-bundle integrity digests |
| `packages/prism-channels/src/approvals.ts:84`, `pairing.ts:79` | approval and pairing token hashes |
| `packages/prism-channels/src/telegram.ts:240-241` | webhook secret comparison |
| `packages/prism-coding-tools/src/security/approval.ts:35` | approval cache key |
| `packages/prism-coding-tools/src/security/docker-cli.ts:221`, `egress/policy.ts:88`, `sandbox-tar.ts:173` | sandbox/egress/container digests |
| `packages/prism-providers/src/bedrock/sigv4.ts:21`, `openai/oauth.ts:38` | request signing and PKCE verifier |
| `packages/prism-core/src/credentials/node/oauth2.ts:19` | PKCE verifier |
| `packages/prism-core/src/governance/policy/audit-export.ts:188,192`, `governance/prompts/util.ts:135` | audit-export and prompt-registry integrity |
| `packages/prism-*` others | outside the census by the decision rule below |

`src/redaction.ts` contains no digest at all (`grep` empty), so the redaction row is untouched by
construction. Measured anyway at its payload sizes: approval subject (18 B) `createHash`
0.48 ms vs `CryptoHasher` 0.48 ms per 1000 calls; run-state/attention-shaped 2011 B payload
2.00 vs 1.70 ms per 1000 (~0.3 µs per call) — inside probe noise, so the security rule is not even
carrying a real win. Non-security digests off Task 1's hot rows are out of scope and stay as they
are: `src/observability.ts:17` (telemetry `idsHash`), `src/tool-effects.ts:50,66` (idempotency id),
`packages/prism-channels/src/runtime-admit.ts:322,375` (channel operation id),
`packages/web-tools/src/normalize.ts:51` (citation content hash).

### 10.5 Hash-adoption ledger

Every `Bun.hash` adoption with its "why this is not a security path" line: **none**. The candidate
list above is the whole ledger, and each row carries the number that declined it. A future adoption
must add its path to `ADOPTED_SITES` in the ledger test and its measured win here first.

### 10.6 Typing, voice, and the runnable half

`@types/bun@1.4.2` is installed (`packages/prism-core` devDependency, plan 126 Task 3), but
`types: ["bun"]` still fails `tsc` (plan 126 §11: Bun's `fetch` requires `preconnect`,
`SQLQueryBindings` rejects `undefined` binds), so the repo's pattern for a native Bun API is a narrow
ambient declaration next to the call site (`packages/prism-core/src/bun-sqlite.d.ts`). No `Bun.*` call
was adopted, so no type surface was added, `tsc` emit is unchanged, and no published `.d.ts` gained a
`Bun`-global reference. Product source carries zero `Bun.` globals
(`grep -rn "Bun\." src packages/*/src` excluding `dist/` and `__tests__` → 0), so the single-voice
rule (a module uses either `node:` or `Bun.` for one concern, never both) holds trivially.

The ledger's runnable assertion is `scripts/tooling-gate.test.mjs` →
`it("Bun-native hashing ledger: no Bun.hash on a security path")`: it scans `src` + `packages/*/src`
for `Bun.hash(`/`Bun.CryptoHasher(`, requires every hit to be in its `ADOPTED_SITES` mirror (empty
today), and requires each of the 17 security files above to keep `from "node:crypto"` with zero
native-hash calls — plus positive/negative controls. It passes 11/0 together with the rest of the
tooling gate.

## 11. Task 5 — SQLite/event-loop offload probe (recorded no-op)

Probe: `/tmp/phase127/probe-sqlite-interference.mjs`, Bun 1.4.2, load 6.85-6.95/16 CPUs. Setup uses
the real session store (`createSqlitePersistence({ filename })` over `bun:sqlite`, file + WAL) with
realistic message entries (~300 B rows), a provider stream modelled as an async loop ticking every
5 ms (200 chunks/s) for 1.5 s, plus a 5 ms `setInterval` gap recorder; each row is worst-of-3 runs.
A "late tick" is a tick gap > 2x cadence, i.e. a visibly dropped provider-stream tick.

### 11.1 Append path — a single append never blocks a tick

| Scenario | Achieved | Chunk gap p95 / max | Tick gap p95 / max | Ticks > 2x |
| --- | --- | --- | --- | --- |
| stream only (baseline) | - | 5.13 / 5.94 ms | 5.12 / 5.95 ms | 0 |
| + appends, one yield per write | 794/s | 5.08 / 5.44 ms | 5.07 / 5.45 ms | 0 |
| + appends, yield per 10 | 5,609/s | 5.39 / 6.37 ms | 5.39 / 5.93 ms | 0 |
| + appends, yield per 100 | 15,153/s | 7.89 / 9.23 ms | 7.89 / 9.23 ms | 0 |
| + appends, yield per 1000 (sync ceiling) | 18,172/s | 61.63 / 73.75 ms | 62.26 / 73.75 ms | 300 of 300 |

Single append: 0.05 / 0.07 / 0.14 ms (min/p50/p95). Writes therefore never stall a 5 ms tick;
interference begins only when the aggregate sync duty owns the loop — ~15k appends/s already costs
p95 7.9 ms, and at the measured sync ceiling (~18k appends/s, burst of 1000 = ~60 ms of unyielding
work) **every** tick is late by 12x. A busy agent does tens of session writes per second, i.e.
~750-1000x below that threshold.

### 11.2 Read path — interference begins at ~3.5k rows in one `list()`

| `list(N message rows)` per-op cost | min / p50 / max |
| --- | --- |
| 200 | 0.28 / 0.32 / 0.43 ms |
| 1,000 | 1.30 / 1.36 / 1.72 ms |
| 2,000 | 2.78 / 3.24 / 3.49 ms |
| 3,000 | 4.12 / 4.23 / 4.66 ms |
| 4,000 | 5.49 / 6.69 / 7.61 ms |
| 5,000 | 6.63 / 6.80 / 7.41 ms |
| 20,000 | 34.58 / 37.74 / 38.78 ms |

~1.4 µs per realistic message row, so **one sync `list()` reaches the 5 ms tick interval at about
3,000-4,000 rows**. Measured interference: `list(3000)` at 20/s → tick p95 9.47 ms, 9 late ticks;
`list(5000)` at 20/s → p95 12.39 ms, 26 late; `list(20000)` at 20/s → p95 44.56 ms, 110 late;
`list(20000)` at 5/s → p95 5.74 ms but one 46.35 ms stall per call, 11 late. Below that
(`list(200)`, `list(1000)` per turn) the stream keeps every tick: p95 5.12-5.56 ms, max 9.27 ms, 0
ticks past 2x.

### 11.3 Realistic agent workload — no measurable interference

`20 sessions x 40 turns, append + list per turn, 2 turns/s` = 1,600 ops in 20.0 s (80 ops/s):
tick gap p95 5.09 ms, max 15.24 ms, **1** late tick out of ~4,000 (~0.025%). That is the acceptance
verdict: at agent QPS the synchronous driver does not measurably block concurrent provider-stream
ticks, so the pool is **not** applied to persistence — recorded no-op, no product change.

### 11.4 Threshold a future high-volume host inherits

Interference begins when either axis crosses the stream cadence:

- **Per-op reads:** any single `list()` of ~3,500+ message rows (≈5 ms of sync work) delays one tick;
  sustained page reads of that size at ≥20/s cost 9-110 late ticks per 300.
- **Aggregate writes:** ~15k appends/s starts shaving ticks (p95 7.9 ms) and the ~18k/s sync ceiling
  makes every tick late. Below ~5k appends/s plus per-turn lists of ≤2,000 rows the stream is clean.
- **Host rule (not a Prism change):** an *unpaced* loop over the sync driver starves the runtime
  completely — `await` on a sync-backed promise resolves in a microtask, so 5,000 unpaced appends
  (277.68 ms, 18,006/s) produced **0** ticks where ~56 were expected. The async wrapper does not make
  `bun:sqlite` non-blocking; a host loop must yield to the event loop, and the store's own ops stay
  as they are.

Two probe-building lessons are recorded because they shaped these numbers: yielding after *every*
write caps throughput at ~800 writes/s (Bun's timer resolution is ~1 ms), so high rates are measured
as bursts with one yield per burst; and an unpaced writer loop silently freezes the whole process
(timers dead), which is the starvation control above, not a sqlite hang.

**Verdict.** Recorded no-op per the task's expectation: probe artifact only, `docs/_evidence/` is the
only deliverable, persistence keeps its synchronous `bun:sqlite` path, and the numbers above are the
threshold should a future host exceed agent workloads.

## 12. Further action #1 — price the result clone (landed 2026-09-26)

Task 1's break-even table priced only the **input** round-trip, which is why Task 3 had to revert the
model-returning offloads (§9). This section prices the other direction and turns the lesson into a rule
the pool enforces at the call site.

Probe: `/tmp/phase127/probe-clone-pricing.mjs`, Bun 1.4.2, load 12.69/16 CPUs. Each payload is echoed
through the warm pool (`probe.echo`); the echo clones twice (send + return), so **one-way ≈ p50 / 2**,
p50 of 5 gc-bracketed runs.

### 12.1 Input side — bytes are cheap, text is nearly free

| Payload | One-way clone |
| --- | --- |
| `Uint8Array` 1 KiB | 0.083 ms |
| `Uint8Array` 64 KiB | 0.133 ms |
| `Uint8Array` 1 MiB | 0.710 ms |
| `Uint8Array` 4 MiB | 2.238 ms |
| `Uint8Array` 16 MiB | 13.074 ms |
| text 27 KiB | 0.061 ms |
| text 2.0 MB | 0.057 ms |

Flat buffers clone at 1.3-1.9 MB/ms. Strings do not copy at all (a 2 MB string costs what a 27 KiB
string costs), so text-shaped inputs and results are ~free and never decide a hop.

### 12.2 Result side — object graphs are the missing term

| Real parse result | Values | One-way clone | Per value |
| --- | --- | --- | --- |
| csv model (20,001 rows x 13 cols) | 260,093 | 108.102 ms | 0.42 µs |
| xlsx model (20,001 rows x 12 cols) | 260,092 | 114.629 ms | 0.44 µs |
| docx model (10,000 paragraph blocks) | 40,005 | 12.173 ms | 0.30 µs |
| pdf extract text (1,000 pages) | 1 | 0.082 ms | - |

"Values" counts every value the clone rebuilds — containers **plus leaf strings and numbers**. Counting
containers only (20,030 for the csv model) understated the price by 12x, which is the same mistake as
reading size in bytes: the csv model is ~2 MB of JSON but 260k values, and it costs 108 ms to clone
versus 0.6 ms for the same byte count as a flat buffer. Cross-check against §9: the measured csv
offload overhead was +92 ms (predicted ~105 ms for that fixture's 1.34 MB input), docx +32 ms
(predicted 12 ms of clone plus worker-side cost), xlsx +205 ms (predicted 115 ms of clone plus the
parent's recompute loops).

### 12.3 The rule now in `worker-pool.ts`

`shouldOffloadToPool({ inputBytes, resultValues, computeMs })` requires the input floor
(`WORKER_POOL_OFFLOAD_MIN_BYTES`, 64 KiB) **and** `computeMs >= 10 x (inputBytes / 1.25 MB per ms +
resultValues / 2,000 per ms + 0.1 ms scheduling)`. The constants are the conservative end of the
measurements above (1.25 MB/ms vs 1.3-1.9 measured; 2,000 values/ms vs 2,273-3,333 measured) and the
margin is 10x because the kept pdf row measures ~1,500x while the reverted three measured 1-6x.

Verdicts on the measured rows — the same decision Task 3 reached by measuring, now reached by the
rule, and asserted in `packages/prism-work/src/runtime/__tests__/worker-pool.test.ts`:

| Case | Input | Values | Compute | Verdict |
| --- | --- | --- | --- | --- |
| pdf extract (kept) | 288,031 B | 4,001 | 350 ms | offload |
| csv model (reverted) | 1.34 MB | 260,013 | 57 ms | inline |
| xlsx model (reverted) | 2.10 MB | 260,013 | 654 ms | inline |
| docx model (reverted) | 64 KiB | 40,005 | 76 ms | inline |
| tiny pdf (input floor) | 872 B | 5 | 1.8 ms | inline |
| 1 MiB input, one-value result | 1 MiB | 1 | 320 ms | offload |

Landed: the pricing function and constants in `packages/prism-work/src/runtime/worker-pool.ts`
(replacing the input-bytes-only predicate), the document-reader call site
(`packages/prism-work/src/document-reader/index.ts`: `resultValues: 1 + maxPages * 4` for the text plus
page spans, `computeMs: bytes / 1024` from the measured ~1 ms per KiB), and the pricing test above.
No new exports and no budget change: the gate constant and predicate names are unchanged, so
`exportCounts`, the package map, and every public surface stay as they were.

## 13. Further action #2 — byte-based format detection (landed 2026-09-26)

The PDF gate compared a decoded string — `buffer.toString("latin1", 0, 5) === "%PDF-"` — which is
`Buffer`-only: on a plain `Uint8Array` it stringifies to `"37,80,68,70,45"`, detection answered false,
and `extract` returned `null` for a buffer that *is* a PDF. Task 2 worked around it with
`Buffer.from(bytes)` in the worker entry, which is exactly the shape a structured clone delivers. The
same latent bug sat in the two zip gates: `Uint8Array.prototype.includes("word/document.xml")` coerces
the string argument to `NaN` and never matches, while `Buffer.prototype.includes` searches bytes.

Landed (all non-public changes, no new exports, no budget movement):

| File | Change |
| --- | --- |
| `packages/prism-work/src/document-reader/parsers.ts` | `PDF_MAGIC` is now the five magic bytes and the gate compares `bytes[index] === byte`; a zero-copy `byteView()` wraps any byte input in a `Buffer` view for the checks that need a string view (`includes("word/document.xml")`, the OOXML part name) and for mammoth's `buffer` argument; the OOXML path passes `Uint8Array` straight to `parseDocument` (it already took `Uint8Array`) |
| `packages/prism-work/src/document-reader/index.ts` | `DocumentParser.detect/extract` and `DocumentReader.extract` accept `Uint8Array` (`Buffer` is a subclass, so existing callers are source-compatible); `detect`'s doc comment names the rule for host parsers |
| `packages/prism-work/src/document-reader/mistral-ocr.ts` | the OCR parser's kind/media-type gates (`latin1`, `ascii`) and its base64 data URLs go through the same zero-copy view, so a `Uint8Array` input no longer silently fails detection or mis-types an image |
| `packages/prism-work/src/runtime/worker-pool-entry.ts` | `parser.extract(Buffer.from(bytes), …)` became `parser.extract(bytes, …)` — the wrap (and its 281 KiB copy per extract) is gone |

Tests: `document-reader/__tests__/index.test.ts` extracts `sample.pdf`, `sample.docx` and
`thousand-page.pdf` twice — once as a `Buffer`, once as `new Uint8Array(buffer)` — and asserts the
`Uint8Array` path still detects the format, reports the page count (2 / 1 / 1000) and returns
byte-identical text; the 281 KiB case runs through the worker pool, so it is the end-to-end proof that
the entry no longer needs the wrap. `office-parsers.test.ts` now feeds its generated `.xlsx` as a plain
`Uint8Array` (the deck stays a `Buffer`, covering both shapes). Verification: the new test failed on
first run for a stale expectation of mine (`sample.pdf` is two pages, not one), which is also the
evidence that detection itself now works for the `Uint8Array` shape — with the old gate it would have
returned `null` instead of a page count.

Suites: `prism-work` 255 pass / 2 skip / 0 fail (257 tests, 38 files); plan-review-gate + tooling-gate +
budget-gate + dead-export-verify + phase54-package-map + docs 211 pass / 0 fail; packed-consumer
install-smoke + packaging 88 pass / 0 fail (19.3 s) with the widened public signature.

## 14. Further action #3 — re-check Bun branch coverage (re-checked 2026-09-26, exception stays)

Re-ran the §6 fixture on the installed runtime (`bun --version` = 1.4.2, load 24.26/16 CPUs). Same
result: text reporter has `% Funcs` / `% Lines` only, and lcov is `TN/SF/FN/DA/LF/LH` with **zero
`BRDA:` and zero `BRF:`/`BRH:`**. The Node spawn stays. Nothing to delete.

The standing "re-check on each upgrade" note is now a gate, not a memory item.
`probeBunBranchRecords()` (`scripts/branch-coverage-audit.mjs`) writes a one-function if/else fixture
to a temp dir, runs `bun test --coverage --coverage-reporter=lcov`, and returns whether `^BRDA:` is
present. `auditBranchCoverage()` calls it first and exits 1 with the delete instruction the day it
returns true — that is the day to remove the Node spawn and the
`NODE_SPAWN_EXCEPTIONS` entry for this file. A failed or missing lcov report fails closed (does not
count as "still no branches").

`scripts/branch-coverage.test.mjs` asserts the detector both ways and runs the live probe (89 ms on
this host): `this Bun still emits no BRDA, so the Node instrument stays`. That assertion is the
thing to remove in the same change that deletes the spawn. The Node `--test` argument line moved
`scripts/branch-coverage-audit.mjs:L89` → `scripts/branch-coverage-audit.mjs:L136` when the probe
landed; the plan-review token moved with it.
