# Memory benchmark: beam-1m / fabric-x-tools

Status: completed. Input: 1024174; cache read: 9645; ratio: 0.0094.
Attempt: 202-baseline.beam-1m.preset-r1.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 46 (1.15/q); recall calls: 66; snippet tokens: 174956; recall@k: 0.5588.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1238683.4 ms at concurrency 1 (initial 1); end-to-end questions p50 20417.3 ms / p95 78845.3 ms; ingestion n=40 p50/p95/mean 4990.9/9389.5/5152.3 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 12071/33856.2/14342 ms; evaluation n=40 p50/p95/mean 3380.7/47195.8/11177.3 ms; judge 97x p50 1854.1ms, solver 74x p50 6875ms.
USD: campaign 0.138642; product measured/cold/warm 0.105587/0.105587/0.105587; evaluation 0.033055.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 0.7500 | 0.29166666666666663 | 0 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.7500 | 0.08211382113821138 | 0 | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | 0.3333 | 0.3333333333333333 | 0.3333333333333333 | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | 0.2500 | 0.16666666666666666 | 0 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 0.7500 | 0.4375 | 0 | 0.0000 |
| multi_session_reasoning | 4 | 0.2500 | n/a | 1.0000 | 0.42063492063492064 | 0 | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.5000 | 0.06923076923076923 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.7500 | n/a | 0.7500 | 0.18749999999999997 | 0 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2890 | 0.0000 | 0.2500 |
| summarization | 4 | 0.4267 | 0.0000 | 0.5000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
