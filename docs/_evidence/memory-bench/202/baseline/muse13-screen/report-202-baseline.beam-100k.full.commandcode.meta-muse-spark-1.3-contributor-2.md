# Memory benchmark: beam-100k / full

Status: completed. Input: 5442607; cache read: 9464; ratio: 0.0017.
Attempt: 202-baseline.beam-100k.full.commandcode.meta/muse-spark-1.3-contributor@2; usage complete: true; resumed results: 32.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 242644.1 ms at concurrency 1 (initial 1); end-to-end questions p50 0 ms / p95 44897.5 ms; ingestion n=40 p50/p95/mean 5.3/8/5.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 16374.8/31138.1/17833.9 ms; evaluation n=40 p50/p95/mean 3602.7/23008.7/7396.9 ms; judge 24x p50 2389.3ms, solver 8x p50 11756.2ms.
USD: campaign 0.567603; product measured/cold/warm 0.551033/0.551033/0.022732; evaluation 0.01657.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2034 | 0.0000 | 0.0000 |
| summarization | 4 | 0.5000 | 0.0000 | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
