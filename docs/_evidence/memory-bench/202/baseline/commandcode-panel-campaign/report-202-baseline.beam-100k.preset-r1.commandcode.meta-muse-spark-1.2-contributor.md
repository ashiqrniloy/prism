# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1702517; cache read: 8797; ratio: 0.0052.
Attempt: 202-baseline.beam-100k.preset-r1.commandcode.meta/muse-spark-1.2-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 80 (2.00/q); recall calls: 83; snippet tokens: 190441; recall@k: 0.6389.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 864494.1 ms at concurrency 1 (initial 1); end-to-end questions p50 15502 ms / p95 52579.4 ms; ingestion n=40 p50/p95/mean 238.3/320.3/245.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 8161.1/28164.9/12728 ms; evaluation n=40 p50/p95/mean 4294.3/26764.3/8592.1 ms; judge 88x p50 2053ms, solver 117x p50 3435.2ms.
USD: campaign 0.192044; product measured/cold/warm 0.176189/0.176189/0.176189; evaluation 0.015855.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.10416666666666666 | 0 | 0.2500 |
| information_extraction | 4 | 0.7500 | n/a | 0.5000 | 0.5 | 0.5 | 0.2500 |
| instruction_following | 4 | 1.0000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 1.0000 | 0.75 | 0.5 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.5000 | 0.15000000000000002 | 0 | 0.2500 |
| preference_following | 4 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.7500 | 0.14583333333333331 | 0 | 0.0000 |
| temporal_reasoning | 4 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.1948 | 0.0000 | 0.3333 |
| summarization | 4 | 0.3375 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
