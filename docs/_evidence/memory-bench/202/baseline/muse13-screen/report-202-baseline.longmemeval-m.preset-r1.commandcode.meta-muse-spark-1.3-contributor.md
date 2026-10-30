# Memory benchmark: longmemeval-m / fabric-x-tools

Status: completed. Input: 1555111; cache read: 9413; ratio: 0.0061.
Attempt: 202-baseline.longmemeval-m.preset-r1.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 78 (1.56/q); recall calls: 104; snippet tokens: 246481; recall@k: 0.9184.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2171555.8 ms at concurrency 1 (initial 1); end-to-end questions p50 36243.8 ms / p95 76536.8 ms; ingestion n=50 p50/p95/mean 23690.7/27024.2/22516 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=50 p50/p95/mean 9589.3/40587.7/16005.9 ms; evaluation n=50 p50/p95/mean 2959.7/7876.6/3512.1 ms; judge 96x p50 1492.2ms, solver 109x p50 4921.5ms.
USD: campaign 0.166454; product measured/cold/warm 0.161841/0.161841/0.161841; evaluation 0.004613.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 12 | 0.6667 | n/a | 1.0000 | 0.7513888888888888 | 0.5833333333333334 | 0.0000 |
| knowledge-update | 8 | 0.7500 | n/a | 1.0000 | 0.6875 | 0.375 | 0.0000 |
| temporal-reasoning | 8 | 0.5000 | n/a | 0.8750 | 0.7083333333333334 | 0.625 | 0.1250 |
| single-session-user | 6 | 0.8333 | n/a | 0.8333 | 0.8333333333333334 | 0.8333333333333334 | 0.0000 |
| single-session-assistant | 4 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| single-session-preference | 4 | 0.2500 | n/a | 0.5000 | 0.125 | 0 | 0.0000 |
| abstention | 8 | 0.8750 | n/a | 1.0000 | 1 | 1 | 0.1250 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
