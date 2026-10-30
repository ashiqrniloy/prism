# Memory benchmark: beam-1m / full

Status: completed. Input: 8208848; cache read: 1704; ratio: 0.0002.
Attempt: 202-baseline.beam-1m.full.commandcode.meta/muse-spark-1.3-contributor@2; usage complete: true; resumed results: 1.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 31. Metric version: 2.
Phase: all. Timing: arm 533769.7 ms at concurrency 1 (initial 1); end-to-end questions p50 3409 ms / p95 44628.8 ms; ingestion n=40 p50/p95/mean 41.1/58.3/41.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 3417.3/41149.5/13080.8 ms; evaluation n=9 p50/p95/mean 2435.7/14523.2/4045.7 ms; judge 16x p50 1707.8ms, solver 8x p50 38238.1ms.
USD: campaign 0.824037; product measured/cold/warm 0.821853/0.821853/0.018238; evaluation 0.002184.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| summarization | 4 | 0.9000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
