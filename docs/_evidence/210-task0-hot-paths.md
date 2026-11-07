# Plan 210 Task 0.1 — hot-path baselines (before any fix), plus the Task 0.2, 0.3 and 0.4 after-fix results

Measured 2026-11-07 on tree `a4e09001` (plus the uncommitted Task 0.1 measurement scripts), Bun 1.4.4, Linux 7.3.0 x64, AMD Ryzen 9 PRO 7940HS, 64 GB. Network-free and credential-free. These numbers are the "before" side for plan 210 Tasks 0.2 (markdown store) and 0.3 (session snapshot), plus the new Task 0.4 (SQLite branch read).

Raw files are in [`210-task0/`](210-task0/):

| File | What |
| --- | --- |
| `session-turn-overhead.before.json` | the scenario report, both stores |
| `markdown-scale.before.jsonl` | `markdown-scale.mjs --notes 1000,10000,50000` |
| `profiles/kernel-memory.cpuprofile`, `.summary.json` | scenario, memory store, 1,000 runs |
| `profiles/kernel-sqlite.cpuprofile`, `.summary.json` | scenario, SQLite store, 150 runs |
| `profiles/markdown-10k.cpuprofile`, `.summary.json` | `markdown-scale.mjs --notes 10000` |

Summaries come from `bun scripts/cpu-profile-summary.mjs <file> --top 20 --json`. Percentages are shares of sampled non-idle time, and inclusive time counts a frame once per sample. The two kernel profiles ran concurrently on separate cores. That affects their wall times, not their shares.

## Commands

```sh
timeout 300 bun scripts/benchmark.mjs --scenario session-turn-overhead --out docs/_evidence/210-task0/session-turn-overhead.before.json
PRISM_BENCH_VARIANTS=memory bun --cpu-prof --cpu-prof-dir=<dir> scripts/benchmark-scenarios/session-turn-overhead.mjs
PRISM_BENCH_VARIANTS=sqlite bun --cpu-prof --cpu-prof-dir=<dir> scripts/benchmark-scenarios/session-turn-overhead.mjs
timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
bun --cpu-prof --cpu-prof-dir=<dir> scripts/memory-bench/markdown-scale.mjs --notes 10000
```

## Session turn overhead

Each run is 2 provider turns plus 1 tool call, with a 2,048-byte tool result and a 2,048-byte reply. The agent lifts `maxInputTokens` and `maxTotalTokens`, because the whole branch is the prompt and the token caps stop a run at about 17 runs. The byte caps stay at their defaults.

| Store | Runs | Total | p50 | p95 | First-20 p50 | Last-20 p50 | `growthRatio` | `storeEntriesReadPerRun` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| memory | 1,000 | 86.7 s | 84.9 ms | 165.1 ms | 2.52 ms | 163.1 ms | **64.8** | **6,118** |
| SQLite | 150 | 25.9 s | 102.6 ms | 504.2 ms | 3.73 ms | 484.1 ms | **129.7** | **1,018** |

All reads go through `readBranchPath`. `list` and `get` are 0 for both stores. Every run completed with exactly 2 provider turns.

**Against the 2026-11-03 rows:**

- **Kernel growth: reproduced in direction, but much steeper.** The first window matches (2.52 ms against 2.84 ms). The last window is 163 ms, not 11.19 ms, because this fixture's 2 KB payloads make each re-read and clone proportionally heavier. The 2026-11-03 payload size was not recorded. The plan's "memory store ~4" `growthRatio` reference is therefore ~65 on this fixture.
- **Over budget.** The 1,000-run memory variant takes 87 s, over the 60 s acceptance budget. That cost is the O(history) defect Task 0.3 removes. The gate runs 300 runs (memory) and 60 runs (SQLite), about 8 s in total.

### Kernel CPU profile: memory store, 1,000 runs

The profile sampled 87.8 s.

| Self | Share | Against 2026-11-03 |
| --- | ---: | --- |
| `structuredClone` | 57.1% | 61.6%: **reproduced** |
| `estimateTextTokensForFamily` (usage-estimation.ts:70) | 16.0% | 9.3%: **reproduced, larger** |
| `stringify` | 13.0% | not listed (see below) |
| `indexEntries` (session-stores.ts:559) | 7.1% | 8.0%: **reproduced** |
| `orderBranch` (session-stores.ts:102) | 1.6% | |
| `estimateMessageTokens` (estimate.ts:48) | 1.2% | |

| Inclusive | Share |
| --- | ---: |
| `readBranchFromReader` (session-stores.ts:86) | 66.0% |
| `rebuildSessionContextFromReader` (session-stores.ts:149) | 63.8% |
| `snapshot` (session.ts:1213) | 63.0% |
| memory store `readBranchPath` (session-stores.ts:298) | 62.9% |
| `structuredClone` | 57.1% |
| `buildTurnRequest` (assemble.ts:408) | 41.9% |
| `generateProviderTurn` (provider-round.ts:272) | 31.4% |
| `assembleRoundContext` (assemble.ts:294) → `rebuildHistory` (session.ts:1194) | 21.1% |

The `structuredClone` chain is the one Task 0.3 premises: `readBranchPath` → `rebuildSessionContextFromReader` → `snapshot`, reached from `buildTurnRequest` and `rebuildHistory`. **The Task 0.3 premise holds.**

`estimateTextTokensForFamily` sits under `estimateTurnUsage` (the scripted provider reports no usage), which is the memo Task 0.3 adds.

`stringify` (13%) is almost entirely `jsonBytes` (helpers.ts:147) under `generateProviderTurn`: 9.9 s of its 11.4 s. That is the `maxRequestBytes` measurement of the whole request. It is O(request) per turn, as the provider's own serialization is, and the byte cap stays. It is recorded as a residual, not a fix target.

### Kernel CPU profile: SQLite store, 150 runs

The profile sampled 24.5 s. `Statement.all` takes 94.6% self, all of it inside `readEntryBranch` (packages/stores/sqlite/src/persistence.ts:536), reached through the same `snapshot` chain.

**New finding: the SQLite branch read is O(depth × session size).** `EXPLAIN QUERY PLAN` for the recursive CTE in `readEntryBranch` shows this shape:

```
RECURSIVE STEP
  SEARCH current USING INDEX prism_session_entries_session_id_idx (session_id=?)
  SEARCH parent USING COVERING INDEX prism_session_entries_session_id_idx (session_id=? AND id=?)
  SCAN bp
SCAN e USING INDEX sqlite_autoindex_prism_session_entries_1
SEARCH bp USING AUTOMATIC COVERING INDEX (id=?)
USE TEMP B-TREE FOR ORDER BY
```

The planner drives `current` from the `session_id` index (every entry of the session) and probes `bp`, instead of looking `current` up by its primary key. So each ancestor step costs the session's size, and the final `SCAN e` walks the whole table.

The per-run time grows quadratically: 17 ms at run 25, 58 ms at run 50, 146 ms at run 75, 315 ms at run 100 and 368 ms at run 125. That makes the whole scenario cubic, and the 1,000-run SQLite variant does not finish in any useful time. The scenario caps the SQLite variant (`budgets.json#sessionTurnOverhead.fixture.sqliteRuns` 150, gate 60) until this is fixed.

The defect is in the store, not the kernel. Task 0.3's cache extension would mostly hide it on a live session, but every cold rebuild (resume, checkout, TTL expiry on a store without `get`, a new process) would still pay it. It became **plan 210 Task 0.4**. The Postgres store's branch query has to be checked for the same plan shape.

## Markdown store scale

| Notes | Cold open | Warm open | Edited open | Write p50 | Write p95 | `derivedBytesRewrittenPerUpsert` | Recall p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 304 ms | 34 ms | 40 ms | 3.11 ms | 5.20 ms | 1,139,281 (1.1 MB) | 0.24 ms |
| 10,000 | 3,332 ms | 281 ms | 322 ms | 26.1 ms | 35.2 ms | 11,442,354 (11.4 MB) | 0.76 ms |
| 50,000 | 16,761 ms | 1,370 ms | 1,559 ms | 179.9 ms | 247.4 ms | 57,089,202 (57.1 MB) | 8.70 ms |

The 200-note smoke run rewrites 227 KB per upsert. Write amplification is linear in the note count, at about 1.14 KB per stored note per single-note write. At 50k notes, every write rewrites 57 MB of derived files. **The Task 0.2 premise holds.**

How the metric is counted: before and after each of the 100 timed upserts, the script stats `.index-files.json`, `log.md`, `index.md` and `.index-files.journal.jsonl` (Task 0.2's sidecar, absent today). A replaced file (new inode, or shrunk) counts its whole size. An appended file counts only its growth.

### Markdown CPU profile: 10,000 notes, whole script

The profile sampled 7.6 s and includes seeding and the cold index build.

| Frame | Inclusive | Against 2026-11-03 |
| --- | ---: | --- |
| `writeFileMap` (state.ts:76) | 12.8% | 11.7%: **reproduced** |
| `appendLog` (index.ts:354) | 13.3% | 12.7%: **reproduced** |
| of which `parseLogFile` (okf.ts:379) | 7.7% (5.0% self) | 4.2%: **reproduced, larger** |
| `regenerateIndex` (index.ts:342) | 7.9% | 7.4%: **reproduced** |
| of which `renderIndexFile` (okf.ts:325) | 7.1% | |
| `findFileById` (index.ts:300) | 1.2% self | 1.9%: **reproduced** |
| `upsert` (index.ts:273) | 29.8% | |
| `stringify` (self) | 15.0% | mostly `writeFileMap`'s pretty JSON |

The line numbers have moved since the plan text was written. Task 0.2's `index.ts:271/313/325` are now `:300/:342/:354`, and `writeFileMap` is at `state.ts:76`.

## Task 0.2 — markdown store after the fix

Measured 2026-11-07, same machine and session as the baseline above, with the journal + snapshot file map, the id index, the `log.md` parse cache and the `index.md` line cache. **The machine was heavily loaded during every after-fix run (load average 14–30: a concurrent `tsc` at ~450% CPU and a QEMU VM),** so the wall-time rows below carry more noise than the baseline did.

Files in [`210-task0/`](210-task0/):

| File | What |
| --- | --- |
| `task0.2-paired/markdown-scale.before-{1,2,3}.jsonl` | `markdown-scale.mjs --notes 1000,10000,50000` with the HEAD fabric sources, run back to back with the after side |
| `task0.2-paired/markdown-scale.after-{1,2,3}.jsonl` | the same with the fix (this build still sorted `index.md` with an `Intl.Collator`; see below) |
| `markdown-scale.after.jsonl` | one run of the final code (collator reverted to `localeCompare`) |
| `profiles/markdown-warm-open-10k.after.summary.json` | warm open + 30 writes + 100 recalls at 10k notes, fix applied (collator build) |

### Paired medians (three runs each side)

| Notes | Metric | Before | After | After / before |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | write p95 | 5.67 ms | 3.67 ms | 0.65 |
| 10,000 | write p95 | 33.01 ms | 15.30 ms | **0.46** |
| 50,000 | write p95 | 226.37 ms | 89.01 ms | **0.39** |
| 1,000 | `derivedBytesRewrittenPerUpsert` | 1,139,270 | 348,467 | 0.31 |
| 10,000 | `derivedBytesRewrittenPerUpsert` | 11,442,377 | 3,516,320 | 0.31 |
| 50,000 | `derivedBytesRewrittenPerUpsert` | 57,089,351 | 17,405,120 | 0.30 |
| 10,000 | warm open | 277 ms | 326 ms | 1.17 |
| 50,000 | cold open (extra passes) | 18,948 ms (1) | 25,833 ms (2) | 1.36 |
| 10,000 | recall p95 | 0.80 ms | 0.95 ms | 1.19 |

The per-file split (new field `derivedBytesRewrittenPerUpsertByFile`) shows where the remaining bytes go. At every size, `.index-files.json` is 0 B and `.index-files.journal.jsonl` is **729 B** per upsert: the file-map sidecar no longer scales with the map. The rest is the recorded residual. `index.md` is rewritten whole (~345 B per note on this fixture), and `log.md` stops growing at its 2,000-entry cap (56 KB).

### Open and recall: not demonstrated within 10%

The open and recall rows above are outside the ±10% target, but they are confounded:
- Recall runs entirely in the SQLite index, which this task did not touch, and it moved by the same 7–19%.
- An interleaved A/B (HEAD and new sources loaded side by side, alternating per process, five samples each, same seeded tree) gave warm open at 1,000 notes of 88.5 ms before and 91.3 ms after (+3%, final code). At 10,000 notes the spread within one side (479–899 ms) was larger than any difference.
- In the after-side warm-open profile, all `FileIndex` work (load, replay, put, get, flush) is ≤ 3% of samples. The profile is dominated by the unchanged per-file `stat` walk and by `regenerateIndex`.

So no regression from the new code is visible in the profile, but the ±10% criterion is **not demonstrated** on this loaded machine. Re-run the paired command on an idle machine to settle it.

### Collator finding

The plan asked for one shared `Intl.Collator` in place of per-call `localeCompare`. In Bun 1.4.4, `Intl.Collator.compare` sorts 10,000 strings in 14–17 ms against 9–13 ms for argument-less `localeCompare`, about 50% slower. The final code keeps `localeCompare`, which gives the same order and bytes, and caches only the per-entry line render (`encodeURI`).

### Gate

`scripts/budgets.json#markdownStore`, enforced by `markdown_store_write_amplification_within_budget` (`scripts/memory-bench/run.test.mjs`), runs `--notes 200,2000`. It enforces two ceilings:
- file-map bytes per upsert at 2,000 notes ≤ 4,096 B (deterministic; measured 729 B, where the old code wrote ~2.3 MB);
- `writeP50(2000) / writeP50(200)` ≤ 2.75 (interleaved A/B: 3.52 before, 1.81 after).

## Task 0.3 — session snapshot after the fix

The fix: the session's own appends at the cached tip extend the snapshot cache with one detached copy, and an expired cache is revalidated by one `store.get` of its tip. The full scenario (1,000 memory runs, 150 SQLite runs), three after-fix runs on the reference machine at load average 5–7, are in `210-task0/session-turn-overhead.after.json` (the median run).

| Variant | Total | First-20 p50 | Last-20 p50 | `growthRatio` | Entries read per run | Store calls after open |
| --- | --- | --- | --- | --- | --- | --- |
| memory, before | 87 s | 2.52 ms | 163.1 ms | 64.8 | 6,118 | one `readBranchPath` per snapshot |
| memory, after (3 runs) | 12.5–13.6 s | 0.95–1.15 ms | 26.2–28.9 ms | 25.2–27.5 | 0.01 | 1 `readBranchPath`, 12–13 revalidation `get`s |
| SQLite (150 runs), before | — | 3.73 ms | 484.1 ms | 129.7 | — | — |
| SQLite (150 runs), after (3 runs) | 0.32–0.36 s | 0.90–1.43 ms | 2.74–3.20 ms | 2.2–3.5 | 0 | 1 `readBranchPath` |

The 1,000-run scenario is now inside the 60 s budget Task 0.1 could not meet.

### Gate-sized paired runs

`210-task0/task0.3-gate-paired/`: the gate's run counts (300 memory, 60 SQLite), run interleaved three times each, on the pre-Task-0.2 commit (`a4e09001`, a worktree with this scenario copied in) and on this tree.

| Variant | Before (median of 3) | After (median of 3) |
| --- | --- | --- |
| memory, total | 7,195 ms | 972 ms |
| memory, p95 | 45.96 ms | 6.23 ms |
| memory, `growthRatio` | 20.2 | 5.1 |
| memory, entries read per run | 1,918 | 0 |
| SQLite, p95 | 57.17 ms | 2.23 ms |
| SQLite, `growthRatio` | 7.6 | 1.8 |
| SQLite, entries read per run | 478 | 0 |

### After-fix CPU profile: memory store, 1,000 runs

`210-task0/profiles/kernel-memory.after.summary.json`. `structuredClone` drops from 57.1% self to 0.9%, and `readBranchPath` no longer appears. What is left is the provider request:

| Function | Self | Inclusive |
| --- | --- | --- |
| `stringify` under `jsonBytes` (`helpers.ts:147`, the `maxRequestBytes` measure) | 82.1% | 82.9% |
| `collectMessageContentBlocks` (`content.ts:154`, capability check) | 5.1% | 5.9% |
| `estimateMessagesMemoized` (`provider-round.ts`) | 1.0% | — |
| `structuredClone` | 0.9% | — |
| `extendSnapshot` | 0.6% | — |

### `growthRatio` ≤ 1.5 is not reachable on this fixture

The plan's target assumed the snapshot dominated per-run growth. After the fix, 83% of per-run time is `jsonBytes` serializing the whole provider request for `maxRequestBytes`. The plan keeps that measure because it is O(request) by nature, and this fixture's request grows by about 4 KB every run (two 2 KB payloads, never compacted), to ~4 MB at run 1,000. The gate therefore freezes ceilings that hold the fix and still fail the old code: `storeEntriesReadPerRun` ≤ 1 (deterministic: before 1,918 / 478, after 0), and `growthRatio` ≤ 10 (memory) and ≤ 5 (SQLite) at gate run counts (before 20.2 / 7.6, after 5.1 / 1.8). The p95 sanity ceiling is 30 ms (before ~46 / ~57, after ~6 / ~2), scaled 8× on CI.

### Cache-stability pin re-attestation

`prefix-probe.mjs --equivalence --base <worktree at a4e09001>` first reported every request in both arms as different. The kept request text showed only the memory note ids and session ids differing (base `…001233`, post `…001050`): the preload pins `randomUUID` to one counter, and memory-core's `atomicWriteFile` draws a temp-file name from it. Task 0.2 writes far fewer whole snapshot files, so every later kernel-minted id shifted. The same difference appeared with the Task 0.3 sources reverted, so it was not this task. `scripts/memory-bench/equivalence-preload.mjs` now gives `randomUUID` calls from `atomicWriteFile` their own counter (temp names are renamed away and never reach a request). The rerun compared 54 requests, all identical, and `readiness.mjs --cache-stability` passed: 29 tests, equivalence identical.

### SQLite parity of an extended snapshot

A five-run SQLite session with tool calls was compared against `rebuildSessionContext(store.list())`. The messages are JSON-identical. The only deep-equality differences are keys whose value is `undefined`: the memory store keeps them, and SQLite's JSON round trip drops them on messages and adds them for empty columns. That was already true between stores, nothing in the kernel tests for those keys being present, and provider requests (JSON) are byte-identical.

## Task 0.4 — SQLite branch read after the fix

The fix (`packages/stores/sqlite/src/persistence.ts`, `readEntryBranch` and the `leafId` branch of `queryEntries`): the recursive CTE carries `parent_id`, joins the parent straight by primary key, filters the session with `+parent.session_id` (so the planner cannot pick the `(session_id, id)` index), and the final select is `branch_path CROSS JOIN prism_session_entries`, so it is driven from the path. Entries, order, paging and the ownership clause on the seed row are unchanged. No schema or index change.

`EXPLAIN QUERY PLAN` after:

```
CO-ROUTINE branch_path
  SETUP
    SEARCH seed USING INDEX sqlite_autoindex_prism_session_entries_1 (id=?)
  RECURSIVE STEP
    SCAN bp
    SEARCH parent USING INDEX sqlite_autoindex_prism_session_entries_1 (id=?)
SCAN bp
SEARCH e USING INDEX sqlite_autoindex_prism_session_entries_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
```

A cold full-branch read of a one-session chain (200 B messages, in-memory database, mean of 5 reads):

| Depth | Before | After |
| --- | --- | --- |
| 200 | 9.86 ms | 0.55 ms |
| 2,000 | 1,317.8 ms | 5.76 ms |
| 2,000 / 200 ratio | ~134 (quadratic) | ~10.5 (linear) |

`branch_read_cost_is_linear_in_depth` gates the ratio at ≤ 15; with the old query restored it measured 13.2 → 1,353.9 ms and failed, and `branch_read_query_plan_uses_primary_key` failed too.

**Postgres (checked, unchanged).** `EXPLAIN (ANALYZE)` on a local PostgreSQL 18.6, schema `exp`, at depth 2,000 alone and at depth 1,000 beside 50,000 rows in 500 other sessions: the old recursive step is already an `Index Scan using prism_session_entries_session_id_idx` with `Index Cond: (session_id = $3 AND id = bp.id)`, 1 row per loop, and the parent is a `prism_session_entries_pkey` lookup. With other sessions present, the final select is a `pkey` nested loop (a `Seq Scan` + hash join appears only when the table holds just that session). Execution was 5.9 ms (depth 2,000) and 3.3 ms (depth 1,000 + 50k rows). The same rewrite measured 3.7 / 2.5 ms. The plan shape that made SQLite quadratic is absent, so per the task's condition the Postgres query is left as is.

**Scenario.** The SQLite caps (`sqliteRuns`/`sqliteGateRuns`) are gone; both stores run the full counts. The 1,000-run scenario (`210-task0/session-turn-overhead.task0.4.json`) at load average ~4:

| Variant | Total | First-20 p50 | Last-20 p50 | `growthRatio` | Entries read per run |
| --- | --- | --- | --- | --- | --- |
| memory, 1,000 runs | 12.9 s | 0.94 ms | 24.4 ms | 26.2 | 0.01 |
| SQLite, 1,000 runs | 11.9 s | 0.96 ms | 26.7 ms | 27.9 | 0.01 |

Both together take ~25 s, inside the 60 s budget. SQLite now grows like memory: the residual is the shared `jsonBytes` request cost (Task 0.3), not the store.

**Gate.** At 300 gate runs (`210-task0/task0.4-gate/`, three runs), SQLite `growthRatio` was 5.5 / 8.2 / 6.1 (memory 5.0 / 5.9 / 3.4), p95 7.2–8.1 ms, entries read per run 0. Task 0.3 froze SQLite's ceiling at 5 on 60 runs, so it moved to memory's 10 for the same 300-run fixture.

## Verdict

No profile contradicts the Task 0.2 or Task 0.3 premise, so both proceed. One new defect is recorded: the SQLite branch read query plan, now Task 0.4, which fixed it (Postgres does not have it).
