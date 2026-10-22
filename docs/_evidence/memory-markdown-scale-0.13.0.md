# Markdown memory scale — 0.13.0

Measured 2026-10-19 with:

```sh
timeout 1800 bun scripts/memory-bench/markdown-scale.mjs --notes 1000,10000,50000
```

## Environment and method

Bun 1.4.2; Linux 7.2.7-1-cachyos; AMD Ryzen 9 PRO 7940HS.
Scratch storage was `/tmp` on **tmpfs**. These are one-run measurements,
not durable-disk latency guarantees. Set `TMPDIR` to a directory on the intended
storage volume to repeat there. Filesystem/OS caches were not flushed; “cold”
means the derived SQLite index and file map do not exist, not a cold OS cache.
The workspace typecheck ran concurrently with part of the run.

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

## Results

All latency values are milliseconds; sizes are bytes.

| Notes | Cold open + rebuild | Extra cold passes | Warm open | Open after 1% edits | Write p50 | Write p95 | Recall p50 | Recall p95 | Index bytes | Total tree bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | 261.55 | 0 | 30.04 | 32.09 | 2.71 | 4.01 | 1.26 | 2.31 | 901120 | 2742372 |
| 10000 | 11912.89 | 1 | 303.96 | 303.46 | 23.23 | 29.93 | 17.56 | 20.17 | 8372224 | 26833650 |
| 50000 | 16492.92 | 1 | 1719.54 | 1766.71 | 177.46 | 209.95 | 96.91 | 113.50 | 41660416 | 134217031 |

At 10k, warm open **303.96 ms < 2,000 ms** and p95 lexical recall
**20.17 ms < 50 ms**: both targets pass. At 50k, p95 recall rises to
**113.50 ms**, and p95 writes to **209.95 ms** even on tmpfs.

## Supported operating envelope

Use markdown for local, low-write workloads up to **10k small notes**, subject
to validating the actual storage volume. Switch to Postgres above 10k when
interactive recall must stay below 50 ms, or when concurrent/server writers and
durable storage throughput matter. 50k is a measured stress point, not the
recommended interactive envelope. Postgres itself was not benchmarked here.
Larger bodies, broader queries, multiple scopes, slow disks and sustained audit
history need a fresh run; these results do not establish their limits.

A cold open can stop at its bounded reconciliation budget: at both 10k and 50k
this run required one extra pass. Callers that need complete retrieval must
finish incremental reconciliation; timing only the first open would understate
rebuild time and could benchmark an incomplete corpus. This task changes no
production limits or startup behavior.

## Verification

- Full 1k/10k/50k command: exit 0.
- `timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs`: 21 pass, 0 fail, including `markdown_scale_smoke_reports_all_metrics` (`--notes 200`).
- `timeout 1200 bun run typecheck`: exit 0 across all workspaces.
- One-note CLI boundary self-check: exit 0.

## Raw output

```jsonl
{"bun":"1.4.2","platform":"linux","release":"7.2.7-1-cachyos","cpu":"AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics","date":"2026-10-19T11:44:23.188Z"}
{"notes":1000,"editedNotes":10,"cold":{"ms":261.552406,"extraPasses":0},"warm":{"ms":30.04275899999999,"extraPasses":0},"edited":{"ms":32.091440999999975,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":2.707045999999991,"writeP95Ms":4.014386000000002,"recallP50Ms":1.2563329999999269,"recallP95Ms":2.3088470000000143,"treeBytes":2742372,"indexBytes":901120}
{"notes":10000,"editedNotes":100,"cold":{"ms":11912.885574,"extraPasses":1},"warm":{"ms":303.9594560000005,"extraPasses":0},"edited":{"ms":303.46493399999963,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":23.234653999999864,"writeP95Ms":29.932039999999688,"recallP50Ms":17.557619999999588,"recallP95Ms":20.174354999999196,"treeBytes":26833650,"indexBytes":8372224}
{"notes":50000,"editedNotes":500,"cold":{"ms":16492.920731,"extraPasses":1},"warm":{"ms":1719.5400349999982,"extraPasses":0},"edited":{"ms":1766.7067910000042,"extraPasses":0},"writeSamples":100,"recallSamples":200,"writeP50Ms":177.46285999999964,"writeP95Ms":209.95455400000355,"recallP50Ms":96.90903599999729,"recallP95Ms":113.50345200000447,"treeBytes":134217031,"indexBytes":41660416}
```
