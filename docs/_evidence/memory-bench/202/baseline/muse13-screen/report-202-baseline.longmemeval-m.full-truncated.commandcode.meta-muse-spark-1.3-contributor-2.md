# Memory benchmark: longmemeval-m / full-truncated

Status: completed. Input: 39746687; cache read: 7987; ratio: 0.0002.
Attempt: 202-baseline.longmemeval-m.full-truncated.commandcode.meta/muse-spark-1.3-contributor@2; usage complete: false; resumed results: 32.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 46. Metric version: 2.
Phase: all. Timing: arm 1352838.6 ms at concurrency 1 (initial 1); end-to-end questions p50 0 ms / p95 113591.7 ms; ingestion n=50 p50/p95/mean 114.2/130.9/114.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=50 p50/p95/mean 47004.7/114745.7/55992.7 ms; evaluation n=50 p50/p95/mean 2976.2/6442.5/3220.1 ms; judge 26x p50 1534.6ms, solver 18x p50 50297ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation 0.003658.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 12 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 8 | 0.6250 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 8 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 6 | 0.6667 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-preference | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| abstention | 8 | 0.8750 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
