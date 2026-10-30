# Memory benchmark: longmemeval-m / full-truncated

Status: failed. Input: 25732608; cache read: 6490; ratio: 0.0003.
Attempt: 202-baseline.longmemeval-m.full-truncated.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: false; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 30. Metric version: 2.
Phase: all. Timing: arm 1755750.6 ms at concurrency 1 (initial 1); end-to-end questions p50 47070.7 ms / p95 76308.4 ms; ingestion n=32 p50/p95/mean 114.2/130.9/113.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=32 p50/p95/mean 44010.4/72755.5/48388.1 ms; evaluation n=32 p50/p95/mean 3102.7/5738.3/3455.9 ms; judge 64x p50 1587.3ms, solver 34x p50 35704.2ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation 0.002009.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 12 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 8 | 0.6250 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 8 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
