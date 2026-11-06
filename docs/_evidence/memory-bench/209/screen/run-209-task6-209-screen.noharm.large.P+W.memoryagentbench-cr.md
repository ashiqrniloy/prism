# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 381452; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P+W.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 29 (3.63/q); recall calls: 36; snippet tokens: 17139; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 261847.2 ms at concurrency 1 (initial 1); end-to-end questions p50 17106.8 ms / p95 93201 ms; ingestion n=8 p50/p95/mean 1228.3/60028.6/16927.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=8 p50/p95/mean 14401.2/32920.2/15213.9 ms; evaluation n=8 p50/p95/mean 0/0.5/0.1 ms; solver 37x p50 2980.2ms.
USD: campaign 0.040456; product measured/cold/warm 0.040456/0.040456/0.040456; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
