# Memory benchmark: longmemeval-m / full

Status: completed. Input: 2251456; cache read: 719; ratio: 0.0003.
Attempt: 202-baseline.longmemeval-m.full.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 46. Metric version: 2.
Phase: all. Timing: arm 703159.5 ms at concurrency 1 (initial 1); end-to-end questions p50 9934.9 ms / p95 30456.6 ms; ingestion n=50 p50/p95/mean 119.2/278.5/164.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=50 p50/p95/mean 9808.5/25172.2/12494.8 ms; evaluation n=4 p50/p95/mean 3722.5/5217.7/3931.7 ms; judge 8x p50 2063.6ms, solver 4x p50 25056.5ms.
USD: campaign 0.227117; product measured/cold/warm 0.226827/0.226827/0.0064; evaluation 0.00029.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 12 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 8 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 8 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 6 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 4 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-preference | 4 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| abstention | 8 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
