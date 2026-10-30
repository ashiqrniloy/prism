# Memory benchmark: memoryagentbench-cr / full-truncated

Status: completed. Input: 4336646; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.memoryagentbench-cr.full-truncated.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 248877.4 ms at concurrency 1 (initial 1); end-to-end questions p50 9210 ms / p95 26218 ms; ingestion n=20 p50/p95/mean 54.3/247.3/77.6 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=20 p50/p95/mean 9154/25997.5/12350.5 ms; evaluation n=20 p50/p95/mean 0/0.1/0 ms; solver 20x p50 9143.5ms.
USD: campaign 0.436872; product measured/cold/warm 0.436872/0.436872/0.436872; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 10 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 10 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
