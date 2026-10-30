# Memory benchmark: beam-1m / full-truncated

Status: failed. Input: 13485198; cache read: 4141; ratio: 0.0003.
Attempt: 202-baseline.beam-1m.full-truncated.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 12. Metric version: 2.
Phase: all. Timing: arm 986105.9 ms at concurrency 1 (initial 1); end-to-end questions p50 43102.6 ms / p95 126025.1 ms; ingestion n=15 p50/p95/mean 41.9/57.6/42.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=15 p50/p95/mean 39338.6/80953.7/43361.4 ms; evaluation n=15 p50/p95/mean 2903.1/80025.4/15963.5 ms; judge 48x p50 1506.6ms, solver 16x p50 37564.7ms.
USD: campaign 1.366512; product measured/cold/warm 1.352862/1.352862/1.352862; evaluation 0.01365.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 3 | 0.3333 | n/a | n/a | n/a | n/a | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2731 | 0.0000 | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
