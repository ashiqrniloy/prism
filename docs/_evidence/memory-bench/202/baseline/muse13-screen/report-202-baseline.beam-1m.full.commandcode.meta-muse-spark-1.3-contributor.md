# Memory benchmark: beam-1m / full

Status: failed. Input: 938432; cache read: 197; ratio: 0.0002.
Attempt: 202-baseline.beam-1m.full.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 2. Metric version: 2.
Phase: all. Timing: arm 57491.6 ms at concurrency 1 (initial 1); end-to-end questions p50 2840.6 ms / p95 30576.7 ms; ingestion n=3 p50/p95/mean 32.1/46.1/36.3 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=3 p50/p95/mean 2790.1/28222.6/10522.4 ms; evaluation n=1 p50/p95/mean 2320.7/2320.7/2320.7 ms; judge 2x p50 1124.8ms, solver 4x p50 2734.7ms.
USD: campaign 0.094054; product measured/cold/warm 0.093971/0.093971/0.002074; evaluation 0.000083.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 3 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
