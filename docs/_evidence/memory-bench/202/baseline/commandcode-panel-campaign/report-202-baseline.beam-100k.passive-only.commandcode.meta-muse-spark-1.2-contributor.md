# Memory benchmark: beam-100k / fabric-x

Status: completed. Input: 260453; cache read: 9585; ratio: 0.0368.
Attempt: 202-baseline.beam-100k.passive-only.commandcode.meta/muse-spark-1.2-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 8 (0.20/q); recall calls: 41; snippet tokens: 144676; recall@k: 0.4722.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 651855.8 ms at concurrency 1 (initial 1); end-to-end questions p50 11243.3 ms / p95 25658.9 ms; ingestion n=40 p50/p95/mean 226.9/290.2/228.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 6039.8/11714.2/6792.8 ms; evaluation n=40 p50/p95/mean 4122.9/19541.9/9233.9 ms; judge 94x p50 1635.4ms, solver 47x p50 5794.7ms.
USD: campaign 0.047155; product measured/cold/warm 0.030767/0.030767/0.030767; evaluation 0.016388.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.2500 | 0.020833333333333332 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 0.7500 | 0.375 | 0 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.2500 | 0.1 | 0 | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.041666666666666664 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.5000 | n/a | 1.0000 | 0.75 | 0.5 | 0.2500 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.0718 | 0.0000 | 0.2500 |
| summarization | 4 | 0.2000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
