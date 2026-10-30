# Memory benchmark: longmemeval-m / lexical-topk

Status: completed. Input: 168987; cache read: 8952; ratio: 0.0530.
Attempt: 202-baseline.longmemeval-m.lexical-topk.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 633291.3 ms at concurrency 1 (initial 1); end-to-end questions p50 10796 ms / p95 19976.3 ms; ingestion n=50 p50/p95/mean 359.5/382.2/349.1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=50 p50/p95/mean 7783.1/16439.7/8414.1 ms; evaluation n=50 p50/p95/mean 2585.3/7525.1/2923.9 ms; judge 88x p50 1339.2ms, solver 50x p50 7777.1ms.
USD: campaign 0.026559; product measured/cold/warm 0.022796/0.022796/0.022796; evaluation 0.003763.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 12 | 0.3333 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 8 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 8 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 6 | 0.6667 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-preference | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| abstention | 8 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
