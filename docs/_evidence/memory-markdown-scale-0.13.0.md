# Markdown memory scale — 0.13.0

Refreshed 2026-11-07 after plan 210 Task 0.2 (file-map journal) with:

```sh
timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
```

## Environment and method

Bun 1.4.4; linux 7.3.0-4-cachyos; AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics.
Scratch storage was `/tmp` on **tmpfs**. These are one-run measurements,
not durable-disk latency guarantees. Set `TMPDIR` to a directory on the intended
storage volume to repeat there. Filesystem/OS caches were not flushed; “cold”
means the derived SQLite index and file map do not exist, not a cold OS cache.
**This refresh ran on a loaded machine** (load average 14–30: a concurrent `tsc` and a QEMU VM), so open and recall times carry more noise than the 2026-11-02 run. The paired before/after comparison is in `210-task0-hot-paths.md` ("Task 0.2").

Each size uses a fresh scratch tree and one tenant/resource/thread. Synthetic
fact notes have roughly 140-character bodies, a tag from 100 protocol terms,
and empty embeddings. The production OKF renderer and path builder seed files
outside the timer. No model, network, private data, or embeddings are involved.
Cold timing includes open and any extra incremental reconciliation passes until
all notes are counted. Defaults (10-second rebuild budget) remain unchanged.
Warm timing opens the unchanged tree. Edited timing opens after appending text
to exactly 1% of files. Assertions verify indexed count and edited content.

Then 100 sequential single-note upserts overwrite existing notes, including
canonical-file, audit-log, file-map and root-index work. `derivedBytesRewrittenPerUpsert`
(plan 210 Task 0.1) and its per-file split `derivedBytesRewrittenPerUpsertByFile`
(Task 0.2) count the derived bytes each upsert writes. 200 lexical store queries
cycle through 100 protocol terms with topK=5, asserting nonempty results. Latency
percentiles use nearest rank. This measures the store's lexical recall path;
it excludes tool serialization, agent turns, and embedding work.
Sizes are sums of logical file lengths after close (not allocated disk blocks).
Index size includes SQLite sidecars if present; total tree size includes index,
markdown, logs and control/cache files. Trees are removed in `finally`.

The SQLite lexical path now caches a scope's fallback generation until a write
clears it and computes query coverage from the stored analyzed terms. Before that
change, every query paid a full JSON scan when no generation pointer existed.
The 50k recall p95 fell from 113.50 ms in the 2026-10-19 run to 4.39 ms on 2026-11-02;
write cost is unchanged in character.

## Results

All latency values are milliseconds; sizes are bytes.

| Notes | Cold open + rebuild | Extra cold passes | Warm open | Open after 1% edits | Write p50 | Write p95 | Recall p50 | Recall p95 | Derived bytes / upsert (file map) | Index bytes | Total tree bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 379.43 | 0 | 34.58 | 35.91 | 1.60 | 2.66 | 0.11 | 0.16 | 348,467 (729) | 991,232 | 2,905,681 |
| 10,000 | 3423.07 | 0 | 309.44 | 313.57 | 9.84 | 13.78 | 0.57 | 0.96 | 3,516,320 (729) | 9,256,960 | 27,794,503 |
| 50,000 | 24184.43 | 2 | 1751.46 | 1754.08 | 71.26 | 125.79 | 5.03 | 8.33 | 17,405,120 (729) | 46,137,344 | 138,769,970 |

At 10k, warm open **309.44 ms < 2,000 ms** and p95 lexical recall
**0.96 ms < 50 ms**. At 50k, warm open is **1,751.46 ms**, p95 recall
**8.33 ms**, and p95 writes are **125.79 ms** (217.43 ms on 2026-11-02).

Since plan 210 Task 0.2, a single-note write appends ~729 B to the file-map journal
instead of rewriting the whole map (~1.14 KB per stored note). What still scales with
the note count is the whole `index.md` rewrite (~345 B per note on this fixture), the
recorded O(n) residual. `log.md` stops growing at its 2,000-entry cap.

## Supported operating envelope

Use markdown for local mixed read/write workloads up to **10k small notes**,
subject to validating the actual storage volume. 50k is a measured read-heavy
stress point, not the recommended mixed-workload envelope: writes take ~126 ms
p95 (down from ~217 ms before plan 210 Task 0.2) and a warm open ~1.75 s. The envelope is
unchanged: the write gain does not remove the O(n) `index.md` rewrite, and this
refresh's open times were measured under load. Switch to SQLite or Postgres above 50k, for
concurrent/server writers, or when 100 ms writes matter. Postgres is measured
separately at 100k exchanges in `memory-bench/202/exchange-scale.md`.
Larger bodies, broader queries, multiple scopes, slow disks and sustained audit
history need a fresh run; these results do not establish their limits.

A cold open can stop at its bounded reconciliation budget: at 50k the store
required one extra pass on 2026-11-02 and two in this loaded refresh. Callers that need complete retrieval must finish
incremental reconciliation; timing only the first open would understate
rebuild time and could benchmark an incomplete corpus. This task changes no
production limits or startup behavior.

## Verification

- Full 1k/10k/50k command: exit 0.
- `timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs`: includes
  `markdown_scale_smoke_reports_all_metrics` (`--notes 200`) and
  `markdown_store_write_amplification_within_budget` (`--notes 200,2000`, `budgets.json#markdownStore`).
- One-note CLI boundary self-check: exit 0.

## Raw output

```jsonl
{"bun":"1.4.4","platform":"linux","release":"7.3.0-4-cachyos","cpu":"AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics","date":"2026-11-06T20:15:12.123Z"}
{"notes":1000,"editedNotes":10,"cold":{"ms":379.425035,"extraPasses":0},"warm":{"ms":34.581964000000085,"extraPasses":0},"edited":{"ms":35.90576599999997,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":1.596542999999997,"writeP95Ms":2.664367000000084,"derivedBytesRewrittenPerUpsert":348467,"derivedBytesRewrittenPerUpsertByFile":{".index-files.json":0,".index-files.journal.jsonl":729,"log.md":2846,"index.md":344892},"recallP50Ms":0.10842700000000605,"recallP95Ms":0.1610369999999648,"treeBytes":2905681,"indexBytes":991232}
{"notes":10000,"editedNotes":100,"cold":{"ms":3423.071306,"extraPasses":0},"warm":{"ms":309.4426880000001,"extraPasses":0},"edited":{"ms":313.5651619999999,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":9.840581000000384,"writeP95Ms":13.78244100000029,"derivedBytesRewrittenPerUpsert":3516320,"derivedBytesRewrittenPerUpsertByFile":{".index-files.json":0,".index-files.journal.jsonl":729,"log.md":56029,"index.md":3459562},"recallP50Ms":0.5735930000000735,"recallP95Ms":0.9568030000000363,"treeBytes":27794503,"indexBytes":9256960}
{"notes":50000,"editedNotes":500,"cold":{"ms":24184.432222000003,"extraPasses":2},"warm":{"ms":1751.4602169999998,"extraPasses":0},"edited":{"ms":1754.0831739999994,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":71.26149500000611,"writeP95Ms":125.78740100000141,"derivedBytesRewrittenPerUpsert":17405120,"derivedBytesRewrittenPerUpsertByFile":{".index-files.json":0,".index-files.journal.jsonl":729,"log.md":56029,"index.md":17348362},"recallP50Ms":5.031617000000551,"recallP95Ms":8.33228699999745,"treeBytes":138769970,"indexBytes":46137344}
```
