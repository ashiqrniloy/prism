# Memory benchmark: memoryagentbench-cr / lexical-topk

Status: completed. Input: 5410; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.memoryagentbench-cr.lexical-topk.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 173915.8 ms at concurrency 1 (initial 1); end-to-end questions p50 7798.3 ms / p95 14682.7 ms; ingestion n=20 p50/p95/mean 32.8/146.7/48.3 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=20 p50/p95/mean 7779.2/14661.7/8612.5 ms; evaluation n=20 p50/p95/mean 0/0/0 ms; solver 20x p50 7777.4ms.
USD: campaign 0.004415; product measured/cold/warm 0.004415/0.004415/0.004415; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 10 | 0.4000 | n/a | n/a | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 10 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
