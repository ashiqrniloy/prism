# Memory benchmark: locomo / full-truncated

Status: completed. Input: 2055466; cache read: 8259; ratio: 0.0040.
Attempt: 202-baseline.locomo.full-truncated.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 653572.2 ms at concurrency 1 (initial 1); end-to-end questions p50 8925.2 ms / p95 21266.7 ms; ingestion n=60 p50/p95/mean 7.6/11.3/8.1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 6895.7/17308/8235.4 ms; evaluation n=60 p50/p95/mean 3076.4/6418.4/2639.4 ms; judge 76x p50 1645.2ms, solver 60x p50 6882.7ms.
USD: campaign 0.216369; product measured/cold/warm 0.213202/0.213202/0.213202; evaluation 0.003167.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.6667 | 0.30014245155513625 | n/a | n/a | n/a | 0.0000 |
| temporal | 12 | 0.9167 | 0.28694865506011014 | n/a | n/a | n/a | 0.0000 |
| open-domain | 12 | 0.5833 | 0.17665335442505292 | n/a | n/a | n/a | 0.0000 |
| single-hop | 12 | 1.0000 | 0.7606415136587551 | n/a | n/a | n/a | 0.0000 |
| adversarial | 12 | 0.9167 | 0.9166666666666666 | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
