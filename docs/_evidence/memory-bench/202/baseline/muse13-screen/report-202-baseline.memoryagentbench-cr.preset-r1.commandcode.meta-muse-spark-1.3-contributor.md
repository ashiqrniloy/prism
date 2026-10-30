# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: completed. Input: 188562; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.memoryagentbench-cr.preset-r1.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 82 (4.10/q); recall calls: 43; snippet tokens: 115; recall@k: 0.0000.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 201117.6 ms at concurrency 1 (initial 1); end-to-end questions p50 9415.3 ms / p95 15036.8 ms; ingestion n=20 p50/p95/mean 115.5/498.7/159.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=20 p50/p95/mean 9064.5/14912.4/9867.4 ms; evaluation n=20 p50/p95/mean 0/0/0 ms; solver 77x p50 2280.3ms.
USD: campaign 0.021137; product measured/cold/warm 0.021137/0.021137/0.021137; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 10 | 0.0000 | n/a | 0.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 10 | 0.0000 | n/a | 0.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
