# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1057240; cache read: 9990; ratio: 0.0094.
Attempt: 202-baseline.beam-100k.preset-r1.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 55 (1.38/q); recall calls: 71; snippet tokens: 177047; recall@k: 0.5556.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1236352.2 ms at concurrency 1 (initial 1); end-to-end questions p50 19133.6 ms / p95 81828.1 ms; ingestion n=40 p50/p95/mean 229/293.7/233.6 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 13145.3/45641/18806.7 ms; evaluation n=40 p50/p95/mean 4004.6/36013.5/11823.3 ms; judge 95x p50 2177.1ms, solver 82x p50 7733.9ms.
USD: campaign 0.135612; product measured/cold/warm 0.111808/0.111808/0.111808; evaluation 0.023804.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.07083333333333333 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.7500 | 0.75 | 0.75 | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.2500 | 0.1 | 0 | 0.2500 |
| preference_following | 4 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.041666666666666664 | 0 | 0.0000 |
| temporal_reasoning | 4 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2871 | 0.0000 | 0.0000 |
| summarization | 4 | 0.3500 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
