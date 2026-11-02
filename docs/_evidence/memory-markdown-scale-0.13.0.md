# Markdown memory scale — 0.13.0

Refreshed 2026-11-02 with:

```sh
timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
```

## Environment and method

Bun 1.4.4; linux 7.3.0-4-cachyos; AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics.
Scratch storage was `/tmp` on **tmpfs**. These are one-run measurements,
not durable-disk latency guarantees. Set `TMPDIR` to a directory on the intended
storage volume to repeat there. Filesystem/OS caches were not flushed; “cold”
means the derived SQLite index and file map do not exist, not a cold OS cache.
No significant workspace build ran concurrently with this refresh.

Each size uses a fresh scratch tree and one tenant/resource/thread. Synthetic
fact notes have roughly 140-character bodies, a tag from 100 protocol terms,
and empty embeddings. The production OKF renderer and path builder seed files
outside the timer. No model, network, private data, or embeddings are involved.
Cold timing includes open and any extra incremental reconciliation passes until
all notes are counted. Defaults (10-second rebuild budget) remain unchanged.
Warm timing opens the unchanged tree. Edited timing opens after appending text
to exactly 1% of files. Assertions verify indexed count and edited content.

Then 100 sequential single-note upserts overwrite existing notes, including
canonical-file, audit-log, file-map and root-index work. 200 lexical store queries
cycle through 100 protocol terms with topK=5, asserting nonempty results. Latency
percentiles use nearest rank. This measures the store's lexical recall path;
it excludes tool serialization, agent turns, and embedding work.
Sizes are sums of logical file lengths after close (not allocated disk blocks).
Index size includes SQLite sidecars if present; total tree size includes index,
markdown, logs and control/cache files. Trees are removed in `finally`.

The SQLite lexical path now caches a scope's fallback generation until a write
clears it and computes query coverage from the stored analyzed terms. Before that
change, every query paid a full JSON scan when no generation pointer existed.
The 50k recall p95 fell from 113.50 ms in the 2026-10-19 run to 4.39 ms here;
write cost is unchanged in character.

## Results

All latency values are milliseconds; sizes are bytes.

| Notes | Cold open + rebuild | Extra cold passes | Warm open | Open after 1% edits | Write p50 | Write p95 | Recall p50 | Recall p95 | Index bytes | Total tree bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 403.68 | 0 | 53.77 | 48.90 | 3.80 | 6.92 | 0.14 | 0.25 | 991,232 | 2,832,506 |
| 10,000 | 3569.44 | 0 | 308.60 | 316.03 | 28.69 | 36.56 | 0.55 | 0.93 | 9,256,960 | 27,718,415 |
| 50,000 | 19003.46 | 1 | 1558.79 | 1736.15 | 192.74 | 217.43 | 3.44 | 4.39 | 46,137,344 | 138,694,212 |

At 10k, warm open **308.60 ms < 2,000 ms** and p95 lexical recall
**0.93 ms < 50 ms**. At 50k, warm open is **1,558.79 ms**, p95 recall
**4.39 ms**, but p95 writes rise to **217.43 ms**.

## Supported operating envelope

Use markdown for local mixed read/write workloads up to **10k small notes**,
subject to validating the actual storage volume. 50k is a measured read-heavy
stress point, not the recommended mixed-workload envelope: writes take ~217 ms
p95 and a warm open ~1.56 s. Switch to SQLite or Postgres above 50k, for
concurrent/server writers, or when 200 ms writes matter. Postgres is measured
separately at 100k exchanges in `memory-bench/202/exchange-scale.md`.
Larger bodies, broader queries, multiple scopes, slow disks and sustained audit
history need a fresh run; these results do not establish their limits.

A cold open can stop at its bounded reconciliation budget: at 50k this run
required one extra pass. Callers that need complete retrieval must finish
incremental reconciliation; timing only the first open would understate
rebuild time and could benchmark an incomplete corpus. This task changes no
production limits or startup behavior.

## Verification

- Full 1k/10k/50k command: exit 0.
- `timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs`: includes
  `markdown_scale_smoke_reports_all_metrics` (`--notes 200`).
- One-note CLI boundary self-check: exit 0.

## Raw output

```jsonl
{"bun":"1.4.4","platform":"linux","release":"7.3.0-4-cachyos","cpu":"AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics","date":"2026-11-02T10:05:32.843Z"}
{"notes":1000,"editedNotes":10,"cold":{"ms":403.677594,"extraPasses":0},"warm":{"ms":53.76760699999994,"extraPasses":0},"edited":{"ms":48.900847,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":3.7962720000000445,"writeP95Ms":6.9152239999999665,"recallP50Ms":0.13808300000005147,"recallP95Ms":0.24875399999996262,"treeBytes":2832506,"indexBytes":991232}
{"notes":10000,"editedNotes":100,"cold":{"ms":3569.435326,"extraPasses":0},"warm":{"ms":308.5977669999993,"extraPasses":0},"edited":{"ms":316.0324010000004,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":28.690605000000687,"writeP95Ms":36.56266200000027,"recallP50Ms":0.5465010000007169,"recallP95Ms":0.9319150000010268,"treeBytes":27718415,"indexBytes":9256960}
{"notes":50000,"editedNotes":500,"cold":{"ms":19003.458627,"extraPasses":1},"warm":{"ms":1558.7940130000025,"extraPasses":0},"edited":{"ms":1736.1511049999972,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":192.7385360000044,"writeP95Ms":217.4332560000039,"recallP50Ms":3.4412890000021434,"recallP95Ms":4.3865420000001905,"treeBytes":138694212,"indexBytes":46137344}
```
