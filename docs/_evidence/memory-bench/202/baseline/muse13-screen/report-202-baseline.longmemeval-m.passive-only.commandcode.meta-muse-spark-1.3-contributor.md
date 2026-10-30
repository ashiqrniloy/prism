# Memory benchmark: longmemeval-m / fabric-x

Status: completed. Input: 212511; cache read: 9701; ratio: 0.0456.
Attempt: 202-baseline.longmemeval-m.passive-only.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 50; snippet tokens: 186927; recall@k: 0.8571.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1739461.8 ms at concurrency 1 (initial 1); end-to-end questions p50 33058.2 ms / p95 46159.5 ms; ingestion n=50 p50/p95/mean 23303.9/27239.3/22354.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=50 p50/p95/mean 6538.5/17497.8/8011.9 ms; evaluation n=50 p50/p95/mean 2796.4/4875.1/3012.5 ms; judge 100x p50 1349.3ms, solver 50x p50 6317.5ms.
USD: campaign 0.029902; product measured/cold/warm 0.025653/0.025653/0.025653; evaluation 0.004249.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 12 | 0.5000 | n/a | 0.8333 | 0.5722222222222223 | 0.4166666666666667 | 0.0000 |
| knowledge-update | 8 | 0.6250 | n/a | 1.0000 | 0.6875 | 0.375 | 0.0000 |
| temporal-reasoning | 8 | 0.2500 | n/a | 0.8750 | 0.5625 | 0.375 | 0.0000 |
| single-session-user | 6 | 0.8333 | n/a | 0.8333 | 0.6666666666666666 | 0.6666666666666666 | 0.0000 |
| single-session-assistant | 4 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| single-session-preference | 4 | 0.2500 | n/a | 0.5000 | 0.125 | 0 | 0.0000 |
| abstention | 8 | 0.8750 | n/a | 0.8571 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
