# Memory benchmark: locomo / fabric-x-tools

Status: completed. Input: 1112060; cache read: 10749; ratio: 0.0097.
Attempt: 202-baseline.locomo.preset-r1.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: false; resumed results: 0.
Tool calls: 83 (1.38/q); recall calls: 109; snippet tokens: 123045; recall@k: 0.8000.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1429767.4 ms at concurrency 1 (initial 1); end-to-end questions p50 16086.5 ms / p95 37925.8 ms; ingestion n=60 p50/p95/mean 490.3/739.3/538.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 11567.2/30448.9/16472.5 ms; evaluation n=60 p50/p95/mean 3529.2/6413.8/6746.4 ms; judge 115x p50 1376.2ms, solver 132x p50 6027.8ms.
USD: campaign 0.12517; product measured/cold/warm 0.119132/0.119132/0.119132; evaluation 0.006038.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.1667 | 0.12458517264373815 | 0.8333 | 0.5813492063492064 | 0.4166666666666667 | 0.0833 |
| temporal | 12 | 0.6667 | 0.16471052096052094 | 0.7500 | 0.6527777777777778 | 0.5833333333333334 | 0.0833 |
| open-domain | 12 | 0.5833 | 0.08252173526743982 | 0.5833 | 0.375 | 0.16666666666666666 | 0.0000 |
| single-hop | 12 | 1.0000 | 0.4358613608613609 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 12 | 0.8333 | 0.8333333333333334 | 0.8333 | 0.8333333333333334 | 0.8333333333333334 | 0.0833 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
